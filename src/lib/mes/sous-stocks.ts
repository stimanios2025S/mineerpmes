import { Prisma, StockStatus as Statut } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D } from "@/lib/decimal";
import { conflit, nonTrouve, validation } from "@/lib/errors";
import {
  enregistrerMouvement,
  quantiteDisponible,
  type ActeurStock,
} from "@/lib/stock/service";
import {
  ACTIONS_AUDIT,
  MODULES_AUDIT,
  enregistrerAudit,
} from "@/lib/audit";

/**
 * Sous-stocks d'operation et passage d'une etape a la suivante.
 *
 * REGLE DE CONCEPTION
 * -------------------
 * Un sous-stock n'est pas un second moteur de stock. C'est un EMPLACEMENT
 * (`Location`) d'un depot existant, auquel on accroche une identite metier :
 * quelle operation, quel atelier, quel poste, a quelle etape de la gamme.
 *
 * La quantite officielle vit donc dans `StockBalance` sur `locationId`, et
 * toute variation passe par le grand livre `StockMovement`. Aucune fonction de
 * ce fichier ne modifie une quantite directement : toutes passent par
 * `enregistrerMouvement`.
 *
 * IDEMPOTENCE DU PASSAGE
 * ----------------------
 * `OperationStepTransfer.transferKey` est deterministe (operation de l'OF, les
 * deux sous-stocks, l'article, le lot). Un double clic, un rejeu de requete ou
 * une seconde validation ne peuvent donc pas doubler le stock : la contrainte
 * d'unicite rejette le doublon, et la transaction fait que les deux mouvements
 * et la ligne de passage existent ensemble ou pas du tout.
 */

// ---------------------------------------------------------------------------
// Cle deterministe du passage
// ---------------------------------------------------------------------------

export interface CleTransfertEtape {
  workOrderOperationId: number;
  fromSubStockId: number;
  toSubStockId: number;
  itemId: number;
  lotId?: number | null;
}

/**
 * La cle est stable et lisible : elle se relit dans la base pour comprendre un
 * passage sans avoir a joindre les tables.
 */
export function cleTransfertEtape(cle: CleTransfertEtape): string {
  return [
    `OF-OP:${cle.workOrderOperationId}`,
    `DE:${cle.fromSubStockId}`,
    `VERS:${cle.toSubStockId}`,
    `ART:${cle.itemId}`,
    `LOT:${cle.lotId ?? 0}`,
  ].join("|");
}

// ---------------------------------------------------------------------------
// Position d'un sous-stock
// ---------------------------------------------------------------------------

export interface PositionSousStock {
  subStockId: number;
  code: string;
  label: string;
  operationId: number;
  operationCode: string;
  operationLabel: string;
  warehouseId: number;
  locationId: number;
  itemId: number;
  lotId: number | null;
  unite: string | null;

  /** Ce qui est physiquement dans l'emplacement. */
  quantitePhysique: Prisma.Decimal;
  /** Deja engagee ailleurs, donc non disponible. */
  quantiteReservee: Prisma.Decimal;
  /** Bloquee par la qualite, non consommable. */
  quantiteBloquee: Prisma.Decimal;
  /** Endommagee, non consommable. */
  quantiteEndommagee: Prisma.Decimal;
  /** En quarantaine, en attente de decision qualite. */
  quantiteQuarantaine: Prisma.Decimal;
  /** En cours de production, immobilisee a ce stade. */
  quantiteEnProduction: Prisma.Decimal;

  /** Physique moins tout ce qui est immobilise : ce qui peut reellement sortir. */
  quantiteDisponible: Prisma.Decimal;

  /** Declare conforme par l'operateur, mais pas encore valide par un responsable. */
  quantiteEnAttenteValidation: Prisma.Decimal;
  /** Deja transferee vers une etape aval depuis cet emplacement. */
  quantiteTransferee: Prisma.Decimal;
  /** Recue des etapes amont dans cet emplacement. */
  quantiteRecueAmont: Prisma.Decimal;

  /** Deja present dans l'emplacement a la suite d'un passage, par ce sous-stock. */
  passages: number;
}

export interface PositionInput {
  subStockId: number;
  /**
   * Article suivi. Un sous-stock peut recevoir plusieurs articles (branches
   * paralleles) : la position se lit donc toujours pour un article precis.
   */
  itemId: number;
  /** Restreint a un lot. Omis, la position couvre tous les lots de l'emplacement. */
  lotId?: number | null;
}

/**
 * Photographie complete d'un sous-stock pour un article (et un lot) donne.
 *
 * Tout est lu, rien n'est recalcule de memoire : les quantites officielles
 * viennent de `StockBalance`, la production vient des declarations, et
 * l'historique amont/aval des lignes de passage.
 */
export async function positionSousStock(
  db: Db,
  entree: PositionInput,
): Promise<PositionSousStock> {
  const sousStock = await db.operationSubStock.findUnique({
    where: { id: entree.subStockId },
    include: {
      operation: { select: { id: true, code: true, label: true } },
    },
  });

  if (!sousStock) {
    throw nonTrouve("Le sous-stock d'operation");
  }

  const itemId = entree.itemId;
  const lotId = entree.lotId ?? null;

  const [soldes, article] = await Promise.all([
    db.stockBalance.findMany({
      where: {
        locationId: sousStock.locationId,
        itemId,
        ...(lotId === null ? {} : { lotId }),
      },
    }),
    db.item.findUnique({
      where: { id: itemId },
      select: { unitCode: true },
    }),
  ]);

  if (!article) {
    throw nonTrouve("L'article suivi par ce sous-stock");
  }

  const quantitePhysique = D.sum(soldes.map((solde) => solde.quantityPhysical));
  const quantiteReservee = D.sum(soldes.map((solde) => solde.quantityReserved));
  const quantiteEnProduction = D.sum(
    soldes.map((solde) => solde.quantityInProduction),
  );
  // Le statut qualite vit dans ses propres colonnes, exactement comme les lit
  // `quantiteDisponible` : bloquee, endommagee et en quarantaine sont donc
  // additionnees telles quelles, jamais deduites d'un filtre sur `status`.
  const quantiteBloquee = D.sum(soldes.map((solde) => solde.quantityBlocked));
  const quantiteEndommagee = D.sum(soldes.map((solde) => solde.quantityDamaged));
  const quantiteQuarantaine = D.sum(
    soldes.map((solde) => solde.quantityQuarantine),
  );

  // Somme des disponibles ligne a ligne, plancher a zero : un solde
  // momentanement negatif ne doit pas masquer le disponible des autres lignes.
  const disponible = D.sum(
    soldes.map((solde) => D.max(quantiteDisponible(solde), D.of(0))),
  );

  // Declarations de production non encore validees : elles ne comptent pas
  // encore dans le stock officiel, mais l'atelier doit les voir.
  const declarationsEnAttente = await db.operationDeclaration.aggregate({
    where: {
      operationId: sousStock.operationId,
      kind: "PRODUCTION",
      status: { in: ["SAISIE", "SOUMISE"] },
      itemId,
      ...(lotId === null ? {} : { lotId }),
    },
    _sum: { quantityConform: true },
  });

  const passagesAval = await db.operationStepTransfer.aggregate({
    where: {
      fromSubStockId: sousStock.id,
      itemId,
      ...(lotId === null ? {} : { lotId }),
    },
    _sum: { quantity: true },
    _count: { _all: true },
  });

  const passagesAmont = await db.operationStepTransfer.aggregate({
    where: {
      toSubStockId: sousStock.id,
      itemId,
      ...(lotId === null ? {} : { lotId }),
    },
    _sum: { quantity: true },
  });

  return {
    subStockId: sousStock.id,
    code: sousStock.code,
    label: sousStock.label,
    operationId: sousStock.operationId,
    operationCode: sousStock.operation.code,
    operationLabel: sousStock.operation.label,
    warehouseId: sousStock.warehouseId,
    locationId: sousStock.locationId,
    itemId,
    lotId,
    unite: article.unitCode ?? null,

    quantitePhysique,
    quantiteReservee,
    quantiteBloquee,
    quantiteEndommagee,
    quantiteQuarantaine,
    quantiteEnProduction,
    quantiteDisponible: disponible,
    quantiteEnAttenteValidation: D.of(
      declarationsEnAttente._sum.quantityConform ?? 0,
    ),
    quantiteTransferee: D.of(passagesAval._sum.quantity ?? 0),
    quantiteRecueAmont: D.of(passagesAmont._sum.quantity ?? 0),
    passages: passagesAval._count._all,
  };
}

// ---------------------------------------------------------------------------
// Branches paralleles
// ---------------------------------------------------------------------------

export interface BrancheEnAttente {
  linkId: number;
  fromSubStockId: number;
  fromCode: string;
  fromLabel: string;
  isRequired: boolean;
  quantiteRequise: Prisma.Decimal;
  quantitePresente: Prisma.Decimal;
  manque: Prisma.Decimal;
}

/**
 * Ce qui bloque le demarrage d'une etape : les branches amont obligatoires qui
 * n'ont pas encore fourni leur quantite.
 *
 * C'est ce qui permet a la couture et a la preparation du bois d'alimenter
 * l'assemblage final sans etre forcees dans une chaine lineaire unique —
 * l'assemblage attend simplement que ses branches requises soient servies.
 */
export async function branchesEnAttente(
  db: Db,
  entree: {
    toSubStockId: number;
    itemId: number;
    lotId?: number | null;
    /**
     * Quantite de reference a produire. Si elle n'est pas connue, on signale
     * simplement les branches encore vides plutot que de les declarer en
     * attente a tort.
     */
    quantiteRequise?: Prisma.Decimal | string | number;
  },
): Promise<BrancheEnAttente[]> {
  const avecQuantite = entree.quantiteRequise !== undefined;

  const liens = await db.operationSubStockLink.findMany({
    where: { toSubStockId: entree.toSubStockId },
    include: {
      fromSubStock: { select: { id: true, code: true, label: true, locationId: true } },
    },
  });

  const requise = D.of(entree.quantiteRequise ?? 0);
  const resultat: BrancheEnAttente[] = [];

  for (const lien of liens) {
    const besoin = avecQuantite
      ? D.mul(requise, lien.quantityRatio)
      : D.of(0);

    const soldes = await db.stockBalance.findMany({
      where: {
        locationId: lien.fromSubStock.locationId,
        itemId: entree.itemId,
        ...(entree.lotId == null ? {} : { lotId: entree.lotId }),
      },
    });

    const present = D.sum(
      soldes.map((solde) => D.max(quantiteDisponible(solde), D.of(0))),
    );

    const insuffisant = avecQuantite
      ? D.lt(present, besoin)
      : D.lte(present, 0);

    if (insuffisant) {
      resultat.push({
        linkId: lien.id,
        fromSubStockId: lien.fromSubStockId,
        fromCode: lien.fromSubStock.code,
        fromLabel: lien.fromSubStock.label,
        isRequired: lien.isRequired,
        quantiteRequise: besoin,
        quantitePresente: present,
        manque: D.max(D.sub(besoin, present), D.of(0)),
      });
    }
  }

  return resultat;
}

// ---------------------------------------------------------------------------
// Passage d'une etape a la suivante
// ---------------------------------------------------------------------------

export interface PassageEtapeInput {
  workOrderOperationId: number;
  fromSubStockId: number;
  toSubStockId: number;
  itemId: number;
  lotId?: number | null;
  quantity: Prisma.Decimal | string | number;
  unitCode?: string | null;
  declarationId?: bigint | null;
  validatedById?: number | null;
  occurredAt?: Date;
  comment?: string | null;
  acteur: ActeurStock;
  /** Autorise un passage alors qu'aucun lien n'est declare entre les deux. */
  autoriserSansLien?: boolean;
}

export interface ResultatPassage {
  transfertId: bigint;
  transferKey: string;
  quantity: Prisma.Decimal;
  dejaEnregistre: boolean;
}

/**
 * Transfere une quantite conforme d'un sous-stock vers l'etape suivante.
 *
 * Un seul enregistrement possible par cle : si le passage a deja eu lieu, la
 * fonction retourne le passage existant sans rien remuer. C'est ce qui rend
 * l'operation rejouable sans risque.
 */
export async function transfererVersEtapeSuivante(
  entree: PassageEtapeInput,
): Promise<ResultatPassage> {
  const cle = cleTransfertEtape(entree);

  const dejaLa = await prisma.operationStepTransfer.findUnique({
    where: { transferKey: cle },
  });
  if (dejaLa) {
    return {
      transfertId: dejaLa.id,
      transferKey: cle,
      quantity: dejaLa.quantity,
      dejaEnregistre: true,
    };
  }

  try {
    return await prisma.$transaction(async (tx) =>
      transfererVersEtapeSuivanteTx(tx, entree),
    );
  } catch (erreur) {
    // Course entre deux validations simultanees : la contrainte d'unicite a
    // tranche. On relit le passage gagnant au lieu d'echouer.
    if (
      erreur instanceof Prisma.PrismaClientKnownRequestError &&
      erreur.code === "P2002"
    ) {
      const gagnant = await prisma.operationStepTransfer.findUnique({
        where: { transferKey: cle },
      });
      if (gagnant) {
        return {
          transfertId: gagnant.id,
          transferKey: cle,
          quantity: gagnant.quantity,
          dejaEnregistre: true,
        };
      }
    }
    throw erreur;
  }
}

/**
 * Variante utilisable DANS une transaction existante (validation d'une
 * declaration, par exemple) : la validation et le passage reussissent ensemble
 * ou pas du tout.
 */
export async function transfererVersEtapeSuivanteTx(
  tx: Db,
  entree: PassageEtapeInput,
): Promise<ResultatPassage> {
  const quantite = D.of(entree.quantity);
  if (D.lte(quantite, 0)) {
    throw validation("La quantite transferee doit etre strictement positive.");
  }

  if (entree.fromSubStockId === entree.toSubStockId) {
    throw validation(
      "Le sous-stock de destination doit etre different du sous-stock source.",
    );
  }

  const [source, cible] = await Promise.all([
    tx.operationSubStock.findUnique({ where: { id: entree.fromSubStockId } }),
    tx.operationSubStock.findUnique({ where: { id: entree.toSubStockId } }),
  ]);

  if (!source) throw nonTrouve("Le sous-stock source");
  if (!cible) throw nonTrouve("Le sous-stock de destination");

  if (!source.isActive) {
    throw conflit(`Le sous-stock source « ${source.code} » est desactive.`);
  }
  if (!cible.isActive) {
    throw conflit(
      `Le sous-stock de destination « ${cible.code} » est desactive.`,
    );
  }

  if (!entree.autoriserSansLien) {
    const lien = await tx.operationSubStockLink.findUnique({
      where: {
        fromSubStockId_toSubStockId: {
          fromSubStockId: entree.fromSubStockId,
          toSubStockId: entree.toSubStockId,
        },
      },
    });
    if (!lien) {
      throw validation(
        `Aucun lien de gamme ne relie « ${source.code} » a « ${cible.code} ». ` +
          "Declarez le lien avant de transferer, ou passez par une correction autorisee.",
      );
    }
  }

  const operation = await tx.workOrderOperation.findUnique({
    where: { id: entree.workOrderOperationId },
    select: { id: true, workOrderId: true, operationId: true },
  });
  if (!operation) {
    throw nonTrouve("L'operation de l'ordre de fabrication");
  }

  const cle = cleTransfertEtape(entree);
  const statut = Statut.LIBRE;

  // 1. On reserve la cle d'abord : c'est la ligne qui rend le passage unique.
  //    Si un second appel arrive en parallele, il echoue ici et non apres avoir
  //    bouge du stock.
  const transfert = await tx.operationStepTransfer.create({
    data: {
      transferKey: cle,
      workOrderId: operation.workOrderId,
      workOrderOperationId: entree.workOrderOperationId,
      operationId: operation.operationId,
      fromSubStockId: entree.fromSubStockId,
      toSubStockId: entree.toSubStockId,
      itemId: entree.itemId,
      lotId: entree.lotId ?? null,
      quantity: quantite,
      unitCode: entree.unitCode ?? null,
      declarationId: entree.declarationId ?? null,
      validatedById: entree.validatedById ?? null,
      validatedAt: entree.validatedById ? new Date() : null,
      occurredAt: entree.occurredAt ?? new Date(),
      comment: entree.comment ?? null,
    },
  });

  const libelle = `${source.code} -> ${cible.code}`;

  // 2. Sortie du sous-stock amont.
  const sortie = await enregistrerMouvement(tx, {
    type: "TRANSFERT_SOUS_STOCK",
    itemId: entree.itemId,
    warehouseId: source.warehouseId,
    locationId: source.locationId,
    lotId: entree.lotId ?? null,
    status: statut,
    quantity: D.neg(quantite),
    sourceWarehouseId: source.warehouseId,
    targetWarehouseId: cible.warehouseId,
    workOrderId: operation.workOrderId,
    workOrderOperationId: entree.workOrderOperationId,
    operationId: operation.operationId,
    declarationId: entree.declarationId ?? null,
    comment: `Passage d'etape ${libelle}`,
    acteur: entree.acteur,
    ignorerValorisation: source.warehouseId === cible.warehouseId,
  });

  // 3. Entree dans le sous-stock aval, dans la meme transaction.
  const entreeMouvement = await enregistrerMouvement(tx, {
    type: "TRANSFERT_SOUS_STOCK",
    itemId: entree.itemId,
    warehouseId: cible.warehouseId,
    locationId: cible.locationId,
    lotId: entree.lotId ?? null,
    status: statut,
    quantity: quantite,
    unitCost: sortie.coutUnitaire,
    sourceWarehouseId: source.warehouseId,
    targetWarehouseId: cible.warehouseId,
    workOrderId: operation.workOrderId,
    workOrderOperationId: entree.workOrderOperationId,
    operationId: operation.operationId,
    declarationId: entree.declarationId ?? null,
    comment: `Passage d'etape ${libelle}`,
    acteur: entree.acteur,
    ignorerValorisation: source.warehouseId === cible.warehouseId,
  });

  const finalise = await tx.operationStepTransfer.update({
    where: { id: transfert.id },
    data: {
      outMovementId: sortie.mouvementId,
      inMovementId: entreeMouvement.mouvementId,
    },
  });

  await enregistrerAudit(
    {
      action: "TRANSFERT_SOUS_STOCK",
      module: MODULES_AUDIT.PRODUCTION,
      entity: "OperationStepTransfer",
      entityId: finalise.id,
      userId: entree.acteur.id,
      userEmail: entree.acteur.email,
      oldValue: {
        from: source.code,
        disponibleAvant: D.toFixed(sortie.disponibleApres, 6),
      },
      newValue: {
        to: cible.code,
        quantity: D.toFixed(quantite, 6),
        itemId: entree.itemId,
        lotId: entree.lotId ?? null,
        mouvementSortie: String(sortie.mouvementId),
        mouvementEntree: String(entreeMouvement.mouvementId),
      },
      comment: entree.comment ?? `Passage d'etape ${libelle}`,
    },
    tx,
  );

  return {
    transfertId: finalise.id,
    transferKey: cle,
    quantity: quantite,
    dejaEnregistre: false,
  };
}

// ---------------------------------------------------------------------------
// Definition des sous-stocks et de leurs liens
// ---------------------------------------------------------------------------

export interface CreationSousStockInput {
  code: string;
  label: string;
  operationId: number;
  warehouseId: number;
  /** Emplacement. S'il n'existe pas dans ce depot, il est cree. */
  locationCode: string;
  locationLabel?: string;
  factory?: "ADMEDCO" | "MOBILIX" | "COMMUN";
  workshopId?: number | null;
  workCenterId?: number | null;
  kind?: "ENTREE_OPERATION" | "SORTIE_OPERATION" | "TAMPON" | "ATTENTE_QUALITE";
  sequenceOrder?: number;
  description?: string | null;
}

/**
 * Cree un sous-stock d'operation.
 *
 * L'emplacement est cree dans le depot s'il n'existe pas : un sous-stock est
 * toujours adosse a un emplacement reel, jamais a une quantite virtuelle.
 */
export async function creerSousStock(
  tx: Db,
  entree: CreationSousStockInput,
) {
  const operation = await tx.operation.findUnique({
    where: { id: entree.operationId },
    select: { id: true, code: true },
  });
  if (!operation) throw nonTrouve("L'operation");

  const depot = await tx.warehouse.findUnique({
    where: { id: entree.warehouseId },
    select: { id: true, code: true },
  });
  if (!depot) throw nonTrouve("Le depot");

  const emplacement = await tx.location.upsert({
    where: {
      warehouseId_code: {
        warehouseId: entree.warehouseId,
        code: entree.locationCode,
      },
    },
    update: {},
    create: {
      warehouseId: entree.warehouseId,
      code: entree.locationCode,
      label: entree.locationLabel ?? entree.locationCode,
    },
  });

  const sousStock = await tx.operationSubStock.create({
    data: {
      code: entree.code,
      label: entree.label,
      operationId: entree.operationId,
      factory: entree.factory ?? "ADMEDCO",
      workshopId: entree.workshopId ?? null,
      workCenterId: entree.workCenterId ?? null,
      warehouseId: entree.warehouseId,
      locationId: emplacement.id,
      kind: entree.kind ?? "SORTIE_OPERATION",
      sequenceOrder: entree.sequenceOrder ?? 0,
      description: entree.description ?? null,
    },
  });

  await enregistrerAudit(
    {
      action: ACTIONS_AUDIT.CREATION,
      module: MODULES_AUDIT.PRODUCTION,
      entity: "OperationSubStock",
      entityId: sousStock.id,
      newValue: {
        code: sousStock.code,
        operation: operation.code,
        depot: depot.code,
        emplacement: emplacement.code,
      },
    },
    tx,
  );

  return sousStock;
}

/** Declare qu'une etape alimente une autre. Plusieurs liens entrants = branches paralleles. */
export async function definirLienSousStock(
  tx: Db,
  entree: {
    fromSubStockId: number;
    toSubStockId: number;
    isRequired?: boolean;
    quantityRatio?: Prisma.Decimal | string | number;
    note?: string | null;
  },
) {
  if (entree.fromSubStockId === entree.toSubStockId) {
    throw validation("Une etape ne peut pas s'alimenter elle-meme.");
  }

  const lien = await tx.operationSubStockLink.upsert({
    where: {
      fromSubStockId_toSubStockId: {
        fromSubStockId: entree.fromSubStockId,
        toSubStockId: entree.toSubStockId,
      },
    },
    update: {
      isRequired: entree.isRequired ?? true,
      quantityRatio: D.of(entree.quantityRatio ?? 1),
      note: entree.note ?? null,
    },
    create: {
      fromSubStockId: entree.fromSubStockId,
      toSubStockId: entree.toSubStockId,
      isRequired: entree.isRequired ?? true,
      quantityRatio: D.of(entree.quantityRatio ?? 1),
      note: entree.note ?? null,
    },
  });

  await enregistrerAudit(
    {
      action: ACTIONS_AUDIT.MODIFICATION,
      module: MODULES_AUDIT.NOMENCLATURE,
      entity: "OperationSubStockLink",
      entityId: lien.id,
      newValue: {
        from: entree.fromSubStockId,
        to: entree.toSubStockId,
        isRequired: lien.isRequired,
        ratio: D.toFixed(lien.quantityRatio, 6),
      },
    },
    tx,
  );

  return lien;
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export interface FiltreSousStocks {
  operationId?: number;
  factory?: "ADMEDCO" | "MOBILIX" | "COMMUN";
  workshopId?: number;
  workCenterId?: number;
  actifsSeulement?: boolean;
}

export async function listerSousStocks(
  db: Db,
  filtres: FiltreSousStocks = {},
) {
  return db.operationSubStock.findMany({
    where: {
      ...(filtres.operationId ? { operationId: filtres.operationId } : {}),
      ...(filtres.factory ? { factory: filtres.factory } : {}),
      ...(filtres.workshopId ? { workshopId: filtres.workshopId } : {}),
      ...(filtres.workCenterId ? { workCenterId: filtres.workCenterId } : {}),
      ...(filtres.actifsSeulement === false ? {} : { isActive: true }),
    },
    include: {
      operation: { select: { id: true, code: true, label: true } },
      warehouse: { select: { id: true, code: true, label: true } },
      location: { select: { id: true, code: true, label: true } },
      workCenter: { select: { id: true, code: true, label: true } },
      workshop: { select: { id: true, code: true, label: true } },
      outgoingLinks: {
        include: {
          toSubStock: { select: { id: true, code: true, label: true } },
        },
      },
      incomingLinks: {
        include: {
          fromSubStock: { select: { id: true, code: true, label: true } },
        },
      },
    },
    orderBy: [{ operationId: "asc" }, { sequenceOrder: "asc" }, { code: "asc" }],
  });
}

/**
 * Sous-stock de sortie d'une operation : l'endroit ou la production conforme de
 * cette operation se depose. Sert a enregistrer une production declaree sans
 * demander a l'operateur de choisir un emplacement.
 */
export async function sousStockDeSortie(
  db: Db,
  operationId: number,
  factory?: "ADMEDCO" | "MOBILIX" | "COMMUN",
) {
  return db.operationSubStock.findFirst({
    where: {
      operationId,
      isActive: true,
      kind: { in: ["SORTIE_OPERATION", "ENTREE_OPERATION"] },
      ...(factory ? { factory } : {}),
    },
    orderBy: { sequenceOrder: "asc" },
    include: { location: true, warehouse: true },
  });
}
