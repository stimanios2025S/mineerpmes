"use server";

import { revalidatePath } from "next/cache";
import type {
  Factory,
  LossCategory,
  LossReason,
  Priority,
  QualityDecision,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { conflit, etatInvalide, nonTrouve, validation } from "@/lib/errors";
import { exigerPermissionEtUsine } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import { controlerProduction } from "@/lib/qualite/service";
import {
  annulerOrdreFabrication,
  cloturerOrdreFabrication,
  creerOrdreFabrication,
  declarerConsommation,
  declarerPerte,
  declarerProduction,
  demarrerOperation,
  deplacerCarteKanban,
  lancerOrdreFabrication,
  mettreEnPauseOperation,
  reprendreOperation,
  validerDeclaration,
} from "@/lib/production/service";
import {
  booleen,
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
  LIBELLES_DECISION_QUALITE,
  LIBELLES_MOTIF_PERTE,
  LIBELLES_PRIORITE,
  LIBELLES_USINE,
} from "@/lib/libelles";

/**
 * Actions serveur du module production (MES).
 *
 * Aucune quantite et aucun statut n'est ecrit directement en base : toutes les
 * mutations passent par le moteur de production (`@/lib/production/service`) et,
 * pour le controle qualite, par le moteur qualite. Chaque action revalide la
 * permission requise ET l'acces a la division concernee avant d'agir ; ces
 * controles sont volontairement places dans `executer` pour qu'un refus soit
 * restitue a l'operateur en francais, jamais sous forme d'erreur technique.
 */

// -----------------------------------------------------------------------------
// Aides internes
// -----------------------------------------------------------------------------

interface Acteur {
  id: number;
  email: string;
}

function acteurDe(utilisateur: { id: number; email: string }): Acteur {
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
    throw validation(`Le champ « ${libelleChamp} » doit etre choisi dans la liste proposee.`, {
      [libelleChamp]: "Valeur obligatoire ou inconnue.",
    });
  }
  return valeur as T;
}

/** Charge l'ordre de fabrication puis controle la permission et la division. */
async function ordreAutorise(workOrderId: number, permission: string) {
  const ordre = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, number: true, factory: true, status: true },
  });
  if (!ordre) throw nonTrouve("L'ordre de fabrication");

  const utilisateur = await exigerPermissionEtUsine(permission, ordre.factory);
  return { ordre, utilisateur };
}

/** Charge l'operation de fabrication puis controle la permission et la division. */
async function operationAutorisee(workOrderOperationId: number, permission: string) {
  const operation = await prisma.workOrderOperation.findUnique({
    where: { id: workOrderOperationId },
    select: {
      id: true,
      stepNo: true,
      status: true,
      quantityPlanned: true,
      quantityConform: true,
      operation: { select: { code: true, label: true } },
      workOrder: {
        select: {
          id: true,
          number: true,
          factory: true,
          itemId: true,
          sourceWarehouseId: true,
        },
      },
    },
  });
  if (!operation) throw nonTrouve("L'operation de fabrication");

  const utilisateur = await exigerPermissionEtUsine(permission, operation.workOrder.factory);
  return { operation, utilisateur };
}

/** Toutes les vues de production partagent le meme rafraichissement. */
function rafraichirProduction(): void {
  revalidatePath("/production", "layout");
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

// -----------------------------------------------------------------------------
// Creation et lancement d'un ordre
// -----------------------------------------------------------------------------

export async function actionCreerOrdreFabrication(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "L'ordre de fabrication a ete cree.",
    async () => {
      const factory = choixObligatoire<Factory>(
        texteOuNull(formData.get("factory")),
        LIBELLES_USINE,
        "division",
      );
      const utilisateur = await exigerPermissionEtUsine(
        PERMISSIONS.PRODUCTION_ORDRE_CREER,
        factory,
      );

      const lancerImmediatement = booleen(formData.get("lancerImmediatement"));
      if (lancerImmediatement) {
        // Lancer un ordre est une action distincte : elle exige sa propre permission.
        await exigerPermissionEtUsine(PERMISSIONS.PRODUCTION_LANCER, factory);
      }

      const priorityTexte = texteOuNull(formData.get("priority"));

      const ordre = await creerOrdreFabrication({
        itemId: lireIdentifiant(formData, "itemId", "L'article a fabriquer"),
        quantityPlanned: decimalObligatoire(
          formData.get("quantityPlanned"),
          "Quantite planifiee",
        ),
        factory,
        priority: priorityTexte
          ? choixObligatoire<Priority>(priorityTexte, LIBELLES_PRIORITE, "priorite")
          : undefined,
        formulaId: entierOu(formData.get("formulaId")),
        routeId: entierOu(formData.get("routeId")),
        sourceWarehouseId: entierOu(formData.get("sourceWarehouseId")),
        targetWarehouseId: entierOu(formData.get("targetWarehouseId")),
        salesOrderId: entierOu(formData.get("salesOrderId")),
        salesOrderLineId: entierOu(formData.get("salesOrderLineId")),
        customerId: entierOu(formData.get("customerId")),
        customerReference: texteOuNull(formData.get("customerReference")),
        deliveryAddress: texteOuNull(formData.get("deliveryAddress")),
        carrier: texteOuNull(formData.get("carrier")),
        plannedDeliveryDate: dateOuNull(formData.get("plannedDeliveryDate")),
        deliveryNotes: texteOuNull(formData.get("deliveryNotes")),
        plannedStart: dateOuNull(formData.get("plannedStart")),
        dueDate: dateOuNull(formData.get("dueDate")),
        responsibleId: entierOu(formData.get("responsibleId")),
        notes: texteOuNull(formData.get("notes")),
        lancerImmediatement,
        acteur: acteurDe(utilisateur),
      });

      rafraichirProduction();
      return { ordreId: ordre.workOrderId, numero: ordre.number };
    },
  );
}

export async function actionLancerOrdre(formData: FormData): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "L'ordre de fabrication est lance : la nomenclature est desormais figee.",
    async () => {
      const workOrderId = lireIdentifiant(formData, "workOrderId", "L'ordre de fabrication");
      const { utilisateur } = await ordreAutorise(workOrderId, PERMISSIONS.PRODUCTION_LANCER);

      const resultat = await lancerOrdreFabrication(workOrderId, acteurDe(utilisateur));

      rafraichirProduction();
      return { matieres: resultat.matieres };
    },
  );
}

// -----------------------------------------------------------------------------
// Conduite des operations
// -----------------------------------------------------------------------------

export async function actionDemarrerOperation(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>("L'operation est en cours.", async () => {
    const workOrderOperationId = lireIdentifiant(
      formData,
      "workOrderOperationId",
      "L'operation",
    );
    const { utilisateur } = await operationAutorisee(
      workOrderOperationId,
      PERMISSIONS.PRODUCTION_DECLARER,
    );

    await demarrerOperation({
      workOrderOperationId,
      employeeId: entierOu(formData.get("employeeId")),
      commentaire: texteOuNull(formData.get("commentaire")),
      acteur: acteurDe(utilisateur),
    });

    rafraichirProduction();
    return {};
  });
}

export async function actionMettreEnPauseOperation(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>("L'operation est mise en pause.", async () => {
    const workOrderOperationId = lireIdentifiant(
      formData,
      "workOrderOperationId",
      "L'operation",
    );
    const { utilisateur } = await operationAutorisee(
      workOrderOperationId,
      PERMISSIONS.PRODUCTION_DECLARER,
    );

    await mettreEnPauseOperation(
      workOrderOperationId,
      acteurDe(utilisateur),
      entierOu(formData.get("employeeId")),
      texteOuNull(formData.get("commentaire")),
    );

    rafraichirProduction();
    return {};
  });
}

export async function actionReprendreOperation(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>("L'operation a repris.", async () => {
    const workOrderOperationId = lireIdentifiant(
      formData,
      "workOrderOperationId",
      "L'operation",
    );
    const { utilisateur } = await operationAutorisee(
      workOrderOperationId,
      PERMISSIONS.PRODUCTION_DECLARER,
    );

    await reprendreOperation(
      workOrderOperationId,
      acteurDe(utilisateur),
      entierOu(formData.get("employeeId")),
      texteOuNull(formData.get("commentaire")),
    );

    rafraichirProduction();
    return {};
  });
}

// -----------------------------------------------------------------------------
// Declarations d'atelier
// -----------------------------------------------------------------------------

export async function actionDeclarerProduction(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La production a ete declaree : le stock et l'ordre sont mis a jour.",
    async () => {
      const workOrderOperationId = lireIdentifiant(
        formData,
        "workOrderOperationId",
        "L'operation",
      );
      const { utilisateur } = await operationAutorisee(
        workOrderOperationId,
        PERMISSIONS.PRODUCTION_DECLARER,
      );

      const resultat = await declarerProduction({
        workOrderOperationId,
        employeeId: entierOu(formData.get("employeeId")),
        quantiteProduite: decimalObligatoire(
          formData.get("quantiteProduite"),
          "Quantite produite",
        ),
        quantiteConforme: decimalOuNull(formData.get("quantiteConforme")) ?? undefined,
        quantiteRebutee: decimalOuNull(formData.get("quantiteRebutee")) ?? undefined,
        quantiteReprise: decimalOuNull(formData.get("quantiteReprise")) ?? undefined,
        commentaire: texteOuNull(formData.get("commentaire")),
        consommerComposants: booleen(formData.get("consommerComposants")),
        acteur: acteurDe(utilisateur),
      });

      rafraichirProduction();
      return {
        declarationId: String(resultat.declarationId),
        matieresConsommees: resultat.matieresConsommees,
      };
    },
  );
}

export async function actionDeclarerConsommation(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La consommation reelle a ete enregistree et sortie du stock.",
    async () => {
      const workOrderOperationId = lireIdentifiant(
        formData,
        "workOrderOperationId",
        "L'operation",
      );
      const { utilisateur } = await operationAutorisee(
        workOrderOperationId,
        PERMISSIONS.PRODUCTION_DECLARER,
      );

      const resultat = await declarerConsommation({
        workOrderOperationId,
        materialId: lireIdentifiant(formData, "materialId", "Le composant consomme"),
        quantite: decimalObligatoire(formData.get("quantite"), "Quantite consommee"),
        employeeId: entierOu(formData.get("employeeId")),
        commentaire: texteOuNull(formData.get("commentaire")),
        acteur: acteurDe(utilisateur),
      });

      rafraichirProduction();
      return {
        declarationId: String(resultat.declarationId),
        categorie: resultat.categorie,
      };
    },
  );
}

export async function actionDeclarerPerte(formData: FormData): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La perte a ete declaree avec sa categorie et son motif.",
    async () => {
      const workOrderOperationId = lireIdentifiant(
        formData,
        "workOrderOperationId",
        "L'operation",
      );
      const { operation, utilisateur } = await operationAutorisee(
        workOrderOperationId,
        PERMISSIONS.PRODUCTION_DECLARER,
      );

      const categorie = choixObligatoire<LossCategory>(
        texteObligatoire(formData.get("categorie"), "Categorie de la perte"),
        LIBELLES_CATEGORIE_PERTE,
        "categorie",
      );
      const motif = choixObligatoire<LossReason>(
        texteObligatoire(formData.get("motif"), "Motif de la perte"),
        LIBELLES_MOTIF_PERTE,
        "motif",
      );

      // Une perte doit etre rattachee a un depot reel : sans depot, aucun
      // mouvement de stock ne pourrait etre justifie.
      const warehouseId =
        entierOu(formData.get("warehouseId")) ?? operation.workOrder.sourceWarehouseId;
      if (!warehouseId) {
        throw etatInvalide(
          `Aucun depot n'est defini sur l'ordre ${operation.workOrder.number} : la perte ne peut pas etre enregistree.`,
        );
      }

      const resultat = await declarerPerte({
        workOrderOperationId,
        itemId: lireIdentifiant(formData, "itemId", "L'article concerne par la perte"),
        quantite: decimalObligatoire(formData.get("quantite"), "Quantite perdue"),
        categorie,
        motif,
        employeeId: entierOu(formData.get("employeeId")),
        warehouseId,
        materialId: entierOu(formData.get("materialId")),
        commentaire: texteOuNull(formData.get("commentaire")),
        sortirDuStock: booleen(formData.get("sortirDuStock")),
        acteur: acteurDe(utilisateur),
      });

      rafraichirProduction();
      return {
        declarationId: String(resultat.declarationId),
        categorie: resultat.categorie,
        validationRequise: resultat.validationRequise,
      };
    },
  );
}

// -----------------------------------------------------------------------------
// Validation des declarations d'atelier
// -----------------------------------------------------------------------------

export async function actionValiderDeclaration(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>("La declaration a ete validee.", async () => {
    const declarationId = lireIdentifiant(formData, "declarationId", "La declaration");

    const declaration = await prisma.operationDeclaration.findUnique({
      where: { id: BigInt(declarationId) },
      select: { id: true, status: true, workOrder: { select: { factory: true } } },
    });
    if (!declaration) throw nonTrouve("La declaration");

    const utilisateur = await exigerPermissionEtUsine(
      PERMISSIONS.PRODUCTION_VALIDER_DECLARATION,
      declaration.workOrder.factory,
    );

    await validerDeclaration(
      declaration.id,
      acteurDe(utilisateur),
      utilisateur.employeeId ?? null,
    );

    rafraichirProduction();
    return {};
  });
}

export async function actionRejeterDeclaration(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La declaration a ete rejetee : le motif est conserve dans l'historique.",
    async () => {
      const declarationId = lireIdentifiant(formData, "declarationId", "La declaration");
      const motif = texteObligatoire(formData.get("motif"), "Motif du rejet");
      if (motif.trim().length < 10) {
        throw validation(
          "Le motif de rejet doit etre redige en au moins 10 caracteres.",
          { motif: "Motif trop court." },
        );
      }

      const declaration = await prisma.operationDeclaration.findUnique({
        where: { id: BigInt(declarationId) },
        select: {
          id: true,
          status: true,
          workOrder: { select: { factory: true, number: true } },
        },
      });
      if (!declaration) throw nonTrouve("La declaration");
      if (declaration.status === "VALIDEE") {
        throw conflit("Cette declaration est deja validee : elle ne peut plus etre rejetee.");
      }
      if (declaration.status === "REJETEE") {
        throw conflit("Cette declaration est deja rejetee.");
      }

      const utilisateur = await exigerPermissionEtUsine(
        PERMISSIONS.PRODUCTION_VALIDER_DECLARATION,
        declaration.workOrder.factory,
      );

      // Le moteur de production n'expose pas de fonction de rejet : l'ecriture
      // est donc limitee ici au seul statut de la declaration (jamais une
      // quantite, jamais un statut d'ordre) et reste integralement journalisee.
      await prisma.operationDeclaration.update({
        where: { id: declaration.id },
        data: {
          status: "REJETEE",
          rejectionReason: motif,
          validatedById: utilisateur.employeeId ?? null,
          validatedAt: new Date(),
        },
      });

      await enregistrerAudit({
        action: ACTIONS_AUDIT.VALIDATION,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "OperationDeclaration",
        entityId: declaration.id,
        userId: utilisateur.id,
        userEmail: utilisateur.email,
        oldValue: { statut: declaration.status },
        newValue: { statut: "REJETEE", ordre: declaration.workOrder.number },
        comment: motif,
        reason: motif,
      });

      rafraichirProduction();
      return {};
    },
  );
}

// -----------------------------------------------------------------------------
// Deplacement Kanban
// -----------------------------------------------------------------------------

/**
 * Deplace une carte Kanban.
 *
 * Le deplacement est sequentiel : la gamme impose l'etape suivante. Le
 * formulaire peut egalement porter, dans le meme geste, la consommation reelle,
 * la perte declaree et le controle qualite ; ces elements passent tous par leur
 * fonction metier respective avant le deplacement lui-meme.
 */
export async function actionDeplacerCarteKanban(
  formData: FormData,
): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La carte a ete deplacee : l'operation precedente est cloturee et l'etape suivante demarree.",
    async () => {
      const workOrderOperationId = lireIdentifiant(
        formData,
        "workOrderOperationId",
        "La carte",
      );
      const { operation, utilisateur } = await operationAutorisee(
        workOrderOperationId,
        PERMISSIONS.PRODUCTION_KANBAN_DEPLACER,
      );
      const acteur = acteurDe(utilisateur);
      const employeeId = entierOu(formData.get("employeeId"));
      const commentaire = texteOuNull(formData.get("commentaire"));

      // 1. Etape de destination : le service deplace toujours l'operation vers
      //    l'etape suivante de la gamme. La destination choisie est donc
      //    confrontee a cette regle au lieu d'etre appliquee telle quelle.
      const etapeChoisie = texteObligatoire(
        formData.get("etapeDestination"),
        "Etape de destination",
      );
      const suivante = await prisma.workOrderOperation.findFirst({
        where: { workOrderId: operation.workOrder.id, stepNo: { gt: operation.stepNo } },
        orderBy: { stepNo: "asc" },
        select: { operation: { select: { code: true, label: true } } },
      });
      const destinationAttendue = suivante ? suivante.operation.code : "FIN_GAMME";
      if (etapeChoisie !== destinationAttendue) {
        throw etatInvalide(
          suivante
            ? `Le Kanban circule dans l'ordre de la gamme : apres « ${operation.operation.label} », l'etape suivante de l'ordre ${operation.workOrder.number} est « ${suivante.operation.label} ».`
            : `« ${operation.operation.label} » est la derniere etape de l'ordre ${operation.workOrder.number} : la carte ne peut que sortir de l'atelier.`,
        );
      }

      // 2. Consommation reelle eventuellement portee par la carte.
      const quantiteConsommee = decimalOuNull(formData.get("consommationQuantite"));
      if (quantiteConsommee) {
        await declarerConsommation({
          workOrderOperationId,
          materialId: lireIdentifiant(formData, "materialId", "Le composant consomme"),
          quantite: quantiteConsommee,
          employeeId,
          commentaire,
          acteur,
        });
      }

      // 3. Perte eventuellement portee par la carte : categorie et motif sont
      //    exigés par le moteur de production.
      const quantitePerdue = decimalOuNull(formData.get("perteQuantite"));
      if (quantitePerdue) {
        const warehouseId = entierOu(formData.get("perteWarehouseId"));
        if (!warehouseId) {
          throw etatInvalide(
            `Aucun depot n'est defini sur l'ordre ${operation.workOrder.number} : la perte ne peut pas etre enregistree.`,
          );
        }
        await declarerPerte({
          workOrderOperationId,
          itemId: operation.workOrder.itemId,
          quantite: quantitePerdue,
          categorie: choixObligatoire<LossCategory>(
            texteObligatoire(formData.get("perteCategorie"), "Categorie de la perte"),
            LIBELLES_CATEGORIE_PERTE,
            "categorie de la perte",
          ),
          motif: choixObligatoire<LossReason>(
            texteObligatoire(formData.get("perteMotif"), "Motif de la perte"),
            LIBELLES_MOTIF_PERTE,
            "motif de la perte",
          ),
          employeeId,
          warehouseId,
          commentaire: texteOuNull(formData.get("perteCommentaire")),
          sortirDuStock: true,
          acteur,
        });
      }

      // 4. Controle qualite eventuellement porte par la carte : il passe par le
      //    moteur qualite, qui met a jour le statut qualite et ouvre une
      //    non-conformite si la decision l'impose.
      const decisionTexte = texteOuNull(formData.get("decisionQualite"));
      if (decisionTexte) {
        const decision = choixObligatoire<QualityDecision>(
          decisionTexte,
          LIBELLES_DECISION_QUALITE,
          "resultat qualite",
        );
        const utilisateurQualite = await exigerPermissionEtUsine(
          PERMISSIONS.QUALITE_CONTROLER,
          operation.workOrder.factory,
        );
        const quantiteControlee = decimalObligatoire(
          formData.get("quantiteControlee"),
          "Quantite controlee",
        );

        await controlerProduction({
          workOrderOperationId,
          quantityChecked: quantiteControlee,
          quantityConform:
            decimalOuNull(formData.get("quantiteConforme")) ?? quantiteControlee,
          quantityRejected: decimalOuNull(formData.get("quantiteRejetee")) ?? undefined,
          decision,
          commentaire,
          checkedById: utilisateurQualite.employeeId ?? null,
          acteur: acteurDe(utilisateurQualite),
        });
      }

      // 5. Deplacement de la carte : l'ancien statut, le nouveau, l'utilisateur
      //    et l'horodatage sont enregistres par le service.
      const resultat = await deplacerCarteKanban({
        workOrderOperationId,
        quantite: decimalOuNull(formData.get("quantite")) ?? 0,
        commentaire,
        employeeId,
        forcer: booleen(formData.get("forcer")),
        acteur,
      });

      rafraichirProduction();

      // `executer` laisse les donnees retournees completer le resultat : le
      // compte rendu reel du deplacement (transfert inter-ateliers automatique
      // compris) est ainsi annonce a l'operateur.
      let message = resultat.ordreTermine
        ? `Derniere etape terminee : l'ordre ${operation.workOrder.number} est declare termine.`
        : `Carte deplacee de « ${operation.operation.label} » vers « ${resultat.versOperation ?? "-"} ».`;
      if (resultat.transfertDivision?.effectue) {
        message += ` Transfert inter-ateliers cree : ${resultat.transfertDivision.quantite} ${resultat.transfertDivision.article} de ${resultat.transfertDivision.depotSource} vers ${resultat.transfertDivision.depotDestination}.`;
      }

      return {
        message,
        versOperation: resultat.versOperation,
        ordreTermine: resultat.ordreTermine,
      };
    },
  );
}

// -----------------------------------------------------------------------------
// Cloture et annulation
// -----------------------------------------------------------------------------

export async function actionCloturerOrdre(formData: FormData): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "L'ordre de fabrication est cloture.",
    async () => {
      const workOrderId = lireIdentifiant(formData, "workOrderId", "L'ordre de fabrication");
      const { utilisateur } = await ordreAutorise(workOrderId, PERMISSIONS.PRODUCTION_CLOTURER);

      await cloturerOrdreFabrication(
        workOrderId,
        acteurDe(utilisateur),
        texteOuNull(formData.get("commentaire")),
      );

      rafraichirProduction();
      return {};
    },
  );
}

export async function actionAnnulerOrdre(formData: FormData): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "L'ordre de fabrication est annule : le motif est conserve dans l'historique.",
    async () => {
      const workOrderId = lireIdentifiant(formData, "workOrderId", "L'ordre de fabrication");
      const motif = texteObligatoire(formData.get("motif"), "Motif d'annulation");
      if (motif.trim().length < 5) {
        throw validation(
          "Le motif d'annulation doit etre redige en au moins 5 caracteres.",
          { motif: "Motif trop court." },
        );
      }

      const { utilisateur } = await ordreAutorise(workOrderId, PERMISSIONS.PRODUCTION_ANNULER);

      await annulerOrdreFabrication(workOrderId, motif, acteurDe(utilisateur));

      rafraichirProduction();
      return {};
    },
  );
}
