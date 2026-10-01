import { Prisma, type Factory } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D } from "@/lib/decimal";
import { accesRefuse, nonTrouve } from "@/lib/errors";
import { aLaPermission, peutAccederUsine } from "@/lib/rbac/guard";
import type { SessionUser } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  branchesEnAttente,
  positionSousStock,
  sousStockDeSortie,
  type BrancheEnAttente,
} from "@/lib/mes/sous-stocks";

/**
 * Donnees d'un portail d'operation pour UN operateur et UNE etape d'OF.
 *
 * Cette fonction est la source unique de verite des pages `/portail/operation`.
 * Elle applique les memes regles que les actions serveur :
 *  - la division de l'OF doit etre dans le perimetre du compte ;
 *  - l'operation doit etre reellement affectee a l'employe connecte ;
 *  - aucune donnee d'un autre employe n'est lue ni rendue.
 */

export const STATUTS_AFFECTATION_ACTIVE = [
  "PLANIFIEE",
  "EN_COURS",
  "EN_PAUSE",
] as const;

export interface EtapePortail {
  stepNo: number;
  operationId: number;
  instructions: string | null;
  isQualityGate: boolean;
  isFinalStep: boolean;
  standardTimeMinutes: Prisma.Decimal;
  setupTimeMinutes: Prisma.Decimal;
  description: string | null;
  producedItem: { code: string; label1: string; unitCode: string | null } | null;
}

export interface ExecutionOperationPortail {
  id: number;
  stepNo: number;
  status: string;
  boardOrder: number;
  quantityPlanned: Prisma.Decimal;
  quantityProduced: Prisma.Decimal;
  quantityConform: Prisma.Decimal;
  quantityScrapped: Prisma.Decimal;
  quantityRework: Prisma.Decimal;
  quantityConsumed: Prisma.Decimal;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  pausedAt: Date | null;
  totalPausedMs: bigint;
  operatorId: number | null;
  teamLabel: string | null;
  qualityStatus: string | null;
  notes: string | null;
}

export interface OperationPortail {
  execution: ExecutionOperationPortail;
  operation: {
    id: number;
    code: string;
    label: string;
    factory: Factory;
    workshopId: number | null;
    standardTimeMinutes: Prisma.Decimal;
    standardLossRate: Prisma.Decimal;
    requiresQualityCheck: boolean;
    consumesSemiFinished: boolean;
    producesSemiFinished: boolean;
    isKanbanVisible: boolean;
    boardOrder: number;
    colorCode: string | null;
    description: string | null;
  };
  workOrder: {
    id: number;
    number: string;
    factory: Factory;
    status: string;
    priority: string;
    quantityPlanned: Prisma.Decimal;
    quantityProduced: Prisma.Decimal;
    quantityConform: Prisma.Decimal;
    quantityScrapped: Prisma.Decimal;
    quantityRework: Prisma.Decimal;
    quantityRemaining: Prisma.Decimal;
    dueDate: Date | null;
    itemId: number;
    item: { id: number; code: string; label1: string; unitCode: string | null };
    workshop: { id: number; code: string; label: string } | null;
    route: {
      id: number;
      code: string;
      label: string;
      steps: EtapePortail[];
    } | null;
  };
  workCenter: {
    id: number;
    code: string;
    label: string;
    location: string | null;
    workshop: { id: number; code: string; label: string } | null;
  } | null;
  operator: {
    id: number;
    matricule: string;
    firstName: string;
    lastName: string;
    jobTitle: string | null;
  } | null;
  affectations: {
    id: number;
    status: string;
    date: Date;
    plannedStart: Date | null;
    plannedEnd: Date | null;
    actualStart: Date | null;
    actualEnd: Date | null;
    breakMinutes: number;
    comment: string | null;
    priority: string;
    sequenceOrder: number;
    plannedQuantity: Prisma.Decimal;
    workCenter: { id: number; code: string; label: string } | null;
    scannedWorkCenter: { id: number; code: string; label: string } | null;
    scannedAt: Date | null;
    plannedLot: { id: number; lotNumber: string } | null;
    changes: {
      changeType: string;
      reason: string | null;
      changedAt: Date;
      previousWorkCenterId: number | null;
      newWorkCenterId: number | null;
    }[];
  }[];
  matieres: {
    id: number;
    itemId: number;
    code: string;
    label: string;
    unite: string | null;
    planifiee: ReturnType<typeof D.of>;
    sortie: ReturnType<typeof D.of>;
    consommee: ReturnType<typeof D.of>;
    manque: ReturnType<typeof D.of>;
  }[];
  declarations: {
    id: bigint;
    kind: string;
    status: string;
    quantity: ReturnType<typeof D.of>;
    quantityConform: ReturnType<typeof D.of>;
    occurredAt: Date;
    lossCategory: string | null;
    lossReason: string | null;
    comment: string | null;
    componentItem: { code: string; label1: string; unitCode: string | null } | null;
  }[];
  etapeGamme: EtapePortail | null;
  etapePrecedente: EtapePortail | null;
  etapeSuivante: EtapePortail | null;
  sousStock: {
    id: number;
    code: string;
    label: string;
    warehouseId: number;
    locationId: number;
  } | null;
  positionSousStock: Awaited<ReturnType<typeof positionSousStock>> | null;
  branchesManquantes: BrancheEnAttente[];
  transferts: { quantite: ReturnType<typeof D.of>; nombre: number };
  enAttenteValidation: ReturnType<typeof D.of>;
  validee: ReturnType<typeof D.of>;
  resteAProduire: ReturnType<typeof D.of>;
  peutCloturerOrdre: boolean;
  affectationCourante: OperationPortail["affectations"][number] | null;
}

export async function chargerOperationPortail(
  workOrderOperationId: number,
  employeeId: number,
  utilisateur: SessionUser,
  db: Db = prisma,
): Promise<OperationPortail> {
  const brut = await db.workOrderOperation.findUnique({
    where: { id: workOrderOperationId },
    include: {
      operation: {
        select: {
          id: true,
          code: true,
          label: true,
          factory: true,
          workshopId: true,
          standardTimeMinutes: true,
          standardLossRate: true,
          requiresQualityCheck: true,
          consumesSemiFinished: true,
          producesSemiFinished: true,
          isKanbanVisible: true,
          boardOrder: true,
          colorCode: true,
          description: true,
        },
      },
      workOrder: {
        select: {
          id: true,
          number: true,
          factory: true,
          status: true,
          priority: true,
          quantityPlanned: true,
          quantityProduced: true,
          quantityConform: true,
          quantityScrapped: true,
          quantityRework: true,
          quantityRemaining: true,
          dueDate: true,
          itemId: true,
          item: {
            select: { id: true, code: true, label1: true, unitCode: true },
          },
          workshop: { select: { id: true, code: true, label: true } },
          route: {
            select: {
              id: true,
              code: true,
              label: true,
              steps: {
                select: {
                  stepNo: true,
                  operationId: true,
                  instructions: true,
                  isQualityGate: true,
                  isFinalStep: true,
                  standardTimeMinutes: true,
                  setupTimeMinutes: true,
                  description: true,
                  producedItem: {
                    select: { code: true, label1: true, unitCode: true },
                  },
                },
                orderBy: { stepNo: "asc" },
              },
            },
          },
        },
      },
      workCenter: {
        select: {
          id: true,
          code: true,
          label: true,
          location: true,
          workshop: { select: { id: true, code: true, label: true } },
        },
      },
      operator: {
        select: {
          id: true,
          matricule: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
        },
      },
      assignments: {
        where: {
          employeeId,
          status: { not: "ANNULEE" },
        },
        select: {
          id: true,
          status: true,
          date: true,
          plannedStart: true,
          plannedEnd: true,
          actualStart: true,
          actualEnd: true,
          breakMinutes: true,
          comment: true,
          priority: true,
          sequenceOrder: true,
          plannedQuantity: true,
          workCenter: { select: { id: true, code: true, label: true } },
          scannedWorkCenter: { select: { id: true, code: true, label: true } },
          scannedAt: true,
          plannedLot: { select: { id: true, lotNumber: true } },
          changes: {
            select: {
              changeType: true,
              reason: true,
              changedAt: true,
              previousWorkCenterId: true,
              newWorkCenterId: true,
            },
            orderBy: { changedAt: "asc" },
          },
        },
        orderBy: { sequenceOrder: "asc" },
      },
      materials: {
        where: { isLabor: false },
        include: {
          componentItem: {
            select: { id: true, code: true, label1: true, unitCode: true },
          },
        },
        orderBy: { lineNo: "asc" },
      },
      declarations: {
        where: { employeeId },
        include: {
          componentItem: {
            select: { code: true, label1: true, unitCode: true },
          },
        },
        orderBy: { occurredAt: "desc" },
        take: 100,
      },
    },
  });

  if (!brut) throw nonTrouve("L'operation de fabrication");
  if (!peutAccederUsine(utilisateur, brut.workOrder.factory)) {
    throw accesRefuse(
      "Cette operation appartient a une division hors de votre perimetre.",
    );
  }

  const operation = brut.operation;
  const workOrder = brut.workOrder;
  const affectations = brut.assignments;
  const affectationActive =
    affectations.find((affectation) =>
      STATUTS_AFFECTATION_ACTIVE.includes(
        affectation.status as (typeof STATUTS_AFFECTATION_ACTIVE)[number],
      ),
    ) ?? null;
  const affectationCourante = affectationActive ?? affectations[0] ?? null;

  const estOperateur =
    brut.operatorId === employeeId || affectationActive !== null;
  if (!estOperateur) {
    throw accesRefuse(
      "Cette operation ne vous est pas affectee : le portail n'autorise d'agir que sur vos propres operations.",
    );
  }

  const etapeGamme =
    workOrder.route?.steps.find(
      (etape) =>
        etape.stepNo === brut.stepNo && etape.operationId === brut.operationId,
    ) ?? null;
  const etapePrecedente =
    workOrder.route?.steps
      .filter((etape) => etape.stepNo < brut.stepNo)
      .reduce<EtapePortail | null>(
        (precedente, etape) =>
          !precedente || etape.stepNo > precedente.stepNo ? etape : precedente,
        null,
      ) ?? null;
  const etapeSuivante =
    workOrder.route?.steps
      .filter((etape) => etape.stepNo > brut.stepNo)
      .reduce<EtapePortail | null>(
        (suivante, etape) =>
          !suivante || etape.stepNo < suivante.stepNo ? etape : suivante,
        null,
      ) ?? null;

  const matieres = brut.materials.map((matiere) => {
    const planifiee = D.of(matiere.quantityPlanned);
    const sortie = D.of(matiere.quantityIssued);
    const consommee = D.of(matiere.quantityConsumed);
    return {
      id: matiere.id,
      itemId: matiere.componentItemId,
      code: matiere.componentItem.code,
      label: matiere.componentItem.label1,
      unite: matiere.unitCode ?? matiere.componentItem.unitCode,
      planifiee,
      sortie,
      consommee,
      manque: D.max(D.sub(planifiee, sortie), D.of(0)),
    };
  });

  const declarations = brut.declarations.map((declaration) => ({
    id: declaration.id,
    kind: declaration.kind,
    status: declaration.status,
    quantity: D.of(declaration.quantity),
    quantityConform: D.of(declaration.quantityConform),
    occurredAt: declaration.occurredAt,
    lossCategory: declaration.lossCategory,
    lossReason: declaration.lossReason,
    comment: declaration.comment,
    componentItem: declaration.componentItem,
  }));

  const declarationsParStatut = await db.operationDeclaration.groupBy({
    by: ["status"],
    where: {
      workOrderOperationId: brut.id,
      kind: "PRODUCTION",
    },
    _sum: { quantityConform: true },
  });
  let enAttenteValidation = D.of(0);
  let validee = D.of(0);
  for (const groupe of declarationsParStatut) {
    const quantite = D.of(groupe._sum.quantityConform);
    if (groupe.status === "VALIDEE") {
      validee = D.add(validee, quantite);
    } else if (groupe.status === "SAISIE" || groupe.status === "SOUMISE") {
      enAttenteValidation = D.add(enAttenteValidation, quantite);
    }
  }

  const sousStock = await sousStockDeSortie(
    db,
    brut.operationId,
    workOrder.factory,
  );
  let position = null;
  let branchesManquantes: BrancheEnAttente[] = [];
  if (sousStock) {
    position = await positionSousStock(db, {
      subStockId: sousStock.id,
      itemId: workOrder.itemId,
    });
    branchesManquantes = await branchesEnAttente(db, {
      toSubStockId: sousStock.id,
      itemId: workOrder.itemId,
      quantiteRequise: D.max(
        D.sub(workOrder.quantityPlanned, workOrder.quantityConform),
        D.of(0),
      ),
    });
  }

  const transferts = await db.operationStepTransfer.aggregate({
    where: { workOrderOperationId: brut.id },
    _sum: { quantity: true },
    _count: { _all: true },
  });

  return {
    execution: {
      id: brut.id,
      stepNo: brut.stepNo,
      status: brut.status,
      boardOrder: brut.boardOrder,
      quantityPlanned: brut.quantityPlanned,
      quantityProduced: brut.quantityProduced,
      quantityConform: brut.quantityConform,
      quantityScrapped: brut.quantityScrapped,
      quantityRework: brut.quantityRework,
      quantityConsumed: brut.quantityConsumed,
      plannedStart: brut.plannedStart,
      plannedEnd: brut.plannedEnd,
      actualStart: brut.actualStart,
      actualEnd: brut.actualEnd,
      pausedAt: brut.pausedAt,
      totalPausedMs: brut.totalPausedMs,
      operatorId: brut.operatorId,
      teamLabel: brut.teamLabel,
      qualityStatus: brut.qualityStatus,
      notes: brut.notes,
    },
    operation,
    workOrder,
    workCenter: brut.workCenter,
    operator: brut.operator,
    affectations,
    matieres,
    declarations,
    etapeGamme,
    etapePrecedente,
    etapeSuivante,
    sousStock: sousStock
      ? {
          id: sousStock.id,
          code: sousStock.code,
          label: sousStock.label,
          warehouseId: sousStock.warehouseId,
          locationId: sousStock.locationId,
        }
      : null,
    positionSousStock: position,
    branchesManquantes,
    transferts: {
      quantite: D.of(transferts._sum.quantity),
      nombre: transferts._count._all,
    },
    enAttenteValidation,
    validee,
    resteAProduire: D.max(
      D.sub(workOrder.quantityPlanned, workOrder.quantityConform),
      D.of(0),
    ),
    peutCloturerOrdre: aLaPermission(
      utilisateur,
      PERMISSIONS.PRODUCTION_CLOTURER,
    ),
    affectationCourante,
  };
}
