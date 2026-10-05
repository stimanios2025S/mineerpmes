"use server";

import { revalidatePath } from "next/cache";
import type { Factory, Priority } from "@prisma/client";
import { prisma } from "@/lib/db";
import { accesRefuse, validation } from "@/lib/errors";
import { exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import type { SessionUser } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  decimalObligatoire,
  decimalOuNull,
  entierOu,
  executer,
  texteObligatoire,
  texteOuNull,
  type ResultatAction,
} from "@/lib/actions/resultat";
import {
  executerScanPoste,
  genererQrPoste,
  marquerQrImprime,
  revoquerQrPoste,
} from "@/lib/mes/postes";
import {
  ajouterTacheAuProgramme,
  ouvrirProgramme,
  publierProgramme,
  reaffecterTacheProgramme,
  reviserProgramme,
} from "@/lib/mes/programme";
import {
  creerSousStock,
  definirLienSousStock,
  transfererVersEtapeSuivante,
} from "@/lib/mes/sous-stocks";
import { instantMetier, jourCivilMetier } from "@/lib/mes/jour";

/**
 * Actions serveur de l'atelier : QR de poste, programme de travail,
 * sous-stocks et passage d'etape.
 *
 * Chaque action verifie elle-meme sa permission ET la portee d'usine du compte
 * connecte. Rien n'est suppose sur l'interface : un formulaire absent ne
 * protege rien, c'est le serveur qui decide.
 *
 * Le portail borne toujours sur l'employe du compte connecte : aucun
 * identifiant d'employe n'est jamais lu dans un formulaire.
 */

interface Acteur {
  id: number;
  email: string;
  userId: number;
}

function acteurDe(utilisateur: SessionUser): Acteur {
  return {
    id: utilisateur.id,
    email: utilisateur.email,
    userId: utilisateur.id,
  };
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

function lireUsine(formData: FormData, champ = "factory"): Factory {
  const valeur = texteOuNull(formData.get(champ));
  if (valeur !== "ADMEDCO" && valeur !== "MOBILIX" && valeur !== "COMMUN") {
    throw validation("L'usine doit etre choisie dans la liste proposee.", {
      [champ]: "Valeur obligatoire ou inconnue.",
    });
  }
  return valeur;
}

function lirePriorite(formData: FormData): Priority | undefined {
  const valeur = texteOuNull(formData.get("priority"));
  if (valeur === null) return undefined;
  if (
    valeur !== "BASSE" &&
    valeur !== "NORMALE" &&
    valeur !== "HAUTE" &&
    valeur !== "URGENTE"
  ) {
    throw validation("La priorite doit etre choisie dans la liste proposee.", {
      priority: "Valeur inconnue.",
    });
  }
  return valeur;
}

/**
 * Heure d'atelier saisie par un responsable.
 *
 * `08:30` designe huit heures trente a l'usine, dans le fuseau metier, le jour
 * de la tache — jamais huit heures trente UTC. Un champ date-heure complet reste
 * accepte tel quel.
 */
function lireHeureMetier(
  formData: FormData,
  champ: string,
  jour: string,
  libelleChamp: string,
): Date | null {
  const valeur = texteOuNull(formData.get(champ));
  if (valeur === null) return null;

  if (/^\d{1,2}:\d{2}$/.test(valeur)) {
    const [heures, minutes] = valeur.split(":");
    const normalisee = `${heures.padStart(2, "0")}:${minutes}`;
    const instant = instantMetier(jour, normalisee);
    if (!instant) {
      throw validation(`${libelleChamp} n'est pas une heure valide.`, {
        [champ]: "Format attendu : HH:MM.",
      });
    }
    return instant;
  }

  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) {
    throw validation(`${libelleChamp} n'est pas valide.`, {
      [champ]: "Format attendu : HH:MM.",
    });
  }
  return date;
}

/**
 * Compte du portail : borne sur l'employe connecte.
 * Le portail n'accepte jamais un identifiant d'employe provenant du navigateur.
 */
async function comptePortail(permission: string): Promise<{
  utilisateur: SessionUser;
  employeeId: number;
}> {
  const utilisateur = await exigerPermission(permission);
  if (!utilisateur.employeeId) {
    throw accesRefuse(
      "Votre compte n'est rattache a aucune fiche employe : cette action est impossible. Contactez le service des ressources humaines.",
    );
  }
  return { utilisateur, employeeId: utilisateur.employeeId };
}

// -----------------------------------------------------------------------------
// QR de poste
// -----------------------------------------------------------------------------

export async function actionGenererQrPoste(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "Le QR du poste est genere. Imprimez la nouvelle etiquette : l'ancienne ne fonctionne plus.",
    async () => {
      const utilisateur = await exigerPermission(PERMISSIONS.POSTE_QR_GERER);
      const workCenterId = lireIdentifiant(formData, "workCenterId", "Le poste");

      const poste = await genererQrPoste({
        workCenterId,
        acteur: acteurDe(utilisateur),
        comment: texteOuNull(formData.get("comment")),
      });

      revalidatePath("/production/postes");
      revalidatePath(`/production/postes/${workCenterId}`);
      return { workCenterId, qrVersion: poste.qrVersion };
    },
  );
}

export async function actionRevoquerQrPoste(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "Le QR du poste est revoque : l'etiquette ne permet plus aucun scan.",
    async () => {
      const utilisateur = await exigerPermission(PERMISSIONS.POSTE_QR_GERER);
      const workCenterId = lireIdentifiant(formData, "workCenterId", "Le poste");
      const motif = texteObligatoire(formData.get("motif"), "Motif de revocation");

      await revoquerQrPoste({
        workCenterId,
        acteur: acteurDe(utilisateur),
        motif,
      });

      revalidatePath("/production/postes");
      revalidatePath(`/production/postes/${workCenterId}`);
      return { workCenterId };
    },
  );
}

export async function actionMarquerQrImprime(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>("Impression notee.", async () => {
    await exigerPermission(PERMISSIONS.POSTE_QR_GERER);
    const workCenterId = lireIdentifiant(formData, "workCenterId", "Le poste");
    await marquerQrImprime(workCenterId);
    revalidatePath(`/production/postes/${workCenterId}`);
    return { workCenterId };
  });
}

// -----------------------------------------------------------------------------
// Programme de travail
// -----------------------------------------------------------------------------

export async function actionOuvrirProgramme(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "Le programme de travail est ouvert. Ajoutez les taches, puis publiez-le.",
    async () => {
      const utilisateur = await exigerPermission(
        PERMISSIONS.PRODUCTION_PLANNING_GERER,
      );
      const factory = lireUsine(formData);
      const portee = texteOuNull(formData.get("portee")) === "SEMAINE"
        ? "SEMAINE"
        : "JOUR";
      const dateSaisie = texteObligatoire(formData.get("reference"), "Date");

      const reference = new Date(`${dateSaisie}T12:00:00Z`);
      if (Number.isNaN(reference.getTime())) {
        throw validation("La date du programme n'est pas valide.", {
          reference: "Format attendu : AAAA-MM-JJ.",
        });
      }

      const programme = await ouvrirProgramme(
        {
          factory,
          workshopId: entierOu(formData.get("workshopId")),
          reference,
          portee,
          label: texteOuNull(formData.get("label")) ?? undefined,
          responsableId: entierOu(formData.get("responsableId")),
          note: texteOuNull(formData.get("note")),
        },
        acteurDe(utilisateur),
      );

      revalidatePath("/production/programme");
      return { scheduleId: programme.id, code: programme.code };
    },
  );
}

export async function actionAjouterTacheProgramme(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La tache est ajoutee au programme.",
    async () => {
      const utilisateur = await exigerPermission(
        PERMISSIONS.PRODUCTION_PLANNING_GERER,
      );

      const scheduleId = lireIdentifiant(formData, "scheduleId", "Le programme");
      const employeeId = lireIdentifiant(formData, "employeeId", "L'employe");
      const dateSaisie = texteObligatoire(formData.get("date"), "Date de la tache");

      const date = new Date(`${dateSaisie}T12:00:00Z`);
      if (Number.isNaN(date.getTime())) {
        throw validation("La date de la tache n'est pas valide.");
      }

      // L'operation et l'ordre de fabrication ne sont pas pris tels quels dans
      // le formulaire : ils sont derives de l'operation d'OF reellement choisie.
      // Le navigateur ne peut donc pas rattacher une operation a un OF qui ne la
      // porte pas, ni planifier un OF hors de son perimetre.
      const workOrderOperationId = entierOu(formData.get("workOrderOperationId"));
      let operationId = entierOu(formData.get("operationId"));
      let workOrderId = entierOu(formData.get("workOrderId"));

      if (workOrderOperationId) {
        const operationOf = await prisma.workOrderOperation.findUnique({
          where: { id: workOrderOperationId },
          select: {
            operationId: true,
            workOrderId: true,
            workOrder: { select: { factory: true } },
          },
        });
        if (!operationOf) {
          throw validation(
            "L'operation d'ordre de fabrication choisie n'existe pas.",
            { workOrderOperationId: "Selection invalide." },
          );
        }
        if (!usinesAutorisees(utilisateur).includes(operationOf.workOrder.factory)) {
          throw accesRefuse(
            "Cet ordre de fabrication appartient a une division hors de votre perimetre.",
          );
        }
        operationId = operationOf.operationId;
        workOrderId = operationOf.workOrderId;
      }

      if (!operationId) {
        throw validation("Choisissez l'operation a planifier.", {
          workOrderOperationId: "Selection obligatoire.",
        });
      }

      const id = await ajouterTacheAuProgramme(
        {
          scheduleId,
          employeeId,
          operationId,
          date: jourCivilMetier(date),
          workCenterId: entierOu(formData.get("workCenterId")),
          workOrderId,
          workOrderOperationId,
          warehouseId: entierOu(formData.get("warehouseId")),
          plannedStart: lireHeureMetier(
            formData,
            "plannedStart",
            dateSaisie,
            "L'heure de debut",
          ),
          plannedEnd: lireHeureMetier(
            formData,
            "plannedEnd",
            dateSaisie,
            "L'heure de fin",
          ),
          priority: lirePriorite(formData),
          sequenceOrder: entierOu(formData.get("sequenceOrder")) ?? 0,
          plannedQuantity: decimalOuNull(formData.get("plannedQuantity")) ?? "0",
          plannedLotId: entierOu(formData.get("plannedLotId")),
          comment: texteOuNull(formData.get("comment")),
          responsibleId: entierOu(formData.get("responsibleId")),
        },
        acteurDe(utilisateur),
      );

      revalidatePath("/production/programme");
      return { assignmentId: id };
    },
  );
}

export async function actionPublierProgramme(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "Le programme est publie : il devient la reference de l'atelier.",
    async () => {
      const utilisateur = await exigerPermission(
        PERMISSIONS.PRODUCTION_PLANNING_GERER,
      );
      const scheduleId = lireIdentifiant(formData, "scheduleId", "Le programme");

      const programme = await publierProgramme({
        scheduleId,
        acteur: acteurDe(utilisateur),
      });

      revalidatePath("/production/programme");
      revalidatePath("/portail");
      return { scheduleId: programme.id };
    },
  );
}

export async function actionReviserProgramme(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "Une revision du programme est ouverte. L'ancien programme reste consultable en archive.",
    async () => {
      const utilisateur = await exigerPermission(
        PERMISSIONS.PRODUCTION_PLANNING_GERER,
      );
      const scheduleId = lireIdentifiant(formData, "scheduleId", "Le programme");
      const motif = texteObligatoire(formData.get("motif"), "Motif de revision");

      const revision = await reviserProgramme({
        scheduleId,
        motif,
        acteur: acteurDe(utilisateur),
      });

      revalidatePath("/production/programme");
      return { scheduleId: revision.id, code: revision.code };
    },
  );
}

export async function actionReaffecterTacheProgramme(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La tache est reaffectee. L'historique conserve l'ancienne et la nouvelle affectation.",
    async () => {
      const utilisateur = await exigerPermission(
        PERMISSIONS.PRODUCTION_PLANNING_GERER,
      );
      const assignmentId = lireIdentifiant(
        formData,
        "assignmentId",
        "La tache",
      );
      const motif = texteObligatoire(formData.get("motif"), "Motif de reaffectation");

      const resultat = await reaffecterTacheProgramme({
        assignmentId,
        versEmployeeId: entierOu(formData.get("versEmployeeId")) ?? undefined,
        versWorkCenterId: entierOu(formData.get("versWorkCenterId")),
        versPriorite: lirePriorite(formData),
        versSequence: entierOu(formData.get("versSequence")) ?? undefined,
        motif,
        acteur: acteurDe(utilisateur),
      });

      revalidatePath("/production/programme");
      revalidatePath("/portail");
      return resultat;
    },
  );
}

// -----------------------------------------------------------------------------
// Sous-stocks et passage d'etape
// -----------------------------------------------------------------------------

export async function actionCreerSousStock(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "Le sous-stock d'operation est cree.",
    async () => {
      await exigerPermission(PERMISSIONS.PRODUCTION_SOUS_STOCK_GERER);

      const sousStock = await creerSousStock(prisma, {
        code: texteObligatoire(formData.get("code"), "Code"),
        label: texteObligatoire(formData.get("label"), "Libelle"),
        operationId: lireIdentifiant(formData, "operationId", "L'operation"),
        warehouseId: lireIdentifiant(formData, "warehouseId", "Le depot"),
        locationCode: texteObligatoire(formData.get("locationCode"), "Emplacement"),
        locationLabel: texteOuNull(formData.get("locationLabel")) ?? undefined,
        factory: lireUsine(formData),
        workshopId: entierOu(formData.get("workshopId")),
        workCenterId: entierOu(formData.get("workCenterId")),
        kind:
          (texteOuNull(formData.get("kind")) as
            | "ENTREE_OPERATION"
            | "SORTIE_OPERATION"
            | "TAMPON"
            | "ATTENTE_QUALITE"
            | null) ?? "SORTIE_OPERATION",
        sequenceOrder: entierOu(formData.get("sequenceOrder")) ?? 0,
        description: texteOuNull(formData.get("description")),
      });

      revalidatePath("/production/sous-stocks");
      return { sousStockId: sousStock.id };
    },
  );
}

export async function actionDefinirLienSousStock(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "Le lien entre les deux etapes est enregistre.",
    async () => {
      await exigerPermission(PERMISSIONS.PRODUCTION_SOUS_STOCK_GERER);

      const lien = await definirLienSousStock(prisma, {
        fromSubStockId: lireIdentifiant(formData, "fromSubStockId", "L'etape amont"),
        toSubStockId: lireIdentifiant(formData, "toSubStockId", "L'etape aval"),
        isRequired: texteOuNull(formData.get("isRequired")) !== "false",
        quantityRatio: decimalOuNull(formData.get("quantityRatio")) ?? "1",
        note: texteOuNull(formData.get("note")),
      });

      revalidatePath("/production/sous-stocks");
      return { linkId: lien.id };
    },
  );
}

export async function actionTransfererEtape(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La quantite conforme est transferee vers l'etape suivante.",
    async () => {
      const utilisateur = await exigerPermission(
        PERMISSIONS.PRODUCTION_TRANSFERT_ETAPE,
      );

      const passage = await transfererVersEtapeSuivante({
        workOrderOperationId: lireIdentifiant(
          formData,
          "workOrderOperationId",
          "L'operation de l'ordre",
        ),
        fromSubStockId: lireIdentifiant(
          formData,
          "fromSubStockId",
          "Le sous-stock source",
        ),
        toSubStockId: lireIdentifiant(
          formData,
          "toSubStockId",
          "Le sous-stock de destination",
        ),
        itemId: lireIdentifiant(formData, "itemId", "L'article"),
        lotId: entierOu(formData.get("lotId")),
        quantity: decimalObligatoire(formData.get("quantity"), "Quantite"),
        unitCode: texteOuNull(formData.get("unitCode")),
        occurredAt: new Date(),
        comment: texteOuNull(formData.get("comment")),
        acteur: acteurDe(utilisateur),
      });

      revalidatePath("/production/feuille-de-route");
      revalidatePath("/production/sous-stocks");
      return {
        transfertId: String(passage.transfertId),
        dejaEnregistre: passage.dejaEnregistre,
      };
    },
  );
}

// -----------------------------------------------------------------------------
// Portail : scan du poste
// -----------------------------------------------------------------------------

export async function actionScannerPoste(
  formData: FormData,
): Promise<ResultatAction> {
  const { utilisateur, employeeId } = await comptePortail(
    PERMISSIONS.PORTAIL_POSTE_SCANNER,
  );

  const token = texteOuNull(formData.get("token"));
  const codePoste = texteOuNull(formData.get("codePoste"));

  if (!token && !codePoste) {
    return {
      ok: false,
      message:
        "Scannez le QR du poste ou saisissez son code pour afficher votre programme.",
    };
  }

  const resultat = await executerScanPoste({
    token: token ?? undefined,
    codePoste: codePoste ?? undefined,
    employeId: employeeId,
    utilisateur: acteurDe(utilisateur),
    fabriquesAutorisees: usinesAutorisees(utilisateur),
    userAgent: texteOuNull(formData.get("userAgent")),
  });

  if (!resultat.accepte) {
    return { ok: false, message: resultat.motif, code: "SCAN_REFUSE" };
  }

  revalidatePath("/portail");
  revalidatePath("/portail/programme");

  return {
    ok: true,
    message:
      `Poste « ${resultat.poste.label} » : ${resultat.taches.length} tache(s) vous sont affectees aujourd'hui.`,
    posteCode: resultat.poste.code,
    posteLabel: resultat.poste.label,
    taches: resultat.taches.length,
  };
}

/** Saisie manuelle du code du poste : exactement les memes controles serveur. */
export async function actionScannerPosteParCode(
  formData: FormData,
): Promise<ResultatAction> {
  const donnees = new FormData();
  const code = texteOuNull(formData.get("codePoste"));
  if (code) donnees.set("codePoste", code);
  const agent = texteOuNull(formData.get("userAgent"));
  if (agent) donnees.set("userAgent", agent);
  return actionScannerPoste(donnees);
}
