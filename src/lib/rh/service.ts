import type {
  AssignmentStatus,
  AttendanceStatus,
  EvaluationPeriodType,
  Factory,
  Priority,
  Prisma,
  ReliabilityLevel,
} from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D, type Decimal } from "@/lib/decimal";
import { accesRefuse, conflit, etatInvalide, nonTrouve, validation } from "@/lib/errors";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import { lireParametreNombre, CLE_PARAMETRE } from "@/lib/settings";
import { hacherMotDePasse, verifierRobustesseMotDePasse } from "@/lib/auth/password";
import { PERMISSIONS, getPermissionLabel } from "@/lib/rbac/permissions";

/**
 * Ressources humaines, affectations quotidiennes et evaluation automatique.
 *
 * Deux regles structurantes issues du cahier des charges :
 *
 *  1. La polyvalence est la norme : un employe peut etre affecte plusieurs fois
 *     dans la meme journee a des operations differentes.
 *  2. Un employe ne doit JAMAIS etre evalue avec la norme d'une operation qu'il
 *     n'a pas reellement effectuee. L'evaluation est donc construite uniquement
 *     a partir des affectations et declarations reelles, operation par operation,
 *     puis consolidee. Chaque operation est comparee a SA propre norme.
 *
 * Les ponderations ne sont pas codees en dur : elles sont lues dans la table
 * `EvaluationWeight` (modifiable par l'administrateur) et figees dans
 * `weightsSnapshot` au moment du calcul, afin qu'une evaluation passee reste
 * explicable meme si les ponderations changent ensuite.
 */

export interface ActeurRh {
  id: number;
  email: string;
}

// -----------------------------------------------------------------------------
// Employes
// -----------------------------------------------------------------------------

export interface EmployeInput {
  matricule: string;
  firstName: string;
  lastName: string;
  factory?: Factory;
  workshopId?: number | null;
  jobTitle?: string | null;
  email?: string | null;
  phone?: string | null;
  phone2?: string | null;
  address?: string | null;
  city?: string | null;
  birthDate?: Date | null;
  gender?: string | null;
  socialSecurityNumber?: string | null;
  ccp?: string | null;
  contractType?: string | null;
  hireDate?: Date | null;
  endDate?: Date | null;
  defaultWarehouseId?: number | null;
  /** Donnee salariale protegee : exige la permission RH_SALAIRE_MODIFIER. */
  baseSalary?: Prisma.Decimal | string | number | null;
  salaryPerDay?: Prisma.Decimal | string | number | null;
}

export async function creerEmploye(
  entree: EmployeInput,
  acteur: ActeurRh,
): Promise<number> {
  if (!entree.matricule.trim()) {
    throw validation("Le matricule de l'employe est obligatoire.");
  }
  if (!entree.firstName.trim() || !entree.lastName.trim()) {
    throw validation("Le prenom et le nom de l'employe sont obligatoires.");
  }

  return prisma.$transaction(
    async (tx) => {
      const existant = await tx.employee.findUnique({
        where: { matricule: entree.matricule.trim() },
      });
      if (existant) {
        throw conflit(`Un employe porte deja le matricule « ${entree.matricule} ».`);
      }

      const employe = await tx.employee.create({
        data: {
          matricule: entree.matricule.trim(),
          firstName: entree.firstName.trim(),
          lastName: entree.lastName.trim(),
          factory: entree.factory ?? "COMMUN",
          workshopId: entree.workshopId ?? null,
          jobTitle: entree.jobTitle ?? null,
          email: entree.email ?? null,
          phone: entree.phone ?? null,
          phone2: entree.phone2 ?? null,
          address: entree.address ?? null,
          city: entree.city ?? null,
          birthDate: entree.birthDate ?? null,
          gender: entree.gender ?? null,
          socialSecurityNumber: entree.socialSecurityNumber ?? null,
          ccp: entree.ccp ?? null,
          contractType: entree.contractType ?? null,
          hireDate: entree.hireDate ?? null,
          endDate: entree.endDate ?? null,
          defaultWarehouseId: entree.defaultWarehouseId ?? null,
          baseSalary:
            entree.baseSalary === null || entree.baseSalary === undefined
              ? null
              : D.roundAmount(entree.baseSalary),
          salaryPerDay:
            entree.salaryPerDay === null || entree.salaryPerDay === undefined
              ? null
              : D.roundAmount(entree.salaryPerDay),
          isActive: true,
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.RH,
          entity: "Employee",
          entityId: employe.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: {
            matricule: employe.matricule,
            nom: `${employe.firstName} ${employe.lastName}`,
            usine: employe.factory,
            salaireRenseigne:
              entree.baseSalary !== null && entree.baseSalary !== undefined,
          },
        },
        tx,
      );

      return employe.id;
    },
    { timeout: 30_000 },
  );
}

/**
 * Modification d'une fiche employe. Les champs salariaux ne sont ecrits que si
 * l'appelant les fournit explicitement : une mise a jour partielle ne peut pas
 * effacer une donnee salariale par omission.
 */
export async function modifierEmploye(
  employeId: number,
  entree: Partial<EmployeInput> & { isActive?: boolean },
  acteur: ActeurRh,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const avant = await tx.employee.findUnique({ where: { id: employeId } });
      if (!avant) throw nonTrouve("La fiche employe");

      const donnees: Prisma.EmployeeUpdateInput = {};
      const champsSimples: (keyof EmployeInput)[] = [
        "firstName",
        "lastName",
        "jobTitle",
        "email",
        "phone",
        "phone2",
        "address",
        "city",
        "gender",
        "socialSecurityNumber",
        "ccp",
        "contractType",
      ];

      for (const champ of champsSimples) {
        const valeur = entree[champ];
        if (valeur !== undefined) {
          (donnees as Record<string, unknown>)[champ] = valeur;
        }
      }

      if (entree.factory !== undefined) donnees.factory = entree.factory;
      if (entree.hireDate !== undefined) donnees.hireDate = entree.hireDate;
      if (entree.endDate !== undefined) donnees.endDate = entree.endDate;
      if (entree.birthDate !== undefined) donnees.birthDate = entree.birthDate;
      if (entree.isActive !== undefined) donnees.isActive = entree.isActive;

      if (entree.workshopId !== undefined) {
        donnees.workshop = entree.workshopId
          ? { connect: { id: entree.workshopId } }
          : { disconnect: true };
      }
      if (entree.defaultWarehouseId !== undefined) {
        donnees.defaultWarehouse = entree.defaultWarehouseId
          ? { connect: { id: entree.defaultWarehouseId } }
          : { disconnect: true };
      }

      if (entree.baseSalary !== undefined) {
        donnees.baseSalary =
          entree.baseSalary === null ? null : D.roundAmount(entree.baseSalary);
      }
      if (entree.salaryPerDay !== undefined) {
        donnees.salaryPerDay =
          entree.salaryPerDay === null ? null : D.roundAmount(entree.salaryPerDay);
      }

      await tx.employee.update({ where: { id: employeId }, data: donnees });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.RH,
          entity: "Employee",
          entityId: employeId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: {
            nom: `${avant.firstName} ${avant.lastName}`,
            fonction: avant.jobTitle,
            usine: avant.factory,
            actif: avant.isActive,
          },
          newValue: {
            nom: `${entree.firstName ?? avant.firstName} ${entree.lastName ?? avant.lastName}`,
            fonction: entree.jobTitle ?? avant.jobTitle,
            usine: entree.factory ?? avant.factory,
            actif: entree.isActive ?? avant.isActive,
            salaireModifie:
              entree.baseSalary !== undefined || entree.salaryPerDay !== undefined,
          },
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

/**
 * Desactivation d'un employe. Aucune suppression physique : l'historique des
 * declarations, affectations et evaluations doit rester consultable.
 */
export async function desactiverEmploye(
  employeId: number,
  motif: string,
  acteur: ActeurRh,
): Promise<void> {
  if (!motif || motif.trim().length < 5) {
    throw validation("Le motif de desactivation est obligatoire.");
  }

  await prisma.$transaction(
    async (tx) => {
      const employe = await tx.employee.findUnique({ where: { id: employeId } });
      if (!employe) throw nonTrouve("La fiche employe");
      if (!employe.isActive) throw conflit("Cet employe est deja inactif.");

      await tx.employee.update({
        where: { id: employeId },
        data: { isActive: false, endDate: employe.endDate ?? new Date() },
      });

      if (employe.userId) {
        await tx.user.update({
          where: { id: employe.userId },
          data: { isActive: false, disabledAt: new Date() },
        });
      }

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.RH,
          entity: "Employee",
          entityId: employeId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { actif: true },
          newValue: { actif: false },
          comment: motif,
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

/**
 * Ouverture d'un compte nominatif pour un employe.
 *
 * Aucun mot de passe n'est code en dur : il est fourni par l'administrateur,
 * controle en robustesse, et le changement est obligatoire a la premiere
 * connexion. Un seul compte par personne : jamais de compte partage.
 */
export async function creerCompteEmploye(
  entree: {
    employeeId: number;
    email: string;
    motDePasse: string;
    roleCodes: string[];
    mustChangePassword?: boolean;
  },
  acteur: ActeurRh,
): Promise<number> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entree.email)) {
    throw validation("L'adresse electronique n'est pas valide.");
  }
  const robustesse = verifierRobustesseMotDePasse(entree.motDePasse);
  if (!robustesse.valide) {
    throw validation(
      `Mot de passe refuse : ${robustesse.erreurs.join(" ")}`,
    );
  }
  if (entree.roleCodes.length === 0) {
    throw validation("Au moins un role doit etre attribue au compte employe.");
  }

  const hash = await hacherMotDePasse(entree.motDePasse);

  return prisma.$transaction(
    async (tx) => {
      const employe = await tx.employee.findUnique({
        where: { id: entree.employeeId },
      });
      if (!employe) throw nonTrouve("La fiche employe");
      if (employe.userId) {
        throw conflit(
          `${employe.firstName} ${employe.lastName} possede deja un compte nominatif.`,
        );
      }

      const email = entree.email.toLowerCase().trim();
      const existant = await tx.user.findUnique({ where: { email } });
      if (existant) {
        throw conflit(
          `L'adresse « ${email} » est deja utilisee par un autre compte. Chaque employe doit avoir son propre compte.`,
        );
      }

      const roles = await tx.role.findMany({ where: { code: { in: entree.roleCodes } } });
      const manquants = entree.roleCodes.filter(
        (code) => !roles.some((role) => role.code === code),
      );
      if (manquants.length > 0) {
        throw validation(`Roles inconnus : ${manquants.join(", ")}.`);
      }

      const compte = await tx.user.create({
        data: {
          email,
          passwordHash: hash,
          isActive: true,
          mustChangePassword: entree.mustChangePassword ?? true,
        },
      });

      await tx.employee.update({
        where: { id: entree.employeeId },
        data: { userId: compte.id, email },
      });

      for (const role of roles) {
        await tx.userRole.create({
          data: { userId: compte.id, roleId: role.id },
        });
      }

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.UTILISATEUR_CREE,
          module: MODULES_AUDIT.RH,
          entity: "Employee",
          entityId: entree.employeeId,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: {
            email,
            matricule: employe.matricule,
            roles: roles.map((role) => role.code),
            changementMotDePasseObligatoire: entree.mustChangePassword ?? true,
          },
          comment:
            "Compte nominatif cree pour un employe : aucun compte partage n'est autorise.",
        },
        tx,
      );

      return compte.id;
    },
    { timeout: 30_000 },
  );
}

// -----------------------------------------------------------------------------
// Competences et polyvalence
// -----------------------------------------------------------------------------

export async function declarerCompetence(
  entree: { employeeId: number; skillId: number; level: number; notes?: string | null },
  acteur: ActeurRh,
): Promise<void> {
  if (entree.level < 1 || entree.level > 5) {
    throw validation("Le niveau de competence doit etre compris entre 1 et 5.");
  }

  await prisma.$transaction(
    async (tx) => {
      const employe = await tx.employee.findUnique({ where: { id: entree.employeeId } });
      if (!employe) throw nonTrouve("La fiche employe");
      const competence = await tx.skill.findUnique({ where: { id: entree.skillId } });
      if (!competence) throw nonTrouve("La competence");

      const avant = await tx.employeeSkill.findUnique({
        where: {
          employeeId_skillId: { employeeId: entree.employeeId, skillId: entree.skillId },
        },
      });

      await tx.employeeSkill.upsert({
        where: {
          employeeId_skillId: { employeeId: entree.employeeId, skillId: entree.skillId },
        },
        create: {
          employeeId: entree.employeeId,
          skillId: entree.skillId,
          level: entree.level,
          certifiedAt: new Date(),
          notes: entree.notes ?? null,
        },
        update: {
          level: entree.level,
          certifiedAt: new Date(),
          notes: entree.notes ?? null,
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.RH,
          entity: "EmployeeSkill",
          entityId: entree.employeeId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { competence: competence.code, niveau: avant?.level ?? null },
          newValue: { competence: competence.code, niveau: entree.level },
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

// -----------------------------------------------------------------------------
// Affectations quotidiennes
// -----------------------------------------------------------------------------

export interface AffectationInput {
  employeeId: number;
  /** Journee d'affectation (la partie heure est ignoree). */
  date: Date;
  factory?: Factory;
  operationId: number;
  workCenterId?: number | null;
  workOrderId?: number | null;
  workOrderOperationId?: number | null;
  warehouseId?: number | null;
  plannedStart?: Date | null;
  plannedEnd?: Date | null;
  comment?: string | null;
  responsibleId?: number | null;

  // --- Programme d'atelier (facultatif, ajoute sans rien changer d'existant) --
  /** Priorite decidee par le responsable. Defaut : NORMALE. */
  priority?: Priority;
  /** Ordre explicite dans la journee : 1 = premiere tache. */
  sequenceOrder?: number;
  /** Quantite attendue a ce poste pour cette tache. */
  plannedQuantity?: Prisma.Decimal | string | number;
  /** Lot a traiter a ce poste, quand il est connu d'avance. */
  plannedLotId?: number | null;
  /** Programme de travail auquel cette tache appartient. */
  scheduleId?: number | null;
}

function jourSeul(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/**
 * Cree une affectation quotidienne. Un employe polyvalent peut recevoir
 * plusieurs affectations le meme jour : aucune contrainte d'unicite journaliere
 * n'est imposee, mais les chevauchements horaires sont refuses.
 */
export async function affecterEmploye(
  entree: AffectationInput,
  acteur: ActeurRh,
): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      const employe = await tx.employee.findUnique({
        where: { id: entree.employeeId },
        include: { workshop: true },
      });
      if (!employe) throw nonTrouve("La fiche employe");
      if (!employe.isActive) {
        throw etatInvalide(
          `L'employe ${employe.firstName} ${employe.lastName} est inactif : il ne peut pas etre affecte.`,
        );
      }

      const operation = await tx.operation.findUnique({
        where: { id: entree.operationId },
        include: { workshop: true },
      });
      if (!operation) throw nonTrouve("L'operation");
      if (!operation.isActive) {
        throw etatInvalide(`L'operation « ${operation.label} » est inactive.`);
      }

      const date = jourSeul(entree.date);
      const factory = entree.factory ?? operation.factory;

      if (entree.workOrderId) {
        const ordre = await tx.workOrder.findUnique({
          where: { id: entree.workOrderId },
          select: { id: true, number: true, status: true },
        });
        if (!ordre) throw nonTrouve("L'ordre de fabrication");
        if (ordre.status === "CLOTURE" || ordre.status === "ANNULE") {
          throw etatInvalide(
            `L'ordre ${ordre.number} est ${ordre.status === "ANNULE" ? "annule" : "cloture"} : aucune affectation possible.`,
          );
        }
      }

      // Detection de chevauchement : un employe ne peut pas etre physiquement
      // a deux postes sur le meme creneau.
      if (entree.plannedStart && entree.plannedEnd) {
        const chevauchement = await tx.assignment.findFirst({
          where: {
            employeeId: entree.employeeId,
            date,
            status: { in: ["PLANIFIEE", "EN_COURS"] },
            AND: [
              { plannedStart: { lt: entree.plannedEnd } },
              { plannedEnd: { gt: entree.plannedStart } },
            ],
          },
          include: { operation: { select: { label: true } } },
        });
        if (chevauchement) {
          throw conflit(
            `Chevauchement horaire avec l'affectation « ${chevauchement.operation.label} » deja planifiee le ${date.toLocaleDateString("fr-FR")}.`,
          );
        }
      }

      const affectation = await tx.assignment.create({
        data: {
          employeeId: entree.employeeId,
          date,
          factory,
          operationId: entree.operationId,
          workCenterId: entree.workCenterId ?? null,
          workOrderId: entree.workOrderId ?? null,
          workOrderOperationId: entree.workOrderOperationId ?? null,
          workshopId: operation.workshopId ?? employe.workshopId ?? null,
          warehouseId: entree.warehouseId ?? employe.defaultWarehouseId ?? null,
          plannedStart: entree.plannedStart ?? null,
          plannedEnd: entree.plannedEnd ?? null,
          responsibleId: entree.responsibleId ?? null,
          status: "PLANIFIEE",
          comment: entree.comment ?? null,
          priority: entree.priority ?? "NORMALE",
          sequenceOrder: entree.sequenceOrder ?? 0,
          plannedQuantity: D.of(entree.plannedQuantity ?? 0),
          plannedLotId: entree.plannedLotId ?? null,
          scheduleId: entree.scheduleId ?? null,
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CHANGEMENT_AFFECTATION,
          module: MODULES_AUDIT.RH,
          entity: "Assignment",
          entityId: affectation.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: {
            employe: `${employe.firstName} ${employe.lastName}`,
            matricule: employe.matricule,
            date: date.toISOString().slice(0, 10),
            operation: operation.label,
            usine: factory,
          },
          comment: entree.comment ?? null,
        },
        tx,
      );

      return affectation.id;
    },
    { timeout: 30_000 },
  );
}

/**
 * Reaffectation en cours de journee : l'affectation precedente est cloturee
 * avec un motif obligatoire, la nouvelle est creee. L'anciennete de l'affectation
 * est conservee : c'est elle qui determine avec quelle norme l'employe sera evalue.
 */
export async function reaffecterEmploye(
  entree: {
    assignmentId: number;
    versOperationId: number;
    versWorkCenterId?: number | null;
    /** Priorite de la nouvelle tache, si elle change. */
    versPriorite?: Priority;
    /** Nouvel ordre dans la journee, s'il change. */
    versSequence?: number;
    motif: string;
    commentaire?: string | null;
  },
  acteur: ActeurRh,
): Promise<{ ancienneId: number; nouvelleId: number }> {
  if (!entree.motif || entree.motif.trim().length < 5) {
    throw validation("Le motif de reaffectation est obligatoire (au moins 5 caracteres).");
  }

  return prisma.$transaction(
    async (tx) => {
      const affectation = await tx.assignment.findUnique({
        where: { id: entree.assignmentId },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, matricule: true } },
          operation: { select: { id: true, label: true, factory: true, workshopId: true } },
        },
      });
      if (!affectation) throw nonTrouve("L'affectation");
      if (affectation.status === "TERMINEE" || affectation.status === "ANNULEE") {
        throw conflit(
          "Cette affectation est deja close : creez une nouvelle affectation pour la suite de la journee.",
        );
      }

      const nouvelleOperation = await tx.operation.findUnique({
        where: { id: entree.versOperationId },
      });
      if (!nouvelleOperation) throw nonTrouve("L'operation de destination");
      if (!nouvelleOperation.isActive) {
        throw etatInvalide(`L'operation « ${nouvelleOperation.label} » est inactive.`);
      }

      const maintenant = new Date();

      await tx.assignment.update({
        where: { id: entree.assignmentId },
        data: {
          status: "TERMINEE",
          actualEnd: maintenant,
          changeReason: entree.motif,
          comment: entree.commentaire ?? affectation.comment,
        },
      });

      const nouvelle = await tx.assignment.create({
        data: {
          employeeId: affectation.employeeId,
          date: affectation.date,
          factory: nouvelleOperation.factory,
          operationId: nouvelleOperation.id,
          workCenterId: entree.versWorkCenterId ?? null,
          workOrderId: affectation.workOrderId,
          workshopId: nouvelleOperation.workshopId,
          warehouseId: affectation.warehouseId,
          plannedStart: maintenant,
          status: "EN_COURS",
          comment: entree.commentaire ?? `Reaffectation : ${entree.motif}`,
          priority: entree.versPriorite ?? affectation.priority,
          sequenceOrder: entree.versSequence ?? affectation.sequenceOrder,
          plannedQuantity: affectation.plannedQuantity,
          plannedLotId: affectation.plannedLotId,
          scheduleId: affectation.scheduleId,
        },
      });

      // Historique lisible de la reaffectation : qui, quand, pourquoi, et ce
      // qui a change. Ecrit sur l'affectation CLOSE, puisque c'est elle que la
      // reaffectation interrompt.
      await tx.assignmentChange.create({
        data: {
          assignmentId: affectation.id,
          changeType: "REAFFECTATION",
          previousEmployeeId: affectation.employeeId,
          newEmployeeId: affectation.employeeId,
          previousWorkCenterId: affectation.workCenterId,
          newWorkCenterId: entree.versWorkCenterId ?? null,
          previousPriority: affectation.priority,
          newPriority: entree.versPriorite ?? affectation.priority,
          previousSequence: affectation.sequenceOrder,
          newSequence: entree.versSequence ?? affectation.sequenceOrder,
          reason: entree.motif,
          changedByUserId: acteur.id,
          changedAt: maintenant,
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CHANGEMENT_AFFECTATION,
          module: MODULES_AUDIT.RH,
          entity: "Assignment",
          entityId: nouvelle.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: {
            affectation: affectation.id,
            operation: affectation.operation.label,
            statut: affectation.status,
          },
          newValue: {
            employe: `${affectation.employee.firstName} ${affectation.employee.lastName}`,
            operation: nouvelleOperation.label,
            motif: entree.motif,
          },
          comment: entree.commentaire ?? null,
        },
        tx,
      );

      return { ancienneId: affectation.id, nouvelleId: nouvelle.id };
    },
    { timeout: 30_000 },
  );
}

export async function demarrerAffectation(
  assignmentId: number,
  acteur: ActeurRh,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const affectation = await tx.assignment.findUnique({
        where: { id: assignmentId },
      });
      if (!affectation) throw nonTrouve("L'affectation");
      if (affectation.status !== "PLANIFIEE" && affectation.status !== "EN_PAUSE") {
        throw etatInvalide(
          `L'affectation est au statut ${affectation.status} : elle ne peut pas etre demarree.`,
        );
      }

      await tx.assignment.update({
        where: { id: assignmentId },
        data: {
          status: "EN_COURS",
          actualStart: affectation.actualStart ?? new Date(),
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CHANGEMENT_AFFECTATION,
          module: MODULES_AUDIT.RH,
          entity: "Assignment",
          entityId: assignmentId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: affectation.status },
          newValue: { statut: "EN_COURS" },
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

export async function cloturerAffectation(
  assignmentId: number,
  entree: { breakMinutes?: number; commentaire?: string | null },
  acteur: ActeurRh,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const affectation = await tx.assignment.findUnique({
        where: { id: assignmentId },
      });
      if (!affectation) throw nonTrouve("L'affectation");
      if (affectation.status === "TERMINEE" || affectation.status === "ANNULEE") {
        throw conflit("Cette affectation est deja close.");
      }

      await tx.assignment.update({
        where: { id: assignmentId },
        data: {
          status: "TERMINEE",
          actualEnd: new Date(),
          breakMinutes: entree.breakMinutes ?? affectation.breakMinutes,
          comment: entree.commentaire ?? affectation.comment,
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CHANGEMENT_AFFECTATION,
          module: MODULES_AUDIT.RH,
          entity: "Assignment",
          entityId: assignmentId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: affectation.status },
          newValue: { statut: "TERMINEE", pauses: entree.breakMinutes ?? affectation.breakMinutes },
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

export async function listerAffectations(filtres: {
  employeeId?: number;
  dateDebut?: Date;
  dateFin?: Date;
  factory?: Factory;
  operationId?: number;
  statut?: AssignmentStatus;
  page?: number;
  taille?: number;
}) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(500, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.AssignmentWhereInput = {};
  if (filtres.employeeId) where.employeeId = filtres.employeeId;
  if (filtres.factory) where.factory = filtres.factory;
  if (filtres.operationId) where.operationId = filtres.operationId;
  if (filtres.statut) where.status = filtres.statut;
  if (filtres.dateDebut || filtres.dateFin) {
    where.date = {};
    if (filtres.dateDebut) where.date.gte = jourSeul(filtres.dateDebut);
    if (filtres.dateFin) where.date.lte = jourSeul(filtres.dateFin);
  }

  const [total, lignes] = await Promise.all([
    prisma.assignment.count({ where }),
    prisma.assignment.findMany({
      where,
      orderBy: [{ date: "desc" }, { employeeId: "asc" }],
      skip: (page - 1) * taille,
      take: taille,
      include: {
        employee: { select: { matricule: true, firstName: true, lastName: true } },
        operation: { select: { code: true, label: true } },
        workOrder: { select: { number: true } },
        workshop: { select: { code: true, label: true } },
      },
    }),
  ]);

  return { lignes, total, page, taille, pages: Math.max(1, Math.ceil(total / taille)) };
}

// -----------------------------------------------------------------------------
// Presence
// -----------------------------------------------------------------------------

export interface PresenceInput {
  employeeId: number;
  date: Date;
  status: AttendanceStatus;
  checkIn?: Date | null;
  checkOut?: Date | null;
  workedHours?: Prisma.Decimal | string | number;
  overtimeHours?: Prisma.Decimal | string | number;
  lateMinutes?: number;
  comment?: string | null;
}

export async function enregistrerPresence(
  entree: PresenceInput,
  acteur: ActeurRh,
): Promise<void> {
  const date = jourSeul(entree.date);

  await prisma.$transaction(
    async (tx) => {
      const employe = await tx.employee.findUnique({ where: { id: entree.employeeId } });
      if (!employe) throw nonTrouve("La fiche employe");

      // Les heures travaillees se deduisent du pointage lorsqu'il est fourni,
      // afin d'eviter une incoherence entre pointage et heures declarees.
      let heures = D.of(entree.workedHours ?? 0);
      if (
        (entree.workedHours === undefined || entree.workedHours === null) &&
        entree.checkIn &&
        entree.checkOut
      ) {
        const minutes = (entree.checkOut.getTime() - entree.checkIn.getTime()) / 60_000;
        if (minutes < 0) {
          throw validation("L'heure de sortie ne peut pas preceder l'heure d'entree.");
        }
        heures = D.round(D.div(minutes, 60), 4);
      }

      const avant = await tx.attendance.findUnique({
        where: { employeeId_date: { employeeId: entree.employeeId, date } },
      });

      await tx.attendance.upsert({
        where: { employeeId_date: { employeeId: entree.employeeId, date } },
        create: {
          employeeId: entree.employeeId,
          date,
          status: entree.status,
          checkIn: entree.checkIn ?? null,
          checkOut: entree.checkOut ?? null,
          workedHours: D.round(heures, 4),
          overtimeHours: D.round(entree.overtimeHours ?? 0, 4),
          lateMinutes: entree.lateMinutes ?? 0,
          comment: entree.comment ?? null,
          recordedById: acteur.id,
        },
        update: {
          status: entree.status,
          checkIn: entree.checkIn ?? avant?.checkIn ?? null,
          checkOut: entree.checkOut ?? avant?.checkOut ?? null,
          workedHours: D.round(heures, 4),
          overtimeHours: D.round(entree.overtimeHours ?? 0, 4),
          lateMinutes: entree.lateMinutes ?? avant?.lateMinutes ?? 0,
          comment: entree.comment ?? avant?.comment ?? null,
          recordedById: acteur.id,
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.RH,
          entity: "Attendance",
          entityId: entree.employeeId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: avant
            ? { statut: avant.status, heures: avant.workedHours.toFixed(4) }
            : null,
          newValue: {
            matricule: employe.matricule,
            date: date.toISOString().slice(0, 10),
            statut: entree.status,
            heures: heures.toFixed(4),
          },
          comment: entree.comment ?? null,
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

// -----------------------------------------------------------------------------
// MOTEUR D'EVALUATION
// -----------------------------------------------------------------------------

/**
 * Codes d'indicateurs utilises dans `rawMetrics`. Ils sont exposes tels quels
 * dans les ecrans et les exports afin que chaque score reste auditable.
 */
export const INDICATEURS_EVALUATION = {
  PRODUCTIVITE: [
    "taux_realisation_quantite",
    "respect_temps_standard",
    "respect_delais",
    "taux_activite",
  ],
  QUALITE: [
    "taux_conformite",
    "taux_rebut",
    "taux_reprise",
    "non_conformites",
    "controles_reussis",
  ],
  EFFICACITE_MATIERE: [
    "consommation_normale",
    "surconsommation",
    "perte_normale",
    "perte_exceptionnelle",
    "retour_stock",
    "ecart_consommation_theorique",
  ],
  PRESENCE: [
    "taux_presence",
    "taux_retards",
    "heures_travaillees",
    "heures_supplementaires",
  ],
  POLYVALENCE: [
    "operations_maitrisees",
    "operations_realisees",
    "niveau_competences",
  ],
} as const;

export type AxeEvaluation = keyof typeof INDICATEURS_EVALUATION;

const LIBELLES_AXES: Record<AxeEvaluation, string> = {
  PRODUCTIVITE: "Productivite",
  QUALITE: "Qualite",
  EFFICACITE_MATIERE: "Efficacite matiere",
  PRESENCE: "Presence",
  POLYVALENCE: "Polyvalence",
};

/**
 * Nombre minimal d'observations pour qu'un axe soit considere comme exploitable.
 * En dessous, l'axe est exclu du score global et signale comme non fiable :
 * l'application ne presente pas un score trompeur.
 */
const SEUIL_OBSERVATIONS: Record<AxeEvaluation, number> = {
  PRODUCTIVITE: 3,
  QUALITE: 3,
  EFFICACITE_MATIERE: 2,
  PRESENCE: 5,
  POLYVALENCE: 1,
};

export interface PonderationAxe {
  code: string;
  label: string;
  weight: Decimal;
}

/**
 * Charge les ponderations depuis la base (jamais codees en dur). Une ponderation
 * absente retombe sur la valeur de configuration, elle-meme modifiable.
 */
export async function ponderationsAxes(db: Db = prisma): Promise<PonderationAxe[]> {
  const enregistrees = await db.evaluationWeight.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
  });

  const parCode = new Map(enregistrees.map((ligne) => [ligne.code, ligne]));

  const resultat: PonderationAxe[] = [];
  for (const axe of Object.keys(INDICATEURS_EVALUATION) as AxeEvaluation[]) {
    const ligne = parCode.get(axe);
    if (ligne) {
      resultat.push({ code: axe, label: ligne.label, weight: D.of(ligne.weight) });
      continue;
    }

    const defaut = await poidsParDefaut(axe, db);
    resultat.push({ code: axe, label: LIBELLES_AXES[axe], weight: defaut });
  }

  return resultat;
}

const CLE_POIDS: Record<AxeEvaluation, string> = {
  PRODUCTIVITE: CLE_PARAMETRE.EVAL_POIDS_PRODUCTIVITE,
  QUALITE: CLE_PARAMETRE.EVAL_POIDS_QUALITE,
  EFFICACITE_MATIERE: CLE_PARAMETRE.EVAL_POIDS_EFFICACITE_MATIERE,
  PRESENCE: CLE_PARAMETRE.EVAL_POIDS_PRESENCE,
  POLYVALENCE: CLE_PARAMETRE.EVAL_POIDS_POLYVALENCE,
};

const POIDS_PAR_DEFAUT: Record<AxeEvaluation, number> = {
  PRODUCTIVITE: 30,
  QUALITE: 25,
  EFFICACITE_MATIERE: 20,
  PRESENCE: 15,
  POLYVALENCE: 10,
};

async function poidsParDefaut(axe: AxeEvaluation, db: Db): Promise<Decimal> {
  const valeur = await lireParametreNombre(CLE_POIDS[axe], POIDS_PAR_DEFAUT[axe], db);
  return D.of(valeur);
}

export interface LigneOperationEvaluee {
  operationId: number;
  operationCode: string;
  operationLabel: string;
  /** Vrai uniquement si l'employe a reellement travaille cette operation. */
  reellementEffectuee: boolean;
  affectations: number;
  minutesAffectees: Decimal;
  quantiteProduite: Decimal;
  quantiteConforme: Decimal;
  quantiteRebut: Decimal;
  quantiteReprise: Decimal;
  minutesDeclarees: Decimal;
  minutesNormales: Decimal;
  tauxRealisation: Decimal | null;
  tauxConformite: Decimal | null;
  efficienceTemps: Decimal | null;
}

export interface MetriqueIndicateur {
  code: string;
  label: string;
  valeur: Decimal | null;
  score: Decimal | null;
  observations: number;
  fiable: boolean;
}

export interface ResultatAxe {
  axe: AxeEvaluation;
  label: string;
  poids: Decimal;
  score: Decimal | null;
  retenu: boolean;
  raisonExclusion: string | null;
  indicateurs: MetriqueIndicateur[];
}

export interface ResultatEvaluation {
  employeeId: number;
  matricule: string;
  employe: string;
  periodType: EvaluationPeriodType;
  periodStart: Date;
  periodEnd: Date;
  factory: Factory;
  operationId: number | null;
  operationLabel: string | null;
  axes: ResultatAxe[];
  scoreGlobal: Decimal | null;
  fiabilite: ReliabilityLevel;
  messageFiabilite: string;
  affectationsCount: number;
  operationsRealisees: number;
  operationsMaitrisees: number;
  operationsEvaluees: LigneOperationEvaluee[];
  ponderations: PonderationAxe[];
  avertissements: string[];
}

interface BornesPeriode {
  debut: Date;
  fin: Date;
}

function bornerPeriode(
  periodType: EvaluationPeriodType,
  reference: Date,
): BornesPeriode {
  const debut = new Date(reference);
  debut.setHours(0, 0, 0, 0);

  if (periodType === "JOUR") {
    const fin = new Date(debut);
    fin.setHours(23, 59, 59, 999);
    return { debut, fin };
  }

  if (periodType === "SEMAINE") {
    // Semaine ISO : lundi comme premier jour.
    const jour = (debut.getDay() + 6) % 7;
    debut.setDate(debut.getDate() - jour);
    const fin = new Date(debut);
    fin.setDate(fin.getDate() + 6);
    fin.setHours(23, 59, 59, 999);
    return { debut, fin };
  }

  const debutMois = new Date(debut.getFullYear(), debut.getMonth(), 1);
  const finMois = new Date(debut.getFullYear(), debut.getMonth() + 1, 0, 23, 59, 59, 999);
  return { debut: debutMois, fin: finMois };
}

/** Borne une note dans l'intervalle [0, 100]. */
function bornerScore(valeur: Decimal | null): Decimal | null {
  if (valeur === null) return null;
  return D.max(D.ZERO, D.min(D.CENT, D.round(valeur, 2)));
}

/**
 * Note de type « plus c'est haut, mieux c'est » sur une base 100,
 * a partir d'un ratio (valeur / objectif).
 */
function scoreProportion(realise: Decimal, objectif: Decimal): Decimal | null {
  if (D.lte(objectif, 0)) return null;
  return bornerScore(D.mul(D.div(realise, objectif), D.CENT));
}

/**
 * Note de type « plus c'est bas, mieux c'est » : un taux nul vaut 100,
 * un taux egal ou superieur au seuil de tolerance vaut 0.
 */
function scoreInverse(taux: Decimal, tolerance: Decimal): Decimal | null {
  if (D.lte(tolerance, 0)) return null;
  if (D.lte(taux, 0)) return D.CENT;
  if (D.gte(taux, tolerance)) return D.ZERO;
  return bornerScore(D.mul(D.sub(D.UN, D.div(taux, tolerance)), D.CENT));
}

function moyennePonderee(
  entrees: { score: Decimal; poids: Decimal }[],
): Decimal | null {
  let totalPoids = D.ZERO;
  let total = D.ZERO;
  for (const entree of entrees) {
    total = D.add(total, D.mul(entree.score, entree.poids));
    totalPoids = D.add(totalPoids, entree.poids);
  }
  if (D.lte(totalPoids, 0)) return null;
  return D.round(D.div(total, totalPoids), 2);
}

/**
 * Calcule l'evaluation d'un employe sur une periode, eventuellement restreinte
 * a une operation ou un atelier.
 *
 * Point cle : la boucle sur les operations ne retient que les operations pour
 * lesquelles une affectation reelle existe. Un employe affecte a la couture
 * n'est jamais compare au temps standard du soudage.
 */
export async function calculerEvaluation(
  entree: {
    employeeId: number;
    periodType: EvaluationPeriodType;
    /** Date de reference dans la periode (defaut : aujourd'hui). */
    reference?: Date;
    /** Restreint le calcul a une operation precise. */
    operationId?: number | null;
    /** Restreint le calcul a un atelier. */
    workshopId?: number | null;
    /** Restreint le calcul a une usine. */
    factory?: Factory | null;
    /** Tolerances utilisees pour noter les taux d'echec (en pourcentage). */
    toleranceRebut?: number;
    toleranceReprise?: number;
    toleranceSurconsommation?: number;
    tolerancePerteExceptionnelle?: number;
    toleranceRetard?: number;
  },
  db: Db = prisma,
): Promise<ResultatEvaluation> {
  const avertissements: string[] = [];

  const employe = await db.employee.findUnique({
    where: { id: entree.employeeId },
    include: { workshop: { select: { id: true, code: true, label: true } } },
  });
  if (!employe) throw nonTrouve("La fiche employe");

  const { debut, fin } = bornerPeriode(entree.periodType, entree.reference ?? new Date());
  const factory = entree.factory ?? employe.factory;

  // ---------------------------------------------------------------------------
  // 1. Affectations reelles de la periode
  // ---------------------------------------------------------------------------
  const affectations = await db.assignment.findMany({
    where: {
      employeeId: entree.employeeId,
      date: { gte: debut, lte: fin },
      status: { notIn: ["ANNULEE"] },
      ...(entree.operationId ? { operationId: entree.operationId } : {}),
      ...(entree.workshopId ? { workshopId: entree.workshopId } : {}),
      ...(entree.factory ? { factory: entree.factory } : {}),
    },
    include: {
      operation: {
        select: {
          id: true,
          code: true,
          label: true,
          standardTimeMinutes: true,
          standardLossRate: true,
        },
      },
      workOrderOperation: {
        select: {
          id: true,
          quantityPlanned: true,
          quantityProduced: true,
          quantityConform: true,
          quantityScrapped: true,
          quantityRework: true,
          plannedEnd: true,
          actualEnd: true,
          status: true,
        },
      },
    },
    orderBy: { date: "asc" },
  });

  if (affectations.length === 0) {
    avertissements.push(
      "Aucune affectation reelle sur la periode : l'evaluation ne peut pas etre calculee sur des donnees d'activite inexistantes.",
    );
  }

  // ---------------------------------------------------------------------------
  // 2. Declarations de l'employe sur la periode
  // ---------------------------------------------------------------------------
  const declarations = await db.operationDeclaration.findMany({
    where: {
      employeeId: entree.employeeId,
      occurredAt: { gte: debut, lte: fin },
      status: { notIn: ["REJETEE"] },
      ...(entree.operationId ? { operationId: entree.operationId } : {}),
    },
    include: {
      operation: { select: { id: true, code: true, label: true, standardTimeMinutes: true } },
    },
  });

  // ---------------------------------------------------------------------------
  // 3. Consolidation par operation REELLEMENT effectuee
  // ---------------------------------------------------------------------------
  const parOperation = new Map<number, LigneOperationEvaluee>();

  const ligneVide = (operation: {
    id: number;
    code: string;
    label: string;
  }): LigneOperationEvaluee => ({
    operationId: operation.id,
    operationCode: operation.code,
    operationLabel: operation.label,
    reellementEffectuee: true,
    affectations: 0,
    minutesAffectees: D.ZERO,
    quantiteProduite: D.ZERO,
    quantiteConforme: D.ZERO,
    quantiteRebut: D.ZERO,
    quantiteReprise: D.ZERO,
    minutesDeclarees: D.ZERO,
    minutesNormales: D.ZERO,
    tauxRealisation: null,
    tauxConformite: null,
    efficienceTemps: null,
  });

  for (const affectation of affectations) {
    const ligne =
      parOperation.get(affectation.operationId) ??
      ligneVide(affectation.operation);
    parOperation.set(affectation.operationId, ligne);
    ligne.affectations += 1;

    if (affectation.actualStart) {
      const finReelle = affectation.actualEnd ?? new Date();
      const minutes =
        (finReelle.getTime() - affectation.actualStart.getTime()) / 60_000 -
        affectation.breakMinutes;
      if (minutes > 0) {
        ligne.minutesAffectees = D.add(ligne.minutesAffectees, D.round(minutes, 4));
      }
    }
  }

  for (const declaration of declarations) {
    const ligne =
      parOperation.get(declaration.operationId) ??
      ligneVide(declaration.operation);
    parOperation.set(declaration.operationId, ligne);

    if (declaration.durationMinutes) {
      ligne.minutesDeclarees = D.add(
        ligne.minutesDeclarees,
        D.round(declaration.durationMinutes, 4),
      );
    }

    switch (declaration.kind) {
      case "PRODUCTION": {
        ligne.quantiteProduite = D.add(ligne.quantiteProduite, declaration.quantity);
        ligne.quantiteConforme = D.add(ligne.quantiteConforme, declaration.quantityConform);
        break;
      }
      case "PERTE": {
        if (declaration.lossCategory === "REBUT") {
          ligne.quantiteRebut = D.add(ligne.quantiteRebut, declaration.quantity);
        } else if (declaration.lossCategory === "REPRISE") {
          ligne.quantiteReprise = D.add(ligne.quantiteReprise, declaration.quantity);
        }
        break;
      }
      default:
        break;
    }
  }

  // Temps normal : quantite conforme x temps standard de CETTE operation.
  const operationsEvaluees: LigneOperationEvaluee[] = [];
  for (const ligne of parOperation.values()) {
    const operation = affectations.find((a) => a.operationId === ligne.operationId)?.operation;
    const tempsStandard = D.of(operation?.standardTimeMinutes ?? 0);

    ligne.minutesNormales = D.round(D.mul(ligne.quantiteConforme, tempsStandard), 4);

    ligne.tauxConformite = D.gt(ligne.quantiteProduite, 0)
      ? D.round(D.div(ligne.quantiteConforme, ligne.quantiteProduite), 6)
      : null;

    // Objectif de quantite : quantite planifiee des ordres reellement touches.
    const quantitePlanifiee = affectations
      .filter((a) => a.operationId === ligne.operationId && a.workOrderOperation)
      .reduce(
        (total, a) => D.add(total, D.of(a.workOrderOperation?.quantityPlanned ?? 0)),
        D.ZERO,
      );
    ligne.tauxRealisation =
      D.gt(quantitePlanifiee, 0)
        ? D.round(D.div(ligne.quantiteProduite, quantitePlanifiee), 6)
        : null;

    const minutesReference = D.gt(ligne.minutesAffectees, 0)
      ? ligne.minutesAffectees
      : ligne.minutesDeclarees;
    ligne.efficienceTemps =
      D.gt(minutesReference, 0) && D.gt(ligne.minutesNormales, 0)
        ? D.round(D.div(ligne.minutesNormales, minutesReference), 6)
        : null;

    operationsEvaluees.push(ligne);
  }

  const operationsRealisees = operationsEvaluees.filter(
    (ligne) => ligne.reellementEffectuee,
  );

  if (operationsRealisees.length === 0 && affectations.length > 0) {
    avertissements.push(
      "Aucune operation reellement effectuee n'a pu etre identifiee : verifiez les pointages d'affectation.",
    );
  }

  // ---------------------------------------------------------------------------
  // 4. Competences et polyvalence
  // ---------------------------------------------------------------------------
  const competences = await db.employeeSkill.findMany({
    where: { employeeId: entree.employeeId },
    include: { skill: { select: { operationId: true } } },
  });

  const operationsMaitrisees = new Set(
    competences
      .filter((competence) => competence.level >= 3 && competence.skill.operationId)
      .map((competence) => competence.skill.operationId as number),
  ).size;

  const niveauMoyenCompetences =
    competences.length > 0
      ? D.round(
          D.div(
            competences.reduce((total, c) => D.add(total, c.level), D.ZERO),
            competences.length,
          ),
          4,
        )
      : null;

  // ---------------------------------------------------------------------------
  // 5. Presence
  // ---------------------------------------------------------------------------
  const presences = await db.attendance.findMany({
    where: { employeeId: entree.employeeId, date: { gte: debut, lte: fin } },
  });

  const joursPresence = presences.filter((p) => p.status === "PRESENT" || p.status === "RETARD").length;
  const joursRetard = presences.filter((p) => p.status === "RETARD").length;
  const minutesRetard = presences.reduce((total, p) => total + p.lateMinutes, 0);
  const heuresTravaillees = presences.reduce(
    (total, p) => D.add(total, D.of(p.workedHours)),
    D.ZERO,
  );
  const heuresSupplementaires = presences.reduce(
    (total, p) => D.add(total, D.of(p.overtimeHours)),
    D.ZERO,
  );

  // ---------------------------------------------------------------------------
  // 6. Non-conformites et controles
  // ---------------------------------------------------------------------------
  const operationIds = operationsRealisees.map((ligne) => ligne.operationId);

  const nonConformites = await db.nonConformity.count({
    where: {
      detectedAt: { gte: debut, lte: fin },
      OR: [
        { detectedById: entree.employeeId },
        {
          workOrder: {
            operations: { some: { operatorId: entree.employeeId } },
          },
        },
      ],
    },
  });

  const controles = await db.qualityCheck.findMany({
    where: {
      checkedAt: { gte: debut, lte: fin },
      workOrder: { operations: { some: { operatorId: entree.employeeId } } },
    },
    select: { decision: true },
  });

  const controlesReussis = controles.filter(
    (controle) => controle.decision === "ACCEPTE" || controle.decision === "ACCEPTE_SOUS_RESERVE",
  ).length;

  // ---------------------------------------------------------------------------
  // 7. Consommations et pertes par categorie
  // ---------------------------------------------------------------------------
  const declarationsPerte = await db.operationDeclaration.findMany({
    where: {
      employeeId: entree.employeeId,
      occurredAt: { gte: debut, lte: fin },
      kind: "PERTE",
      status: { notIn: ["REJETEE"] },
      ...(entree.operationId ? { operationId: entree.operationId } : {}),
    },
    select: { lossCategory: true, quantity: true, isExceptional: true },
  });

  const totalPertes = declarationsPerte.reduce(
    (total, ligne) => D.add(total, D.of(ligne.quantity)),
    D.ZERO,
  );

  const parCategorie = new Map<string, Decimal>();
  for (const ligne of declarationsPerte) {
    const categorie = ligne.lossCategory ?? "AUTRE";
    parCategorie.set(
      categorie,
      D.add(parCategorie.get(categorie) ?? D.ZERO, D.of(ligne.quantity)),
    );
  }

  const consommations = await db.operationDeclaration.findMany({
    where: {
      employeeId: entree.employeeId,
      occurredAt: { gte: debut, lte: fin },
      kind: "CONSOMMATION",
      status: { notIn: ["REJETEE"] },
      ...(entree.operationId ? { operationId: entree.operationId } : {}),
    },
    select: { quantity: true, materialId: true },
  });

  const totalConsomme = consommations.reduce(
    (total, ligne) => D.add(total, D.of(ligne.quantity)),
    D.ZERO,
  );

  // Consommation theorique : quantite produite x quantite prevue par la nomenclature
  // de l'ordre reellement execute.
  const materiaux = await db.workOrderMaterial.findMany({
    where: {
      declarations: {
        some: {
          employeeId: entree.employeeId,
          occurredAt: { gte: debut, lte: fin },
          kind: "CONSOMMATION",
        },
      },
    },
    select: { quantityPlanned: true, quantityConsumed: true, lossRate: true },
  });

  const consommationTheorique = materiaux.reduce((total, materiau) => {
    const prevue = D.of(materiau.quantityPlanned);
    const perte = D.mul(prevue, D.div(D.of(materiau.lossRate), D.CENT));
    return D.add(total, D.add(prevue, perte));
  }, D.ZERO);

  const ecartConsommation = D.gt(consommationTheorique, 0)
    ? D.round(D.div(D.sub(totalConsomme, consommationTheorique), consommationTheorique), 6)
    : null;

  // ---------------------------------------------------------------------------
  // 8. Notation par axe
  // ---------------------------------------------------------------------------
  const tolerances = {
    rebut: D.of(entree.toleranceRebut ?? 5),
    reprise: D.of(entree.toleranceReprise ?? 5),
    surconsommation: D.of(entree.toleranceSurconsommation ?? 10),
    perteExceptionnelle: D.of(entree.tolerancePerteExceptionnelle ?? 2),
    retard: D.of(entree.toleranceRetard ?? 5),
  };

  const indicateur = (
    code: string,
    label: string,
    valeur: Decimal | null,
    score: Decimal | null,
    observations: number,
    seuil: number,
  ): MetriqueIndicateur => ({
    code,
    label,
    valeur,
    score,
    observations,
    fiable: observations >= seuil,
  });

  const poidsOperations = operationsRealisees.map((ligne) => ({
    ligne,
    poids: D.max(D.of(ligne.affectations), D.UN),
  }));

  function moyenneSurOperations(
    selecteur: (ligne: LigneOperationEvaluee) => Decimal | null,
  ): Decimal | null {
    const entrees: { score: Decimal; poids: Decimal }[] = [];
    for (const { ligne, poids } of poidsOperations) {
      const score = selecteur(ligne);
      if (score !== null) entrees.push({ score, poids });
    }
    return moyennePonderee(entrees);
  }

  // --- Productivite ---
  const scoresRealisation = operationsRealisees
    .map((ligne) => ligne.tauxRealisation)
    .filter((valeur): valeur is Decimal => valeur !== null);
  const tauxRealisationMoyen =
    scoresRealisation.length > 0
      ? D.round(
          D.div(
            scoresRealisation.reduce((total, valeur) => D.add(total, valeur), D.ZERO),
            scoresRealisation.length,
          ),
          6,
        )
      : null;

  const scoreRealisation =
    tauxRealisationMoyen === null ? null : bornerScore(D.mul(tauxRealisationMoyen, D.CENT));

  const scoreEfficience = moyenneSurOperations((ligne) =>
    ligne.efficienceTemps === null
      ? null
      : bornerScore(D.mul(ligne.efficienceTemps, D.CENT)),
  );

  const operationsAvecDelai = await db.workOrderOperation.findMany({
    where: {
      operatorId: entree.employeeId,
      actualEnd: { gte: debut, lte: fin },
    },
    select: { id: true, plannedEnd: true, actualEnd: true },
  });

  const operationsALHeure = operationsAvecDelai.filter(
    (operation) =>
      !operation.plannedEnd ||
      !operation.actualEnd ||
      operation.actualEnd.getTime() <= operation.plannedEnd.getTime(),
  ).length;

  const scoreDelais =
    operationsAvecDelai.length > 0
      ? bornerScore(
          D.mul(D.div(operationsALHeure, operationsAvecDelai.length), D.CENT),
        )
      : null;

  const minutesAffecteesTotal = operationsRealisees.reduce(
    (total, ligne) => D.add(total, ligne.minutesAffectees),
    D.ZERO,
  );
  const minutesTravaillees = D.add(
    D.mul(heuresTravaillees, 60),
    D.ZERO,
  );
  const scoreActivite =
    D.gt(minutesAffecteesTotal, 0)
      ? bornerScore(D.mul(D.div(minutesTravaillees, minutesAffecteesTotal), D.CENT))
      : null;

  const axeProductivite: ResultatAxe = {
    axe: "PRODUCTIVITE",
    label: LIBELLES_AXES.PRODUCTIVITE,
    poids: D.ZERO,
    score: moyennePonderee([
      { score: scoreRealisation ?? D.ZERO, poids: D.of(45) },
      { score: scoreEfficience ?? D.ZERO, poids: D.of(35) },
      { score: scoreDelais ?? D.ZERO, poids: D.of(10) },
      { score: scoreActivite ?? D.ZERO, poids: D.of(10) },
    ].filter(
      (entree_) =>
        entree_.score !== D.ZERO ||
        scoreRealisation !== null ||
        scoreEfficience !== null ||
        scoreDelais !== null ||
        scoreActivite !== null,
    )),
    retenu: false,
    raisonExclusion: null,
    indicateurs: [
      indicateur(
        "taux_realisation_quantite",
        "Taux de realisation des quantites",
        tauxRealisationMoyen === null
          ? null
          : D.round(D.mul(tauxRealisationMoyen, D.CENT), 2),
        scoreRealisation,
        scoresRealisation.length,
        SEUIL_OBSERVATIONS.PRODUCTIVITE,
      ),
      indicateur(
        "respect_temps_standard",
        "Respect du temps standard de l'operation",
        moyenneSurOperations((ligne) => ligne.efficienceTemps),
        scoreEfficience,
        operationsRealisees.filter((ligne) => ligne.efficienceTemps !== null).length,
        SEUIL_OBSERVATIONS.PRODUCTIVITE,
      ),
      indicateur(
        "respect_delais",
        "Operations terminees dans les delais",
        operationsAvecDelai.length > 0
          ? D.round(D.mul(D.div(operationsALHeure, operationsAvecDelai.length), D.CENT), 2)
          : null,
        scoreDelais,
        operationsAvecDelai.length,
        3,
      ),
      indicateur(
        "taux_activite",
        "Taux d'activite (heures travaillees / heures affectees)",
        D.gt(minutesAffecteesTotal, 0)
          ? D.round(D.mul(D.div(minutesTravaillees, minutesAffecteesTotal), D.CENT), 2)
          : null,
        scoreActivite,
        presences.length,
        3,
      ),
    ],
  };

  // --- Qualite ---
  const quantiteProduiteTotal = operationsRealisees.reduce(
    (total, ligne) => D.add(total, ligne.quantiteProduite),
    D.ZERO,
  );
  const quantiteConformeTotal = operationsRealisees.reduce(
    (total, ligne) => D.add(total, ligne.quantiteConforme),
    D.ZERO,
  );
  const quantiteRebutTotal = operationsRealisees.reduce(
    (total, ligne) => D.add(total, ligne.quantiteRebut),
    D.ZERO,
  );
  const quantiteRepriseTotal = operationsRealisees.reduce(
    (total, ligne) => D.add(total, ligne.quantiteReprise),
    D.ZERO,
  );

  const tauxConformiteGlobal = D.gt(quantiteProduiteTotal, 0)
    ? D.round(D.div(quantiteConformeTotal, quantiteProduiteTotal), 6)
    : null;
  const tauxRebut = D.gt(quantiteProduiteTotal, 0)
    ? D.round(D.div(quantiteRebutTotal, quantiteProduiteTotal), 6)
    : null;
  const tauxReprise = D.gt(quantiteProduiteTotal, 0)
    ? D.round(D.div(quantiteRepriseTotal, quantiteProduiteTotal), 6)
    : null;

  const scoreConformite =
    tauxConformiteGlobal === null ? null : bornerScore(D.mul(tauxConformiteGlobal, D.CENT));
  const scoreRebut = tauxRebut === null ? null : scoreInverse(tauxRebut, tolerances.rebut);
  const scoreReprise = tauxReprise === null ? null : scoreInverse(tauxReprise, tolerances.reprise);
  const scoreNonConformites =
    operationsRealisees.length > 0
      ? bornerScore(
          D.mul(
            D.sub(D.UN, D.min(D.UN, D.div(nonConformites, operationsRealisees.length))),
            D.CENT,
          ),
        )
      : null;
  const scoreControles =
    controles.length > 0
      ? bornerScore(D.mul(D.div(controlesReussis, controles.length), D.CENT))
      : null;

  const composantesQualite = [
    { score: scoreConformite, poids: D.of(40) },
    { score: scoreRebut, poids: D.of(25) },
    { score: scoreReprise, poids: D.of(15) },
    { score: scoreNonConformites, poids: D.of(10) },
    { score: scoreControles, poids: D.of(10) },
  ].filter((composante): composante is { score: Decimal; poids: Decimal } => composante.score !== null);

  const axeQualite: ResultatAxe = {
    axe: "QUALITE",
    label: LIBELLES_AXES.QUALITE,
    poids: D.ZERO,
    score: moyennePonderee(composantesQualite),
    retenu: false,
    raisonExclusion: null,
    indicateurs: [
      indicateur(
        "taux_conformite",
        "Taux de conformite",
        tauxConformiteGlobal === null
          ? null
          : D.round(D.mul(tauxConformiteGlobal, D.CENT), 2),
        scoreConformite,
        operationsRealisees.length,
        SEUIL_OBSERVATIONS.QUALITE,
      ),
      indicateur(
        "taux_rebut",
        "Taux de rebut",
        tauxRebut === null ? null : D.round(D.mul(tauxRebut, D.CENT), 2),
        scoreRebut,
        operationsRealisees.length,
        SEUIL_OBSERVATIONS.QUALITE,
      ),
      indicateur(
        "taux_reprise",
        "Taux de reprise",
        tauxReprise === null ? null : D.round(D.mul(tauxReprise, D.CENT), 2),
        scoreReprise,
        operationsRealisees.length,
        SEUIL_OBSERVATIONS.QUALITE,
      ),
      indicateur(
        "non_conformites",
        "Non-conformites rattachees a l'employe",
        D.of(nonConformites),
        scoreNonConformites,
        operationsRealisees.length,
        1,
      ),
      indicateur(
        "controles_reussis",
        "Controles qualite reussis",
        controles.length > 0
          ? D.round(D.mul(D.div(controlesReussis, controles.length), D.CENT), 2)
          : null,
        scoreControles,
        controles.length,
        2,
      ),
    ],
  };

  // --- Efficacite matiere ---
  const valeurCategorie = (categorie: string) => parCategorie.get(categorie) ?? D.ZERO;

  const partConsommationNormale = D.gt(totalConsomme, 0)
    ? D.round(D.div(valeurCategorie("CONSOMMATION_NORMALE"), totalConsomme), 6)
    : null;
  const partSurconsommation = D.gt(totalConsomme, 0)
    ? D.round(D.div(valeurCategorie("SURCONSOMMATION"), totalConsomme), 6)
    : null;
  const partPerteNormale = D.gt(totalPertes, 0)
    ? D.round(D.div(valeurCategorie("PERTE_NORMALE"), totalPertes), 6)
    : null;
  const partPerteExceptionnelle = D.gt(totalPertes, 0)
    ? D.round(D.div(valeurCategorie("PERTE_EXCEPTIONNELLE"), totalPertes), 6)
    : null;
  const partRetourStock = D.gt(totalPertes, 0)
    ? D.round(D.div(valeurCategorie("RETOUR_STOCK"), totalPertes), 6)
    : null;

  const scoreConsommationNormale =
    partConsommationNormale === null
      ? null
      : bornerScore(D.mul(partConsommationNormale, D.CENT));
  const scoreSurconsommation =
    partSurconsommation === null
      ? null
      : scoreInverse(partSurconsommation, tolerances.surconsommation);
  const scorePerteNormale =
    partPerteNormale === null
      ? null
      : bornerScore(D.mul(D.sub(D.UN, partPerteNormale), D.CENT));
  const scorePerteExceptionnelle =
    partPerteExceptionnelle === null
      ? null
      : scoreInverse(partPerteExceptionnelle, tolerances.perteExceptionnelle);
  const scoreRetourStock =
    partRetourStock === null ? null : bornerScore(D.mul(partRetourStock, D.CENT));
  const scoreEcartConsommation =
    ecartConsommation === null
      ? null
      : ecartConsommation.isNegative()
        ? D.CENT
        : scoreInverse(ecartConsommation, D.div(tolerances.surconsommation, D.CENT));

  const composantesMatiere = [
    { score: scoreConsommationNormale, poids: D.of(20) },
    { score: scoreSurconsommation, poids: D.of(25) },
    { score: scorePerteNormale, poids: D.of(15) },
    { score: scorePerteExceptionnelle, poids: D.of(20) },
    { score: scoreRetourStock, poids: D.of(10) },
    { score: scoreEcartConsommation, poids: D.of(10) },
  ].filter((composante): composante is { score: Decimal; poids: Decimal } => composante.score !== null);

  const axeMatiere: ResultatAxe = {
    axe: "EFFICACITE_MATIERE",
    label: LIBELLES_AXES.EFFICACITE_MATIERE,
    poids: D.ZERO,
    score: moyennePonderee(composantesMatiere),
    retenu: false,
    raisonExclusion: null,
    indicateurs: [
      indicateur(
        "consommation_normale",
        "Part de consommation normale",
        partConsommationNormale === null
          ? null
          : D.round(D.mul(partConsommationNormale, D.CENT), 2),
        scoreConsommationNormale,
        consommations.length,
        SEUIL_OBSERVATIONS.EFFICACITE_MATIERE,
      ),
      indicateur(
        "surconsommation",
        "Part de surconsommation",
        partSurconsommation === null
          ? null
          : D.round(D.mul(partSurconsommation, D.CENT), 2),
        scoreSurconsommation,
        consommations.length,
        SEUIL_OBSERVATIONS.EFFICACITE_MATIERE,
      ),
      indicateur(
        "perte_normale",
        "Part de perte normale autorisee",
        partPerteNormale === null ? null : D.round(D.mul(partPerteNormale, D.CENT), 2),
        scorePerteNormale,
        declarationsPerte.length,
        SEUIL_OBSERVATIONS.EFFICACITE_MATIERE,
      ),
      indicateur(
        "perte_exceptionnelle",
        "Part de perte exceptionnelle",
        partPerteExceptionnelle === null
          ? null
          : D.round(D.mul(partPerteExceptionnelle, D.CENT), 2),
        scorePerteExceptionnelle,
        declarationsPerte.length,
        SEUIL_OBSERVATIONS.EFFICACITE_MATIERE,
      ),
      indicateur(
        "retour_stock",
        "Part retournee au stock",
        partRetourStock === null ? null : D.round(D.mul(partRetourStock, D.CENT), 2),
        scoreRetourStock,
        declarationsPerte.length,
        1,
      ),
      indicateur(
        "ecart_consommation_theorique",
        "Ecart a la consommation theorique de la nomenclature",
        ecartConsommation === null
          ? null
          : D.round(D.mul(ecartConsommation, D.CENT), 2),
        scoreEcartConsommation,
        materiaux.length,
        SEUIL_OBSERVATIONS.EFFICACITE_MATIERE,
      ),
    ],
  };

  // --- Presence ---
  const joursOuvrables = presences.length;
  const tauxPresence =
    joursOuvrables > 0 ? D.round(D.div(joursPresence, joursOuvrables), 6) : null;
  const tauxRetards =
    joursPresence > 0 ? D.round(D.div(joursRetard, joursPresence), 6) : null;

  const scorePresence = tauxPresence === null ? null : bornerScore(D.mul(tauxPresence, D.CENT));
  const scoreRetards = tauxRetards === null ? null : scoreInverse(tauxRetards, tolerances.retard);
  const scoreHeures =
    heuresTravaillees.isZero() && heuresSupplementaires.isZero()
      ? null
      : bornerScore(D.min(D.CENT, D.mul(heuresTravaillees, D.of(10))));
  // Les heures supplementaires sont valorisees de facon neutre : elles ne
  // penalisent jamais l'employe mais ne gonflent pas artificiellement la note.
  const scoreHeuresSupp = heuresSupplementaires.isZero() ? null : D.CENT;

  const composantesPresence = [
    { score: scorePresence, poids: D.of(50) },
    { score: scoreRetards, poids: D.of(25) },
    { score: scoreHeures, poids: D.of(15) },
    { score: scoreHeuresSupp, poids: D.of(10) },
  ].filter((composante): composante is { score: Decimal; poids: Decimal } => composante.score !== null);

  const axePresence: ResultatAxe = {
    axe: "PRESENCE",
    label: LIBELLES_AXES.PRESENCE,
    poids: D.ZERO,
    score: moyennePonderee(composantesPresence),
    retenu: false,
    raisonExclusion: null,
    indicateurs: [
      indicateur(
        "taux_presence",
        "Taux de presence",
        tauxPresence === null ? null : D.round(D.mul(tauxPresence, D.CENT), 2),
        scorePresence,
        presences.length,
        SEUIL_OBSERVATIONS.PRESENCE,
      ),
      indicateur(
        "taux_retards",
        "Taux de retards",
        tauxRetards === null ? null : D.round(D.mul(tauxRetards, D.CENT), 2),
        scoreRetards,
        joursPresence,
        SEUIL_OBSERVATIONS.PRESENCE,
      ),
      indicateur(
        "heures_travaillees",
        "Heures travaillees sur la periode",
        D.round(heuresTravaillees, 2),
        scoreHeures,
        presences.length,
        SEUIL_OBSERVATIONS.PRESENCE,
      ),
      indicateur(
        "heures_supplementaires",
        "Heures supplementaires",
        D.round(heuresSupplementaires, 2),
        scoreHeuresSupp,
        presences.filter((p) => D.gt(p.overtimeHours, 0)).length,
        1,
      ),
    ],
  };

  // --- Polyvalence ---
  const scoreOperationsMaitrisees = bornerScore(
    D.mul(D.div(operationsMaitrisees, D.of(6)), D.CENT),
  );
  const scoreOperationsRealisees = bornerScore(
    D.mul(D.div(operationsRealisees.length, D.of(6)), D.CENT),
  );
  const scoreNiveauCompetences =
    niveauMoyenCompetences === null
      ? null
      : bornerScore(D.mul(D.div(niveauMoyenCompetences, D.of(5)), D.CENT));

  const composantesPolyvalence = [
    { score: scoreOperationsMaitrisees, poids: D.of(40) },
    { score: scoreOperationsRealisees, poids: D.of(30) },
    { score: scoreNiveauCompetences, poids: D.of(30) },
  ].filter((composante): composante is { score: Decimal; poids: Decimal } => composante.score !== null);

  const axePolyvalence: ResultatAxe = {
    axe: "POLYVALENCE",
    label: LIBELLES_AXES.POLYVALENCE,
    poids: D.ZERO,
    score: composantesPolyvalence.length > 0 ? moyennePonderee(composantesPolyvalence) : null,
    retenu: false,
    raisonExclusion: null,
    indicateurs: [
      indicateur(
        "operations_maitrisees",
        "Operations maitrisees (niveau 3 et plus)",
        D.of(operationsMaitrisees),
        scoreOperationsMaitrisees,
        competences.length,
        SEUIL_OBSERVATIONS.POLYVALENCE,
      ),
      indicateur(
        "operations_realisees",
        "Operations differentes reellement realisees sur la periode",
        D.of(operationsRealisees.length),
        scoreOperationsRealisees,
        operationsRealisees.length,
        SEUIL_OBSERVATIONS.POLYVALENCE,
      ),
      indicateur(
        "niveau_competences",
        "Niveau moyen des competences certifiees",
        niveauMoyenCompetences,
        scoreNiveauCompetences,
        competences.length,
        SEUIL_OBSERVATIONS.POLYVALENCE,
      ),
    ],
  };

  const axes = [
    axeProductivite,
    axeQualite,
    axeMatiere,
    axePresence,
    axePolyvalence,
  ];

  // ---------------------------------------------------------------------------
  // 9. Ponderations configurables et consolidation
  // ---------------------------------------------------------------------------
  const ponderations = await ponderationsAxes(db);
  const poidsParAxe = new Map(ponderations.map((p) => [p.code, p]));

  const composantesGlobales: { score: Decimal; poids: Decimal }[] = [];

  for (const axe of axes) {
    const ponderation = poidsParAxe.get(axe.axe);
    axe.poids = ponderation?.weight ?? D.ZERO;
    if (ponderation) axe.label = ponderation.label;

    const seuil = SEUIL_OBSERVATIONS[axe.axe];
    const observationsUtiles = axe.indicateurs.filter(
      (indicateur_) => indicateur_.observations > 0,
    );
    const observationsSuffisantes =
      observationsUtiles.length > 0 &&
      Math.max(...axe.indicateurs.map((i) => i.observations)) >= seuil;

    if (axe.score === null) {
      axe.retenu = false;
      axe.raisonExclusion =
        "Aucune donnee exploitable sur la periode : aucun score ne peut etre avance.";
      continue;
    }

    if (!observationsSuffisantes) {
      axe.retenu = false;
      axe.raisonExclusion = `Donnees insuffisantes (${Math.max(
        ...axe.indicateurs.map((i) => i.observations),
      )} observation(s) pour un seuil de ${seuil}). Score indicatif, exclu du score global.`;
      avertissements.push(`${axe.label} : ${axe.raisonExclusion}`);
      continue;
    }

    axe.retenu = true;
    composantesGlobales.push({ score: axe.score, poids: axe.poids });
  }

  const scoreGlobal = moyennePonderee(composantesGlobales);

  // ---------------------------------------------------------------------------
  // 10. Fiabilite
  // ---------------------------------------------------------------------------
  const axesRetenus = axes.filter((axe) => axe.retenu).length;
  const observationsTotales =
    operationsRealisees.length + presences.length + declarations.length;

  let fiabilite: ReliabilityLevel;
  let messageFiabilite: string;

  if (axesRetenus === 0) {
    fiabilite = "INSUFFISANTE";
    messageFiabilite =
      "Donnees insuffisantes pour produire une evaluation exploitable. Ce resultat ne doit pas servir de base a une decision individuelle.";
  } else if (axesRetenus <= 2 || observationsTotales < 10) {
    fiabilite = "FAIBLE";
    messageFiabilite =
      "Evaluation a lire avec prudence : trop peu d'axes exploitables ou d'observations sur la periode. A confirmer sur une periode plus longue.";
  } else if (axesRetenus <= 4 || observationsTotales < 30) {
    fiabilite = "MOYENNE";
    messageFiabilite =
      "Fiabilite moyenne : la majorite des axes est exploitable, mais certains indicateurs restent bases sur peu d'observations.";
  } else {
    fiabilite = "BONNE";
    messageFiabilite =
      "Fiabilite bonne : tous les axes principaux reposent sur un volume d'observations suffisant.";
  }

  if (entree.operationId) {
    avertissements.push(
      "Evaluation restreinte a une seule operation : les axes polyvalence et presence restent globaux.",
    );
  }

  return {
    employeeId: employe.id,
    matricule: employe.matricule,
    employe: `${employe.firstName} ${employe.lastName}`,
    periodType: entree.periodType,
    periodStart: debut,
    periodEnd: fin,
    factory,
    operationId: entree.operationId ?? null,
    operationLabel:
      entree.operationId !== null && entree.operationId !== undefined
        ? (await db.operation.findUnique({
            where: { id: entree.operationId },
            select: { label: true },
          }))?.label ?? null
        : null,
    axes,
    scoreGlobal,
    fiabilite,
    messageFiabilite,
    affectationsCount: affectations.length,
    operationsRealisees: operationsRealisees.length,
    operationsMaitrisees,
    operationsEvaluees,
    ponderations,
    avertissements,
  };
}

/**
 * Enregistre une evaluation calculee. Le resultat n'est jamais valide
 * automatiquement : la validation par un responsable est une etape explicite.
 */
export async function enregistrerEvaluation(
  resultat: ResultatEvaluation,
  acteur: ActeurRh,
): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      const existante = await tx.performanceEvaluation.findFirst({
        where: {
          employeeId: resultat.employeeId,
          periodType: resultat.periodType,
          periodStart: resultat.periodStart,
          periodEnd: resultat.periodEnd,
          operationId: resultat.operationId,
        },
      });

      if (existante?.isValidated) {
        throw conflit(
          "Une evaluation validee existe deja sur cette periode. Utilisez la correction avec motif pour la remplacer : l'historique est conserve.",
        );
      }

      const axe = (nom: AxeEvaluation) => resultat.axes.find((a) => a.axe === nom)?.score ?? null;

      const donnees = {
        employeeId: resultat.employeeId,
        periodType: resultat.periodType,
        periodStart: resultat.periodStart,
        periodEnd: resultat.periodEnd,
        factory: resultat.factory,
        operationId: resultat.operationId,
        productivityScore: axe("PRODUCTIVITE"),
        qualityScore: axe("QUALITE"),
        materialEfficiencyScore: axe("EFFICACITE_MATIERE"),
        attendanceScore: axe("PRESENCE"),
        versatilityScore: axe("POLYVALENCE"),
        globalScore: resultat.scoreGlobal,
        weightsSnapshot: resultat.ponderations.map((p) => ({
          code: p.code,
          label: p.label,
          poids: p.weight.toFixed(4),
        })) as Prisma.InputJsonValue,
        rawMetrics: {
          axes: resultat.axes.map((a) => ({
            axe: a.axe,
            label: a.label,
            score: a.score?.toFixed(4) ?? null,
            retenu: a.retenu,
            raisonExclusion: a.raisonExclusion,
            indicateurs: a.indicateurs.map((i) => ({
              code: i.code,
              label: i.label,
              valeur: i.valeur?.toFixed(4) ?? null,
              score: i.score?.toFixed(4) ?? null,
              observations: i.observations,
              fiable: i.fiable,
            })),
          })),
          operationsEvaluees: resultat.operationsEvaluees.map((ligne) => ({
            operationId: ligne.operationId,
            operation: ligne.operationCode,
            reellementEffectuee: ligne.reellementEffectuee,
            affectations: ligne.affectations,
            quantiteProduite: ligne.quantiteProduite.toFixed(4),
            quantiteConforme: ligne.quantiteConforme.toFixed(4),
            minutesDeclarees: ligne.minutesDeclarees.toFixed(4),
            minutesNormales: ligne.minutesNormales.toFixed(4),
            efficienceTemps: ligne.efficienceTemps?.toFixed(4) ?? null,
          })),
          fiabilite: resultat.fiabilite,
          messageFiabilite: resultat.messageFiabilite,
          avertissements: resultat.avertissements,
        } as unknown as Prisma.InputJsonValue,
        assignmentsCount: resultat.affectationsCount,
        operationsMastered: resultat.operationsMaitrisees,
        reliability: resultat.fiabilite,
        comment: resultat.avertissements.length > 0 ? resultat.avertissements.join(" ") : null,
      };

      const evaluation = existante
        ? await tx.performanceEvaluation.update({
            where: { id: existante.id },
            data: { ...donnees, isValidated: false, validatedById: null, validatedAt: null },
          })
        : await tx.performanceEvaluation.create({ data: donnees });

      await enregistrerAudit(
        {
          action: existante ? ACTIONS_AUDIT.MODIFICATION : ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.RH,
          entity: "PerformanceEvaluation",
          entityId: evaluation.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: existante
            ? { scoreGlobal: existante.globalScore?.toFixed(4) ?? null }
            : null,
          newValue: {
            employe: resultat.employe,
            matricule: resultat.matricule,
            periode: `${resultat.periodStart.toISOString().slice(0, 10)} au ${resultat.periodEnd.toISOString().slice(0, 10)}`,
            scoreGlobal: resultat.scoreGlobal?.toFixed(2) ?? null,
            fiabilite: resultat.fiabilite,
            pondérations: resultat.ponderations.map((p) => `${p.code}=${p.weight.toFixed(2)}`),
            affectations: resultat.affectationsCount,
            operationsRealisees: resultat.operationsRealisees,
          },
        },
        tx,
      );

      return evaluation.id;
    },
    { timeout: 60_000 },
  );
}

/**
 * Validation par un responsable. Le validateur ne peut pas etre l'employe
 * evalue : une auto-validation serait depourvue de valeur.
 */
export async function validerEvaluation(
  evaluationId: number,
  entree: { commentaire?: string | null; validateurEmployeeId: number },
  acteur: ActeurRh,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const evaluation = await tx.performanceEvaluation.findUnique({
        where: { id: evaluationId },
        include: { employee: { select: { firstName: true, lastName: true, matricule: true } } },
      });
      if (!evaluation) throw nonTrouve("L'evaluation");
      if (evaluation.isValidated) throw conflit("Cette evaluation est deja validee.");

      if (evaluation.reliability === "INSUFFISANTE") {
        throw etatInvalide(
          "Cette evaluation presente une fiabilite insuffisante : elle ne peut pas etre validee. Completez les donnees d'activite de la periode.",
        );
      }

      if (evaluation.employeeId === entree.validateurEmployeeId) {
        throw accesRefuse(
          "Un employe ne peut pas valider sa propre evaluation.",
        );
      }

      await tx.performanceEvaluation.update({
        where: { id: evaluationId },
        data: {
          isValidated: true,
          validatedById: entree.validateurEmployeeId,
          validatedAt: new Date(),
          comment: entree.commentaire ?? evaluation.comment,
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.VALIDATION,
          module: MODULES_AUDIT.RH,
          entity: "PerformanceEvaluation",
          entityId: evaluationId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { valide: false },
          newValue: {
            valide: true,
            employe: `${evaluation.employee.firstName} ${evaluation.employee.lastName}`,
            scoreGlobal: evaluation.globalScore?.toFixed(2) ?? null,
            fiabilite: evaluation.reliability,
          },
          comment: entree.commentaire ?? null,
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

/**
 * Correction justifiee d'une evaluation validee. L'ancienne version reste
 * dans le journal d'audit : aucune valeur n'est ecrasee silencieusement.
 */
export async function corrigerEvaluation(
  evaluationId: number,
  entree: { motif: string; commentaire?: string | null },
  acteur: ActeurRh,
): Promise<void> {
  if (!entree.motif || entree.motif.trim().length < 10) {
    throw validation(
      "Le motif de correction est obligatoire et doit etre explicite (au moins 10 caracteres).",
    );
  }

  await prisma.$transaction(
    async (tx) => {
      const evaluation = await tx.performanceEvaluation.findUnique({
        where: { id: evaluationId },
      });
      if (!evaluation) throw nonTrouve("L'evaluation");

      await tx.performanceEvaluation.update({
        where: { id: evaluationId },
        data: {
          isCorrected: true,
          correctionReason: entree.motif,
          correctedById: acteur.id,
          correctedAt: new Date(),
          comment: entree.commentaire ?? evaluation.comment,
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CORRECTION,
          module: MODULES_AUDIT.RH,
          entity: "PerformanceEvaluation",
          entityId: evaluationId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: {
            scoreGlobal: evaluation.globalScore?.toFixed(4) ?? null,
            valide: evaluation.isValidated,
          },
          newValue: { corrige: true },
          comment: entree.motif,
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

export async function listerEvaluations(filtres: {
  employeeId?: number;
  periodType?: EvaluationPeriodType;
  factory?: Factory;
  validees?: boolean;
  page?: number;
  taille?: number;
}) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(200, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.PerformanceEvaluationWhereInput = {};
  if (filtres.employeeId) where.employeeId = filtres.employeeId;
  if (filtres.periodType) where.periodType = filtres.periodType;
  if (filtres.factory) where.factory = filtres.factory;
  if (filtres.validees !== undefined) where.isValidated = filtres.validees;

  const [total, lignes] = await Promise.all([
    prisma.performanceEvaluation.count({ where }),
    prisma.performanceEvaluation.findMany({
      where,
      orderBy: [{ periodStart: "desc" }, { employeeId: "asc" }],
      skip: (page - 1) * taille,
      take: taille,
      include: {
        employee: { select: { matricule: true, firstName: true, lastName: true } },
        operation: { select: { code: true, label: true } },
        validatedBy: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  return { lignes, total, page, taille, pages: Math.max(1, Math.ceil(total / taille)) };
}

/** Libelles des axes et indicateurs, exposes pour l'interface et les exports. */
export function libellesEvaluation() {
  return {
    axes: LIBELLES_AXES,
    indicateurs: INDICATEURS_EVALUATION,
    seuils: SEUIL_OBSERVATIONS,
    poidsParDefaut: POIDS_PAR_DEFAUT,
  };
}

export const LIBELLES_PERMISSIONS_SALAIRE = {
  lire: getPermissionLabel(PERMISSIONS.RH_SALAIRE_LIRE),
  modifier: getPermissionLabel(PERMISSIONS.RH_ECRIRE),
} as const;
