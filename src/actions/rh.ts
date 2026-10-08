"use server";

import { revalidatePath } from "next/cache";
import type {
  AttendanceStatus,
  EvaluationPeriodType,
  Factory,
  LossCategory,
  LossReason,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { accesRefuse, nonTrouve, validation } from "@/lib/errors";
import {
  aLaPermission,
  exigerAccesUsine,
  exigerPermission,
  peutAccederUsine,
} from "@/lib/rbac/guard";
import { estProprietaireUsine, usinesAutorisees } from "@/lib/rbac/portee";
import type { SessionUser } from "@/lib/auth/session";
import { PERMISSIONS, getPermissionLabel } from "@/lib/rbac/permissions";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import {
  affecterEmploye,
  calculerEvaluation,
  cloturerAffectation,
  corrigerEvaluation,
  creerCompteEmploye,
  creerEmploye,
  declarerCompetence,
  demarrerAffectation,
  desactiverEmploye,
  enregistrerEvaluation,
  enregistrerPresence,
  modifierEmploye,
  reaffecterEmploye,
  validerEvaluation,
  type EmployeInput,
} from "@/lib/rh/service";
import {
  cloturerOrdreFabrication,
  declarerConsommation,
  declarerPerte,
  declarerProduction,
  demarrerOperation,
  mettreEnPauseOperation,
  reprendreOperation,
} from "@/lib/production/service";
import { creerNonConformite } from "@/lib/qualite/service";
import { REGLES_MOT_DE_PASSE, genererMotDePasseTemporaire } from "@/lib/auth/password";
import {
  dateOuNull,
  decimalObligatoire,
  decimalOuNull,
  entierOu,
  executer,
  texteObligatoire,
  texteOuNull,
  type ResultatAction,
} from "@/lib/actions/resultat";
import {
  LIBELLES_CATEGORIE_PERTE,
  LIBELLES_MOTIF_PERTE,
  LIBELLES_PERIODE_EVALUATION,
  LIBELLES_PRESENCE,
  LIBELLES_USINE,
} from "@/lib/libelles";

/**
 * Actions serveur du module ressources humaines et du portail employe.
 *
 * Trois protections structurent ce fichier :
 *
 *  1. Les donnees salariales ne sont lues dans le formulaire QUE si l'auteur de
 *     l'action detient `RH_SALAIRE_LIRE`. Sans cette permission, les champs ne
 *     sont meme pas transmis au service : une mise a jour partielle ne peut donc
 *     pas effacer ni modifier un salaire par omission.
 *  2. Toute action portant sur un employe verifie la division de cet employe
 *     (`peutAccederUsine`) en plus de la permission : un profil ADMEDCO ne peut
 *     pas agir sur un employe MOBILIX.
 *  3. Les actions du portail sont integralement bornees sur
 *     `utilisateur.employeeId` : l'employe ne peut agir que sur les operations
 *     qui lui sont reellement affectees. Aucune valeur d'identifiant d'employe
 *     n'est acceptee depuis le formulaire pour ces actions.
 */

// -----------------------------------------------------------------------------
// Aides internes
// -----------------------------------------------------------------------------

interface Acteur {
  id: number;
  email: string;
}

function acteurDe(utilisateur: SessionUser): Acteur {
  return { id: utilisateur.id, email: utilisateur.email };
}

/**
 * Verifie qu'une valeur de formulaire appartient bien a la liste de reference
 * francaise fournie. Une valeur inconnue est refusee, jamais remplacee par un
 * defaut silencieux.
 */
function choixObligatoire<T extends string>(
  valeur: string | null,
  table: Record<string, string>,
  libelleChamp: string,
): T {
  if (!valeur || !(valeur in table)) {
    throw validation(
      `Le champ « ${libelleChamp} » doit etre choisi dans la liste proposee.`,
      { [libelleChamp]: "Valeur obligatoire ou inconnue." },
    );
  }
  return valeur as T;
}

function lireIdentifiant(
  formData: FormData,
  champ: string,
  libelleChamp: string,
): number {
  const identifiant = entierOu(formData.get(champ));
  if (!identifiant) {
    throw validation(`${libelleChamp} est obligatoire.`, {
      [champ]: "Selection obligatoire.",
    });
  }
  return identifiant;
}

/** Journee seule, au format attendu par la colonne `date` des affectations. */
function jourSeul(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/**
 * Donnees salariales : elles ne sont extraites du formulaire que si l'auteur
 * detient `RH_SALAIRE_LIRE`. Sans permission, les cles restent absentes du
 * `Partial<EmployeInput>`, ce que le service interprete comme « ne pas toucher ».
 */
function champsSalariaux(
  formData: FormData,
  autorise: boolean,
): Pick<EmployeInput, "baseSalary" | "salaryPerDay"> | Record<string, never> {
  if (!autorise) return {};
  return {
    baseSalary: decimalOuNull(formData.get("baseSalary")),
    salaryPerDay: decimalOuNull(formData.get("salaryPerDay")),
  };
}

/** Controle la division de l'employe vise, en plus de la permission requise. */
async function employeAutorise(
  employeeId: number,
  utilisateur: SessionUser,
  permission: string,
): Promise<{
  id: number;
  matricule: string;
  firstName: string;
  lastName: string;
  factory: Factory;
  isActive: boolean;
  userId: number | null;
}> {
  await exigerPermission(permission);
  const employe = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      matricule: true,
      firstName: true,
      lastName: true,
      factory: true,
      isActive: true,
      userId: true,
    },
  });
  if (!employe) throw nonTrouve("La fiche employe");
  if (!peutAccederUsine(utilisateur, employe.factory)) {
    throw accesRefuse(
      `Cet employe releve de la division ${LIBELLES_USINE[employe.factory] ?? employe.factory} : votre profil ne permet pas d'agir sur sa fiche.`,
    );
  }
  return employe;
}

/**
 * Combine une date de formulaire et une heure « HH:MM » en un horodatage.
 * Les pointages sont saisis en heure locale de l'atelier.
 */
function heureDuJour(
  date: Date | null,
  valeur: FormDataEntryValue | null,
): Date | null {
  const texte = texteOuNull(valeur);
  if (!texte || !date) return null;
  const [heuresBrutes, minutesBrutes] = texte.split(":");
  const heures = Number.parseInt(heuresBrutes ?? "", 10);
  const minutes = Number.parseInt(minutesBrutes ?? "0", 10);
  if (!Number.isFinite(heures) || !Number.isFinite(minutes)) {
    throw validation(`L'heure « ${texte} » n'est pas valide.`, {
      heure: "Format attendu : HH:MM.",
    });
  }
  const resultat = new Date(date);
  resultat.setHours(heures, minutes, 0, 0);
  return resultat;
}

// -----------------------------------------------------------------------------
// Employes
// -----------------------------------------------------------------------------

export async function actionCreerEmploye(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La fiche employe a ete creee.",
    async () => {
      const utilisateur = await exigerPermission(PERMISSIONS.RH_ECRIRE);
      const factory = (texteOuNull(formData.get("factory")) ?? "COMMUN") as Factory;
      await exigerAccesUsine(factory);

      const id = await creerEmploye(
        {
          matricule: texteObligatoire(formData.get("matricule"), "matricule"),
          firstName: texteObligatoire(formData.get("firstName"), "prenom"),
          lastName: texteObligatoire(formData.get("lastName"), "nom"),
          factory,
          workshopId: entierOu(formData.get("workshopId")),
          jobTitle: texteOuNull(formData.get("jobTitle")),
          email: texteOuNull(formData.get("email")),
          phone: texteOuNull(formData.get("phone")),
          phone2: texteOuNull(formData.get("phone2")),
          address: texteOuNull(formData.get("address")),
          city: texteOuNull(formData.get("city")),
          birthDate: dateOuNull(formData.get("birthDate")),
          gender: texteOuNull(formData.get("gender")),
          socialSecurityNumber: texteOuNull(formData.get("socialSecurityNumber")),
          ccp: texteOuNull(formData.get("ccp")),
          contractType: texteOuNull(formData.get("contractType")),
          hireDate: dateOuNull(formData.get("hireDate")),
          endDate: dateOuNull(formData.get("endDate")),
          defaultWarehouseId: entierOu(formData.get("defaultWarehouseId")),
          ...champsSalariaux(
            formData,
            aLaPermission(utilisateur, PERMISSIONS.RH_SALAIRE_LIRE),
          ),
        },
        acteurDe(utilisateur),
      );

      revalidatePath("/rh/employes");
      return { id };
    },
  );
}

export async function actionModifierEmploye(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "Les modifications de la fiche employe ont ete enregistrees.",
    async () => {
      const employeeId = lireIdentifiant(formData, "employeeId", "L'employe");
      const utilisateur = await exigerPermission(PERMISSIONS.RH_ECRIRE);
      const employe = await employeAutorise(
        employeeId,
        utilisateur,
        PERMISSIONS.RH_ECRIRE,
      );

      const factory = texteOuNull(formData.get("factory"));
      if (factory) {
        await exigerAccesUsine(factory as Factory);
      }

      await modifierEmploye(
        employeeId,
        {
          firstName: texteObligatoire(formData.get("firstName"), "prenom"),
          lastName: texteObligatoire(formData.get("lastName"), "nom"),
          factory: factory ? (factory as Factory) : undefined,
          workshopId: entierOu(formData.get("workshopId")),
          jobTitle: texteOuNull(formData.get("jobTitle")),
          email: texteOuNull(formData.get("email")),
          phone: texteOuNull(formData.get("phone")),
          phone2: texteOuNull(formData.get("phone2")),
          address: texteOuNull(formData.get("address")),
          city: texteOuNull(formData.get("city")),
          birthDate: dateOuNull(formData.get("birthDate")),
          gender: texteOuNull(formData.get("gender")),
          socialSecurityNumber: texteOuNull(formData.get("socialSecurityNumber")),
          ccp: texteOuNull(formData.get("ccp")),
          contractType: texteOuNull(formData.get("contractType")),
          hireDate: dateOuNull(formData.get("hireDate")),
          endDate: dateOuNull(formData.get("endDate")),
          defaultWarehouseId: entierOu(formData.get("defaultWarehouseId")),
          ...champsSalariaux(
            formData,
            aLaPermission(utilisateur, PERMISSIONS.RH_SALAIRE_LIRE),
          ),
        },
        acteurDe(utilisateur),
      );

      revalidatePath("/rh/employes");
      revalidatePath(`/rh/employes/${employeeId}`);
      return { id: employe.id };
    },
  );
}

/**
 * Desactivation d'un employe : jamais de suppression physique, l'historique des
 * affectations, presences et evaluations doit rester consultable.
 */
export async function actionDesactiverEmploye(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "L'employe a ete desactive. Aucune donnee n'a ete supprimee : son historique reste consultable.",
    async () => {
      const employeeId = lireIdentifiant(formData, "employeeId", "L'employe");
      const utilisateur = await exigerPermission(PERMISSIONS.RH_ECRIRE);
      await employeAutorise(employeeId, utilisateur, PERMISSIONS.RH_ECRIRE);

      await desactiverEmploye(
        employeeId,
        texteObligatoire(formData.get("motif"), "motif de desactivation"),
        acteurDe(utilisateur),
      );

      revalidatePath("/rh/employes");
      revalidatePath(`/rh/employes/${employeeId}`);
      return { id: employeeId };
    },
  );
}

/**
 * Ouverture du compte nominatif personnel de l'employe.
 *
 * Le mot de passe temporaire n'est jamais stocke en clair : il est soit saisi
 * par l'administrateur, soit genere par le serveur, et il est affiche une seule
 * fois dans la reponse. Le changement est obligatoire a la premiere connexion.
 * Un seul compte par personne : aucun compte partage n'est possible.
 */
export async function actionCreerCompteEmploye(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>("", async () => {
    const employeeId = lireIdentifiant(formData, "employeeId", "L'employe");
    const utilisateur = await exigerPermission(PERMISSIONS.RH_ECRIRE);
    const employe = await employeAutorise(
      employeeId,
      utilisateur,
      PERMISSIONS.RH_ECRIRE,
    );

    const roleCodes = formData
      .getAll("roleCodes")
      .map((valeur) => String(valeur).trim())
      .filter((valeur) => valeur !== "");

    // Creer un compte utilisateur et lui attribuer des roles est un acte de
    // gestion des utilisateurs : sans cette permission, un profil RH pourrait
    // s'attribuer n'importe quel role par le biais du formulaire.
    //
    // Un proprietaire d'usine fait exception, sous deux conditions strictes :
    // il doit etre un proprietaire d'usine, et il ne peut attribuer que des
    // roles d'execution de sa propre division. Sans ce garde-fou, il pourrait
    // s'attribuer ADMIN_SYSTEME par le formulaire.
    if (!aLaPermission(utilisateur, PERMISSIONS.UTILISATEUR_GERER)) {
      const rolesAutorises = estProprietaireUsine(utilisateur)
        ? new Set(
            usinesAutorisees(utilisateur)
              .filter((usine) => usine !== "COMMUN")
              .flatMap((usine) => [`OPERATEUR_${usine}`, `MAGASINIER_${usine}`]),
          )
        : new Set<string>();

      if (rolesAutorises.size === 0) {
        throw accesRefuse(
          `La creation d'un compte utilisateur et l'attribution de roles exigent la permission « ${getPermissionLabel(
            PERMISSIONS.UTILISATEUR_GERER,
          )} ».`,
        );
      }

      const refuses = roleCodes.filter((code) => !rolesAutorises.has(code));
      if (roleCodes.length === 0 || refuses.length > 0) {
        throw accesRefuse(
          refuses.length > 0
            ? `Un proprietaire d'usine ne peut creer que des comptes d'execution de sa division. Roles refuses : ${refuses.join(", ")}. Autorises : ${[...rolesAutorises].join(", ")}.`
            : `Selectionnez au moins un role d'execution de votre division : ${[...rolesAutorises].join(", ")}.`,
        );
      }
    }

    const motDePasseSaisi = texteOuNull(formData.get("motDePasse"));
    const motDePasse = motDePasseSaisi ?? genererMotDePasseTemporaire();

    const compteId = await creerCompteEmploye(
      {
        employeeId,
        email: texteObligatoire(formData.get("email"), "adresse electronique"),
        motDePasse,
        roleCodes,
        // Le changement de mot de passe est toujours exige a la premiere
        // connexion : un mot de passe temporaire ne doit pas devenir permanent.
        mustChangePassword: true,
      },
      acteurDe(utilisateur),
    );

    revalidatePath("/rh/employes");
    revalidatePath(`/rh/employes/${employeeId}`);

    return {
      compteId,
      motDePasseTemporaire: motDePasse,
      message:
        `Compte nominatif cree pour ${employe.firstName} ${employe.lastName}. ` +
        `Mot de passe temporaire : ${motDePasse} — notez-le maintenant, il ne sera plus jamais affiche. ` +
        `L'employe devra le changer a sa premiere connexion. ${REGLES_MOT_DE_PASSE}`,
    };
  });
}

export async function actionDeclarerCompetence(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La competence a ete declaree pour cet employe.",
    async () => {
      const employeeId = lireIdentifiant(formData, "employeeId", "L'employe");
      const utilisateur = await exigerPermission(PERMISSIONS.RH_COMPETENCE_GERER);
      await employeAutorise(employeeId, utilisateur, PERMISSIONS.RH_COMPETENCE_GERER);

      const niveau = entierOu(formData.get("level"));
      if (niveau === null || niveau < 1 || niveau > 5) {
        throw validation("Le niveau de competence doit etre compris entre 1 et 5.", {
          level: "Niveau attendu entre 1 et 5.",
        });
      }

      await declarerCompetence(
        {
          employeeId,
          skillId: lireIdentifiant(formData, "skillId", "La competence"),
          level: niveau,
          notes: texteOuNull(formData.get("notes")),
        },
        acteurDe(utilisateur),
      );

      revalidatePath("/rh/competences");
      revalidatePath(`/rh/employes/${employeeId}`);
      return { employeeId };
    },
  );
}

// -----------------------------------------------------------------------------
// Affectations quotidiennes
// -----------------------------------------------------------------------------

export async function actionAffecterEmploye(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "L'affectation a ete creee. L'evaluation de cet employe portera uniquement sur les operations qu'il aura reellement effectuees.",
    async () => {
      const employeeId = lireIdentifiant(formData, "employeeId", "L'employe");
      const utilisateur = await exigerPermission(PERMISSIONS.RH_AFFECTATION_GERER);
      await employeAutorise(
        employeeId,
        utilisateur,
        PERMISSIONS.RH_AFFECTATION_GERER,
      );

      const operationId = lireIdentifiant(formData, "operationId", "L'operation");
      const operation = await prisma.operation.findUnique({
        where: { id: operationId },
        select: { id: true, code: true, label: true, factory: true },
      });
      if (!operation) throw nonTrouve("L'operation");
      await exigerAccesUsine(operation.factory);

      const dateAffectation = dateOuNull(formData.get("date")) ?? new Date();

      const workOrderId = entierOu(formData.get("workOrderId"));
      const id = await affecterEmploye(
        {
          employeeId,
          date: dateAffectation,
          factory: operation.factory,
          operationId,
          workCenterId: entierOu(formData.get("workCenterId")),
          workOrderId,
          workOrderOperationId: entierOu(formData.get("workOrderOperationId")),
          plannedStart: heureDuJour(dateAffectation, formData.get("plannedStart")),
          plannedEnd: heureDuJour(dateAffectation, formData.get("plannedEnd")),
          comment: texteOuNull(formData.get("comment")),
          responsibleId: entierOu(formData.get("responsibleId")),
        },
        acteurDe(utilisateur),
      );

      revalidatePath("/rh/affectations");
      return { id };
    },
  );
}

/**
 * Reaffectation en cours de journee. Le motif ecrit est obligatoire : il est
 * verifie ici puis de nouveau par le service, et il reste attache a
 * l'affectation cloturee comme a la nouvelle.
 */
export async function actionReaffecterEmploye(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La reaffectation a ete enregistree : l'affectation precedente est close avec son motif, la nouvelle porte sur l'operation choisie.",
    async () => {
      const utilisateur = await exigerPermission(PERMISSIONS.RH_AFFECTATION_GERER);
      const assignmentId = lireIdentifiant(
        formData,
        "assignmentId",
        "L'affectation",
      );

      const affectation = await prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { id: true, factory: true, employeeId: true },
      });
      if (!affectation) throw nonTrouve("L'affectation");
      if (!peutAccederUsine(utilisateur, affectation.factory)) {
        throw accesRefuse(
          "Cette affectation releve d'une division a laquelle votre profil n'a pas acces.",
        );
      }

      const resultat = await reaffecterEmploye(
        {
          assignmentId,
          versOperationId: lireIdentifiant(
            formData,
            "versOperationId",
            "L'operation de destination",
          ),
          versWorkCenterId: entierOu(formData.get("versWorkCenterId")),
          motif: texteObligatoire(formData.get("motif"), "motif de reaffectation"),
          commentaire: texteOuNull(formData.get("commentaire")),
        },
        acteurDe(utilisateur),
      );

      revalidatePath("/rh/affectations");
      return { ancienneId: resultat.ancienneId, nouvelleId: resultat.nouvelleId };
    },
  );
}

export async function actionDemarrerAffectation(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "L'affectation est passe au statut « en cours ».",
    async () => {
      const utilisateur = await exigerPermission(PERMISSIONS.RH_AFFECTATION_GERER);
      const assignmentId = lireIdentifiant(
        formData,
        "assignmentId",
        "L'affectation",
      );

      const affectation = await prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { factory: true },
      });
      if (!affectation) throw nonTrouve("L'affectation");
      await exigerAccesUsine(affectation.factory);

      await demarrerAffectation(assignmentId, acteurDe(utilisateur));
      revalidatePath("/rh/affectations");
      return { id: assignmentId };
    },
  );
}

export async function actionCloturerAffectation(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "L'affectation a ete close : les heures reelles servent desormais de base a l'evaluation.",
    async () => {
      const utilisateur = await exigerPermission(PERMISSIONS.RH_AFFECTATION_GERER);
      const assignmentId = lireIdentifiant(
        formData,
        "assignmentId",
        "L'affectation",
      );

      const affectation = await prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { factory: true },
      });
      if (!affectation) throw nonTrouve("L'affectation");
      await exigerAccesUsine(affectation.factory);

      await cloturerAffectation(
        assignmentId,
        {
          breakMinutes: entierOu(formData.get("breakMinutes")) ?? undefined,
          commentaire: texteOuNull(formData.get("commentaire")),
        },
        acteurDe(utilisateur),
      );

      revalidatePath("/rh/affectations");
      return { id: assignmentId };
    },
  );
}

// -----------------------------------------------------------------------------
// Presences
// -----------------------------------------------------------------------------

export async function actionEnregistrerPresence(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "Le pointage a ete enregistre.",
    async () => {
      const employeeId = lireIdentifiant(formData, "employeeId", "L'employe");
      const utilisateur = await exigerPermission(PERMISSIONS.RH_PRESENCE_GERER);
      await employeAutorise(employeeId, utilisateur, PERMISSIONS.RH_PRESENCE_GERER);

      const datePointage = dateOuNull(formData.get("date"));
      if (!datePointage) {
        throw validation("La date du pointage est obligatoire.", {
          date: "Date obligatoire.",
        });
      }

      await enregistrerPresence(
        {
          employeeId,
          date: datePointage,
          status: choixObligatoire<AttendanceStatus>(
            texteOuNull(formData.get("status")),
            LIBELLES_PRESENCE,
            "statut de presence",
          ),
          checkIn: heureDuJour(datePointage, formData.get("checkIn")),
          checkOut: heureDuJour(datePointage, formData.get("checkOut")),
          workedHours: decimalOuNull(formData.get("workedHours")) ?? undefined,
          overtimeHours: decimalOuNull(formData.get("overtimeHours")) ?? undefined,
          lateMinutes: entierOu(formData.get("lateMinutes")) ?? 0,
          comment: texteOuNull(formData.get("comment")),
        },
        acteurDe(utilisateur),
      );

      revalidatePath("/rh/presences");
      revalidatePath(`/rh/employes/${employeeId}`);
      return { employeeId };
    },
  );
}

// -----------------------------------------------------------------------------
// Evaluations
// -----------------------------------------------------------------------------

/**
 * Enregistrement d'une evaluation.
 *
 * Le calcul n'est jamais fait par le navigateur : les valeurs transmises se
 * limitent a l'employe et a la periode, et le service `calculerEvaluation`
 * reconstruit l'evaluation a partir des affectations et declarations reelles.
 * Le resultat est enregistre sans validation : la validation est une etape
 * explicite confiee a un responsable distinct de l'employe evalue.
 */
export async function actionEnregistrerEvaluation(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "L'evaluation a ete calculee puis enregistree. Elle doit maintenant etre validee par un responsable.",
    async () => {
      const employeeId = lireIdentifiant(formData, "employeeId", "L'employe");
      const utilisateur = await exigerPermission(
        PERMISSIONS.RH_EVALUATION_CALCULER,
      );
      await employeAutorise(
        employeeId,
        utilisateur,
        PERMISSIONS.RH_EVALUATION_CALCULER,
      );

      const resultat = await calculerEvaluation({
        employeeId,
        periodType: choixObligatoire<EvaluationPeriodType>(
          texteOuNull(formData.get("periodType")),
          LIBELLES_PERIODE_EVALUATION,
          "periode",
        ),
        reference: dateOuNull(formData.get("reference")) ?? new Date(),
        operationId: entierOu(formData.get("operationId")),
      });

      const id = await enregistrerEvaluation(resultat, acteurDe(utilisateur));

      revalidatePath("/rh/evaluations");
      return {
        id,
        fiabilite: resultat.fiabilite,
        operationsRealisees: resultat.operationsRealisees,
      };
    },
  );
}

/**
 * Validation par un responsable. Le validateur est l'employe rattache au compte
 * connecte : il n'est jamais choisi dans le formulaire, ce qui rend
 * l'auto-validation impossible a contourner depuis l'interface.
 */
export async function actionValiderEvaluation(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "L'evaluation a ete validee.",
    async () => {
      const utilisateur = await exigerPermission(
        PERMISSIONS.RH_EVALUATION_VALIDER,
      );

      if (!utilisateur.employeeId) {
        throw accesRefuse(
          "Votre compte n'est rattache a aucune fiche employe : la validation d'une evaluation exige un validateur nommement identifie.",
        );
      }

      const evaluationId = lireIdentifiant(
        formData,
        "evaluationId",
        "L'evaluation",
      );
      const evaluation = await prisma.performanceEvaluation.findUnique({
        where: { id: evaluationId },
        select: { factory: true },
      });
      if (!evaluation) throw nonTrouve("L'evaluation");
      await exigerAccesUsine(evaluation.factory);

      await validerEvaluation(
        evaluationId,
        {
          commentaire: texteOuNull(formData.get("commentaire")),
          validateurEmployeeId: utilisateur.employeeId,
        },
        acteurDe(utilisateur),
      );

      revalidatePath("/rh/evaluations");
      return { id: evaluationId };
    },
  );
}

/** Correction d'une evaluation : la justification ecrite est obligatoire. */
export async function actionCorrigerEvaluation(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La correction a ete enregistree. L'ancienne version reste consultee dans le journal d'audit.",
    async () => {
      const utilisateur = await exigerPermission(
        PERMISSIONS.RH_EVALUATION_VALIDER,
      );
      const evaluationId = lireIdentifiant(
        formData,
        "evaluationId",
        "L'evaluation",
      );

      const evaluation = await prisma.performanceEvaluation.findUnique({
        where: { id: evaluationId },
        select: { factory: true },
      });
      if (!evaluation) throw nonTrouve("L'evaluation");
      await exigerAccesUsine(evaluation.factory);

      await corrigerEvaluation(
        evaluationId,
        {
          motif: texteObligatoire(formData.get("motif"), "motif de correction"),
          commentaire: texteOuNull(formData.get("commentaire")),
        },
        acteurDe(utilisateur),
      );

      revalidatePath("/rh/evaluations");
      return { id: evaluationId };
    },
  );
}

// -----------------------------------------------------------------------------
// Portail employe
// -----------------------------------------------------------------------------

/**
 * Portail employe : toutes les actions sont bornees sur l'employe connecte.
 *
 * Aucun identifiant d'employe n'est lu dans le formulaire. Une operation n'est
 * accessible que si elle figure parmi les affectations reelles de l'employe ou
 * si elle lui a ete attribuee comme operateur : le portail ne permet donc jamais
 * d'agir sur le travail d'un autre.
 */
async function employePortail(permission: string): Promise<{
  utilisateur: SessionUser;
  employeeId: number;
}> {
  const utilisateur = await exigerPermission(permission);
  if (!utilisateur.employeeId) {
    throw accesRefuse(
      "Votre compte n'est rattache a aucune fiche employe : le portail ne peut afficher aucune donnee personnelle. Contactez le service des ressources humaines.",
    );
  }
  return { utilisateur, employeeId: utilisateur.employeeId };
}

async function operationDuPortail(
  workOrderOperationId: number,
  employeeId: number,
  utilisateur: SessionUser,
) {
  const operation = await prisma.workOrderOperation.findUnique({
    where: { id: workOrderOperationId },
    include: {
      operation: { select: { code: true, label: true } },
      workOrder: {
        select: {
          id: true,
          number: true,
          factory: true,
          status: true,
          itemId: true,
          targetWarehouseId: true,
          sourceWarehouseId: true,
        },
      },
      assignments: {
        where: {
          employeeId,
          status: { in: ["PLANIFIEE", "EN_COURS", "EN_PAUSE"] },
        },
        select: { id: true },
      },
    },
  });
  if (!operation) throw nonTrouve("L'operation de fabrication");
  if (!peutAccederUsine(utilisateur, operation.workOrder.factory)) {
    throw accesRefuse(
      "Cette operation appartient a une division hors de votre perimetre.",
    );
  }

  const affectee = operation.assignments.length > 0;
  const attribuee = operation.operatorId === employeeId;
  if (!affectee && !attribuee) {
    throw accesRefuse(
      "Cette operation ne vous est pas affectee : le portail n'autorise d'agir que sur vos propres operations.",
    );
  }

  return operation;
}

export async function actionPortailDemarrerOperation(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>("L'operation est demarree.", async () => {
    const { utilisateur, employeeId } = await employePortail(
      PERMISSIONS.PORTAIL_EMPLOYE,
    );
    const workOrderOperationId = lireIdentifiant(
      formData,
      "workOrderOperationId",
      "L'operation",
    );
    await operationDuPortail(workOrderOperationId, employeeId, utilisateur);

    await demarrerOperation({
      workOrderOperationId,
      employeeId,
      commentaire: texteOuNull(formData.get("commentaire")),
      acteur: acteurDe(utilisateur),
    });

    revalidatePath("/portail");
    return { id: workOrderOperationId };
  });
}

export async function actionPortailMettreEnPause(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "L'operation est mise en pause.",
    async () => {
      const { utilisateur, employeeId } = await employePortail(
        PERMISSIONS.PORTAIL_EMPLOYE,
      );
      const workOrderOperationId = lireIdentifiant(
        formData,
        "workOrderOperationId",
        "L'operation",
      );
      await operationDuPortail(workOrderOperationId, employeeId, utilisateur);

      await mettreEnPauseOperation(
        workOrderOperationId,
        acteurDe(utilisateur),
        employeeId,
        texteOuNull(formData.get("commentaire")),
      );

      revalidatePath("/portail");
      return { id: workOrderOperationId };
    },
  );
}

export async function actionPortailReprendreOperation(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>("L'operation a repris.", async () => {
    const { utilisateur, employeeId } = await employePortail(
      PERMISSIONS.PORTAIL_EMPLOYE,
    );
    const workOrderOperationId = lireIdentifiant(
      formData,
      "workOrderOperationId",
      "L'operation",
    );
    await operationDuPortail(workOrderOperationId, employeeId, utilisateur);

    await reprendreOperation(
      workOrderOperationId,
      acteurDe(utilisateur),
      employeeId,
      texteOuNull(formData.get("commentaire")),
    );

    revalidatePath("/portail");
    return { id: workOrderOperationId };
  });
}

/**
 * Declaration de la matiere reellement prise au magasin et consommee.
 *
 * Le moteur de stock ne connait qu'un seul geste pour cela : la consommation
 * d'operation. C'est lui qui sort la matiere du depot, incremente ce qui est
 * sorti (`quantityIssued`) et ce qui est consomme (`quantityConsumed`), classes
 * en consommation normale ou en surconsommation. Le portail ne cree donc pas un
 * second circuit « matiere recue » : il enregistre le geste reel, et l'ecran
 * affiche separement ce qui a ete sorti et ce qui a ete consomme.
 *
 * Le composant est verifie : il doit appartenir a une operation de l'employe
 * connecte, et la quantite doit rester positive. Aucune quantite negative, donc
 * aucun stock negatif non autorise, ne peut etre obtenue par ce formulaire.
 */
export async function actionPortailDeclarerConsommation(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La matiere consommee a ete enregistree : elle sort du depot et reste tracee sur l'operation.",
    async () => {
      const { utilisateur, employeeId } = await employePortail(
        PERMISSIONS.PORTAIL_EMPLOYE,
      );
      const workOrderOperationId = lireIdentifiant(
        formData,
        "workOrderOperationId",
        "L'operation",
      );
      await operationDuPortail(workOrderOperationId, employeeId, utilisateur);

      const materialId = lireIdentifiant(formData, "materialId", "La matiere");
      const quantite = decimalObligatoire(formData.get("quantite"), "quantite consommee");

      const matiere = await prisma.workOrderMaterial.findUnique({
        where: { id: materialId },
        select: { id: true, workOrderOperationId: true, componentItemId: true },
      });
      if (!matiere) throw nonTrouve("Le composant de l'ordre de fabrication");
      if (matiere.workOrderOperationId !== workOrderOperationId) {
        throw validation(
          "Cette matiere n'est pas rattachee a l'operation que vous declarez.",
          { materialId: "Selection invalide pour cette operation." },
        );
      }

      const resultat = await declarerConsommation({
        workOrderOperationId,
        materialId,
        quantite,
        employeeId,
        commentaire: texteOuNull(formData.get("commentaire")),
        acteur: acteurDe(utilisateur),
      });

      revalidatePath("/portail");
      revalidatePath("/production/feuille-de-route");
      return {
        declarationId: String(resultat.declarationId),
        categorie: resultat.categorie,
        ecart: resultat.ecart.toFixed(6),
      };
    },
  );
}

export async function actionPortailDeclarerProduction(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La quantite produite a ete declaree.",
    async () => {
      const { utilisateur, employeeId } = await employePortail(
        PERMISSIONS.PORTAIL_EMPLOYE,
      );
      const workOrderOperationId = lireIdentifiant(
        formData,
        "workOrderOperationId",
        "L'operation",
      );
      await operationDuPortail(workOrderOperationId, employeeId, utilisateur);

      const resultat = await declarerProduction({
        workOrderOperationId,
        employeeId,
        quantiteProduite: decimalObligatoire(
          formData.get("quantiteProduite"),
          "quantite produite",
        ),
        quantiteConforme: decimalOuNull(formData.get("quantiteConforme")) ?? undefined,
        quantiteRebutee: decimalOuNull(formData.get("quantiteRebutee")) ?? undefined,
        quantiteReprise: decimalOuNull(formData.get("quantiteReprise")) ?? undefined,
        commentaire: texteOuNull(formData.get("commentaire")),
        acteur: acteurDe(utilisateur),
      });

      revalidatePath("/portail");
      return {
        declarationId: String(resultat.declarationId),
        resteAProduire: resultat.resteAProduire.toFixed(4),
      };
    },
  );
}

/**
 * Declaration d'une perte depuis l'atelier.
 *
 * La sortie physique du stock n'est pas declenchee ici : le portail ne permet
 * jamais de modifier un stock de sa propre initiative. La declaration est
 * enregistree et catégorisee ; le magasin traite la sortie par le grand livre.
 */
export async function actionPortailDeclarerPerte(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La perte a ete declaree. Elle portera la categorie et le motif indiques ; la sortie de stock reste du ressort du magasin.",
    async () => {
      const { utilisateur, employeeId } = await employePortail(
        PERMISSIONS.PORTAIL_EMPLOYE,
      );
      const workOrderOperationId = lireIdentifiant(
        formData,
        "workOrderOperationId",
        "L'operation",
      );
      await operationDuPortail(workOrderOperationId, employeeId, utilisateur);

      const resultat = await declarerPerte({
        workOrderOperationId,
        itemId: lireIdentifiant(formData, "itemId", "L'article concerne"),
        quantite: decimalObligatoire(formData.get("quantite"), "quantite perdue"),
        categorie: choixObligatoire<LossCategory>(
          texteOuNull(formData.get("categorie")),
          LIBELLES_CATEGORIE_PERTE,
          "categorie de perte",
        ),
        motif: choixObligatoire<LossReason>(
          texteOuNull(formData.get("motif")),
          LIBELLES_MOTIF_PERTE,
          "motif de perte",
        ),
        employeeId,
        commentaire: texteOuNull(formData.get("commentaire")),
        sortirDuStock: false,
        acteur: acteurDe(utilisateur),
      });

      revalidatePath("/portail");
      return {
        declarationId: String(resultat.declarationId),
        categorie: resultat.categorie,
        validationRequise: resultat.validationRequise,
      };
    },
  );
}

/**
 * Signalement d'un probleme d'atelier.
 *
 * Le signalement cree une non-conformite reelle (source production), pas une
 * simple note : il entre dans le circuit qualite et reste consultable. Le
 * commentaire est obligatoire, verifie ici et par le service qualite.
 */
export async function actionPortailSignalerProbleme(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "Le probleme a ete signale. Une non-conformite a ete ouverte et sera examinee par le service qualite.",
    async () => {
      const { utilisateur, employeeId } = await employePortail(
        PERMISSIONS.PORTAIL_EMPLOYE,
      );
      const workOrderOperationId = lireIdentifiant(
        formData,
        "workOrderOperationId",
        "L'operation",
      );
      const operation = await operationDuPortail(workOrderOperationId, employeeId, utilisateur);

      const nonConformiteId = await creerNonConformite(
        {
          source: "PRODUCTION",
          description: texteObligatoire(
            formData.get("description"),
            "description du probleme",
          ),
          quantite: D.of(decimalOuNull(formData.get("quantite")) ?? 0),
          itemId: operation.workOrder.itemId,
          workOrderId: operation.workOrder.id,
          detectedById: employeeId,
        },
        acteurDe(utilisateur),
      );

      await enregistrerAudit({
        action: ACTIONS_AUDIT.QUALITE,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "WorkOrderOperation",
        entityId: workOrderOperationId,
        userId: utilisateur.id,
        userEmail: utilisateur.email,
        newValue: {
          signalement: "PROBLEME_ATELIER",
          ordre: operation.workOrder.number,
          operation: operation.operation.code,
          nonConformite: nonConformiteId,
        },
        comment: texteOuNull(formData.get("description")),
      });

      revalidatePath("/portail");
      return { nonConformiteId };
    },
  );
}

/**
 * Fin de l'intervention de l'employe sur l'operation : l'affectation du jour est
 * close, ce sont ses heures reelles qui serviront de base a l'evaluation. Le
 * statut de l'operation de fabrication elle-meme reste du ressort du module
 * production.
 */
export async function actionPortailTerminerOperation(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "Votre intervention est terminee : l'affectation est close avec les heures reelles.",
    async () => {
      const { utilisateur, employeeId } = await employePortail(
        PERMISSIONS.PORTAIL_EMPLOYE,
      );
      const workOrderOperationId = lireIdentifiant(
        formData,
        "workOrderOperationId",
        "L'operation",
      );
      const operation = await operationDuPortail(workOrderOperationId, employeeId, utilisateur);

      const affectation = operation.assignments[0];
      if (!affectation) {
        throw validation(
          "Aucune affectation ouverte ne vous rattache a cette operation : votre intervention ne peut pas etre close depuis le portail.",
        );
      }

      await cloturerAffectation(
        affectation.id,
        {
          breakMinutes: entierOu(formData.get("breakMinutes")) ?? undefined,
          commentaire: texteOuNull(formData.get("commentaire")),
        },
        acteurDe(utilisateur),
      );

      revalidatePath("/portail");
      return { assignmentId: affectation.id };
    },
  );
}

/**
 * Cloture d'un ordre de fabrication depuis le portail : elle n'est proposee que
 * si l'utilisateur detient explicitement `PRODUCTION_CLOTURER`.
 */
export async function actionPortailCloturerOrdre(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "L'ordre de fabrication a ete cloture.",
    async () => {
      const { utilisateur, employeeId } = await employePortail(
        PERMISSIONS.PRODUCTION_CLOTURER,
      );
      const workOrderOperationId = lireIdentifiant(
        formData,
        "workOrderOperationId",
        "L'operation",
      );
      const operation = await operationDuPortail(workOrderOperationId, employeeId, utilisateur);

      await cloturerOrdreFabrication(
        operation.workOrder.id,
        acteurDe(utilisateur),
        texteOuNull(formData.get("commentaire")),
      );

      revalidatePath("/portail");
      return { workOrderId: operation.workOrder.id };
    },
  );
}

