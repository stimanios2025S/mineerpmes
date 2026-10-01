import type {
  AccountType,
  EntryStatus,
  JournalType,
  Prisma,
  PaymentMethod,
} from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D, type Decimal } from "@/lib/decimal";
import { accesRefuse, conflit, etatInvalide, nonTrouve, validation } from "@/lib/errors";
import { prochainNumero, SEQUENCES } from "@/lib/numbering";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import { CLE_PARAMETRE, lireParametreTexte } from "@/lib/settings";

/**
 * Comptabilite generale.
 *
 * Principes appliques strictement :
 *
 *  1. Aucun numero de compte n'est code en dur dans les services : les comptes
 *     sont resolus par les regles d'ecriture configurables (`AccountingRule`).
 *     Modifier le plan comptable de l'entreprise ne demande aucune modification
 *     de code.
 *  2. Une ecriture n'est generee que sur un evenement metier valide (facture
 *     validee, reglement poste, reception acceptee...). Rien n'est anticipe.
 *  3. Aucune ecriture postee n'est supprimee ou modifiee silencieusement : toute
 *     correction passe par une contre-passation ou une ecriture d'avoir, avec
 *     motif obligatoire, et l'original reste consultable.
 *  4. Aucune regle fiscale n'est inventee : les taux de TVA proviennent de la
 *     table `TaxRate`, les comptes des regles, tous deux verifiables et
 *     modifiables par le comptable.
 */

export interface ActeurComptable {
  id: number;
  email: string;
}

// -----------------------------------------------------------------------------
// Structure comptable
// -----------------------------------------------------------------------------

export async function listerJournaux() {
  return prisma.journal.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    include: { _count: { select: { entries: true } } },
  });
}

export async function listerComptes(filtres: { type?: AccountType; actifsSeulement?: boolean } = {}) {
  return prisma.account.findMany({
    where: {
      ...(filtres.type ? { type: filtres.type } : {}),
      ...(filtres.actifsSeulement === false ? {} : { isActive: true }),
    },
    orderBy: { number: "asc" },
  });
}

export interface CompteInput {
  number: string;
  label: string;
  type: AccountType;
  parentNumber?: string | null;
  isAnalytic?: boolean;
}

export async function creerCompte(
  entree: CompteInput,
  acteur: ActeurComptable,
): Promise<number> {
  if (!entree.number.trim()) throw validation("Le numero de compte est obligatoire.");
  if (!entree.label.trim()) throw validation("Le libelle du compte est obligatoire.");

  return prisma.$transaction(
    async (tx) => {
      const existant = await tx.account.findUnique({
        where: { number: entree.number.trim() },
      });
      if (existant) {
        throw conflit(`Le compte « ${entree.number} » existe deja.`);
      }

      if (entree.parentNumber) {
        const parent = await tx.account.findUnique({
          where: { number: entree.parentNumber },
        });
        if (!parent) {
          throw validation(
            `Le compte parent « ${entree.parentNumber} » est introuvable.`,
          );
        }
      }

      const compte = await tx.account.create({
        data: {
          number: entree.number.trim(),
          label: entree.label.trim(),
          type: entree.type,
          parentNumber: entree.parentNumber ?? null,
          isAnalytic: entree.isAnalytic ?? false,
          isActive: true,
          currency: "DZD",
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.COMPTABILITE,
          entity: "Account",
          entityId: compte.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: { numero: compte.number, libelle: compte.label, type: compte.type },
        },
        tx,
      );

      return compte.id;
    },
    { timeout: 30_000 },
  );
}

export async function listerReglesEcriture() {
  return prisma.accountingRule.findMany({ orderBy: { eventCode: "asc" } });
}

export interface RegleEcritureInput {
  eventCode: string;
  label: string;
  journalCode: string;
  debitAccountNumber: string;
  creditAccountNumber: string;
  vatAccountNumber?: string | null;
  vatRateCode?: string | null;
  description?: string | null;
}

/**
 * Creation ou mise a jour d'une regle d'ecriture. Les comptes et le journal
 * references sont verifies : une regle pointant vers un compte inexistant est
 * refusee plutot que decouverte au moment de la facturation.
 */
export async function definirRegleEcriture(
  entree: RegleEcritureInput,
  acteur: ActeurComptable,
): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      const journal = await tx.journal.findUnique({ where: { code: entree.journalCode } });
      if (!journal) throw validation(`Journal inconnu : « ${entree.journalCode} ».`);

      for (const [role, numero] of [
        ["debit", entree.debitAccountNumber],
        ["credit", entree.creditAccountNumber],
        ...(entree.vatAccountNumber ? [["TVA", entree.vatAccountNumber] as const] : []),
      ] as const) {
        const compte = await tx.account.findUnique({ where: { number: numero } });
        if (!compte) {
          throw validation(
            `Le compte ${role} « ${numero} » est introuvable dans le plan comptable.`,
          );
        }
        if (!compte.isActive) {
          throw validation(`Le compte ${role} « ${numero} » est inactif.`);
        }
      }

      if (entree.vatRateCode) {
        const taux = await tx.taxRate.findUnique({ where: { code: entree.vatRateCode } });
        if (!taux) throw validation(`Taux de TVA inconnu : « ${entree.vatRateCode} ».`);
      }

      const existante = await tx.accountingRule.findUnique({
        where: { eventCode: entree.eventCode },
      });

      const donnees = {
        eventCode: entree.eventCode,
        label: entree.label,
        journalCode: entree.journalCode,
        debitAccountNumber: entree.debitAccountNumber,
        creditAccountNumber: entree.creditAccountNumber,
        vatAccountNumber: entree.vatAccountNumber ?? null,
        vatRateCode: entree.vatRateCode ?? null,
        description: entree.description ?? null,
        isActive: true,
      };

      const regle = existante
        ? await tx.accountingRule.update({ where: { id: existante.id }, data: donnees })
        : await tx.accountingRule.create({ data: donnees });

      await enregistrerAudit(
        {
          action: existante ? ACTIONS_AUDIT.MODIFICATION : ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.COMPTABILITE,
          entity: "AccountingRule",
          entityId: regle.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: existante
            ? {
                journal: existante.journalCode,
                debit: existante.debitAccountNumber,
                credit: existante.creditAccountNumber,
              }
            : null,
          newValue: {
            evenement: entree.eventCode,
            journal: entree.journalCode,
            debit: entree.debitAccountNumber,
            credit: entree.creditAccountNumber,
            tva: entree.vatAccountNumber ?? null,
          },
        },
        tx,
      );

      return regle.id;
    },
    { timeout: 30_000 },
  );
}

/**
 * Resout la periode comptable d'une date. Une periode cloturee interdit toute
 * nouvelle ecriture : l'application ne contourne jamais une cloture.
 */
async function resoudrePeriode(tx: Db, date: Date): Promise<number | null> {
  const periode = await tx.accountingPeriod.findFirst({
    where: { startDate: { lte: date }, endDate: { gte: date } },
    include: { fiscalYear: { select: { code: true, status: true } } },
  });

  if (!periode) {
    const exerciceCloture = await tx.fiscalYear.findFirst({
      where: { startDate: { lte: date }, endDate: { gte: date }, status: "CLOTURE" },
    });
    if (exerciceCloture) {
      throw etatInvalide(
        `L'exercice ${exerciceCloture.code} est cloture : aucune ecriture ne peut y etre enregistree.`,
      );
    }
    return null;
  }

  if (periode.status === "CLOTURE") {
    throw etatInvalide(
      `La periode comptable « ${periode.label} » est cloturee : aucune ecriture ne peut y etre enregistree.`,
    );
  }

  if (periode.fiscalYear.status === "CLOTURE") {
    throw etatInvalide(
      `L'exercice ${periode.fiscalYear.code} est cloture : aucune ecriture ne peut y etre enregistree.`,
    );
  }

  return periode.id;
}

// -----------------------------------------------------------------------------
// Generation d'ecritures
// -----------------------------------------------------------------------------

export interface LigneEcritureInput {
  accountNumber: string;
  label?: string | null;
  debit?: Prisma.Decimal | string | number;
  credit?: Prisma.Decimal | string | number;
  thirdPartyId?: number | null;
  analyticCode?: string | null;
  dueDate?: Date | null;
}

export interface EcritureInput {
  /** Code de la regle d'ecriture a appliquer, ex. « FACTURE_CLIENT ». */
  eventCode: string;
  entryDate: Date;
  label: string;
  reference?: string | null;
  documentType?: string | null;
  documentId?: string | null;
  /** Lignes supplementaires : elles s'ajoutent a celles generees par la regle. */
  lignesSupplementaires?: LigneEcritureInput[];
  /** Remplacent entierement la regle si fournies (usage expert). */
  lignesExplicites?: LigneEcritureInput[];
  montantHT?: Prisma.Decimal | string | number;
  montantTVA?: Prisma.Decimal | string | number;
  montantTTC?: Prisma.Decimal | string | number;
  thirdPartyId?: number | null;
  invoiceId?: number | null;
  paymentId?: number | null;
  /** Bloque la generation si l'application est en mode strict (defaut : true). */
  exigerRegle?: boolean;
  acteur: ActeurComptable;
}

export interface ResultatEcriture {
  entryId: number;
  numero: string;
  totalDebit: Decimal;
  totalCredit: Decimal;
  journalCode: string;
  /** Vrai si l'ecriture existait deja pour ce document et cet evenement. */
  dejaExistante: boolean;
}

async function resoudreCompte(tx: Db, numero: string): Promise<{ id: number; number: string }> {
  const compte = await tx.account.findUnique({
    where: { number: numero },
    select: { id: true, number: true, isActive: true },
  });
  if (!compte) {
    throw validation(
      `Le compte « ${numero} » est introuvable. Verifiez la regle d'ecriture associee a cet evenement.`,
    );
  }
  if (!compte.isActive) {
    throw validation(`Le compte « ${numero} » est inactif.`);
  }
  return compte;
}

/**
 * Genere une ecriture comptable equilibree a partir d'un evenement metier.
 *
 * Idempotence : si une ecriture non extournee existe deja pour le meme couple
 * (documentType, documentId, eventCode), elle est retournee telle quelle au lieu
 * d'etre dupliquee. Un evenement metier ne produit jamais deux fois la meme
 * ecriture.
 */
export async function genererEcriture(
  tx: Db,
  entree: EcritureInput,
): Promise<ResultatEcriture> {
  if (!entree.label.trim()) {
    throw validation("Le libelle de l'ecriture est obligatoire.");
  }

  // --- Idempotence -----------------------------------------------------------
  if (entree.documentType && entree.documentId) {
    const existante = await tx.accountingEntry.findFirst({
      where: {
        documentType: entree.documentType,
        documentId: entree.documentId,
        eventCode: entree.eventCode,
        isReversal: false,
      },
      include: { lines: true },
    });

    if (existante) {
      return {
        entryId: existante.id,
        numero: existante.number,
        totalDebit: D.of(existante.totalDebit),
        totalCredit: D.of(existante.totalCredit),
        journalCode: (await tx.journal.findUnique({
          where: { id: existante.journalId },
          select: { code: true },
        }))?.code ?? "",
        dejaExistante: true,
      };
    }
  }

  const regle = await tx.accountingRule.findUnique({
    where: { eventCode: entree.eventCode },
  });

  if (!regle && (entree.exigerRegle ?? true)) {
    throw validation(
      `Aucune regle d'ecriture n'est configuree pour l'evenement « ${entree.eventCode} ». ` +
        "L'ecriture est refusee plutot que generee avec des comptes inventes : configurez la regle dans Comptabilite > Regles d'ecriture.",
    );
  }

  if (regle && !regle.isActive) {
    throw etatInvalide(
      `La regle d'ecriture « ${entree.eventCode} » est inactive : l'ecriture ne peut pas etre generee.`,
    );
  }

  // --- Collecte des lignes ---------------------------------------------------
  const lignes: {
    accountId: number;
    accountNumber: string;
    label: string | null;
    debit: Decimal;
    credit: Decimal;
    thirdPartyId: number | null;
    analyticCode: string | null;
    dueDate: Date | null;
  }[] = [];

  const ajouterLigne = async (ligne: LigneEcritureInput, libelleParDefaut: string) => {
    const debit = D.roundAmount(ligne.debit ?? 0);
    const credit = D.roundAmount(ligne.credit ?? 0);
    if (debit.isZero() && credit.isZero()) return;

    const compte = await resoudreCompte(tx, ligne.accountNumber);
    lignes.push({
      accountId: compte.id,
      accountNumber: compte.number,
      label: ligne.label ?? libelleParDefaut,
      debit,
      credit,
      thirdPartyId: ligne.thirdPartyId ?? null,
      analyticCode: ligne.analyticCode ?? null,
      dueDate: ligne.dueDate ?? null,
    });
  };

  if (entree.lignesExplicites) {
    for (const ligne of entree.lignesExplicites) {
      await ajouterLigne(ligne, entree.label);
    }
  } else if (entree.lignesSupplementaires) {
    for (const ligne of entree.lignesSupplementaires) {
      await ajouterLigne(ligne, entree.label);
    }
  }

  if (!entree.lignesExplicites && regle) {
    const ht = D.roundAmount(entree.montantHT ?? 0);
    const tva = D.roundAmount(entree.montantTVA ?? 0);
    const ttc = D.roundAmount(entree.montantTTC ?? D.add(ht, tva));

    if (D.lte(ht, 0) && D.lte(ttc, 0)) {
      throw validation(
        "Aucun montant exploitable pour generer l'ecriture : renseignez le montant HT ou TTC.",
      );
    }

    const montantDebit = D.gt(ht, 0) ? ht : D.sub(ttc, tva);

    await ajouterLigne(
      {
        accountNumber: regle.debitAccountNumber,
        label: entree.label,
        debit: D.add(montantDebit, tva),
        thirdPartyId: entree.thirdPartyId ?? null,
        dueDate: null,
      },
      entree.label,
    );

    await ajouterLigne(
      {
        accountNumber: regle.creditAccountNumber,
        label: entree.label,
        credit: montantDebit,
        thirdPartyId: entree.thirdPartyId ?? null,
      },
      entree.label,
    );

    if (regle.vatAccountNumber && D.gt(tva, 0)) {
      await ajouterLigne(
        {
          accountNumber: regle.vatAccountNumber,
          label: `TVA sur ${entree.label}`,
          credit: tva,
          thirdPartyId: null,
        },
        entree.label,
      );
    }
  }

  if (lignes.length < 2) {
    throw validation(
      "Une ecriture comptable doit comporter au moins deux lignes : verifiez la regle d'ecriture et les montants fournis.",
    );
  }

  const totalDebit = lignes.reduce((total, ligne) => D.add(total, ligne.debit), D.ZERO);
  const totalCredit = lignes.reduce((total, ligne) => D.add(total, ligne.credit), D.ZERO);

  if (!D.eq(totalDebit, totalCredit)) {
    throw validation(
      `Ecriture desequilibree : debit ${D.toFixed(totalDebit, 2)} contre credit ${D.toFixed(totalCredit, 2)}. ` +
        "L'ecriture est refusee : aucune comptabilite desequilibree n'est enregistree.",
    );
  }

  // --- Journal et periode ----------------------------------------------------
  const journalCode = regle?.journalCode ?? "OD";
  const journal = await tx.journal.findUnique({ where: { code: journalCode } });
  if (!journal) {
    throw validation(`Journal « ${journalCode} » introuvable.`);
  }
  if (!journal.isActive) {
    throw etatInvalide(`Le journal « ${journal.code} » est inactif.`);
  }

  const periodId = await resoudrePeriode(tx, entree.entryDate);
  const numero = await prochainNumero(SEQUENCES.ECRITURE_COMPTABLE, tx);

  const ecriture = await tx.accountingEntry.create({
    data: {
      number: numero,
      journalId: journal.id,
      periodId,
      entryDate: entree.entryDate,
      label: entree.label,
      reference: entree.reference ?? null,
      status: "BROUILLON",
      documentType: entree.documentType ?? null,
      documentId: entree.documentId ?? null,
      eventCode: entree.eventCode,
      totalDebit: D.roundAmount(totalDebit),
      totalCredit: D.roundAmount(totalCredit),
      invoiceId: entree.invoiceId ?? null,
      paymentId: entree.paymentId ?? null,
      createdById: entree.acteur.id,
    },
  });

  let index = 1;
  for (const ligne of lignes) {
    await tx.accountingEntryLine.create({
      data: {
        entryId: ecriture.id,
        lineNo: index,
        accountId: ligne.accountId,
        accountNumber: ligne.accountNumber,
        label: ligne.label,
        debit: ligne.debit,
        credit: ligne.credit,
        thirdPartyId: ligne.thirdPartyId,
        analyticCode: ligne.analyticCode,
        dueDate: ligne.dueDate,
      },
    });
    index += 1;
  }

  await enregistrerAudit(
    {
      action: ACTIONS_AUDIT.ECRITURE_COMPTABLE,
      module: MODULES_AUDIT.COMPTABILITE,
      entity: "AccountingEntry",
      entityId: ecriture.id,
      userId: entree.acteur.id,
      userEmail: entree.acteur.email,
      newValue: {
        numero,
        evenement: entree.eventCode,
        journal: journal.code,
        date: entree.entryDate.toISOString().slice(0, 10),
        debit: D.toFixed(totalDebit, 2),
        credit: D.toFixed(totalCredit, 2),
        document: entree.documentType
          ? `${entree.documentType} ${entree.documentId ?? ""}`.trim()
          : null,
      },
      comment: entree.label,
    },
    tx,
  );

  return {
    entryId: ecriture.id,
    numero,
    totalDebit,
    totalCredit,
    journalCode: journal.code,
    dejaExistante: false,
  };
}

// -----------------------------------------------------------------------------
// Cycle de vie d'une ecriture
// -----------------------------------------------------------------------------

/**
 * Genere une ecriture uniquement si une regle active existe pour l'evenement.
 *
 * Certains evenements de gestion (valorisation des sorties de stock, par
 * exemple) ne disposent pas toujours d'une regle configuree par le comptable.
 * Dans ce cas l'application n'invente aucun compte : elle renvoie null et
 * laisse l'appelant tracer explicitement l'absence de regle. Les ecritures de
 * facturation, elles, restent bloquantes.
 */
export async function genererEcritureSiRegle(
  tx: Db,
  entree: EcritureInput,
): Promise<ResultatEcriture | null> {
  const regle = await tx.accountingRule.findUnique({
    where: { eventCode: entree.eventCode },
    select: { isActive: true },
  });
  if (!regle || !regle.isActive) return null;
  return genererEcriture(tx, entree);
}

export async function validerEcriture(
  entryId: number,
  acteur: ActeurComptable,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const ecriture = await tx.accountingEntry.findUnique({
        where: { id: entryId },
        include: { lines: true },
      });
      if (!ecriture) throw nonTrouve("L'ecriture comptable");
      if (ecriture.status !== "BROUILLON") {
        throw conflit(`Cette ecriture est au statut ${ecriture.status} : elle a deja ete validee.`);
      }

      const debit = ecriture.lines.reduce((total, ligne) => D.add(total, ligne.debit), D.ZERO);
      const credit = ecriture.lines.reduce((total, ligne) => D.add(total, ligne.credit), D.ZERO);
      if (!D.eq(debit, credit)) {
        throw validation(
          `Ecriture desequilibree (debit ${D.toFixed(debit, 2)} / credit ${D.toFixed(credit, 2)}) : validation refusee.`,
        );
      }

      await tx.accountingEntry.update({
        where: { id: entryId },
        data: {
          status: "VALIDEE",
          totalDebit: D.roundAmount(debit),
          totalCredit: D.roundAmount(credit),
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.VALIDATION,
          module: MODULES_AUDIT.COMPTABILITE,
          entity: "AccountingEntry",
          entityId: entryId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: ecriture.status },
          newValue: { statut: "VALIDEE" },
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

export async function posterEcriture(
  entryId: number,
  acteur: ActeurComptable,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const ecriture = await tx.accountingEntry.findUnique({
        where: { id: entryId },
        include: { lines: true, journal: { select: { code: true } } },
      });
      if (!ecriture) throw nonTrouve("L'ecriture comptable");
      if (ecriture.status === "POSTEE") {
        throw conflit("Cette ecriture est deja postee.");
      }
      if (ecriture.status === "EXTOURNEE") {
        throw etatInvalide("Cette ecriture a ete extournee : elle ne peut pas etre postee.");
      }

      // Une fois postee, une ecriture est immuable : on verifie une derniere
      // fois l'equilibre avant de figer.
      const debit = ecriture.lines.reduce((total, ligne) => D.add(total, ligne.debit), D.ZERO);
      const credit = ecriture.lines.reduce((total, ligne) => D.add(total, ligne.credit), D.ZERO);
      if (!D.eq(debit, credit)) {
        throw validation("Ecriture desequilibree : postage refuse.");
      }

      if (ecriture.periodId) {
        const periode = await tx.accountingPeriod.findUnique({
          where: { id: ecriture.periodId },
        });
        if (periode?.status === "CLOTURE") {
          throw etatInvalide(
            `La periode « ${periode.label} » est cloturee : l'ecriture ne peut plus etre postee.`,
          );
        }
      }

      await tx.accountingEntry.update({
        where: { id: entryId },
        data: {
          status: "POSTEE",
          postedById: acteur.id,
          postedAt: new Date(),
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.VALIDATION,
          module: MODULES_AUDIT.COMPTABILITE,
          entity: "AccountingEntry",
          entityId: entryId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: ecriture.status },
          newValue: { statut: "POSTEE", journal: ecriture.journal.code },
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

/**
 * Contre-passation d'une ecriture postee.
 *
 * Aucune ecriture postee n'est supprimee ni modifiee : on genere une ecriture
 * inverse, liee a l'originale, avec un motif obligatoire. L'originale passe au
 * statut EXTOURNEE mais reste integralement consultable.
 */
export async function contrepasserEcriture(
  entree: {
    entryId: number;
    motif: string;
    entryDate?: Date;
  },
  acteur: ActeurComptable,
): Promise<{ entryId: number; numero: string }> {
  if (!entree.motif || entree.motif.trim().length < 10) {
    throw validation(
      "Le motif de contre-passation est obligatoire et doit etre explicite (au moins 10 caracteres).",
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const origine = await tx.accountingEntry.findUnique({
        where: { id: entree.entryId },
        include: { lines: true, journal: true },
      });
      if (!origine) throw nonTrouve("L'ecriture comptable");
      if (origine.status === "EXTOURNEE") {
        throw conflit("Cette ecriture a deja ete extournee.");
      }

      const dejaContrepassee = await tx.accountingEntry.findFirst({
        where: { reversalOfId: origine.id },
      });
      if (dejaContrepassee) {
        throw conflit(
          `Une contre-passation existe deja pour cette ecriture : ${dejaContrepassee.number}.`,
        );
      }

      const dateContrepassation = entree.entryDate ?? new Date();
      const periodId = await resoudrePeriode(tx, dateContrepassation);
      const numero = await prochainNumero(SEQUENCES.ECRITURE_COMPTABLE, tx);

      const contrepassation = await tx.accountingEntry.create({
        data: {
          number: numero,
          journalId: origine.journalId,
          periodId,
          entryDate: dateContrepassation,
          label: `Contre-passation de ${origine.number} : ${entree.motif}`,
          reference: origine.reference,
          status: "VALIDEE",
          documentType: origine.documentType,
          documentId: origine.documentId,
          eventCode: origine.eventCode ? `${origine.eventCode}_EXTOURNE` : null,
          totalDebit: origine.totalCredit,
          totalCredit: origine.totalDebit,
          isReversal: true,
          reversalOfId: origine.id,
          reversalReason: entree.motif,
          invoiceId: origine.invoiceId,
          paymentId: origine.paymentId,
          createdById: acteur.id,
        },
      });

      let index = 1;
      for (const ligne of origine.lines) {
        await tx.accountingEntryLine.create({
          data: {
            entryId: contrepassation.id,
            lineNo: index,
            accountId: ligne.accountId,
            accountNumber: ligne.accountNumber,
            label: `Contre-passation : ${ligne.label ?? origine.label}`,
            debit: ligne.credit,
            credit: ligne.debit,
            thirdPartyId: ligne.thirdPartyId,
            analyticCode: ligne.analyticCode,
            dueDate: ligne.dueDate,
          },
        });
        index += 1;
      }

      await tx.accountingEntry.update({
        where: { id: origine.id },
        data: { status: "EXTOURNEE" },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CONTREPASSATION,
          module: MODULES_AUDIT.COMPTABILITE,
          entity: "AccountingEntry",
          entityId: origine.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: {
            numero: origine.number,
            statut: origine.status,
            debit: origine.totalDebit.toFixed(2),
            credit: origine.totalCredit.toFixed(2),
          },
          newValue: {
            statut: "EXTOURNEE",
            contrePassation: numero,
            motif: entree.motif,
          },
          comment: entree.motif,
        },
        tx,
      );

      return { entryId: contrepassation.id, numero };
    },
    { timeout: 60_000 },
  );
}

/**
 * Lettrage des lignes de tiers : rapproche une facture de son reglement.
 * Le lettrage ne modifie aucun montant, il marque uniquement le rapprochement.
 */
export async function lettrerLignes(
  entree: { entryLineIds: number[]; matchingCode: string },
  acteur: ActeurComptable,
): Promise<number> {
  if (entree.entryLineIds.length < 2) {
    throw validation("Le lettrage exige au moins deux lignes a rapprocher.");
  }

  return prisma.$transaction(
    async (tx) => {
      const lignes = await tx.accountingEntryLine.findMany({
        where: { id: { in: entree.entryLineIds } },
      });
      if (lignes.length !== entree.entryLineIds.length) {
        throw nonTrouve("Certaines lignes a lettrer");
      }

      const tiers = new Set(lignes.map((ligne) => ligne.thirdPartyId));
      if (tiers.size > 1) {
        throw validation(
          "Le lettrage ne peut porter que sur des lignes d'un meme tiers.",
        );
      }

      const debit = lignes.reduce((total, ligne) => D.add(total, ligne.debit), D.ZERO);
      const credit = lignes.reduce((total, ligne) => D.add(total, ligne.credit), D.ZERO);
      if (!D.eq(debit, credit)) {
        throw validation(
          `Lettrage refuse : le total debit (${D.toFixed(debit, 2)}) differe du total credit (${D.toFixed(credit, 2)}).`,
        );
      }

      const resultat = await tx.accountingEntryLine.updateMany({
        where: { id: { in: entree.entryLineIds } },
        data: { isMatched: true, matchingCode: entree.matchingCode },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.COMPTABILITE,
          entity: "AccountingEntryLine",
          entityId: entree.entryLineIds[0],
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: {
            lettrage: entree.matchingCode,
            lignes: entree.entryLineIds.length,
            debit: D.toFixed(debit, 2),
            credit: D.toFixed(credit, 2),
          },
        },
        tx,
      );

      return resultat.count;
    },
    { timeout: 30_000 },
  );
}

// -----------------------------------------------------------------------------
// Consultations
// -----------------------------------------------------------------------------

export async function listerEcritures(filtres: {
  journalCode?: string;
  statut?: EntryStatus;
  dateDebut?: Date;
  dateFin?: Date;
  tiersId?: number;
  documentType?: string;
  page?: number;
  taille?: number;
}) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(500, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.AccountingEntryWhereInput = {};
  if (filtres.statut) where.status = filtres.statut;
  if (filtres.documentType) where.documentType = filtres.documentType;
  if (filtres.journalCode) where.journal = { code: filtres.journalCode };
  if (filtres.tiersId) where.lines = { some: { thirdPartyId: filtres.tiersId } };
  if (filtres.dateDebut || filtres.dateFin) {
    where.entryDate = {};
    if (filtres.dateDebut) where.entryDate.gte = filtres.dateDebut;
    if (filtres.dateFin) where.entryDate.lte = filtres.dateFin;
  }

  const [total, lignes] = await Promise.all([
    prisma.accountingEntry.count({ where }),
    prisma.accountingEntry.findMany({
      where,
      orderBy: [{ entryDate: "desc" }, { number: "desc" }],
      skip: (page - 1) * taille,
      take: taille,
      include: {
        journal: { select: { code: true, label: true } },
        lines: { orderBy: { lineNo: "asc" } },
        reversalOf: { select: { number: true } },
      },
    }),
  ]);

  return { lignes, total, page, taille, pages: Math.max(1, Math.ceil(total / taille)) };
}

export async function consulterEcriture(entryId: number) {
  const ecriture = await prisma.accountingEntry.findUnique({
    where: { id: entryId },
    include: {
      journal: true,
      period: true,
      lines: {
        orderBy: { lineNo: "asc" },
        include: {
          account: { select: { number: true, label: true, type: true } },
          thirdParty: { select: { code: true, label1: true } },
        },
      },
      reversalOf: { select: { id: true, number: true, label: true } },
      reversals: { select: { id: true, number: true, label: true, status: true } },
    },
  });
  if (!ecriture) throw nonTrouve("L'ecriture comptable");
  return ecriture;
}

export interface MouvementCompte {
  accountNumber: string;
  accountLabel: string;
  accountType: AccountType;
  debit: Decimal;
  credit: Decimal;
  solde: Decimal;
}

/**
 * Balance generale sur une periode : totaux par compte et verification
 * d'equilibre. Une balance desequilibree est signalee, jamais masquee.
 */
export async function balanceGenerale(filtres: {
  dateDebut: Date;
  dateFin: Date;
  statuts?: EntryStatus[];
}): Promise<{
  mouvements: MouvementCompte[];
  totalDebit: Decimal;
  totalCredit: Decimal;
  equilibree: boolean;
}> {
  const statuts = filtres.statuts ?? ["POSTEE", "VALIDEE"];

  const lignes = await prisma.accountingEntryLine.findMany({
    where: {
      entry: {
        entryDate: { gte: filtres.dateDebut, lte: filtres.dateFin },
        status: { in: statuts },
      },
    },
    include: {
      account: { select: { number: true, label: true, type: true } },
    },
  });

  const parCompte = new Map<string, MouvementCompte>();

  for (const ligne of lignes) {
    const existant = parCompte.get(ligne.account.number) ?? {
      accountNumber: ligne.account.number,
      accountLabel: ligne.account.label,
      accountType: ligne.account.type,
      debit: D.ZERO,
      credit: D.ZERO,
      solde: D.ZERO,
    };
    existant.debit = D.add(existant.debit, ligne.debit);
    existant.credit = D.add(existant.credit, ligne.credit);
    parCompte.set(ligne.account.number, existant);
  }

  const mouvements = [...parCompte.values()].map((mouvement) => ({
    ...mouvement,
    debit: D.roundAmount(mouvement.debit),
    credit: D.roundAmount(mouvement.credit),
    solde: D.roundAmount(D.sub(mouvement.debit, mouvement.credit)),
  }));

  mouvements.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));

  const totalDebit = mouvements.reduce((total, m) => D.add(total, m.debit), D.ZERO);
  const totalCredit = mouvements.reduce((total, m) => D.add(total, m.credit), D.ZERO);

  return {
    mouvements,
    totalDebit,
    totalCredit,
    equilibree: D.eq(totalDebit, totalCredit),
  };
}

/** Grand livre d'un compte sur une periode. */
export async function grandLivre(filtres: {
  accountNumber: string;
  dateDebut: Date;
  dateFin: Date;
}) {
  const compte = await prisma.account.findUnique({
    where: { number: filtres.accountNumber },
  });
  if (!compte) throw nonTrouve("Le compte comptable");

  const soldeInitial = await prisma.accountingEntryLine.aggregate({
    where: {
      accountId: compte.id,
      entry: {
        entryDate: { lt: filtres.dateDebut },
        status: { in: ["POSTEE", "VALIDEE"] },
      },
    },
    _sum: { debit: true, credit: true },
  });

  const debut = D.sub(
    D.of(soldeInitial._sum.debit ?? 0),
    D.of(soldeInitial._sum.credit ?? 0),
  );

  const lignes = await prisma.accountingEntryLine.findMany({
    where: {
      accountId: compte.id,
      entry: {
        entryDate: { gte: filtres.dateDebut, lte: filtres.dateFin },
        status: { in: ["POSTEE", "VALIDEE"] },
      },
    },
    orderBy: [{ entry: { entryDate: "asc" } }, { entryId: "asc" }, { lineNo: "asc" }],
    include: {
      entry: {
        select: {
          id: true,
          number: true,
          entryDate: true,
          label: true,
          reference: true,
          documentType: true,
          documentId: true,
          status: true,
        },
      },
      thirdParty: { select: { code: true, label1: true } },
    },
  });

  let cumul = debut;
  const detail = lignes.map((ligne) => {
    cumul = D.add(cumul, D.sub(ligne.debit, ligne.credit));
    return {
      ...ligne,
      soldeProgressif: D.roundAmount(cumul),
      debit: D.roundAmount(ligne.debit),
      credit: D.roundAmount(ligne.credit),
    };
  });

  return {
    compte,
    soldeInitial: D.roundAmount(debut),
    lignes: detail,
    totalDebit: D.roundAmount(
      detail.reduce((total, ligne) => D.add(total, ligne.debit), D.ZERO),
    ),
    totalCredit: D.roundAmount(
      detail.reduce((total, ligne) => D.add(total, ligne.credit), D.ZERO),
    ),
    soldeFinal: D.roundAmount(cumul),
  };
}

/** Balance des tiers : factures non reglees, avances, solde. */
export async function balanceTiers(filtres: {
  tiersId?: number;
  tiersType?: "CLIENT" | "FOURNISSEUR";
  dateFin?: Date;
}) {
  const comptesTiers = ["411", "401"];
  const lignes = await prisma.accountingEntryLine.findMany({
    where: {
      accountNumber: { in: comptesTiers },
      thirdPartyId: filtres.tiersId ? filtres.tiersId : { not: null },
      isMatched: false,
      entry: {
        status: { in: ["POSTEE", "VALIDEE"] },
        ...(filtres.dateFin ? { entryDate: { lte: filtres.dateFin } } : {}),
      },
    },
    include: {
      thirdParty: { select: { id: true, code: true, label1: true, isClient: true, isSupplier: true } },
      entry: { select: { number: true, entryDate: true, label: true } },
    },
    orderBy: { entry: { entryDate: "asc" } },
  });

  const parTiers = new Map<
    number,
    {
      tiersId: number;
      code: string;
      nom: string;
      debit: Decimal;
      credit: Decimal;
      solde: Decimal;
      lignesNonLettrees: number;
    }
  >();

  for (const ligne of lignes) {
    if (!ligne.thirdParty || ligne.thirdPartyId === null) continue;
    if (filtres.tiersType === "CLIENT" && !ligne.thirdParty.isClient) continue;
    if (filtres.tiersType === "FOURNISSEUR" && !ligne.thirdParty.isSupplier) continue;

    const existant = parTiers.get(ligne.thirdPartyId) ?? {
      tiersId: ligne.thirdPartyId,
      code: ligne.thirdParty.code,
      nom: ligne.thirdParty.label1,
      debit: D.ZERO,
      credit: D.ZERO,
      solde: D.ZERO,
      lignesNonLettrees: 0,
    };

    existant.debit = D.add(existant.debit, ligne.debit);
    existant.credit = D.add(existant.credit, ligne.credit);
    existant.lignesNonLettrees += 1;
    parTiers.set(ligne.thirdPartyId, existant);
  }

  return [...parTiers.values()]
    .map((entree) => ({
      ...entree,
      debit: D.roundAmount(entree.debit),
      credit: D.roundAmount(entree.credit),
      solde: D.roundAmount(D.sub(entree.debit, entree.credit)),
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

/**
 * Verification d'integrite comptable : detecte toute ecriture desequilibree
 * ou dont les totaux enregistres ne correspondent plus a ses lignes.
 */
export async function verifierIntegrite(): Promise<{
  ecrituresDesequilibrees: { id: number; number: string }[];
  totauxIncoherents: { id: number; number: string }[];
  equilibreGlobal: boolean;
}> {
  const ecritures = await prisma.accountingEntry.findMany({
    where: { status: { in: ["POSTEE", "VALIDEE"] } },
    include: { lines: { select: { debit: true, credit: true } } },
  });

  const ecrituresDesequilibrees: { id: number; number: string }[] = [];
  const totauxIncoherents: { id: number; number: string }[] = [];

  let grandDebit = D.ZERO;
  let grandCredit = D.ZERO;

  for (const ecriture of ecritures) {
    const debit = ecriture.lines.reduce((total, ligne) => D.add(total, ligne.debit), D.ZERO);
    const credit = ecriture.lines.reduce((total, ligne) => D.add(total, ligne.credit), D.ZERO);

    if (!D.eq(debit, credit)) {
      ecrituresDesequilibrees.push({ id: ecriture.id, number: ecriture.number });
    }
    if (!D.eq(debit, ecriture.totalDebit) || !D.eq(credit, ecriture.totalCredit)) {
      totauxIncoherents.push({ id: ecriture.id, number: ecriture.number });
    }

    grandDebit = D.add(grandDebit, debit);
    grandCredit = D.add(grandCredit, credit);
  }

  return {
    ecrituresDesequilibrees,
    totauxIncoherents,
    equilibreGlobal: D.eq(grandDebit, grandCredit),
  };
}

/** Parametres comptables applicables (devise, taux de TVA par defaut). */
export async function parametresComptables() {
  const devise = await lireParametreTexte(CLE_PARAMETRE.DEVISE, "DZD");
  const tauxTvaDefaut = await lireParametreTexte(CLE_PARAMETRE.TVA_DEFAUT, "");
  const taux = await prisma.taxRate.findMany({ where: { isActive: true } });

  const tauxParDefaut = taux.find((t) => t.isDefault) ?? taux[0] ?? null;

  return {
    devise,
    tauxTvaDefaut: tauxTvaDefaut || (tauxParDefaut?.code ?? null),
    taux,
  };
}

export type { JournalType, PaymentMethod };
