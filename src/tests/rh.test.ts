/**
 * Tests d'integration des ressources humaines et de l'evaluation des employes.
 *
 * Ils s'executent contre la vraie base PostgreSQL (`erpmes_test`) : aucun service
 * n'est mocke, aucun acces Prisma n'est simule. Les ateliers, operations, roles et
 * ponderations proviennent du referentiel seme ; les donnees creees par le test
 * portent un jeton unique et sont supprimees en fin de fichier.
 *
 * Points structurants verifies ici :
 *  - chaque employe possede son propre compte nominatif, jamais un compte partage ;
 *  - les affectations sont historisees : une reaffectation ne supprime rien ;
 *  - les ponderations d'evaluation viennent de la base, jamais du code ;
 *  - un employe n'est jamais evalue avec la norme d'une operation qu'il n'a pas
 *    reellement effectuee ;
 *  - une evaluation non fiable ou non validee ne sert pas de reference ;
 *  - les donnees salariales ne sortent pas des fonctions collectives.
 *
 * Les montants salariaux utilises dans ce fichier sont des valeurs fictives de
 * test (jamais presentees comme des salaires reels) : ils servent uniquement a
 * verifier que les fonctions collectives ne les exposent pas.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { sessionAdministrateur, acteurTest, jeton, type ActeurTest } from "@/tests/aide";
import {
  affecterEmploye,
  calculerEvaluation,
  corrigerEvaluation,
  creerCompteEmploye,
  creerEmploye,
  declarerCompetence,
  enregistrerEvaluation,
  enregistrerPresence,
  listerAffectations,
  listerEvaluations,
  ponderationsAxes,
  reaffecterEmploye,
  validerEvaluation,
  type ResultatEvaluation,
} from "@/lib/rh/service";
import { indicateursPilotageRh } from "@/lib/tableau-bord/pilotage";

const PREFIXE = jeton("RH");

const MAINTENANT = new Date();
const ANNEE = MAINTENANT.getFullYear();
const MOIS = MAINTENANT.getMonth();

/** Date locale dans le mois courant (timezone-safe pour la periode mensuelle). */
function jourDuMois(jour: number, heure = 10): Date {
  return new Date(ANNEE, MOIS, jour, heure, 0, 0);
}

/** Reference de calcul : au milieu du mois courant, periode mensuelle ouverte. */
const REFERENCE = jourDuMois(15, 12);
const JOUR_AFFECTATION = jourDuMois(15);

/** Mot de passe de test conforme a la politique de robustesse de la plateforme. */
const MOT_DE_PASSE_ROBUSTE = "V3rtige#Lune42x";

let acteur: ActeurTest;

// Employes de test (matricules prefixes par le jeton).
let employeComplet: number; // activite reelle complete : 3 operations, 5 jours de presence
let employeFacile: number; // affecte uniquement a l'operation facile
let employeSansDonnees: number;
let employeAffectations: number; // affectations et reaffectations
let employePresence: number;
let employeSalaire: number;
let employeCompteA: number;
let employeCompteB: number;
let validateur: number;

// Operations de test.
let opA1: number;
let opA2: number;
let opA3: number;
let opFacile: number;
let opExigeante: number;

// Support de production reel (nomenclature minimale : article + ordre + operations).
let articleId: number;
let ordreId: number;
const operationParCode = new Map<string, { operationId: number; workOrderOperationId: number }>();

async function erreurAttendue(action: () => Promise<unknown>): Promise<DomainError> {
  try {
    await action();
  } catch (erreur) {
    expect(erreur).toBeInstanceOf(DomainError);
    return erreur as DomainError;
  }
  throw new Error("Une erreur metier etait attendue, mais aucune n'a ete levee.");
}

/** Cree une operation de production reelle, avec sa norme de temps standard. */
async function creerOperation(
  suffixe: string,
  standardTimeMinutes: string,
  sequenceOrder: number,
): Promise<number> {
  const operation = await prisma.operation.create({
    data: {
      code: `${PREFIXE}${suffixe}`,
      label: `Operation de test ${suffixe}`,
      factory: "ADMEDCO",
      standardTimeMinutes,
      sequenceOrder,
      isActive: true,
    },
  });
  return operation.id;
}

/** Declare une production reelle pour un employe sur une operation donnee. */
async function declarerProduction(
  employeeId: number,
  operationId: number,
  options: { quantite: string; conforme: string; minutes: string },
): Promise<void> {
  const support = operationParCode.get(
    (await prisma.operation.findUnique({ where: { id: operationId }, select: { code: true } }))!
      .code,
  );
  expect(support).toBeDefined();

  await prisma.operationDeclaration.create({
    data: {
      workOrderId: ordreId,
      workOrderOperationId: support!.workOrderOperationId,
      operationId,
      employeeId,
      kind: "PRODUCTION",
      status: "SAISIE",
      quantity: options.quantite,
      quantityConform: options.conforme,
      durationMinutes: options.minutes,
      occurredAt: jourDuMois(15, 10),
    },
  });
}

function axeDe(resultat: ResultatEvaluation, axe: string) {
  const trouve = resultat.axes.find((entree) => entree.axe === axe);
  expect(trouve).toBeDefined();
  return trouve!;
}

/** Score global recalcule a partir des axes retenus et des ponderations retournees. */
function scoreGlobalAttendu(resultat: ResultatEvaluation): string {
  let total = new Prisma.Decimal(0);
  let poids = new Prisma.Decimal(0);
  for (const axe of resultat.axes.filter((entree) => entree.retenu)) {
    total = total.plus(axe.score!.times(axe.poids));
    poids = poids.plus(axe.poids);
  }
  if (poids.isZero()) return "";
  return total.dividedBy(poids).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

beforeAll(async () => {
  acteur = await acteurTest();

  opA1 = await creerOperation("OP1", "2.0000", 1);
  opA2 = await creerOperation("OP2", "2.0000", 2);
  opA3 = await creerOperation("OP3", "2.0000", 3);
  opFacile = await creerOperation("OPFACILE", "2.0000", 4);
  // "Exigeante" : norme de temps tres serree (0,05 minute par piece), sans
  // aucune affectation ni declaration pour les employes evalues.
  opExigeante = await creerOperation("OPEXIGEANTE", "0.0500", 5);

  const article = await prisma.item.create({
    data: {
      code: `${PREFIXE}ART`,
      label1: "Article de test RH",
      type: "PRODUIT_FINI",
      factory: "ADMEDCO",
      isProducible: true,
    },
  });
  articleId = article.id;

  const ordre = await prisma.workOrder.create({
    data: {
      number: `${PREFIXE}OF1`,
      itemId: articleId,
      factory: "ADMEDCO",
      status: "EN_COURS",
      quantityPlanned: "100.000000",
    },
  });
  ordreId = ordre.id;

  // Une operation d'ordre par operation de gamme, quantite planifiee de 10 pieces.
  let etape = 1;
  for (const operationId of [opA1, opA2, opA3, opFacile]) {
    const operation = await prisma.operation.findUnique({
      where: { id: operationId },
      select: { code: true },
    });
    const ordreOperation = await prisma.workOrderOperation.create({
      data: {
        workOrderId: ordreId,
        stepNo: etape,
        operationId,
        status: "EN_COURS",
        quantityPlanned: "10.000000",
      },
    });
    operationParCode.set(operation!.code, {
      operationId,
      workOrderOperationId: ordreOperation.id,
    });
    etape += 1;
  }

  // --- Employes -------------------------------------------------------------
  employeComplet = await creerEmploye(
    {
      matricule: `${PREFIXE}E1`,
      firstName: "Test",
      lastName: "Complet",
      factory: "ADMEDCO",
      jobTitle: "Operateur de test",
      hireDate: jourDuMois(15),
    },
    acteur,
  );

  employeFacile = await creerEmploye(
    { matricule: `${PREFIXE}E2`, firstName: "Test", lastName: "Facile", factory: "ADMEDCO" },
    acteur,
  );

  employeSansDonnees = await creerEmploye(
    { matricule: `${PREFIXE}E3`, firstName: "Test", lastName: "Sansdonnees", factory: "ADMEDCO" },
    acteur,
  );

  employeAffectations = await creerEmploye(
    { matricule: `${PREFIXE}E4`, firstName: "Test", lastName: "Affectations", factory: "ADMEDCO" },
    acteur,
  );

  employePresence = await creerEmploye(
    { matricule: `${PREFIXE}E5`, firstName: "Test", lastName: "Presence", factory: "ADMEDCO" },
    acteur,
  );

  // Valeurs salariales fictives, volontairement arbitraires : elles ne
  // representent aucun salaire reel et ne servent qu'au controle de non-divulgation.
  employeSalaire = await creerEmploye(
    {
      matricule: `${PREFIXE}E6`,
      firstName: "Test",
      lastName: "Confidentiel",
      factory: "ADMEDCO",
      baseSalary: "1234.5678",
      salaryPerDay: "56.7891",
    },
    acteur,
  );

  employeCompteA = await creerEmploye(
    { matricule: `${PREFIXE}E7`, firstName: "Test", lastName: "Compteun", factory: "ADMEDCO" },
    acteur,
  );

  employeCompteB = await creerEmploye(
    { matricule: `${PREFIXE}E8`, firstName: "Test", lastName: "Comptedeux", factory: "ADMEDCO" },
    acteur,
  );

  validateur = await creerEmploye(
    {
      matricule: `${PREFIXE}E9`,
      firstName: "Test",
      lastName: "Responsable",
      factory: "ADMEDCO",
      jobTitle: "Responsable de production",
    },
    acteur,
  );

  // --- Activite reelle de l'employe complet --------------------------------
  for (const operationId of [opA1, opA2, opA3]) {
    const operation = await prisma.operation.findUnique({
      where: { id: operationId },
      select: { code: true },
    });
    const support = operationParCode.get(operation!.code)!;

    await affecterEmploye(
      {
        employeeId: employeComplet,
        date: JOUR_AFFECTATION,
        operationId,
        workOrderId: ordreId,
        workOrderOperationId: support.workOrderOperationId,
      },
      acteur,
    );

    await declarerProduction(employeComplet, operationId, {
      quantite: "10.000000",
      conforme: "10.000000",
      minutes: "20.0000",
    });
  }

  for (const jour of [3, 4, 5, 6, 7]) {
    await enregistrerPresence(
      {
        employeeId: employeComplet,
        date: jourDuMois(jour),
        status: "PRESENT",
        workedHours: "8.0000",
        overtimeHours: "0.0000",
      },
      acteur,
    );
  }

  // --- Employe affecte UNIQUEMENT a l'operation facile ---------------------
  const operationFacile = await prisma.operation.findUnique({
    where: { id: opFacile },
    select: { code: true },
  });
  await affecterEmploye(
    {
      employeeId: employeFacile,
      date: JOUR_AFFECTATION,
      operationId: opFacile,
      workOrderId: ordreId,
      workOrderOperationId: operationParCode.get(operationFacile!.code)!.workOrderOperationId,
    },
    acteur,
  );
  await declarerProduction(employeFacile, opFacile, {
    quantite: "10.000000",
    conforme: "10.000000",
    minutes: "20.0000",
  });

  // --- Affectation de l'employe "salaire" (pour le listing d'affectations) --
  await affecterEmploye(
    { employeeId: employeSalaire, date: JOUR_AFFECTATION, operationId: opA1 },
    acteur,
  );
});

afterAll(async () => {
  const employes = await prisma.employee.findMany({
    where: { matricule: { startsWith: PREFIXE } },
    select: { id: true, userId: true },
  });
  const employeIds = employes.map((employe) => employe.id);
  const utilisateurIds = employes
    .map((employe) => employe.userId)
    .filter((valeur): valeur is number => valeur !== null);

  const ordres = await prisma.workOrder.findMany({
    where: { number: { startsWith: PREFIXE } },
    select: { id: true },
  });
  const ordreIds = ordres.map((ordre) => ordre.id);

  if (employeIds.length > 0) {
    await prisma.performanceEvaluation.deleteMany({
      where: { OR: [{ employeeId: { in: employeIds } }, { validatedById: { in: employeIds } }] },
    });
  }
  if (employeIds.length > 0 || ordreIds.length > 0) {
    await prisma.operationDeclaration.deleteMany({
      where: {
        OR: [
          { employeeId: { in: employeIds } },
          { workOrderId: { in: ordreIds } },
          { validatedById: { in: employeIds } },
        ],
      },
    });
    await prisma.assignment.deleteMany({
      where: { OR: [{ employeeId: { in: employeIds } }, { responsibleId: { in: employeIds } }] },
    });
    await prisma.attendance.deleteMany({ where: { employeeId: { in: employeIds } } });
    await prisma.employeeSkill.deleteMany({ where: { employeeId: { in: employeIds } } });
  }
  if (ordreIds.length > 0) {
    await prisma.workOrderOperation.deleteMany({ where: { workOrderId: { in: ordreIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: ordreIds } } });
  }

  await prisma.skill.deleteMany({ where: { code: { startsWith: PREFIXE } } });
  await prisma.employee.deleteMany({ where: { matricule: { startsWith: PREFIXE } } });
  if (utilisateurIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: utilisateurIds } } });
  }
  await prisma.user.deleteMany({ where: { email: { contains: PREFIXE.toLowerCase() } } });
  await prisma.item.deleteMany({ where: { code: { startsWith: PREFIXE } } });
  await prisma.operation.deleteMany({ where: { code: { startsWith: PREFIXE } } });
  if (acteur) {
    await prisma.user.deleteMany({ where: { email: acteur.email } });
  }
});

describe("Comptes nominatifs des employes", () => {
  it("ouvre un compte distinct par employe, jamais un compte partage", async () => {
    const compteA = await creerCompteEmploye(
      {
        employeeId: employeCompteA,
        email: `compte.${PREFIXE}.a@admedco.local`,
        motDePasse: MOT_DE_PASSE_ROBUSTE,
        roleCodes: ["OPERATEUR_ADMEDCO"],
      },
      acteur,
    );
    const compteB = await creerCompteEmploye(
      {
        employeeId: employeCompteB,
        email: `compte.${PREFIXE}.b@admedco.local`,
        motDePasse: MOT_DE_PASSE_ROBUSTE,
        roleCodes: ["OPERATEUR_ADMEDCO"],
      },
      acteur,
    );

    expect(compteA).not.toBe(compteB);

    const utilisateurA = await prisma.user.findUnique({
      where: { id: compteA },
      include: { roles: true },
    });
    const utilisateurB = await prisma.user.findUnique({
      where: { id: compteB },
      include: { roles: true },
    });

    expect(utilisateurA).not.toBeNull();
    expect(utilisateurB).not.toBeNull();
    expect(utilisateurA!.email).not.toBe(utilisateurB!.email);
    expect(utilisateurA!.id).not.toBe(utilisateurB!.id);
    // Empreintes distinctes : les identifiants ne sont pas mutualises.
    expect(utilisateurA!.passwordHash).not.toBe(utilisateurB!.passwordHash);
    expect(utilisateurA!.mustChangePassword).toBe(true);
    expect(utilisateurA!.roles.length).toBeGreaterThan(0);

    // Chaque fiche employe pointe son propre compte, et son propre email.
    const ficheA = await prisma.employee.findUnique({ where: { id: employeCompteA } });
    const ficheB = await prisma.employee.findUnique({ where: { id: employeCompteB } });
    expect(ficheA!.userId).toBe(compteA);
    expect(ficheB!.userId).toBe(compteB);
    expect(ficheA!.email).toBe(utilisateurA!.email);
    expect(ficheB!.email).toBe(utilisateurB!.email);
    expect(ficheA!.email).not.toBe(ficheB!.email);
  });

  it("refuse un email deja utilise par un autre compte", async () => {
    const emailPris = `compte.${PREFIXE}.a@admedco.local`;

    // Employe sans compte : le refus porte bien sur l'adresse, pas sur le fait
    // que la fiche possede deja un compte nominatif.
    const employeSansCompte = await creerEmploye(
      { matricule: `${PREFIXE}E11`, firstName: "Test", lastName: "Emailpris", factory: "ADMEDCO" },
      acteur,
    );

    const erreur = await erreurAttendue(() =>
      creerCompteEmploye(
        {
          employeeId: employeSansCompte,
          email: emailPris,
          motDePasse: MOT_DE_PASSE_ROBUSTE,
          roleCodes: ["OPERATEUR_ADMEDCO"],
        },
        acteur,
      ),
    );

    expect(erreur.code).toBe("CONFLIT");
    expect(erreur.message).toContain("deja utilisee");

    // Aucun compte n'a ete cree : la fiche reste sans compte plutot que de
    // partager celui de l'autre employe.
    const fiche = await prisma.employee.findUnique({ where: { id: employeSansCompte } });
    expect(fiche!.userId).toBeNull();
    expect(fiche!.email).toBeNull();
    expect(await prisma.user.count({ where: { email: emailPris.toLowerCase() } })).toBe(1);
  });

  it("refuse un second compte pour le meme employe, un mot de passe faible et un role inconnu", async () => {
    const dejaUnCompte = await erreurAttendue(() =>
      creerCompteEmploye(
        {
          employeeId: employeCompteA,
          email: `compte.${PREFIXE}.a2@admedco.local`,
          motDePasse: MOT_DE_PASSE_ROBUSTE,
          roleCodes: ["OPERATEUR_ADMEDCO"],
        },
        acteur,
      ),
    );
    expect(dejaUnCompte.code).toBe("CONFLIT");
    expect(dejaUnCompte.message).toContain("compte nominatif");

    const motDePasseFaible = await erreurAttendue(() =>
      creerCompteEmploye(
        {
          employeeId: employeSansDonnees,
          email: `compte.${PREFIXE}.faible@admedco.local`,
          motDePasse: "court",
          roleCodes: ["OPERATEUR_ADMEDCO"],
        },
        acteur,
      ),
    );
    expect(motDePasseFaible.code).toBe("VALIDATION");

    const roleInconnu = await erreurAttendue(() =>
      creerCompteEmploye(
        {
          employeeId: employeSansDonnees,
          email: `compte.${PREFIXE}.role@admedco.local`,
          motDePasse: MOT_DE_PASSE_ROBUSTE,
          roleCodes: [`${PREFIXE}ROLE-INEXISTANT`],
        },
        acteur,
      ),
    );
    expect(roleInconnu.code).toBe("VALIDATION");
    expect(roleInconnu.message).toContain("Roles inconnus");

    expect(
      await prisma.user.count({ where: { email: { contains: `${PREFIXE}.faible` } } }),
    ).toBe(0);
    expect(
      await prisma.user.count({ where: { email: { contains: `${PREFIXE}.role` } } }),
    ).toBe(0);
  });
});

describe("Affectations quotidiennes et reaffectation", () => {
  it("conserve les deux affectations lors d'une reaffectation le meme jour", async () => {
    const motif = "Rupture d'approvisionnement sur le poste initial";

    const affectationInitiale = await affecterEmploye(
      { employeeId: employeAffectations, date: JOUR_AFFECTATION, operationId: opA1 },
      acteur,
    );

    const reaffectation = await reaffecterEmploye(
      {
        assignmentId: affectationInitiale,
        versOperationId: opA2,
        motif,
        commentaire: "Reaffectation demandee par le chef d'atelier",
      },
      acteur,
    );

    expect(reaffectation.ancienneId).toBe(affectationInitiale);
    expect(reaffectation.nouvelleId).not.toBe(affectationInitiale);

    // L'ancienne affectation n'est pas supprimee : elle est cloturee et motivee.
    const ancienne = await prisma.assignment.findUnique({
      where: { id: affectationInitiale },
    });
    expect(ancienne).not.toBeNull();
    expect(ancienne!.status).toBe("TERMINEE");
    expect(ancienne!.changeReason).toBe(motif);
    expect(ancienne!.actualEnd).not.toBeNull();
    expect(ancienne!.operationId).toBe(opA1);

    // L'affectation en cours est bien la nouvelle operation.
    const nouvelle = await prisma.assignment.findUnique({
      where: { id: reaffectation.nouvelleId },
    });
    expect(nouvelle).not.toBeNull();
    expect(nouvelle!.status).toBe("EN_COURS");
    expect(nouvelle!.operationId).toBe(opA2);
    expect(nouvelle!.employeeId).toBe(employeAffectations);

    // Les deux figurent dans l'historique consultable.
    const historique = await listerAffectations({
      employeeId: employeAffectations,
      dateDebut: JOUR_AFFECTATION,
      dateFin: JOUR_AFFECTATION,
    });
    expect(historique.total).toBe(2);
    const enCours = historique.lignes.filter((ligne) => ligne.status === "EN_COURS");
    expect(enCours).toHaveLength(1);
    expect(enCours[0].operation.code).toBe(`${PREFIXE}OP2`);

    // Un motif explicite est obligatoire pour reaffecter.
    const sansMotif = await erreurAttendue(() =>
      reaffecterEmploye(
        { assignmentId: affectationInitiale, versOperationId: opA1, motif: "x" },
        acteur,
      ),
    );
    expect(sansMotif.code).toBe("VALIDATION");
  });
});

describe("Presence et pointage", () => {
  it("persiste la presence, l'absence, le retard, les heures travaillees et supplementaires", async () => {
    await enregistrerPresence(
      {
        employeeId: employePresence,
        date: jourDuMois(3),
        status: "PRESENT",
        workedHours: "7.5000",
        overtimeHours: "1.2500",
        lateMinutes: 0,
        comment: "Journee de test complete",
      },
      acteur,
    );
    await enregistrerPresence(
      {
        employeeId: employePresence,
        date: jourDuMois(4),
        status: "ABSENT",
        workedHours: "0.0000",
        overtimeHours: "0.0000",
        comment: "Absence justifiee de test",
      },
      acteur,
    );
    await enregistrerPresence(
      {
        employeeId: employePresence,
        date: jourDuMois(5),
        status: "RETARD",
        workedHours: "6.7500",
        overtimeHours: "0.0000",
        lateMinutes: 25,
      },
      acteur,
    );

    const presence = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: employePresence, date: jourDuMois(3) } },
    });
    expect(presence).not.toBeNull();
    expect(presence!.status).toBe("PRESENT");
    expect(presence!.workedHours.toFixed(4)).toBe("7.5000");
    expect(presence!.overtimeHours.toFixed(4)).toBe("1.2500");
    expect(presence!.recordedById).toBe(acteur.id);

    const absence = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: employePresence, date: jourDuMois(4) } },
    });
    expect(absence!.status).toBe("ABSENT");
    expect(absence!.workedHours.toFixed(4)).toBe("0.0000");

    const retard = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: employePresence, date: jourDuMois(5) } },
    });
    expect(retard!.status).toBe("RETARD");
    expect(retard!.lateMinutes).toBe(25);
    expect(retard!.workedHours.toFixed(4)).toBe("6.7500");
  });

  it("deduit les heures travaillees du pointage et refuse une sortie anterieure a l'entree", async () => {
    await enregistrerPresence(
      {
        employeeId: employePresence,
        date: jourDuMois(8),
        status: "PRESENT",
        checkIn: jourDuMois(8, 8),
        checkOut: jourDuMois(8, 16),
      },
      acteur,
    );

    const pointage = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: employePresence, date: jourDuMois(8) } },
    });
    expect(pointage!.workedHours.toFixed(4)).toBe("8.0000");

    const erreur = await erreurAttendue(() =>
      enregistrerPresence(
        {
          employeeId: employePresence,
          date: jourDuMois(9),
          status: "PRESENT",
          checkIn: jourDuMois(9, 16),
          checkOut: jourDuMois(9, 8),
        },
        acteur,
      ),
    );
    expect(erreur.code).toBe("VALIDATION");
    expect(erreur.message).toContain("heure de sortie");
    expect(
      await prisma.attendance.count({
        where: { employeeId: employePresence, date: jourDuMois(9) },
      }),
    ).toBe(0);
  });

  it("ne cree pas de doublon de presence sur la meme journee (mise a jour controlee)", async () => {
    // Comportement reel du service : une seconde saisie sur la meme journee met
    // a jour la ligne existante (contrainte d'unicite employe + date) au lieu de
    // creer une deuxieme presence.
    await enregistrerPresence(
      {
        employeeId: employePresence,
        date: jourDuMois(3),
        status: "RETARD",
        workedHours: "8.0000",
        overtimeHours: "0.5000",
        lateMinutes: 10,
        comment: "Correction du pointage du matin",
      },
      acteur,
    );

    const lignes = await prisma.attendance.findMany({
      where: { employeeId: employePresence, date: jourDuMois(3) },
    });
    expect(lignes).toHaveLength(1);
    expect(lignes[0].status).toBe("RETARD");
    expect(lignes[0].workedHours.toFixed(4)).toBe("8.0000");
    expect(lignes[0].overtimeHours.toFixed(4)).toBe("0.5000");
    expect(lignes[0].lateMinutes).toBe(10);
  });
});

describe("Competences et polyvalence", () => {
  it("enregistre un niveau unique par employe et par operation", async () => {
    const competence = await prisma.skill.create({
      data: {
        code: `${PREFIXE}COMP1`,
        label: "Competence de test - operation 1",
        factory: "ADMEDCO",
        operationId: opA1,
        isActive: true,
      },
    });
    expect(competence.operationId).toBe(opA1);

    await declarerCompetence(
      { employeeId: employeSansDonnees, skillId: competence.id, level: 3, notes: "Premier niveau" },
      acteur,
    );

    let lignes = await prisma.employeeSkill.findMany({
      where: { employeeId: employeSansDonnees, skillId: competence.id },
    });
    expect(lignes).toHaveLength(1);
    expect(lignes[0].level).toBe(3);
    expect(lignes[0].certifiedAt).not.toBeNull();

    // Un second enregistrement pour le meme couple met a jour la ligne : la
    // contrainte d'unicite (employe, competence) interdit tout doublon.
    await declarerCompetence(
      { employeeId: employeSansDonnees, skillId: competence.id, level: 5 },
      acteur,
    );
    lignes = await prisma.employeeSkill.findMany({
      where: { employeeId: employeSansDonnees, skillId: competence.id },
    });
    expect(lignes).toHaveLength(1);
    expect(lignes[0].level).toBe(5);

    // Une autre competence sur une autre operation cree, elle, une seconde ligne.
    const autreCompetence = await prisma.skill.create({
      data: {
        code: `${PREFIXE}COMP2`,
        label: "Competence de test - operation 2",
        factory: "ADMEDCO",
        operationId: opA2,
        isActive: true,
      },
    });
    await declarerCompetence(
      { employeeId: employeSansDonnees, skillId: autreCompetence.id, level: 2 },
      acteur,
    );
    expect(
      await prisma.employeeSkill.count({ where: { employeeId: employeSansDonnees } }),
    ).toBe(2);

    // Un niveau hors bornes est refuse.
    const horsBornes = await erreurAttendue(() =>
      declarerCompetence(
        { employeeId: employeSansDonnees, skillId: competence.id, level: 9 },
        acteur,
      ),
    );
    expect(horsBornes.code).toBe("VALIDATION");
  });
});

describe("Ponderations configurables", () => {
  it("lit les ponderations en base et les applique au score global", async () => {
    const resultatAvant = await calculerEvaluation({
      employeeId: employeComplet,
      periodType: "MOIS",
      reference: REFERENCE,
    });

    const ponderationEnBase = await prisma.evaluationWeight.findUnique({
      where: { code: "PRODUCTIVITE" },
    });
    expect(ponderationEnBase).not.toBeNull();

    const ponderationRetournee = resultatAvant.ponderations.find(
      (entree) => entree.code === "PRODUCTIVITE",
    );
    expect(ponderationRetournee).toBeDefined();
    // La ponderation retournee est bien celle stockee en base, pas une constante.
    expect(ponderationRetournee!.weight.toFixed(4)).toBe(ponderationEnBase!.weight.toFixed(4));

    // Le score global est la moyenne ponderee des axes retenus avec ces poids.
    expect(resultatAvant.axes.filter((axe) => axe.retenu).length).toBeGreaterThanOrEqual(2);
    expect(resultatAvant.scoreGlobal).not.toBeNull();
    expect(resultatAvant.scoreGlobal!.toFixed(2)).toBe(scoreGlobalAttendu(resultatAvant));

    const poidsModifie = ponderationEnBase!.weight.plus(30);

    try {
      await prisma.evaluationWeight.update({
        where: { code: "PRODUCTIVITE" },
        data: { weight: poidsModifie },
      });

      const ponderations = await ponderationsAxes();
      expect(
        ponderations.find((entree) => entree.code === "PRODUCTIVITE")!.weight.toFixed(4),
      ).toBe(poidsModifie.toFixed(4));

      const resultatApres = await calculerEvaluation({
        employeeId: employeComplet,
        periodType: "MOIS",
        reference: REFERENCE,
      });
      expect(axeDe(resultatApres, "PRODUCTIVITE").poids.toFixed(4)).toBe(poidsModifie.toFixed(4));
      expect(resultatApres.scoreGlobal!.toFixed(2)).toBe(scoreGlobalAttendu(resultatApres));
      // Modifier la ponderation en base change reellement le score global.
      expect(resultatApres.scoreGlobal!.toFixed(2)).not.toBe(
        resultatAvant.scoreGlobal!.toFixed(2),
      );
    } finally {
      await prisma.evaluationWeight.update({
        where: { code: "PRODUCTIVITE" },
        data: { weight: ponderationEnBase!.weight },
      });
    }

    const restauree = await prisma.evaluationWeight.findUnique({
      where: { code: "PRODUCTIVITE" },
    });
    expect(restauree!.weight.toFixed(4)).toBe(ponderationEnBase!.weight.toFixed(4));

    const controle = await calculerEvaluation({
      employeeId: employeComplet,
      periodType: "MOIS",
      reference: REFERENCE,
    });
    expect(controle.scoreGlobal!.toFixed(2)).toBe(resultatAvant.scoreGlobal!.toFixed(2));
  });
});

describe("Protection contre une evaluation injuste", () => {
  it("n'applique jamais la norme d'une operation que l'employe n'a pas effectuee", async () => {
    const resultat = await calculerEvaluation({
      employeeId: employeFacile,
      periodType: "MOIS",
      reference: REFERENCE,
    });

    // Une seule operation evaluee : celle reellement affectee et declaree.
    expect(resultat.operationsEvaluees).toHaveLength(1);
    expect(resultat.operationsEvaluees[0].operationId).toBe(opFacile);
    expect(
      resultat.operationsEvaluees.every((ligne) => ligne.operationId !== opExigeante),
    ).toBe(true);

    // L'employe n'a effectivement rien fait sur l'operation exigeante.
    expect(
      await prisma.assignment.count({
        where: { employeeId: employeFacile, operationId: opExigeante },
      }),
    ).toBe(0);
    expect(
      await prisma.operationDeclaration.count({
        where: { employeeId: employeFacile, operationId: opExigeante },
      }),
    ).toBe(0);

    // Le temps normal retenu est celui de l'operation facile : 10 pieces x 2 min.
    const ligne = resultat.operationsEvaluees[0];
    expect(ligne.minutesNormales.toFixed(4)).toBe("20.0000");
    expect(ligne.minutesDeclarees.toFixed(4)).toBe("20.0000");
    expect(ligne.efficienceTemps!.toFixed(6)).toBe("1.000000");

    const indicateurTemps = axeDe(resultat, "PRODUCTIVITE").indicateurs.find(
      (indicateur) => indicateur.code === "respect_temps_standard",
    );
    expect(indicateurTemps).toBeDefined();
    expect(indicateurTemps!.valeur!.toFixed(6)).toBe("1.000000");
    expect(indicateurTemps!.score!.toFixed(2)).toBe("100.00");

    // Contre-epreuve chiffree : avec la norme de l'operation exigeante
    // (0,05 min/piece), la meme production aurait donne une note tres faible.
    const operationFacile = await prisma.operation.findUnique({ where: { id: opFacile } });
    const operationExigeante = await prisma.operation.findUnique({ where: { id: opExigeante } });
    const normeFacile = new Prisma.Decimal(operationFacile!.standardTimeMinutes);
    const normeExigeante = new Prisma.Decimal(operationExigeante!.standardTimeMinutes);
    expect(normeExigeante.lessThan(normeFacile)).toBe(true);

    const efficienceAvecNormeExigeante = normeExigeante.times(10).dividedBy(20);
    expect(efficienceAvecNormeExigeante.times(100).toNumber()).toBeLessThan(5);

    // L'evaluation enregistree ne stocke que l'operation reellement effectuee.
    const evaluationId = await enregistrerEvaluation(resultat, acteur);
    const enregistree = await prisma.performanceEvaluation.findUnique({
      where: { id: evaluationId },
    });
    const metriques = enregistree!.rawMetrics as unknown as {
      operationsEvaluees: { operationId: number; minutesNormales: string }[];
    };
    expect(metriques.operationsEvaluees.map((ligneMetrique) => ligneMetrique.operationId)).toEqual([
      opFacile,
    ]);
    expect(metriques.operationsEvaluees[0].minutesNormales).toBe("20.0000");
  });
});

describe("Fiabilite et cycle de vie d'une evaluation", () => {
  it("renvoie une fiabilite insuffisante sur une periode sans donnees suffisantes", async () => {
    // Employe strictement sans activite : aucune affectation, aucune declaration,
    // aucune presence, aucune competence. Les competences saisies dans le cas de
    // test precedent ne doivent pas influencer ce controle de fiabilite.
    const employeSansActivite = await creerEmploye(
      {
        matricule: `${PREFIXE}E12`,
        firstName: "Test",
        lastName: "Sansactivite",
        factory: "ADMEDCO",
      },
      acteur,
    );

    const resultat = await calculerEvaluation({
      employeeId: employeSansActivite,
      periodType: "MOIS",
      reference: REFERENCE,
    });

    expect(resultat.affectationsCount).toBe(0);
    expect(resultat.axes.every((axe) => !axe.retenu)).toBe(true);
    // Sans aucune donnee, meme le score de l'axe productivite reste nul : aucune
    // note ne peut etre presentee comme fiable.
    expect(axeDe(resultat, "PRODUCTIVITE").score).toBeNull();
    expect(axeDe(resultat, "PRODUCTIVITE").retenu).toBe(false);
    expect(resultat.scoreGlobal).toBeNull();
    expect(resultat.fiabilite).toBe("INSUFFISANTE");
    expect(resultat.messageFiabilite).toMatch(/insuffisantes/i);
    expect(resultat.avertissements.length).toBeGreaterThan(0);

    const evaluationId = await enregistrerEvaluation(resultat, acteur);
    const enregistree = await prisma.performanceEvaluation.findUnique({
      where: { id: evaluationId },
    });
    expect(enregistree!.isValidated).toBe(false);
    expect(enregistree!.globalScore).toBeNull();
    expect(enregistree!.reliability).toBe("INSUFFISANTE");

    // Une evaluation non fiable ne peut pas etre validee, donc ne peut pas
    // servir de reference individuelle.
    const refus = await erreurAttendue(() =>
      validerEvaluation(
        evaluationId,
        { validateurEmployeeId: validateur, commentaire: null },
        acteur,
      ),
    );
    expect(refus.code).toBe("ETAT_INVALIDE");
    expect(refus.message).toMatch(/fiabilite insuffisante/i);

    const toujoursOuverte = await prisma.performanceEvaluation.findUnique({
      where: { id: evaluationId },
    });
    expect(toujoursOuverte!.isValidated).toBe(false);
  });

  it("enregistre, valide puis corrige une evaluation en conservant l'historique", async () => {
    const resultat = await calculerEvaluation({
      employeeId: employeComplet,
      periodType: "MOIS",
      reference: REFERENCE,
    });
    expect(resultat.fiabilite).not.toBe("INSUFFISANTE");
    expect(resultat.scoreGlobal).not.toBeNull();

    // Une evaluation non validee ne figure pas dans les references validees.
    expect((await listerEvaluations({ employeeId: employeComplet, validees: true })).total).toBe(0);

    const evaluationId = await enregistrerEvaluation(resultat, acteur);
    const enregistree = await prisma.performanceEvaluation.findUnique({
      where: { id: evaluationId },
    });
    expect(enregistree!.isValidated).toBe(false);
    expect(enregistree!.validatedAt).toBeNull();
    expect(enregistree!.reliability).toBe(resultat.fiabilite);
    expect(enregistree!.globalScore!.toFixed(2)).toBe(resultat.scoreGlobal!.toFixed(2));
    expect(enregistree!.productivityScore).not.toBeNull();
    expect(enregistree!.weightsSnapshot).not.toBeNull();
    expect(enregistree!.assignmentsCount).toBe(resultat.affectationsCount);

    expect((await listerEvaluations({ employeeId: employeComplet, validees: true })).total).toBe(0);
    expect((await listerEvaluations({ employeeId: employeComplet, validees: false })).total).toBe(1);

    // Auto-validation refusee : un employe ne valide pas sa propre evaluation.
    const autoValidation = await erreurAttendue(() =>
      validerEvaluation(
        evaluationId,
        { validateurEmployeeId: employeComplet, commentaire: "auto-validation" },
        acteur,
      ),
    );
    expect(autoValidation.code).toBe("ACCES_REFUSE");
    expect(
      (await prisma.performanceEvaluation.findUnique({ where: { id: evaluationId } }))!.isValidated,
    ).toBe(false);

    await validerEvaluation(
      evaluationId,
      {
        validateurEmployeeId: validateur,
        commentaire: "Evaluation validee sur les donnees de production de la periode",
      },
      acteur,
    );

    const validee = await prisma.performanceEvaluation.findUnique({ where: { id: evaluationId } });
    expect(validee!.isValidated).toBe(true);
    expect(validee!.validatedById).toBe(validateur);
    expect(validee!.validatedAt).not.toBeNull();
    expect((await listerEvaluations({ employeeId: employeComplet, validees: true })).total).toBe(1);

    // Une evaluation validee n'est pas remplacee silencieusement par un recalcul.
    const recalcul = await erreurAttendue(() => enregistrerEvaluation(resultat, acteur));
    expect(recalcul.code).toBe("CONFLIT");

    // La double validation est refusee.
    const secondeValidation = await erreurAttendue(() =>
      validerEvaluation(evaluationId, { validateurEmployeeId: validateur }, acteur),
    );
    expect(secondeValidation.code).toBe("CONFLIT");

    // Correction : motif obligatoire et explicite.
    const motifTropCourt = await erreurAttendue(() =>
      corrigerEvaluation(evaluationId, { motif: "erreur" }, acteur),
    );
    expect(motifTropCourt.code).toBe("VALIDATION");

    const scoreAvantCorrection = validee!.globalScore!.toFixed(4);
    const motif = "Correction documentee apres verification des pointages de la periode";

    await corrigerEvaluation(
      evaluationId,
      { motif, commentaire: "Verification faite avec le responsable d'atelier" },
      acteur,
    );

    const corrigee = await prisma.performanceEvaluation.findUnique({ where: { id: evaluationId } });
    expect(corrigee!.isCorrected).toBe(true);
    expect(corrigee!.correctionReason).toBe(motif);
    expect(corrigee!.correctedById).toBe(acteur.id);
    expect(corrigee!.correctedAt).not.toBeNull();

    // L'historique de la correction est conserve dans le journal d'audit, avec
    // la valeur anterieure : aucune valeur n'est ecrasee silencieusement.
    const traces = await prisma.auditLog.findMany({
      where: { entity: "PerformanceEvaluation", entityId: String(evaluationId) },
      orderBy: { id: "asc" },
    });
    expect(traces.length).toBeGreaterThanOrEqual(3);
    expect(traces.some((trace) => trace.action === "CREATION")).toBe(true);
    expect(traces.some((trace) => trace.action === "VALIDATION")).toBe(true);

    const traceCorrection = traces.find((trace) => trace.action === "CORRECTION");
    expect(traceCorrection).toBeDefined();
    expect(traceCorrection!.comment).toBe(motif);
    expect(JSON.stringify(traceCorrection!.oldValue)).toContain(scoreAvantCorrection);
  });
});

describe("Confidentialite des donnees salariales", () => {
  it("n'expose les salaires ni dans les listings ni dans le tableau de bord collectif", async () => {
    // La donnee existe bien en base : le controle de non-divulgation est donc reel.
    const fiche = await prisma.employee.findUnique({ where: { id: employeSalaire } });
    expect(fiche!.baseSalary!.toFixed(4)).toBe("1234.5678");
    expect(fiche!.salaryPerDay!.toFixed(4)).toBe("56.7891");

    const affectations = await listerAffectations({ employeeId: employeSalaire });
    expect(affectations.lignes).toHaveLength(1);
    const ligne = affectations.lignes[0];
    expect(Object.keys(ligne.employee).sort()).toEqual(["firstName", "lastName", "matricule"]);
    expect(JSON.stringify(affectations.lignes)).not.toMatch(
      /salary|salaire|remuneration|baseSalary|salaryPerDay/i,
    );

    const evaluations = await listerEvaluations({ employeeId: employeSalaire });
    expect(evaluations.lignes).toHaveLength(0);
    expect(JSON.stringify(evaluations.lignes)).not.toMatch(/salaire|salary/i);

    const tableauDeBord = await indicateursPilotageRh(sessionAdministrateur());
    const serialise = JSON.stringify(tableauDeBord);
    expect(serialise).not.toMatch(/salaire|salary|remuneration|baseSalary|salaryPerDay/i);
    // Le tableau de bord reste bien un agregat collectif : il expose des
    // effectifs et des notes, jamais une fiche salariale nominative.
    expect(tableauDeBord.effectifActif).toBeGreaterThan(0);
    expect(tableauDeBord).toHaveProperty("repartitionFiabilite");
  });
});
