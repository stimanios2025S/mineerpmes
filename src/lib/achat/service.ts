import type {
  Prisma,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
  ReceiptStatus,
} from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D, type Decimal } from "@/lib/decimal";
import { conflit, etatInvalide, nonTrouve, validation } from "@/lib/errors";
import { prochainNumero, SEQUENCES } from "@/lib/numbering";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import { lireParametreBooleen, CLE_PARAMETRE } from "@/lib/settings";
import { enregistrerMouvement, type ActeurStock } from "@/lib/stock/service";
import { calculerLigne, resoudreTauxTva } from "@/lib/commercial/taxe";
import {
  genererEcriture,
  posterEcriture,
  validerEcriture,
} from "@/lib/comptabilite/service";
import {
  creerAvoir,
  enregistrerReglement,
  majSoldeTiers,
} from "@/lib/comptabilite/reglement";

/**
 * Cycle achats complet :
 *   Demande d'achat -> Demande de prix -> Bon de commande fournisseur ->
 *   Reception fournisseur -> Controle qualite -> Facture fournisseur ->
 *   Reglement fournisseur.
 *
 * Points de rigueur :
 *  - une reception partielle est la norme, pas l'exception : les quantites
 *    recues sont cumulees par ligne de commande et le statut de la commande
 *    suit automatiquement ;
 *  - la marchandise entre en quarantaine des lors que le controle qualite est
 *    requis : elle n'est pas disponible pour la production avant decision ;
 *  - la facture fournisseur est rapprochee trois voies (commande / reception /
 *    facture) et tout ecart est enregistre, jamais corrige en silence ;
 *  - toute ecriture comptable provient des regles configurables, jamais d'un
 *    numero de compte code en dur.
 */

export interface ActeurAchat extends ActeurStock {}

// -----------------------------------------------------------------------------
// Utilitaires internes
// -----------------------------------------------------------------------------

/** Un mouvement ou une fiche d'atelier doit etre rattache a une personne reelle. */
async function employeDeLUtilisateur(tx: Db, userId: number): Promise<number | null> {
  const employe = await tx.employee.findUnique({
    where: { userId },
    select: { id: true },
  });
  return employe?.id ?? null;
}

/**
 * Determine le taux de TVA d'une ligne : code explicite, sinon taux de
 * l'article, sinon taux par defaut parametre. Aucun taux n'est code en dur.
 */

/** Cree ou retrouve un lot pour un article dans un depot. */
export async function resoudreLot(
  tx: Db,
  entree: {
    itemId: number;
    warehouseId: number;
    lotNumber: string | null;
    locationId?: number | null;
    supplierId?: number | null;
    manufactureDate?: Date | null;
    expirationDate?: Date | null;
    sourceDocument?: string | null;
  },
): Promise<number | null> {
  if (!entree.lotNumber) return null;

  const existant = await tx.stockLot.findUnique({
    where: {
      itemId_warehouseId_lotNumber: {
        itemId: entree.itemId,
        warehouseId: entree.warehouseId,
        lotNumber: entree.lotNumber,
      },
    },
    select: { id: true },
  });
  if (existant) return existant.id;

  const lot = await tx.stockLot.create({
    data: {
      lotNumber: entree.lotNumber,
      itemId: entree.itemId,
      warehouseId: entree.warehouseId,
      locationId: entree.locationId ?? null,
      manufactureDate: entree.manufactureDate ?? null,
      expirationDate: entree.expirationDate ?? null,
      receivedAt: new Date(),
      supplierId: entree.supplierId ?? null,
      status: "LIBRE",
      sourceCode: entree.sourceDocument ?? null,
      sourceSystem: "ERPMES",
    },
  });
  return lot.id;
}

// -----------------------------------------------------------------------------
// 1. Demande d'achat
// -----------------------------------------------------------------------------

export interface LigneDemandeAchatInput {
  itemId: number;
  quantity: Prisma.Decimal | string | number;
  unitCode?: string | null;
  neededBy?: Date | null;
  estimatedPrice?: Prisma.Decimal | string | number;
  notes?: string | null;
}

export interface DemandeAchatInput {
  supplierId?: number | null;
  neededBy?: Date | null;
  justification?: string | null;
  notes?: string | null;
  lines: LigneDemandeAchatInput[];
}

export async function creerDemandeAchat(
  entree: DemandeAchatInput,
  acteur: ActeurAchat,
): Promise<{ requestId: number; numero: string }> {
  if (entree.lines.length === 0) {
    throw validation("Une demande d'achat doit comporter au moins une ligne.");
  }
  if (!entree.justification || entree.justification.trim().length < 5) {
    throw validation("Le motif de la demande d'achat est obligatoire.");
  }

  return prisma.$transaction(
    async (tx) => {
      if (entree.supplierId) {
        const tiers = await tx.thirdParty.findUnique({
          where: { id: entree.supplierId },
          select: { isSupplier: true },
        });
        if (!tiers) throw nonTrouve("Le fournisseur");
        if (!tiers.isSupplier) {
          throw validation("Le tiers selectionne n'est pas enregistre comme fournisseur.");
        }
      }

      const numero = await prochainNumero(SEQUENCES.DEMANDE_ACHAT, tx);

      const demande = await tx.purchaseRequest.create({
        data: {
          number: numero,
          status: "BROUILLON",
          supplierId: entree.supplierId ?? null,
          requesterId: acteur.id,
          requestedAt: new Date(),
          neededBy: entree.neededBy ?? null,
          justification: entree.justification,
          notes: entree.notes ?? null,
        },
      });

      let index = 1;
      for (const ligne of entree.lines) {
        const quantite = D.roundQuantity(ligne.quantity);
        if (D.lte(quantite, 0)) {
          throw validation(
            `Ligne ${index} : la quantite demandee doit etre strictement positive.`,
          );
        }

        const article = await tx.item.findUnique({
          where: { id: ligne.itemId },
          select: { id: true, code: true, label1: true, isPurchasable: true, unitCode: true, status: true },
        });
        if (!article) throw nonTrouve(`L'article de la ligne ${index}`);
        if (article.status !== "ACTIF") {
          throw etatInvalide(
            `L'article « ${article.code} » est au statut ${article.status} : il ne peut pas etre commande.`,
          );
        }
        if (!article.isPurchasable) {
          throw etatInvalide(
            `L'article « ${article.code} » n'est pas marque comme achetable. Activez cette propriete sur sa fiche si l'achat est legitime.`,
          );
        }

        await tx.purchaseRequestLine.create({
          data: {
            requestId: demande.id,
            lineNo: index,
            itemId: ligne.itemId,
            quantity: quantite,
            unitCode: ligne.unitCode ?? article.unitCode ?? null,
            neededBy: ligne.neededBy ?? entree.neededBy ?? null,
            estimatedPrice: D.roundAmount(ligne.estimatedPrice ?? 0),
            notes: ligne.notes ?? null,
          },
        });
        index += 1;
      }

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.ACHAT,
          entity: "PurchaseRequest",
          entityId: demande.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: {
            numero,
            lignes: entree.lines.length,
            motif: entree.justification,
            fournisseurSuggere: entree.supplierId ?? null,
          },
        },
        tx,
      );

      return { requestId: demande.id, numero };
    },
    { timeout: 60_000 },
  );
}

export async function soumettreDemandeAchat(
  requestId: number,
  acteur: ActeurAchat,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const demande = await tx.purchaseRequest.findUnique({
        where: { id: requestId },
        include: { _count: { select: { lines: true } } },
      });
      if (!demande) throw nonTrouve("La demande d'achat");
      if (demande.status !== "BROUILLON") {
        throw conflit(`Cette demande est au statut ${demande.status} : elle a deja ete soumise.`);
      }
      if (demande._count.lines === 0) {
        throw etatInvalide("Une demande d'achat sans ligne ne peut pas etre soumise.");
      }

      await tx.purchaseRequest.update({
        where: { id: requestId },
        data: { status: "SOUMISE" },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.ACHAT,
          entity: "PurchaseRequest",
          entityId: requestId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: "BROUILLON" },
          newValue: { statut: "SOUMISE" },
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

export async function approuverDemandeAchat(
  requestId: number,
  acteur: ActeurAchat,
  commentaire?: string,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const demande = await tx.purchaseRequest.findUnique({ where: { id: requestId } });
      if (!demande) throw nonTrouve("La demande d'achat");
      if (demande.status === "APPROUVEE") throw conflit("Cette demande est deja approuvee.");
      if (demande.status === "ANNULEE" || demande.status === "REFUSEE") {
        throw etatInvalide(`Cette demande est au statut ${demande.status}.`);
      }

      // Separation des taches : le demandeur ne peut pas approuver sa propre
      // demande. Cette regle est appliquee dans le service, pas seulement
      // masquee dans l'interface.
      if (demande.requesterId === acteur.id) {
        throw validation(
          "Le demandeur ne peut pas approuver sa propre demande d'achat : une seconde validation est necessaire.",
        );
      }

      await tx.purchaseRequest.update({
        where: { id: requestId },
        data: { status: "APPROUVEE", approvedById: acteur.id, approvedAt: new Date() },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.APPROBATION,
          module: MODULES_AUDIT.ACHAT,
          entity: "PurchaseRequest",
          entityId: requestId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: demande.status },
          newValue: { statut: "APPROUVEE" },
          comment: commentaire ?? null,
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

export async function refuserDemandeAchat(
  requestId: number,
  motif: string,
  acteur: ActeurAchat,
): Promise<void> {
  if (!motif || motif.trim().length < 5) {
    throw validation("Le motif de refus est obligatoire.");
  }

  await prisma.$transaction(
    async (tx) => {
      const demande = await tx.purchaseRequest.findUnique({ where: { id: requestId } });
      if (!demande) throw nonTrouve("La demande d'achat");
      if (demande.status === "APPROUVEE") {
        throw conflit("Cette demande est deja approuvee : elle ne peut plus etre refusee.");
      }

      await tx.purchaseRequest.update({
        where: { id: requestId },
        data: { status: "REFUSEE", notes: motif },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.ANNULATION,
          module: MODULES_AUDIT.ACHAT,
          entity: "PurchaseRequest",
          entityId: requestId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: demande.status },
          newValue: { statut: "REFUSEE" },
          comment: motif,
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

/**
 * Demande de prix : comparaison des tarifs fournisseurs declares pour un
 * article. Aucun prix n'est suppose : seules les offres reellement saisies
 * sont comparees, et l'ecart avec le dernier prix d'achat est signale.
 */
export async function comparerPrixFournisseurs(itemId: number) {
  const article = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, code: true, label1: true, unitCode: true, vwap: true },
  });
  if (!article) throw nonTrouve("L'article");

  const offres = await prisma.itemSupplierPrice.findMany({
    where: {
      itemId,
      OR: [{ validTo: null }, { validTo: { gte: new Date() } }],
    },
    include: {
      supplier: {
        select: { id: true, code: true, label1: true, deadlineDays: true, paymentMethod: true },
      },
    },
    orderBy: { price: "asc" },
  });

  const meilleureOffre = offres[0] ?? null;
  const dernierPrix = D.of(article.vwap);

  return {
    article,
    offres: offres.map((offre) => ({
      ...offre,
      ecartPourcent:
        D.gt(dernierPrix, 0)
          ? D.round(
              D.mul(D.div(D.sub(D.of(offre.price), dernierPrix), dernierPrix), D.CENT),
              2,
            )
          : null,
    })),
    meilleureOffre,
  };
}

export async function enregistrerPrixFournisseur(
  entree: {
    itemId: number;
    supplierId: number;
    prix: Prisma.Decimal | string | number;
    supplierRef?: string | null;
    leadTimeDays?: number;
    minQuantity?: Prisma.Decimal | string | number;
    validFrom?: Date | null;
    validTo?: Date | null;
    isPreferred?: boolean;
  },
  acteur: ActeurAchat,
): Promise<number> {
  const prix = D.roundAmount(entree.prix);
  if (D.lte(prix, 0)) throw validation("Le prix propose doit etre strictement positif.");

  return prisma.$transaction(
    async (tx) => {
      const tiers = await tx.thirdParty.findUnique({
        where: { id: entree.supplierId },
        select: { isSupplier: true, label1: true },
      });
      if (!tiers) throw nonTrouve("Le fournisseur");
      if (!tiers.isSupplier) throw validation("Le tiers indique n'est pas un fournisseur.");

      const tarif = await tx.itemSupplierPrice.create({
        data: {
          itemId: entree.itemId,
          supplierId: entree.supplierId,
          price: prix,
          supplierRef: entree.supplierRef ?? null,
          leadTimeDays: entree.leadTimeDays ?? 0,
          minQuantity: D.roundQuantity(entree.minQuantity ?? 0),
          validFrom: entree.validFrom ?? new Date(),
          validTo: entree.validTo ?? null,
          isPreferred: entree.isPreferred ?? false,
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.ACHAT,
          entity: "ItemSupplierPrice",
          entityId: tarif.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: {
            article: entree.itemId,
            fournisseur: tiers.label1,
            prix: D.toFixed(prix, 2),
            delaiJours: entree.leadTimeDays ?? 0,
          },
        },
        tx,
      );

      return tarif.id;
    },
    { timeout: 30_000 },
  );
}

// -----------------------------------------------------------------------------
// 2. Bon de commande fournisseur
// -----------------------------------------------------------------------------

export interface LigneCommandeFournisseurInput {
  itemId: number;
  description?: string | null;
  quantity: Prisma.Decimal | string | number;
  unitCode?: string | null;
  unitPrice: Prisma.Decimal | string | number;
  discountRate?: Prisma.Decimal | string | number;
  vatRateCode?: string | null;
  expectedDate?: Date | null;
}

export interface CommandeFournisseurInput {
  supplierId: number;
  requestId?: number | null;
  lines: LigneCommandeFournisseurInput[];
  orderDate?: Date;
  expectedDate?: Date | null;
  discountRate?: Prisma.Decimal | string | number;
  paymentTermsDays?: number;
  deliveryAddress?: string | null;
  currency?: string;
  notes?: string | null;
  /** Reprend automatiquement les lignes d'une demande d'achat approuvee. */
  depuisDemande?: boolean;
}

export async function creerCommandeFournisseur(
  entree: CommandeFournisseurInput,
  acteur: ActeurAchat,
): Promise<{ orderId: number; numero: string; totalTTC: Decimal }> {
  return prisma.$transaction(
    async (tx) => {
      const fournisseur = await tx.thirdParty.findUnique({
        where: { id: entree.supplierId },
        select: { id: true, code: true, label1: true, isSupplier: true, deadlineDays: true, paymentMethod: true },
      });
      if (!fournisseur) throw nonTrouve("Le fournisseur");
      if (!fournisseur.isSupplier) {
        throw validation(
          `Le tiers « ${fournisseur.label1} » n'est pas enregistre comme fournisseur.`,
        );
      }

      let lignes = entree.lines;
      let requestId = entree.requestId ?? null;

      if (entree.depuisDemande) {
        if (!requestId) {
          throw validation("Precisez la demande d'achat a convertir.");
        }
        const demande = await tx.purchaseRequest.findUnique({
          where: { id: requestId },
          include: { lines: { orderBy: { lineNo: "asc" } } },
        });
        if (!demande) throw nonTrouve("La demande d'achat");
        if (demande.status !== "APPROUVEE") {
          throw etatInvalide(
            `La demande ${demande.number} est au statut ${demande.status} : seules les demandes approuvees peuvent etre converties en commande.`,
          );
        }
        if (demande.lines.length === 0) {
          throw etatInvalide(`La demande ${demande.number} ne comporte aucune ligne.`);
        }

        lignes = demande.lines.map((ligne) => ({
          itemId: ligne.itemId,
          quantity: ligne.quantity,
          unitCode: ligne.unitCode,
          unitPrice: ligne.estimatedPrice,
          discountRate: 0,
          vatRateCode: null,
          expectedDate: ligne.neededBy,
          description: ligne.notes,
        }));
      }

      if (lignes.length === 0) {
        throw validation("Un bon de commande doit comporter au moins une ligne.");
      }

      const tauxRemiseGlobal = D.round(D.of(entree.discountRate ?? 0), 4);
      if (D.gte(tauxRemiseGlobal, D.CENT)) {
        throw validation("Le taux de remise global doit etre inferieur a 100 %.");
      }

      const numero = await prochainNumero(SEQUENCES.COMMANDE_FOURNISSEUR, tx);
      const dateCommande = entree.orderDate ?? new Date();

      const commande = await tx.purchaseOrder.create({
        data: {
          number: numero,
          status: "BROUILLON",
          supplierId: entree.supplierId,
          orderDate: dateCommande,
          expectedDate: entree.expectedDate ?? null,
          requestId,
          currency: entree.currency ?? "DZD",
          discountRate: tauxRemiseGlobal,
          paymentTermsDays: entree.paymentTermsDays ?? fournisseur.deadlineDays ?? 0,
          deliveryAddress: entree.deliveryAddress ?? null,
          notes: entree.notes ?? null,
          createdById: acteur.id,
        },
      });

      let index = 1;
      let sousTotal = D.ZERO;
      let totalTva = D.ZERO;
      let totalRemiseLignes = D.ZERO;

      for (const ligne of lignes) {
        const quantite = D.roundQuantity(ligne.quantity);
        if (D.lte(quantite, 0)) {
          throw validation(`Ligne ${index} : la quantite commandee doit etre strictement positive.`);
        }
        const prixUnitaire = D.roundAmount(ligne.unitPrice);
        if (D.lt(prixUnitaire, 0)) {
          throw validation(`Ligne ${index} : le prix unitaire ne peut pas etre negatif.`);
        }

        const article = await tx.item.findUnique({
          where: { id: ligne.itemId },
          select: { id: true, code: true, unitCode: true, status: true, isPurchasable: true },
        });
        if (!article) throw nonTrouve(`L'article de la ligne ${index}`);
        if (article.status !== "ACTIF") {
          throw etatInvalide(
            `L'article « ${article.code} » est au statut ${article.status} : commande refusee.`,
          );
        }

        const tauxTva = await resoudreTauxTva(tx, {
          vatRateCode: ligne.vatRateCode ?? null,
          itemId: ligne.itemId,
        });

        const calcul = calculerLigne(
          quantite,
          prixUnitaire,
          D.round(D.of(ligne.discountRate ?? 0), 4),
          tauxTva.taux,
        );

        await tx.purchaseOrderLine.create({
          data: {
            orderId: commande.id,
            lineNo: index,
            itemId: ligne.itemId,
            description: ligne.description ?? null,
            quantity: quantite,
            unitCode: ligne.unitCode ?? article.unitCode ?? null,
            unitPrice: prixUnitaire,
            discountRate: D.round(D.of(ligne.discountRate ?? 0), 4),
            vatRateCode: tauxTva.code,
            vatRate: D.round(tauxTva.taux, 4),
            lineHT: calcul.ht,
            lineVAT: calcul.tva,
            lineTTC: calcul.ttc,
            expectedDate: ligne.expectedDate ?? entree.expectedDate ?? null,
          },
        });

        sousTotal = D.add(sousTotal, D.add(calcul.ht, calcul.remise));
        totalRemiseLignes = D.add(totalRemiseLignes, calcul.remise);
        totalTva = D.add(totalTva, calcul.tva);
        index += 1;
      }

      const sousTotalArrondi = D.roundAmount(sousTotal);
      const remiseGlobale = D.roundAmount(
        D.mul(D.sub(sousTotalArrondi, totalRemiseLignes), D.div(tauxRemiseGlobal, D.CENT)),
      );
      const baseHT = D.roundAmount(D.sub(D.sub(sousTotalArrondi, totalRemiseLignes), remiseGlobale));
      const tvaAjustee = D.roundAmount(
        D.sub(totalTva, D.mul(totalTva, D.div(tauxRemiseGlobal, D.CENT))),
      );

      await tx.purchaseOrder.update({
        where: { id: commande.id },
        data: {
          subtotalHT: baseHT,
          discountAmount: D.roundAmount(D.add(totalRemiseLignes, remiseGlobale)),
          vatAmount: tvaAjustee,
          totalTTC: D.roundAmount(D.add(baseHT, tvaAjustee)),
        },
      });

      if (requestId) {
        await tx.purchaseRequest.update({
          where: { id: requestId },
          data: { status: "CONVERTIE" },
        });
      }

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.ACHAT,
          entity: "PurchaseOrder",
          entityId: commande.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: {
            numero,
            fournisseur: fournisseur.label1,
            lignes: lignes.length,
            totalHT: D.toFixed(baseHT, 2),
            totalTTC: D.toFixed(D.add(baseHT, tvaAjustee), 2),
            demandeOrigine: requestId,
          },
        },
        tx,
      );

      return {
        orderId: commande.id,
        numero,
        totalTTC: D.roundAmount(D.add(baseHT, tvaAjustee)),
      };
    },
    { timeout: 60_000 },
  );
}

export async function approuverCommandeFournisseur(
  orderId: number,
  acteur: ActeurAchat,
  commentaire?: string,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const commande = await tx.purchaseOrder.findUnique({
        where: { id: orderId },
        include: { _count: { select: { lines: true } } },
      });
      if (!commande) throw nonTrouve("Le bon de commande");
      if (commande.status !== "BROUILLON" && commande.status !== "SOUMIS") {
        throw conflit(`Ce bon de commande est au statut ${commande.status}.`);
      }
      if (commande._count.lines === 0) {
        throw etatInvalide("Un bon de commande sans ligne ne peut pas etre approuve.");
      }

      if (commande.createdById === acteur.id) {
        throw validation(
          "Le createur du bon de commande ne peut pas l'approuver lui-meme : une seconde validation est necessaire.",
        );
      }

      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: { status: "APPROUVE", approvedById: acteur.id, approvedAt: new Date() },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.APPROBATION,
          module: MODULES_AUDIT.ACHAT,
          entity: "PurchaseOrder",
          entityId: orderId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: commande.status },
          newValue: { statut: "APPROUVE", totalTTC: commande.totalTTC.toFixed(2) },
          comment: commentaire ?? null,
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

export async function annulerCommandeFournisseur(
  orderId: number,
  motif: string,
  acteur: ActeurAchat,
): Promise<void> {
  if (!motif || motif.trim().length < 5) {
    throw validation("Le motif d'annulation est obligatoire.");
  }

  await prisma.$transaction(
    async (tx) => {
      const commande = await tx.purchaseOrder.findUnique({
        where: { id: orderId },
        include: { receipts: { where: { status: { not: "ANNULE" } } } },
      });
      if (!commande) throw nonTrouve("Le bon de commande");
      if (commande.status === "ANNULE") throw conflit("Ce bon de commande est deja annule.");
      if (commande.receipts.length > 0) {
        throw etatInvalide(
          `Ce bon de commande a deja fait l'objet de ${commande.receipts.length} reception(s) : il ne peut plus etre annule. Passez par un retour fournisseur pour les marchandises concernees.`,
        );
      }

      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: { status: "ANNULE", notes: `${commande.notes ?? ""}\nAnnulation : ${motif}`.trim() },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.ANNULATION,
          module: MODULES_AUDIT.ACHAT,
          entity: "PurchaseOrder",
          entityId: orderId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: commande.status, numero: commande.number },
          newValue: { statut: "ANNULE" },
          comment: motif,
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

// -----------------------------------------------------------------------------
// 3. Reception fournisseur
// -----------------------------------------------------------------------------

export interface LigneReceptionInput {
  orderLineId?: number | null;
  itemId: number;
  quantityReceived: Prisma.Decimal | string | number;
  unitPrice?: Prisma.Decimal | string | number;
  unitCode?: string | null;
  lotNumber?: string | null;
  manufactureDate?: Date | null;
  expirationDate?: Date | null;
  locationId?: number | null;
  notes?: string | null;
}

export interface ReceptionInput {
  supplierId: number;
  warehouseId: number;
  orderId?: number | null;
  receiptDate?: Date;
  deliveryNoteNumber?: string | null;
  qualityRequired?: boolean;
  notes?: string | null;
  lines: LigneReceptionInput[];
}

export interface ResultatReception {
  receiptId: number;
  numero: string;
  statut: ReceiptStatus;
  quantiteEnQuarantaine: Decimal;
  quantiteDisponible: Decimal;
  lots: { itemId: number; lotNumber: string | null; lotId: number | null }[];
}

/**
 * Enregistre une reception fournisseur (partielle ou totale).
 *
 * La marchandise entre reellement en stock : en quarantaine si le controle
 * qualite est requis, disponible sinon. Les quantites recues sont cumulees sur
 * la ligne de commande, et le statut de la commande est recalcule.
 */
export async function creerBonReception(
  entree: ReceptionInput,
  acteur: ActeurAchat,
): Promise<ResultatReception> {
  if (entree.lines.length === 0) {
    throw validation("Une reception doit comporter au moins une ligne.");
  }

  const controleObligatoire = await lireParametreBooleen(
    CLE_PARAMETRE.QUALITE_CONTROLE_RECEPTION_OBLIGATOIRE,
    true,
  );

  return prisma.$transaction(
    async (tx) => {
      const fournisseur = await tx.thirdParty.findUnique({
        where: { id: entree.supplierId },
        select: { id: true, label1: true, isSupplier: true },
      });
      if (!fournisseur) throw nonTrouve("Le fournisseur");
      if (!fournisseur.isSupplier) throw validation("Le tiers indique n'est pas un fournisseur.");

      const depot = await tx.warehouse.findUnique({
        where: { id: entree.warehouseId },
        select: { id: true, code: true, label: true, isActive: true },
      });
      if (!depot) throw nonTrouve("Le depot de destination");
      if (!depot.isActive) {
        throw etatInvalide(`Le depot « ${depot.code} » est inactif.`);
      }

      let commande: {
        id: number;
        number: string;
        status: PurchaseOrderStatus;
      } | null = null;

      if (entree.orderId) {
        const trouvee = await tx.purchaseOrder.findUnique({
          where: { id: entree.orderId },
          select: { id: true, number: true, status: true },
        });
        if (!trouvee) throw nonTrouve("Le bon de commande");
        if (trouvee.status === "ANNULE" || trouvee.status === "CLOTURE") {
          throw etatInvalide(
            `Le bon de commande ${trouvee.number} est ${trouvee.status === "ANNULE" ? "annule" : "cloture"} : aucune reception possible.`,
          );
        }
        if (trouvee.status === "BROUILLON") {
          throw etatInvalide(
            `Le bon de commande ${trouvee.number} n'est pas encore approuve : une reception ne peut pas etre enregistree.`,
          );
        }
        commande = trouvee;
      }

      const numero = await prochainNumero(SEQUENCES.BON_RECEPTION, tx);
      const dateReception = entree.receiptDate ?? new Date();
      const qualityRequired = entree.qualityRequired ?? controleObligatoire;
      const statutStock: "LIBRE" | "QUARANTAINE" = qualityRequired ? "QUARANTAINE" : "LIBRE";

      const reception = await tx.goodsReceipt.create({
        data: {
          number: numero,
          status: qualityRequired ? "EN_CONTROLE_QUALITE" : "ACCEPTE",
          supplierId: entree.supplierId,
          orderId: commande?.id ?? null,
          receiptDate: dateReception,
          warehouseId: entree.warehouseId,
          deliveryNoteNumber: entree.deliveryNoteNumber ?? null,
          qualityRequired,
          receivedById: await employeDeLUtilisateur(tx, acteur.id),
          notes: entree.notes ?? null,
          createdById: acteur.id,
        },
      });

      let quantiteQuarantaine = D.ZERO;
      let quantiteLibre = D.ZERO;
      const lots: ResultatReception["lots"] = [];
      let index = 1;

      for (const ligne of entree.lines) {
        const quantiteRecue = D.roundQuantity(ligne.quantityReceived);
        if (D.lte(quantiteRecue, 0)) {
          throw validation(
            `Ligne ${index} : la quantite recue doit etre strictement positive.`,
          );
        }

        let ligneCommande: {
          id: number;
          quantity: Decimal;
          quantityReceived: Decimal;
          unitPrice: Decimal;
          itemId: number;
        } | null = null;

        if (ligne.orderLineId) {
          const trouvee = await tx.purchaseOrderLine.findUnique({
            where: { id: ligne.orderLineId },
            select: {
              id: true,
              orderId: true,
              itemId: true,
              quantity: true,
              quantityReceived: true,
              unitPrice: true,
            },
          });
          if (!trouvee) throw nonTrouve(`La ligne de commande ${ligne.orderLineId}`);

          if (commande && trouvee.orderId !== commande.id) {
            throw validation(
              `La ligne ${ligne.orderLineId} n'appartient pas au bon de commande ${commande.number}.`,
            );
          }
          if (trouvee.itemId !== ligne.itemId) {
            throw validation(
              `Ligne ${index} : l'article ne correspond pas a celui de la ligne de commande.`,
            );
          }
          if (D.gt(D.add(trouvee.quantityReceived, quantiteRecue), trouvee.quantity)) {
            throw validation(
              `Ligne ${index} : la quantite recue porterait le total a ${D.toFixed(D.add(trouvee.quantityReceived, quantiteRecue), 3)} pour une quantite commandee de ${D.toFixed(trouvee.quantity, 3)}. Corrigez la quantite ou ajustez la commande.`,
            );
          }

          ligneCommande = {
            id: trouvee.id,
            quantity: D.of(trouvee.quantity),
            quantityReceived: D.of(trouvee.quantityReceived),
            unitPrice: D.of(trouvee.unitPrice),
            itemId: trouvee.itemId,
          };
        }

        const article = await tx.item.findUnique({
          where: { id: ligne.itemId },
          select: { id: true, code: true, unitCode: true, isBatchManaged: true },
        });
        if (!article) throw nonTrouve(`L'article de la ligne ${index}`);

        if (article.isBatchManaged && !ligne.lotNumber) {
          throw validation(
            `Ligne ${index} : l'article « ${article.code} » est gere par lot. Le numero de lot est obligatoire.`,
          );
        }

        let lotId: number | null = null;
        if (article.isBatchManaged || ligne.lotNumber) {
          lotId = await resoudreLot(tx, {
            itemId: ligne.itemId,
            warehouseId: entree.warehouseId,
            lotNumber: ligne.lotNumber ?? `REC-${numero}-${index}`,
            locationId: ligne.locationId ?? null,
            supplierId: entree.supplierId,
            manufactureDate: ligne.manufactureDate ?? null,
            expirationDate: ligne.expirationDate ?? null,
            sourceDocument: numero,
          });
        }
        lots.push({ itemId: ligne.itemId, lotNumber: ligne.lotNumber ?? null, lotId });

        const prixUnitaire = D.roundAmount(
          ligne.unitPrice ?? ligneCommande?.unitPrice ?? 0,
        );

        const ligneReception = await tx.goodsReceiptLine.create({
          data: {
            receiptId: reception.id,
            lineNo: index,
            orderLineId: ligneCommande?.id ?? null,
            itemId: ligne.itemId,
            quantityOrdered: ligneCommande?.quantity ?? 0,
            quantityReceived: quantiteRecue,
            quantityAccepted: 0,
            quantityRejected: 0,
            quantityQuarantined: qualityRequired ? quantiteRecue : D.ZERO,
            unitCode: ligne.unitCode ?? article.unitCode ?? null,
            unitPrice: prixUnitaire,
            lotNumber: ligne.lotNumber ?? null,
            manufactureDate: ligne.manufactureDate ?? null,
            expirationDate: ligne.expirationDate ?? null,
            qualityStatus: statutStock,
            locationId: ligne.locationId ?? null,
            notes: ligne.notes ?? null,
          },
        });

        const mouvement = await enregistrerMouvement(tx, {
          type: "RECEPTION_FOURNISSEUR",
          itemId: ligne.itemId,
          warehouseId: entree.warehouseId,
          locationId: ligne.locationId ?? null,
          lotId,
          status: statutStock,
          quantity: quantiteRecue,
          unitCode: ligne.unitCode ?? article.unitCode ?? null,
          unitCost: prixUnitaire,
          documentType: "BON_RECEPTION",
          documentId: String(reception.id),
          documentNumber: numero,
          thirdPartyId: entree.supplierId,
          occurredAt: dateReception,
          comment: `Reception ${numero} - ${fournisseur.label1}${commande ? ` (commande ${commande.number})` : ""}`,
          reason: entree.deliveryNoteNumber ?? null,
          acteur,
          ignorerControleStatut: true,
        });

        await tx.goodsReceiptLine.update({
          where: { id: ligneReception.id },
          data: { movementId: mouvement.mouvementId },
        });

        if (ligneCommande) {
          await tx.purchaseOrderLine.update({
            where: { id: ligneCommande.id },
            data: {
              quantityReceived: D.roundQuantity(
                D.add(ligneCommande.quantityReceived, quantiteRecue),
              ),
            },
          });
        }

        if (qualityRequired) {
          quantiteQuarantaine = D.add(quantiteQuarantaine, quantiteRecue);
        } else {
          quantiteLibre = D.add(quantiteLibre, quantiteRecue);
        }

        index += 1;
      }

      if (commande) {
        await recalculerStatutCommande(tx, commande.id);
      }

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.ACHAT,
          entity: "GoodsReceipt",
          entityId: reception.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: {
            numero,
            fournisseur: fournisseur.label1,
            depot: depot.code,
            commande: commande?.number ?? null,
            lignes: entree.lines.length,
            quarantaine: D.toFixed(quantiteQuarantaine, 3),
            disponible: D.toFixed(quantiteLibre, 3),
            controleQualite: qualityRequired,
          },
        },
        tx,
      );

      return {
        receiptId: reception.id,
        numero,
        statut: qualityRequired ? "EN_CONTROLE_QUALITE" : "ACCEPTE",
        quantiteEnQuarantaine: quantiteQuarantaine,
        quantiteDisponible: quantiteLibre,
        lots,
      };
    },
    { timeout: 120_000 },
  );
}

/** Recalcule le statut d'une commande a partir des quantites reellement recues. */
export async function recalculerStatutCommande(tx: Db, orderId: number): Promise<void> {
  const commande = await tx.purchaseOrder.findUnique({
    where: { id: orderId },
    include: { lines: { select: { quantity: true, quantityReceived: true, quantityInvoiced: true } } },
  });
  if (!commande) return;
  if (commande.status === "ANNULE" || commande.status === "CLOTURE") return;

  const totalCommande = commande.lines.reduce((total, ligne) => D.add(total, ligne.quantity), D.ZERO);
  const totalRecu = commande.lines.reduce(
    (total, ligne) => D.add(total, ligne.quantityReceived),
    D.ZERO,
  );
  const totalFacture = commande.lines.reduce(
    (total, ligne) => D.add(total, ligne.quantityInvoiced),
    D.ZERO,
  );

  let statut: PurchaseOrderStatus = commande.status;

  if (D.gte(totalFacture, totalCommande) && D.gt(totalCommande, 0)) {
    statut = "FACTURE";
  } else if (D.gte(totalRecu, totalCommande) && D.gt(totalCommande, 0)) {
    statut = "RECU";
  } else if (D.gt(totalRecu, 0)) {
    statut = "PARTIELLEMENT_RECU";
  } else if (
    commande.status === "APPROUVE" ||
    commande.status === "RECU" ||
    commande.status === "PARTIELLEMENT_RECU"
  ) {
    // Plus rien n'est recu (annulation de la derniere reception) : la commande
    // revient a l'etat qui precede toute reception au lieu de rester affichee
    // comme recue alors que son solde receptionne est nul.
    statut = "APPROUVE";
  }

  if (statut !== commande.status) {
    await tx.purchaseOrder.update({ where: { id: orderId }, data: { status: statut } });
  }
}

export async function annulerReception(
  entree: { receiptId: number; motif: string },
  acteur: ActeurAchat,
): Promise<void> {
  if (!entree.motif || entree.motif.trim().length < 10) {
    throw validation("Le motif d'annulation de la reception est obligatoire (au moins 10 caracteres).");
  }

  await prisma.$transaction(
    async (tx) => {
      const reception = await tx.goodsReceipt.findUnique({
        where: { id: entree.receiptId },
        include: {
          lines: true,
          invoices: { where: { status: { not: "ANNULEE" } }, select: { id: true, number: true } },
        },
      });
      if (!reception) throw nonTrouve("La reception");
      if (reception.status === "ANNULE") throw conflit("Cette reception est deja annulee.");
      if (reception.invoices.length > 0) {
        throw etatInvalide(
          `Cette reception est facturee (${reception.invoices.map((i) => i.number).join(", ")}) : annulez ou contre-passez d'abord la facture fournisseur.`,
        );
      }

      for (const ligne of reception.lines) {
        const lot = ligne.lotNumber
          ? await tx.stockLot.findUnique({
              where: {
                itemId_warehouseId_lotNumber: {
                  itemId: ligne.itemId,
                  warehouseId: reception.warehouseId,
                  lotNumber: ligne.lotNumber,
                },
              },
              select: { id: true },
            })
          : null;

        await enregistrerMouvement(tx, {
          type: "RETOUR_FOURNISSEUR",
          itemId: ligne.itemId,
          warehouseId: reception.warehouseId,
          lotId: lot?.id ?? null,
          status: ligne.qualityStatus,
          quantity: D.neg(D.of(ligne.quantityReceived)),
          unitCost: D.of(ligne.unitPrice),
          documentType: "BON_RECEPTION",
          documentId: String(reception.id),
          documentNumber: reception.number,
          thirdPartyId: reception.supplierId,
          comment: `Annulation de la reception ${reception.number}`,
          reason: entree.motif,
          justification: entree.motif,
          acteur,
          ignorerControleStatut: true,
          ignorerValorisation: true,
        });

        if (ligne.orderLineId) {
          const ligneCommande = await tx.purchaseOrderLine.findUnique({
            where: { id: ligne.orderLineId },
            select: { quantityReceived: true },
          });
          if (ligneCommande) {
            await tx.purchaseOrderLine.update({
              where: { id: ligne.orderLineId },
              data: {
                quantityReceived: D.roundQuantity(
                  D.max(D.ZERO, D.sub(ligneCommande.quantityReceived, ligne.quantityReceived)),
                ),
              },
            });
          }
        }
      }

      await tx.goodsReceipt.update({
        where: { id: reception.id },
        data: { status: "ANNULE", notes: `${reception.notes ?? ""}\nAnnulation : ${entree.motif}`.trim() },
      });

      if (reception.orderId) {
        await recalculerStatutCommande(tx, reception.orderId);
      }

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.ANNULATION,
          module: MODULES_AUDIT.ACHAT,
          entity: "GoodsReceipt",
          entityId: reception.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { numero: reception.number, statut: reception.status },
          newValue: { statut: "ANNULE", mouvementInverse: true },
          comment: entree.motif,
        },
        tx,
      );
    },
    { timeout: 120_000 },
  );
}

/**
 * Retour fournisseur : sortie de stock d'articles refuses ou a remplacer.
 * Un mouvement inverse est cree, aucune quantite n'est effacee.
 */
export async function retourFournisseur(
  entree: {
    supplierId: number;
    warehouseId: number;
    motif: string;
    documentOrigine?: string | null;
    lines: {
      itemId: number;
      quantity: Prisma.Decimal | string | number;
      lotNumber?: string | null;
      qualityStatus?: "LIBRE" | "QUARANTAINE" | "BLOQUE" | "REBUT";
      unitCost?: Prisma.Decimal | string | number;
    }[];
  },
  acteur: ActeurAchat,
): Promise<{ movemementIds: bigint[] }> {
  if (!entree.motif || entree.motif.trim().length < 10) {
    throw validation("Le motif du retour fournisseur est obligatoire (au moins 10 caracteres).");
  }
  if (entree.lines.length === 0) {
    throw validation("Un retour fournisseur doit comporter au moins une ligne.");
  }

  return prisma.$transaction(
    async (tx) => {
      const fournisseur = await tx.thirdParty.findUnique({
        where: { id: entree.supplierId },
        select: { label1: true, isSupplier: true },
      });
      if (!fournisseur) throw nonTrouve("Le fournisseur");
      if (!fournisseur.isSupplier) throw validation("Le tiers indique n'est pas un fournisseur.");

      const movemementIds: bigint[] = [];

      for (const ligne of entree.lines) {
        const quantite = D.roundQuantity(ligne.quantity);
        if (D.lte(quantite, 0)) {
          throw validation("Les quantites retournees doivent etre strictement positives.");
        }

        const statut = ligne.qualityStatus ?? "QUARANTAINE";

        const lot = ligne.lotNumber
          ? await tx.stockLot.findUnique({
              where: {
                itemId_warehouseId_lotNumber: {
                  itemId: ligne.itemId,
                  warehouseId: entree.warehouseId,
                  lotNumber: ligne.lotNumber,
                },
              },
              select: { id: true },
            })
          : null;

        const article = await tx.item.findUnique({
          where: { id: ligne.itemId },
          select: { code: true, label1: true },
        });
        if (!article) throw nonTrouve("L'article a retourner");

        const mouvement = await enregistrerMouvement(tx, {
          type: "RETOUR_FOURNISSEUR",
          itemId: ligne.itemId,
          warehouseId: entree.warehouseId,
          lotId: lot?.id ?? null,
          status: statut,
          quantity: D.neg(quantite),
          unitCost: ligne.unitCost === undefined ? undefined : D.roundAmount(ligne.unitCost),
          thirdPartyId: entree.supplierId,
          documentType: "RETOUR_FOURNISSEUR",
          documentId: entree.documentOrigine ?? null,
          comment: `Retour fournisseur ${fournisseur.label1} - ${article.label1}`,
          reason: entree.motif,
          justification: entree.motif,
          acteur,
          ignorerControleStatut: true,
        });

        movemementIds.push(mouvement.mouvementId);
      }

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MOUVEMENT_STOCK,
          module: MODULES_AUDIT.ACHAT,
          entity: "GoodsReceipt",
          entityId: null,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: {
            nature: "RETOUR_FOURNISSEUR",
            fournisseur: fournisseur.label1,
            lignes: entree.lines.length,
            mouvements: movemementIds.length,
          },
          comment: entree.motif,
        },
        tx,
      );

      return { movemementIds };
    },
    { timeout: 120_000 },
  );
}

// -----------------------------------------------------------------------------
// 4. Facture fournisseur et rapprochement trois voies
// -----------------------------------------------------------------------------

export interface FactureFournisseurInput {
  supplierId: number;
  supplierRef: string;
  orderId?: number | null;
  receiptId?: number | null;
  invoiceDate?: Date;
  dueDate?: Date | null;
  paymentTermsDays?: number;
  currency?: string;
  notes?: string | null;
  lines: {
    itemId?: number | null;
    orderLineId?: number | null;
    receiptLineId?: number | null;
    description?: string | null;
    quantity: Prisma.Decimal | string | number;
    unitPrice: Prisma.Decimal | string | number;
    vatRateCode?: string | null;
  }[];
}

export interface ResultatFactureFournisseur {
  invoiceId: number;
  supplierInvoiceId: number;
  numero: string;
  totalTTC: Decimal;
  rapprochementTroisVoies: boolean;
  ecarts: {
    type: "PRIX" | "QUANTITE" | "SANS_RECEPTION" | "SANS_COMMANDE";
    detail: string;
    montant?: Decimal;
  }[];
}

/**
 * Enregistre une facture fournisseur et la rapproche des receptions et de la
 * commande correspondantes (rapprochement trois voies).
 *
 * Les ecarts ne bloquent pas l'enregistrement mais ils sont conserves et
 * affiches : l'application ne corrige jamais un ecart en silence.
 */
export async function enregistrerFactureFournisseur(
  entree: FactureFournisseurInput,
  acteur: ActeurAchat,
): Promise<ResultatFactureFournisseur> {
  if (!entree.supplierRef || !entree.supplierRef.trim()) {
    throw validation("La reference de la facture fournisseur est obligatoire.");
  }
  if (entree.lines.length === 0) {
    throw validation("Une facture fournisseur doit comporter au moins une ligne.");
  }

  return prisma.$transaction(
    async (tx) => {
      const fournisseur = await tx.thirdParty.findUnique({
        where: { id: entree.supplierId },
        select: { id: true, label1: true, isSupplier: true, deadlineDays: true },
      });
      if (!fournisseur) throw nonTrouve("Le fournisseur");
      if (!fournisseur.isSupplier) throw validation("Le tiers indique n'est pas un fournisseur.");

      const doublon = await tx.supplierInvoice.findFirst({
        where: { supplierId: entree.supplierId, supplierRef: entree.supplierRef.trim() },
      });
      if (doublon) {
        throw conflit(
          `Une facture fournisseur portant la reference « ${entree.supplierRef} » existe deja pour ce fournisseur (${doublon.number}).`,
        );
      }

      const numero = await prochainNumero(SEQUENCES.FACTURE_FOURNISSEUR, tx);
      const dateFacture = entree.invoiceDate ?? new Date();
      const delaiPaiement = entree.paymentTermsDays ?? fournisseur.deadlineDays ?? 0;
      const dateEcheance =
        entree.dueDate ??
        (delaiPaiement > 0
          ? new Date(dateFacture.getTime() + delaiPaiement * 86_400_000)
          : null);

      const facture = await tx.supplierInvoice.create({
        data: {
          number: numero,
          supplierRef: entree.supplierRef.trim(),
          status: "BROUILLON",
          supplierId: entree.supplierId,
          orderId: entree.orderId ?? null,
          receiptId: entree.receiptId ?? null,
          invoiceDate: dateFacture,
          dueDate: dateEcheance,
          currency: entree.currency ?? "DZD",
          createdById: acteur.id,
          notes: entree.notes ?? null,
        },
      });

      // La piece fournisseur est doublee dans le grand livre des factures
      // (modele « Invoice »), seul support des affectations de reglement et des
      // ecritures comptables. Le lien est explicite et unique.
      const pieceComptable = await tx.invoice.create({
        data: {
          number: numero,
          direction: "FOURNISSEUR",
          nature: "FACTURE",
          status: "BROUILLON",
          thirdPartyId: entree.supplierId,
          supplierInvoiceId: facture.id,
          invoiceDate: dateFacture,
          dueDate: dateEcheance,
          currency: entree.currency ?? "DZD",
          paymentTermsDays: delaiPaiement,
          reference: entree.supplierRef.trim(),
          createdById: acteur.id,
        },
      });

      const ecarts: ResultatFactureFournisseur["ecarts"] = [];
      let sousTotal = D.ZERO;
      let totalTva = D.ZERO;
      let index = 1;

      for (const ligne of entree.lines) {
        const quantite = D.roundQuantity(ligne.quantity);
        const prixUnitaire = D.roundAmount(ligne.unitPrice);
        if (D.lte(quantite, 0)) {
          throw validation(`Ligne ${index} : la quantite facturee doit etre strictement positive.`);
        }

        let ligneCommande: {
          id: number;
          quantity: number | Decimal;
          quantityReceived: Decimal;
          quantityInvoiced: Decimal;
          unitPrice: Decimal;
          itemId: number;
        } | null = null;

        if (ligne.orderLineId) {
          const trouvee = await tx.purchaseOrderLine.findUnique({
            where: { id: ligne.orderLineId },
            select: {
              id: true,
              itemId: true,
              quantity: true,
              quantityReceived: true,
              quantityInvoiced: true,
              unitPrice: true,
            },
          });
          if (!trouvee) throw nonTrouve(`La ligne de commande ${ligne.orderLineId}`);
          ligneCommande = trouvee;
        } else if (entree.orderId && ligne.itemId) {
          const trouvee = await tx.purchaseOrderLine.findFirst({
            where: { orderId: entree.orderId, itemId: ligne.itemId },
            select: {
              id: true,
              itemId: true,
              quantity: true,
              quantityReceived: true,
              quantityInvoiced: true,
              unitPrice: true,
            },
          });
          if (trouvee) ligneCommande = trouvee;
        }

        let ligneReception: {
          id: number;
          quantityAccepted: Decimal;
          quantityReceived: Decimal;
          quantityQuarantined: Decimal;
          qualityStatus: string;
        } | null = null;

        if (ligne.receiptLineId) {
          const trouvee = await tx.goodsReceiptLine.findUnique({
            where: { id: ligne.receiptLineId },
            select: {
              id: true,
              quantityAccepted: true,
              quantityReceived: true,
              quantityQuarantined: true,
              qualityStatus: true,
            },
          });
          if (!trouvee) throw nonTrouve(`La ligne de reception ${ligne.receiptLineId}`);
          ligneReception = trouvee;
        } else if (entree.receiptId && ligne.itemId) {
          const trouvee = await tx.goodsReceiptLine.findFirst({
            where: { receiptId: entree.receiptId, itemId: ligne.itemId },
            select: {
              id: true,
              quantityAccepted: true,
              quantityReceived: true,
              quantityQuarantined: true,
              qualityStatus: true,
            },
          });
          if (trouvee) ligneReception = trouvee;
        }

        // --- Ecarts de rapprochement ----------------------------------------
        let ecartPrix: Decimal = D.ZERO;
        let ecartQuantite: Decimal = D.ZERO;

        if (ligneCommande) {
          if (!D.eq(prixUnitaire, D.of(ligneCommande.unitPrice))) {
            ecartPrix = D.roundAmount(D.sub(prixUnitaire, D.of(ligneCommande.unitPrice)));
            ecarts.push({
              type: "PRIX",
              detail: `Ligne ${index} : prix facture ${D.toFixed(prixUnitaire, 2)} contre ${D.toFixed(ligneCommande.unitPrice, 2)} commandes.`,
              montant: D.roundAmount(D.mul(ecartPrix, quantite)),
            });
          }

          const resteARecevoir = D.sub(D.of(ligneCommande.quantity), D.of(ligneCommande.quantityReceived));
          if (D.gt(quantite, D.of(ligneCommande.quantityReceived))) {
            ecartQuantite = D.roundQuantity(D.sub(quantite, D.of(ligneCommande.quantityReceived)));
            ecarts.push({
              type: "QUANTITE",
              detail: `Ligne ${index} : quantite facturee ${D.toFixed(quantite, 3)} superieure a la quantite recue ${D.toFixed(ligneCommande.quantityReceived, 3)}.`,
            });
          }
          if (D.gt(resteARecevoir, 0) && D.gt(quantite, 0)) {
            ecarts.push({
              type: "QUANTITE",
              detail: `Ligne ${index} : il reste ${D.toFixed(resteARecevoir, 3)} a recevoir sur cette ligne de commande.`,
            });
          }
        } else {
          ecarts.push({
            type: "SANS_COMMANDE",
            detail: `Ligne ${index} : aucune ligne de commande correspondante n'a ete trouvee.`,
          });
        }

        if (!ligneReception && entree.receiptId) {
          ecarts.push({
            type: "SANS_RECEPTION",
            detail: `Ligne ${index} : aucune ligne de reception correspondante dans la reception indiquee.`,
          });
        }

        if (ligneReception && ligneReception.qualityStatus === "QUARANTAINE") {
          ecarts.push({
            type: "SANS_RECEPTION",
            detail: `Ligne ${index} : marchandise encore en quarantaine, non liberee par la qualite.`,
          });
        }

        // --- Ecriture de la ligne -------------------------------------------
        const tauxTva = await resoudreTauxTva(tx, {
          vatRateCode: ligne.vatRateCode ?? null,
          itemId: ligne.itemId ?? ligneCommande?.itemId ?? null,
        });

        const ligneHT = D.roundAmount(D.mul(quantite, prixUnitaire));
        const ligneTVA = D.roundAmount(D.mul(ligneHT, D.div(tauxTva.taux, D.CENT)));

        await tx.supplierInvoiceLine.create({
          data: {
            invoiceId: facture.id,
            lineNo: index,
            orderLineId: ligneCommande?.id ?? null,
            receiptLineId: ligneReception?.id ?? null,
            itemId: ligne.itemId ?? ligneCommande?.itemId ?? null,
            description: ligne.description ?? null,
            quantity: quantite,
            unitPrice: prixUnitaire,
            vatRate: D.round(tauxTva.taux, 4),
            lineHT: ligneHT,
            lineVAT: ligneTVA,
            lineTTC: D.roundAmount(D.add(ligneHT, ligneTVA)),
            priceVariance: ecartPrix,
            quantityVariance: ecartQuantite,
          },
        });

        await tx.invoiceLine.create({
          data: {
            invoiceId: pieceComptable.id,
            lineNo: index,
            itemId: ligne.itemId ?? ligneCommande?.itemId ?? null,
            description: ligne.description ?? null,
            quantity: quantite,
            unitPrice: prixUnitaire,
            vatRateCode: tauxTva.code,
            vatRate: D.round(tauxTva.taux, 4),
            lineHT: ligneHT,
            lineVAT: ligneTVA,
            lineTTC: D.roundAmount(D.add(ligneHT, ligneTVA)),
          },
        });

        sousTotal = D.add(sousTotal, ligneHT);
        totalTva = D.add(totalTva, ligneTVA);
        index += 1;
      }

      const totalHT = D.roundAmount(sousTotal);
      const totalTTC = D.roundAmount(D.add(totalHT, totalTva));
      const rapproche = ecarts.length === 0;
      const notesRapprochement =
        ecarts.length > 0
          ? ecarts.map((ecart) => `[${ecart.type}] ${ecart.detail}`).join("\n")
          : "Rapprochement trois voies conforme : commande, reception et facture concordent.";

      await tx.supplierInvoice.update({
        where: { id: facture.id },
        data: {
          subtotalHT: totalHT,
          vatAmount: D.roundAmount(totalTva),
          totalTTC,
          threeWayMatched: rapproche,
          matchingNotes: notesRapprochement,
        },
      });

      // La piece comptable porte les memes totaux que la piece fournisseur :
      // l'ecart de rapprochement n'est jamais absorbe en silence.
      await tx.invoice.update({
        where: { id: pieceComptable.id },
        data: {
          subtotalHT: totalHT,
          vatAmount: D.roundAmount(totalTva),
          totalTTC,
          balance: totalTTC,
          notes: notesRapprochement,
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.FACTURATION,
          module: MODULES_AUDIT.ACHAT,
          entity: "SupplierInvoice",
          entityId: facture.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: {
            numero,
            referenceFournisseur: entree.supplierRef,
            fournisseur: fournisseur.label1,
            totalHT: D.toFixed(totalHT, 2),
            totalTVA: D.toFixed(totalTva, 2),
            totalTTC: D.toFixed(totalTTC, 2),
            rapprochementTroisVoies: rapproche,
            ecarts: ecarts.length,
            pieceComptable: pieceComptable.number,
          },
          comment: ecarts.length > 0 ? ecarts.map((e) => e.detail).join(" | ") : null,
        },
        tx,
      );

      return {
        invoiceId: pieceComptable.id,
        supplierInvoiceId: facture.id,
        numero,
        totalTTC,
        rapprochementTroisVoies: rapproche,
        ecarts,
      };
    },
    { timeout: 120_000 },
  );
}

/**
 * Validation puis comptabilisation d'une facture fournisseur.
 * L'ecriture provient de la regle « FACTURE_FOURNISSEUR » : aucun compte n'est
 * code en dur. Une facture non rapprochee exige une justification explicite.
 */
export async function validerFactureFournisseur(
  entree: {
    supplierInvoiceId: number;
    justificationEcart?: string | null;
    entryDate?: Date;
  },
  acteur: ActeurAchat,
): Promise<{ numero: string; numeroEcriture: string; invoiceId: number }> {
  const resultat = await prisma.$transaction(
    async (tx) => {
      const facture = await tx.supplierInvoice.findUnique({
        where: { id: entree.supplierInvoiceId },
        include: {
          lines: true,
          supplier: { select: { label1: true, isSupplier: true } },
          invoice: { select: { id: true, number: true, status: true } },
        },
      });
      if (!facture) throw nonTrouve("La facture fournisseur");
      if (facture.status !== "BROUILLON") {
        throw conflit(`Cette facture est au statut ${facture.status} : elle a deja ete validee.`);
      }
      if (facture.lines.length === 0) {
        throw etatInvalide("Une facture sans ligne ne peut pas etre validee.");
      }
      if (!facture.invoice) {
        throw etatInvalide(
          `La piece comptable de la facture ${facture.number} est introuvable : la validation est impossible.`,
        );
      }

      // Regle de gestion : une facture dont le rapprochement trois voies n'est
      // pas conforme ne peut pas etre comptabilisee sans justification ecrite.
      // L'ecart reste attache au document, il n'est jamais efface.
      if (!facture.threeWayMatched && (!entree.justificationEcart || entree.justificationEcart.trim().length < 10)) {
        throw validation(
          "Cette facture presente des ecarts avec la commande ou la reception. Une justification ecrite (au moins 10 caracteres) est obligatoire pour la comptabiliser.",
        );
      }

      const dateEcriture = entree.entryDate ?? facture.invoiceDate;

      const ecriture = await genererEcriture(tx, {
        eventCode: "FACTURE_FOURNISSEUR",
        entryDate: dateEcriture,
        label: `Facture fournisseur ${facture.number} - ${facture.supplier.label1}`,
        reference: facture.supplierRef ?? facture.number,
        documentType: "FACTURE_FOURNISSEUR",
        documentId: String(facture.invoice.id),
        montantHT: D.of(facture.subtotalHT),
        montantTVA: D.of(facture.vatAmount),
        montantTTC: D.of(facture.totalTTC),
        thirdPartyId: facture.supplierId,
        invoiceId: facture.invoice.id,
        acteur,
      });

      // La validation et le postage de l'ecriture ouvrent leur propre
      // transaction : ils sont executes apres celle du document, faute de quoi
      // l'ecriture encore non validee leur resterait invisible.

      const notesFinales =
        entree.justificationEcart && !facture.threeWayMatched
          ? `${facture.notes ?? ""}\nJustification des ecarts : ${entree.justificationEcart}`.trim()
          : facture.notes;

      await tx.supplierInvoice.update({
        where: { id: facture.id },
        data: { status: "POSTEE", postedAt: new Date(), notes: notesFinales },
      });

      await tx.invoice.update({
        where: { id: facture.invoice.id },
        data: {
          status: "POSTEE",
          postedAt: new Date(),
          postedById: acteur.id,
          balance: D.of(facture.totalTTC),
          notes: `${facture.matchingNotes ?? ""}\n${entree.justificationEcart ?? ""}`.trim(),
        },
      });

      // Les quantites facturees alimentent le statut de la commande.
      for (const ligne of facture.lines) {
        if (ligne.orderLineId) {
          const ligneCommande = await tx.purchaseOrderLine.findUnique({
            where: { id: ligne.orderLineId },
            select: { quantityInvoiced: true },
          });
          if (ligneCommande) {
            await tx.purchaseOrderLine.update({
              where: { id: ligne.orderLineId },
              data: {
                quantityInvoiced: D.roundQuantity(
                  D.add(ligneCommande.quantityInvoiced, ligne.quantity),
                ),
              },
            });
          }
        }
      }

      if (facture.orderId) {
        await recalculerStatutCommande(tx, facture.orderId);
      }

      await majSoldeTiers(tx, facture.supplierId);

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.VALIDATION,
          module: MODULES_AUDIT.ACHAT,
          entity: "SupplierInvoice",
          entityId: facture.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: "BROUILLON" },
          newValue: {
            statut: "POSTEE",
            numero: facture.number,
            totalTTC: facture.totalTTC.toFixed(2),
            ecriture: ecriture.numero,
          },
          comment: entree.justificationEcart ?? null,
        },
        tx,
      );

      return {
        numero: facture.number,
        numeroEcriture: ecriture.numero,
        invoiceId: facture.invoice.id,
        entryId: ecriture.entryId,
      };
    },
    { timeout: 60_000 },
  );

  // La validation puis le postage sont des transitions d'etat a part entiere :
  // elles s'executent une fois l'ecriture du document validee et visible.
  await validerEcriture(resultat.entryId, acteur);
  await posterEcriture(resultat.entryId, acteur);

  return {
    numero: resultat.numero,
    numeroEcriture: resultat.numeroEcriture,
    invoiceId: resultat.invoiceId,
  };
}

/** Reglement d'une facture fournisseur, affecte a la piece comptable liee. */
export async function reglerFactureFournisseur(
  entree: {
    supplierInvoiceId: number;
    method: Parameters<typeof enregistrerReglement>[0]["method"];
    amount?: Prisma.Decimal | string | number;
    paymentDate?: Date;
    reference?: string | null;
    bankAccount?: string | null;
  },
  acteur: ActeurAchat,
) {
  const facture = await prisma.supplierInvoice.findUnique({
    where: { id: entree.supplierInvoiceId },
    select: {
      id: true,
      number: true,
      supplierId: true,
      status: true,
      totalTTC: true,
      paidAmount: true,
      invoice: { select: { id: true, status: true, balance: true } },
    },
  });
  if (!facture) throw nonTrouve("La facture fournisseur");
  if (facture.status === "BROUILLON") {
    throw etatInvalide(
      "Cette facture fournisseur n'est pas encore validee : elle ne peut pas etre reglee.",
    );
  }
  if (facture.status === "ANNULEE") {
    throw etatInvalide("Cette facture fournisseur est annulee.");
  }
  if (!facture.invoice) {
    throw etatInvalide(
      `La piece comptable de la facture ${facture.number} est introuvable : le reglement est impossible.`,
    );
  }
  if (facture.invoice.status === "BROUILLON" || facture.invoice.status === "VALIDEE") {
    throw etatInvalide(
      `La piece ${facture.number} n'est pas encore comptabilisee : validez la facture avant de la regler.`,
    );
  }

  const reste = D.sub(D.of(facture.totalTTC), D.of(facture.paidAmount));
  if (D.lte(reste, 0)) {
    throw conflit("Cette facture fournisseur est deja integralement reglee.");
  }

  const montant = D.roundAmount(entree.amount ?? reste);
  if (D.gt(montant, reste)) {
    throw validation(
      `Le montant du reglement (${D.toFixed(montant, 2)}) depasse le reste du de la facture (${D.toFixed(reste, 2)}).`,
    );
  }

  const resultat = await enregistrerReglement({
    direction: "DECAISSEMENT",
    thirdPartyId: facture.supplierId,
    method: entree.method,
    amount: montant,
    paymentDate: entree.paymentDate,
    reference: entree.reference ?? facture.number,
    bankAccount: entree.bankAccount ?? null,
    notes: `Reglement de la facture fournisseur ${facture.number}`,
    allocations: [{ invoiceId: facture.invoice.id, amount: montant }],
    acteur,
  });

  const nouveauRegle = D.roundAmount(D.add(D.of(facture.paidAmount), montant));

  await prisma.supplierInvoice.update({
    where: { id: facture.id },
    data: {
      paidAmount: nouveauRegle,
      status: D.gte(nouveauRegle, D.of(facture.totalTTC)) ? "REGLEE" : "PARTIELLEMENT_REGLEE",
    },
  });

  return resultat;
}

/**
 * Avoir fournisseur : document en deduction, rattache a la facture d'origine.
 *
 * L'avoir est cree sur la piece comptable (modele « Invoice ») par le service
 * de reglement, qui plafonne le cumul des avoirs au montant de la facture
 * d'origine. Il est ensuite duplique dans le registre des pieces fournisseur
 * afin que le dossier d'achat reste complet, sans generer une seconde ecriture.
 */
export async function creerAvoirFournisseur(
  entree: {
    supplierInvoiceId: number;
    montantHT: Prisma.Decimal | string | number;
    montantTVA?: Prisma.Decimal | string | number;
    motif: string;
    invoiceDate?: Date;
  },
  acteur: ActeurAchat,
): Promise<{ invoiceId: number; supplierInvoiceId: number; numero: string; totalTTC: Decimal }> {
  if (!entree.motif || entree.motif.trim().length < 5) {
    throw validation("Le motif de l'avoir fournisseur est obligatoire.");
  }

  const montantHT = D.roundAmount(entree.montantHT);
  if (D.lte(montantHT, 0)) {
    throw validation("Le montant HT de l'avoir doit etre strictement positif.");
  }

  const origine = await prisma.supplierInvoice.findUnique({
    where: { id: entree.supplierInvoiceId },
    select: {
      id: true,
      number: true,
      supplierRef: true,
      supplierId: true,
      orderId: true,
      receiptId: true,
      currency: true,
      status: true,
      isCreditNote: true,
      invoice: { select: { id: true, number: true, status: true } },
      supplier: { select: { label1: true } },
    },
  });
  if (!origine) throw nonTrouve("La facture fournisseur d'origine");
  if (origine.isCreditNote) {
    throw validation("Un avoir ne peut pas etre etabli sur un autre avoir.");
  }
  if (origine.status === "ANNULEE") {
    throw etatInvalide("La facture fournisseur d'origine est annulee.");
  }
  if (!origine.invoice) {
    throw etatInvalide(
      `La piece comptable de la facture ${origine.number} est introuvable : l'avoir ne peut pas etre rattache.`,
    );
  }
  if (origine.invoice.status === "BROUILLON") {
    throw etatInvalide(
      `La facture ${origine.number} n'est pas encore comptabilisee : validez-la avant d'etablir un avoir.`,
    );
  }

  const montantTVA = D.roundAmount(entree.montantTVA ?? 0);

  const avoir = await creerAvoir({
    invoiceId: origine.invoice.id,
    montantHT,
    montantTVA,
    motif: entree.motif,
    invoiceDate: entree.invoiceDate,
    acteur,
  });

  const avoirFournisseur = await prisma.supplierInvoice.create({
    data: {
      number: avoir.numero,
      supplierRef: `AVOIR-${origine.supplierRef ?? origine.number}`,
      status: "POSTEE",
      supplierId: origine.supplierId,
      orderId: origine.orderId,
      receiptId: origine.receiptId,
      invoiceDate: entree.invoiceDate ?? new Date(),
      currency: origine.currency,
      subtotalHT: montantHT,
      vatAmount: montantTVA,
      totalTTC: avoir.totalTTC,
      isCreditNote: true,
      threeWayMatched: true,
      matchingNotes: `Avoir sur facture ${origine.number} : ${entree.motif}`,
      postedAt: new Date(),
      createdById: acteur.id,
    },
  });

  await prisma.supplierInvoiceLine.create({
    data: {
      invoiceId: avoirFournisseur.id,
      lineNo: 1,
      description: `Avoir sur facture ${origine.number}`,
      quantity: 1,
      unitPrice: montantHT,
      vatRate: D.gt(montantHT, 0)
        ? D.round(D.mul(D.div(montantTVA, montantHT), D.CENT), 4)
        : 0,
      lineHT: montantHT,
      lineVAT: montantTVA,
      lineTTC: avoir.totalTTC,
    },
  });

  await enregistrerAudit(
    {
      action: ACTIONS_AUDIT.FACTURATION,
      module: MODULES_AUDIT.ACHAT,
      entity: "SupplierInvoice",
      entityId: avoirFournisseur.id,
      userId: acteur.id,
      userEmail: acteur.email,
      newValue: {
        numero: avoir.numero,
        nature: "AVOIR_FOURNISSEUR",
        factureOrigine: origine.number,
        fournisseur: origine.supplier.label1,
        totalTTC: D.toFixed(avoir.totalTTC, 2),
        motif: entree.motif,
      },
      comment: entree.motif,
    },
    prisma,
  );

  return {
    invoiceId: avoir.invoiceId,
    supplierInvoiceId: avoirFournisseur.id,
    numero: avoir.numero,
    totalTTC: avoir.totalTTC,
  };
}

// -----------------------------------------------------------------------------
// 5. Consultations
// -----------------------------------------------------------------------------

export async function listerDemandesAchat(filtres: {
  statut?: PurchaseRequestStatus;
  supplierId?: number;
  page?: number;
  taille?: number;
}) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(200, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.PurchaseRequestWhereInput = {};
  if (filtres.statut) where.status = filtres.statut;
  if (filtres.supplierId) where.supplierId = filtres.supplierId;

  const [total, lignes] = await Promise.all([
    prisma.purchaseRequest.count({ where }),
    prisma.purchaseRequest.findMany({
      where,
      orderBy: { requestedAt: "desc" },
      skip: (page - 1) * taille,
      take: taille,
      include: {
        supplier: { select: { code: true, label1: true } },
        lines: { orderBy: { lineNo: "asc" }, include: { item: { select: { code: true, label1: true } } } },
      },
    }),
  ]);

  return { lignes, total, page, taille, pages: Math.max(1, Math.ceil(total / taille)) };
}

export async function listerCommandesFournisseur(filtres: {
  statut?: PurchaseOrderStatus;
  supplierId?: number;
  page?: number;
  taille?: number;
}) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(200, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.PurchaseOrderWhereInput = {};
  if (filtres.statut) where.status = filtres.statut;
  if (filtres.supplierId) where.supplierId = filtres.supplierId;

  const [total, lignes] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      orderBy: { orderDate: "desc" },
      skip: (page - 1) * taille,
      take: taille,
      include: {
        supplier: { select: { code: true, label1: true } },
        lines: {
          orderBy: { lineNo: "asc" },
          include: { item: { select: { code: true, label1: true } } },
        },
        _count: { select: { receipts: true } },
      },
    }),
  ]);

  return { lignes, total, page, taille, pages: Math.max(1, Math.ceil(total / taille)) };
}

export async function listerReceptions(filtres: {
  statut?: ReceiptStatus;
  supplierId?: number;
  warehouseId?: number;
  page?: number;
  taille?: number;
}) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(200, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.GoodsReceiptWhereInput = {};
  if (filtres.statut) where.status = filtres.statut;
  if (filtres.supplierId) where.supplierId = filtres.supplierId;
  if (filtres.warehouseId) where.warehouseId = filtres.warehouseId;

  const [total, lignes] = await Promise.all([
    prisma.goodsReceipt.count({ where }),
    prisma.goodsReceipt.findMany({
      where,
      orderBy: { receiptDate: "desc" },
      skip: (page - 1) * taille,
      take: taille,
      include: {
        supplier: { select: { code: true, label1: true } },
        warehouse: { select: { code: true, label: true } },
        order: { select: { number: true } },
        lines: {
          orderBy: { lineNo: "asc" },
          include: { item: { select: { code: true, label1: true } } },
        },
      },
    }),
  ]);

  return { lignes, total, page, taille, pages: Math.max(1, Math.ceil(total / taille)) };
}

export async function listerFacturesFournisseur(filtres: {
  statut?: "BROUILLON" | "VALIDEE" | "POSTEE" | "PARTIELLEMENT_REGLEE" | "REGLEE" | "EN_RETARD" | "ANNULEE";
  supplierId?: number;
  page?: number;
  taille?: number;
}) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(200, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.SupplierInvoiceWhereInput = {};
  if (filtres.statut) where.status = filtres.statut;
  if (filtres.supplierId) where.supplierId = filtres.supplierId;

  const [total, lignes] = await Promise.all([
    prisma.supplierInvoice.count({ where }),
    prisma.supplierInvoice.findMany({
      where,
      orderBy: { invoiceDate: "desc" },
      skip: (page - 1) * taille,
      take: taille,
      include: {
        supplier: { select: { code: true, label1: true } },
        order: { select: { number: true } },
        receipt: { select: { number: true } },
        lines: { orderBy: { lineNo: "asc" } },
      },
    }),
  ]);

  return { lignes, total, page, taille, pages: Math.max(1, Math.ceil(total / taille)) };
}

/** Receptions en attente de decision qualite. */
export async function receptionsEnAttenteQualite() {
  return prisma.goodsReceipt.findMany({
    where: { status: "EN_CONTROLE_QUALITE" },
    orderBy: { receiptDate: "asc" },
    include: {
      supplier: { select: { code: true, label1: true } },
      warehouse: { select: { code: true, label: true } },
      lines: {
        orderBy: { lineNo: "asc" },
        include: { item: { select: { code: true, label1: true } } },
      },
    },
    take: 100,
  });
}

/** Indicateurs d'achat destines au tableau de bord. */
export async function indicateursAchats(
  entrees: { dateDebut: Date; dateFin: Date },
  db: Db = prisma,
) {
  const [commandes, receptions, factures, enAttenteQualite] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { orderDate: { gte: entrees.dateDebut, lte: entrees.dateFin } },
      select: { status: true, totalTTC: true, expectedDate: true, orderDate: true },
    }),
    db.goodsReceipt.count({
      where: {
        receiptDate: { gte: entrees.dateDebut, lte: entrees.dateFin },
        status: { not: "ANNULE" },
      },
    }),
    db.supplierInvoice.findMany({
      where: {
        invoiceDate: { gte: entrees.dateDebut, lte: entrees.dateFin },
        status: { not: "ANNULEE" },
      },
      select: { totalTTC: true, paidAmount: true, dueDate: true, threeWayMatched: true },
    }),
    db.goodsReceipt.count({ where: { status: "EN_CONTROLE_QUALITE" } }),
  ]);

  const totalAchats = factures.reduce((total, facture) => D.add(total, facture.totalTTC), D.ZERO);
  const totalRegle = factures.reduce((total, facture) => D.add(total, facture.paidAmount), D.ZERO);
  const maintenant = Date.now();

  return {
    nombreCommandes: commandes.length,
    montantCommandes: D.roundAmount(
      commandes.reduce((total, commande) => D.add(total, commande.totalTTC), D.ZERO),
    ),
    commandesEnRetard: commandes.filter(
      (commande) =>
        commande.expectedDate !== null &&
        commande.expectedDate.getTime() < maintenant &&
        commande.status !== "RECU" &&
        commande.status !== "FACTURE" &&
        commande.status !== "CLOTURE" &&
        commande.status !== "ANNULE",
    ).length,
    nombreReceptions: receptions,
    receptionsEnAttenteQualite: enAttenteQualite,
    nombreFactures: factures.length,
    montantFacture: D.roundAmount(totalAchats),
    montantRegle: D.roundAmount(totalRegle),
    resteAPayer: D.roundAmount(D.sub(totalAchats, totalRegle)),
    facturesEchues: factures.filter(
      (facture) =>
        facture.dueDate !== null &&
        facture.dueDate.getTime() < maintenant &&
        D.gt(D.sub(D.of(facture.totalTTC), D.of(facture.paidAmount)), 0),
    ).length,
    facturesNonRapprochees: factures.filter((facture) => !facture.threeWayMatched).length,
  };
}
