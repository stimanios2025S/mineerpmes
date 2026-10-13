/**
 * Reservation des matieres au lancement d'un OF : le NIVEAU de stock.
 *
 * Deux niveaux coexistent dans `StockBalance` :
 *  - la ligne AGREGE (lotId null, locationId null), ecrite par un appel a
 *    `reserverStock` sans `lotId` ;
 *  - les lignes REELLES, portees par un lot et/ou un emplacement, et c'est la
 *    que le stock importe et receptionne est effectivement ecrit.
 *
 * `disponibleArticle` additionne TOUTES les lignes LIBRE, lots compris, alors
 * que `reserverStock` n'adresse jamais qu'une seule ligne. Ces tests verrouillent
 * le fait que la reservation se fait au niveau que la disponibilite rapporte.
 */

import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { creerOrdreFabrication, lancerOrdreFabrication } from "@/lib/production/service";
import { cleSolde, enregistrerMouvement, type ActeurStock } from "@/lib/stock/service";
import { acteurTest, jeton, supprimerParPrefixe } from "@/tests/aide";

const PREFIXE = jeton("TRSV");
const CODE_OPERATION = "COUPE";

let acteur: ActeurStock;
let depot: { id: number; code: string };
let operationId: number;
let workCenterId: number | null;

function dansTransaction<T>(
  travail: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(travail, { timeout: 60_000 });
}

async function chargerDepot(code: string): Promise<{ id: number; code: string }> {
  const trouve = await prisma.warehouse.findUnique({
    where: { code },
    select: { id: true, code: true },
  });
  if (!trouve) throw new Error(`Depot ${code} absent du referentiel de test.`);
  return trouve;
}

/** Entree en stock reelle, par mouvement : jamais une quantite ecrite a la main. */
async function entree(options: {
  itemId: number;
  quantity: string;
  unitCost: string;
  lotId?: number | null;
  locationId?: number | null;
}): Promise<void> {
  await dansTransaction((tx) =>
    enregistrerMouvement(tx, {
      type: "ENTREE_INITIALE",
      itemId: options.itemId,
      warehouseId: depot.id,
      quantity: options.quantity,
      unitCost: options.unitCost,
      lotId: options.lotId ?? null,
      locationId: options.locationId ?? null,
      comment: `Approvisionnement de test ${PREFIXE}`,
      acteur,
    }),
  );
}

async function solde(
  itemId: number,
  cle: { lotId?: number | null; locationId?: number | null },
) {
  return prisma.stockBalance.findUnique({
    where: {
      balanceKey: cleSolde({
        itemId,
        warehouseId: depot.id,
        lotId: cle.lotId ?? null,
        locationId: cle.locationId ?? null,
      }),
    },
    select: { quantityPhysical: true, quantityReserved: true },
  });
}

interface Banc {
  produit: { id: number; code: string };
  composant: { id: number; code: string };
  formule: { id: number };
  gamme: { id: number };
}

/**
 * Un produit fini, un composant, une nomenclature d'une seule ligne et une gamme
 * d'une seule operation. Chaque test possede son propre banc : aucun etat n'est
 * partage entre les cas.
 */
async function creerBanc(suffixe: string): Promise<Banc> {
  const produit = await prisma.item.create({
    data: {
      code: `${PREFIXE}-${suffixe}-PF`,
      label1: `Produit fini de test ${suffixe}`,
      type: "PRODUIT_FINI",
      status: "ACTIF",
      factory: "ADMEDCO",
      unitCode: "PCS",
      isProducible: true,
    },
    select: { id: true, code: true },
  });

  const composant = await prisma.item.create({
    data: {
      code: `${PREFIXE}-${suffixe}-MP`,
      label1: `Composant de test ${suffixe}`,
      type: "MATIERE_PREMIERE",
      status: "ACTIF",
      factory: "ADMEDCO",
      unitCode: "PCS",
    },
    select: { id: true, code: true },
  });

  const formule = await prisma.formula.create({
    data: {
      code: `${PREFIXE}-${suffixe}-BOM`,
      version: 1,
      label: `Nomenclature de test ${suffixe}`,
      itemId: produit.id,
      status: "ACTIVE",
      isDefault: true,
      warehouseProdId: depot.id,
      warehouseStoreId: depot.id,
      lines: {
        create: [
          {
            lineNo: 1,
            componentItemId: composant.id,
            quantity: "2",
            unitCode: "PCS",
            operationCode: CODE_OPERATION,
            unitCost: "2",
          },
        ],
      },
    },
    select: { id: true },
  });

  const gamme = await prisma.productRoute.create({
    data: {
      code: `${PREFIXE}-${suffixe}-GAM`,
      label: `Gamme de test ${suffixe}`,
      itemId: produit.id,
      version: 1,
      status: "ACTIVE",
      factory: "ADMEDCO",
      isDefault: true,
      steps: {
        create: [
          {
            stepNo: 1,
            operationId,
            workCenterId,
            standardTimeMinutes: "1",
            isFinalStep: true,
          },
        ],
      },
    },
    select: { id: true },
  });

  return { produit, composant, formule, gamme };
}

/** Cree un OF de `quantite` produits, soit `quantite x 2` composants requis. */
async function creerOrdre(banc: Banc, quantite: string) {
  return creerOrdreFabrication({
    itemId: banc.produit.id,
    quantityPlanned: quantite,
    factory: "ADMEDCO",
    formulaId: banc.formule.id,
    routeId: banc.gamme.id,
    sourceWarehouseId: depot.id,
    targetWarehouseId: depot.id,
    notes: `Ordre de test reservation ${PREFIXE}`,
    acteur,
  });
}

beforeAll(async () => {
  acteur = await acteurTest();
  depot = await chargerDepot("DEP-MP");

  const operation = await prisma.operation.findUnique({
    where: { code: CODE_OPERATION },
    select: { id: true },
  });
  expect(operation, `L'operation ${CODE_OPERATION} doit exister`).not.toBeNull();
  operationId = operation!.id;

  const poste = await prisma.workCenter.findUnique({
    where: { code: `PT-${CODE_OPERATION}` },
    select: { id: true },
  });
  workCenterId = poste?.id ?? null;
});

afterAll(async () => {
  await supprimerParPrefixe(PREFIXE);
  await prisma.location.deleteMany({ where: { code: { startsWith: PREFIXE } } });
});

describe("Reservation au lancement : niveau de stock", () => {
  it("reserve le stock porte par les lots et laisse la ligne agregee a zero", async () => {
    const banc = await creerBanc("LOT");

    const lot1 = await prisma.stockLot.create({
      data: {
        itemId: banc.composant.id,
        warehouseId: depot.id,
        lotNumber: `${PREFIXE}-LOT-1`,
        status: "LIBRE",
      },
    });
    const lot2 = await prisma.stockLot.create({
      data: {
        itemId: banc.composant.id,
        warehouseId: depot.id,
        lotNumber: `${PREFIXE}-LOT-2`,
        status: "LIBRE",
      },
    });

    await entree({ itemId: banc.composant.id, quantity: "5", unitCost: "2", lotId: lot1.id });
    await entree({ itemId: banc.composant.id, quantity: "4", unitCost: "2", lotId: lot2.id });

    // 3 produits x 2 = 6 requis, servis par le lot 1 (5) puis le lot 2 (1).
    const ordre = await creerOrdre(banc, "3");
    await lancerOrdreFabrication(ordre.workOrderId, acteur);

    const agrege = await solde(banc.composant.id, {});
    const surLot1 = await solde(banc.composant.id, { lotId: lot1.id });
    const surLot2 = await solde(banc.composant.id, { lotId: lot2.id });

    expect(
      agrege?.quantityReserved.toFixed(6) ?? "0.000000",
      "La ligne agregee ne doit porter aucune reservation : le stock est sur les lots",
    ).toBe("0.000000");
    expect(surLot1?.quantityReserved.toFixed(6), "Le lot 1 doit porter sa part").toBe("5.000000");
    expect(surLot2?.quantityReserved.toFixed(6), "Le lot 2 doit porter le reste").toBe("1.000000");

    const matiere = await prisma.workOrderMaterial.findFirstOrThrow({
      where: { workOrderId: ordre.workOrderId, componentItemId: banc.composant.id },
    });
    expect(matiere.quantityReserved.toFixed(6)).toBe("6.000000");

    // La repartition doit survivre au lancement : sans elle, la reservation
    // globale est visible mais plus personne ne sait quelle ligne liberer.
    const allocations = await prisma.workOrderMaterialAllocation.findMany({
      where: { materialId: matiere.id },
      orderBy: { lotId: "asc" },
    });
    expect(
      allocations.map((allocation) => [
        allocation.lotId,
        allocation.locationId,
        allocation.quantityReserved.toFixed(6),
      ]),
    ).toEqual([
      [lot1.id, null, "5.000000"],
      [lot2.id, null, "1.000000"],
    ]);
  });

  it("reserve le stock range dans un emplacement", async () => {
    const banc = await creerBanc("EMPL");

    const emplacement = await prisma.location.create({
      data: {
        code: `${PREFIXE}-EMPL`,
        label: "Emplacement de test",
        warehouseId: depot.id,
      },
    });

    await entree({
      itemId: banc.composant.id,
      quantity: "10",
      unitCost: "2",
      locationId: emplacement.id,
    });

    // 2 produits x 2 = 4 requis, entierement couverts par l'emplacement.
    const ordre = await creerOrdre(banc, "2");
    await lancerOrdreFabrication(ordre.workOrderId, acteur);

    const surEmplacement = await solde(banc.composant.id, { locationId: emplacement.id });
    const agrege = await solde(banc.composant.id, {});

    expect(
      surEmplacement?.quantityReserved.toFixed(6),
      "L'emplacement qui porte la matiere doit porter la reservation",
    ).toBe("4.000000");
    expect(
      agrege?.quantityReserved.toFixed(6) ?? "0.000000",
      "La ligne agregee ne doit rien porter",
    ).toBe("0.000000");

    const matiere = await prisma.workOrderMaterial.findFirstOrThrow({
      where: { workOrderId: ordre.workOrderId, componentItemId: banc.composant.id },
    });
    const allocations = await prisma.workOrderMaterialAllocation.findMany({
      where: { materialId: matiere.id },
    });
    expect(
      allocations.map((allocation) => [
        allocation.locationId,
        allocation.lotId,
        allocation.quantityReserved.toFixed(6),
      ]),
      "L'allocation doit designer l'emplacement, pas la ligne agregee",
    ).toEqual([[emplacement.id, null, "4.000000"]]);
  });
});
