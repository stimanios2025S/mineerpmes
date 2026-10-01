import type {
  InvoiceNature,
  PaymentDirection,
  PaymentMethod,
  Prisma,
} from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D, type Decimal } from "@/lib/decimal";
import { conflit, etatInvalide, nonTrouve, validation } from "@/lib/errors";
import { prochainNumero, SEQUENCES } from "@/lib/numbering";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import { genererEcriture, validerEcriture, posterEcriture, contrepasserEcriture } from "@/lib/comptabilite/service";

/**
 * Reglements clients et fournisseurs.
 *
 * Un reglement n'est jamais saisi « en l'air » : il est affecte a des factures
 * precises, et l'affectation met a jour le solde de chaque facture et du tiers.
 * La somme affectee ne peut jamais depasser le montant du reglement ni le reste
 * du de chaque facture.
 *
 * Une fois poste, un reglement n'est ni modifie ni supprime : son annulation
 * passe par une contre-passation d'ecriture et une remise en circulation des
 * factures concernees, avec motif obligatoire.
 */

export interface ActeurReglement {
  id: number;
  email: string;
}

const CODES_EVENEMENT: Record<PaymentDirection, string> = {
  ENCAISSEMENT: "REGLEMENT_CLIENT",
  DECAISSEMENT: "REGLEMENT_FOURNISSEUR",
};

const JOURNAUX_TRESORERIE: Record<PaymentMethod, string> = {
  ESPECES: "CA",
  CHEQUE: "BQ",
  VIREMENT: "BQ",
  TRAITE: "BQ",
  CARTE: "BQ",
  COMPENSATION: "OD",
  AUTRE: "OD",
};

export interface AllocationInput {
  invoiceId: number;
  /** Montant affecte. Par defaut : le reste du de la facture, dans la limite du disponible. */
  amount?: Prisma.Decimal | string | number;
}

export interface ReglementInput {
  direction: PaymentDirection;
  thirdPartyId: number;
  method: PaymentMethod;
  amount: Prisma.Decimal | string | number;
  paymentDate?: Date;
  reference?: string | null;
  bankAccount?: string | null;
  notes?: string | null;
  /** Factures a regler. Si omis, l'affectation se fait du plus ancien au plus recent. */
  allocations?: AllocationInput[];
  acteur: ActeurReglement;
}

export interface ResultatReglement {
  paymentId: number;
  numero: string;
  montant: Decimal;
  montantAffecte: Decimal;
  montantNonAffecte: Decimal;
  entryId: number;
  numeroEcriture: string;
  factures: { invoiceId: number; numero: string; affecte: Decimal; soldeRestant: Decimal }[];
}

/**
 * Enregistre un reglement, l'affecte aux factures et genere l'ecriture
 * comptable correspondante. Le tout dans une seule transaction : soit le
 * reglement, l'affectation et la comptabilite sont coherents, soit rien n'est
 * ecrit.
 */
export async function enregistrerReglement(
  entree: ReglementInput,
): Promise<ResultatReglement> {
  const montant = D.roundAmount(entree.amount);
  if (D.lte(montant, 0)) {
    throw validation("Le montant du reglement doit etre strictement positif.");
  }

  return prisma.$transaction(
    async (tx) => {
      const tiers = await tx.thirdParty.findUnique({
        where: { id: entree.thirdPartyId },
        select: { id: true, code: true, label1: true, isClient: true, isSupplier: true },
      });
      if (!tiers) throw nonTrouve("Le tiers");

      if (entree.direction === "ENCAISSEMENT" && !tiers.isClient) {
        throw validation(
          `Le tiers « ${tiers.label1} » n'est pas un client : un encaissement ne peut pas lui etre rattache.`,
        );
      }
      if (entree.direction === "DECAISSEMENT" && !tiers.isSupplier) {
        throw validation(
          `Le tiers « ${tiers.label1} » n'est pas un fournisseur : un decaissement ne peut pas lui etre rattache.`,
        );
      }

      const dateReglement = entree.paymentDate ?? new Date();

      // --- Selection des factures a regler ----------------------------------
      const directionFacture = entree.direction === "ENCAISSEMENT" ? "CLIENT" : "FOURNISSEUR";

      const factures = entree.allocations?.length
        ? await tx.invoice.findMany({
            where: {
              id: { in: entree.allocations.map((a) => a.invoiceId) },
              thirdPartyId: entree.thirdPartyId,
              direction: directionFacture,
            },
            include: { lines: false },
          })
        : await tx.invoice.findMany({
            where: {
              thirdPartyId: entree.thirdPartyId,
              direction: directionFacture,
              status: { in: ["POSTEE", "PARTIELLEMENT_REGLEE", "EN_RETARD", "VALIDEE"] },
            },
            orderBy: [{ dueDate: "asc" }, { invoiceDate: "asc" }],
          });

      if (factures.length === 0) {
        throw etatInvalide(
          entree.allocations?.length
            ? "Aucune facture correspondante n'a ete trouvee pour ce tiers."
            : `Aucune facture ouverte pour « ${tiers.label1} » : le reglement ne peut pas etre affecte.`,
        );
      }

      const facturesParId = new Map(factures.map((facture) => [facture.id, facture]));

      for (const allocation of entree.allocations ?? []) {
        const facture = facturesParId.get(allocation.invoiceId);
        if (!facture) {
          throw validation(
            `La facture ${allocation.invoiceId} n'appartient pas a ce tiers ou n'est pas du bon sens.`,
          );
        }
        if (facture.nature === "AVOIR") {
          // Un avoir ne se regle pas : il vient en deduction. L'affectation d'un
          // avoir a un reglement est refusee explicitement.
          throw validation(
            `La piece ${facture.number} est un avoir : elle vient en deduction et ne peut pas etre reglee.`,
          );
        }
      }

      let disponible = montant;
      const affectations: { invoiceId: number; amount: Decimal }[] = [];

      for (const facture of factures) {
        if (D.lte(disponible, 0)) break;

        const reste = D.sub(D.of(facture.totalTTC), D.of(facture.paidAmount));
        if (D.lte(reste, 0)) continue;

        const demande = entree.allocations?.find((a) => a.invoiceId === facture.id)?.amount;
        const montantSouhaite = demande === undefined ? reste : D.roundAmount(demande);

        if (D.lte(montantSouhaite, 0)) continue;

        if (D.gt(montantSouhaite, reste)) {
          throw validation(
            `Le montant affecte a la facture ${facture.number} (${D.toFixed(montantSouhaite, 2)}) depasse son reste du (${D.toFixed(reste, 2)}).`,
          );
        }
        if (D.gt(montantSouhaite, disponible)) {
          throw validation(
            `Le montant affecte a la facture ${facture.number} (${D.toFixed(montantSouhaite, 2)}) depasse le disponible du reglement (${D.toFixed(disponible, 2)}).`,
          );
        }

        affectations.push({ invoiceId: facture.id, amount: montantSouhaite });
        disponible = D.sub(disponible, montantSouhaite);
      }

      if (affectations.length === 0) {
        throw etatInvalide(
          "Aucune affectation possible : les factures selectionnees sont deja integralement reglees.",
        );
      }

      const montantAffecte = affectations.reduce(
        (total, affectation) => D.add(total, affectation.amount),
        D.ZERO,
      );

      // --- Ecriture du reglement --------------------------------------------
      const numero = await prochainNumero(SEQUENCES.REGLEMENT, tx);
      const journal = await tx.journal.findUnique({
        where: { code: JOURNAUX_TRESORERIE[entree.method] },
        select: { id: true, code: true },
      });

      const reglement = await tx.payment.create({
        data: {
          number: numero,
          direction: entree.direction,
          status: "BROUILLON",
          thirdPartyId: entree.thirdPartyId,
          method: entree.method,
          paymentDate: dateReglement,
          amount: montant,
          allocatedAmount: D.roundAmount(montantAffecte),
          currency: "DZD",
          reference: entree.reference ?? null,
          bankAccount: entree.bankAccount ?? null,
          journalId: journal?.id ?? null,
          notes: entree.notes ?? null,
          createdById: entree.acteur.id,
        },
      });

      // --- Affectation et mise a jour des factures --------------------------
      const detailFactures: ResultatReglement["factures"] = [];

      for (const affectation of affectations) {
        const facture = facturesParId.get(affectation.invoiceId)!;

        await tx.paymentAllocation.create({
          data: {
            paymentId: reglement.id,
            invoiceId: facture.id,
            amount: affectation.amount,
          },
        });

        const nouveauRegle = D.add(D.of(facture.paidAmount), affectation.amount);
        const nouveauSolde = D.roundAmount(D.sub(D.of(facture.totalTTC), nouveauRegle));
        const integralementReglee = D.lte(nouveauSolde, 0);

        await tx.invoice.update({
          where: { id: facture.id },
          data: {
            paidAmount: D.roundAmount(nouveauRegle),
            balance: nouveauSolde,
            status: integralementReglee
              ? "REGLEE"
              : facture.status === "VALIDEE"
                ? "PARTIELLEMENT_REGLEE"
                : "PARTIELLEMENT_REGLEE",
          },
        });

        detailFactures.push({
          invoiceId: facture.id,
          numero: facture.number,
          affecte: affectation.amount,
          soldeRestant: nouveauSolde,
        });
      }

      // --- Ecriture comptable -----------------------------------------------
      const sensComptable = entree.direction === "ENCAISSEMENT" ? 1 : -1;
      void sensComptable;

      const ecriture = await genererEcriture(tx, {
        eventCode: CODES_EVENEMENT[entree.direction],
        entryDate: dateReglement,
        label: `${entree.direction === "ENCAISSEMENT" ? "Encaissement" : "Reglement"} ${numero} - ${tiers.label1}`,
        reference: entree.reference ?? numero,
        documentType: "REGLEMENT",
        documentId: String(reglement.id),
        montantHT: montantAffecte,
        montantTVA: 0,
        montantTTC: montantAffecte,
        thirdPartyId: entree.thirdPartyId,
        paymentId: reglement.id,
        acteur: entree.acteur,
      });

      await tx.payment.update({
        where: { id: reglement.id },
        data: { status: "VALIDE" },
      });

      await tx.payment.update({
        where: { id: reglement.id },
        data: { status: "POSTE", postedAt: new Date() },
      });

      await validerEcriture(ecriture.entryId, entree.acteur);
      await posterEcriture(ecriture.entryId, entree.acteur);

      await majSoldeTiers(tx, entree.thirdPartyId);

      const montantNonAffecte = D.roundAmount(D.sub(montant, montantAffecte));
      if (D.gt(montantNonAffecte, 0)) {
        // Une avance non affectee est signalee : elle reste dans le solde du
        // tiers et devra etre affectee ulterieurement.
        await tx.payment.update({
          where: { id: reglement.id },
          data: {
            notes: `${entree.notes ?? ""}\nAvance non affectee : ${D.toFixed(montantNonAffecte, 2)} DZD.`.trim(),
          },
        });
      }

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.REGLEMENT,
          module: MODULES_AUDIT.FINANCE,
          entity: "Payment",
          entityId: reglement.id,
          userId: entree.acteur.id,
          userEmail: entree.acteur.email,
          newValue: {
            numero,
            sens: entree.direction,
            tiers: tiers.label1,
            mode: entree.method,
            montant: D.toFixed(montant, 2),
            affecte: D.toFixed(montantAffecte, 2),
            nonAffecte: D.toFixed(montantNonAffecte, 2),
            factures: detailFactures.map(
              (facture) => `${facture.numero} : ${D.toFixed(facture.affecte, 2)}`,
            ),
            ecriture: ecriture.numero,
          },
          comment: entree.reference ?? null,
        },
        tx,
      );

      return {
        paymentId: reglement.id,
        numero,
        montant,
        montantAffecte,
        montantNonAffecte,
        entryId: ecriture.entryId,
        numeroEcriture: ecriture.numero,
        factures: detailFactures,
      };
    },
    { timeout: 60_000 },
  );
}

/**
 * Annulation d'un reglement poste : contre-passation de l'ecriture et remise en
 * circulation des factures. Aucun enregistrement n'est supprime.
 */
export async function annulerReglement(
  entree: { paymentId: number; motif: string; entryDate?: Date },
  acteur: ActeurReglement,
): Promise<{ numeroContrePassation: string }> {
  if (!entree.motif || entree.motif.trim().length < 10) {
    throw validation(
      "Le motif d'annulation du reglement est obligatoire et doit etre explicite (au moins 10 caracteres).",
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const reglement = await tx.payment.findUnique({
        where: { id: entree.paymentId },
        include: { allocations: { include: { invoice: true } } },
      });
      if (!reglement) throw nonTrouve("Le reglement");
      if (reglement.status === "ANNULE") {
        throw conflit("Ce reglement est deja annule.");
      }

      // Remise en circulation des factures concernees.
      for (const allocation of reglement.allocations) {
        const facture = allocation.invoice;
        const nouveauRegle = D.sub(D.of(facture.paidAmount), D.of(allocation.amount));
        const nouveauSolde = D.roundAmount(D.sub(D.of(facture.totalTTC), nouveauRegle));

        await tx.invoice.update({
          where: { id: facture.id },
          data: {
            paidAmount: D.roundAmount(D.max(D.ZERO, nouveauRegle)),
            balance: nouveauSolde,
            status: D.lte(nouveauSolde, 0) ? "REGLEE" : "PARTIELLEMENT_REGLEE",
          },
        });
      }

      const ecritureOrigine = await tx.accountingEntry.findFirst({
        where: {
          paymentId: reglement.id,
          isReversal: false,
          status: { in: ["POSTEE", "VALIDEE"] },
        },
      });

      let numeroContrePassation = "";

      if (ecritureOrigine) {
        const contrePassation = await contrepasserEcriture(
          {
            entryId: ecritureOrigine.id,
            motif: entree.motif,
            entryDate: entree.entryDate,
          },
          acteur,
        );
        numeroContrePassation = contrePassation.numero;
      }

      await tx.paymentAllocation.deleteMany({ where: { paymentId: reglement.id } });

      await tx.payment.update({
        where: { id: reglement.id },
        data: {
          status: "ANNULE",
          cancelledAt: new Date(),
          cancelReason: entree.motif,
          allocatedAmount: D.ZERO,
        },
      });

      await majSoldeTiers(tx, reglement.thirdPartyId);

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.ANNULATION,
          module: MODULES_AUDIT.FINANCE,
          entity: "Payment",
          entityId: reglement.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: {
            numero: reglement.number,
            statut: reglement.status,
            montant: reglement.amount.toFixed(2),
          },
          newValue: {
            statut: "ANNULE",
            contrePassation: numeroContrePassation || null,
            facturesLiberees: reglement.allocations.length,
          },
          comment: entree.motif,
        },
        tx,
      );

      return { numeroContrePassation };
    },
    { timeout: 60_000 },
  );
}

/**
 * Recalcule le solde d'un tiers a partir de ses factures et reglements.
 * Le solde n'est jamais incremente a l'aveugle : il est toujours recalcule.
 */
export async function majSoldeTiers(tx: Db, thirdPartyId: number): Promise<Decimal> {
  const factures = await tx.invoice.aggregate({
    where: {
      thirdPartyId,
      status: { notIn: ["BROUILLON", "ANNULEE"] },
    },
    _sum: { totalTTC: true, paidAmount: true },
  });

  const totalFacture = D.of(factures._sum.totalTTC ?? 0);
  const totalRegle = D.of(factures._sum.paidAmount ?? 0);
  const solde = D.roundAmount(D.sub(totalFacture, totalRegle));

  await tx.thirdParty.update({
    where: { id: thirdPartyId },
    data: { balance: solde },
  });

  return solde;
}

// -----------------------------------------------------------------------------
// Avoirs
// -----------------------------------------------------------------------------

export interface AvoirInput {
  invoiceId: number;
  /** Montant HT de l'avoir. */
  montantHT: Prisma.Decimal | string | number;
  montantTVA?: Prisma.Decimal | string | number;
  motif: string;
  invoiceDate?: Date;
  lines?: {
    itemId?: number | null;
    description: string;
    quantity: Prisma.Decimal | string | number;
    unitPrice: Prisma.Decimal | string | number;
    vatRate?: Prisma.Decimal | string | number;
  }[];
  acteur: ActeurReglement;
}

/**
 * Creation d'un avoir sur facture. L'avoir ne supprime jamais la facture
 * d'origine : il s'y rattache et le solde du tiers est recalcule.
 */
export async function creerAvoir(
  entree: AvoirInput,
): Promise<{ invoiceId: number; numero: string; totalTTC: Decimal }> {
  if (!entree.motif || entree.motif.trim().length < 5) {
    throw validation("Le motif de l'avoir est obligatoire.");
  }

  const montantHT = D.roundAmount(entree.montantHT);
  if (D.lte(montantHT, 0)) {
    throw validation("Le montant HT de l'avoir doit etre strictement positif.");
  }

  return prisma.$transaction(
    async (tx) => {
      const origine = await tx.invoice.findUnique({
        where: { id: entree.invoiceId },
        include: { thirdParty: { select: { id: true, label1: true } } },
      });
      if (!origine) throw nonTrouve("La facture d'origine");
      if (origine.nature === "AVOIR") {
        throw validation("Un avoir ne peut pas etre etabli sur un autre avoir.");
      }
      if (origine.status === "ANNULEE") {
        throw etatInvalide("La facture d'origine est annulee : aucun avoir ne peut y etre rattache.");
      }

      const montantTVA = D.roundAmount(entree.montantTVA ?? 0);
      const totalTTC = D.roundAmount(D.add(montantHT, montantTVA));

      const dejaAvoir = await tx.invoice.aggregate({
        where: { originalInvoiceId: origine.id, nature: "AVOIR", status: { not: "ANNULEE" } },
        _sum: { totalTTC: true },
      });
      const totalAvoirs = D.of(dejaAvoir._sum.totalTTC ?? 0);

      if (D.gt(D.add(totalAvoirs, totalTTC), D.of(origine.totalTTC))) {
        throw validation(
          `Le cumul des avoirs (${D.toFixed(D.add(totalAvoirs, totalTTC), 2)}) depasserait le montant de la facture ${origine.number} (${D.toFixed(origine.totalTTC, 2)}).`,
        );
      }

      const nature: InvoiceNature = "AVOIR";
      const numero = await prochainNumero(
        origine.direction === "CLIENT" ? SEQUENCES.AVOIR_CLIENT : SEQUENCES.AVOIR_FOURNISSEUR,
        tx,
      );

      const avoir = await tx.invoice.create({
        data: {
          number: numero,
          direction: origine.direction,
          nature,
          status: "BROUILLON",
          thirdPartyId: origine.thirdPartyId,
          orderId: origine.orderId,
          invoiceDate: entree.invoiceDate ?? new Date(),
          currency: origine.currency,
          subtotalHT: montantHT,
          vatAmount: montantTVA,
          totalTTC,
          balance: D.neg(totalTTC),
          paymentTermsDays: 0,
          reference: origine.number,
          notes: entree.motif,
          originalInvoiceId: origine.id,
          createdById: entree.acteur.id,
        },
      });

      const lignes = entree.lines ?? [
        {
          description: `Avoir sur facture ${origine.number}`,
          quantity: 1,
          unitPrice: montantHT,
          vatRate: D.gt(montantTVA, 0) && D.gt(montantHT, 0)
            ? D.round(D.mul(D.div(montantTVA, montantHT), D.CENT), 4)
            : 0,
        },
      ];

      let index = 1;
      for (const ligne of lignes) {
        const quantite = D.roundQuantity(ligne.quantity);
        const prixUnitaire = D.roundAmount(ligne.unitPrice);
        const tauxTva = D.round(D.of(ligne.vatRate ?? 0), 4);
        const ligneHT = D.roundAmount(D.mul(quantite, prixUnitaire));
        const ligneTVA = D.roundAmount(D.mul(ligneHT, D.div(tauxTva, D.CENT)));

        await tx.invoiceLine.create({
          data: {
            invoiceId: avoir.id,
            lineNo: index,
            itemId: ligne.itemId ?? null,
            description: ligne.description,
            quantity: quantite,
            unitPrice: prixUnitaire,
            vatRate: tauxTva,
            lineHT: ligneHT,
            lineVAT: ligneTVA,
            lineTTC: D.roundAmount(D.add(ligneHT, ligneTVA)),
          },
        });
        index += 1;
      }

      await majSoldeTiers(tx, origine.thirdPartyId);

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.FINANCE,
          entity: "Invoice",
          entityId: avoir.id,
          userId: entree.acteur.id,
          userEmail: entree.acteur.email,
          newValue: {
            numero,
            nature: "AVOIR",
            factureOrigine: origine.number,
            tiers: origine.thirdParty.label1,
            totalTTC: D.toFixed(totalTTC, 2),
            motif: entree.motif,
          },
          comment: entree.motif,
        },
        tx,
      );

      return { invoiceId: avoir.id, numero, totalTTC };
    },
    { timeout: 60_000 },
  );
}

/** Etat des reglements d'un tiers : factures ouvertes et avances disponibles. */
export async function etatReglementsTiers(thirdPartyId: number) {
  const tiers = await prisma.thirdParty.findUnique({
    where: { id: thirdPartyId },
    select: {
      id: true,
      code: true,
      label1: true,
      isClient: true,
      isSupplier: true,
      balance: true,
      deadlineDays: true,
      paymentMethod: true,
    },
  });
  if (!tiers) throw nonTrouve("Le tiers");

  const factures = await prisma.invoice.findMany({
    where: {
      thirdPartyId,
      status: { in: ["POSTEE", "PARTIELLEMENT_REGLEE", "EN_RETARD", "VALIDEE"] },
    },
    orderBy: [{ dueDate: "asc" }, { invoiceDate: "asc" }],
    select: {
      id: true,
      number: true,
      direction: true,
      nature: true,
      invoiceDate: true,
      dueDate: true,
      totalTTC: true,
      paidAmount: true,
      balance: true,
      status: true,
    },
  });

  const enRetard = factures.filter(
    (facture) =>
      facture.dueDate !== null &&
      facture.dueDate.getTime() < Date.now() &&
      D.gt(D.of(facture.balance), 0),
  );

  return {
    tiers,
    factures,
    totalOuvert: D.roundAmount(
      factures.reduce((total, facture) => D.add(total, D.of(facture.balance)), D.ZERO),
    ),
    facturesEnRetard: enRetard,
  };
}

/** Passe en « en retard » les factures echues non reglees. */
export async function actualiserFacturesEnRetard(): Promise<number> {
  const maintenant = new Date();
  const resultat = await prisma.invoice.updateMany({
    where: {
      dueDate: { lt: maintenant },
      status: { in: ["POSTEE", "PARTIELLEMENT_REGLEE"] },
      balance: { gt: 0 },
    },
    data: { status: "EN_RETARD" },
  });

  return resultat.count;
}

export async function listerReglements(filtres: {
  direction?: PaymentDirection;
  thirdPartyId?: number;
  dateDebut?: Date;
  dateFin?: Date;
  page?: number;
  taille?: number;
}) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(200, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.PaymentWhereInput = {};
  if (filtres.direction) where.direction = filtres.direction;
  if (filtres.thirdPartyId) where.thirdPartyId = filtres.thirdPartyId;
  if (filtres.dateDebut || filtres.dateFin) {
    where.paymentDate = {};
    if (filtres.dateDebut) where.paymentDate.gte = filtres.dateDebut;
    if (filtres.dateFin) where.paymentDate.lte = filtres.dateFin;
  }

  const [total, lignes] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: { paymentDate: "desc" },
      skip: (page - 1) * taille,
      take: taille,
      include: {
        thirdParty: { select: { code: true, label1: true } },
        journal: { select: { code: true, label: true } },
        allocations: {
          include: { invoice: { select: { number: true, nature: true } } },
        },
      },
    }),
  ]);

  return { lignes, total, page, taille, pages: Math.max(1, Math.ceil(total / taille)) };
}
