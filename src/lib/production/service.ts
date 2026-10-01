import {
  Prisma,
  type DeclarationKind,
  type Factory,
  type LossCategory,
  type LossReason,
  type OperationStatus,
  type Priority,
  type WorkOrderStatus,
} from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D } from "@/lib/decimal";
import {
  conflit,
  etatInvalide,
  nonTrouve,
  validation,
} from "@/lib/errors";
import { prochainNumero, SEQUENCES } from "@/lib/numbering";
import {
  ACTIONS_AUDIT,
  MODULES_AUDIT,
  enregistrerAudit,
} from "@/lib/audit";
import { lireParametreBooleen, lireParametreNombre, CLE_PARAMETRE } from "@/lib/settings";
import { enregistrerMouvement, transfererStock, type ActeurStock } from "@/lib/stock/service";

/**
 * Moteur de production (MES).
 *
 * Toutes les operations d'atelier sont journalisees : demarrage, pause,
 * reprise, production, consommation, perte, rebut, reprise, deplacement Kanban
 * et fin d'operation. Chaque quantite declaree alimente le stock reel et
 * l'historique de tracabilite.
 */

// -----------------------------------------------------------------------------
// Creation et lancement d'un ordre de fabrication
// -----------------------------------------------------------------------------

export interface CreerOrdreInput {
  itemId: number;
  quantityPlanned: Prisma.Decimal | string | number;
  factory: Factory;
  priority?: Priority;
  formulaId?: number | null;
  routeId?: number | null;
  sourceWarehouseId?: number | null;
  targetWarehouseId?: number | null;
  salesOrderId?: number | null;
  salesOrderLineId?: number | null;
  customerId?: number | null;
  customerReference?: string | null;
  deliveryAddress?: string | null;
  carrier?: string | null;
  plannedDeliveryDate?: Date | null;
  deliveryNotes?: string | null;
  plannedStart?: Date | null;
  dueDate?: Date | null;
  responsibleId?: number | null;
  notes?: string | null;
  /** Cree directement l'ordre au statut LANCE avec la nomenclature figee. */
  lancerImmediatement?: boolean;
  acteur: ActeurStock;
}

export interface OrdreCree {
  workOrderId: number;
  number: string;
  operations: number;
}

async function resoudreNomenclature(
  tx: Db,
  itemId: number,
  formulaId?: number | null,
) {
  if (formulaId) {
    const formule = await tx.formula.findUnique({
      where: { id: formulaId },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
    if (!formule) throw nonTrouve("La nomenclature");
    return formule;
  }

  const active = await tx.formula.findFirst({
    where: {
      itemId,
      status: { in: ["ACTIVE", "VALIDEE"] },
    },
    include: { lines: { orderBy: { lineNo: "asc" } } },
    orderBy: [{ isDefault: "desc" }, { version: "desc" }],
  });

  return active;
}

async function resoudreGamme(tx: Db, itemId: number, routeId?: number | null) {
  if (routeId) {
    const gamme = await tx.productRoute.findUnique({
      where: { id: routeId },
      include: {
        steps: {
          orderBy: { stepNo: "asc" },
          include: { operation: true, producedItem: true },
        },
      },
    });
    if (!gamme) throw nonTrouve("La gamme de fabrication");
    return gamme;
  }

  return tx.productRoute.findFirst({
    where: { itemId, status: "ACTIVE" },
    include: {
      steps: {
        orderBy: { stepNo: "asc" },
        include: { operation: true, producedItem: true },
      },
    },
    orderBy: [{ isDefault: "desc" }, { version: "desc" }],
  });
}

export async function creerOrdreFabrication(
  entree: CreerOrdreInput,
): Promise<OrdreCree> {
  const quantite = D.of(entree.quantityPlanned);
  if (D.lte(quantite, 0)) {
    throw validation("La quantite planifiee doit etre strictement positive.", {
      quantityPlanned: "La quantite doit etre superieure a zero.",
    });
  }

  return prisma.$transaction(async (tx) => {
    const article = await tx.item.findUnique({ where: { id: entree.itemId } });
    if (!article) throw nonTrouve("L'article");

    if (article.status === "ARCHIVE") {
      throw etatInvalide(
        `L'article ${article.code} est archive : aucun ordre de fabrication ne peut etre cree.`,
      );
    }
    if (article.status === "NON_PRODUCTIBLE") {
      throw etatInvalide(
        `L'article ${article.code} est marque Â« non productible Â» dans le catalogue.`,
      );
    }

    const formule = await resoudreNomenclature(tx, entree.itemId, entree.formulaId);
    const gamme = await resoudreGamme(tx, entree.itemId, entree.routeId);

    // Le client et les details de livraison sont optionnels : un ordre interne
    // reste valide. Lorsqu'un lien commercial est declare, il doit etre coherent
    // avec la ligne, l'article et le client selectionnes.
    let customerId = entree.customerId ?? null;
    let salesOrderId = entree.salesOrderId ?? null;
    let salesOrderLineId = entree.salesOrderLineId ?? null;

    if (salesOrderLineId && !salesOrderId) {
      throw validation(
        "Selectionnez la commande client associee a la ligne de commande.",
        { salesOrderLineId: "Une ligne de commande doit appartenir a une commande." },
      );
    }

    if (salesOrderId) {
      const commande = await tx.salesOrder.findUnique({
        where: { id: salesOrderId },
        include: {
          customer: {
            select: { id: true, code: true, label1: true, isClient: true, isActive: true },
          },
          lines: { select: { id: true, lineNo: true, itemId: true } },
        },
      });
      if (!commande) throw nonTrouve("La commande client");
      if (!commande.customer.isClient || !commande.customer.isActive) {
        throw validation(
          `Le client ${commande.customer.label1} n'est pas un client actif.`,
          { customerId: "Selectionnez un client actif." },
        );
      }
      if (customerId && customerId !== commande.customerId) {
        throw validation(
          "Le client selectionne ne correspond pas a la commande client choisie.",
          { customerId: "Le client doit correspondre a la commande." },
        );
      }
      customerId = commande.customerId;

      if (salesOrderLineId) {
        const ligne = commande.lines.find((element) => element.id === salesOrderLineId);
        if (!ligne) {
          throw validation(
            "La ligne de commande selectionnee n'appartient pas a la commande choisie.",
            { salesOrderLineId: "Selectionnez une ligne de cette commande." },
          );
        }
        if (ligne.itemId !== entree.itemId) {
          throw validation(
            "La ligne de commande selectionnee ne porte pas l'article fabrique.",
            { salesOrderLineId: "La ligne doit correspondre a l'article de l'ordre." },
          );
        }
      }
    }

    if (customerId) {
      const client = await tx.thirdParty.findUnique({
        where: { id: customerId },
        select: { id: true, code: true, label1: true, isClient: true, isActive: true },
      });
      if (!client) throw nonTrouve("Le client");
      if (!client.isClient || !client.isActive) {
        throw validation(
          `Le tiers ${client.label1} n'est pas un client actif.`,
          { customerId: "Selectionnez un client actif." },
        );
      }
    }

    const detailsLivraison = [
      entree.customerReference,
      entree.deliveryAddress,
      entree.carrier,
      entree.plannedDeliveryDate,
      entree.deliveryNotes,
    ].some((valeur) => valeur !== null && valeur !== undefined);
    if (detailsLivraison && !customerId) {
      throw validation(
        "Selectionnez le client pour enregistrer les details de livraison.",
        { customerId: "Le client est obligatoire avec les details de livraison." },
      );
    }

    if (!formule && !gamme) {
      throw etatInvalide(
        `Aucune nomenclature ni gamme active n'est definie pour ${article.code}. Configurez la fabrication avant de creer un ordre.`,
      );
    }

    const numero = await prochainNumero(SEQUENCES.ORDRE_FABRICATION, tx);

    const ordre = await tx.workOrder.create({
      data: {
        number: numero,
        itemId: entree.itemId,
        formulaId: formule?.id ?? null,
        routeId: gamme?.id ?? null,
        factory: entree.factory,
        status: "BROUILLON",
        priority: entree.priority ?? "NORMALE",
        quantityPlanned: D.roundQuantity(quantite),
        quantityRemaining: D.roundQuantity(quantite),
        sourceWarehouseId: entree.sourceWarehouseId ?? null,
        targetWarehouseId: entree.targetWarehouseId ?? null,
        salesOrderId,
        salesOrderLineId,
        customerId,
        customerReference: entree.customerReference ?? null,
        deliveryAddress: entree.deliveryAddress ?? null,
        carrier: entree.carrier ?? null,
        plannedDeliveryDate: entree.plannedDeliveryDate ?? null,
        deliveryNotes: entree.deliveryNotes ?? null,
        plannedStart: entree.plannedStart ?? null,
        dueDate: entree.dueDate ?? null,
        responsibleId: entree.responsibleId ?? null,
        notes: entree.notes ?? null,
        createdById: entree.acteur.id,
        isSemiFinishedOutput: article.isSemiFinished,
      },
    });

    // Construction des operations : la gamme prime, sinon les operations
    // declarees sur les lignes de nomenclature.
    const etapes = gamme?.steps ?? [];

    if (etapes.length > 0) {
      await tx.workOrderOperation.createMany({
        data: etapes.map((etape, index) => ({
          workOrderId: ordre.id,
          stepNo: etape.stepNo,
          operationId: etape.operationId,
          workCenterId: etape.workCenterId,
          status: "NON_DEMARREE" as OperationStatus,
          boardOrder: etape.stepNo || index + 1,
          quantityPlanned: D.roundQuantity(quantite),
          plannedStart: entree.plannedStart ?? null,
          plannedEnd: null,
        })),
      });
    } else if (formule) {
      const codesOperations = Array.from(
        new Set(
          formule.lines
            .map((ligne) => ligne.operationCode)
            .filter((code): code is string => Boolean(code)),
        ),
      );

      if (codesOperations.length === 0) {
        throw etatInvalide(
          `La nomenclature ${formule.code} ne precise aucune operation et aucune gamme n'est definie pour ${article.code}.`,
        );
      }

      const operations = await tx.operation.findMany({
        where: { code: { in: codesOperations } },
      });

      const parCode = new Map(operations.map((op) => [op.code, op]));
      const manquantes = codesOperations.filter((code) => !parCode.has(code));
      if (manquantes.length > 0) {
        throw etatInvalide(
          `Operations inconnues dans la nomenclature ${formule.code} : ${manquantes.join(", ")}.`,
        );
      }

      await tx.workOrderOperation.createMany({
        data: codesOperations.map((code, index) => {
          const operation = parCode.get(code)!;
          return {
            workOrderId: ordre.id,
            stepNo: index + 1,
            operationId: operation.id,
            status: "NON_DEMARREE" as OperationStatus,
            boardOrder: operation.boardOrder || index + 1,
            quantityPlanned: D.roundQuantity(quantite),
            plannedStart: entree.plannedStart ?? null,
          };
        }),
      });
    } else {
      throw etatInvalide(
        `Impossible de determiner la route de fabrication de ${article.code}.`,
      );
    }

    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.CREATION,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "WorkOrder",
        entityId: ordre.id,
        userId: entree.acteur.id,
        userEmail: entree.acteur.email,
        newValue: {
          numero,
          article: article.code,
          quantite: quantite.toFixed(6),
          usine: entree.factory,
          nomenclature: formule?.code ?? null,
          gamme: gamme?.code ?? null,
        },
      },
      tx,
    );

    const nombreOperations = await tx.workOrderOperation.count({
      where: { workOrderId: ordre.id },
    });

    if (entree.lancerImmediatement) {
      await lancerOrdreFabrication(ordre.id, entree.acteur, tx);
    }

    return { workOrderId: ordre.id, number: numero, operations: nombreOperations };
  }, { timeout: 60_000 });
}

/**
 * Lance l'ordre : la nomenclature est figee dans `WorkOrderMaterial`.
 * Une modification ulterieure de la nomenclature n'affecte jamais un ordre
 * deja lance.
 */
export async function lancerOrdreFabrication(
  workOrderId: number,
  acteur: ActeurStock,
  db?: Db,
): Promise<{ matieres: number }> {
  const executer = async (tx: Db) => {
    const ordre = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        formula: { include: { lines: { orderBy: { lineNo: "asc" } } } },
        item: true,
        operations: { orderBy: { stepNo: "asc" } },
      },
    });

    if (!ordre) throw nonTrouve("L'ordre de fabrication");

    if (!["BROUILLON", "PLANIFIE"].includes(ordre.status)) {
      throw etatInvalide(
        `L'ordre ${ordre.number} est au statut Â« ${ordre.status} Â» : seul un ordre en brouillon ou planifie peut etre lance.`,
      );
    }

    if (!ordre.formula) {
      throw etatInvalide(
        `L'ordre ${ordre.number} n'a pas de nomenclature associee : impossible de figer les composants.`,
      );
    }

    if (ordre.operations.length === 0) {
      throw etatInvalide(
        `L'ordre ${ordre.number} ne comporte aucune operation de fabrication.`,
      );
    }

    // Une ligne de nomenclature designe son operation par son code : il faut
    // retrouver l'operation du referentiel (`Operation.operationId`) ET
    // l'operation de cet ordre (`WorkOrderOperation.id`). Les deux identifiants
    // sont distincts et ne doivent jamais etre confondus.
    const operationsParCode = new Map<
      string,
      { workOrderOperationId: number; operationId: number }
    >();
    for (const operation of ordre.operations) {
      const op = await tx.operation.findUnique({ where: { id: operation.operationId } });
      if (op) {
        operationsParCode.set(op.code, {
          workOrderOperationId: operation.id,
          operationId: operation.operationId,
        });
      }
    }

    const dejaFige = await tx.workOrderMaterial.count({ where: { workOrderId } });
    if (dejaFige > 0) {
      throw conflit(
        `L'ordre ${ordre.number} a deja fige sa nomenclature (${dejaFige} composants).`,
      );
    }

    const lignes: Prisma.WorkOrderMaterialCreateManyInput[] = [];

    for (const ligne of ordre.formula.lines) {
      const quantiteUnitaire = D.of(ligne.quantity);
      const quantiteTotale = D.applyLossRate(
        D.mul(quantiteUnitaire, ordre.quantityPlanned),
        ligne.lossRate,
      );

      const cible = ligne.operationCode
        ? (operationsParCode.get(ligne.operationCode) ?? null)
        : null;
      const operationId = cible?.operationId ?? null;
      const workOrderOperationId = cible?.workOrderOperationId ?? null;

      const composant = await tx.item.findUnique({
        where: { id: ligne.componentItemId },
        select: { vwap: true, standardCost: true },
      });

      const coutUnitaire = D.of(ligne.unitCost).isZero()
        ? D.of(composant?.vwap ?? 0)
        : D.of(ligne.unitCost);

      lignes.push({
        workOrderId,
        workOrderOperationId,
        operationId,
        componentItemId: ligne.componentItemId,
        lineNo: ligne.lineNo,
        quantityPlanned: D.roundQuantity(quantiteTotale),
        unitCode: ligne.unitCode,
        lossRate: ligne.lossRate,
        scrapRate: ligne.scrapRate,
        unitCost: D.round(coutUnitaire, 6),
        totalCost: D.round(D.mul(quantiteTotale, coutUnitaire), 6),
        warehouseId: ligne.consumptionWarehouseId ?? ordre.sourceWarehouseId,
        snapshotSource: `Nomenclature ${ordre.formula.code} v${ordre.formula.version}`,
        isLabor: ligne.isLabor,
      });
    }

    if (lignes.length > 0) {
      await tx.workOrderMaterial.createMany({ data: lignes });
    }

    await tx.workOrder.update({
      where: { id: workOrderId },
      data: {
        status: "LANCE",
        quantityLaunched: ordre.quantityPlanned,
        quantityRemaining: ordre.quantityPlanned,
        actualStart: ordre.actualStart ?? new Date(),
      },
    });

    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.VALIDATION,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "WorkOrder",
        entityId: workOrderId,
        userId: acteur.id,
        userEmail: acteur.email,
        oldValue: { statut: ordre.status },
        newValue: {
          statut: "LANCE",
          composantsFiges: lignes.length,
          nomenclature: `${ordre.formula.code} v${ordre.formula.version}`,
        },
        comment: "Lancement de l'ordre de fabrication",
      },
      tx,
    );

    return { matieres: lignes.length };
  };

  if (db) return executer(db);
  return prisma.$transaction(executer, { timeout: 60_000 });
}

// -----------------------------------------------------------------------------
// Operations d'atelier
// -----------------------------------------------------------------------------

async function chargerOperation(tx: Db, workOrderOperationId: number) {
  const operation = await tx.workOrderOperation.findUnique({
    where: { id: workOrderOperationId },
    include: {
      workOrder: true,
      operation: true,
    },
  });
  if (!operation) throw nonTrouve("L'operation de fabrication");
  return operation;
}

export interface DemarrerOperationInput {
  workOrderOperationId: number;
  employeeId?: number | null;
  acteur: ActeurStock;
  commentaire?: string | null;
}

export async function demarrerOperation(entree: DemarrerOperationInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const operation = await chargerOperation(tx, entree.workOrderOperationId);

    if (operation.status === "EN_COURS") {
      throw etatInvalide("Cette operation est deja en cours.");
    }
    if (["TERMINEE", "VALIDEE"].includes(operation.status)) {
      throw etatInvalide(
        "Cette operation est terminee : elle ne peut pas etre redemarree.",
      );
    }
    if (operation.workOrder.status === "ANNULE") {
      throw etatInvalide("L'ordre de fabrication est annule.");
    }
    if (operation.workOrder.status === "BROUILLON") {
      throw etatInvalide(
        "L'ordre de fabrication doit etre lance avant de demarrer une operation.",
      );
    }

    const maintenant = new Date();

    await tx.workOrderOperation.update({
      where: { id: operation.id },
      data: {
        status: "EN_COURS",
        actualStart: operation.actualStart ?? maintenant,
        pausedAt: null,
        operatorId: entree.employeeId ?? operation.operatorId,
      },
    });

    await tx.workOrder.update({
      where: { id: operation.workOrderId },
      data: {
        status:
          operation.workOrder.status === "LANCE" ? "EN_COURS" : operation.workOrder.status,
      },
    });

    await creerDeclaration(tx, {
      workOrderId: operation.workOrderId,
      workOrderOperationId: operation.id,
      operationId: operation.operationId,
      employeeId: entree.employeeId ?? null,
      kind: "DEMARRAGE",
      acteur: entree.acteur,
      commentaire: entree.commentaire ?? null,
      occurredAt: maintenant,
    });

    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.PRODUCTION,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "WorkOrderOperation",
        entityId: operation.id,
        userId: entree.acteur.id,
        userEmail: entree.acteur.email,
        oldValue: { statut: operation.status },
        newValue: { statut: "EN_COURS" },
        comment: `Demarrage de l'operation ${operation.operation.label}`,
      },
      tx,
    );
  }, { timeout: 30_000 });
}

export async function mettreEnPauseOperation(
  workOrderOperationId: number,
  acteur: ActeurStock,
  employeeId?: number | null,
  commentaire?: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const operation = await chargerOperation(tx, workOrderOperationId);
    if (operation.status !== "EN_COURS") {
      throw etatInvalide("Seule une operation en cours peut etre mise en pause.");
    }

    const maintenant = new Date();
    await tx.workOrderOperation.update({
      where: { id: operation.id },
      data: { status: "EN_PAUSE", pausedAt: maintenant },
    });

    await creerDeclaration(tx, {
      workOrderId: operation.workOrderId,
      workOrderOperationId: operation.id,
      operationId: operation.operationId,
      employeeId: employeeId ?? null,
      kind: "PAUSE",
      acteur,
      commentaire: commentaire ?? null,
      occurredAt: maintenant,
    });
  }, { timeout: 30_000 });
}

export async function reprendreOperation(
  workOrderOperationId: number,
  acteur: ActeurStock,
  employeeId?: number | null,
  commentaire?: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const operation = await chargerOperation(tx, workOrderOperationId);
    if (operation.status !== "EN_PAUSE") {
      throw etatInvalide("Seule une operation en pause peut etre reprise.");
    }

    const maintenant = new Date();
    const dureePause = operation.pausedAt
      ? BigInt(Math.max(0, maintenant.getTime() - operation.pausedAt.getTime()))
      : BigInt(0);

    await tx.workOrderOperation.update({
      where: { id: operation.id },
      data: {
        status: "EN_COURS",
        pausedAt: null,
        totalPausedMs: operation.totalPausedMs + dureePause,
      },
    });

    await creerDeclaration(tx, {
      workOrderId: operation.workOrderId,
      workOrderOperationId: operation.id,
      operationId: operation.operationId,
      employeeId: employeeId ?? null,
      kind: "REPRISE",
      acteur,
      commentaire: commentaire ?? null,
      occurredAt: maintenant,
      durationMinutes: D.round(D.div(dureePause.toString(), 60000), 2),
    });
  }, { timeout: 30_000 });
}

interface CreerDeclarationInput {
  workOrderId: number;
  workOrderOperationId: number;
  operationId: number;
  employeeId: number | null;
  kind: DeclarationKind;
  acteur: ActeurStock;
  quantity?: Prisma.Decimal | string | number;
  quantityConform?: Prisma.Decimal | string | number;
  unitCode?: string | null;
  itemId?: number | null;
  componentItemId?: number | null;
  lotId?: number | null;
  warehouseId?: number | null;
  materialId?: number | null;
  lossCategory?: LossCategory | null;
  lossReason?: LossReason | null;
  isExceptional?: boolean;
  commentaire?: string | null;
  occurredAt?: Date;
  durationMinutes?: Prisma.Decimal | string | number | null;
  status?: "SAISIE" | "SOUMISE" | "VALIDEE";
}

async function creerDeclaration(tx: Db, entree: CreerDeclarationInput) {
  return tx.operationDeclaration.create({
    data: {
      workOrderId: entree.workOrderId,
      workOrderOperationId: entree.workOrderOperationId,
      operationId: entree.operationId,
      employeeId: entree.employeeId,
      userId: entree.acteur.id,
      kind: entree.kind,
      status: entree.status ?? "SAISIE",
      quantity: D.roundQuantity(entree.quantity ?? 0),
      quantityConform: D.roundQuantity(entree.quantityConform ?? 0),
      unitCode: entree.unitCode ?? null,
      itemId: entree.itemId ?? null,
      componentItemId: entree.componentItemId ?? null,
      lotId: entree.lotId ?? null,
      warehouseId: entree.warehouseId ?? null,
      materialId: entree.materialId ?? null,
      lossCategory: entree.lossCategory ?? null,
      lossReason: entree.lossReason ?? null,
      isExceptional: entree.isExceptional ?? false,
      comment: entree.commentaire ?? null,
      occurredAt: entree.occurredAt ?? new Date(),
      durationMinutes: entree.durationMinutes
        ? D.round(entree.durationMinutes, 4)
        : null,
    },
  });
}

// -----------------------------------------------------------------------------
// Declaration de production
// -----------------------------------------------------------------------------

export interface DeclarationProductionInput {
  workOrderOperationId: number;
  employeeId?: number | null;
  quantiteProduite: Prisma.Decimal | string | number;
  quantiteConforme?: Prisma.Decimal | string | number;
  quantiteRebutee?: Prisma.Decimal | string | number;
  quantiteReprise?: Prisma.Decimal | string | number;
  commentaire?: string | null;
  /** Consomme automatiquement les composants selon la nomenclature figee. */
  consommerComposants?: boolean;
  acteur: ActeurStock;
}

export interface ResultatProduction {
  declarationId: bigint;
  quantiteProduite: Prisma.Decimal;
  quantiteConforme: Prisma.Decimal;
  quantiteRebutee: Prisma.Decimal;
  quantiteReprise: Prisma.Decimal;
  matieresConsommees: number;
  resteAProduire: Prisma.Decimal;
}

export async function declarerProduction(
  entree: DeclarationProductionInput,
): Promise<ResultatProduction> {
  const produite = D.of(entree.quantiteProduite);
  const conforme = entree.quantiteConforme === undefined ? produite : D.of(entree.quantiteConforme);
  const rebutee = D.of(entree.quantiteRebutee ?? 0);
  const reprise = D.of(entree.quantiteReprise ?? 0);

  if (D.lte(produite, 0)) {
    throw validation("La quantite produite doit etre strictement positive.", {
      quantiteProduite: "Saisissez une quantite superieure a zero.",
    });
  }
  if (D.lt(conforme, 0) || D.lt(rebutee, 0) || D.lt(reprise, 0)) {
    throw validation("Les quantites declarees ne peuvent pas etre negatives.");
  }
  if (D.gt(D.add(D.add(conforme, rebutee), reprise), produite)) {
    throw validation(
      "La somme des quantites conformes, rebutees et en reprise ne peut pas depasser la quantite produite.",
      {
        quantiteConforme:
          "Conforme + rebut + reprise depasse la quantite produite.",
      },
    );
  }

  return prisma.$transaction(async (tx) => {
    const operation = await chargerOperation(tx, entree.workOrderOperationId);

    if (operation.workOrder.status === "ANNULE") {
      throw etatInvalide("L'ordre de fabrication est annule.");
    }
    if (operation.workOrder.status === "CLOTURE") {
      throw etatInvalide("L'ordre de fabrication est cloture.");
    }
    if (operation.status === "NON_DEMARREE") {
      throw etatInvalide(
        "Demarrez l'operation avant de declarer une production.",
      );
    }
    if (["TERMINEE", "VALIDEE", "ANNULEE"].includes(operation.status)) {
      throw etatInvalide(
        "Cette operation est terminee : aucune production supplementaire ne peut y etre declaree.",
      );
    }

    const declaration = await creerDeclaration(tx, {
      workOrderId: operation.workOrderId,
      workOrderOperationId: operation.id,
      operationId: operation.operationId,
      employeeId: entree.employeeId ?? null,
      kind: "PRODUCTION",
      acteur: entree.acteur,
      quantity: produite,
      quantityConform: conforme,
      unitCode: operation.workOrder.itemId
        ? (await tx.item.findUnique({
            where: { id: operation.workOrder.itemId },
            select: { unitCode: true },
          }))?.unitCode ?? null
        : null,
      itemId: operation.workOrder.itemId,
      warehouseId: operation.workOrder.targetWarehouseId,
      commentaire: entree.commentaire ?? null,
    });

    const nouvelleOperation = await tx.workOrderOperation.update({
      where: { id: operation.id },
      data: {
        quantityProduced: D.roundQuantity(D.add(operation.quantityProduced, produite)),
        quantityConform: D.roundQuantity(D.add(operation.quantityConform, conforme)),
        quantityScrapped: D.roundQuantity(D.add(operation.quantityScrapped, rebutee)),
        quantityRework: D.roundQuantity(D.add(operation.quantityRework, reprise)),
      },
    });

    const ordre = operation.workOrder;
    const nouvelleProduite = D.add(ordre.quantityProduced, produite);
    const nouveauConforme = D.add(ordre.quantityConform, conforme);
    const nouveauRebut = D.add(ordre.quantityScrapped, rebutee);
    const nouvelleReprise = D.add(ordre.quantityRework, reprise);
    const reste = D.sub(ordre.quantityPlanned, nouvelleProduite);

    let statutOrdre: WorkOrderStatus = ordre.status;
    if (["LANCE", "PLANIFIE"].includes(ordre.status)) {
      statutOrdre = "EN_COURS";
    }
    if (D.gte(nouvelleProduite, ordre.quantityPlanned)) {
      statutOrdre = "PARTIELLEMENT_TERMINE";
    }

    await tx.workOrder.update({
      where: { id: ordre.id },
      data: {
        quantityProduced: D.roundQuantity(nouvelleProduite),
        quantityConform: D.roundQuantity(nouveauConforme),
        quantityScrapped: D.roundQuantity(nouveauRebut),
        quantityRework: D.roundQuantity(nouvelleReprise),
        quantityRemaining: D.roundQuantity(reste.isNegative() ? D.ZERO : reste),
        status: statutOrdre,
        actualStart: ordre.actualStart ?? new Date(),
      },
    });

    let matieresConsommees = 0;

    if (entree.consommerComposants !== false) {
      // Le cumul produit de l'operation (et non la seule quantite de cette
      // declaration) est transmis : la consommation theorique est un cumul, et
      // la difference avec ce qui est deja consomme donne le complement a
      // sortir. Sans ce cumul, une production declaree en plusieurs fois
      // consommerait moins que la nomenclature figee.
      matieresConsommees = await consommerComposantsTheoriques(
        tx,
        operation.id,
        D.add(operation.quantityProduced, produite),
        entree.acteur,
      );
    }

    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.PRODUCTION,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "OperationDeclaration",
        entityId: declaration.id,
        userId: entree.acteur.id,
        userEmail: entree.acteur.email,
        newValue: {
          ordre: ordre.number,
          operation: operation.operation.code,
          produite: produite.toFixed(6),
          conforme: conforme.toFixed(6),
          rebut: rebutee.toFixed(6),
          reprise: reprise.toFixed(6),
        },
        comment: entree.commentaire ?? null,
      },
      tx,
    );

    return {
      declarationId: declaration.id,
      quantiteProduite: produite,
      quantiteConforme: conforme,
      quantiteRebutee: rebutee,
      quantiteReprise: reprise,
      matieresConsommees,
      resteAProduire: nouvelleOperation.quantityPlanned.greaterThan(nouvelleProduite)
        ? D.sub(nouvelleOperation.quantityPlanned, nouvelleProduite)
        : D.ZERO,
    };
  }, { timeout: 60_000 });
}

/**
 * Consomme les composants proportionnellement a la quantite produite,
 * conformement a la nomenclature figee au lancement de l'ordre.
 * `quantiteProduiteCumulee` est le cumul produit sur l'operation : la part
 * theorique est calculee sur ce cumul, puis diminuee de ce qui a deja ete
 * consomme, ce qui rend l'operation idempotente et evite toute double sortie.
 */
async function consommerComposantsTheoriques(
  tx: Db,
  workOrderOperationId: number,
  quantiteProduiteCumulee: Prisma.Decimal,
  acteur: ActeurStock,
): Promise<number> {
  const matieres = await tx.workOrderMaterial.findMany({
    where: { workOrderOperationId },
    include: { componentItem: { select: { code: true, label1: true, isMainOeuvre: true } } },
  });

  const operation = await tx.workOrderOperation.findUnique({
    where: { id: workOrderOperationId },
    select: { workOrderId: true, operationId: true, operation: { select: { code: true } } },
  });
  if (!operation || matieres.length === 0) return 0;

  const ordre = await tx.workOrder.findUnique({
    where: { id: operation.workOrderId },
    select: { quantityLaunched: true, number: true },
  });
  if (!ordre || D.lte(ordre.quantityLaunched, 0)) return 0;

  let consommees = 0;

  for (const matiere of matieres) {
    // La main-d'oeuvre n'est pas un article de stock : elle est valorisee
    // mais ne genere aucun mouvement.
    if (matiere.isLabor || matiere.componentItem.isMainOeuvre) continue;

    const quantiteTheorique = D.mul(
      D.div(matiere.quantityPlanned, ordre.quantityLaunched),
      quantiteProduiteCumulee,
    );

    if (D.lte(quantiteTheorique, 0)) continue;

    const aConsommer = D.sub(quantiteTheorique, matiere.quantityConsumed);
    if (D.lte(aConsommer, 0)) continue;

    if (!matiere.warehouseId) continue;

    await enregistrerMouvement(tx, {
      type: "CONSOMMATION_OPERATION",
      itemId: matiere.componentItemId,
      warehouseId: matiere.warehouseId,
      quantity: aConsommer.negated(),
      unitCost: matiere.unitCost,
      unitCode: matiere.unitCode,
      workOrderId: operation.workOrderId,
      workOrderOperationId,
      operationId: operation.operationId,
      documentType: "ORDRE_FABRICATION",
      documentId: String(operation.workOrderId),
      documentNumber: ordre.number,
      comment: `Consommation selon nomenclature - operation ${operation.operation.code}`,
      acteur,
      sansAudit: true,
    });

    await tx.workOrderMaterial.update({
      where: { id: matiere.id },
      data: {
        quantityConsumed: D.roundQuantity(D.add(matiere.quantityConsumed, aConsommer)),
        quantityIssued: D.roundQuantity(D.add(matiere.quantityIssued, aConsommer)),
      },
    });

    consommees += 1;
  }

  return consommees;
}

// -----------------------------------------------------------------------------
// Consommations, pertes, rebuts et reprises declares par l'atelier
// -----------------------------------------------------------------------------

export interface DeclarationConsommationInput {
  workOrderOperationId: number;
  materialId: number;
  quantite: Prisma.Decimal | string | number;
  employeeId?: number | null;
  commentaire?: string | null;
  acteur: ActeurStock;
}

/**
 * Declaration d'une consommation reelle.
 * L'ecart avec la nomenclature est classe en consommation normale ou en
 * surconsommation, sans jamais etre confondu avec une perte.
 */
export async function declarerConsommation(
  entree: DeclarationConsommationInput,
): Promise<{ declarationId: bigint; ecart: Prisma.Decimal; categorie: LossCategory }> {
  const quantite = D.of(entree.quantite);
  if (D.lte(quantite, 0)) {
    throw validation("La quantite consommee doit etre strictement positive.");
  }

  return prisma.$transaction(async (tx) => {
    const matiere = await tx.workOrderMaterial.findUnique({
      where: { id: entree.materialId },
      include: { componentItem: true },
    });
    if (!matiere) throw nonTrouve("Le composant de l'ordre de fabrication");
    if (matiere.workOrderOperationId !== entree.workOrderOperationId) {
      throw validation(
        "Ce composant n'appartient pas a l'operation indiquee.",
      );
    }
    if (!matiere.warehouseId) {
      throw etatInvalide(
        `Aucun depot de consommation n'est defini pour ${matiere.componentItem.code}.`,
      );
    }

    const operation = await chargerOperation(tx, entree.workOrderOperationId);

    const restantTheorique = D.sub(matiere.quantityPlanned, matiere.quantityConsumed);
    const categorie: LossCategory = D.gt(quantite, restantTheorique)
      ? "SURCONSOMMATION"
      : "CONSOMMATION_NORMALE";

    const mouvement = await enregistrerMouvement(tx, {
      type: "CONSOMMATION_OPERATION",
      itemId: matiere.componentItemId,
      warehouseId: matiere.warehouseId,
      quantity: quantite.negated(),
      unitCost: matiere.unitCost,
      unitCode: matiere.unitCode,
      workOrderId: operation.workOrderId,
      workOrderOperationId: operation.id,
      operationId: operation.operationId,
      documentType: "ORDRE_FABRICATION",
      documentId: String(operation.workOrderId),
      documentNumber: operation.workOrder.number,
      comment: entree.commentaire ?? "Consommation declaree en atelier",
      acteur: entree.acteur,
      sansAudit: true,
    });

    const declaration = await creerDeclaration(tx, {
      workOrderId: operation.workOrderId,
      workOrderOperationId: operation.id,
      operationId: operation.operationId,
      employeeId: entree.employeeId ?? null,
      kind: "CONSOMMATION",
      acteur: entree.acteur,
      quantity: quantite,
      itemId: operation.workOrder.itemId,
      componentItemId: matiere.componentItemId,
      warehouseId: matiere.warehouseId,
      materialId: matiere.id,
      unitCode: matiere.unitCode,
      lossCategory: categorie,
      commentaire: entree.commentaire ?? null,
    });

    await tx.workOrderMaterial.update({
      where: { id: matiere.id },
      data: {
        quantityConsumed: D.roundQuantity(D.add(matiere.quantityConsumed, quantite)),
        quantityIssued: D.roundQuantity(D.add(matiere.quantityIssued, quantite)),
      },
    });

    await tx.stockMovement.update({
      where: { id: mouvement.mouvementId },
      data: { declarationId: declaration.id },
    });

    await tx.workOrderOperation.update({
      where: { id: operation.id },
      data: {
        quantityConsumed: D.roundQuantity(
          D.add(operation.quantityConsumed, quantite),
        ),
      },
    });

    const ecart = D.sub(quantite, restantTheorique);

    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.CONSOMMATION,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "OperationDeclaration",
        entityId: declaration.id,
        userId: entree.acteur.id,
        userEmail: entree.acteur.email,
        newValue: {
          ordre: operation.workOrder.number,
          composant: matiere.componentItem.code,
          quantite: quantite.toFixed(6),
          categorie,
        },
        comment: entree.commentaire ?? null,
      },
      tx,
    );

    return { declarationId: declaration.id, ecart, categorie };
  }, { timeout: 60_000 });
}

export interface DeclarationPerteInput {
  workOrderOperationId: number;
  /** Article perdu : produit fini, semi-fini ou composant. */
  itemId: number;
  quantite: Prisma.Decimal | string | number;
  categorie: LossCategory;
  motif: LossReason;
  employeeId?: number | null;
  warehouseId?: number | null;
  lotId?: number | null;
  materialId?: number | null;
  commentaire?: string | null;
  /** Indique si la perte sort physiquement du stock (rebut, perte). */
  sortirDuStock?: boolean;
  acteur: ActeurStock;
}

export interface ResultatPerte {
  declarationId: bigint;
  quantite: Prisma.Decimal;
  categorie: LossCategory;
  motif: LossReason;
  validationRequise: boolean;
}

/**
 * Declaration d'une perte, d'un rebut, d'une reprise ou d'un retour en stock.
 * Les pertes ne sont jamais melangees avec les consommations normales :
 * elles portent une categorie et un motif explicites.
 */
export async function declarerPerte(
  entree: DeclarationPerteInput,
): Promise<ResultatPerte> {
  const quantite = D.of(entree.quantite);
  if (D.lte(quantite, 0)) {
    throw validation("La quantite declaree doit etre strictement positive.");
  }

  return prisma.$transaction(async (tx) => {
    const operation = await chargerOperation(tx, entree.workOrderOperationId);
    const article = await tx.item.findUnique({ where: { id: entree.itemId } });
    if (!article) throw nonTrouve("L'article");

    const seuil = await lireParametreNombre(
      CLE_PARAMETRE.SEUIL_PERTE_EXCEPTIONNELLE_POURCENT,
      3,
      tx,
    );
    const tauxPerte = D.lossRate(quantite, operation.quantityPlanned);
    const validationRequise =
      entree.categorie === "PERTE_EXCEPTIONNELLE" ||
      (D.gt(tauxPerte, seuil) &&
        (await lireParametreBooleen(
          CLE_PARAMETRE.PERTE_EXCEPTIONNELLE_VALIDATION_REQUISE,
          true,
          tx,
        )));

    const categorieFinale: LossCategory =
      validationRequise && entree.categorie === "PERTE_NORMALE"
        ? "PERTE_EXCEPTIONNELLE"
        : entree.categorie;

    const declaration = await creerDeclaration(tx, {
      workOrderId: operation.workOrderId,
      workOrderOperationId: operation.id,
      operationId: operation.operationId,
      employeeId: entree.employeeId ?? null,
      kind: "PERTE",
      acteur: entree.acteur,
      quantity: quantite,
      itemId: entree.itemId,
      lotId: entree.lotId ?? null,
      warehouseId: entree.warehouseId ?? operation.workOrder.sourceWarehouseId,
      materialId: entree.materialId ?? null,
      lossCategory: categorieFinale,
      lossReason: entree.motif,
      isExceptional: validationRequise,
      commentaire: entree.commentaire ?? null,
      status: validationRequise ? "SOUMISE" : "SAISIE",
    });

    if (entree.sortirDuStock && entree.warehouseId) {
      const typeMouvement =
        categorieFinale === "REBUT"
          ? "REBUT"
          : categorieFinale === "RETOUR_STOCK"
            ? "RETOUR_CLIENT"
            : "PERTE";

      const mouvement = await enregistrerMouvement(tx, {
        type: typeMouvement,
        itemId: entree.itemId,
        warehouseId: entree.warehouseId,
        lotId: entree.lotId ?? null,
        quantity:
          categorieFinale === "RETOUR_STOCK" ? quantite : quantite.negated(),
        workOrderId: operation.workOrderId,
        workOrderOperationId: operation.id,
        operationId: operation.operationId,
        documentType: "ORDRE_FABRICATION",
        documentId: String(operation.workOrderId),
        documentNumber: operation.workOrder.number,
        comment: `Declaration ${categorieFinale} - motif ${entree.motif}`,
        reason: entree.commentaire ?? entree.motif,
        acteur: entree.acteur,
        sansAudit: true,
      });

      await tx.stockMovement.update({
        where: { id: mouvement.mouvementId },
        data: { declarationId: declaration.id },
      });
    }

    if (categorieFinale === "REBUT") {
      await tx.workOrderOperation.update({
        where: { id: operation.id },
        data: {
          quantityScrapped: D.roundQuantity(
            D.add(operation.quantityScrapped, quantite),
          ),
        },
      });
      await tx.workOrder.update({
        where: { id: operation.workOrderId },
        data: {
          quantityScrapped: D.roundQuantity(
            D.add(operation.workOrder.quantityScrapped, quantite),
          ),
        },
      });
    }

    if (categorieFinale === "REPRISE") {
      await tx.workOrderOperation.update({
        where: { id: operation.id },
        data: {
          quantityRework: D.roundQuantity(
            D.add(operation.quantityRework, quantite),
          ),
        },
      });
      await tx.workOrder.update({
        where: { id: operation.workOrderId },
        data: {
          quantityRework: D.roundQuantity(
            D.add(operation.workOrder.quantityRework, quantite),
          ),
        },
      });
    }

    await enregistrerAudit(
      {
        action:
          categorieFinale === "REBUT"
            ? ACTIONS_AUDIT.REBUT
            : categorieFinale === "REPRISE"
              ? ACTIONS_AUDIT.REPRISE
              : ACTIONS_AUDIT.PERTE,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "OperationDeclaration",
        entityId: declaration.id,
        userId: entree.acteur.id,
        userEmail: entree.acteur.email,
        newValue: {
          ordre: operation.workOrder.number,
          article: article.code,
          quantite: quantite.toFixed(6),
          categorie: categorieFinale,
          motif: entree.motif,
          tauxPerte: tauxPerte.toFixed(4),
          validationRequise,
        },
        comment: entree.commentaire ?? null,
        reason: entree.motif,
      },
      tx,
    );

    return {
      declarationId: declaration.id,
      quantite,
      categorie: categorieFinale,
      motif: entree.motif,
      validationRequise,
    };
  }, { timeout: 60_000 });
}

export async function validerDeclaration(
  declarationId: bigint,
  acteur: ActeurStock,
  validateurEmployeId?: number | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const declaration = await tx.operationDeclaration.findUnique({
      where: { id: declarationId },
    });
    if (!declaration) throw nonTrouve("La declaration");
    if (declaration.status === "VALIDEE") {
      throw conflit("Cette declaration est deja validee.");
    }

    await tx.operationDeclaration.update({
      where: { id: declarationId },
      data: {
        status: "VALIDEE",
        validatedById: validateurEmployeId ?? null,
        validatedAt: new Date(),
      },
    });

    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.VALIDATION,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "OperationDeclaration",
        entityId: declarationId,
        userId: acteur.id,
        userEmail: acteur.email,
        oldValue: { statut: declaration.status },
        newValue: { statut: "VALIDEE" },
      },
      tx,
    );
  }, { timeout: 30_000 });
}

// -----------------------------------------------------------------------------
// Deplacement Kanban
// -----------------------------------------------------------------------------

export interface DeplacementKanbanInput {
  workOrderOperationId: number;
  quantite: Prisma.Decimal | string | number;
  commentaire?: string | null;
  employeeId?: number | null;
  /** Force le deplacement sans exiger que l'operation soit terminee. */
  forcer?: boolean;
  acteur: ActeurStock;
}

export interface ResultatKanban {
  transitionId: bigint;
  deOperation: string | null;
  versOperation: string | null;
  ordreTermine: boolean;
  transfertDivision: {
    effectue: boolean;
    article: string | null;
    quantite: string | null;
    depotSource: string | null;
    depotDestination: string | null;
  } | null;
}

/**
 * Deplace une carte Kanban : cloture l'operation courante, demarre la suivante.
 * Un deplacement est une operation metier controlee, jamais un simple
 * changement d'affichage.
 */
export async function deplacerCarteKanban(
  entree: DeplacementKanbanInput,
): Promise<ResultatKanban> {
  const quantite = D.of(entree.quantite);

  return prisma.$transaction(async (tx) => {
    const operation = await chargerOperation(tx, entree.workOrderOperationId);

    if (operation.status === "NON_DEMARREE") {
      throw etatInvalide(
        "Cette operation n'a pas encore ete demarree : impossible de la deplacer.",
      );
    }
    // Une operation deja terminee ne peut plus etre deplacee : sans ce
    // controle, un second deplacement creait une transition fantome et
    // rouvrait l'operation suivante, y compris sur un ordre deja termine.
    if (["TERMINEE", "VALIDEE", "ANNULEE"].includes(operation.status)) {
      throw etatInvalide(
        "Cette operation est deja terminee : sa carte ne peut plus etre deplacee.",
      );
    }

    const quantiteRetenue = D.gt(quantite, 0)
      ? quantite
      : operation.quantityConform;
    if (D.lte(quantiteRetenue, 0)) {
      throw validation(
        "La quantite deplacee doit etre strictement positive. Declarez d'abord la production realisee.",
      );
    }

    if (
      !entree.forcer &&
      operation.status !== "TERMINEE" &&
      D.lt(operation.quantityConform, operation.quantityPlanned)
    ) {
      const reste = D.sub(operation.quantityPlanned, operation.quantityConform);
      throw etatInvalide(
        `Production incomplete sur l'operation ${operation.operation.label} : il reste ${D.toFixed(reste, 3)} a produire. Terminez l'operation avant de la deplacer.`,
      );
    }

    const maintenant = new Date();

    const suivante = await tx.workOrderOperation.findFirst({
      where: {
        workOrderId: operation.workOrderId,
        stepNo: { gt: operation.stepNo },
      },
      orderBy: { stepNo: "asc" },
      include: { operation: true },
    });

    await tx.workOrderOperation.update({
      where: { id: operation.id },
      data: {
        status: "TERMINEE",
        actualEnd: operation.actualEnd ?? maintenant,
        pausedAt: null,
        quantityProduced: D.gt(operation.quantityProduced, 0)
          ? operation.quantityProduced
          : quantiteRetenue,
      },
    });

    if (suivante) {
      await tx.workOrderOperation.update({
        where: { id: suivante.id },
        data: {
          status: suivante.status === "NON_DEMARREE" ? "EN_COURS" : suivante.status,
          actualStart: suivante.actualStart ?? maintenant,
        },
      });
    }

    const transition = await tx.kanbanTransition.create({
      data: {
        workOrderId: operation.workOrderId,
        fromOperationId: operation.operationId,
        toOperationId: suivante?.operationId ?? null,
        fromWorkOrderOperationId: operation.id,
        toWorkOrderOperationId: suivante?.id ?? null,
        userId: entree.acteur.id,
        employeeId: entree.employeeId ?? null,
        quantity: D.roundQuantity(quantiteRetenue),
        declaredConsumptions: await resumerConsommations(tx, operation.id),
        declaredLosses: await resumerPertes(tx, operation.id),
        comment: entree.commentaire ?? null,
        occurredAt: maintenant,
      },
    });

    // Transfert automatique inter-divisions a la fin du poudrage.
    let resultatTransfert: ResultatKanban["transfertDivision"] = null;
    const ordreTermine = !suivante;

    if (ordreTermine) {
      await tx.workOrder.update({
        where: { id: operation.workOrderId },
        data: {
          status: "TERMINE",
          actualEnd: maintenant,
          quantityProduced: D.gt(operation.workOrder.quantityProduced, 0)
            ? operation.workOrder.quantityProduced
            : quantiteRetenue,
        },
      });

      resultatTransfert = await executerTransfertAutomatique(tx, {
        workOrderId: operation.workOrderId,
        operationCode: operation.operation.code,
        quantite: quantiteRetenue,
        acteur: entree.acteur,
      });
    }

    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.PRODUCTION,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "KanbanTransition",
        entityId: transition.id,
        userId: entree.acteur.id,
        userEmail: entree.acteur.email,
        oldValue: {
          operation: operation.operation.code,
          statut: operation.status,
        },
        newValue: {
          operationSuivante: suivante?.operation.code ?? null,
          quantite: quantiteRetenue.toFixed(6),
          ordreTermine,
        },
        comment: entree.commentaire ?? null,
      },
      tx,
    );

    return {
      transitionId: transition.id,
      deOperation: operation.operation.code,
      versOperation: suivante?.operation.code ?? null,
      ordreTermine,
      transfertDivision: resultatTransfert,
    };
  }, { timeout: 60_000 });
}

async function resumerConsommations(tx: Db, workOrderOperationId: number) {
  const declarations = await tx.operationDeclaration.findMany({
    where: { workOrderOperationId, kind: "CONSOMMATION" },
    include: { componentItem: { select: { code: true, label1: true } } },
  });

  return declarations.map((declaration) => ({
    article: declaration.componentItem?.code ?? null,
    libelle: declaration.componentItem?.label1 ?? null,
    quantite: declaration.quantity.toFixed(6),
    categorie: declaration.lossCategory,
  }));
}

async function resumerPertes(tx: Db, workOrderOperationId: number) {
  const declarations = await tx.operationDeclaration.findMany({
    where: { workOrderOperationId, kind: "PERTE" },
  });

  return declarations.map((declaration) => ({
    quantite: declaration.quantity.toFixed(6),
    categorie: declaration.lossCategory,
    motif: declaration.lossReason,
  }));
}

// -----------------------------------------------------------------------------
// Transfert automatique entre divisions (chassis peint ADMEDCO -> MOBILIX)
// -----------------------------------------------------------------------------

interface TransfertAutomatiqueInput {
  workOrderId: number;
  operationCode: string;
  quantite: Prisma.Decimal;
  acteur: ActeurStock;
}

/**
 * A la fin de l'operation de poudrage, le chassis peint est :
 *   1. valorise et entree en stock dans le depot ADMEDCO (DEP-MP) ;
 *   2. transfere vers le depot MOBILIX (DEP-MP-MBX) ;
 *   3. rendu disponible pour la production MOBILIX ;
 *   4. trace integralement (mouvements, document, audit).
 */
async function executerTransfertAutomatique(
  tx: Db,
  entree: TransfertAutomatiqueInput,
): Promise<ResultatKanban["transfertDivision"]> {
  const actif = await lireParametreBooleen(
    CLE_PARAMETRE.TRANSFERT_AUTO_CHASSIS_PEINT,
    true,
    tx,
  );
  if (!actif) return null;

  const regle = await tx.divisionTransferRule.findFirst({
    where: { triggerOperationCode: entree.operationCode, isActive: true },
    include: {
      producedItem: true,
      sourceWarehouse: true,
      targetWarehouse: true,
    },
  });

  if (!regle) return null;

  if (D.lte(entree.quantite, 0)) {
    throw validation(
      "La quantite produite doit etre strictement positive pour declencher le transfert inter-divisions.",
    );
  }

  const numeroTransfert = await prochainNumero(SEQUENCES.TRANSFERT, tx);
  const ordre = await tx.workOrder.findUnique({
    where: { id: entree.workOrderId },
    select: { number: true },
  });

  // Recherche d'un lot existant pour ce chassis peint dans le depot source.
  const lotExistant = await tx.stockLot.findFirst({
    where: {
      itemId: regle.producedItemId,
      warehouseId: regle.sourceWarehouseId,
    },
    orderBy: { id: "desc" },
  });

  const numeroLot =
    lotExistant?.lotNumber ??
    (await prochainNumero(SEQUENCES.LOT, tx));

  const lot =
    lotExistant ??
    (await tx.stockLot.create({
      data: {
        itemId: regle.producedItemId,
        warehouseId: regle.sourceWarehouseId,
        lotNumber: numeroLot,
        status: "LIBRE",
        manufactureDate: new Date(),
        workOrderId: entree.workOrderId,
      },
    }));

  const coutUnitaire = D.of(regle.producedItem.vwap).isZero()
    ? D.of(regle.producedItem.standardCost)
    : D.of(regle.producedItem.vwap);

  // 1. Entree en stock du semi-fini produit par le poudrage.
  await enregistrerMouvement(tx, {
    type: "PRODUCTION_SEMI_FINI",
    itemId: regle.producedItemId,
    warehouseId: regle.sourceWarehouseId,
    lotId: lot.id,
    quantity: entree.quantite,
    unitCost: coutUnitaire,
    unitCode: regle.producedItem.unitCode,
    workOrderId: entree.workOrderId,
    documentType: "ORDRE_FABRICATION",
    documentId: String(entree.workOrderId),
    documentNumber: ordre?.number ?? null,
    comment: `Production du semi-fini ${regle.producedItem.code} apres ${entree.operationCode}`,
    acteur: entree.acteur,
    sansAudit: true,
  });

  // 2. Transfert inter-ateliers vers la division MOBILIX.
  const transfert = await transfererStock(tx, {
    itemId: regle.producedItemId,
    lotId: lot.id,
    quantity: entree.quantite,
    sourceWarehouseId: regle.sourceWarehouseId,
    targetWarehouseId: regle.targetWarehouseId,
    type: "TRANSFERT_INTER_DEPOTS",
    unitCost: coutUnitaire,
    documentType: "TRANSFERT_DIVISION",
    documentId: numeroTransfert,
    documentNumber: numeroTransfert,
    workOrderId: entree.workOrderId,
    comment: `Transfert automatique ${regle.label} (regle ${regle.code})`,
    reason: `Fin de l'operation ${entree.operationCode} de l'ordre ${ordre?.number ?? entree.workOrderId}`,
    acteur: entree.acteur,
  });

  await enregistrerAudit(
    {
      action: ACTIONS_AUDIT.TRANSFERT_DIVISION,
      module: MODULES_AUDIT.PRODUCTION,
      entity: "StockMovement",
      entityId: transfert.entreeId,
      userId: entree.acteur.id,
      userEmail: entree.acteur.email,
      newValue: {
        numeroTransfert,
        article: regle.producedItem.code,
        quantite: entree.quantite.toFixed(6),
        depotSource: regle.sourceWarehouse.code,
        depotDestination: regle.targetWarehouse.code,
        ordre: ordre?.number ?? null,
        regle: regle.code,
      },
      comment: "Transfert automatique du chassis peint vers MOBILIX",
      reason: `Fin de l'operation ${entree.operationCode}`,
    },
    tx,
  );

  return {
    effectue: true,
    article: regle.producedItem.code,
    quantite: D.toFixed(entree.quantite, 3),
    depotSource: regle.sourceWarehouse.code,
    depotDestination: regle.targetWarehouse.code,
  };
}

// -----------------------------------------------------------------------------
// Cloture
// -----------------------------------------------------------------------------

export async function cloturerOrdreFabrication(
  workOrderId: number,
  acteur: ActeurStock,
  commentaire?: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const ordre = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      include: { operations: true },
    });
    if (!ordre) throw nonTrouve("L'ordre de fabrication");

    if (ordre.status === "CLOTURE") {
      throw conflit("Cet ordre de fabrication est deja cloture.");
    }
    if (ordre.status === "ANNULE") {
      throw etatInvalide("Un ordre annule ne peut pas etre cloture.");
    }

    const operationsOuvertes = ordre.operations.filter(
      (operation) => !["TERMINEE", "VALIDEE", "ANNULEE"].includes(operation.status),
    );
    if (operationsOuvertes.length > 0) {
      throw etatInvalide(
        `Cloture impossible : ${operationsOuvertes.length} operation(s) ne sont pas terminees.`,
      );
    }

    await tx.workOrder.update({
      where: { id: workOrderId },
      data: {
        status: "CLOTURE",
        actualEnd: ordre.actualEnd ?? new Date(),
        notes: commentaire
          ? `${ordre.notes ? `${ordre.notes}\n` : ""}Cloture : ${commentaire}`
          : ordre.notes,
      },
    });

    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.VALIDATION,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "WorkOrder",
        entityId: workOrderId,
        userId: acteur.id,
        userEmail: acteur.email,
        oldValue: { statut: ordre.status },
        newValue: { statut: "CLOTURE" },
        comment: commentaire ?? "Cloture de l'ordre de fabrication",
      },
      tx,
    );
  }, { timeout: 30_000 });
}

export async function annulerOrdreFabrication(
  workOrderId: number,
  motif: string,
  acteur: ActeurStock,
): Promise<void> {
  if (!motif || motif.trim().length < 5) {
    throw validation("Un motif d'annulation d'au moins 5 caracteres est obligatoire.");
  }

  await prisma.$transaction(async (tx) => {
    const ordre = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      include: { operations: true, materials: true },
    });
    if (!ordre) throw nonTrouve("L'ordre de fabrication");

    if (["CLOTURE", "TERMINE"].includes(ordre.status)) {
      throw etatInvalide(
        "Un ordre termine ou cloture ne peut pas etre annule : creez une correction de stock si necessaire.",
      );
    }

    const consommationExistante = ordre.materials.some((matiere) =>
      D.gt(matiere.quantityConsumed, 0),
    );
    if (consommationExistante) {
      throw etatInvalide(
        "Des composants ont deja ete consommes : annulez d'abord les mouvements de consommation correspondants.",
      );
    }

    await tx.workOrder.update({
      where: { id: workOrderId },
      data: { status: "ANNULE", quantityRemaining: D.ZERO },
    });

    await tx.workOrderOperation.updateMany({
      where: { workOrderId, status: { in: ["NON_DEMARREE", "EN_COURS", "EN_PAUSE"] } },
      data: { status: "ANNULEE" },
    });

    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.ANNULATION,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "WorkOrder",
        entityId: workOrderId,
        userId: acteur.id,
        userEmail: acteur.email,
        oldValue: { statut: ordre.status },
        newValue: { statut: "ANNULE" },
        reason: motif,
      },
      tx,
    );
  }, { timeout: 30_000 });
}

/** Recalcule et met a jour le statut d'un ordre a partir de ses operations. */
export async function recalculerStatutOrdre(
  tx: Db,
  workOrderId: number,
): Promise<WorkOrderStatus> {
  const ordre = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    include: { operations: true },
  });
  if (!ordre) throw nonTrouve("L'ordre de fabrication");

  const toutesTerminees = ordre.operations.every((operation) =>
    ["TERMINEE", "VALIDEE"].includes(operation.status),
  );
  const aucuneDemarree = ordre.operations.every(
    (operation) => operation.status === "NON_DEMARREE",
  );
  const uneEnCours = ordre.operations.some((operation) =>
    ["EN_COURS", "EN_PAUSE"].includes(operation.status),
  );

  let statut: WorkOrderStatus = ordre.status;
  if (toutesTerminees && ordre.operations.length > 0) {
    statut = "TERMINE";
  } else if (uneEnCours) {
    statut = "EN_COURS";
  } else if (!aucuneDemarree) {
    statut = "EN_COURS";
  }

  if (statut !== ordre.status) {
    await tx.workOrder.update({ where: { id: workOrderId }, data: { status: statut } });
  }

  return statut;
}

// -----------------------------------------------------------------------------
// Consultations
// -----------------------------------------------------------------------------

export interface FiltresOrdres {
  statut?: WorkOrderStatus;
  factory?: Factory;
  itemId?: number;
  recherche?: string;
  enRetard?: boolean;
  page?: number;
  taille?: number;
}

export async function listerOrdresFabrication(
  filtres: FiltresOrdres,
  usinesAutorisees?: Factory[],
) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(200, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.WorkOrderWhereInput = {};
  if (filtres.statut) where.status = filtres.statut;
  if (filtres.factory) where.factory = filtres.factory;
  if (filtres.itemId) where.itemId = filtres.itemId;
  if (usinesAutorisees) where.factory = { in: usinesAutorisees };
  if (filtres.enRetard) {
    where.dueDate = { lt: new Date() };
    where.status = {
      notIn: ["TERMINE", "CLOTURE", "ANNULE"],
    };
  }
  if (filtres.recherche) {
    where.OR = [
      { number: { contains: filtres.recherche, mode: "insensitive" } },
      { item: { code: { contains: filtres.recherche, mode: "insensitive" } } },
      { item: { label1: { contains: filtres.recherche, mode: "insensitive" } } },
    ];
  }

  const [total, lignes] = await Promise.all([
    prisma.workOrder.count({ where }),
    prisma.workOrder.findMany({
      where,
      orderBy: [{ dueDate: "asc" }, { id: "desc" }],
      skip: (page - 1) * taille,
      take: taille,
      include: {
        item: { select: { code: true, label1: true, unitCode: true } },
        customer: { select: { id: true, code: true, label1: true } },
        salesOrder: { select: { id: true, number: true } },
        operations: {
          orderBy: { stepNo: "asc" },
          include: { operation: { select: { code: true, label: true } } },
        },
      },
    }),
  ]);

  return {
    lignes,
    total,
    page,
    taille,
    pages: Math.max(1, Math.ceil(total / taille)),
  };
}

export interface CarteKanban {
  workOrderOperationId: number;
  workOrderId: number;
  numeroOrdre: string;
  articleCode: string;
  articleLabel: string;
  clientLabel: string | null;
  quantitePlanifiee: Prisma.Decimal;
  quantiteProduite: Prisma.Decimal;
  quantiteConforme: Prisma.Decimal;
  priorite: Priority;
  datePrevue: Date | null;
  enRetard: boolean;
  operateur: string | null;
  equipe: string | null;
  statutQualite: string | null;
  depot: string | null;
  alertesMatiere: number;
  statut: OperationStatus;
  couleurPriorite: string;
}

const COULEURS_PRIORITE: Record<Priority, string> = {
  BASSE: "gris",
  NORMALE: "bleu",
  HAUTE: "orange",
  URGENTE: "rouge",
};

/** Cartes Kanban d'une division : une carte par operation d'ordre actif. */
export async function cartesKanban(
  factory: Factory,
  operationCode?: string,
): Promise<CarteKanban[]> {
  const operations = await prisma.workOrderOperation.findMany({
    where: {
      workOrder: {
        factory,
        status: {
          notIn: ["CLOTURE", "ANNULE", "TERMINE"],
        },
      },
      status: { notIn: ["ANNULEE"] },
      ...(operationCode ? { operation: { code: operationCode } } : {}),
    },
    include: {
      operation: { select: { code: true, label: true, boardOrder: true } },
      operator: { select: { firstName: true, lastName: true } },
      workOrder: {
        include: {
          item: { select: { code: true, label1: true } },
          salesOrder: { include: { customer: { select: { label1: true } } } },
          sourceWarehouse: { select: { code: true } },
        },
      },
      materials: { select: { quantityPlanned: true, quantityConsumed: true } },
    },
    orderBy: [{ workOrder: { dueDate: "asc" } }, { boardOrder: "asc" }],
  });

  const maintenant = new Date();

  return operations.map((operation) => {
    const alertesMatiere = operation.materials.filter((matiere) =>
      D.lt(matiere.quantityConsumed, matiere.quantityPlanned),
    ).length;

    return {
      workOrderOperationId: operation.id,
      workOrderId: operation.workOrderId,
      numeroOrdre: operation.workOrder.number,
      articleCode: operation.workOrder.item.code,
      articleLabel: operation.workOrder.item.label1,
      clientLabel: operation.workOrder.salesOrder?.customer.label1 ?? null,
      quantitePlanifiee: operation.quantityPlanned,
      quantiteProduite: operation.quantityProduced,
      quantiteConforme: operation.quantityConform,
      priorite: operation.workOrder.priority,
      datePrevue: operation.workOrder.dueDate,
      enRetard: Boolean(
        operation.workOrder.dueDate && operation.workOrder.dueDate < maintenant,
      ),
      operateur: operation.operator
        ? `${operation.operator.firstName} ${operation.operator.lastName}`.trim()
        : null,
      equipe: operation.teamLabel,
      statutQualite: operation.qualityStatus,
      depot: operation.workOrder.sourceWarehouse?.code ?? null,
      alertesMatiere,
      statut: operation.status,
      couleurPriorite: COULEURS_PRIORITE[operation.workOrder.priority],
    };
  });
}
