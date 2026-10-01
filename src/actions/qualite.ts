"use server";

import { revalidatePath } from "next/cache";
import type { NonConformitySource, QualityDecision } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { conflit, etatInvalide, nonTrouve, validation } from "@/lib/errors";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import {
  ajouterPointDeControle,
  cloturerNonConformite,
  controlerProduction,
  controlerReception,
  creerNonConformite,
  creerPlanControle,
  libererProduitFini,
  traiterNonConformite,
  type ActeurQualite,
  type ControleReceptionInput,
} from "@/lib/qualite/service";
import { changerStatutStock } from "@/lib/stock/service";
import {
  booleen,
  decimalObligatoire,
  decimalOuNull,
  entierOu,
  executer,
  texteObligatoire,
  texteOuNull,
  type ResultatAction,
} from "@/lib/actions/resultat";
import {
  LIBELLES_DECISION_QUALITE,
  LIBELLES_SOURCE_NON_CONFORMITE,
  libelle,
} from "@/lib/libelles";

/**
 * Actions serveur du module qualite.
 *
 * Principes appliques ici :
 *  - le controle d'acces est rejoue a chaque appel : c'est la permission du
 *    geste metier qui est exigee, jamais celle de la page qui affiche le
 *    formulaire ;
 *  - aucune quantite n'est ecrite dans `StockBalance` : les mouvements de
 *    quarantaine, de liberation et de rebut passent par le service qualite, qui
 *    s'appuie lui-meme sur le grand livre de stock ;
 *  - tout changement de statut d'une non-conformite exige un commentaire ecrit,
 *    verifie ici et jamais seulement par le navigateur.
 *
 * Les controles d'acces sont volontairement places a l'interieur de `executer`
 * afin qu'un refus soit restitue a l'operateur sous forme de message francais et
 * non d'une erreur technique.
 */

/** Longueur minimale d'un commentaire ecrit exige par une decision qualite. */
const MOTIF_MINIMUM = 10;

/** Rafraichit les vues du module qualite apres une ecriture. */
function rafraichirQualite(): void {
  revalidatePath("/qualite", "layout");
}

/**
 * Rafraichit egalement les vues qui affichent l'etat qualite des articles :
 * un mouvement de quarantaine ou de liberation change le stock disponible et le
 * statut qualite des ordres de fabrication.
 */
function rafraichirStockEtProduction(): void {
  rafraichirQualite();
  revalidatePath("/stock", "layout");
  revalidatePath("/production", "layout");
}

function acteurDe(utilisateur: { id: number; email: string }): ActeurQualite {
  return { id: utilisateur.id, email: utilisateur.email };
}

/** Identifiant obligatoire lu dans un formulaire. */
function lireIdentifiant(
  formData: FormData,
  champ: string,
  libelleChamp: string,
): number {
  const identifiant = entierOu(formData.get(champ));
  if (identifiant === null) {
    throw validation(`Le champ « ${libelleChamp} » est obligatoire.`, {
      [champ]: "Selection obligatoire.",
    });
  }
  return identifiant;
}

/**
 * Verifie qu'une valeur de formulaire appartient bien a la table de libelles
 * francaise fournie. Une valeur inconnue est refusee : elle n'est jamais
 * remplacee par un defaut silencieux.
 */
function choixObligatoire<T extends string>(
  formData: FormData,
  champ: string,
  table: Record<string, string>,
  libelleChamp: string,
): T {
  const texte = texteOuNull(formData.get(champ));
  if (texte === null || !(texte in table)) {
    throw validation(`Le champ « ${libelleChamp} » est obligatoire.`, {
      [champ]: "Selection obligatoire.",
    });
  }
  return texte as T;
}

/** Commentaire ecrit obligatoire, verifie cote serveur. */
function motifObligatoire(
  formData: FormData,
  champ: string,
  libelleMotif: string,
): string {
  const motif = texteOuNull(formData.get(champ));
  if (motif === null || motif.length < MOTIF_MINIMUM) {
    throw validation(
      `${libelleMotif} : un commentaire ecrit d'au moins ${MOTIF_MINIMUM} caracteres est obligatoire.`,
      { [champ]: `Au moins ${MOTIF_MINIMUM} caracteres.` },
    );
  }
  return motif;
}

/**
 * Une decision qui n'accepte pas la marchandise releve du droit « decision
 * qualite » : le simple droit de saisie du controle ne suffit pas.
 */
async function utilisateurPourDecision(decision: QualityDecision) {
  const utilisateur = await exigerPermission(PERMISSIONS.QUALITE_CONTROLER);
  if (
    decision !== "ACCEPTE" &&
    !utilisateur.permissions.includes(PERMISSIONS.QUALITE_DECIDER)
  ) {
    throw validation(
      `La decision « ${libelle(LIBELLES_DECISION_QUALITE, decision)} » exige la permission « decision qualite ».`,
    );
  }
  return utilisateur;
}

/**
 * Mesures saisies pour les points de controle d'un plan.
 * Un point laisse vide n'est pas transmis : aucune valeur n'est inventee, et le
 * service applique alors les tolerances declarees au plan.
 */
function lireMesures(formData: FormData): NonNullable<ControleReceptionInput["mesures"]> {
  const mesures: NonNullable<ControleReceptionInput["mesures"]> = [];

  for (const [cle, valeur] of formData.entries()) {
    const correspondance = /^mesure_(\d+)_valeur$/.exec(cle);
    if (correspondance === null) continue;

    const checkpointId = Number.parseInt(correspondance[1], 10);
    if (texteOuNull(valeur) === null) continue;

    mesures.push({
      checkpointId,
      measuredValue: decimalOuNull(valeur),
      comment: texteOuNull(formData.get(`mesure_${checkpointId}_commentaire`)),
    });
  }

  return mesures;
}

// -----------------------------------------------------------------------------
// Controle de reception fournisseur
// -----------------------------------------------------------------------------

export async function actionControlerReception(formData: FormData): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "Le controle de reception a ete enregistre.",
    async () => {
      const ligneReceptionId = lireIdentifiant(
        formData,
        "ligneReceptionId",
        "La ligne de reception",
      );
      const quantiteControlee = decimalObligatoire(
        formData.get("quantiteControlee"),
        "Quantite controlee",
      );
      const quantiteConforme = decimalObligatoire(
        formData.get("quantiteConforme"),
        "Quantite conforme",
      );
      const quantiteRejetee = decimalOuNull(formData.get("quantiteRejetee")) ?? "0";
      const decision = choixObligatoire<QualityDecision>(
        formData,
        "decision",
        LIBELLES_DECISION_QUALITE,
        "Decision qualite",
      );
      const commentaire = texteOuNull(formData.get("commentaire"));
      const mesures = lireMesures(formData);

      const utilisateur = await utilisateurPourDecision(decision);

      // Une decision qui n'accepte pas la marchandise doit etre motivee : le
      // motif suit la marchandise et la non-conformite ouverte par le service.
      if (
        decision !== "ACCEPTE" &&
        (commentaire === null || commentaire.length < MOTIF_MINIMUM)
      ) {
        throw validation(
          `La decision « ${libelle(LIBELLES_DECISION_QUALITE, decision)} » exige un commentaire ecrit d'au moins ${MOTIF_MINIMUM} caracteres.`,
          { commentaire: `Au moins ${MOTIF_MINIMUM} caracteres.` },
        );
      }

      const resultat = await controlerReception({
        goodsReceiptLineId: ligneReceptionId,
        quantityChecked: quantiteControlee,
        quantityConform: quantiteConforme,
        quantityRejected: quantiteRejetee,
        decision,
        mesures,
        commentaire,
        checkedById: utilisateur.employeeId ?? null,
        acteur: acteurDe(utilisateur),
      });

      rafraichirStockEtProduction();
      return {
        numero: resultat.numero,
        destination: resultat.destination,
        decision: resultat.decision,
      };
    },
  );
}

// -----------------------------------------------------------------------------
// Controle en production
// -----------------------------------------------------------------------------

export async function actionControlerProduction(formData: FormData): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "Le controle de production a ete enregistre.",
    async () => {
      const operationId = lireIdentifiant(
        formData,
        "operationFabricationId",
        "L'operation de fabrication",
      );
      const quantiteControlee = decimalObligatoire(
        formData.get("quantiteControlee"),
        "Quantite controlee",
      );
      const quantiteConforme = decimalObligatoire(
        formData.get("quantiteConforme"),
        "Quantite conforme",
      );
      const quantiteRejetee = decimalOuNull(formData.get("quantiteRejetee")) ?? "0";
      const decision = choixObligatoire<QualityDecision>(
        formData,
        "decision",
        LIBELLES_DECISION_QUALITE,
        "Decision qualite",
      );
      const commentaire = texteOuNull(formData.get("commentaire"));
      const mesures = lireMesures(formData);

      const utilisateur = await utilisateurPourDecision(decision);

      if (
        decision !== "ACCEPTE" &&
        (commentaire === null || commentaire.length < MOTIF_MINIMUM)
      ) {
        throw validation(
          `La decision « ${libelle(LIBELLES_DECISION_QUALITE, decision)} » exige un commentaire ecrit d'au moins ${MOTIF_MINIMUM} caracteres.`,
          { commentaire: `Au moins ${MOTIF_MINIMUM} caracteres.` },
        );
      }

      const resultat = await controlerProduction({
        workOrderOperationId: operationId,
        quantityChecked: quantiteControlee,
        quantityConform: quantiteConforme,
        quantityRejected: quantiteRejetee,
        decision,
        mesures,
        commentaire,
        checkedById: utilisateur.employeeId ?? null,
        acteur: acteurDe(utilisateur),
      });

      rafraichirStockEtProduction();
      return {
        numero: resultat.numero,
        destination: resultat.destination,
        decision: resultat.decision,
      };
    },
  );
}

// -----------------------------------------------------------------------------
// Liberation qualite des marchandises en attente
// -----------------------------------------------------------------------------

/**
 * Liberation d'une marchandise bloquee.
 *
 * Deux situations distinctes, jamais confondues :
 *  - un lot issu d'une reception fournisseur : le service de controle de
 *    reception deplace lui-meme les quantites (libre, rebut, quarantaine) ;
 *  - un produit fini issu d'un ordre de fabrication : `libererProduitFini`
 *    enregistre le controle et fait entrer la quantite liberee en stock libre.
 *
 * La quantite rejetee declaree est mise au rebut par le grand livre de stock.
 * L'ordre est volontaire : liberation d'abord, rebut ensuite. Si le rebut
 * echoue, la quantite rejetee reste en quarantaine, c'est-a-dire indisponible :
 * c'est l'etat le moins dangereux.
 */
export async function actionLibererArticle(formData: FormData): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La liberation qualite a ete enregistree.",
    async () => {
      const utilisateur = await exigerPermission(PERMISSIONS.QUALITE_LIBERER);
      const acteur = acteurDe(utilisateur);

      const origine = choixObligatoire<"PRODUCTION" | "RECEPTION">(
        formData,
        "origine",
        { PRODUCTION: "Production", RECEPTION: "Reception fournisseur" },
        "Origine de la marchandise",
      );
      const decision = choixObligatoire<QualityDecision>(
        formData,
        "decision",
        LIBELLES_DECISION_QUALITE,
        "Decision qualite",
      );
      const quantiteConforme = D.of(
        decimalObligatoire(formData.get("quantiteConforme"), "Quantite conforme"),
      );
      const quantiteRejetee = D.of(decimalOuNull(formData.get("quantiteRejetee")) ?? "0");
      const commentaire = motifObligatoire(formData, "commentaire", "La liberation qualite");

      if (D.lt(quantiteConforme, 0) || D.lt(quantiteRejetee, 0)) {
        throw validation("Les quantites declarees ne peuvent pas etre negatives.");
      }
      if (D.isZero(D.add(quantiteConforme, quantiteRejetee))) {
        throw validation(
          "Indiquez au moins une quantite conforme ou rejetee : la liberation ne peut pas etre vide.",
        );
      }

      if (origine === "RECEPTION") {
        const ligneReceptionId = lireIdentifiant(
          formData,
          "ligneReceptionId",
          "La ligne de reception",
        );
        // Le service refuse lui-meme toute liberation qui ne porterait pas sur
        // de la marchandise reellement recue et mise en quarantaine.
        const resultat = await controlerReception({
          goodsReceiptLineId: ligneReceptionId,
          quantityChecked: decimalObligatoire(
            formData.get("quantiteControlee"),
            "Quantite controlee",
          ),
          quantityConform: quantiteConforme,
          quantityRejected: quantiteRejetee,
          decision,
          commentaire,
          checkedById: utilisateur.employeeId ?? null,
          acteur,
        });

        rafraichirStockEtProduction();
        return {
          numero: resultat.numero,
          destination: resultat.destination,
          quantiteLiberee: D.toFixed(resultat.quantiteLiberee, 6),
          quantiteRejetee: D.toFixed(resultat.quantiteRejetee, 6),
        };
      }

      // Liberation d'un produit fini : lorsqu'il n'y a rien a liberer, c'est la
      // quantite rejetee qui porte la non-conformite ouverte par le service.
      const ordreId = lireIdentifiant(formData, "ordreId", "L'ordre de fabrication");
      const depotDemande = entierOu(formData.get("depotId"));
      const lotDemande = entierOu(formData.get("lotId"));

      const ordre = await prisma.workOrder.findUnique({
        where: { id: ordreId },
        select: {
          number: true,
          itemId: true,
          targetWarehouseId: true,
          qualityReleasedAt: true,
          lots: { select: { id: true, warehouseId: true }, orderBy: { id: "asc" }, take: 1 },
        },
      });
      if (!ordre) throw nonTrouve("L'ordre de fabrication");
      if (ordre.qualityReleasedAt) {
        throw conflit(
          `L'ordre ${ordre.number} a deja ete libere par la qualite : une nouvelle liberation est impossible.`,
        );
      }

      const depotId =
        depotDemande ?? ordre.targetWarehouseId ?? ordre.lots[0]?.warehouseId ?? null;
      if (depotId === null) {
        throw etatInvalide(
          "Aucun depot n'est defini pour cette marchandise : la liberation est impossible.",
        );
      }
      const lotId = lotDemande ?? ordre.lots[0]?.id ?? null;

      if (decision === "REJETE" && D.gt(quantiteConforme, 0)) {
        throw validation(
          "Une decision de rejet ne peut pas liberer de quantite conforme : declarez la quantite rejetee.",
        );
      }

      // Verification prealable, en lecture seule, de la quantite reellement
      // presente en quarantaine : elle evite une liberation suivie d'un rebut
      // impossible.
      if (D.gt(quantiteRejetee, 0)) {
        const solde = await prisma.stockBalance.aggregate({
          where: { itemId: ordre.itemId, warehouseId: depotId, lotId, status: "QUARANTAINE" },
          _sum: { quantityPhysical: true },
        });
        const enQuarantaine = D.of(solde._sum.quantityPhysical ?? 0);
        if (D.lt(enQuarantaine, quantiteRejetee)) {
          throw etatInvalide(
            `La quantite rejetee (${D.toFixed(quantiteRejetee, 3)}) depasse la quantite presente en quarantaine (${D.toFixed(enQuarantaine, 3)}) pour cet article dans ce depot.`,
          );
        }
      }

      const resultat = await libererProduitFini({
        workOrderId: ordreId,
        quantiteLiberee: decision === "REJETE" ? quantiteRejetee : quantiteConforme,
        depotSourceId: depotId,
        lotId,
        decision,
        commentaire,
        checkedById: utilisateur.employeeId ?? null,
        acteur,
      });

      if (D.gt(quantiteRejetee, 0)) {
        await prisma.$transaction(
          (tx) =>
            changerStatutStock(tx, {
              itemId: ordre.itemId,
              warehouseId: depotId,
              lotId,
              quantity: quantiteRejetee,
              de: "QUARANTAINE",
              vers: "REBUT",
              type: "REBUT",
              comment: `Rebut de ${D.toFixed(quantiteRejetee, 3)} declare lors de la liberation qualite ${resultat.numero}`,
              reason: commentaire,
              documentType: "CONTROLE_QUALITE",
              documentId: resultat.numero,
              acteur,
            }),
        );
      }

      rafraichirStockEtProduction();
      return {
        numero: resultat.numero,
        decision: resultat.decision,
        quantiteLiberee: D.toFixed(resultat.quantiteLiberee, 6),
        quantiteRejetee: D.toFixed(quantiteRejetee, 6),
      };
    },
  );
}

// -----------------------------------------------------------------------------
// Non-conformites
// -----------------------------------------------------------------------------

export async function actionCreerNonConformite(formData: FormData): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La non-conformite a ete ouverte.",
    async () => {
      const utilisateur = await exigerPermission(PERMISSIONS.QUALITE_NONCONFORMITE_GERER);

      const source = choixObligatoire<NonConformitySource>(
        formData,
        "source",
        LIBELLES_SOURCE_NON_CONFORMITE,
        "Origine de la non-conformite",
      );
      const description = texteObligatoire(formData.get("description"), "Description");
      const quantite = decimalObligatoire(formData.get("quantite"), "Quantite concernee");
      const itemId = entierOu(formData.get("itemId"));
      const workOrderId = entierOu(formData.get("workOrderId"));
      const thirdPartyId = entierOu(formData.get("thirdPartyId"));
      const assignedToId = entierOu(formData.get("assignedToId"));
      const coutImpact = decimalOuNull(formData.get("coutImpact")) ?? "0";

      if (D.lte(quantite, 0)) {
        throw validation("La quantite concernee doit etre strictement positive.", {
          quantite: "Quantite strictement positive.",
        });
      }
      // Un retour client doit designer le client concerne : sans tiers, la
      // fiche ne serait rattachable a aucune reclamation.
      if (source === "CLIENT" && thirdPartyId === null) {
        throw validation(
          "Une non-conformite d'origine client doit designer le tiers concerne.",
          { thirdPartyId: "Tiers obligatoire." },
        );
      }

      // Le detecteur est l'utilisateur connecte lorsqu'il est rattache a un
      // employe : la tracabilite ne repose jamais sur une saisie libre.
      const detectedById = utilisateur.employeeId ?? null;

      const identifiant = await creerNonConformite(
        {
          source,
          description,
          quantite: D.of(quantite),
          itemId,
          workOrderId,
          thirdPartyId,
          detectedById,
          assignedToId,
          coutImpact,
        },
        acteurDe(utilisateur),
      );

      rafraichirQualite();
      return { nonConformiteId: identifiant };
    },
  );
}

/**
 * Mise en analyse d'une non-conformite.
 *
 * Le service qualite n'expose pas de transition vers ce seul statut : l'ecriture
 * est donc limitee ici au statut et au responsable d'analyse, et reste
 * integralement journalisee. Aucune quantite, aucun cout et aucun stock ne sont
 * touches par ce changement d'etape.
 */
export async function actionMettreEnAnalyse(formData: FormData): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La non-conformite a ete placee en analyse.",
    async () => {
      const utilisateur = await exigerPermission(PERMISSIONS.QUALITE_NONCONFORMITE_GERER);
      const nonConformiteId = lireIdentifiant(
        formData,
        "nonConformiteId",
        "La non-conformite",
      );
      const commentaire = motifObligatoire(formData, "commentaire", "La mise en analyse");
      const assignedToId = entierOu(formData.get("assignedToId"));

      const nonConformite = await prisma.nonConformity.findUnique({
        where: { id: nonConformiteId },
        select: { id: true, status: true, assignedToId: true },
      });
      if (!nonConformite) throw nonTrouve("La non-conformite");
      if (nonConformite.status === "CLOTUREE") {
        throw conflit("Cette non-conformite est cloturee : elle ne peut plus etre modifiee.");
      }
      if (nonConformite.status === "REJETEE") {
        throw conflit("Cette non-conformite est rejetee : elle ne peut plus repasser en analyse.");
      }
      if (nonConformite.status === "EN_ANALYSE") {
        throw conflit("Cette non-conformite est deja en analyse.");
      }

      await prisma.$transaction(
        async (tx) => {
          await tx.nonConformity.update({
            where: { id: nonConformiteId },
            data: { status: "EN_ANALYSE", assignedToId: assignedToId ?? nonConformite.assignedToId },
          });

          await enregistrerAudit(
            {
              action: ACTIONS_AUDIT.QUALITE,
              module: MODULES_AUDIT.QUALITE,
              entity: "NonConformity",
              entityId: nonConformiteId,
              userId: utilisateur.id,
              userEmail: utilisateur.email,
              oldValue: {
                statut: nonConformite.status,
                assigneA: nonConformite.assignedToId,
              },
              newValue: {
                statut: "EN_ANALYSE",
                assigneA: assignedToId ?? nonConformite.assignedToId,
              },
              comment: commentaire,
            },
            tx,
          );
        },
        { timeout: 30_000 },
      );

      rafraichirQualite();
      return { nonConformiteId };
    },
  );
}

/**
 * Statue sur une non-conformite : cause racine, action corrective et decision
 * qualite. Le service enregistre lui-meme le changement de statut et l'audit ;
 * le commentaire ecrit exige par l'interface lui est joint.
 */
export async function actionStatuerNonConformite(formData: FormData): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La decision qualite a ete enregistree sur la non-conformite.",
    async () => {
      const utilisateur = await exigerPermission(PERMISSIONS.QUALITE_NONCONFORMITE_GERER);
      const nonConformiteId = lireIdentifiant(
        formData,
        "nonConformiteId",
        "La non-conformite",
      );
      const decision = choixObligatoire<QualityDecision>(
        formData,
        "decision",
        LIBELLES_DECISION_QUALITE,
        "Decision qualite",
      );
      const commentaire = motifObligatoire(
        formData,
        "commentaire",
        "La decision sur la non-conformite",
      );
      const rootCause = texteOuNull(formData.get("rootCause"));
      const correctiveAction = texteOuNull(formData.get("correctiveAction"));
      const coutImpact = decimalOuNull(formData.get("coutImpact"));
      const assignedToId = entierOu(formData.get("assignedToId"));

      if (rootCause === null || rootCause.length < MOTIF_MINIMUM) {
        throw validation(
          `La cause racine doit etre redigee (au moins ${MOTIF_MINIMUM} caracteres) : une decision sans analyse n'est pas tracable.`,
          { rootCause: `Au moins ${MOTIF_MINIMUM} caracteres.` },
        );
      }
      if (correctiveAction === null || correctiveAction.length < MOTIF_MINIMUM) {
        throw validation(
          `L'action corrective doit etre redigee (au moins ${MOTIF_MINIMUM} caracteres).`,
          { correctiveAction: `Au moins ${MOTIF_MINIMUM} caracteres.` },
        );
      }

      const existante = await prisma.nonConformity.findUnique({
        where: { id: nonConformiteId },
        select: { id: true, number: true, status: true },
      });
      if (!existante) throw nonTrouve("La non-conformite");
      if (existante.status === "CLOTUREE") {
        throw conflit("Cette non-conformite est cloturee : elle ne peut plus etre modifiee.");
      }
      if (existante.status === "REJETEE") {
        throw conflit(
          "Cette non-conformite a ete rejetee : elle ne peut plus recevoir de decision qualite.",
        );
      }

      await traiterNonConformite(
        {
          nonConformityId: nonConformiteId,
          decision,
          rootCause,
          correctiveAction,
          costImpact: coutImpact ?? undefined,
          assignedToId,
        },
        acteurDe(utilisateur),
      );

      // Le service ne transporte pas de commentaire libre : le motif exige par
      // l'interface est donc journalise ici, a la suite de son ecriture.
      await enregistrerAudit({
        action: ACTIONS_AUDIT.QUALITE,
        module: MODULES_AUDIT.QUALITE,
        entity: "NonConformity",
        entityId: nonConformiteId,
        userId: utilisateur.id,
        userEmail: utilisateur.email,
        newValue: { decision, causeRacine: rootCause, actionCorrective: correctiveAction },
        comment: commentaire,
      });

      rafraichirQualite();
      return { nonConformiteId };
    },
  );
}

/**
 * Mise en reprise : la quantite reellement engagee dans la reprise est
 * enregistree sur la fiche. L'ancienne valeur est conservee dans le journal
 * d'audit : rien n'est efface.
 */
export async function actionMettreEnReprise(formData: FormData): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La non-conformite a ete placee en reprise.",
    async () => {
      const utilisateur = await exigerPermission(PERMISSIONS.QUALITE_NONCONFORMITE_GERER);
      const nonConformiteId = lireIdentifiant(
        formData,
        "nonConformiteId",
        "La non-conformite",
      );
      const commentaire = motifObligatoire(formData, "commentaire", "La mise en reprise");
      const quantiteConcernee = D.roundQuantity(
        decimalObligatoire(
          formData.get("quantiteConcernee"),
          "Quantite concernee par la reprise",
        ),
      );

      if (D.lte(quantiteConcernee, 0)) {
        throw validation("La quantite mise en reprise doit etre strictement positive.", {
          quantiteConcernee: "Quantite strictement positive.",
        });
      }

      const nonConformite = await prisma.nonConformity.findUnique({
        where: { id: nonConformiteId },
      });
      if (!nonConformite) throw nonTrouve("La non-conformite");
      if (nonConformite.status === "CLOTUREE") {
        throw conflit("Cette non-conformite est cloturee : aucune reprise ne peut y etre engagee.");
      }
      if (nonConformite.status === "REJETEE") {
        throw conflit("Cette non-conformite est rejetee : aucune reprise ne peut y etre engagee.");
      }

      await prisma.$transaction(
        async (tx) => {
          await tx.nonConformity.update({
            where: { id: nonConformiteId },
            data: { status: "EN_REPRISE", quantity: quantiteConcernee },
          });

          await enregistrerAudit(
            {
              action: ACTIONS_AUDIT.REPRISE,
              module: MODULES_AUDIT.QUALITE,
              entity: "NonConformity",
              entityId: nonConformiteId,
              userId: utilisateur.id,
              userEmail: utilisateur.email,
              oldValue: {
                statut: nonConformite.status,
                quantite: D.toFixed(nonConformite.quantity, 6),
              },
              newValue: {
                statut: "EN_REPRISE",
                quantite: D.toFixed(quantiteConcernee, 6),
              },
              comment: commentaire,
            },
            tx,
          );
        },
        { timeout: 30_000 },
      );

      rafraichirQualite();
      return { nonConformiteId };
    },
  );
}

/**
 * Rejet d'une non-conformite : le cas est clos sans suite. Le rebut physique
 * eventuel releve d'un mouvement de stock et n'est jamais deduit ici.
 */
export async function actionRejeterNonConformite(formData: FormData): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La non-conformite a ete rejetee : le motif est conserve dans l'historique.",
    async () => {
      const utilisateur = await exigerPermission(PERMISSIONS.QUALITE_NONCONFORMITE_GERER);
      const nonConformiteId = lireIdentifiant(
        formData,
        "nonConformiteId",
        "La non-conformite",
      );
      const commentaire = motifObligatoire(formData, "commentaire", "Le rejet");
      const quantiteConcernee = D.roundQuantity(
        decimalObligatoire(
          formData.get("quantiteConcernee"),
          "Quantite concernee par le rejet",
        ),
      );

      if (D.lte(quantiteConcernee, 0)) {
        throw validation("La quantite rejetee doit etre strictement positive.", {
          quantiteConcernee: "Quantite strictement positive.",
        });
      }

      const nonConformite = await prisma.nonConformity.findUnique({
        where: { id: nonConformiteId },
      });
      if (!nonConformite) throw nonTrouve("La non-conformite");
      if (nonConformite.status === "CLOTUREE") {
        throw conflit("Cette non-conformite est cloturee : elle ne peut plus etre rejetee.");
      }
      if (nonConformite.status === "REJETEE") {
        throw conflit("Cette non-conformite est deja rejetee.");
      }

      await prisma.$transaction(
        async (tx) => {
          await tx.nonConformity.update({
            where: { id: nonConformiteId },
            data: {
              status: "REJETEE",
              quantity: quantiteConcernee,
              resolvedAt: nonConformite.resolvedAt ?? new Date(),
            },
          });

          await enregistrerAudit(
            {
              action: ACTIONS_AUDIT.VALIDATION,
              module: MODULES_AUDIT.QUALITE,
              entity: "NonConformity",
              entityId: nonConformiteId,
              userId: utilisateur.id,
              userEmail: utilisateur.email,
              oldValue: {
                statut: nonConformite.status,
                quantite: D.toFixed(nonConformite.quantity, 6),
              },
              newValue: {
                statut: "REJETEE",
                quantite: D.toFixed(quantiteConcernee, 6),
              },
              comment: commentaire,
            },
            tx,
          );
        },
        { timeout: 30_000 },
      );

      rafraichirQualite();
      return { nonConformiteId };
    },
  );
}

export async function actionCloturerNonConformite(formData: FormData): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "La non-conformite a ete cloturee.",
    async () => {
      const utilisateur = await exigerPermission(PERMISSIONS.QUALITE_NONCONFORMITE_GERER);
      const nonConformiteId = lireIdentifiant(
        formData,
        "nonConformiteId",
        "La non-conformite",
      );
      const commentaire = motifObligatoire(formData, "commentaire", "La cloture");

      await cloturerNonConformite(nonConformiteId, commentaire, acteurDe(utilisateur));

      rafraichirQualite();
      return { nonConformiteId };
    },
  );
}

// -----------------------------------------------------------------------------
// Plans de controle et points de controle
// -----------------------------------------------------------------------------

export async function actionCreerPlanControle(formData: FormData): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "Le plan de controle a ete cree.",
    async () => {
      const utilisateur = await exigerPermission(PERMISSIONS.QUALITE_PLAN_GERER);

      const code = texteObligatoire(formData.get("code"), "Code du plan");
      const label = texteObligatoire(formData.get("label"), "Libelle du plan");
      const itemId = entierOu(formData.get("itemId"));
      const operationId = entierOu(formData.get("operationId"));
      const description = texteOuNull(formData.get("description"));
      const isMandatoryForRelease = booleen(formData.get("isMandatoryForRelease"));

      // Un plan doit viser quelque chose : sans article ni operation, il ne
      // pourrait jamais s'appliquer a un controle reel.
      if (itemId === null && operationId === null) {
        throw validation(
          "Un plan de controle doit viser soit un article, soit une operation.",
          {
            itemId: "Selectionnez un article ou une operation.",
            operationId: "Selectionnez une operation ou un article.",
          },
        );
      }

      const resultat = await creerPlanControle(
        { code, label, itemId, operationId, isMandatoryForRelease, description },
        acteurDe(utilisateur),
      );

      rafraichirQualite();
      return { planId: resultat.planId, points: resultat.points };
    },
  );
}

export async function actionAjouterPointDeControle(formData: FormData): Promise<ResultatAction> {
  return executer<Record<string, unknown>>(
    "Le point de controle a ete ajoute au plan.",
    async () => {
      const utilisateur = await exigerPermission(PERMISSIONS.QUALITE_PLAN_GERER);
      const planId = lireIdentifiant(formData, "planId", "Le plan de controle");
      const code = texteObligatoire(formData.get("code"), "Code du point de controle");
      const label = texteObligatoire(formData.get("label"), "Libelle du point de controle");
      const checkType = texteObligatoire(formData.get("checkType"), "Type de controle");

      const pointId = await ajouterPointDeControle(
        planId,
        {
          code,
          label,
          checkType,
          sequence: entierOu(formData.get("sequence")) ?? undefined,
          expectedValue: texteOuNull(formData.get("expectedValue")),
          toleranceMin: decimalOuNull(formData.get("toleranceMin")),
          toleranceMax: decimalOuNull(formData.get("toleranceMax")),
          unitCode: texteOuNull(formData.get("unitCode")),
          isMandatory: booleen(formData.get("isMandatory")),
          instructions: texteOuNull(formData.get("instructions")),
        },
        acteurDe(utilisateur),
      );

      rafraichirQualite();
      return { pointId };
    },
  );
}
