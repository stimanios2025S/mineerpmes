import { Prisma, type MovementType, type StockStatus } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D } from "@/lib/decimal";
import {
  conflit,
  etatInvalide,
  nonTrouve,
  stockInsuffisant,
  validation,
} from "@/lib/errors";
import { prochainNumero, SEQUENCES } from "@/lib/numbering";
import {
  ACTIONS_AUDIT,
  MODULES_AUDIT,
  enregistrerAudit,
} from "@/lib/audit";

/**
 * Grand livre de stock.
 *
 * Regle fondamentale : la quantite physique d'un article n'est JAMAIS modifiee
 * directement. Toute variation cree une ecriture dans `StockMovement` et met a
 * jour le solde agrege `StockBalance` dans la meme transaction.
 */

export interface ActeurStock {
  id: number;
  email: string;
}

export interface LigneSoldeVerrouillee {
  id: bigint;
  quantityPhysical: Prisma.Decimal;
  quantityReserved: Prisma.Decimal;
  quantityBlocked: Prisma.Decimal;
  quantityDamaged: Prisma.Decimal;
  quantityQuarantine: Prisma.Decimal;
  quantityInProduction: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  totalValue: Prisma.Decimal;
}

export interface CleSolde {
  itemId: number;
  warehouseId: number;
  locationId?: number | null;
  lotId?: number | null;
  status?: StockStatus;
}

/** Cle deterministe : elle porte l'unicite du solde malgre les colonnes nullables. */
export function cleSolde(cle: CleSolde): string {
  return [
    cle.itemId,
    cle.warehouseId,
    cle.locationId ?? 0,
    cle.lotId ?? 0,
    cle.status ?? "LIBRE",
  ].join(":");
}

/**
 * Cree le solde s'il n'existe pas puis le verrouille pour l'ecriture.
 * Le verrou de ligne empeche deux operations concurrentes de calculer le meme
 * solde a partir d'une valeur perimee.
 */
export async function verrouillerSolde(
  tx: Db,
  cle: CleSolde,
): Promise<LigneSoldeVerrouillee> {
  const statut: StockStatus = cle.status ?? "LIBRE";
  const balanceKey = cleSolde(cle);

  await tx.$executeRaw`
    INSERT INTO "StockBalance" (
      "balanceKey", "itemId", "warehouseId", "locationId", "lotId", "status",
      "quantityPhysical", "quantityReserved", "quantityBlocked", "quantityDamaged",
      "quantityQuarantine", "quantityInProduction", "unitCost", "totalValue",
      "createdAt", "updatedAt"
    )
    VALUES (
      ${balanceKey}, ${cle.itemId}, ${cle.warehouseId}, ${cle.locationId ?? null},
      ${cle.lotId ?? null}, ${statut}::"StockStatus",
      0, 0, 0, 0, 0, 0, 0, 0, NOW(), NOW()
    )
    ON CONFLICT ("balanceKey") DO NOTHING
  `;

  const lignes = await tx.$queryRaw<LigneSoldeVerrouillee[]>`
    SELECT "id", "quantityPhysical", "quantityReserved", "quantityBlocked",
           "quantityDamaged", "quantityQuarantine", "quantityInProduction",
           "unitCost", "totalValue"
    FROM "StockBalance"
    WHERE "balanceKey" = ${balanceKey}
    FOR UPDATE
  `;

  const ligne = lignes[0];
  if (!ligne) {
    throw nonTrouve("Le solde de stock");
  }
  return ligne;
}

/**
 * Quantite disponible a la sortie.
 * Le stock en quarantaine, bloque ou endommage n'est jamais consommable.
 */
export function quantiteDisponible(solde: {
  quantityPhysical: Prisma.Decimal;
  quantityReserved: Prisma.Decimal;
  quantityBlocked: Prisma.Decimal;
  quantityDamaged: Prisma.Decimal;
  quantityQuarantine: Prisma.Decimal;
}): Prisma.Decimal {
  return D.sub(
    solde.quantityPhysical,
    D.sum([
      solde.quantityReserved,
      solde.quantityBlocked,
      solde.quantityDamaged,
      solde.quantityQuarantine,
    ]),
  );
}

export interface MouvementInput extends CleSolde {
  type: MovementType;
  /** Quantite signee : positive pour une entree, negative pour une sortie. */
  quantity: Prisma.Decimal | string | number;
  unitCode?: string | null;
  unitCost?: Prisma.Decimal | string | number;
  sourceWarehouseId?: number | null;
  targetWarehouseId?: number | null;
  workOrderId?: number | null;
  workOrderOperationId?: number | null;
  operationId?: number | null;
  declarationId?: bigint | null;
  documentType?: string | null;
  documentId?: string | null;
  documentNumber?: string | null;
  thirdPartyId?: number | null;
  occurredAt?: Date;
  comment?: string | null;
  reason?: string | null;
  justification?: string | null;
  acteur: ActeurStock;
  /** Autorise une sortie superieure au disponible (permission explicite requise). */
  autoriserNegatif?: boolean;
  /** Ignore le controle de statut qualite (usage reserve aux entree/reception). */
  ignorerControleStatut?: boolean;
  /** Ne pas recalculer le cout moyen pondere (mouvements de statut interne). */
  ignorerValorisation?: boolean;
  /** Empeche l'ecriture d'une ligne d'audit pour ce mouvement. */
  sansAudit?: boolean;
}

export interface MouvementResultat {
  mouvementId: bigint;
  numero: string;
  soldeApres: Prisma.Decimal;
  disponibleApres: Prisma.Decimal;
  coutUnitaire: Prisma.Decimal;
}

/**
 * Enregistre un mouvement de stock et met a jour le solde correspondant.
 * A appeler imperativement dans une transaction.
 */
export async function enregistrerMouvement(
  tx: Db,
  entree: MouvementInput,
): Promise<MouvementResultat> {
  const quantite = D.of(entree.quantity);
  if (quantite.isZero()) {
    throw validation("La quantite d'un mouvement de stock ne peut pas etre nulle.");
  }

  const statut: StockStatus = entree.status ?? "LIBRE";
  const estSortie = quantite.isNegative();

  const article = await tx.item.findUnique({
    where: { id: entree.itemId },
    select: { id: true, code: true, label1: true, unitCode: true, useNegativeStock: true },
  });
  if (!article) throw nonTrouve("L'article");

  const depot = await tx.warehouse.findUnique({
    where: { id: entree.warehouseId },
    select: { id: true, code: true, label: true },
  });
  if (!depot) throw nonTrouve("Le depot");

  const solde = await verrouillerSolde(tx, {
    itemId: entree.itemId,
    warehouseId: entree.warehouseId,
    locationId: entree.locationId ?? null,
    lotId: entree.lotId ?? null,
    status: statut,
  });

  if (estSortie && !entree.ignorerControleStatut) {
    if (statut === "QUARANTAINE") {
      throw conflit(
        `Sortie refusee : ${article.code} est en quarantaine dans le depot ${depot.code}. Une liberation qualite est necessaire.`,
      );
    }
    if (statut === "BLOQUE") {
      throw conflit(
        `Sortie refusee : ${article.code} est bloque dans le depot ${depot.code}.`,
      );
    }
    if (statut === "REBUT") {
      throw conflit(
        `Sortie refusee : ${article.code} est classe en rebut dans le depot ${depot.code}.`,
      );
    }
  }

  if (estSortie) {
    const disponible = quantiteDisponible(solde);
    const besoin = quantite.abs();
    const tolerance = entree.autoriserNegatif || article.useNegativeStock;
    if (!tolerance && D.lt(disponible, besoin)) {
      throw stockInsuffisant(
        `Stock insuffisant pour ${article.code} (${article.label1}) dans le depot ${depot.code} : disponible ${D.toFixed(
          disponible,
          3,
        )}, demande ${D.toFixed(besoin, 3)}.`,
        {
          itemId: entree.itemId,
          warehouseId: entree.warehouseId,
          disponible: disponible.toFixed(6),
          demande: besoin.toFixed(6),
        },
      );
    }
  }

  const coutUnitaire = D.of(entree.unitCost).isZero()
    ? D.of(solde.unitCost)
    : D.of(entree.unitCost);

  const nouvelleQuantite = D.add(solde.quantityPhysical, quantite);

  // Cout moyen pondere : recalcule uniquement sur les entrees valorisees.
  let nouveauCout = D.of(solde.unitCost);
  if (!estSortie && !entree.ignorerValorisation && !coutUnitaire.isZero()) {
    const valeurAvant = D.mul(solde.quantityPhysical, solde.unitCost);
    const valeurEntree = D.mul(quantite, coutUnitaire);
    nouveauCout = nouvelleQuantite.isZero()
      ? coutUnitaire
      : D.div(D.add(valeurAvant, valeurEntree), nouvelleQuantite);
  }

  const numero = await prochainNumero(SEQUENCES.MOUVEMENT_STOCK, tx);
  const dateOperation = entree.occurredAt ?? new Date();

  const mouvement = await tx.stockMovement.create({
    data: {
      number: numero,
      type: entree.type,
      itemId: entree.itemId,
      warehouseId: entree.warehouseId,
      locationId: entree.locationId ?? null,
      lotId: entree.lotId ?? null,
      quantity: D.roundQuantity(quantite),
      unitCode: entree.unitCode ?? article.unitCode ?? null,
      unitCost: D.round(coutUnitaire, 6),
      totalCost: D.round(D.mul(quantite, coutUnitaire), 6),
      balanceAfter: D.roundQuantity(nouvelleQuantite),
      status: statut,
      sourceWarehouseId: entree.sourceWarehouseId ?? null,
      targetWarehouseId: entree.targetWarehouseId ?? null,
      workOrderId: entree.workOrderId ?? null,
      workOrderOperationId: entree.workOrderOperationId ?? null,
      operationId: entree.operationId ?? null,
      declarationId: entree.declarationId ?? null,
      documentType: entree.documentType ?? null,
      documentId: entree.documentId ?? null,
      documentNumber: entree.documentNumber ?? null,
      thirdPartyId: entree.thirdPartyId ?? null,
      userId: entree.acteur.id,
      userEmail: entree.acteur.email,
      occurredAt: dateOperation,
      comment: entree.comment ?? null,
      reason: entree.reason ?? null,
      justification: entree.justification ?? null,
    },
  });

  await tx.stockBalance.update({
    where: { id: solde.id },
    data: {
      quantityPhysical: D.roundQuantity(nouvelleQuantite),
      unitCost: D.round(nouveauCout, 6),
      totalValue: D.round(D.mul(nouvelleQuantite, nouveauCout), 6),
    },
  });

  // Mise a jour du cout moyen de l'article pour les sorties non suivies en lot.
  if (!estSortie && !entree.ignorerValorisation && !coutUnitaire.isZero()) {
    await tx.item.update({
      where: { id: entree.itemId },
      data: { vwap: D.round(nouveauCout, 6) },
    });
    if (entree.lotId) {
      await tx.stockLot.update({
        where: { id: entree.lotId },
        data: { unitCost: D.round(nouveauCout, 6) },
      });
    }
  }

  const disponibleApres = quantiteDisponible({
    quantityPhysical: nouvelleQuantite,
    quantityReserved: solde.quantityReserved,
    quantityBlocked: solde.quantityBlocked,
    quantityDamaged: solde.quantityDamaged,
    quantityQuarantine: solde.quantityQuarantine,
  });

  if (!entree.sansAudit) {
    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.MOUVEMENT_STOCK,
        module: MODULES_AUDIT.STOCK,
        entity: "StockMovement",
        entityId: mouvement.id,
        userId: entree.acteur.id,
        userEmail: entree.acteur.email,
        newValue: {
          numero,
          type: entree.type,
          article: article.code,
          depot: depot.code,
          quantite: quantite.toFixed(6),
          statut,
          soldeApres: nouvelleQuantite.toFixed(6),
        },
        comment: entree.comment ?? null,
        reason: entree.reason ?? null,
      },
      tx,
    );
  }

  return {
    mouvementId: mouvement.id,
    numero,
    soldeApres: D.roundQuantity(nouvelleQuantite),
    disponibleApres,
    coutUnitaire: D.round(nouveauCout, 6),
  };
}

export interface TransfertInput {
  itemId: number;
  lotId?: number | null;
  quantity: Prisma.Decimal | string | number;
  sourceWarehouseId: number;
  sourceLocationId?: number | null;
  targetWarehouseId: number;
  targetLocationId?: number | null;
  sourceStatus?: StockStatus;
  targetStatus?: StockStatus;
  unitCost?: Prisma.Decimal | string | number;
  documentType?: string | null;
  documentId?: string | null;
  documentNumber?: string | null;
  workOrderId?: number | null;
  operationId?: number | null;
  type?: MovementType;
  comment?: string | null;
  reason?: string | null;
  acteur: ActeurStock;
  autoriserNegatif?: boolean;
}

/**
 * Transfert entre deux depots (ou deux emplacements).
 * Genere deux ecritures : une sortie du depot source, une entree dans le depot
 * de destination, dans la meme transaction.
 */
export async function transfererStock(
  tx: Db,
  entree: TransfertInput,
): Promise<{ sortieId: bigint; entreeId: bigint }> {
  const quantite = D.of(entree.quantity);
  if (D.lte(quantite, 0)) {
    throw validation("La quantite transferee doit etre strictement positive.");
  }
  if (entree.sourceWarehouseId === entree.targetWarehouseId) {
    throw validation(
      "Le depot de destination doit etre different du depot source.",
    );
  }

  const typeTransfert: MovementType = entree.type ?? "TRANSFERT_INTER_DEPOTS";

  const sortie = await enregistrerMouvement(tx, {
    type: typeTransfert,
    itemId: entree.itemId,
    warehouseId: entree.sourceWarehouseId,
    locationId: entree.sourceLocationId ?? null,
    lotId: entree.lotId ?? null,
    status: entree.sourceStatus ?? "LIBRE",
    quantity: quantite.negated(),
    unitCost: entree.unitCost,
    sourceWarehouseId: entree.sourceWarehouseId,
    targetWarehouseId: entree.targetWarehouseId,
    workOrderId: entree.workOrderId ?? null,
    operationId: entree.operationId ?? null,
    documentType: entree.documentType ?? null,
    documentId: entree.documentId ?? null,
    documentNumber: entree.documentNumber ?? null,
    comment: entree.comment ?? "Sortie pour transfert",
    reason: entree.reason ?? null,
    acteur: entree.acteur,
    autoriserNegatif: entree.autoriserNegatif,
  });

  const entreeMouvement = await enregistrerMouvement(tx, {
    type: typeTransfert,
    itemId: entree.itemId,
    warehouseId: entree.targetWarehouseId,
    locationId: entree.targetLocationId ?? null,
    lotId: entree.lotId ?? null,
    status: entree.targetStatus ?? "LIBRE",
    quantity: quantite,
    unitCost: sortie.coutUnitaire,
    sourceWarehouseId: entree.sourceWarehouseId,
    targetWarehouseId: entree.targetWarehouseId,
    workOrderId: entree.workOrderId ?? null,
    operationId: entree.operationId ?? null,
    documentType: entree.documentType ?? null,
    documentId: entree.documentId ?? null,
    documentNumber: entree.documentNumber ?? null,
    comment: entree.comment ?? "Entree pour transfert",
    reason: entree.reason ?? null,
    acteur: entree.acteur,
  });

  return { sortieId: sortie.mouvementId, entreeId: entreeMouvement.mouvementId };
}

export interface ChangementStatutInput {
  itemId: number;
  warehouseId: number;
  lotId?: number | null;
  locationId?: number | null;
  quantity: Prisma.Decimal | string | number;
  de: StockStatus;
  vers: StockStatus;
  type: MovementType;
  comment?: string | null;
  reason?: string | null;
  documentType?: string | null;
  documentId?: string | null;
  acteur: ActeurStock;
}

/**
 * Deplace une quantite entre deux statuts qualite d'un meme depot
 * (mise en quarantaine, liberation qualite, passage en rebut).
 */
export async function changerStatutStock(
  tx: Db,
  entree: ChangementStatutInput,
): Promise<{ sortieId: bigint; entreeId: bigint }> {
  const quantite = D.of(entree.quantity);
  if (D.lte(quantite, 0)) {
    throw validation("La quantite a changer de statut doit etre strictement positive.");
  }
  if (entree.de === entree.vers) {
    throw validation("Le statut d'origine et le statut de destination sont identiques.");
  }

  const sortie = await enregistrerMouvement(tx, {
    type: entree.type,
    itemId: entree.itemId,
    warehouseId: entree.warehouseId,
    locationId: entree.locationId ?? null,
    lotId: entree.lotId ?? null,
    status: entree.de,
    quantity: quantite.negated(),
    documentType: entree.documentType ?? null,
    documentId: entree.documentId ?? null,
    comment: entree.comment ?? `Sortie du statut ${entree.de}`,
    reason: entree.reason ?? null,
    acteur: entree.acteur,
    ignorerControleStatut: true,
    ignorerValorisation: true,
  });

  const entreeMouvement = await enregistrerMouvement(tx, {
    type: entree.type,
    itemId: entree.itemId,
    warehouseId: entree.warehouseId,
    locationId: entree.locationId ?? null,
    lotId: entree.lotId ?? null,
    status: entree.vers,
    quantity: quantite,
    unitCost: sortie.coutUnitaire,
    documentType: entree.documentType ?? null,
    documentId: entree.documentId ?? null,
    comment: entree.comment ?? `Entree dans le statut ${entree.vers}`,
    reason: entree.reason ?? null,
    acteur: entree.acteur,
    ignorerControleStatut: true,
    ignorerValorisation: true,
  });

  if (entree.lotId) {
    await tx.stockLot.update({
      where: { id: entree.lotId },
      data: {
        status: entree.vers,
        blockingReason:
          entree.vers === "LIBRE" ? null : (entree.reason ?? entree.comment ?? null),
      },
    });
  }

  return { sortieId: sortie.mouvementId, entreeId: entreeMouvement.mouvementId };
}

export interface ReservationInput {
  itemId: number;
  warehouseId: number;
  quantity: Prisma.Decimal | string | number;
  lotId?: number | null;
  documentType?: string | null;
  documentId?: string | null;
  acteur: ActeurStock;
}

/** Reserve une quantite sans la sortir du stock physique. */
export async function reserverStock(tx: Db, entree: ReservationInput): Promise<void> {
  const quantite = D.of(entree.quantity);
  if (D.lte(quantite, 0)) {
    throw validation("La quantite a reserver doit etre strictement positive.");
  }

  const solde = await verrouillerSolde(tx, {
    itemId: entree.itemId,
    warehouseId: entree.warehouseId,
    lotId: entree.lotId ?? null,
    status: "LIBRE",
  });

  const disponible = quantiteDisponible(solde);
  if (D.lt(disponible, quantite)) {
    throw stockInsuffisant(
      `Reservation impossible : disponible ${D.toFixed(disponible, 3)}, quantite demandee ${D.toFixed(quantite, 3)}.`,
      { itemId: entree.itemId, warehouseId: entree.warehouseId },
    );
  }

  await tx.stockBalance.update({
    where: { id: solde.id },
    data: { quantityReserved: D.roundQuantity(D.add(solde.quantityReserved, quantite)) },
  });

  await enregistrerAudit(
    {
      action: ACTIONS_AUDIT.MOUVEMENT_STOCK,
      module: MODULES_AUDIT.STOCK,
      entity: "StockBalance",
      entityId: String(solde.id),
      userId: entree.acteur.id,
      userEmail: entree.acteur.email,
      oldValue: { quantityReserved: solde.quantityReserved.toFixed(6) },
      newValue: { quantityReserved: D.add(solde.quantityReserved, quantite).toFixed(6) },
      comment: `Reservation de ${quantite.toFixed(3)} pour ${entree.documentType ?? "document"} ${entree.documentId ?? ""}`.trim(),
    },
    tx,
  );
}

/** Libere une reservation (annulation de commande, correction). */
export async function libererReservation(
  tx: Db,
  entree: ReservationInput,
): Promise<void> {
  const quantite = D.of(entree.quantity);
  if (D.lte(quantite, 0)) {
    throw validation("La quantite a liberer doit etre strictement positive.");
  }

  const solde = await verrouillerSolde(tx, {
    itemId: entree.itemId,
    warehouseId: entree.warehouseId,
    lotId: entree.lotId ?? null,
    status: "LIBRE",
  });

  if (D.lt(solde.quantityReserved, quantite)) {
    throw etatInvalide(
      `Liberation impossible : la quantite reservee (${D.toFixed(solde.quantityReserved, 3)}) est inferieure a la quantite a liberer (${D.toFixed(quantite, 3)}).`,
    );
  }

  await tx.stockBalance.update({
    where: { id: solde.id },
    data: { quantityReserved: D.roundQuantity(D.sub(solde.quantityReserved, quantite)) },
  });

  await enregistrerAudit(
    {
      action: ACTIONS_AUDIT.MOUVEMENT_STOCK,
      module: MODULES_AUDIT.STOCK,
      entity: "StockBalance",
      entityId: String(solde.id),
      userId: entree.acteur.id,
      userEmail: entree.acteur.email,
      oldValue: { quantityReserved: solde.quantityReserved.toFixed(6) },
      newValue: {
        quantityReserved: D.sub(solde.quantityReserved, quantite).toFixed(6),
      },
      comment: "Annulation de reservation",
    },
    tx,
  );
}

/**
 * Annule un mouvement en creant l'ecriture inverse.
 * Un mouvement valide n'est jamais supprime : la correction est toujours
 * une nouvelle ecriture auditee.
 */
export async function annulerMouvement(
  mouvementId: bigint,
  motif: string,
  acteur: ActeurStock,
): Promise<{ mouvementInverseId: bigint }> {
  if (!motif || motif.trim().length < 5) {
    throw validation(
      "Un motif d'annulation d'au moins 5 caracteres est obligatoire.",
      { motif: "Motif trop court." },
    );
  }

  return prisma.$transaction(async (tx) => {
    const original = await tx.stockMovement.findUnique({
      where: { id: mouvementId },
      include: { reverses: true },
    });

    if (!original) throw nonTrouve("Le mouvement de stock");
    if (original.reverses) {
      throw conflit(
        `Le mouvement ${original.number} a deja ete annule par le mouvement ${original.reverses.number}.`,
      );
    }
    if (original.isReversal) {
      throw conflit("Un mouvement d'annulation ne peut pas etre annule a son tour.");
    }

    const resultat = await enregistrerMouvement(tx, {
      type: "AJUSTEMENT",
      itemId: original.itemId,
      warehouseId: original.warehouseId,
      locationId: original.locationId,
      lotId: original.lotId,
      status: original.status,
      quantity: original.quantity.negated(),
      unitCost: original.unitCost,
      sourceWarehouseId: original.sourceWarehouseId,
      targetWarehouseId: original.targetWarehouseId,
      workOrderId: original.workOrderId,
      workOrderOperationId: original.workOrderOperationId,
      operationId: original.operationId,
      documentType: original.documentType,
      documentId: original.documentId,
      documentNumber: original.documentNumber,
      thirdPartyId: original.thirdPartyId,
      comment: `Annulation du mouvement ${original.number}`,
      reason: motif,
      acteur,
      autoriserNegatif: true,
      ignorerControleStatut: true,
      sansAudit: true,
    });

    await tx.stockMovement.update({
      where: { id: resultat.mouvementId },
      data: { isReversal: true, reversedById: original.id },
    });

    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.MOUVEMENT_ANNULE,
        module: MODULES_AUDIT.STOCK,
        entity: "StockMovement",
        entityId: original.id,
        userId: acteur.id,
        userEmail: acteur.email,
        oldValue: {
          numero: original.number,
          quantite: original.quantity.toFixed(6),
        },
        newValue: {
          numeroAnnulation: resultat.numero,
          quantite: original.quantity.negated().toFixed(6),
        },
        reason: motif,
      },
      tx,
    );

    return { mouvementInverseId: resultat.mouvementId };
  });
}

export interface SoldeArticle {
  itemId: number;
  warehouseId: number;
  warehouseCode: string;
  warehouseLabel: string;
  lotId: number | null;
  lotNumber: string | null;
  locationId: number | null;
  locationCode: string | null;
  status: StockStatus;
  quantityPhysical: Prisma.Decimal;
  quantityReserved: Prisma.Decimal;
  quantityBlocked: Prisma.Decimal;
  quantityDamaged: Prisma.Decimal;
  quantityQuarantine: Prisma.Decimal;
  quantityInProduction: Prisma.Decimal;
  quantityAvailable: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  totalValue: Prisma.Decimal;
}

export async function soldesArticle(
  itemId: number,
  options: { warehouseId?: number; inclureVides?: boolean } = {},
  db: Db = prisma,
): Promise<SoldeArticle[]> {
  const lignes = await db.stockBalance.findMany({
    where: {
      itemId,
      ...(options.warehouseId ? { warehouseId: options.warehouseId } : {}),
      ...(options.inclureVides ? {} : { quantityPhysical: { not: 0 } }),
    },
    include: {
      warehouse: { select: { code: true, label: true } },
      lot: { select: { lotNumber: true } },
      location: { select: { code: true } },
    },
    orderBy: [{ warehouseId: "asc" }, { status: "asc" }],
  });

  return lignes.map((ligne) => ({
    itemId: ligne.itemId,
    warehouseId: ligne.warehouseId,
    warehouseCode: ligne.warehouse.code,
    warehouseLabel: ligne.warehouse.label,
    lotId: ligne.lotId,
    lotNumber: ligne.lot?.lotNumber ?? null,
    locationId: ligne.locationId,
    locationCode: ligne.location?.code ?? null,
    status: ligne.status,
    quantityPhysical: ligne.quantityPhysical,
    quantityReserved: ligne.quantityReserved,
    quantityBlocked: ligne.quantityBlocked,
    quantityDamaged: ligne.quantityDamaged,
    quantityQuarantine: ligne.quantityQuarantine,
    quantityInProduction: ligne.quantityInProduction,
    quantityAvailable: quantiteDisponible(ligne),
    unitCost: ligne.unitCost,
    totalValue: ligne.totalValue,
  }));
}

/** Disponible consolide d'un article dans un depot (tous lots confondus). */
export async function disponibleArticle(
  itemId: number,
  warehouseId: number,
  db: Db = prisma,
): Promise<Prisma.Decimal> {
  const lignes = await db.stockBalance.findMany({
    where: { itemId, warehouseId, status: "LIBRE" },
    select: {
      quantityPhysical: true,
      quantityReserved: true,
      quantityBlocked: true,
      quantityDamaged: true,
      quantityQuarantine: true,
    },
  });

  return lignes.reduce(
    (acc, ligne) => D.add(acc, quantiteDisponible(ligne)),
    D.ZERO,
  );
}

export interface InventaireInput {
  itemId: number;
  warehouseId: number;
  locationId?: number | null;
  lotId?: number | null;
  quantityComptee: Prisma.Decimal | string | number;
  commentaire?: string | null;
  acteur: ActeurStock;
}

/**
 * Inventaire physique : ecart constate entre le stock theorique et le comptage.
 * L'ecart genere un mouvement `INVENTAIRE_PHYSIQUE` audite et justifie.
 */
export async function enregistrerInventaire(
  tx: Db,
  entree: InventaireInput,
): Promise<{ ecart: Prisma.Decimal; mouvementId: bigint | null }> {
  const solde = await verrouillerSolde(tx, {
    itemId: entree.itemId,
    warehouseId: entree.warehouseId,
    locationId: entree.locationId ?? null,
    lotId: entree.lotId ?? null,
    status: "LIBRE",
  });

  const compte = D.of(entree.quantityComptee);
  const ecart = D.sub(compte, solde.quantityPhysical);

  if (ecart.isZero()) {
    return { ecart: D.ZERO, mouvementId: null };
  }

  const resultat = await enregistrerMouvement(tx, {
    type: "INVENTAIRE_PHYSIQUE",
    itemId: entree.itemId,
    warehouseId: entree.warehouseId,
    locationId: entree.locationId ?? null,
    lotId: entree.lotId ?? null,
    status: "LIBRE",
    quantity: ecart,
    unitCost: solde.unitCost,
    comment:
      entree.commentaire ??
      `Inventaire physique : theorique ${D.toFixed(solde.quantityPhysical, 3)}, compte ${D.toFixed(compte, 3)}`,
    reason: "Ecart d'inventaire",
    acteur: entree.acteur,
    autoriserNegatif: true,
    ignorerValorisation: true,
  });

  return { ecart, mouvementId: resultat.mouvementId };
}

export interface FiltresMouvements {
  itemId?: number;
  warehouseId?: number;
  type?: MovementType;
  workOrderId?: number;
  du?: Date;
  au?: Date;
  recherche?: string;
  page?: number;
  taille?: number;
}

export async function listerMouvements(filtres: FiltresMouvements, db: Db = prisma) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(200, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.StockMovementWhereInput = {};
  if (filtres.itemId) where.itemId = filtres.itemId;
  if (filtres.warehouseId) where.warehouseId = filtres.warehouseId;
  if (filtres.type) where.type = filtres.type;
  if (filtres.workOrderId) where.workOrderId = filtres.workOrderId;
  if (filtres.du || filtres.au) {
    where.occurredAt = {};
    if (filtres.du) where.occurredAt.gte = filtres.du;
    if (filtres.au) where.occurredAt.lte = filtres.au;
  }
  if (filtres.recherche) {
    where.OR = [
      { number: { contains: filtres.recherche, mode: "insensitive" } },
      { documentNumber: { contains: filtres.recherche, mode: "insensitive" } },
      { item: { code: { contains: filtres.recherche, mode: "insensitive" } } },
      { item: { label1: { contains: filtres.recherche, mode: "insensitive" } } },
    ];
  }

  const [total, lignes] = await Promise.all([
    db.stockMovement.count({ where }),
    db.stockMovement.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: (page - 1) * taille,
      take: taille,
      include: {
        item: { select: { code: true, label1: true, unitCode: true } },
        warehouse: { select: { code: true, label: true } },
        lot: { select: { lotNumber: true } },
        workOrder: { select: { number: true } },
        thirdParty: { select: { code: true, label1: true } },
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
