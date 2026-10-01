import { Prisma, type Factory, type Priority } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D } from "@/lib/decimal";
import { conflit, etatInvalide, nonTrouve, validation } from "@/lib/errors";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import {
  affecterEmploye,
  type ActeurRh,
  type AffectationInput,
} from "@/lib/rh/service";
import {
  jourCivilDecale,
  jourCivilMetier,
  jourMetier,
  semaineIso,
} from "@/lib/mes/jour";
import { LIBELLE_PRIORITE, RANG_PRIORITE } from "@/lib/mes/postes";

/**
 * Programme de travail des ateliers.
 *
 * Un programme est un `WorkSchedule` : une journee ou une semaine, pour une
 * usine et un atelier. Il nait BROUILLON, devient PUBLIE quand le responsable
 * le diffuse, et n'est plus jamais reecrit en silence : le modifier cree une
 * revision (`replacesId`) qui laisse l'ancienne en ARCHIVE.
 *
 * Les affectations elles-memes restent la propriete du service RH
 * (`affecterEmploye`, `reaffecterEmploye`) : ce fichier ne reimplemente pas la
 * detection de chevauchement ni les regles d'employe actif, il les appelle.
 */

// ---------------------------------------------------------------------------
// Placement d'une tache dans une journee
// ---------------------------------------------------------------------------

export interface TacheJour {
  assignmentId: number;
  employeId: number;
  matricule: string;
  employe: string;
  operationId: number;
  operation: string;
  workCenterId: number | null;
  poste: string | null;
  workOrderId: number | null;
  ordreFabrication: string | null;
  priority: Priority;
  libellePriorite: string;
  sequenceOrder: number;
  quantitePrevue: Prisma.Decimal;
  lotCode: string | null;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  status: string;
  scheduleId: number | null;
  comment: string | null;
  /** Reaffectations subies par cette tache, dans l'ordre. */
  changements: {
    changeType: string;
    reason: string | null;
    changedAt: Date;
    previousWorkCenterId: number | null;
    newWorkCenterId: number | null;
  }[];
}

const INCLUSION_TACHE_PROGRAMME = {
  employee: {
    select: { id: true, matricule: true, firstName: true, lastName: true },
  },
  operation: { select: { id: true, code: true, label: true } },
  workCenter: { select: { id: true, code: true, label: true } },
  workOrder: { select: { id: true, number: true } },
  plannedLot: { select: { id: true, lotNumber: true } },
  changes: {
    select: {
      changeType: true,
      reason: true,
      changedAt: true,
      previousWorkCenterId: true,
      newWorkCenterId: true,
    },
    orderBy: { changedAt: "asc" as const },
  },
} satisfies Prisma.AssignmentInclude;

type AffectationProgramme = Prisma.AssignmentGetPayload<{
  include: typeof INCLUSION_TACHE_PROGRAMME;
}>;

function versTache(affectation: AffectationProgramme): TacheJour {
  return {
    assignmentId: affectation.id,
    employeId: affectation.employeeId,
    matricule: affectation.employee.matricule,
    employe: `${affectation.employee.firstName} ${affectation.employee.lastName}`,
    operationId: affectation.operationId,
    operation: affectation.operation.label,
    workCenterId: affectation.workCenterId,
    poste: affectation.workCenter
      ? `${affectation.workCenter.code} — ${affectation.workCenter.label}`
      : null,
    workOrderId: affectation.workOrderId,
    ordreFabrication: affectation.workOrder?.number ?? null,
    priority: affectation.priority,
    libellePriorite: LIBELLE_PRIORITE[affectation.priority],
    sequenceOrder: affectation.sequenceOrder,
    quantitePrevue: D.of(affectation.plannedQuantity),
    lotCode: affectation.plannedLot?.lotNumber ?? null,
    plannedStart: affectation.plannedStart,
    plannedEnd: affectation.plannedEnd,
    status: affectation.status,
    scheduleId: affectation.scheduleId,
    comment: affectation.comment,
    changements: affectation.changes.map((changement) => ({
      changeType: changement.changeType,
      reason: changement.reason,
      changedAt: changement.changedAt,
      previousWorkCenterId: changement.previousWorkCenterId,
      newWorkCenterId: changement.newWorkCenterId,
    })),
  };
}

function trierTaches(taches: TacheJour[]): TacheJour[] {
  return [...taches].sort((a, b) => {
    if (a.employe !== b.employe) return a.employe.localeCompare(b.employe, "fr");
    const rangA = RANG_PRIORITE[a.priority];
    const rangB = RANG_PRIORITE[b.priority];
    if (rangA !== rangB) return rangB - rangA;
    if (a.sequenceOrder !== b.sequenceOrder) {
      return a.sequenceOrder - b.sequenceOrder;
    }
    return a.assignmentId - b.assignmentId;
  });
}

// ---------------------------------------------------------------------------
// Vues jour et semaine
// ---------------------------------------------------------------------------

export interface FiltreProgrammeLecture {
  factory?: Factory;
  workshopId?: number;
  workCenterId?: number;
  employeeId?: number;
  /** Instant de reference : la journee est calculee en Africa/Algiers. */
  at?: Date;
}

/** Programme d'une journee, poste par poste et employe par employe. */
export async function programmeDuJour(
  filtres: FiltreProgrammeLecture = {},
  db: Db = prisma,
): Promise<{ jour: string; taches: TacheJour[] }> {
  const reference = filtres.at ?? new Date();
  const jour = jourMetier(reference);

  const affectations = await db.assignment.findMany({
    where: {
      date: jourCivilMetier(reference),
      status: { not: "ANNULEE" },
      ...(filtres.factory ? { factory: filtres.factory } : {}),
      ...(filtres.workshopId ? { workshopId: filtres.workshopId } : {}),
      ...(filtres.workCenterId ? { workCenterId: filtres.workCenterId } : {}),
      ...(filtres.employeeId ? { employeeId: filtres.employeeId } : {}),
    },
    include: INCLUSION_TACHE_PROGRAMME,
  });

  return { jour, taches: trierTaches(affectations.map(versTache)) };
}

/** Programme d'une semaine : sept journees, du lundi au dimanche. */
export async function programmeDeLaSemaine(
  filtres: FiltreProgrammeLecture = {},
  db: Db = prisma,
): Promise<{
  semaine: number;
  annee: number;
  jours: { jour: string; taches: TacheJour[] }[];
}> {
  const reference = filtres.at ?? new Date();
  const lundi = jourCivilMetier(reference);
  // Lundi -> dimanche : deux dates civiles, sans dependance au fuseau de la
  // session PostgreSQL.
  const dimanche = jourCivilDecale(reference, 6);
  const { annee, semaine } = semaineIso(reference);
  const jours = Array.from({ length: 7 }, (_, index) =>
    jourMetier(new Date(lundi.getTime() + index * 24 * 3600 * 1000)),
  );

  const affectations = await db.assignment.findMany({
    where: {
      date: { gte: lundi, lte: dimanche },
      status: { not: "ANNULEE" },
      ...(filtres.factory ? { factory: filtres.factory } : {}),
      ...(filtres.workshopId ? { workshopId: filtres.workshopId } : {}),
      ...(filtres.workCenterId ? { workCenterId: filtres.workCenterId } : {}),
      ...(filtres.employeeId ? { employeeId: filtres.employeeId } : {}),
    },
    include: INCLUSION_TACHE_PROGRAMME,
  });

  const parJour = new Map<string, TacheJour[]>();
  for (const cle of jours) parJour.set(cle, []);
  for (const affectation of affectations) {
    const cle = jourMetier(affectation.date);
    const liste = parJour.get(cle);
    if (liste) liste.push(versTache(affectation));
  }

  return {
    annee,
    semaine,
    jours: jours.map((jour) => ({
      jour,
      taches: trierTaches(parJour.get(jour) ?? []),
    })),
  };
}

// ---------------------------------------------------------------------------
// Cycle de vie du programme
// ---------------------------------------------------------------------------

export interface ProgrammeInput {
  factory: Factory;
  workshopId?: number | null;
  /** Jour unique ou lundi d'une semaine. */
  reference: Date;
  portee: "JOUR" | "SEMAINE";
  label?: string;
  responsableId?: number | null;
  note?: string | null;
}

/**
 * Code deterministe du programme : « PRG-ADMEDCO-2026-09-28 » pour une journee,
 * « PRG-ADMEDCO-S40-2026 » pour une semaine.
 *
 * Deterministe a dessein : une seconde creation pour la meme periode retrouve
 * le programme existant au lieu d'en ouvrir un doublon.
 */
export function codeProgramme(entree: ProgrammeInput): string {
  const atelier = entree.workshopId ? `-A${entree.workshopId}` : "";
  if (entree.portee === "JOUR") {
    return `PRG-${entree.factory}${atelier}-${jourMetier(entree.reference)}`;
  }
  const { annee, semaine } = semaineIso(entree.reference);
  return `PRG-${entree.factory}${atelier}-S${String(semaine).padStart(2, "0")}-${annee}`;
}

/**
 * Bornes de la periode couverte, en dates civiles du fuseau metier.
 * `periodStart` et `periodEnd` sont des colonnes `@db.Date` : on leur donne des
 * dates, pas des instants.
 */
function bornesPeriode(entree: ProgrammeInput): { debut: Date; fin: Date } {
  const debut = jourCivilMetier(entree.reference);
  if (entree.portee === "JOUR") return { debut, fin: debut };
  return { debut, fin: jourCivilDecale(entree.reference, 6) };
}

/**
 * Ouvre un programme (ou retourne celui qui existe deja pour la meme periode).
 * Ne cree jamais de doublon pour une meme periode, un meme atelier, une meme
 * usine : la contrainte d'unicite sur le code s'en charge.
 */
export async function ouvrirProgramme(
  entree: ProgrammeInput,
  acteur: ActeurRh,
  db: Db = prisma,
) {
  const code = codeProgramme(entree);

  const existant = await db.workSchedule.findUnique({ where: { code } });
  if (existant) return existant;

  const { debut, fin } = bornesPeriode(entree);

  try {
    const programme = await db.workSchedule.create({
      data: {
        code,
        label:
          entree.label ??
          (entree.portee === "JOUR"
            ? `Programme du ${jourMetier(debut)}`
            : `Programme semaine ${code.split("-").slice(-2).join("-")}`),
        factory: entree.factory,
        workshopId: entree.workshopId ?? null,
        periodStart: debut,
        periodEnd: fin,
        status: "BROUILLON",
        responsibleId: entree.responsableId ?? null,
        note: entree.note ?? null,
      },
    });

    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.CREATION,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "WorkSchedule",
        entityId: programme.id,
        userId: acteur.id,
        userEmail: acteur.email,
        newValue: {
          code: programme.code,
          portee: entree.portee,
          debut: jourMetier(debut),
          fin: jourMetier(fin),
          atelier: entree.workshopId ?? null,
        },
      },
      db,
    );

    return programme;
  } catch (erreur) {
    // Course entre deux ouvertures simultanees : on relit le gagnant.
    if (
      erreur instanceof Prisma.PrismaClientKnownRequestError &&
      erreur.code === "P2002"
    ) {
      const gagnant = await db.workSchedule.findUnique({ where: { code } });
      if (gagnant) return gagnant;
    }
    throw erreur;
  }
}

/**
 * Ajoute une tache a un programme.
 *
 * Delegue entierement a `affecterEmploye` : l'employe doit exister et etre
 * actif, l'operation doit etre active, et deux taches qui se chevauchent sont
 * refusees. Aucune de ces regles n'est reecrite ici.
 */
export async function ajouterTacheAuProgramme(
  entree: AffectationInput & { scheduleId: number },
  acteur: ActeurRh,
  db: Db = prisma,
): Promise<number> {
  const programme = await db.workSchedule.findUnique({
    where: { id: entree.scheduleId },
    select: { id: true, status: true, factory: true, periodStart: true, periodEnd: true },
  });
  if (!programme) throw nonTrouve("Le programme de travail");

  if (programme.status === "ARCHIVE") {
    throw etatInvalide(
      "Ce programme est archive : ouvrez la revision courante pour y ajouter une tache.",
    );
  }

  const jour = jourMetier(entree.date);
  const debut = jourMetier(programme.periodStart);
  const fin = jourMetier(programme.periodEnd);
  if (jour < debut || jour > fin) {
    throw validation(
      `Le ${jour} est hors de la periode du programme (${debut} au ${fin}).`,
    );
  }

  return affecterEmploye(
    { ...entree, scheduleId: programme.id, factory: entree.factory ?? programme.factory },
    acteur,
  );
}

/**
 * Publie un programme : il devient la reference de l'atelier.
 *
 * Publier est un geste unique. Un programme deja publie ne se modifie pas :
 * il faut le reviser, ce qui laisse une trace explicite.
 */
export async function publierProgramme(
  entree: { scheduleId: number; acteur: ActeurRh },
  db: Db = prisma,
) {
  const programme = await db.workSchedule.findUnique({
    where: { id: entree.scheduleId },
    include: { _count: { select: { assignments: true } } },
  });
  if (!programme) throw nonTrouve("Le programme de travail");
  if (programme.status === "PUBLIE") {
    throw conflit(
      `Le programme « ${programme.code} » est deja publie : creez une revision pour le faire evoluer.`,
    );
  }
  if (programme.status === "ARCHIVE") {
    throw etatInvalide(
      `Le programme « ${programme.code} » est archive : il ne peut plus etre publie.`,
    );
  }
  if (programme._count.assignments === 0) {
    throw etatInvalide(
      "Un programme vide ne se publie pas : affectez au moins une tache avant de diffuser.",
    );
  }

  const maintenant = new Date();
  const employeActeur = await db.employee.findFirst({
    where: { userId: entree.acteur.id },
    select: { id: true },
  });

  const publie = await db.workSchedule.update({
    where: { id: programme.id },
    data: {
      status: "PUBLIE",
      publishedAt: maintenant,
      publishedById: employeActeur?.id ?? null,
    },
  });

  await db.assignment.updateMany({
    where: { scheduleId: programme.id },
    data: { publishedAt: maintenant },
  });

  await enregistrerAudit(
    {
      action: ACTIONS_AUDIT.PUBLICATION_PROGRAMME,
      module: MODULES_AUDIT.PRODUCTION,
      entity: "WorkSchedule",
      entityId: programme.id,
      userId: entree.acteur.id,
      userEmail: entree.acteur.email,
      oldValue: { statut: "BROUILLON" },
      newValue: {
        statut: "PUBLIE",
        taches: programme._count.assignments,
        debut: jourMetier(programme.periodStart),
      },
    },
    db,
  );

  return publie;
}

/**
 * Cree une revision d'un programme publie.
 *
 * L'ancien passe en ARCHIVE et reste consultable : ce qui a ete diffuse un jour
 * donne reste consultable ce jour-la. La revision est ouverte en BROUILLON avec
 * les memes taches, que le responsable ajuste avant de publier.
 */
export async function reviserProgramme(
  entree: { scheduleId: number; motif: string; acteur: ActeurRh },
  db: Db = prisma,
) {
  if (!entree.motif || entree.motif.trim().length < 5) {
    throw validation("Le motif de revision est obligatoire (au moins 5 caracteres).");
  }

  const programme = await db.workSchedule.findUnique({
    where: { id: entree.scheduleId },
    include: { assignments: { select: { id: true } } },
  });
  if (!programme) throw nonTrouve("Le programme de travail");
  if (programme.status !== "PUBLIE") {
    throw etatInvalide(
      "Seul un programme publie se revise. Un brouillon se modifie directement.",
    );
  }

  return db.$transaction(
    async (tx) => {
      const suffixe = new Date().toISOString().slice(11, 19).replace(/:/g, "");
      const revision = await tx.workSchedule.create({
        data: {
          code: `${programme.code}-R${suffixe}`,
          label: `${programme.label} (revision)`,
          factory: programme.factory,
          workshopId: programme.workshopId,
          periodStart: programme.periodStart,
          periodEnd: programme.periodEnd,
          status: "BROUILLON",
          responsibleId: programme.responsibleId,
          note: `Revision de ${programme.code} : ${entree.motif}`,
          replacesId: programme.id,
        },
      });

      // Les taches sont recopiees puis rattachees a la revision. Le responsable
      // les ajuste avant publication ; les anciennes restent sur le programme
      // archive, donc l'historique du jour diffuse est intact.
      await tx.assignment.updateMany({
        where: { scheduleId: programme.id },
        data: { scheduleId: revision.id, status: "PLANIFIEE", publishedAt: null },
      });

      await tx.workSchedule.update({
        where: { id: programme.id },
        data: { status: "ARCHIVE" },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.PRODUCTION,
          entity: "WorkSchedule",
          entityId: revision.id,
          userId: entree.acteur.id,
          userEmail: entree.acteur.email,
          oldValue: { code: programme.code, statut: "PUBLIE" },
          newValue: { code: revision.code, statut: "BROUILLON" },
          reason: entree.motif,
        },
        tx,
      );

      return revision;
    },
    { timeout: 30_000 },
  );
}

/**
 * Reaffecte une tache d'un programme.
 *
 * Trois changements possibles, tous historises : l'employe, le poste, et
 * l'ordre ou la priorite. Le motif est obligatoire et l'historique n'est jamais
 * reecrit — c'est ce que l'employe verra sur son portail.
 */
export async function reaffecterTacheProgramme(
  entree: {
    assignmentId: number;
    versEmployeeId?: number;
    versWorkCenterId?: number | null;
    versPriorite?: Priority;
    versSequence?: number;
    motif: string;
    acteur: ActeurRh;
  },
  db: Db = prisma,
) {
  if (!entree.motif || entree.motif.trim().length < 5) {
    throw validation("Le motif de reaffectation est obligatoire (au moins 5 caracteres).");
  }

  const affectation = await db.assignment.findUnique({
    where: { id: entree.assignmentId },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true } },
      workCenter: { select: { id: true, code: true, label: true } },
      schedule: { select: { id: true, code: true, status: true } },
    },
  });
  if (!affectation) throw nonTrouve("L'affectation");
  if (affectation.status === "TERMINEE" || affectation.status === "ANNULEE") {
    throw conflit(
      "Cette tache est close : elle ne peut plus etre reaffectee. Creez une nouvelle tache.",
    );
  }

  const nouveauEmployeId = entree.versEmployeeId ?? affectation.employeeId;
  const nouveauPosteId =
    entree.versWorkCenterId === undefined
      ? affectation.workCenterId
      : entree.versWorkCenterId;

  if (
    nouveauEmployeId === affectation.employeeId &&
    nouveauPosteId === affectation.workCenterId &&
    (entree.versPriorite === undefined || entree.versPriorite === affectation.priority) &&
    (entree.versSequence === undefined ||
      entree.versSequence === affectation.sequenceOrder)
  ) {
    throw validation("Aucun changement : la reaffectation serait sans effet.");
  }

  return db.$transaction(
    async (tx) => {
      // Changer d'employe, c'est faire glisser LA MEME tache vers une autre
      // personne : l'operation, le poste et les quantites ne bougent pas. C'est
      // la difference avec la reaffectation RH, qui garde l'employe et change
      // son operation.
      if (nouveauEmployeId !== affectation.employeeId) {
        const remplacant = await tx.employee.findUnique({
          where: { id: nouveauEmployeId },
          select: { id: true, isActive: true, firstName: true, lastName: true },
        });
        if (!remplacant) throw nonTrouve("La fiche du remplacant");
        if (!remplacant.isActive) {
          throw etatInvalide(
            `La fiche de ${remplacant.firstName} ${remplacant.lastName} est inactive.`,
          );
        }

        // Un employe ne peut pas etre physiquement a deux postes sur le meme
        // creneau : la meme regle que pour une affectation nouvelle.
        if (affectation.plannedStart && affectation.plannedEnd) {
          const chevauchement = await tx.assignment.findFirst({
            where: {
              employeeId: nouveauEmployeId,
              date: affectation.date,
              id: { not: affectation.id },
              status: { in: ["PLANIFIEE", "EN_COURS"] },
              AND: [
                { plannedStart: { lt: affectation.plannedEnd } },
                { plannedEnd: { gt: affectation.plannedStart } },
              ],
            },
            include: { operation: { select: { label: true } } },
          });
          if (chevauchement) {
            throw conflit(
              `${remplacant.firstName} ${remplacant.lastName} a deja « ${chevauchement.operation.label} » sur ce creneau.`,
            );
          }
        }
      }

      if (nouveauPosteId !== affectation.workCenterId && nouveauPosteId !== null) {
        const poste = await tx.workCenter.findUnique({
          where: { id: nouveauPosteId },
          select: { id: true, isActive: true, factory: true, label: true },
        });
        if (!poste) throw nonTrouve("Le poste de travail");
        if (!poste.isActive) {
          throw etatInvalide(`Le poste « ${poste.label} » est desactive.`);
        }
      }

      // Une reaffectation en cours de journee remet le scan a zero : le nouveau
      // couple employe/poste doit etre reverifie par un scan reel.
      const changementsReel =
        nouveauEmployeId !== affectation.employeeId ||
        nouveauPosteId !== affectation.workCenterId;

      const misAJour = await tx.assignment.update({
        where: { id: affectation.id },
        data: {
          employeeId: nouveauEmployeId,
          workCenterId: nouveauPosteId ?? null,
          priority: entree.versPriorite ?? affectation.priority,
          sequenceOrder: entree.versSequence ?? affectation.sequenceOrder,
          changeReason: entree.motif,
          ...(changementsReel
            ? { scannedWorkCenterId: null, scannedAt: null }
            : {}),
        },
      });

      await tx.assignmentChange.create({
        data: {
          assignmentId: affectation.id,
          changeType: "MODIFICATION_TACHE",
          previousEmployeeId: affectation.employeeId,
          newEmployeeId: nouveauEmployeId,
          previousWorkCenterId: affectation.workCenterId,
          newWorkCenterId: nouveauPosteId ?? null,
          previousPriority: affectation.priority,
          newPriority: entree.versPriorite ?? affectation.priority,
          previousSequence: affectation.sequenceOrder,
          newSequence: entree.versSequence ?? affectation.sequenceOrder,
          reason: entree.motif,
          changedByUserId: entree.acteur.id,
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CHANGEMENT_AFFECTATION,
          module: MODULES_AUDIT.PRODUCTION,
          entity: "Assignment",
          entityId: affectation.id,
          userId: entree.acteur.id,
          userEmail: entree.acteur.email,
          oldValue: {
            employe: `${affectation.employee.firstName} ${affectation.employee.lastName}`,
            poste: affectation.workCenter?.label ?? null,
            priorite: affectation.priority,
            ordre: affectation.sequenceOrder,
          },
          newValue: {
            poste: nouveauPosteId,
            priorite: entree.versPriorite ?? affectation.priority,
            ordre: entree.versSequence ?? affectation.sequenceOrder,
            programme: affectation.schedule?.code ?? null,
          },
          reason: entree.motif,
        },
        tx,
      );

      return { assignmentId: misAJour.id };
    },
    { timeout: 30_000 },
  );
}

// ---------------------------------------------------------------------------
// Propositions d'affectation
// ---------------------------------------------------------------------------

export interface PropositionAffectation {
  workOrderOperationId: number;
  workOrderId: number;
  ordreFabrication: string;
  operationId: number;
  operation: string;
  workCenterId: number | null;
  poste: string | null;
  quantiteRestante: Prisma.Decimal;
  dueDate: Date | null;
  urgence: number;
  employeId: number | null;
  employe: string | null;
  matricule: string | null;
  /** Pourquoi cette proposition, et ce qui reste a decider. */
  justification: string;
  /** Reserves : ce que la proposition ne peut pas garantir. */
  reserves: string[];
}

/**
 * Propositions d'affectation pour une journee.
 *
 * PROPOSITIONS, jamais decisions : rien n'est ecrit en base. Chaque ligne dit
 * pourquoi elle est proposee et ce qu'elle ne peut pas garantir, pour que le
 * responsable tranche en connaissance de cause. Une proposition ne tient compte
 * ni des absences non saisies, ni des competences non renseignees : c'est dit
 * explicitement dans les reserves.
 */
export async function proposerAffectations(
  entree: {
    factory?: Factory;
    workshopId?: number;
    at?: Date;
    limite?: number;
  } = {},
  db: Db = prisma,
): Promise<PropositionAffectation[]> {
  const date = jourCivilMetier(entree.at ?? new Date());

  // Operations d'OF a faire : lancees ou en cours, avec du reste a produire.
  const operations = await db.workOrderOperation.findMany({
    where: {
      status: { in: ["NON_DEMARREE", "EN_COURS", "EN_PAUSE"] },
      workOrder: {
        // Etats ou il reste reellement quelque chose a produire.
        status: { in: ["LANCE", "EN_COURS", "SUSPENDU", "PARTIELLEMENT_TERMINE"] },
        ...(entree.factory ? { factory: entree.factory } : {}),
        ...(entree.workshopId ? { workshopId: entree.workshopId } : {}),
      },
    },
    include: {
      operation: { select: { id: true, code: true, label: true } },
      workCenter: { select: { id: true, code: true, label: true } },
      workOrder: {
        select: { id: true, number: true, priority: true, dueDate: true, factory: true },
      },
    },
    orderBy: [{ workOrder: { dueDate: "asc" } }],
    take: Math.min(200, Math.max(1, entree.limite ?? 60)),
  });

  // Qui travaille deja aujourd'hui, et a quoi.
  const affectationsDuJour = await db.assignment.findMany({
    where: {
      date,
      status: { not: "ANNULEE" },
      ...(entree.factory ? { factory: entree.factory } : {}),
    },
    select: {
      employeeId: true,
      plannedStart: true,
      plannedEnd: true,
      operationId: true,
      plannedQuantity: true,
      scheduleId: true,
      workOrderOperationId: true,
    },
  });

  const dejaCouverte = new Set(
    affectationsDuJour
      .map((affectation) => affectation.workOrderOperationId)
      .filter((id): id is number => id !== null),
  );

  const employees = await db.employee.findMany({
    where: {
      isActive: true,
      ...(entree.factory
        ? { OR: [{ factory: entree.factory }, { factory: "COMMUN" }] }
        : {}),
      ...(entree.workshopId ? { workshopId: entree.workshopId } : {}),
    },
    select: {
      id: true,
      matricule: true,
      firstName: true,
      lastName: true,
      workshopId: true,
      _count: { select: { skills: true } },
    },
  });

  const propositions: PropositionAffectation[] = [];

  for (const operation of operations) {
    if (dejaCouverte.has(operation.id)) continue;

    const quantiteRestante = D.max(
      D.sub(
        D.of(operation.quantityPlanned),
        D.of(operation.quantityProduced),
      ),
      D.of(0),
    );
    if (D.lte(quantiteRestante, 0)) continue;

    // Charge deja portee par chaque employe, en taches du jour.
    const chargeParEmploye = new Map<number, number>();
    for (const affectation of affectationsDuJour) {
      chargeParEmploye.set(
        affectation.employeeId,
        (chargeParEmploye.get(affectation.employeeId) ?? 0) + 1,
      );
    }

    const candidats = employees
      .filter((employe) => chargeParEmploye.get(employe.id) !== undefined)
      .sort((a, b) => {
        const chargeA = chargeParEmploye.get(a.id) ?? 0;
        const chargeB = chargeParEmploye.get(b.id) ?? 0;
        if (chargeA !== chargeB) return chargeA - chargeB;
        return a.matricule.localeCompare(b.matricule);
      });

    const choisi = candidats[0] ?? employees[0] ?? null;

    const reserves: string[] = [];
    if (!choisi) {
      reserves.push(
        "Aucun employe actif sur ce perimetre : affectez d'abord une fiche a cet atelier.",
      );
    } else if (!chargeParEmploye.has(choisi.id)) {
      reserves.push(
        "L'employe propose n'a encore aucune tache ce jour : verifiez sa disponibilite.",
      );
    }
    if (choisi && choisi._count.skills === 0) {
      reserves.push(
        "Aucune competence n'est renseignee pour cet employe : la proposition ne verifie pas l'aptitude.",
      );
    }
    if (!operation.workCenterId) {
      reserves.push(
        "Aucun poste n'est declare sur cette operation : le programme ne pourra pas etre scanne.",
      );
    }
    reserves.push(
      "Les absences non saisies ne sont pas prises en compte ; la proposition n'est pas une affectation.",
    );

    propositions.push({
      workOrderOperationId: operation.id,
      workOrderId: operation.workOrder.id,
      ordreFabrication: operation.workOrder.number,
      operationId: operation.operationId,
      operation: operation.operation.label,
      workCenterId: operation.workCenterId,
      poste: operation.workCenter
        ? `${operation.workCenter.code} — ${operation.workCenter.label}`
        : null,
      quantiteRestante,
      dueDate: operation.workOrder.dueDate,
      urgence: RANG_PRIORITE[operation.workOrder.priority],
      employeId: choisi?.id ?? null,
      employe: choisi ? `${choisi.firstName} ${choisi.lastName}` : null,
      matricule: choisi?.matricule ?? null,
      justification:
        "Operation d'ordre de fabrication non couverte par le programme du jour, " +
        "avec une quantite encore a produire.",
      reserves,
    });
  }

  return propositions;
}
