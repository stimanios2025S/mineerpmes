import type { Factory, Prisma } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D } from "@/lib/decimal";
import { nonTrouve } from "@/lib/errors";
import { quantiteDisponible } from "@/lib/stock/service";

/**
 * Feuille de route vivante d'un ordre de fabrication.
 *
 * Principe : a tout moment, on doit pouvoir dire OU sont les quantites, et QUI
 * a fait quoi. Pas « l'OF est a l'etape 3 », mais « 500 lancees, 100 en couture
 * dont 96 conformes validees, 3 en reprise, 1 rebut, et 96 arrivees a
 * l'assemblage ».
 *
 * Consequence stricte : une etape ne peut JAMAIS etre affichee comme arrivee a
 * la suivante tant que ses quantites conformes validees ne sont pas
 * effectivement transferees. `quantiteTransferee` vient des ecritures reelles
 * du grand livre, pas d'une intention.
 */

export interface LigneEtape {
  workOrderOperationId: number;
  stepNo: number;
  operationId: number;
  operationCode: string;
  operationLabel: string;
  status: string;
  workCenterId: number | null;
  poste: string | null;

  quantitePlanifiee: Prisma.Decimal;
  /** Declare produite, validee ou non. */
  quantiteProduite: Prisma.Decimal;
  /** Declare conforme et deja validee par un responsable. */
  quantiteValidee: Prisma.Decimal;
  /** Declare conforme mais encore en attente de validation. */
  quantiteEnAttenteValidation: Prisma.Decimal;
  quantiteReprise: Prisma.Decimal;
  quantiteRebut: Prisma.Decimal;

  /** Conforme effectivement arrivee a l'etape suivante, via le grand livre. */
  quantiteTransferee: Prisma.Decimal;
  /** Present dans le sous-stock de sortie de cette etape, pret a partir. */
  quantiteDansSousStock: Prisma.Decimal;
  sousStockCode: string | null;
  /** Identifiant du sous-stock de sortie : necessaire pour transferer. */
  sousStockId: number | null;
  /** Sous-stocks d'etape suivante declares comme alimentes par cette etape. */
  destinations: { id: number; code: string; label: string; isRequired: boolean }[];

  /** Ce qui manque pour que la quantite planifiee soit au complet. */
  quantiteRestante: Prisma.Decimal;

  /** Vrai seulement si la quantite planifiee a reellement ete transferee. */
  complete: boolean;
  /** Vrai si l'etape suivante peut demarrer sur cette base. */
  alimenteEtapeSuivante: boolean;

  /** Qui a travaille sur cette etape, d'apres les declarations reelles. */
  acteurs: { employeeId: number | null; nom: string; declarations: number }[];
  debutReel: Date | null;
  finReelle: Date | null;
  tempsPauseMs: bigint;
}

export interface FeuilleDeRoute {
  workOrderId: number;
  numero: string;
  itemId: number;
  itemCode: string;
  itemLabel: string;
  factory: Factory;
  statut: string;
  priorite: string;
  dueDate: Date | null;

  quantitePlanifiee: Prisma.Decimal;
  quantiteLancee: Prisma.Decimal;
  quantiteProduite: Prisma.Decimal;
  quantiteConforme: Prisma.Decimal;
  quantiteReprise: Prisma.Decimal;
  quantiteRebut: Prisma.Decimal;

  decisionQualite: string | null;
  libereQualiteLe: Date | null;

  etapes: LigneEtape[];

  /** Transferts reels, du plus recent au plus ancien : la tracabilite du passage. */
  transferts: {
    id: bigint;
    occurredAt: Date;
    quantity: Prisma.Decimal;
    de: string;
    vers: string;
    article: string;
    operation: string;
    validePar: string | null;
    comment: string | null;
  }[];

  /** Ce que la direction doit voir : ce qui bloque, ce qui derape. */
  alertes: string[];
}

/** Feuille de route complete d'un ordre de fabrication. */
export async function feuilleDeRouteOrdre(
  workOrderId: number,
  db: Db = prisma,
): Promise<FeuilleDeRoute> {
  const ordre = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      item: { select: { code: true, label1: true } },
      operations: {
        orderBy: { stepNo: "asc" },
        include: {
          operation: { select: { id: true, code: true, label: true } },
          workCenter: { select: { id: true, code: true, label: true } },
        },
      },
    },
  });
  if (!ordre) throw nonTrouve("L'ordre de fabrication");

  const operationIds = ordre.operations.map((operation) => operation.id);

  const [declarations, transferts, sousStocks] = await Promise.all([
    db.operationDeclaration.findMany({
      where: { workOrderId: ordre.id },
      select: {
        workOrderOperationId: true,
        kind: true,
        status: true,
        quantity: true,
        quantityConform: true,
        employeeId: true,
        occurredAt: true,
        employee: { select: { firstName: true, lastName: true } },
      },
      orderBy: { occurredAt: "asc" },
    }),
    db.operationStepTransfer.findMany({
      where: { workOrderId: ordre.id },
      include: {
        fromSubStock: { select: { code: true, label: true } },
        toSubStock: { select: { code: true, label: true } },
        item: { select: { code: true } },
        operation: { select: { label: true } },
        validatedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { occurredAt: "desc" },
    }),
    db.operationSubStock.findMany({
      where: { operationId: { in: ordre.operations.map((o) => o.operationId) } },
      include: {
        location: { select: { id: true, code: true } },
        outgoingLinks: {
          include: {
            toSubStock: { select: { id: true, code: true, label: true } },
          },
        },
      },
      orderBy: { sequenceOrder: "asc" },
    }),
  ]);

  const soldes = sousStocks.length
    ? await db.stockBalance.findMany({
        where: {
          locationId: { in: sousStocks.map((sousStock) => sousStock.locationId) },
          itemId: ordre.itemId,
        },
      })
    : [];

  const etapes: LigneEtape[] = [];

  for (const operation of ordre.operations) {
    const lignes = declarations.filter(
      (declaration) => declaration.workOrderOperationId === operation.id,
    );

    const conformesValidees = D.sum(
      lignes
        .filter(
          (ligne) => ligne.kind === "PRODUCTION" && ligne.status === "VALIDEE",
        )
        .map((ligne) => ligne.quantityConform),
    );

    const conformesEnAttente = D.sum(
      lignes
        .filter(
          (ligne) =>
            ligne.kind === "PRODUCTION" &&
            (ligne.status === "SAISIE" || ligne.status === "SOUMISE"),
        )
        .map((ligne) => ligne.quantityConform),
    );

    const sousStockSortie = sousStocks.find(
      (sousStock) =>
        sousStock.operationId === operation.operationId &&
        (sousStock.kind === "SORTIE_OPERATION" ||
          sousStock.kind === "ENTREE_OPERATION"),
    );

    const quantiteDansSousStock = sousStockSortie
      ? D.sum(
          soldes
            .filter((solde) => solde.locationId === sousStockSortie.locationId)
            .map((solde) => quantiteDisponible(solde)),
        )
      : D.of(0);

    const quantiteTransferee = D.sum(
      transferts
        .filter((transfert) => transfert.workOrderOperationId === operation.id)
        .map((transfert) => transfert.quantity),
    );

    // Acteurs reels : uniquement ceux qui ont declare quelque chose.
    const parEmploye = new Map<
      number,
      { employeeId: number | null; nom: string; declarations: number }
    >();
    for (const ligne of lignes) {
      const cle = ligne.employeeId ?? 0;
      const existant = parEmploye.get(cle);
      const nom = ligne.employee
        ? `${ligne.employee.firstName} ${ligne.employee.lastName}`
        : "Compte sans fiche employe";
      if (existant) {
        existant.declarations += 1;
      } else {
        parEmploye.set(cle, {
          employeeId: ligne.employeeId,
          nom,
          declarations: 1,
        });
      }
    }

    const quantitePlanifiee = D.of(operation.quantityPlanned);
    const quantiteRestante = D.max(
      D.sub(quantitePlanifiee, quantiteTransferee),
      D.of(0),
    );

    etapes.push({
      workOrderOperationId: operation.id,
      stepNo: operation.stepNo,
      operationId: operation.operationId,
      operationCode: operation.operation.code,
      operationLabel: operation.operation.label,
      status: operation.status,
      workCenterId: operation.workCenterId,
      poste: operation.workCenter
        ? `${operation.workCenter.code} — ${operation.workCenter.label}`
        : null,

      quantitePlanifiee,
      quantiteProduite: D.of(operation.quantityProduced),
      quantiteValidee: conformesValidees,
      quantiteEnAttenteValidation: conformesEnAttente,
      quantiteReprise: D.of(operation.quantityRework),
      quantiteRebut: D.of(operation.quantityScrapped),

      quantiteTransferee,
      quantiteDansSousStock,
      sousStockCode: sousStockSortie?.code ?? null,
      sousStockId: sousStockSortie?.id ?? null,
      destinations:
        sousStockSortie?.outgoingLinks.map((lien) => ({
          id: lien.toSubStock.id,
          code: lien.toSubStock.code,
          label: lien.toSubStock.label,
          isRequired: lien.isRequired,
        })) ?? [],
      quantiteRestante,

      complete: D.gte(quantiteTransferee, quantitePlanifiee) && D.gt(quantitePlanifiee, 0),
      // Une etape alimente la suivante seulement sur ce qui est REELLEMENT
      // arrive : jamais sur une intention ni sur une declaration non validee.
      alimenteEtapeSuivante: D.gt(quantiteTransferee, 0),

      acteurs: [...parEmploye.values()],
      debutReel: operation.actualStart,
      finReelle: operation.actualEnd,
      tempsPauseMs: operation.totalPausedMs,
    });
  }

  const alertes: string[] = [];
  for (const etape of etapes) {
    if (D.gt(etape.quantiteReprise, 0)) {
      alertes.push(
        `${etape.operationLabel} : ${D.toFixed(etape.quantiteReprise, 3)} en reprise.`,
      );
    }
    if (D.gt(etape.quantiteRebut, 0)) {
      alertes.push(
        `${etape.operationLabel} : ${D.toFixed(etape.quantiteRebut, 3)} rebutés.`,
      );
    }
    if (D.gt(etape.quantiteEnAttenteValidation, 0)) {
      alertes.push(
        `${etape.operationLabel} : ${D.toFixed(etape.quantiteEnAttenteValidation, 3)} en attente de validation.`,
      );
    }
    if (etape.complete === false && D.gt(etape.quantiteValidee, 0) && D.eq(etape.quantiteDansSousStock, 0)) {
      alertes.push(
        `${etape.operationLabel} : ${D.toFixed(etape.quantiteValidee, 3)} conforme(s) validee(s) mais rien n'est arrive au sous-stock de sortie.`,
      );
    }
  }
  if (!ordre.qualityReleasedAt && ordre.status === "EN_CONTROLE_QUALITE") {
    alertes.push(
      "L'ordre est en controle qualite : aucune quantite ne doit etre livree avant la levee.",
    );
  }

  return {
    workOrderId: ordre.id,
    numero: ordre.number,
    itemId: ordre.itemId,
    itemCode: ordre.item.code,
    itemLabel: ordre.item.label1,
    factory: ordre.factory,
    statut: ordre.status,
    priorite: ordre.priority,
    dueDate: ordre.dueDate,

    quantitePlanifiee: D.of(ordre.quantityPlanned),
    quantiteLancee: D.of(ordre.quantityLaunched),
    quantiteProduite: D.of(ordre.quantityProduced),
    quantiteConforme: D.of(ordre.quantityConform),
    quantiteReprise: D.of(ordre.quantityRework),
    quantiteRebut: D.of(ordre.quantityScrapped),

    decisionQualite: ordre.qualityStatus,
    libereQualiteLe: ordre.qualityReleasedAt,

    etapes,

    transferts: transferts.map((transfert) => ({
      id: transfert.id,
      occurredAt: transfert.occurredAt,
      quantity: transfert.quantity,
      de: transfert.fromSubStock.label,
      vers: transfert.toSubStock.label,
      article: transfert.item.code,
      operation: transfert.operation.label,
      validePar: transfert.validatedBy
        ? `${transfert.validatedBy.firstName} ${transfert.validatedBy.lastName}`
        : null,
      comment: transfert.comment,
    })),

    alertes,
  };
}

export interface LigneTableauProprietaire {
  workOrderId: number;
  numero: string;
  article: string;
  factory: Factory;
  statut: string;
  priorite: string;
  dueDate: Date | null;
  quantitePlanifiee: Prisma.Decimal;
  quantiteProduite: Prisma.Decimal;
  quantiteConforme: Prisma.Decimal;
  quantiteReprise: Prisma.Decimal;
  quantiteRebut: Prisma.Decimal;
  avancementPourcent: number;
  /** Etape en cours, au sens reel : celle qui a du travail engage. */
  etapeEnCours: string | null;
  /** La derniere quantite reellement arrivee a une etape. */
  derniereArrivee: Prisma.Decimal | null;
  enAttenteValidation: Prisma.Decimal;
  alertes: string[];
}

/**
 * Tableau du proprietaire : pour chaque ordre en cours, ou en sont reellement
 * les quantites. Les blocs sont calcules a partir des memes donnees que la
 * feuille de route — un seul calcul, une seule verite.
 */
export async function tableauDeBordProprietaire(
  filtres: { factory?: Factory; limite?: number } = {},
  db: Db = prisma,
): Promise<LigneTableauProprietaire[]> {
  const ordres = await db.workOrder.findMany({
    where: {
      status: {
        in: [
          "LANCE",
          "EN_COURS",
          "SUSPENDU",
          "EN_CONTROLE_QUALITE",
          "PARTIELLEMENT_TERMINE",
        ],
      },
      ...(filtres.factory ? { factory: filtres.factory } : {}),
    },
    select: {
      id: true,
      number: true,
      factory: true,
      status: true,
      priority: true,
      dueDate: true,
      item: { select: { code: true, label1: true } },
      operations: {
        where: { status: { in: ["EN_COURS", "EN_PAUSE"] } },
        select: { operation: { select: { label: true } } },
        orderBy: { stepNo: "asc" },
      },
    },
    orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
    take: Math.min(200, Math.max(1, filtres.limite ?? 40)),
  });

  const lignes: LigneTableauProprietaire[] = [];

  for (const ordre of ordres) {
    const feuille = await feuilleDeRouteOrdre(ordre.id, db);

    const avancement =
      D.gt(feuille.quantitePlanifiee, 0)
        ? D.toNumber(
            D.div(
              D.mul(feuille.quantiteConforme, 100),
              feuille.quantitePlanifiee,
            ),
          )
        : 0;

    const enAttente = D.sum(
      feuille.etapes.map((etape) => etape.quantiteEnAttenteValidation),
    );

    const arrivees = feuille.etapes
      .filter((etape) => D.gt(etape.quantiteTransferee, 0))
      .map((etape) => etape.quantiteTransferee);

    lignes.push({
      workOrderId: ordre.id,
      numero: ordre.number,
      article: `${ordre.item.code} — ${ordre.item.label1}`,
      factory: ordre.factory,
      statut: ordre.status,
      priorite: ordre.priority,
      dueDate: ordre.dueDate,
      quantitePlanifiee: feuille.quantitePlanifiee,
      quantiteProduite: feuille.quantiteProduite,
      quantiteConforme: feuille.quantiteConforme,
      quantiteReprise: feuille.quantiteReprise,
      quantiteRebut: feuille.quantiteRebut,
      avancementPourcent: Math.round(avancement * 10) / 10,
      etapeEnCours: ordre.operations[0]?.operation.label ?? null,
      derniereArrivee: arrivees.length > 0 ? arrivees[arrivees.length - 1] : null,
      enAttenteValidation: enAttente,
      alertes: feuille.alertes,
    });
  }

  return lignes;
}
