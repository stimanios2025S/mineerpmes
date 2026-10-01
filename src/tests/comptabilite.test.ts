/**
 * Tests d'integration de la comptabilite generale.
 *
 * Ils s'executent contre la vraie base PostgreSQL (`erpmes_test`) : aucun
 * service n'est mocke, aucun acces Prisma n'est simule. Les journaux, comptes,
 * regles, exercice et periodes proviennent du referentiel seme ; les donnees
 * propres au test portent un jeton unique et sont supprimees en fin de fichier.
 *
 * Regles verifiees ici :
 *  - les comptes utilises proviennent des regles d'ecriture configurees, jamais
 *    d'un compte code en dur ou devine ;
 *  - une ecriture generee est equilibree au dix-millieme ;
 *  - un evenement metier ne produit jamais deux fois la meme ecriture ;
 *  - une ecriture postee est figee et n'est jamais supprimee : la correction
 *    passe par une contre-passation motivee ;
 *  - une periode ou un exercice cloture bloque toute nouvelle ecriture.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, type AccountType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { acteurTest, jeton, type ActeurTest } from "@/tests/aide";
import {
  balanceGenerale,
  balanceTiers,
  contrepasserEcriture,
  definirRegleEcriture,
  genererEcriture,
  genererEcritureSiRegle,
  grandLivre,
  posterEcriture,
  validerEcriture,
  verifierIntegrite,
} from "@/lib/comptabilite/service";

const PREFIXE = jeton("CPT");
const ANNEE = new Date().getFullYear();

/**
 * Mois utilises par les tests. Les ecritures de cycle de vie sont datees en
 * janvier de l'exercice courant (periode ouverte du referentiel), celles des
 * balances en fevrier : les totaux de balance restent ainsi strictement limites
 * aux ecritures creees par le test concerne.
 */
const JANVIER = 0;
const FEVRIER = 1;
const MARS = 2;

function dateDuMois(mois: number, jour: number, heure = 10): Date {
  return new Date(Date.UTC(ANNEE, mois, jour, heure, 0, 0));
}

function debutDuMois(mois: number): Date {
  return new Date(Date.UTC(ANNEE, mois, 1, 0, 0, 0));
}

function finDuMois(mois: number): Date {
  return new Date(Date.UTC(ANNEE, mois + 1, 0, 23, 59, 59));
}

function decimal(valeur: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(valeur);
}

function zero(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

let acteur: ActeurTest;
let compteDebit: string;
let compteCredit: string;
let compteTva: string;
let evenement: string;
let evenementTiers: string;
let tiersId: number;

/** Identifiants des ecritures creees par le test, pour un nettoyage exact. */
const ecrituresCreees: number[] = [];

async function erreurAttendue(action: () => Promise<unknown>): Promise<DomainError> {
  try {
    await action();
  } catch (erreur) {
    expect(erreur).toBeInstanceOf(DomainError);
    return erreur as DomainError;
  }
  throw new Error("Une erreur metier etait attendue, mais aucune n'a ete levee.");
}

async function creerCompte(suffixe: string, type: AccountType): Promise<string> {
  const numero = `${PREFIXE}${suffixe}`;
  await prisma.account.create({
    data: {
      number: numero,
      label: `Compte de test ${suffixe}`,
      type,
      isActive: true,
      currency: "DZD",
    },
  });
  return numero;
}

/** Genere une ecriture via le service reel et memorise son identifiant. */
async function generer(entree: {
  entryDate: Date;
  documentId: string;
  eventCode?: string;
  label?: string;
  montantHT?: string;
  montantTVA?: string;
  thirdPartyId?: number | null;
}) {
  const resultat = await genererEcriture(prisma, {
    eventCode: entree.eventCode ?? evenement,
    entryDate: entree.entryDate,
    label: entree.label ?? "Ecriture de test",
    documentType: `${PREFIXE}DOC`,
    documentId: entree.documentId,
    montantHT: entree.montantHT ?? "100.00",
    montantTVA: entree.montantTVA ?? "0",
    thirdPartyId: entree.thirdPartyId ?? null,
    acteur,
  });
  ecrituresCreees.push(resultat.entryId);
  return resultat;
}

beforeAll(async () => {
  acteur = await acteurTest();

  compteDebit = await creerCompte("D", "CHARGE");
  compteCredit = await creerCompte("C", "PRODUIT");
  compteTva = await creerCompte("T", "PASSIF");

  evenement = `${PREFIXE}EV1`;
  evenementTiers = `${PREFIXE}EV2`;

  await definirRegleEcriture(
    {
      eventCode: evenement,
      label: "Evenement de test - ecriture equilibree",
      journalCode: "OD",
      debitAccountNumber: compteDebit,
      creditAccountNumber: compteCredit,
      vatAccountNumber: compteTva,
      description: "Regle creee par les tests d'integration de la comptabilite.",
    },
    acteur,
  );

  // Regle de tiers : les comptes 411 / 401 sont ceux du plan de comptes seme,
  // utilises par la balance des tiers.
  await definirRegleEcriture(
    {
      eventCode: evenementTiers,
      label: "Evenement de test - client",
      journalCode: "OD",
      debitAccountNumber: "411",
      creditAccountNumber: "701",
    },
    acteur,
  );

  const tiers = await prisma.thirdParty.create({
    data: {
      code: `${PREFIXE}TIERS`,
      type: "CLIENT",
      isClient: true,
      label1: "Client de test comptabilite",
    },
  });
  tiersId = tiers.id;
});

afterAll(async () => {
  // Aucune ecriture postee n'est supprimee : ce nettoyage ne porte que sur les
  // ecritures creees par ce fichier de test dans la base de test.
  if (ecrituresCreees.length > 0) {
    await prisma.accountingEntry.deleteMany({ where: { id: { in: ecrituresCreees } } });
  }
  await prisma.accountingEntry.deleteMany({ where: { eventCode: { startsWith: PREFIXE } } });
  await prisma.accountingRule.deleteMany({ where: { eventCode: { startsWith: PREFIXE } } });
  await prisma.account.deleteMany({ where: { number: { startsWith: PREFIXE } } });
  await prisma.thirdParty.deleteMany({ where: { code: { startsWith: PREFIXE } } });
  await prisma.fiscalYear.deleteMany({ where: { code: { startsWith: PREFIXE } } });
  if (acteur) {
    await prisma.user.deleteMany({ where: { email: acteur.email } });
  }
});

describe("Regles d'ecriture configurables", () => {
  it("refuse une regle pointant vers un compte inexistant plutot que d'inventer un compte", async () => {
    const eventCode = `${PREFIXE}REGLE-INVALIDE`;

    const erreur = await erreurAttendue(() =>
      definirRegleEcriture(
        {
          eventCode,
          label: "Regle de test invalide",
          journalCode: "OD",
          debitAccountNumber: compteDebit,
          creditAccountNumber: `${PREFIXE}INEXISTANT`,
        },
        acteur,
      ),
    );

    expect(erreur.code).toBe("VALIDATION");
    expect(erreur.message).toContain(`${PREFIXE}INEXISTANT`);
    expect(await prisma.accountingRule.count({ where: { eventCode } })).toBe(0);
  });

  it("genere une ecriture equilibree au dix-millieme avec les comptes de la regle", async () => {
    const resultat = await generer({
      entryDate: dateDuMois(JANVIER, 10),
      documentId: `${PREFIXE}DOC-EQUILIBRE`,
      label: "Facture de test equilibree",
      montantHT: "100.005555",
    });

    expect(resultat.dejaExistante).toBe(false);
    expect(resultat.journalCode).toBe("OD");
    expect(resultat.totalDebit.equals(resultat.totalCredit)).toBe(true);
    expect(resultat.totalDebit.toFixed(4)).toBe("100.0056");

    const ecriture = await prisma.accountingEntry.findUnique({
      where: { id: resultat.entryId },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
    expect(ecriture).not.toBeNull();
    expect(ecriture!.status).toBe("BROUILLON");

    // Deux lignes, sur les comptes exactement definis par la regle.
    expect(ecriture!.lines).toHaveLength(2);
    expect(ecriture!.lines[0].accountNumber).toBe(compteDebit);
    expect(ecriture!.lines[0].debit.toFixed(4)).toBe("100.0056");
    expect(ecriture!.lines[0].credit.toFixed(4)).toBe("0.0000");
    expect(ecriture!.lines[1].accountNumber).toBe(compteCredit);
    expect(ecriture!.lines[1].credit.toFixed(4)).toBe("100.0056");
    expect(ecriture!.lines[1].debit.toFixed(4)).toBe("0.0000");

    // Equilibre verifie sur les lignes reellement stockees, pas sur le retour du service.
    const sommeDebit = ecriture!.lines.reduce((total, ligne) => total.plus(ligne.debit), zero());
    const sommeCredit = ecriture!.lines.reduce((total, ligne) => total.plus(ligne.credit), zero());
    expect(sommeDebit.equals(sommeCredit)).toBe(true);
    expect(sommeDebit.toFixed(4)).toBe(ecriture!.totalDebit.toFixed(4));
    expect(sommeCredit.toFixed(4)).toBe(ecriture!.totalCredit.toFixed(4));
  });

  it("ajoute la ligne de TVA lorsque la regle prevoit un compte de TVA et qu'un montant est fourni", async () => {
    // Le montant de TVA est fourni explicitement par l'appelant : aucune regle
    // fiscale ni aucun taux n'est invente par le moteur d'ecriture.
    const resultat = await generer({
      entryDate: dateDuMois(JANVIER, 11),
      documentId: `${PREFIXE}DOC-TVA`,
      label: "Facture de test avec TVA explicite",
      montantHT: "1000.0000",
      montantTVA: "190.0000",
    });

    expect(resultat.totalDebit.toFixed(4)).toBe("1190.0000");
    expect(resultat.totalCredit.toFixed(4)).toBe("1190.0000");
    expect(resultat.totalDebit.equals(resultat.totalCredit)).toBe(true);

    const ecriture = await prisma.accountingEntry.findUnique({
      where: { id: resultat.entryId },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
    expect(ecriture!.lines).toHaveLength(3);
    expect(ecriture!.lines[0].accountNumber).toBe(compteDebit);
    expect(ecriture!.lines[0].debit.toFixed(4)).toBe("1190.0000");
    expect(ecriture!.lines[1].accountNumber).toBe(compteCredit);
    expect(ecriture!.lines[1].credit.toFixed(4)).toBe("1000.0000");
    expect(ecriture!.lines[2].accountNumber).toBe(compteTva);
    expect(ecriture!.lines[2].credit.toFixed(4)).toBe("190.0000");
  });
});

describe("Absence de regle d'ecriture", () => {
  it("bloque la generation au lieu de deviner un compte", async () => {
    const evenementAbsent = `${PREFIXE}ABSENT`;
    const documentId = `${PREFIXE}DOC-SANS-REGLE`;

    const erreur = await erreurAttendue(() =>
      genererEcriture(prisma, {
        eventCode: evenementAbsent,
        entryDate: dateDuMois(JANVIER, 12),
        label: "Evenement sans regle",
        documentType: `${PREFIXE}DOC`,
        documentId,
        montantHT: "500.00",
        acteur,
      }),
    );

    expect(erreur.code).toBe("VALIDATION");
    expect(erreur.message).toContain("Aucune regle d'ecriture");

    // `genererEcritureSiRegle` renvoie null : l'appelant trace l'absence de regle.
    const resultat = await genererEcritureSiRegle(prisma, {
      eventCode: evenementAbsent,
      entryDate: dateDuMois(JANVIER, 12),
      label: "Evenement sans regle",
      documentType: `${PREFIXE}DOC`,
      documentId,
      montantHT: "500.00",
      acteur,
    });
    expect(resultat).toBeNull();

    // Aucune ecriture n'a ete creee pour ce document.
    expect(await prisma.accountingEntry.count({ where: { documentId } })).toBe(0);
  });

  it("bloque la generation lorsqu'une regle existe mais est inactive", async () => {
    const eventCode = `${PREFIXE}EV-INACTIF`;
    await definirRegleEcriture(
      {
        eventCode,
        label: "Evenement de test desactive",
        journalCode: "OD",
        debitAccountNumber: compteDebit,
        creditAccountNumber: compteCredit,
      },
      acteur,
    );
    await prisma.accountingRule.update({ where: { eventCode }, data: { isActive: false } });

    const erreur = await erreurAttendue(() =>
      genererEcriture(prisma, {
        eventCode,
        entryDate: dateDuMois(JANVIER, 12),
        label: "Evenement sur regle inactive",
        documentType: `${PREFIXE}DOC`,
        documentId: `${PREFIXE}DOC-REGLE-INACTIVE`,
        montantHT: "10.00",
        acteur,
      }),
    );
    expect(erreur.code).toBe("ETAT_INVALIDE");
    expect(erreur.message).toContain("inactive");

    const optionnel = await genererEcritureSiRegle(prisma, {
      eventCode,
      entryDate: dateDuMois(JANVIER, 12),
      label: "Evenement sur regle inactive",
      documentType: `${PREFIXE}DOC`,
      documentId: `${PREFIXE}DOC-REGLE-INACTIVE`,
      montantHT: "10.00",
      acteur,
    });
    expect(optionnel).toBeNull();

    expect(
      await prisma.accountingEntry.count({
        where: { documentId: `${PREFIXE}DOC-REGLE-INACTIVE` },
      }),
    ).toBe(0);
  });
});

describe("Idempotence", () => {
  it("ne cree pas de doublon lorsqu'un meme evenement est regenere", async () => {
    const documentId = `${PREFIXE}DOC-IDEMPOTENT`;

    const premier = await generer({
      entryDate: dateDuMois(JANVIER, 13),
      documentId,
      montantHT: "125.5000",
    });
    const second = await generer({
      entryDate: dateDuMois(JANVIER, 13),
      documentId,
      montantHT: "999.9900",
    });

    expect(second.dejaExistante).toBe(true);
    expect(second.entryId).toBe(premier.entryId);
    expect(second.numero).toBe(premier.numero);
    // Le montant retourne est celui de l'ecriture deja enregistree.
    expect(second.totalDebit.toFixed(4)).toBe("125.5000");
    expect(await prisma.accountingEntry.count({ where: { documentId } })).toBe(1);

    // La cle d'idempotence est le triplet document + evenement : un autre
    // evenement sur le meme document reste autorise.
    const autre = await generer({
      entryDate: dateDuMois(JANVIER, 13),
      documentId,
      eventCode: evenementTiers,
      montantHT: "10.0000",
    });
    expect(autre.dejaExistante).toBe(false);
    expect(autre.entryId).not.toBe(premier.entryId);
    expect(await prisma.accountingEntry.count({ where: { documentId } })).toBe(2);
  });
});

describe("Cycle de vie : validation, postage, immuabilite", () => {
  it("valider puis poster fige l'ecriture", async () => {
    const { entryId } = await generer({
      entryDate: dateDuMois(JANVIER, 14),
      documentId: `${PREFIXE}DOC-CYCLE`,
      montantHT: "750.0000",
    });

    await validerEcriture(entryId, acteur);
    let ecriture = await prisma.accountingEntry.findUnique({ where: { id: entryId } });
    expect(ecriture!.status).toBe("VALIDEE");

    const deuxiemeValidation = await erreurAttendue(() => validerEcriture(entryId, acteur));
    expect(deuxiemeValidation.code).toBe("CONFLIT");

    await posterEcriture(entryId, acteur);
    ecriture = await prisma.accountingEntry.findUnique({ where: { id: entryId } });
    expect(ecriture!.status).toBe("POSTEE");
    expect(ecriture!.postedAt).not.toBeNull();
    expect(ecriture!.postedById).toBe(acteur.id);

    const deuxiemePostage = await erreurAttendue(() => posterEcriture(entryId, acteur));
    expect(deuxiemePostage.code).toBe("CONFLIT");

    // Une ecriture postee ne peut plus etre validee (donc plus modifiee) :
    // toute correction passe par une contre-passation.
    const validationApresPostage = await erreurAttendue(() => validerEcriture(entryId, acteur));
    expect(validationApresPostage.code).toBe("CONFLIT");

    const lignes = await prisma.accountingEntryLine.findMany({ where: { entryId } });
    expect(lignes).toHaveLength(2);
    expect(lignes[0].debit.toFixed(4)).toBe("750.0000");
    expect(lignes[1].credit.toFixed(4)).toBe("750.0000");
    expect(ecriture!.totalDebit.toFixed(4)).toBe("750.0000");
    expect(ecriture!.totalCredit.toFixed(4)).toBe("750.0000");
  });
});

describe("Contre-passation", () => {
  it("cree une contre-ecriture equilibree et laisse l'originale intacte en base", async () => {
    const origine = await generer({
      entryDate: dateDuMois(JANVIER, 15),
      documentId: `${PREFIXE}DOC-EXTOURNE`,
      label: "Facture de test a contre-passer",
      montantHT: "1234.5678",
    });
    await validerEcriture(origine.entryId, acteur);
    await posterEcriture(origine.entryId, acteur);

    const avant = await prisma.accountingEntry.findUnique({
      where: { id: origine.entryId },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });

    const motif = "Erreur de saisie constatee sur la piece de test";
    const contrepassation = await contrepasserEcriture(
      { entryId: origine.entryId, motif },
      acteur,
    );
    ecrituresCreees.push(contrepassation.entryId);

    const contreEcriture = await prisma.accountingEntry.findUnique({
      where: { id: contrepassation.entryId },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
    expect(contreEcriture).not.toBeNull();
    expect(contreEcriture!.isReversal).toBe(true);
    expect(contreEcriture!.reversalOfId).toBe(origine.entryId);
    expect(contreEcriture!.reversalReason).toBe(motif);
    expect(contreEcriture!.eventCode).toBe(`${evenement}_EXTOURNE`);
    expect(contreEcriture!.journalId).toBe(avant!.journalId);
    expect(contreEcriture!.totalDebit.equals(avant!.totalCredit)).toBe(true);
    expect(contreEcriture!.totalCredit.equals(avant!.totalDebit)).toBe(true);
    expect(contreEcriture!.totalDebit.equals(contreEcriture!.totalCredit)).toBe(true);

    // Les lignes sont inversees, meme nombre de lignes.
    expect(contreEcriture!.lines).toHaveLength(avant!.lines.length);
    contreEcriture!.lines.forEach((ligne, index) => {
      expect(ligne.accountNumber).toBe(avant!.lines[index].accountNumber);
      expect(ligne.debit.equals(avant!.lines[index].credit)).toBe(true);
      expect(ligne.credit.equals(avant!.lines[index].debit)).toBe(true);
    });

    // L'ecriture d'origine existe toujours, avec son numero et ses montants.
    const apres = await prisma.accountingEntry.findUnique({
      where: { id: origine.entryId },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
    expect(apres).not.toBeNull();
    expect(apres!.number).toBe(avant!.number);
    expect(apres!.status).toBe("EXTOURNEE");
    expect(apres!.totalDebit.equals(avant!.totalDebit)).toBe(true);
    expect(apres!.totalCredit.equals(avant!.totalCredit)).toBe(true);
    expect(apres!.lines).toHaveLength(avant!.lines.length);
    apres!.lines.forEach((ligne, index) => {
      expect(ligne.debit.equals(avant!.lines[index].debit)).toBe(true);
      expect(ligne.credit.equals(avant!.lines[index].credit)).toBe(true);
    });
  });

  it("refuse une contre-passation sans motif explicite", async () => {
    const origine = await generer({
      entryDate: dateDuMois(JANVIER, 16),
      documentId: `${PREFIXE}DOC-SANS-MOTIF`,
      montantHT: "99.0000",
    });
    await validerEcriture(origine.entryId, acteur);
    await posterEcriture(origine.entryId, acteur);

    const sansMotif = await erreurAttendue(() =>
      contrepasserEcriture({ entryId: origine.entryId, motif: "" }, acteur),
    );
    expect(sansMotif.code).toBe("VALIDATION");
    expect(sansMotif.message).toContain("motif");

    const motifTropCourt = await erreurAttendue(() =>
      contrepasserEcriture({ entryId: origine.entryId, motif: "erreur" }, acteur),
    );
    expect(motifTropCourt.code).toBe("VALIDATION");

    // Aucune ecriture n'a ete creee : l'ecriture reste postee.
    expect(await prisma.accountingEntry.count({ where: { reversalOfId: origine.entryId } })).toBe(0);
    const intacte = await prisma.accountingEntry.findUnique({ where: { id: origine.entryId } });
    expect(intacte!.status).toBe("POSTEE");
  });

  it("refuse une double contre-passation", async () => {
    const origine = await generer({
      entryDate: dateDuMois(JANVIER, 17),
      documentId: `${PREFIXE}DOC-DOUBLE-EXTOURNE`,
      montantHT: "42.0000",
    });
    await validerEcriture(origine.entryId, acteur);
    await posterEcriture(origine.entryId, acteur);

    const motif = "Annulation complete de la piece de test";
    const premiere = await contrepasserEcriture({ entryId: origine.entryId, motif }, acteur);
    ecrituresCreees.push(premiere.entryId);

    const deuxieme = await erreurAttendue(() =>
      contrepasserEcriture({ entryId: origine.entryId, motif: "Nouvelle tentative de contre-passation" }, acteur),
    );
    expect(deuxieme.code).toBe("CONFLIT");

    expect(await prisma.accountingEntry.count({ where: { reversalOfId: origine.entryId } })).toBe(1);
    const originale = await prisma.accountingEntry.findUnique({ where: { id: origine.entryId } });
    expect(originale).not.toBeNull();
    expect(originale!.status).toBe("EXTOURNEE");
  });
});

describe("Periode comptable", () => {
  it("refuse une ecriture sur une periode cloturee et sur un exercice cloture", async () => {
    const anneeEloignee = ANNEE + 50;
    const exercice = await prisma.fiscalYear.create({
      data: {
        code: `${PREFIXE}EX`,
        label: "Exercice de test cloture",
        startDate: new Date(Date.UTC(anneeEloignee, 0, 1)),
        endDate: new Date(Date.UTC(anneeEloignee, 11, 31, 23, 59, 59)),
        status: "OUVERT",
      },
    });
    const periode = await prisma.accountingPeriod.create({
      data: {
        fiscalYearId: exercice.id,
        code: `${PREFIXE}P01`,
        label: "Periode de test cloturee",
        startDate: new Date(Date.UTC(anneeEloignee, 2, 1)),
        endDate: new Date(Date.UTC(anneeEloignee, 2, 31, 23, 59, 59)),
        status: "CLOTURE",
      },
    });

    const documentId = `${PREFIXE}DOC-PERIODE`;
    const dateSaisie = new Date(Date.UTC(anneeEloignee, 2, 10, 10, 0, 0));

    const periodeFermee = await erreurAttendue(() =>
      genererEcriture(prisma, {
        eventCode: evenement,
        entryDate: dateSaisie,
        label: "Ecriture sur periode cloturee",
        documentType: `${PREFIXE}DOC`,
        documentId,
        montantHT: "100.00",
        acteur,
      }),
    );
    expect(periodeFermee.code).toBe("ETAT_INVALIDE");
    expect(periodeFermee.message).toContain("cloturee");
    expect(await prisma.accountingEntry.count({ where: { documentId } })).toBe(0);

    // Periode rouverte mais exercice cloture : l'ecriture reste refusee.
    await prisma.accountingPeriod.update({ where: { id: periode.id }, data: { status: "OUVERT" } });
    await prisma.fiscalYear.update({ where: { id: exercice.id }, data: { status: "CLOTURE" } });

    const exerciceFerme = await erreurAttendue(() =>
      genererEcriture(prisma, {
        eventCode: evenement,
        entryDate: dateSaisie,
        label: "Ecriture sur exercice cloture",
        documentType: `${PREFIXE}DOC`,
        documentId,
        montantHT: "100.00",
        acteur,
      }),
    );
    expect(exerciceFerme.code).toBe("ETAT_INVALIDE");
    expect(exerciceFerme.message).toContain("cloture");
    expect(await prisma.accountingEntry.count({ where: { documentId } })).toBe(0);

    // Temoin : une fois la periode et l'exercice rouverts, la meme ecriture passe.
    await prisma.fiscalYear.update({ where: { id: exercice.id }, data: { status: "OUVERT" } });
    const temoin = await generer({
      entryDate: dateSaisie,
      documentId,
      label: "Ecriture temoin apres reouverture",
      montantHT: "100.00",
    });
    expect(temoin.dejaExistante).toBe(false);
    expect(temoin.totalDebit.equals(temoin.totalCredit)).toBe(true);
    expect(await prisma.accountingEntry.count({ where: { documentId } })).toBe(1);
  });
});

describe("Verification d'integrite", () => {
  it("detecte une ecriture desequilibree, puis la disparition de l'anomalie apres restauration", async () => {
    const { entryId } = await generer({
      entryDate: dateDuMois(JANVIER, 18),
      documentId: `${PREFIXE}DOC-INTEGRITE`,
      label: "Ecriture de controle d'integrite",
      montantHT: "600.0000",
    });
    await validerEcriture(entryId, acteur);

    const ligne = await prisma.accountingEntryLine.findFirst({
      where: { entryId },
      orderBy: { lineNo: "asc" },
    });
    expect(ligne).not.toBeNull();
    const debitOrigine = ligne!.debit;

    // Anomalie provoquee volontairement sur une ecriture de test uniquement,
    // puis restauree : les ecritures reelles ne sont jamais alterees.
    try {
      await prisma.accountingEntryLine.update({
        where: { id: ligne!.id },
        data: { debit: debitOrigine.plus(decimal("100.0000")) },
      });

      const rapport = await verifierIntegrite();
      expect(rapport.ecrituresDesequilibrees.map((e) => e.id)).toContain(entryId);
      expect(rapport.totauxIncoherents.map((e) => e.id)).toContain(entryId);
      expect(rapport.equilibreGlobal).toBe(false);
    } finally {
      await prisma.accountingEntryLine.update({
        where: { id: ligne!.id },
        data: { debit: debitOrigine },
      });
    }

    const apres = await verifierIntegrite();
    expect(apres.ecrituresDesequilibrees.map((e) => e.id)).not.toContain(entryId);
    expect(apres.totauxIncoherents.map((e) => e.id)).not.toContain(entryId);
    expect(apres.equilibreGlobal).toBe(true);

    const ligneRestauree = await prisma.accountingEntryLine.findUnique({ where: { id: ligne!.id } });
    expect(ligneRestauree!.debit.equals(debitOrigine)).toBe(true);
  });
});

describe("Consultations : balance generale, grand livre, balance des tiers", () => {
  it("balanceGenerale renvoie des totaux coherents avec les ecritures validees du perimetre", async () => {
    const premier = await generer({
      entryDate: dateDuMois(FEVRIER, 5),
      documentId: `${PREFIXE}DOC-BALANCE-1`,
      montantHT: "1000.0000",
    });
    const second = await generer({
      entryDate: dateDuMois(FEVRIER, 6),
      documentId: `${PREFIXE}DOC-BALANCE-2`,
      montantHT: "250.5000",
    });
    await validerEcriture(premier.entryId, acteur);
    await validerEcriture(second.entryId, acteur);

    const balance = await balanceGenerale({
      dateDebut: debutDuMois(FEVRIER),
      dateFin: finDuMois(FEVRIER),
    });

    // Aucune autre ecriture n'est datee sur ce mois : les totaux sont exactement
    // ceux des deux ecritures creees ci-dessus.
    expect(balance.totalDebit.toFixed(4)).toBe("1250.5000");
    expect(balance.totalCredit.toFixed(4)).toBe("1250.5000");
    expect(balance.totalDebit.equals(balance.totalCredit)).toBe(true);
    expect(balance.equilibree).toBe(true);

    const mouvementDebit = balance.mouvements.find((m) => m.accountNumber === compteDebit);
    const mouvementCredit = balance.mouvements.find((m) => m.accountNumber === compteCredit);
    expect(mouvementDebit).toBeDefined();
    expect(mouvementCredit).toBeDefined();
    expect(mouvementDebit!.debit.toFixed(4)).toBe("1250.5000");
    expect(mouvementDebit!.credit.toFixed(4)).toBe("0.0000");
    expect(mouvementDebit!.solde.toFixed(4)).toBe("1250.5000");
    expect(mouvementCredit!.debit.toFixed(4)).toBe("0.0000");
    expect(mouvementCredit!.credit.toFixed(4)).toBe("1250.5000");
    expect(mouvementCredit!.solde.toFixed(4)).toBe("-1250.5000");

    // Les ecritures en brouillon du mois de janvier ne polluent pas la balance.
    const nonValidees = await balanceGenerale({
      dateDebut: debutDuMois(JANVIER),
      dateFin: finDuMois(JANVIER),
      statuts: ["BROUILLON"],
    });
    expect(nonValidees.mouvements.some((m) => m.accountNumber === compteDebit)).toBe(true);
  });

  it("grandLivre d'un compte correspond aux lignes validees et au solde progressif", async () => {
    const livre = await grandLivre({
      accountNumber: compteDebit,
      dateDebut: debutDuMois(FEVRIER),
      dateFin: finDuMois(FEVRIER),
    });

    expect(livre.compte.number).toBe(compteDebit);

    // Solde initial : reprise independante du net des lignes validees anterieures
    // a la periode (l'activite de janvier des autres cas de ce fichier est
    // volontairement prise en compte, et non supposee nulle).
    const anterieures = await prisma.accountingEntryLine.aggregate({
      where: {
        accountNumber: compteDebit,
        entry: {
          entryDate: { lt: debutDuMois(FEVRIER) },
          status: { in: ["POSTEE", "VALIDEE"] },
        },
      },
      _sum: { debit: true, credit: true },
    });
    const soldeInitialAttendu = zero()
      .plus(anterieures._sum.debit ?? 0)
      .minus(anterieures._sum.credit ?? 0);
    expect(livre.soldeInitial.toFixed(4)).toBe(soldeInitialAttendu.toFixed(4));

    expect(livre.totalDebit.toFixed(4)).toBe("1250.5000");
    expect(livre.totalCredit.toFixed(4)).toBe("0.0000");
    expect(livre.lignes).toHaveLength(2);
    expect(livre.soldeFinal.toFixed(4)).toBe(
      livre.soldeInitial.plus(livre.totalDebit).minus(livre.totalCredit).toFixed(4),
    );

    // Le solde progressif part du solde initial et suit les lignes de la periode.
    let cumul = livre.soldeInitial;
    for (const ligne of livre.lignes) {
      cumul = cumul.plus(ligne.debit).minus(ligne.credit);
      expect(ligne.soldeProgressif.toFixed(4)).toBe(cumul.toFixed(4));
    }
    expect(livre.soldeFinal.toFixed(4)).toBe(cumul.toFixed(4));

    // Chaque ligne du grand livre pointe une ecriture reellement presente.
    for (const ligne of livre.lignes) {
      const ecriture = await prisma.accountingEntry.findUnique({
        where: { id: ligne.entryId },
        select: { number: true, status: true },
      });
      expect(ecriture).not.toBeNull();
      expect(ecriture!.number).toBe(ligne.entry.number);
      expect(["POSTEE", "VALIDEE"]).toContain(ecriture!.status);
    }
  });

  it("balanceTiers rapproche les lignes de tiers non lettrees", async () => {
    const ecriture = await generer({
      entryDate: dateDuMois(MARS, 5),
      documentId: `${PREFIXE}DOC-TIERS`,
      eventCode: evenementTiers,
      label: "Facture client de test",
      montantHT: "3000.0000",
      thirdPartyId: tiersId,
    });
    await validerEcriture(ecriture.entryId, acteur);

    const balance = await balanceTiers({ tiersId });

    expect(balance).toHaveLength(1);
    const ligne = balance[0];
    expect(ligne.tiersId).toBe(tiersId);
    expect(ligne.code).toBe(`${PREFIXE}TIERS`);
    expect(ligne.debit.toFixed(4)).toBe("3000.0000");
    expect(ligne.credit.toFixed(4)).toBe("0.0000");
    expect(ligne.solde.toFixed(4)).toBe("3000.0000");
    expect(ligne.lignesNonLettrees).toBe(1);

    // Le total correspond exactement a la ligne 411 reellement enregistree.
    const lignesTiers = await prisma.accountingEntryLine.findMany({
      where: { entryId: ecriture.entryId, accountNumber: "411" },
    });
    expect(lignesTiers).toHaveLength(1);
    expect(lignesTiers[0].thirdPartyId).toBe(tiersId);
    expect(lignesTiers[0].isMatched).toBe(false);
    expect(lignesTiers[0].debit.toFixed(4)).toBe(ligne.debit.toFixed(4));
  });
});
