import type {
  NonConformitySource,
  NonConformityStatus,
  Prisma,
  QualityCheckResult,
  QualityDecision,
} from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D } from "@/lib/decimal";
import { conflit, etatInvalide, nonTrouve, validation } from "@/lib/errors";
import { prochainNumero, SEQUENCES } from "@/lib/numbering";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import { lireParametreBooleen, CLE_PARAMETRE } from "@/lib/settings";
import { changerStatutStock, enregistrerMouvement, type ActeurStock } from "@/lib/stock/service";

/**
 * Qualite integree aux achats, a la production et aux ventes.
 *
 * Regle centrale : un produit fini ne devient disponible a la vente qu'apres
 * liberation explicite par la qualite lorsque cette exigence est active.
 * Aucune sortie de quarantaine ne se fait sans decision tracee.
 */

export interface ActeurQualite extends ActeurStock {}

// -----------------------------------------------------------------------------
// Plans de controle
// -----------------------------------------------------------------------------

export interface PointDeControleInput {
  code: string;
  label: string;
  checkType: string;
  sequence?: number;
  expectedValue?: string | null;
  toleranceMin?: Prisma.Decimal | string | number | null;
  toleranceMax?: Prisma.Decimal | string | number | null;
  unitCode?: string | null;
  isMandatory?: boolean;
  instructions?: string | null;
}

export async function creerPlanControle(
  entree: {
    code: string;
    label: string;
    itemId?: number | null;
    operationId?: number | null;
    isMandatoryForRelease?: boolean;
    description?: string | null;
    points?: PointDeControleInput[];
  },
  acteur: ActeurQualite,
): Promise<{ planId: number; points: number }> {
  if (!entree.code.trim()) throw validation("Le code du plan de controle est obligatoire.");

  return prisma.$transaction(async (tx) => {
    const existant = await tx.qualityPlan.findUnique({ where: { code: entree.code } });
    if (existant) {
      throw conflit(`Le plan de controle « ${entree.code} » existe deja.`);
    }

    const plan = await tx.qualityPlan.create({
      data: {
        code: entree.code,
        label: entree.label,
        itemId: entree.itemId ?? null,
        operationId: entree.operationId ?? null,
        isMandatoryForRelease: entree.isMandatoryForRelease ?? false,
        description: entree.description ?? null,
        isActive: true,
      },
    });

    const points = entree.points ?? [];

    for (const [index, point] of points.entries()) {
      await tx.qualityCheckpoint.create({
        data: {
          planId: plan.id,
          code: point.code,
          label: point.label,
          checkType: point.checkType,
          sequence: point.sequence ?? index + 1,
          expectedValue: point.expectedValue ?? null,
          toleranceMin:
            point.toleranceMin === null || point.toleranceMin === undefined
              ? null
              : D.round(point.toleranceMin, 6),
          toleranceMax:
            point.toleranceMax === null || point.toleranceMax === undefined
              ? null
              : D.round(point.toleranceMax, 6),
          unitCode: point.unitCode ?? null,
          isMandatory: point.isMandatory ?? true,
          instructions: point.instructions ?? null,
        },
      });
    }

    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.CREATION,
        module: MODULES_AUDIT.QUALITE,
        entity: "QualityPlan",
        entityId: plan.id,
        userId: acteur.id,
        userEmail: acteur.email,
        newValue: { code: entree.code, label: entree.label, points: points.length },
      },
      tx,
    );

    return { planId: plan.id, points: points.length };
  }, { timeout: 30_000 });
}

export async function ajouterPointDeControle(
  planId: number,
  point: PointDeControleInput,
  acteur: ActeurQualite,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const plan = await tx.qualityPlan.findUnique({ where: { id: planId } });
    if (!plan) throw nonTrouve("Le plan de controle");

    const existant = await tx.qualityCheckpoint.findFirst({
      where: { planId, code: point.code },
    });
    if (existant) {
      throw conflit(
        `Le point de controle « ${point.code} » existe deja sur le plan ${plan.code}.`,
      );
    }

    const cree = await tx.qualityCheckpoint.create({
      data: {
        planId,
        code: point.code,
        label: point.label,
        checkType: point.checkType,
        sequence: point.sequence ?? 0,
        expectedValue: point.expectedValue ?? null,
        toleranceMin:
          point.toleranceMin === null || point.toleranceMin === undefined
            ? null
            : D.round(point.toleranceMin, 6),
        toleranceMax:
          point.toleranceMax === null || point.toleranceMax === undefined
            ? null
            : D.round(point.toleranceMax, 6),
        unitCode: point.unitCode ?? null,
        isMandatory: point.isMandatory ?? true,
        instructions: point.instructions ?? null,
      },
    });

    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.CREATION,
        module: MODULES_AUDIT.QUALITE,
        entity: "QualityCheckpoint",
        entityId: cree.id,
        userId: acteur.id,
        userEmail: acteur.email,
        newValue: { plan: plan.code, code: point.code, label: point.label },
      },
      tx,
    );

    return cree.id;
  }, { timeout: 30_000 });
}

// -----------------------------------------------------------------------------
// Evaluation d'un point de controle
// -----------------------------------------------------------------------------

/**
 * Determine le resultat d'un controle a partir de la valeur mesuree et des
 * tolerances declarees. Aucun seuil n'est code en dur : ils viennent du plan.
 */
function evaluerMesure(
  mesure: Prisma.Decimal | null,
  toleranceMin: Prisma.Decimal | null,
  toleranceMax: Prisma.Decimal | null,
): QualityCheckResult {
  if (mesure === null) return "NON_APPLICABLE";
  if (toleranceMin !== null && D.lt(mesure, toleranceMin)) return "NON_CONFORME";
  if (toleranceMax !== null && D.gt(mesure, toleranceMax)) return "NON_CONFORME";
  return "CONFORME";
}

// -----------------------------------------------------------------------------
// Controle de reception fournisseur
// -----------------------------------------------------------------------------

export interface ControleReceptionInput {
  goodsReceiptLineId: number;
  quantityChecked: Prisma.Decimal | string | number;
  quantityConform: Prisma.Decimal | string | number;
  quantityRejected?: Prisma.Decimal | string | number;
  decision: QualityDecision;
  mesures?: {
    checkpointId?: number | null;
    code?: string | null;
    measuredValue?: Prisma.Decimal | string | number | null;
    result?: QualityCheckResult;
    comment?: string | null;
    photoUrl?: string | null;
  }[];
  commentaire?: string | null;
  checkedById?: number | null;
  acteur: ActeurQualite;
}

export interface ResultatControle {
  controleIds: number[];
  numero: string;
  decision: QualityDecision;
  quantiteLiberee: Prisma.Decimal;
  quantiteRejetee: Prisma.Decimal;
  destination: string;
}

const LIBELLES_DECISION: Record<QualityDecision, string> = {
  ACCEPTE: "Accepte",
  ACCEPTE_SOUS_RESERVE: "Accepte sous reserve",
  QUARANTAINE: "Mis en quarantaine",
  REJETE: "Rejete",
};

/**
 * Controle a la reception. La quantite acceptee passe en stock libre,
 * la quantite rejetee part en rebut, le reste demeure en quarantaine.
 * Aucune quantite n'est deplacee sans decision explicite.
 */
export async function controlerReception(
  entree: ControleReceptionInput,
): Promise<ResultatControle> {
  const controlee = D.of(entree.quantityChecked);
  const conforme = D.of(entree.quantityConform);
  const rejetee = D.of(entree.quantityRejected ?? 0);

  if (D.lte(controlee, 0)) {
    throw validation("La quantite controlee doit etre strictement positive.");
  }
  if (D.gt(D.add(conforme, rejetee), controlee)) {
    throw validation(
      "La somme des quantites conformes et rejetees ne peut pas depasser la quantite controlee.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const ligne = await tx.goodsReceiptLine.findUnique({
      where: { id: entree.goodsReceiptLineId },
      include: {
        receipt: { select: { id: true, number: true, warehouseId: true } },
        item: { select: { id: true, code: true, label1: true } },
      },
    });
    if (!ligne) throw nonTrouve("La ligne de reception");

    if (ligne.receipt.warehouseId === null) {
      throw etatInvalide("La reception ne precise pas de depot de destination.");
    }

    // La ligne de reception identifie le lot par son numero : on le retrouve
    // pour deplacer precisement la quantite controlee.
    const lotId = ligne.lotNumber
      ? (
          await tx.stockLot.findUnique({
            where: {
              itemId_warehouseId_lotNumber: {
                itemId: ligne.itemId,
                warehouseId: ligne.receipt.warehouseId,
                lotNumber: ligne.lotNumber,
              },
            },
            select: { id: true },
          })
        )?.id ?? null
      : null;

    const numero = await prochainNumero(SEQUENCES.CONTROLE_QUALITE, tx);
    const maintenant = new Date();

    const controleIds: number[] = [];
    const mesures = entree.mesures ?? [];

    if (mesures.length === 0) {
      const controle = await tx.qualityCheck.create({
        data: {
          number: numero,
          itemId: ligne.itemId,
          goodsReceiptLineId: ligne.id,
          quantityChecked: D.roundQuantity(controlee),
          quantityConform: D.roundQuantity(conforme),
          quantityRejected: D.roundQuantity(rejetee),
          result: D.gt(rejetee, 0) ? "NON_CONFORME" : "CONFORME",
          decision: entree.decision,
          comment: entree.commentaire ?? null,
          checkedById: entree.checkedById ?? null,
          checkedAt: maintenant,
        },
      });
      controleIds.push(controle.id);
    } else {
      for (const mesure of mesures) {
        const point = mesure.checkpointId
          ? await tx.qualityCheckpoint.findUnique({ where: { id: mesure.checkpointId } })
          : mesure.code
            ? await tx.qualityCheckpoint.findFirst({ where: { code: mesure.code } })
            : null;

        const valeurMesuree =
          mesure.measuredValue === null || mesure.measuredValue === undefined
            ? null
            : D.round(mesure.measuredValue, 6);

        const resultat =
          mesure.result ??
          evaluerMesure(
            valeurMesuree,
            point?.toleranceMin ?? null,
            point?.toleranceMax ?? null,
          );

        const controle = await tx.qualityCheck.create({
          data: {
            number: mesures.length > 1 ? `${numero}-${controleIds.length + 1}` : numero,
            planId: point?.planId ?? null,
            checkpointId: point?.id ?? null,
            itemId: ligne.itemId,
            goodsReceiptLineId: ligne.id,
            quantityChecked: D.roundQuantity(controlee),
            quantityConform: D.roundQuantity(conforme),
            quantityRejected: D.roundQuantity(rejetee),
            measuredValue: valeurMesuree,
            result: resultat,
            decision: entree.decision,
            comment: mesure.comment ?? entree.commentaire ?? null,
            photoUrl: mesure.photoUrl ?? null,
            checkedById: entree.checkedById ?? null,
            checkedAt: maintenant,
          },
        });
        controleIds.push(controle.id);
      }
    }

    // Deplacement physique : quarantaine -> libre, rebut, ou maintien.
    let destination = "Quarantaine";

    if (D.gt(conforme, 0)) {
      await changerStatutStock(tx, {
        itemId: ligne.itemId,
        warehouseId: ligne.receipt.warehouseId,
        lotId,
        quantity: conforme,
        de: "QUARANTAINE",
        vers: "LIBRE",
        type: "LIBERATION_QUALITE",
        comment: `Liberation qualite apres controle ${numero} (${LIBELLES_DECISION[entree.decision]})`,
        reason: entree.commentaire ?? null,
        documentType: "CONTROLE_QUALITE",
        documentId: numero,
        acteur: entree.acteur,
      });
      destination = "Stock libre";
    }

    if (D.gt(rejetee, 0)) {
      await changerStatutStock(tx, {
        itemId: ligne.itemId,
        warehouseId: ligne.receipt.warehouseId,
        lotId,
        quantity: rejetee,
        de: "QUARANTAINE",
        vers: "REBUT",
        type: "REBUT",
        comment: `Rejet au controle qualite ${numero}`,
        reason: entree.commentaire ?? "Non-conformite constatee a la reception",
        documentType: "CONTROLE_QUALITE",
        documentId: numero,
        acteur: entree.acteur,
      });
      destination = D.gt(conforme, 0) ? "Stock libre et rebut" : "Rebut";
    }

    await tx.goodsReceiptLine.update({
      where: { id: ligne.id },
      data: {
        qualityStatus:
          entree.decision === "REJETE"
            ? "REBUT"
            : entree.decision === "QUARANTAINE"
              ? "QUARANTAINE"
              : "LIBRE",
        qualityDecision: entree.decision,
      },
    });

    if (entree.decision !== "ACCEPTE" && entree.decision !== "ACCEPTE_SOUS_RESERVE") {
      await creerNonConformiteInterne(tx, {
        source: "RECEPTION",
        itemId: ligne.itemId,
        quantite: D.gt(rejetee, 0) ? rejetee : conforme,
        description:
          entree.commentaire ??
          `Controle de reception ${numero} : decision « ${LIBELLES_DECISION[entree.decision]} ».`,
        detectedById: entree.checkedById ?? null,
        acteur: entree.acteur,
        thirdPartyId: null,
      });
    }

    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.QUALITE,
        module: MODULES_AUDIT.QUALITE,
        entity: "QualityCheck",
        entityId: controleIds[0] ?? null,
        userId: entree.acteur.id,
        userEmail: entree.acteur.email,
        newValue: {
          numero,
          reception: ligne.receipt.number,
          article: ligne.item.code,
          controlee: controlee.toFixed(6),
          conforme: conforme.toFixed(6),
          rejetee: rejetee.toFixed(6),
          decision: entree.decision,
          destination,
        },
        comment: entree.commentaire ?? null,
      },
      tx,
    );

    return {
      controleIds,
      numero,
      decision: entree.decision,
      quantiteLiberee: conforme,
      quantiteRejetee: rejetee,
      destination,
    };
  }, { timeout: 60_000 });
}

// -----------------------------------------------------------------------------
// Controle en production
// -----------------------------------------------------------------------------

export interface ControleProductionInput {
  workOrderOperationId: number;
  quantityChecked: Prisma.Decimal | string | number;
  quantityConform: Prisma.Decimal | string | number;
  quantityRejected?: Prisma.Decimal | string | number;
  decision: QualityDecision;
  mesures?: ControleReceptionInput["mesures"];
  commentaire?: string | null;
  photoUrl?: string | null;
  checkedById?: number | null;
  acteur: ActeurQualite;
}

export async function controlerProduction(
  entree: ControleProductionInput,
): Promise<ResultatControle> {
  const controlee = D.of(entree.quantityChecked);
  const conforme = D.of(entree.quantityConform);
  const rejetee = D.of(entree.quantityRejected ?? 0);

  if (D.lte(controlee, 0)) {
    throw validation("La quantite controlee doit etre strictement positive.");
  }

  return prisma.$transaction(async (tx) => {
    const operation = await tx.workOrderOperation.findUnique({
      where: { id: entree.workOrderOperationId },
      include: {
        operation: true,
        workOrder: { include: { item: { select: { id: true, code: true } } } },
      },
    });
    if (!operation) throw nonTrouve("L'operation de fabrication");

    const numero = await prochainNumero(SEQUENCES.CONTROLE_QUALITE, tx);
    const maintenant = new Date();
    const mesures = entree.mesures ?? [];
    const controleIds: number[] = [];

    const lotDeControles = mesures.length > 0 ? mesures : [{ result: undefined }];

    for (const [index, mesure] of lotDeControles.entries()) {
      const point = mesure.checkpointId
        ? await tx.qualityCheckpoint.findUnique({ where: { id: mesure.checkpointId } })
        : null;

      const valeurMesuree =
        "measuredValue" in mesure && mesure.measuredValue !== null && mesure.measuredValue !== undefined
          ? D.round(mesure.measuredValue, 6)
          : null;

      const controle = await tx.qualityCheck.create({
        data: {
          number: lotDeControles.length > 1 ? `${numero}-${index + 1}` : numero,
          planId: point?.planId ?? null,
          checkpointId: point?.id ?? null,
          itemId: operation.workOrder.itemId,
          workOrderId: operation.workOrderId,
          workOrderOperationId: operation.id,
          quantityChecked: D.roundQuantity(controlee),
          quantityConform: D.roundQuantity(conforme),
          quantityRejected: D.roundQuantity(rejetee),
          measuredValue: valeurMesuree,
          result:
            (mesure.result as QualityCheckResult | undefined) ??
            evaluerMesure(valeurMesuree, point?.toleranceMin ?? null, point?.toleranceMax ?? null),
          decision: entree.decision,
          comment: mesure.comment ?? entree.commentaire ?? null,
          photoUrl: mesure.photoUrl ?? entree.photoUrl ?? null,
          checkedById: entree.checkedById ?? null,
          checkedAt: maintenant,
        },
      });
      controleIds.push(controle.id);
    }

    await tx.workOrderOperation.update({
      where: { id: operation.id },
      data: { qualityStatus: entree.decision },
    });

    await tx.workOrder.update({
      where: { id: operation.workOrderId },
      data: {
        qualityStatus: entree.decision,
        status:
          entree.decision === "ACCEPTE" || entree.decision === "ACCEPTE_SOUS_RESERVE"
            ? operation.workOrder.status
            : "EN_CONTROLE_QUALITE",
      },
    });

    if (entree.decision === "QUARANTAINE" || entree.decision === "REJETE") {
      await creerNonConformiteInterne(tx, {
        source: "PRODUCTION",
        itemId: operation.workOrder.itemId,
        workOrderId: operation.workOrderId,
        quantite: D.gt(rejetee, 0) ? rejetee : conforme,
        description:
          entree.commentaire ??
          `Controle de production ${numero} sur l'operation ${operation.operation.label} : « ${LIBELLES_DECISION[entree.decision]} ».`,
        detectedById: entree.checkedById ?? null,
        acteur: entree.acteur,
      });
    }

    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.QUALITE,
        module: MODULES_AUDIT.QUALITE,
        entity: "QualityCheck",
        entityId: controleIds[0] ?? null,
        userId: entree.acteur.id,
        userEmail: entree.acteur.email,
        newValue: {
          numero,
          ordre: operation.workOrder.number,
          operation: operation.operation.code,
          controlee: controlee.toFixed(6),
          conforme: conforme.toFixed(6),
          rejetee: rejetee.toFixed(6),
          decision: entree.decision,
        },
        comment: entree.commentaire ?? null,
      },
      tx,
    );

    return {
      controleIds,
      numero,
      decision: entree.decision,
      quantiteLiberee: conforme,
      quantiteRejetee: rejetee,
      destination:
        entree.decision === "ACCEPTE" || entree.decision === "ACCEPTE_SOUS_RESERVE"
          ? "Poursuite de la production"
          : "Blocage et non-conformite ouverte",
    };
  }, { timeout: 60_000 });
}

// -----------------------------------------------------------------------------
// Liberation qualite d'un produit fini
// -----------------------------------------------------------------------------

export interface LiberationInput {
  workOrderId: number;
  quantiteLiberee: Prisma.Decimal | string | number;
  depotSourceId?: number | null;
  lotId?: number | null;
  decision?: QualityDecision;
  commentaire?: string | null;
  checkedById?: number | null;
  acteur: ActeurQualite;
}

/**
 * Liberation du produit fini : condition indispensable pour qu'il devienne
 * disponible a la vente lorsque le parametre correspondant est actif.
 */
export async function libererProduitFini(entree: LiberationInput): Promise<{
  numero: string;
  quantiteLiberee: Prisma.Decimal;
  decision: QualityDecision;
}> {
  const quantite = D.of(entree.quantiteLiberee);
  if (D.lte(quantite, 0)) {
    throw validation("La quantite a liberer doit etre strictement positive.");
  }

  const liberationObligatoire = await lireParametreBooleen(
    CLE_PARAMETRE.QUALITE_LIBERATION_OBLIGATOIRE,
    true,
  );

  return prisma.$transaction(async (tx) => {
    const ordre = await tx.workOrder.findUnique({
      where: { id: entree.workOrderId },
      include: {
        item: { select: { id: true, code: true, label1: true } },
        lots: true,
      },
    });
    if (!ordre) throw nonTrouve("L'ordre de fabrication");

    if (ordre.qualityReleasedAt) {
      throw conflit(
        `L'ordre ${ordre.number} a deja ete libere par la qualite le ${ordre.qualityReleasedAt.toLocaleDateString("fr-FR")}.`,
      );
    }

    if (D.lt(D.sub(ordre.quantityConform, ordre.quantityScrapped), quantite)) {
      throw etatInvalide(
        `La quantite a liberer (${D.toFixed(quantite, 3)}) depasse la quantite conforme produite (${D.toFixed(ordre.quantityConform, 3)}) sur l'ordre ${ordre.number}.`,
      );
    }

    const depotId =
      entree.depotSourceId ??
      ordre.targetWarehouseId ??
      ordre.lots[0]?.warehouseId ??
      null;

    if (!depotId) {
      throw etatInvalide(
        "Aucun depot de destination n'est defini pour liberer ce produit fini.",
      );
    }

    const numero = await prochainNumero(SEQUENCES.CONTROLE_QUALITE, tx);
    const decision: QualityDecision = entree.decision ?? "ACCEPTE";
    const maintenant = new Date();

    const controle = await tx.qualityCheck.create({
      data: {
        number: numero,
        itemId: ordre.itemId,
        workOrderId: ordre.id,
        quantityChecked: D.roundQuantity(quantite),
        quantityConform: decision === "REJETE" ? D.ZERO : D.roundQuantity(quantite),
        quantityRejected: decision === "REJETE" ? D.roundQuantity(quantite) : D.ZERO,
        result: decision === "REJETE" ? "NON_CONFORME" : "CONFORME",
        decision,
        comment:
          entree.commentaire ??
          `Liberation du produit fini ${ordre.item.code} issu de l'ordre ${ordre.number}.`,
        checkedById: entree.checkedById ?? null,
        checkedAt: maintenant,
      },
    });

    if (decision !== "REJETE") {
      // Le produit fini entre en stock libre : il devient vendable.
      await enregistrerMouvement(tx, {
        type: "PRODUCTION_PRODUIT_FINI",
        itemId: ordre.itemId,
        warehouseId: depotId,
        lotId: entree.lotId ?? ordre.lots[0]?.id ?? null,
        quantity: quantite,
        unitCode: null,
        workOrderId: ordre.id,
        documentType: "ORDRE_FABRICATION",
        documentId: String(ordre.id),
        documentNumber: ordre.number,
        comment: `Liberation qualite ${numero} : produit fini disponible a la vente`,
        reason: entree.commentaire ?? null,
        acteur: entree.acteur,
        sansAudit: true,
      });
    }

    await tx.workOrder.update({
      where: { id: ordre.id },
      data: {
        qualityStatus: decision,
        qualityReleasedAt: maintenant,
        qualityReleasedById: entree.acteur.id,
        status: decision === "REJETE" ? "EN_CONTROLE_QUALITE" : "TERMINE",
      },
    });

    if (decision === "REJETE") {
      await creerNonConformiteInterne(tx, {
        source: "PRODUCTION",
        itemId: ordre.itemId,
        workOrderId: ordre.id,
        quantite,
        description:
          entree.commentaire ??
          `Rejet du produit fini de l'ordre ${ordre.number} lors de la liberation ${numero}.`,
        detectedById: entree.checkedById ?? null,
        acteur: entree.acteur,
      });
    }

    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.QUALITE,
        module: MODULES_AUDIT.QUALITE,
        entity: "WorkOrder",
        entityId: ordre.id,
        userId: entree.acteur.id,
        userEmail: entree.acteur.email,
        oldValue: { libere: false },
        newValue: {
          numero,
          ordre: ordre.number,
          article: ordre.item.code,
          quantite: quantite.toFixed(6),
          decision,
          liberationObligatoire,
        },
        comment: entree.commentaire ?? null,
      },
      tx,
    );

    return {
      numero,
      quantiteLiberee: decision === "REJETE" ? D.ZERO : quantite,
      decision,
    };
  }, { timeout: 60_000 });
}

// -----------------------------------------------------------------------------
// Non-conformites
// -----------------------------------------------------------------------------

interface CreerNonConformiteInterneInput {
  source: NonConformitySource;
  description: string;
  quantite: Prisma.Decimal;
  itemId?: number | null;
  workOrderId?: number | null;
  thirdPartyId?: number | null;
  detectedById?: number | null;
  assignedToId?: number | null;
  coutImpact?: Prisma.Decimal | string | number;
  acteur: ActeurQualite;
}

async function creerNonConformiteInterne(
  tx: Db,
  entree: CreerNonConformiteInterneInput,
): Promise<number> {
  const numero = await prochainNumero(SEQUENCES.NON_CONFORMITE, tx);

  const nonConformite = await tx.nonConformity.create({
    data: {
      number: numero,
      source: entree.source,
      status: "OUVERTE",
      itemId: entree.itemId ?? null,
      workOrderId: entree.workOrderId ?? null,
      thirdPartyId: entree.thirdPartyId ?? null,
      quantity: D.roundQuantity(entree.quantite),
      description: entree.description,
      detectedById: entree.detectedById ?? null,
      assignedToId: entree.assignedToId ?? null,
      costImpact: D.roundAmount(entree.coutImpact ?? 0),
      detectedAt: new Date(),
    },
  });

  await enregistrerAudit(
    {
      action: ACTIONS_AUDIT.QUALITE,
      module: MODULES_AUDIT.QUALITE,
      entity: "NonConformity",
      entityId: nonConformite.id,
      userId: entree.acteur.id,
      userEmail: entree.acteur.email,
      newValue: {
        numero,
        source: entree.source,
        quantite: entree.quantite.toFixed(6),
        description: entree.description,
      },
    },
    tx,
  );

  return nonConformite.id;
}

export async function creerNonConformite(
  entree: Omit<CreerNonConformiteInterneInput, "acteur">,
  acteur: ActeurQualite,
): Promise<number> {
  if (!entree.description || entree.description.trim().length < 5) {
    throw validation(
      "La description de la non-conformite est obligatoire (au moins 5 caracteres).",
    );
  }
  return prisma.$transaction(
    (tx) => creerNonConformiteInterne(tx, { ...entree, acteur }),
    { timeout: 30_000 },
  );
}

export async function traiterNonConformite(
  entree: {
    nonConformityId: number;
    decision: QualityDecision;
    rootCause?: string | null;
    correctiveAction?: string | null;
    costImpact?: Prisma.Decimal | string | number;
    assignedToId?: number | null;
  },
  acteur: ActeurQualite,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const nonConformite = await tx.nonConformity.findUnique({
        where: { id: entree.nonConformityId },
      });
      if (!nonConformite) throw nonTrouve("La non-conformite");
      if (nonConformite.status === "CLOTUREE") {
        throw conflit("Cette non-conformite est cloturee : elle ne peut plus etre modifiee.");
      }

      await tx.nonConformity.update({
        where: { id: entree.nonConformityId },
        data: {
          decision: entree.decision,
          rootCause: entree.rootCause ?? nonConformite.rootCause,
          correctiveAction: entree.correctiveAction ?? nonConformite.correctiveAction,
          costImpact:
            entree.costImpact === undefined
              ? nonConformite.costImpact
              : D.roundAmount(entree.costImpact),
          assignedToId: entree.assignedToId ?? nonConformite.assignedToId,
          status: "EN_ANALYSE",
          resolvedAt: new Date(),
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.QUALITE,
          module: MODULES_AUDIT.QUALITE,
          entity: "NonConformity",
          entityId: entree.nonConformityId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: nonConformite.status, decision: nonConformite.decision },
          newValue: {
            statut: "EN_ANALYSE",
            decision: entree.decision,
            cause: entree.rootCause ?? null,
            action: entree.correctiveAction ?? null,
          },
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

export async function cloturerNonConformite(
  nonConformityId: number,
  commentaire: string,
  acteur: ActeurQualite,
): Promise<void> {
  if (!commentaire || commentaire.trim().length < 5) {
    throw validation("Un commentaire de cloture est obligatoire.");
  }

  await prisma.$transaction(
    async (tx) => {
      const nonConformite = await tx.nonConformity.findUnique({
        where: { id: nonConformityId },
      });
      if (!nonConformite) throw nonTrouve("La non-conformite");
      if (nonConformite.status === "CLOTUREE") {
        throw conflit("Cette non-conformite est deja cloturee.");
      }

      await tx.nonConformity.update({
        where: { id: nonConformityId },
        data: { status: "CLOTUREE", closedAt: new Date() },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.VALIDATION,
          module: MODULES_AUDIT.QUALITE,
          entity: "NonConformity",
          entityId: nonConformityId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: nonConformite.status },
          newValue: { statut: "CLOTUREE" },
          comment: commentaire,
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

// -----------------------------------------------------------------------------
// Consultations
// -----------------------------------------------------------------------------

export async function listerControlesQualite(filtres: {
  decision?: QualityDecision;
  itemId?: number;
  workOrderId?: number;
  page?: number;
  taille?: number;
}) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(200, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.QualityCheckWhereInput = {};
  if (filtres.decision) where.decision = filtres.decision;
  if (filtres.itemId) where.itemId = filtres.itemId;
  if (filtres.workOrderId) where.workOrderId = filtres.workOrderId;

  const [total, lignes] = await Promise.all([
    prisma.qualityCheck.count({ where }),
    prisma.qualityCheck.findMany({
      where,
      orderBy: { checkedAt: "desc" },
      skip: (page - 1) * taille,
      take: taille,
      include: {
        item: { select: { code: true, label1: true } },
        workOrder: { select: { number: true } },
        checkedBy: { select: { firstName: true, lastName: true } },
        checkpoint: { select: { code: true, label: true } },
      },
    }),
  ]);

  return { lignes, total, page, taille, pages: Math.max(1, Math.ceil(total / taille)) };
}

export async function listerNonConformites(filtres: {
  statut?: NonConformityStatus;
  source?: NonConformitySource;
  page?: number;
  taille?: number;
}) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(200, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.NonConformityWhereInput = {};
  if (filtres.statut) where.status = filtres.statut;
  if (filtres.source) where.source = filtres.source;

  const [total, lignes] = await Promise.all([
    prisma.nonConformity.count({ where }),
    prisma.nonConformity.findMany({
      where,
      orderBy: { detectedAt: "desc" },
      skip: (page - 1) * taille,
      take: taille,
      include: {
        item: { select: { code: true, label1: true } },
        workOrder: { select: { number: true } },
        detectedBy: { select: { firstName: true, lastName: true } },
        assignedTo: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  return { lignes, total, page, taille, pages: Math.max(1, Math.ceil(total / taille)) };
}

/** Articles dont la qualite est en attente de decision. */
export async function stocksEnAttenteQualite() {
  return prisma.stockBalance.findMany({
    where: {
      status: { in: ["QUARANTAINE", "BLOQUE"] },
      quantityPhysical: { gt: 0 },
    },
    include: {
      item: { select: { code: true, label1: true } },
      warehouse: { select: { code: true, label: true } },
      lot: { select: { lotNumber: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
}
