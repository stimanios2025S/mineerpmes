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
import {
  annulerOrdreFabrication,
  cloturerOrdreFabrication,
  creerOrdreFabrication,
  declarerConsommation,
  demarrerOperation,
  deplacerCarteKanban,
  lancerOrdreFabrication,
} from "@/lib/production/service";
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

// -----------------------------------------------------------------------------
// Consommation et liberation de la reservation
// -----------------------------------------------------------------------------

/** Lance un OF du banc et demarre son unique operation. */
async function lancerEtDemarrer(banc: Banc, quantite: string) {
  const ordre = await creerOrdre(banc, quantite);
  await lancerOrdreFabrication(ordre.workOrderId, acteur);

  const operation = await prisma.workOrderOperation.findFirstOrThrow({
    where: { workOrderId: ordre.workOrderId },
    orderBy: { stepNo: "asc" },
  });
  const matiere = await prisma.workOrderMaterial.findFirstOrThrow({
    where: { workOrderId: ordre.workOrderId, componentItemId: banc.composant.id },
  });

  await demarrerOperation({
    workOrderOperationId: operation.id,
    acteur,
    commentaire: `Demarrage de test ${PREFIXE}`,
  });

  return { ordre, operation, matiere };
}

/** Termine l'unique operation du banc, ce qui termine aussi l'ordre. */
async function terminerOperation(operationId: number): Promise<void> {
  await deplacerCarteKanban({
    workOrderOperationId: operationId,
    quantite: "1",
    acteur,
    forcer: true,
    commentaire: `Fin de chaine de test ${PREFIXE}`,
  });
}

async function allocationsDe(materialId: number) {
  return prisma.workOrderMaterialAllocation.findMany({
    where: { materialId },
    orderBy: { id: "asc" },
  });
}

async function creerLot(banc: Banc, suffixe: string) {
  return prisma.stockLot.create({
    data: {
      itemId: banc.composant.id,
      warehouseId: depot.id,
      lotNumber: `${PREFIXE}-${suffixe}`,
      status: "LIBRE",
    },
  });
}

const ZERO = "0.000000";

describe("Consommation : sortie sur les lignes exactes", () => {
  it("sort de chaque lot et rattache les DEUX mouvements a une seule declaration", async () => {
    const banc = await creerBanc("CONSLOT");
    const lot1 = await creerLot(banc, "SLOT-1");
    const lot2 = await creerLot(banc, "SLOT-2");

    await entree({ itemId: banc.composant.id, quantity: "5", unitCost: "2", lotId: lot1.id });
    await entree({ itemId: banc.composant.id, quantity: "4", unitCost: "2", lotId: lot2.id });

    // 3 produits x 2 = 6 requis : le lot 1 (5) puis le lot 2 (1).
    const { operation, matiere } = await lancerEtDemarrer(banc, "3");

    const resultat = await declarerConsommation({
      workOrderOperationId: operation.id,
      materialId: matiere.id,
      quantite: "6",
      acteur,
      commentaire: `Consommation de test ${PREFIXE}`,
    });

    const mouvements = await prisma.stockMovement.findMany({
      where: { declarationId: resultat.declarationId },
      orderBy: { id: "asc" },
    });
    expect(
      mouvements.map((mouvement) => [
        mouvement.lotId,
        mouvement.locationId,
        mouvement.quantity.toFixed(6),
      ]),
      "Une consommation sur deux lots sort deux mouvements, tous deux rattaches a la declaration",
    ).toEqual([
      [lot1.id, null, "-5.000000"],
      [lot2.id, null, "-1.000000"],
    ]);

    expect((await solde(banc.composant.id, { lotId: lot1.id }))?.quantityPhysical.toFixed(6)).toBe(ZERO);
    expect((await solde(banc.composant.id, { lotId: lot2.id }))?.quantityPhysical.toFixed(6)).toBe("3.000000");

    // Aucune reservation ne survit a la consommation.
    expect((await solde(banc.composant.id, { lotId: lot1.id }))?.quantityReserved.toFixed(6)).toBe(ZERO);
    expect((await solde(banc.composant.id, { lotId: lot2.id }))?.quantityReserved.toFixed(6)).toBe(ZERO);

    const allocations = await allocationsDe(matiere.id);
    expect(
      allocations.map((allocation) => [
        allocation.lotId,
        allocation.quantityReserved.toFixed(6),
        allocation.quantityConsumed.toFixed(6),
      ]),
    ).toEqual([
      [lot1.id, "5.000000", "5.000000"],
      [lot2.id, "1.000000", "1.000000"],
    ]);
  });

  it("sort de l'emplacement qui porte la matiere, pas de la ligne agregee", async () => {
    const banc = await creerBanc("CONSEMPL");
    const emplacement = await prisma.location.create({
      data: {
        code: `${PREFIXE}-CONSEMPL`,
        label: "Emplacement de consommation",
        warehouseId: depot.id,
      },
    });

    await entree({
      itemId: banc.composant.id,
      quantity: "10",
      unitCost: "2",
      locationId: emplacement.id,
    });

    const { operation, matiere } = await lancerEtDemarrer(banc, "2");

    const resultat = await declarerConsommation({
      workOrderOperationId: operation.id,
      materialId: matiere.id,
      quantite: "4",
      acteur,
    });

    const mouvements = await prisma.stockMovement.findMany({
      where: { declarationId: resultat.declarationId },
    });
    expect(mouvements).toHaveLength(1);
    expect(mouvements[0].locationId).toBe(emplacement.id);

    const surEmplacement = await solde(banc.composant.id, { locationId: emplacement.id });
    expect(surEmplacement?.quantityPhysical.toFixed(6)).toBe("6.000000");
    expect(surEmplacement?.quantityReserved.toFixed(6)).toBe(ZERO);
  });

  it("accepte un stock partiel : la reservation est plafonnee, la consommation reste possible", async () => {
    const banc = await creerBanc("CONSPART");
    const lot = await creerLot(banc, "SPART-1");

    // 4 en stock pour 6 requis : la reservation est plafonnee a 4.
    await entree({ itemId: banc.composant.id, quantity: "4", unitCost: "2", lotId: lot.id });

    const { operation, matiere } = await lancerEtDemarrer(banc, "3");

    expect(matiere.quantityReserved.toFixed(6)).toBe("4.000000");
    expect((await allocationsDe(matiere.id)).map((a) => a.quantityReserved.toFixed(6))).toEqual(["4.000000"]);

    await declarerConsommation({
      workOrderOperationId: operation.id,
      materialId: matiere.id,
      quantite: "4",
      acteur,
    });

    expect((await solde(banc.composant.id, { lotId: lot.id }))?.quantityPhysical.toFixed(6)).toBe(ZERO);
    expect((await solde(banc.composant.id, { lotId: lot.id }))?.quantityReserved.toFixed(6)).toBe(ZERO);
  });

  it("refuse une consommation au-dela du stock libre reellement disponible", async () => {
    const banc = await creerBanc("CONSMANQUE");
    const lot = await creerLot(banc, "MANQUE-1");
    await entree({ itemId: banc.composant.id, quantity: "4", unitCost: "2", lotId: lot.id });

    const { operation, matiere } = await lancerEtDemarrer(banc, "3");

    await expect(
      declarerConsommation({
        workOrderOperationId: operation.id,
        materialId: matiere.id,
        quantite: "5",
        acteur,
      }),
    ).rejects.toMatchObject({ code: "STOCK_INSUFFISANT" });

    // Rien n'a bouge : la transaction est integralement annulee.
    expect((await solde(banc.composant.id, { lotId: lot.id }))?.quantityPhysical.toFixed(6)).toBe("4.000000");
    expect((await solde(banc.composant.id, { lotId: lot.id }))?.quantityReserved.toFixed(6)).toBe("4.000000");
  });

  it("respecte la reservation d'un AUTRE ordre sur la meme ligne", async () => {
    const banc = await creerBanc("CONSDEUX");
    const lot = await creerLot(banc, "DEUX-1");
    await entree({ itemId: banc.composant.id, quantity: "10", unitCost: "2", lotId: lot.id });

    // Deux ordres sur la meme matiere : 6 + 4 = 10, tout est immobilise.
    const premier = await lancerEtDemarrer(banc, "3");
    const second = await lancerEtDemarrer(banc, "2");

    expect(premier.matiere.quantityReserved.toFixed(6)).toBe("6.000000");
    expect(second.matiere.quantityReserved.toFixed(6)).toBe("4.000000");
    expect((await solde(banc.composant.id, { lotId: lot.id }))?.quantityReserved.toFixed(6)).toBe("10.000000");

    // Le premier consomme SES 6 : la part du second reste intacte.
    await declarerConsommation({
      workOrderOperationId: premier.operation.id,
      materialId: premier.matiere.id,
      quantite: "6",
      acteur,
    });

    expect((await solde(banc.composant.id, { lotId: lot.id }))?.quantityReserved.toFixed(6)).toBe("4.000000");
    expect((await solde(banc.composant.id, { lotId: lot.id }))?.quantityPhysical.toFixed(6)).toBe("4.000000");

    // Le second consomme les siens.
    await declarerConsommation({
      workOrderOperationId: second.operation.id,
      materialId: second.matiere.id,
      quantite: "4",
      acteur,
    });

    const final = await solde(banc.composant.id, { lotId: lot.id });
    expect(final?.quantityPhysical.toFixed(6)).toBe(ZERO);
    expect(final?.quantityReserved.toFixed(6)).toBe(ZERO);
  });
});

describe("Liberation du reliquat", () => {
  it("rend la matiere non consommee a la cloture, et une seule fois", async () => {
    const banc = await creerBanc("CLOTREL");
    const lot = await creerLot(banc, "CLOT-1");
    await entree({ itemId: banc.composant.id, quantity: "10", unitCost: "2", lotId: lot.id });

    const { ordre, operation, matiere } = await lancerEtDemarrer(banc, "3");
    await declarerConsommation({
      workOrderOperationId: operation.id,
      materialId: matiere.id,
      quantite: "2",
      acteur,
    });

    // 6 reserves, 2 consommes : 4 restent immobilises.
    expect((await solde(banc.composant.id, { lotId: lot.id }))?.quantityReserved.toFixed(6)).toBe("4.000000");

    await terminerOperation(operation.id);
    await cloturerOrdreFabrication(ordre.workOrderId, acteur, `Cloture de test ${PREFIXE}`);

    const apresCloture = await solde(banc.composant.id, { lotId: lot.id });
    expect(apresCloture?.quantityReserved.toFixed(6), "Le reliquat est rendu").toBe(ZERO);
    expect(apresCloture?.quantityPhysical.toFixed(6), "Seul le consomme est sorti").toBe("8.000000");

    // Idempotence : une seconde cloture est refusee, et rien n'a ete libere deux fois.
    await expect(
      cloturerOrdreFabrication(ordre.workOrderId, acteur),
    ).rejects.toMatchObject({ code: "CONFLIT" });

    expect((await solde(banc.composant.id, { lotId: lot.id }))?.quantityReserved.toFixed(6)).toBe(ZERO);
    const allocation = (await allocationsDe(matiere.id))[0];
    expect(allocation.quantityReserved.toFixed(6)).toBe(allocation.quantityConsumed.toFixed(6));
  });

  it("rend toute la reservation a l'annulation", async () => {
    const banc = await creerBanc("ANNULLIB");
    const lot = await creerLot(banc, "ANNUL-1");
    await entree({ itemId: banc.composant.id, quantity: "10", unitCost: "2", lotId: lot.id });

    const { ordre, matiere } = await lancerEtDemarrer(banc, "3");
    expect((await solde(banc.composant.id, { lotId: lot.id }))?.quantityReserved.toFixed(6)).toBe("6.000000");

    await annulerOrdreFabrication(ordre.workOrderId, `Annulation de test ${PREFIXE}`, acteur);

    const apres = await solde(banc.composant.id, { lotId: lot.id });
    expect(apres?.quantityReserved.toFixed(6)).toBe(ZERO);
    expect(apres?.quantityPhysical.toFixed(6), "Annuler ne sort aucune matiere").toBe("10.000000");

    const allocation = (await allocationsDe(matiere.id))[0];
    expect(allocation.quantityReserved.toFixed(6)).toBe(ZERO);
    expect(allocation.quantityConsumed.toFixed(6)).toBe(ZERO);
  });
});
