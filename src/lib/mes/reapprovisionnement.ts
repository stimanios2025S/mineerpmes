import { Prisma, type SupplyMode } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D } from "@/lib/decimal";
import { conflit, etatInvalide, nonTrouve, validation } from "@/lib/errors";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";

/**
 * Reapprovisionnement min-max, par article et par emplacement.
 *
 * Trois regles structurantes :
 *
 *  1. Les seuils sont des DONNEES, pas des constantes. 200 et 500 ne sont que
 *     l'exemple de la specification : ils se saisissent par article et par
 *     emplacement, et le code ne les connait pas.
 *  2. La position est exacte : `position = physique - reserve`. L'immobilise
 *     (bloque, endommage, quarantaine) n'est JAMAIS compte comme disponible ni
 *     comme position : il est affiche a part, pour information. Une quantite
 *     reservee n'est pas disponible deux fois : elle est deduite une seule fois.
 *  3. La quantite proposee est exactement `max(0, cible - position)`. Aucune
 *     autre formule, aucun arrondi silencieux, aucun cumul.
 *
 * Une proposition n'est PAS une commande : rien ici ne cree de bon de commande,
 * de transfert ou d'ecriture comptable. Le responsable valide, et la suite se
 * fait par les circuits existants (achat, transfert), avec ses propres droits.
 */

export interface PositionReappro {
  itemId: number;
  warehouseId: number;
  locationId: number | null;
  quantitePhysique: Prisma.Decimal;
  quantiteReservee: Prisma.Decimal;
  quantiteImmobilisee: Prisma.Decimal;
  quantitePosition: Prisma.Decimal;
  /** Quantite minimale : sous ce seuil, on reapprovisionne. */
  quantiteMin: Prisma.Decimal;
  /** Quantite cible : ce que l'on veut atteindre. */
  quantiteCible: Prisma.Decimal;
  /** `max(0, cible - position)`. */
  quantiteProposee: Prisma.Decimal;
  sousLeMinimum: boolean;
  mode: SupplyMode;
  unite: string | null;
  codeArticle: string;
  libelleArticle: string;
  codeDepot: string;
  codeEmplacement: string | null;
}

export interface FiltresReappro {
  factory?: "ADMEDCO" | "MOBILIX" | "COMMUN";
  warehouseId?: number;
  itemId?: number;
  /** Ne retourne que les lignes reellement sous le minimum. */
  seulementSousMinimum?: boolean;
  limite?: number;
}

/**
 * Position exacte d'un article a un emplacement, avec ses seuils et la quantite
 * proposee.
 *
 * Le calcul lit le grand livre (`StockBalance`) : aucune quantite n'est deduite
 * d'une saisie ni recalculee a partir d'un document.
 */
export async function positionReapprovisionnement(
  entree: { itemId: number; warehouseId: number; locationId?: number | null },
  db: Db = prisma,
): Promise<PositionReappro> {
  const reglage = await db.itemWarehouseSetting.findUnique({
    where: {
      itemId_warehouseId: {
        itemId: entree.itemId,
        warehouseId: entree.warehouseId,
      },
    },
    include: {
      item: { select: { code: true, label1: true, unitCode: true } },
      warehouse: { select: { code: true } },
      location: { select: { code: true } },
    },
  });
  if (!reglage) {
    throw nonTrouve(
      "Le reglage de reapprovisionnement de cet article dans ce depot",
    );
  }

  const soldes = await db.stockBalance.findMany({
    where: {
      itemId: entree.itemId,
      warehouseId: entree.warehouseId,
      ...(entree.locationId ? { locationId: entree.locationId } : {}),
    },
    select: {
      quantityPhysical: true,
      quantityReserved: true,
      quantityBlocked: true,
      quantityDamaged: true,
      quantityQuarantine: true,
    },
  });

  const physique = D.sum(soldes.map((solde) => solde.quantityPhysical));
  const reservee = D.sum(soldes.map((solde) => solde.quantityReserved));
  const immobilisee = D.sum(
    soldes.map((solde) =>
      D.add(
        D.add(solde.quantityBlocked, solde.quantityDamaged),
        solde.quantityQuarantine,
      ),
    ),
  );

  // `position = physique - reserve` : c'est la formule de la specification.
  // L'immobilise est presente a part, jamais additionne a la position.
  const position = D.sub(physique, reservee);
  const minimum = D.of(reglage.quantityMin);
  const cible = D.of(reglage.quantityMax);

  if (D.gt(minimum, cible)) {
    throw etatInvalide(
      `Le minimum (${D.toFixed(minimum, 3)}) est superieur a la cible (${D.toFixed(cible, 3)}) pour ${reglage.item.code} : corrigez les seuils avant de calculer une proposition.`,
    );
  }

  const proposee = D.max(D.sub(cible, position), D.of(0));

  return {
    itemId: entree.itemId,
    warehouseId: entree.warehouseId,
    locationId: reglage.locationId,
    quantitePhysique: physique,
    quantiteReservee: reservee,
    quantiteImmobilisee: immobilisee,
    quantitePosition: position,
    quantiteMin: minimum,
    quantiteCible: cible,
    quantiteProposee: proposee,
    sousLeMinimum: D.lt(position, minimum),
    mode: reglage.supplyMode,
    unite: reglage.item.unitCode,
    codeArticle: reglage.item.code,
    libelleArticle: reglage.item.label1,
    codeDepot: reglage.warehouse.code,
    codeEmplacement: reglage.location?.code ?? null,
  };
}

/** Toutes les positions reglees pour un perimetre, sous le minimum ou non. */
export async function positionsReapprovisionnement(
  filtres: FiltresReappro = {},
  db: Db = prisma,
): Promise<PositionReappro[]> {
  const reglages = await db.itemWarehouseSetting.findMany({
    where: {
      isReplenishmentActive: true,
      ...(filtres.warehouseId ? { warehouseId: filtres.warehouseId } : {}),
      ...(filtres.itemId ? { itemId: filtres.itemId } : {}),
      ...(filtres.factory
        ? {
            OR: [
              { warehouse: { factory: filtres.factory } },
              { item: { factory: filtres.factory } },
            ],
          }
        : {}),
    },
    select: { itemId: true, warehouseId: true, locationId: true },
    orderBy: [{ warehouseId: "asc" }, { itemId: "asc" }],
    take: Math.min(2000, Math.max(1, filtres.limite ?? 500)),
  });

  const positions: PositionReappro[] = [];
  for (const reglage of reglages) {
    positions.push(
      await positionReapprovisionnement(
        {
          itemId: reglage.itemId,
          warehouseId: reglage.warehouseId,
          locationId: reglage.locationId,
        },
        db,
      ),
    );
  }

  positions.sort((a, b) =>
    a.codeDepot === b.codeDepot
      ? a.codeArticle.localeCompare(b.codeArticle, "fr")
      : a.codeDepot.localeCompare(b.codeDepot, "fr"),
  );

  return filtres.seulementSousMinimum
    ? positions.filter((position) => position.sousLeMinimum)
    : positions;
}

/**
 * Cle deterministe d'une proposition.
 *
 * Deux calculs successifs, pour le meme article et le meme emplacement, dans la
 * meme situation, produisent la meme cle : une seule proposition peut donc
 * exister a la fois. On ne cree jamais deux propositions concurrentes pour la
 * meme penurie.
 */
export function cleProposition(entree: {
  itemId: number;
  warehouseId: number;
  locationId?: number | null;
  quantitePosition: Prisma.Decimal | string | number;
}): string {
  const emplacement = entree.locationId ?? 0;
  return [
    `ART:${entree.itemId}`,
    `DEP:${entree.warehouseId}`,
    `LOC:${emplacement}`,
    `POS:${D.toFixed(entree.quantitePosition, 6)}`,
  ].join("|");
}

export interface PropositionCreee {
  propositionId: number;
  cle: string;
  dejaExistante: boolean;
}

/**
 * Enregistre la proposition d'un article a un emplacement.
 *
 * Idempotent : la proposition est creee avec sa cle deterministe ; si une
 * proposition identique existe deja a l'etat PROPOSEE, elle est retournee telle
 * quelle au lieu d'en creer une seconde.
 */
export async function enregistrerProposition(
  entree: {
    itemId: number;
    warehouseId: number;
    locationId?: number | null;
    acteur: { id: number; email: string };
  },
  db: Db = prisma,
): Promise<PropositionCreee> {
  const position = await positionReapprovisionnement(
    {
      itemId: entree.itemId,
      warehouseId: entree.warehouseId,
      locationId: entree.locationId,
    },
    db,
  );

  if (!position.sousLeMinimum) {
    throw validation(
      `${position.codeArticle} : la position (${D.toFixed(position.quantitePosition, 3)}) est au-dessus du minimum (${D.toFixed(position.quantiteMin, 3)}). Aucun reapprovisionnement n'est propose.`,
    );
  }
  if (D.isZero(position.quantiteProposee)) {
    throw validation(
      `${position.codeArticle} : la position est deja au niveau de la cible. Aucune quantite n'est proposee.`,
    );
  }

  const reglage = await db.itemWarehouseSetting.findUnique({
    where: {
      itemId_warehouseId: {
        itemId: entree.itemId,
        warehouseId: entree.warehouseId,
      },
    },
    select: { supplierId: true, sourceWarehouseId: true, leadTimeDays: true },
  });

  const cle = cleProposition({
    itemId: entree.itemId,
    warehouseId: entree.warehouseId,
    locationId: position.locationId,
    quantitePosition: position.quantitePosition,
  });

  const existante = await db.replenishmentProposal.findFirst({
    where: { proposalKey: cle, status: "PROPOSEE" },
  });
  if (existante) {
    return { propositionId: existante.id, cle, dejaExistante: true };
  }

  const proposition = await db.replenishmentProposal.create({
    data: {
      proposalKey: cle,
      itemId: entree.itemId,
      warehouseId: entree.warehouseId,
      locationId: position.locationId,
      quantityPhysical: position.quantitePhysique,
      quantityReserved: position.quantiteReservee,
      quantityImmobilized: position.quantiteImmobilisee,
      quantityPosition: position.quantitePosition,
      quantityMin: position.quantiteMin,
      quantityTarget: position.quantiteCible,
      proposedQuantity: position.quantiteProposee,
      supplyMode: position.mode,
      supplierId: reglage?.supplierId ?? null,
      sourceWarehouseId: reglage?.sourceWarehouseId ?? null,
      status: "PROPOSEE",
      motif: position.quantiteImmobilisee.isZero()
        ? `Position ${D.toFixed(position.quantitePosition, 3)} sous le minimum ${D.toFixed(position.quantiteMin, 3)}.`
        : `Position ${D.toFixed(position.quantitePosition, 3)} sous le minimum ${D.toFixed(position.quantiteMin, 3)} ; ${D.toFixed(position.quantiteImmobilisee, 3)} immobilise(s) non comptes.`,
    },
  });

  await db.itemWarehouseSetting.update({
    where: {
      itemId_warehouseId: {
        itemId: entree.itemId,
        warehouseId: entree.warehouseId,
      },
    },
    data: { lastProposalAt: proposition.computedAt },
  });

  await enregistrerAudit(
    {
      action: ACTIONS_AUDIT.CREATION,
      module: MODULES_AUDIT.STOCK,
      entity: "ReplenishmentProposal",
      entityId: proposition.id,
      userId: entree.acteur.id,
      userEmail: entree.acteur.email,
      newValue: {
        article: position.codeArticle,
        depot: position.codeDepot,
        position: D.toFixed(position.quantitePosition, 6),
        minimum: D.toFixed(position.quantiteMin, 6),
        cible: D.toFixed(position.quantiteCible, 6),
        propose: D.toFixed(position.quantiteProposee, 6),
        mode: position.mode,
      },
      comment:
        "Proposition de reapprovisionnement : aucun achat, aucun transfert et aucune ecriture comptable n'en decoulent.",
    },
    db,
  );

  return { propositionId: proposition.id, cle, dejaExistante: false };
}

/**
 * Le responsable valide une proposition.
 *
 * Valider ne declenche RIEN d'autre : ni commande fournisseur, ni ecriture
 * comptable, ni mouvement de stock. C'est un acte de decision, trace, qui donne
 * a l'acheteur ou au magasin le droit d'agir par ses propres circuits.
 */
export async function validerProposition(
  entree: {
    propositionId: number;
    quantiteRetenue?: Prisma.Decimal | string | number | null;
    comment?: string | null;
    acteur: { id: number; email: string };
  },
  db: Db = prisma,
) {
  const proposition = await db.replenishmentProposal.findUnique({
    where: { id: entree.propositionId },
  });
  if (!proposition) throw nonTrouve("La proposition de reapprovisionnement");
  if (proposition.status !== "PROPOSEE") {
    throw conflit(
      `Cette proposition est deja ${proposition.status === "VALIDEE" ? "validee" : "cloturee"} : elle ne se valide pas deux fois.`,
    );
  }

  const retenue =
    entree.quantiteRetenue === null || entree.quantiteRetenue === undefined
      ? proposition.proposedQuantity
      : D.of(entree.quantiteRetenue);

  if (D.lte(retenue, 0)) {
    throw validation(
      "La quantite retenue doit etre strictement positive. Pour abandonner une proposition, rejetez-la.",
    );
  }

  const misAJour = await db.replenishmentProposal.update({
    where: { id: entree.propositionId },
    data: {
      status: "VALIDEE",
      quantityApproved: retenue,
      validatedById: entree.acteur.id,
      validatedAt: new Date(),
      comment: entree.comment ?? proposition.comment,
    },
  });

  await enregistrerAudit(
    {
      action: ACTIONS_AUDIT.VALIDATION,
      module: MODULES_AUDIT.STOCK,
      entity: "ReplenishmentProposal",
      entityId: proposition.id,
      userId: entree.acteur.id,
      userEmail: entree.acteur.email,
      previousValue: {
        statut: proposition.status,
        quantiteProposee: D.toFixed(proposition.proposedQuantity, 6),
      },
      newValue: {
        statut: "VALIDEE",
        quantiteRetenue: D.toFixed(retenue, 6),
        mode: proposition.supplyMode,
      },
      comment:
        "Decision du responsable : aucun document d'achat, aucun transfert et aucune ecriture comptable ne sont emis automatiquement.",
    },
    db,
  );

  return misAJour;
}

/** Rejet d'une proposition : meme trace, aucune suite. */
export async function rejeterProposition(
  entree: {
    propositionId: number;
    motif: string;
    acteur: { id: number; email: string };
  },
  db: Db = prisma,
) {
  const proposition = await db.replenishmentProposal.findUnique({
    where: { id: entree.propositionId },
  });
  if (!proposition) throw nonTrouve("La proposition de reapprovisionnement");
  if (proposition.status !== "PROPOSEE") {
    throw conflit("Cette proposition a deja ete traitee.");
  }

  const motif = entree.motif.trim();
  if (motif.length < 3) {
    throw validation("Le motif de rejet est obligatoire.");
  }

  const misAJour = await db.replenishmentProposal.update({
    where: { id: entree.propositionId },
    data: {
      status: "REJETEE",
      motif,
      validatedById: entree.acteur.id,
      validatedAt: new Date(),
    },
  });

  await enregistrerAudit(
    {
      action: ACTIONS_AUDIT.ANNULATION,
      module: MODULES_AUDIT.STOCK,
      entity: "ReplenishmentProposal",
      entityId: proposition.id,
      userId: entree.acteur.id,
      userEmail: entree.acteur.email,
      newValue: { statut: "REJETEE", motif },
    },
    db,
  );

  return misAJour;
}

/** Propositions en attente, avec de quoi decider. */
export async function listerPropositions(
  filtres: {
    statut?: "PROPOSEE" | "VALIDEE" | "REJETEE" | "ANNULEE";
    factory?: "ADMEDCO" | "MOBILIX" | "COMMUN";
    limite?: number;
  } = {},
  db: Db = prisma,
) {
  return db.replenishmentProposal.findMany({
    where: {
      ...(filtres.statut ? { status: filtres.statut } : {}),
      ...(filtres.factory ? { warehouse: { factory: filtres.factory } } : {}),
    },
    include: {
      item: { select: { code: true, label1: true, unitCode: true } },
      warehouse: { select: { code: true, label: true, factory: true } },
      location: { select: { code: true } },
      supplier: { select: { code: true, name: true } },
      sourceWarehouse: { select: { code: true, label: true } },
      validatedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ computedAt: "desc" }],
    take: Math.min(500, Math.max(1, filtres.limite ?? 100)),
  });
}

export const LIBELLES_MODE: Record<SupplyMode, string> = {
  ACHAT: "Achat fournisseur",
  FABRICATION: "Fabrication interne",
  TRANSFERT_INTERNE: "Transfert interne",
};
