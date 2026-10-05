/**
 * Tests d'integration du domaine PRODUCTION (MES).
 *
 * Ils s'executent contre la vraie base PostgreSQL preparee par `src/tests/setup.ts` :
 * les ordres de fabrication, les declarations d'atelier, les transitions Kanban
 * et les mouvements de stock sont reels et relus en base. Aucun service n'est
 * remplace par un simulateur.
 *
 * Le test central est la fin de chaine POUDRAGE : les consommations reellement
 * declarees en atelier sont enregistrees, le chassis peint entre en stock dans
 * le depot ADMEDCO puis est transfere vers le depot MOBILIX, et toute la chaine
 * reste tracable (ordre -> declaration -> transition -> mouvements -> audit).
 */

import { Prisma, type LossCategory } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { CLE_PARAMETRE } from "@/lib/settings";
import {
  annulerOrdreFabrication,
  cloturerOrdreFabrication,
  creerOrdreFabrication,
  declarerConsommation,
  declarerPerte,
  declarerProduction,
  demarrerOperation,
  deplacerCarteKanban,
  lancerOrdreFabrication,
  type ResultatKanban,
} from "@/lib/production/service";
import {
  adopterArticleChassisPeint,
  analyserArticleChassisPeint,
  assurerChassisPeint,
  resoudreArticleChassisPeint,
} from "@/lib/production/chassis-peint";
import { enregistrerMouvement, type ActeurStock } from "@/lib/stock/service";
import { acteurTest, jeton, supprimerParPrefixe } from "@/tests/aide";

/** Prefixe unique : toutes les donnees creees par ce fichier portent ce jeton. */
const PREFIXE = jeton("TPRD");

/** Chaine de fabrication ADMEDCO du referentiel : le poudrage la termine. */
const CHAINE_ADMEDCO = ["COUPE", "USINAGE", "SOUDAGE", "MEULAGE", "VISSAGE", "POUDRAGE"];

/** Article semi-fini et regle de transfert deja presents dans le referentiel. */
const CODE_CHASSIS = "SF-CHASSIS-PEINT";
const CODE_REGLE = "TRF-POUDRAGE-CHASSIS";

let acteur: ActeurStock;
let depotMP: { id: number; code: string };
let depotMBX: { id: number; code: string };
let depotPF: { id: number; code: string };

let itemPF: { id: number; code: string };
let itemAcier: { id: number; code: string };
let itemPeint: { id: number; code: string };
let itemVis: { id: number; code: string };

let formule: { id: number; code: string; version: number };
let gamme: { id: number; code: string };
let operationPoudrage: { id: number; code: string };

let chassisPeint: { id: number; code: string };
let regleTransfert: { id: number; code: string };
let regleCreee = false;
let regleOrigine: {
  triggerOperationCode: string;
  producedItemId: number;
  sourceWarehouseId: number;
  targetWarehouseId: number;
  isActive: boolean;
} | null = null;

let parametreOrigine: Prisma.JsonValue = true;
let chassisOrigine: { vwap: string; standardCost: string } | null = null;

// -----------------------------------------------------------------------------
// Outils de test
// -----------------------------------------------------------------------------

function dansTransaction<T>(
  travail: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(travail, { timeout: 60_000 });
}

async function chargerDepot(code: string): Promise<{ id: number; code: string }> {
  const depot = await prisma.warehouse.findUnique({
    where: { code },
    select: { id: true, code: true },
  });
  if (!depot) throw new Error(`Depot ${code} absent du referentiel de test.`);
  return depot;
}

async function creerArticle(
  suffixe: string,
  options: {
    type?: "MATIERE_PREMIERE" | "COMPOSANT" | "SEMI_FINI" | "PRODUIT_FINI";
    unitCode?: string;
    isProducible?: boolean;
    isSemiFinished?: boolean;
    status?: "ACTIF" | "ARCHIVE";
  } = {},
): Promise<{ id: number; code: string }> {
  return prisma.item.create({
    data: {
      code: `${PREFIXE}-${suffixe}`,
      label1: `Article de test ${suffixe}`,
      type: options.type ?? "COMPOSANT",
      status: options.status ?? "ACTIF",
      factory: "ADMEDCO",
      unitCode: options.unitCode ?? "PCS",
      isProducible: options.isProducible ?? false,
      isSemiFinished: options.isSemiFinished ?? false,
    },
    select: { id: true, code: true },
  });
}

/** Entree en stock reelle, par mouvement : jamais une quantite ecrite a la main. */
async function approvisionner(
  itemId: number,
  warehouseId: number,
  quantity: string,
  unitCost: string,
): Promise<void> {
  await dansTransaction((tx) =>
    enregistrerMouvement(tx, {
      type: "ENTREE_INITIALE",
      itemId,
      warehouseId,
      quantity,
      unitCost,
      comment: `Approvisionnement de test ${PREFIXE}`,
      acteur,
    }),
  );
}

async function creerOrdre(quantite: string, suffixe: string, itemId = itemPF.id) {
  return creerOrdreFabrication({
    itemId,
    quantityPlanned: quantite,
    factory: "ADMEDCO",
    formulaId: formule.id,
    routeId: gamme.id,
    sourceWarehouseId: depotMP.id,
    targetWarehouseId: depotPF.id,
    notes: `Ordre de test ${suffixe} (${PREFIXE})`,
    acteur,
  });
}

interface OperationOrdre {
  id: number;
  stepNo: number;
  operationId: number;
  operation: { id: number; code: string; label: string };
}

async function operationsDeLOrdre(ordreId: number): Promise<OperationOrdre[]> {
  const operations = await prisma.workOrderOperation.findMany({
    where: { workOrderId: ordreId },
    orderBy: { stepNo: "asc" },
    include: { operation: { select: { id: true, code: true, label: true } } },
  });
  return operations;
}

function operationParCode(operations: OperationOrdre[], code: string): OperationOrdre {
  const operation = operations.find((element) => element.operation.code === code);
  expect(operation, `L'operation ${code} doit exister sur l'ordre`).toBeDefined();
  return operation!;
}

async function matiereDeLOperation(
  ordreId: number,
  workOrderOperationId: number,
  composantItemId: number,
) {
  const matiere = await prisma.workOrderMaterial.findFirst({
    where: { workOrderId: ordreId, workOrderOperationId, componentItemId: composantItemId },
  });
  expect(matiere, "Le composant doit etre fige sur l'operation").not.toBeNull();
  return matiere!;
}

/**
 * Verifie le rattachement des composants figes aux operations de la gamme.
 * `WorkOrderMaterial.operationId` reference `Operation` et
 * `workOrderMaterial.workOrderOperationId` l'operation de l'ordre : les deux
 * doivent designer la meme etape de fabrication, sans jamais etre confondus.
 */
async function verifierRattachementOperations(ordreId: number): Promise<void> {
  const matieres = await prisma.workOrderMaterial.findMany({ where: { workOrderId: ordreId } });
  expect(matieres.length).toBeGreaterThan(0);

  for (const matiere of matieres) {
    expect(matiere.workOrderOperationId, "Le composant doit etre rattache a une operation").not.toBeNull();
    expect(matiere.operationId, "Le composant doit pointer sur l'operation du referentiel").not.toBeNull();

    const operation = await prisma.operation.findUniqueOrThrow({
      where: { id: matiere.operationId! },
    });
    const operationDeLOrdre = await prisma.workOrderOperation.findUniqueOrThrow({
      where: { id: matiere.workOrderOperationId! },
      include: { operation: true },
    });

    expect(
      operation.code,
      `Le composant ${matiere.componentItemId} doit pointer sur l'operation ${operationDeLOrdre.operation.code}`,
    ).toBe(operationDeLOrdre.operation.code);
    expect(operationDeLOrdre.operationId).toBe(matiere.operationId);
  }
}

/**
 * Deroule une chaine de fabrication reelle jusqu'au bout : chaque operation est
 * declaree puis deplacee sur le tableau Kanban. La derniere operation terminee
 * declenche la cloture de l'ordre (et donc le transfert inter-divisions).
 */
async function executerChaine(
  ordreId: number,
  quantite: string,
  options: {
    consommationsPoudrage?: Array<{ composant: "PEINT" | "VIS"; quantite: string }>;
    commentaireFinal?: string;
  } = {},
): Promise<{ transitions: ResultatKanban[]; operations: OperationOrdre[] }> {
  const operations = await operationsDeLOrdre(ordreId);
  expect(operations.length, "La gamme doit produire des operations").toBeGreaterThan(0);

  await demarrerOperation({
    workOrderOperationId: operations[0].id,
    acteur,
    commentaire: `Demarrage de la chaine ${PREFIXE}`,
  });

  const transitions: ResultatKanban[] = [];

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    const derniere = index === operations.length - 1;

    await declarerProduction({
      workOrderOperationId: operation.id,
      quantiteProduite: quantite,
      quantiteConforme: quantite,
      acteur,
      commentaire: `Production reelle sur ${operation.operation.code}`,
    });

    if (derniere && options.consommationsPoudrage) {
      for (const consommation of options.consommationsPoudrage) {
        const composant = consommation.composant === "PEINT" ? itemPeint : itemVis;
        const matiere = await matiereDeLOperation(ordreId, operation.id, composant.id);
        const resultat = await declarerConsommation({
          workOrderOperationId: operation.id,
          materialId: matiere.id,
          quantite: consommation.quantite,
          acteur,
          commentaire: `Consommation reelle declaree (${consommation.composant})`,
        });
        expect(resultat.categorie, "La consommation declaree depasse la nomenclature").toBe(
          "SURCONSOMMATION",
        );
      }
    }

    transitions.push(
      await deplacerCarteKanban({
        workOrderOperationId: operation.id,
        quantite,
        acteur,
        commentaire: derniere
          ? (options.commentaireFinal ?? `Fin de chaine ${PREFIXE}`)
          : `Passage vers l'operation suivante`,
      }),
    );
  }

  return { transitions, operations };
}

/**
 * Verifie que le grand livre reste la seule source de verite : pour chaque ligne
 * de solde, la somme des mouvements de meme cle egale la quantite physique.
 */
async function verifierGrandLivre(itemId: number): Promise<void> {
  const soldes = await prisma.stockBalance.findMany({ where: { itemId } });

  for (const solde of soldes) {
    const somme = await prisma.stockMovement.aggregate({
      where: {
        itemId,
        warehouseId: solde.warehouseId,
        locationId: solde.locationId,
        lotId: solde.lotId,
        status: solde.status,
      },
      _sum: { quantity: true },
    });
    expect(
      (somme._sum.quantity ?? D.ZERO).toFixed(6),
      `Solde ${solde.balanceKey} : la somme des mouvements doit egaler la quantite physique`,
    ).toBe(solde.quantityPhysical.toFixed(6));
  }
}

// -----------------------------------------------------------------------------
// Preparation : donnees de test + referentiel reel reutilise tel quel
// -----------------------------------------------------------------------------

beforeAll(async () => {
  acteur = await acteurTest();
  depotMP = await chargerDepot("DEP-MP");
  depotMBX = await chargerDepot("DEP-MP-MBX");
  depotPF = await chargerDepot("DEP-PF");

  // Produit fini de test : nomenclature + gamme sont creees pour lui.
  itemPF = await creerArticle("PF", { type: "PRODUIT_FINI", isProducible: true });
  itemAcier = await creerArticle("ACIER", { type: "MATIERE_PREMIERE" });
  itemPeint = await creerArticle("PEINT", { type: "MATIERE_PREMIERE", unitCode: "KG" });
  itemVis = await creerArticle("VIS");

  // Stock reel des composants, dans le depot de consommation de l'ordre.
  await approvisionner(itemAcier.id, depotMP.id, "1000", "2");
  await approvisionner(itemPeint.id, depotMP.id, "200", "5");
  await approvisionner(itemVis.id, depotMP.id, "1000", "0.5");
  // Produit fini deja en stock (issu de la liberation qualite d'un ordre precedent).
  await approvisionner(itemPF.id, depotPF.id, "5", "100");

  // Nomenclature : acier coupe, peinture et visserie consommees au poudrage.
  formule = await prisma.formula.create({
    data: {
      code: `${PREFIXE}-BOM`,
      version: 1,
      label: "Nomenclature de test ADMEDCO",
      itemId: itemPF.id,
      status: "ACTIVE",
      isDefault: true,
      warehouseProdId: depotMP.id,
      warehouseStoreId: depotPF.id,
      lines: {
        create: [
          {
            lineNo: 1,
            componentItemId: itemAcier.id,
            quantity: "2",
            unitCode: "PCS",
            operationCode: "COUPE",
            unitCost: "2",
          },
          {
            lineNo: 2,
            componentItemId: itemPeint.id,
            quantity: "1.5",
            unitCode: "KG",
            operationCode: "POUDRAGE",
            unitCost: "5",
          },
          {
            lineNo: 3,
            componentItemId: itemVis.id,
            quantity: "8",
            unitCode: "PCS",
            operationCode: "POUDRAGE",
            unitCost: "0.5",
          },
        ],
      },
    },
    select: { id: true, code: true, version: true },
  });

  // Gamme reelle : les operations viennent du referentiel, avec leurs postes.
  const postes = await prisma.workCenter.findMany({
    where: { code: { startsWith: "PT-" } },
    select: { id: true, code: true },
  });
  const posteParCode = new Map(postes.map((poste) => [poste.code.slice(3), poste.id]));
  const operationsReferentiel = await prisma.operation.findMany({
    where: { code: { in: CHAINE_ADMEDCO } },
    select: { id: true, code: true },
  });
  const operationParCodeReferentiel = new Map(
    operationsReferentiel.map((operation) => [operation.code, operation.id]),
  );
  expect(operationsReferentiel).toHaveLength(CHAINE_ADMEDCO.length);

  gamme = await prisma.productRoute.create({
    data: {
      code: `${PREFIXE}-GAM`,
      label: "Gamme de test ADMEDCO",
      itemId: itemPF.id,
      version: 1,
      status: "ACTIVE",
      factory: "ADMEDCO",
      isDefault: true,
      steps: {
        create: CHAINE_ADMEDCO.map((code, index) => ({
          stepNo: index + 1,
          operationId: operationParCodeReferentiel.get(code)!,
          workCenterId: posteParCode.get(code) ?? null,
          standardTimeMinutes: "1",
          isFinalStep: index === CHAINE_ADMEDCO.length - 1,
        })),
      },
    },
    select: { id: true, code: true },
  });

  operationPoudrage = {
    id: operationParCodeReferentiel.get("POUDRAGE")!,
    code: "POUDRAGE",
  };

  // L'article semi-fini du referentiel est recherche AVANT toute creation :
  // le chassis peint existe deja, il ne doit jamais etre duplique.
  const articleChassis = await prisma.item.findUnique({
    where: { code: CODE_CHASSIS },
    select: { id: true, code: true, vwap: true, standardCost: true },
  });
  expect(articleChassis, `L'article ${CODE_CHASSIS} doit exister dans le referentiel`).not.toBeNull();
  chassisPeint = { id: articleChassis!.id, code: articleChassis!.code };
  chassisOrigine = {
    vwap: articleChassis!.vwap.toFixed(6),
    standardCost: articleChassis!.standardCost.toFixed(6),
  };
  // Valorisation de reference du semi-fini, restauree en fin de fichier.
  await prisma.item.update({
    where: { id: chassisPeint.id },
    data: { standardCost: "1200" },
  });

  // La regle de transfert du referentiel est reutilisee telle quelle.
  const regle = await prisma.divisionTransferRule.findUnique({ where: { code: CODE_REGLE } });
  if (regle) {
    regleTransfert = { id: regle.id, code: regle.code };
    regleOrigine = {
      triggerOperationCode: regle.triggerOperationCode,
      producedItemId: regle.producedItemId,
      sourceWarehouseId: regle.sourceWarehouseId,
      targetWarehouseId: regle.targetWarehouseId,
      isActive: regle.isActive,
    };
    await prisma.divisionTransferRule.update({
      where: { id: regle.id },
      data: {
        triggerOperationCode: "POUDRAGE",
        producedItemId: chassisPeint.id,
        sourceWarehouseId: depotMP.id,
        targetWarehouseId: depotMBX.id,
      },
    });
  } else {
    const creee = await prisma.divisionTransferRule.create({
      data: {
        code: CODE_REGLE,
        label: "Transfert automatique du chassis peint apres poudrage",
        triggerOperationCode: "POUDRAGE",
        producedItemId: chassisPeint.id,
        sourceWarehouseId: depotMP.id,
        targetWarehouseId: depotMBX.id,
        factorySource: "ADMEDCO",
        factoryTarget: "MOBILIX",
        isActive: true,
      },
    });
    regleTransfert = { id: creee.id, code: creee.code };
    regleCreee = true;
  }

  const regleActive = await prisma.divisionTransferRule.findUniqueOrThrow({
    where: { id: regleTransfert.id },
  });
  expect(regleActive.isActive, "La regle de transfert doit etre active").toBe(true);
  expect(regleActive.triggerOperationCode).toBe("POUDRAGE");
  expect(regleActive.producedItemId).toBe(chassisPeint.id);
  expect(regleActive.sourceWarehouseId).toBe(depotMP.id);
  expect(regleActive.targetWarehouseId).toBe(depotMBX.id);

  const parametre = await prisma.appSetting.findUnique({
    where: { key: CLE_PARAMETRE.TRANSFERT_AUTO_CHASSIS_PEINT },
  });
  expect(parametre, "Le parametre de transfert automatique doit exister").not.toBeNull();
  parametreOrigine = parametre!.value;
  await prisma.appSetting.update({
    where: { key: CLE_PARAMETRE.TRANSFERT_AUTO_CHASSIS_PEINT },
    data: { value: true },
  });
});

afterAll(async () => {
  // 1. Les donnees creees par le fichier (articles, ordres, mouvements, soldes).
  await supprimerParPrefixe(PREFIXE);

  // 2. Le solde et le lot residuels du chassis peint appartiennent uniquement a
  //    ces tests : ils sont retires une fois tous leurs mouvements supprimes.
  //    (Aucun mouvement n'est jamais supprime ailleurs que dans ce nettoyage.)
  if (chassisPeint) {
    const mouvementsRestants = await prisma.stockMovement.count({
      where: { itemId: chassisPeint.id },
    });
    if (mouvementsRestants === 0) {
      await prisma.stockBalance.deleteMany({ where: { itemId: chassisPeint.id } });
      await prisma.stockLot.deleteMany({ where: { itemId: chassisPeint.id } });
    }
  }

  // 3. Restauration du referentiel : article semi-fini, regle, parametre.
  if (chassisPeint && chassisOrigine) {
    await prisma.item.update({
      where: { id: chassisPeint.id },
      data: {
        vwap: chassisOrigine.vwap,
        standardCost: chassisOrigine.standardCost,
      },
    });
  }

  if (regleTransfert && regleOrigine) {
    await prisma.divisionTransferRule.update({
      where: { id: regleTransfert.id },
      data: { ...regleOrigine },
    });
  } else if (regleCreee && regleTransfert) {
    await prisma.divisionTransferRule.delete({ where: { id: regleTransfert.id } });
  }

  await prisma.appSetting.update({
    where: { key: CLE_PARAMETRE.TRANSFERT_AUTO_CHASSIS_PEINT },
    data: { value: parametreOrigine as Prisma.InputJsonValue },
  });
});

// -----------------------------------------------------------------------------
// 1. Creation et lancement d'un ordre de fabrication
// -----------------------------------------------------------------------------

describe("ordre de fabrication", () => {
  it("cree un ordre reel, le numerote, puis fige la nomenclature au lancement", async () => {
    const ordre = await creerOrdre("10", "CREATION");
    expect(ordre.number).toMatch(/^OF-\d{4}-\d{5}$/);
    expect(ordre.operations).toBe(CHAINE_ADMEDCO.length);

    const enBase = await prisma.workOrder.findUniqueOrThrow({
      where: { id: ordre.workOrderId },
      include: { operations: { orderBy: { stepNo: "asc" }, include: { operation: true } } },
    });
    expect(enBase.status).toBe("BROUILLON");
    expect(enBase.quantityPlanned.toFixed(6)).toBe("10.000000");
    expect(enBase.quantityRemaining.toFixed(6)).toBe("10.000000");
    expect(enBase.quantityProduced.isZero()).toBe(true);
    expect(enBase.itemId).toBe(itemPF.id);
    expect(enBase.formulaId).toBe(formule.id);
    expect(enBase.routeId).toBe(gamme.id);
    expect(enBase.factory).toBe("ADMEDCO");
    expect(enBase.sourceWarehouseId).toBe(depotMP.id);
    expect(enBase.targetWarehouseId).toBe(depotPF.id);
    expect(enBase.createdById).toBe(acteur.id);
    expect(enBase.actualStart).toBeNull();
    expect(enBase.isSemiFinishedOutput).toBe(false);

    // Operations de la gamme, dans l'ordre, avec les vrais postes de travail.
    expect(enBase.operations.map((operation) => operation.operation.code)).toEqual(CHAINE_ADMEDCO);
    expect(enBase.operations.map((operation) => operation.stepNo)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      enBase.operations.every((operation) => operation.status === "NON_DEMARREE"),
    ).toBe(true);
    expect(
      enBase.operations.every((operation) => operation.quantityPlanned.toFixed(6) === "10.000000"),
    ).toBe(true);
    expect(enBase.operations.every((operation) => operation.workCenterId !== null)).toBe(true);
    expect(enBase.operations[5].operation.code).toBe("POUDRAGE");

    // Aucune matiere n'est figee avant le lancement.
    expect(await prisma.workOrderMaterial.count({ where: { workOrderId: ordre.workOrderId } })).toBe(0);

    const lancement = await lancerOrdreFabrication(ordre.workOrderId, acteur);
    expect(lancement.matieres).toBe(3);

    const lance = await prisma.workOrder.findUniqueOrThrow({ where: { id: ordre.workOrderId } });
    expect(lance.status).toBe("LANCE");
    expect(lance.quantityLaunched.toFixed(6)).toBe("10.000000");
    expect(lance.actualStart).not.toBeNull();

    const matieres = await prisma.workOrderMaterial.findMany({
      where: { workOrderId: ordre.workOrderId },
      orderBy: { lineNo: "asc" },
    });
    expect(matieres).toHaveLength(3);

    const acier = matieres.find((matiere) => matiere.componentItemId === itemAcier.id)!;
    const peinture = matieres.find((matiere) => matiere.componentItemId === itemPeint.id)!;
    const visserie = matieres.find((matiere) => matiere.componentItemId === itemVis.id)!;

    // Quantites figees = quantite unitaire x quantite planifiee (+ taux de perte).
    expect(acier.quantityPlanned.toFixed(6)).toBe("20.000000");
    expect(peinture.quantityPlanned.toFixed(6)).toBe("15.000000");
    expect(visserie.quantityPlanned.toFixed(6)).toBe("80.000000");
    expect(acier.unitCost.toFixed(6)).toBe("2.000000");
    expect(peinture.unitCost.toFixed(6)).toBe("5.000000");
    expect(visserie.unitCost.toFixed(6)).toBe("0.500000");
    expect(acier.warehouseId).toBe(depotMP.id);
    expect(acier.snapshotSource).toBe(`Nomenclature ${formule.code} v${formule.version}`);
    expect(acier.snapshotSource).toContain(formule.code);
    expect(acier.quantityConsumed.isZero()).toBe(true);

    // Les composants sont rattaches aux VRAIES operations du referentiel :
    // `operationId` reference `Operation`, `workOrderOperationId` l'operation
    // de l'ordre. Les deux ne doivent jamais etre confondus.
    expect(acier.operationId, "L'acier est consomme a la coupe").toBe(
      enBase.operations[0].operationId,
    );
    expect(acier.workOrderOperationId).toBe(enBase.operations[0].id);
    expect(peinture.operationId, "La peinture est consommee au poudrage").toBe(operationPoudrage.id);
    expect(peinture.workOrderOperationId).toBe(enBase.operations[5].id);
    expect(visserie.operationId).toBe(operationPoudrage.id);
    expect(visserie.workOrderOperationId).toBe(enBase.operations[5].id);
    const operationsDuReferentiel = await prisma.operation.count();
    expect(new Set(matieres.map((matiere) => matiere.operationId)).size).toBe(2);
    expect(
      matieres.every(
        (matiere) => matiere.operationId !== null && matiere.operationId <= operationsDuReferentiel,
      ),
    ).toBe(true);
    await verifierRattachementOperations(ordre.workOrderId);

    // La nomenclature du referentiel peut evoluer : l'ordre deja lance ne bouge plus.
    const ligneAcier = await prisma.formulaLine.findFirstOrThrow({
      where: { formulaId: formule.id, componentItemId: itemAcier.id },
    });
    try {
      await prisma.formulaLine.update({
        where: { id: ligneAcier.id },
        data: { quantity: "9" },
      });
      const matiereFigee = await prisma.workOrderMaterial.findUniqueOrThrow({
        where: { id: acier.id },
      });
      expect(matiereFigee.quantityPlanned.toFixed(6)).toBe("20.000000");
    } finally {
      await prisma.formulaLine.update({
        where: { id: ligneAcier.id },
        data: { quantity: "2" },
      });
    }
    const ligneRestauree = await prisma.formulaLine.findUniqueOrThrow({
      where: { id: ligneAcier.id },
    });
    expect(ligneRestauree.quantity.toFixed(6)).toBe("2.000000");

    // Un ordre deja lance ne peut pas etre relance.
    await expect(lancerOrdreFabrication(ordre.workOrderId, acteur)).rejects.toMatchObject({
      code: "ETAT_INVALIDE",
    });

    // Quantite planifiee invalide et article non productible : refuses.
    await expect(creerOrdre("0", "ZERO")).rejects.toMatchObject({ code: "VALIDATION" });
    const articleArchive = await creerArticle("ARCHIVE", {
      type: "PRODUIT_FINI",
      status: "ARCHIVE",
    });
    await expect(
      creerOrdreFabrication({
        itemId: articleArchive.id,
        quantityPlanned: "1",
        factory: "ADMEDCO",
        formulaId: formule.id,
        routeId: gamme.id,
        acteur,
      }),
    ).rejects.toMatchObject({ code: "ETAT_INVALIDE" });
    expect(
      await prisma.workOrder.count({ where: { itemId: itemPF.id } }),
      "Un refus n'ecrit jamais d'ordre",
    ).toBe(1);

    // Le journal d'audit garde la creation et le lancement.
    const creation = await prisma.auditLog.findFirst({
      where: { action: "CREATION", entity: "WorkOrder", entityId: String(ordre.workOrderId) },
    });
    const lancementAudit = await prisma.auditLog.findFirst({
      where: { action: "VALIDATION", entity: "WorkOrder", entityId: String(ordre.workOrderId) },
    });
    expect(creation?.userId).toBe(acteur.id);
    expect((creation?.newValue as { nomenclature?: string }).nomenclature).toBe(formule.code);
    expect((lancementAudit?.newValue as { statut?: string }).statut).toBe("LANCE");
    expect((lancementAudit?.newValue as { composantsFiges?: number }).composantsFiges).toBe(3);
  });
});

// -----------------------------------------------------------------------------
// 2. Declarations d'atelier
// -----------------------------------------------------------------------------

describe("declarations d'atelier", () => {
  it("persiste les quantites produites et consomme la nomenclature figee sans ecart de cumul", async () => {
    const ordre = await creerOrdre("6", "PROD");
    await lancerOrdreFabrication(ordre.workOrderId, acteur);
    const operations = await operationsDeLOrdre(ordre.workOrderId);
    const coupe = operationParCode(operations, "COUPE");
    const acier = await matiereDeLOperation(ordre.workOrderId, coupe.id, itemAcier.id);
    // Sur ce second ordre, les identifiants des operations de l'ordre ne peuvent
    // plus coincider avec ceux du referentiel : le rattachement est verifie ici.
    await verifierRattachementOperations(ordre.workOrderId);

    await expect(
      declarerProduction({
        workOrderOperationId: coupe.id,
        quantiteProduite: "2",
        acteur,
      }),
    ).rejects.toMatchObject({ code: "ETAT_INVALIDE" });

    const demarrage = await demarrerOperation({
      workOrderOperationId: coupe.id,
      acteur,
      commentaire: "Demarrage de la coupe",
    });
    expect(demarrage).toBeUndefined();
    const declarationDemarrage = await prisma.operationDeclaration.findFirstOrThrow({
      where: { workOrderOperationId: coupe.id, kind: "DEMARRAGE" },
    });
    expect(declarationDemarrage.operationId).toBe(coupe.operationId);
    expect(declarationDemarrage.userId).toBe(acteur.id);

    const premiere = await declarerProduction({
      workOrderOperationId: coupe.id,
      quantiteProduite: "2",
      quantiteConforme: "2",
      acteur,
      commentaire: "Premiere serie",
    });
    expect(premiere.quantiteProduite.toFixed(6)).toBe("2.000000");
    expect(premiere.quantiteConforme.toFixed(6)).toBe("2.000000");
    expect(premiere.quantiteRebutee.isZero()).toBe(true);
    expect(premiere.matieresConsommees).toBe(1);
    expect(premiere.resteAProduire.toFixed(6)).toBe("4.000000");

    const seconde = await declarerProduction({
      workOrderOperationId: coupe.id,
      quantiteProduite: "4",
      quantiteConforme: "3",
      quantiteRebutee: "1",
      acteur,
      commentaire: "Fin de serie",
    });
    expect(seconde.matieresConsommees).toBe(1);
    expect(seconde.resteAProduire.isZero()).toBe(true);

    // Les mouvements de consommation sont reels, rattaches a l'ordre, a
    // l'operation et au document, et valorises avec le cout fige.
    const mouvements = await prisma.stockMovement.findMany({
      where: { workOrderId: ordre.workOrderId, itemId: itemAcier.id },
      orderBy: { id: "asc" },
    });
    expect(mouvements).toHaveLength(2);
    expect(mouvements.every((mouvement) => mouvement.type === "CONSOMMATION_OPERATION")).toBe(true);
    expect(mouvements.every((mouvement) => mouvement.warehouseId === depotMP.id)).toBe(true);
    expect(mouvements.every((mouvement) => mouvement.operationId === coupe.operationId)).toBe(true);
    expect(mouvements.every((mouvement) => mouvement.workOrderOperationId === coupe.id)).toBe(true);
    expect(mouvements.every((mouvement) => mouvement.documentNumber === ordre.number)).toBe(true);
    expect(mouvements.every((mouvement) => mouvement.unitCost.toFixed(6) === "2.000000")).toBe(true);
    expect(mouvements[0].quantity.toFixed(6)).toBe("-4.000000");
    expect(mouvements[1].quantity.toFixed(6)).toBe("-8.000000");
    expect(mouvements[1].balanceAfter?.toFixed(6)).toBe("988.000000");

    const matiereApres = await prisma.workOrderMaterial.findUniqueOrThrow({ where: { id: acier.id } });
    expect(matiereApres.quantityConsumed.toFixed(6)).toBe("12.000000");
    expect(matiereApres.quantityIssued.toFixed(6)).toBe("12.000000");
    expect(
      matiereApres.quantityConsumed.toFixed(6),
      "La consommation ne depasse jamais la nomenclature figee",
    ).toBe(matiereApres.quantityPlanned.toFixed(6));

    // Cumuls de l'ordre et de l'operation : exacts, sans arrondi flottant.
    const ordreEnBase = await prisma.workOrder.findUniqueOrThrow({
      where: { id: ordre.workOrderId },
    });
    expect(ordreEnBase.quantityProduced.toFixed(6)).toBe("6.000000");
    expect(ordreEnBase.quantityConform.toFixed(6)).toBe("5.000000");
    expect(ordreEnBase.quantityScrapped.toFixed(6)).toBe("1.000000");
    expect(ordreEnBase.quantityRemaining.isZero()).toBe(true);
    expect(ordreEnBase.status).toBe("PARTIELLEMENT_TERMINE");
    expect(ordreEnBase.actualStart).not.toBeNull();

    const operationEnBase = await prisma.workOrderOperation.findUniqueOrThrow({
      where: { id: coupe.id },
    });
    expect(operationEnBase.quantityProduced.toFixed(6)).toBe("6.000000");
    expect(operationEnBase.quantityConform.toFixed(6)).toBe("5.000000");
    expect(operationEnBase.quantityScrapped.toFixed(6)).toBe("1.000000");
    expect(operationEnBase.status).toBe("EN_COURS");

    // Le cumul de l'ordre est toujours la somme exacte de ses declarations.
    const declarations = await prisma.operationDeclaration.findMany({
      where: { workOrderId: ordre.workOrderId, kind: "PRODUCTION" },
    });
    expect(declarations).toHaveLength(2);
    expect(
      D.sum(declarations.map((declaration) => declaration.quantity)).toFixed(6),
    ).toBe(ordreEnBase.quantityProduced.toFixed(6));
    expect(
      D.sum(declarations.map((declaration) => declaration.quantityConform)).toFixed(6),
    ).toBe(ordreEnBase.quantityConform.toFixed(6));

    // Le service MES n'ecrit ici que la consommation des composants : l'entree
    // du produit fini est ecrite par la liberation qualite (`libererProduitFini`,
    // domaine qualite, hors perimetre). Aucune entree fantome n'existe donc ici.
    expect(
      await prisma.stockMovement.count({
        where: {
          workOrderId: ordre.workOrderId,
          itemId: itemPF.id,
          type: { in: ["PRODUCTION_PRODUIT_FINI", "PRODUCTION_SEMI_FINI"] },
        },
      }),
    ).toBe(0);

    // `consommerComposants: false` : la production est declaree sans mouvement.
    const troisieme = await declarerProduction({
      workOrderOperationId: coupe.id,
      quantiteProduite: "1",
      quantiteConforme: "1",
      consommerComposants: false,
      acteur,
      commentaire: "Serie sans consommation automatique",
    });
    expect(troisieme.matieresConsommees).toBe(0);
    expect(await prisma.stockMovement.count({ where: { workOrderId: ordre.workOrderId } })).toBe(2);
    const matiereInchangee = await prisma.workOrderMaterial.findUniqueOrThrow({ where: { id: acier.id } });
    expect(matiereInchangee.quantityConsumed.toFixed(6)).toBe("12.000000");

    // Quantites incoherentes refusees.
    await expect(
      declarerProduction({
        workOrderOperationId: coupe.id,
        quantiteProduite: "1",
        quantiteConforme: "1",
        quantiteRebutee: "1",
        acteur,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      declarerProduction({ workOrderOperationId: coupe.id, quantiteProduite: "0", acteur }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await verifierGrandLivre(itemAcier.id);
  });

  it("enregistre la perte separement de la consommation normale", async () => {
    const ordre = await creerOrdre("10", "PERTE");
    await lancerOrdreFabrication(ordre.workOrderId, acteur);
    const operations = await operationsDeLOrdre(ordre.workOrderId);
    const coupe = operationParCode(operations, "COUPE");
    const acier = await matiereDeLOperation(ordre.workOrderId, coupe.id, itemAcier.id);

    await demarrerOperation({ workOrderOperationId: coupe.id, acteur });
    await declarerProduction({
      workOrderOperationId: coupe.id,
      quantiteProduite: "10",
      quantiteConforme: "10",
      acteur,
    });

    const consommationAvant = (
      await prisma.workOrderMaterial.findUniqueOrThrow({ where: { id: acier.id } })
    ).quantityConsumed;

    // Perte faible : elle reste normale et ne demande pas de validation.
    const perteNormale = await declarerPerte({
      workOrderOperationId: coupe.id,
      itemId: itemAcier.id,
      quantite: "0.1",
      categorie: "PERTE_NORMALE",
      motif: "CHUTE_NORMALE",
      materialId: acier.id,
      warehouseId: depotMP.id,
      sortirDuStock: true,
      commentaire: "Chute de coupe constatee",
      acteur,
    });
    expect(perteNormale.categorie).toBe("PERTE_NORMALE");
    expect(perteNormale.motif).toBe("CHUTE_NORMALE");
    expect(perteNormale.validationRequise).toBe(false);

    // Perte forte (10 % > seuil de 3 %) : exceptionnelle, soumise a validation.
    const perteExceptionnelle = await declarerPerte({
      workOrderOperationId: coupe.id,
      itemId: itemAcier.id,
      quantite: "1",
      categorie: "PERTE_NORMALE",
      motif: "DECOUPE_INCORRECTE",
      materialId: acier.id,
      warehouseId: depotMP.id,
      sortirDuStock: true,
      commentaire: "Decoupe incorrecte",
      acteur,
    });
    expect(perteExceptionnelle.categorie).toBe("PERTE_EXCEPTIONNELLE");
    expect(perteExceptionnelle.validationRequise).toBe(true);

    const rebute = await declarerPerte({
      workOrderOperationId: coupe.id,
      itemId: itemPF.id,
      quantite: "1",
      categorie: "REBUT",
      motif: "DEFAUT_DE_SOUDURE",
      warehouseId: depotPF.id,
      sortirDuStock: true,
      commentaire: "Chassis non conforme",
      acteur,
    });
    expect(rebute.categorie).toBe("REBUT");
    expect(rebute.motif).toBe("DEFAUT_DE_SOUDURE");

    // La perte est tracee avec sa categorie, son motif et sa quantite propres.
    const declarations = await prisma.operationDeclaration.findMany({
      where: { workOrderId: ordre.workOrderId, kind: "PERTE" },
      orderBy: { id: "asc" },
    });
    expect(declarations).toHaveLength(3);
    expect(declarations.map((declaration) => declaration.lossReason)).toEqual([
      "CHUTE_NORMALE",
      "DECOUPE_INCORRECTE",
      "DEFAUT_DE_SOUDURE",
    ]);
    expect(declarations.map((declaration) => declaration.lossCategory)).toEqual([
      "PERTE_NORMALE",
      "PERTE_EXCEPTIONNELLE",
      "REBUT",
    ]);
    expect(declarations.map((declaration) => declaration.quantity.toFixed(6))).toEqual([
      "0.100000",
      "1.000000",
      "1.000000",
    ]);
    expect(declarations.map((declaration) => declaration.status)).toEqual([
      "SAISIE",
      "SOUMISE",
      "SOUMISE",
    ]);
    expect(declarations[0].isExceptional).toBe(false);
    expect(declarations[1].isExceptional).toBe(true);
    expect(declarations[0].materialId).toBe(acier.id);
    expect(declarations[0].warehouseId).toBe(depotMP.id);

    // En base, la perte n'est jamais un mouvement de consommation : le type de
    // mouvement et la declaration portent la distinction.
    const mouvementsPerte = await prisma.stockMovement.findMany({
      where: { workOrderId: ordre.workOrderId, type: { in: ["PERTE", "REBUT"] } },
      orderBy: { id: "asc" },
    });
    expect(mouvementsPerte).toHaveLength(3);
    expect(mouvementsPerte.map((mouvement) => mouvement.type)).toEqual(["PERTE", "PERTE", "REBUT"]);
    expect(mouvementsPerte.map((mouvement) => mouvement.quantity.toFixed(6))).toEqual([
      "-0.100000",
      "-1.000000",
      "-1.000000",
    ]);
    expect(mouvementsPerte.every((mouvement) => mouvement.declarationId !== null)).toBe(true);
    expect(mouvementsPerte.every((mouvement) => mouvement.reason !== null)).toBe(true);
    expect(mouvementsPerte[2].warehouseId).toBe(depotPF.id);
    expect(mouvementsPerte[2].itemId).toBe(itemPF.id);

    // Aucune consommation declaree, et la nomenclature n'a pas bouge.
    expect(
      await prisma.operationDeclaration.count({
        where: { workOrderId: ordre.workOrderId, kind: "CONSOMMATION" },
      }),
    ).toBe(0);
    const matiereApres = await prisma.workOrderMaterial.findUniqueOrThrow({ where: { id: acier.id } });
    expect(
      matiereApres.quantityConsumed.toFixed(6),
      "Une perte ne se melange jamais a la consommation normale",
    ).toBe(consommationAvant.toFixed(6));

    // Le rebut alimente le cumul de rebut, la perte exceptionnelle reste auditee.
    const ordreEnBase = await prisma.workOrder.findUniqueOrThrow({
      where: { id: ordre.workOrderId },
    });
    expect(ordreEnBase.quantityScrapped.toFixed(6)).toBe("1.000000");
    const auditsPerte = await prisma.auditLog.findMany({
      where: { entity: "OperationDeclaration", action: { in: ["PERTE", "REBUT"] } },
    });
    expect(auditsPerte.some((audit) => audit.action === "PERTE")).toBe(true);
    expect(auditsPerte.some((audit) => audit.action === "REBUT")).toBe(true);
    const auditExceptionnel = auditsPerte.find(
      (audit) =>
        (audit.newValue as { categorie?: string }).categorie === "PERTE_EXCEPTIONNELLE",
    );
    expect((auditExceptionnel?.newValue as { validationRequise?: boolean }).validationRequise).toBe(
      true,
    );
    expect(auditExceptionnel?.reason).toBe("DECOUPE_INCORRECTE");

    // Quantite nulle ou negative refusee.
    await expect(
      declarerPerte({
        workOrderOperationId: coupe.id,
        itemId: itemAcier.id,
        quantite: "0",
        categorie: "PERTE_NORMALE",
        motif: "AUTRE",
        acteur,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await verifierGrandLivre(itemAcier.id);
    await verifierGrandLivre(itemPF.id);
  });
});

// -----------------------------------------------------------------------------
// 3. Tableau Kanban
// -----------------------------------------------------------------------------

describe("tableau Kanban", () => {
  it("enregistre une transition persistee et ne declenche pas le transfert d'un ordre non termine", async () => {
    const ordre = await creerOrdre("10", "KANBAN");
    await lancerOrdreFabrication(ordre.workOrderId, acteur);
    const operations = await operationsDeLOrdre(ordre.workOrderId);
    const coupe = operationParCode(operations, "COUPE");
    const usinage = operationParCode(operations, "USINAGE");
    const soudage = operationParCode(operations, "SOUDAGE");

    const dispoChassisAvant = await prisma.stockBalance.aggregate({
      where: { itemId: chassisPeint.id, warehouseId: depotMBX.id, status: "LIBRE" },
      _sum: { quantityPhysical: true },
    });

    // Sans demarrage, aucun deplacement n'est possible.
    await expect(
      deplacerCarteKanban({ workOrderOperationId: coupe.id, quantite: "10", acteur }),
    ).rejects.toMatchObject({ code: "ETAT_INVALIDE" });

    await demarrerOperation({ workOrderOperationId: coupe.id, acteur });

    // Sans quantite declaree ni production, le deplacement est refuse.
    await expect(
      deplacerCarteKanban({ workOrderOperationId: coupe.id, quantite: "0", acteur }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await declarerProduction({
      workOrderOperationId: coupe.id,
      quantiteProduite: "10",
      quantiteConforme: "10",
      acteur,
    });

    const avant = new Date();
    const resultat = await deplacerCarteKanban({
      workOrderOperationId: coupe.id,
      quantite: "10",
      commentaire: "Coupe terminee, passage a l'usinage",
      acteur,
    });
    const apres = new Date();

    expect(resultat.deOperation).toBe("COUPE");
    expect(resultat.versOperation).toBe("USINAGE");
    expect(resultat.ordreTermine).toBe(false);
    expect(resultat.transfertDivision).toBeNull();

    // La transition est un objet metier persiste, pas un changement d'affichage.
    const transition = await prisma.kanbanTransition.findUniqueOrThrow({
      where: { id: resultat.transitionId },
    });
    expect(transition.workOrderId).toBe(ordre.workOrderId);
    expect(transition.fromOperationId).toBe(coupe.operationId);
    expect(transition.toOperationId).toBe(usinage.operationId);
    expect(transition.fromWorkOrderOperationId).toBe(coupe.id);
    expect(transition.toWorkOrderOperationId).toBe(usinage.id);
    expect(transition.userId).toBe(acteur.id);
    expect(transition.quantity.toFixed(6)).toBe("10.000000");
    expect(transition.comment).toBe("Coupe terminee, passage a l'usinage");
    expect(transition.occurredAt.getTime()).toBeGreaterThanOrEqual(avant.getTime() - 1000);
    expect(transition.occurredAt.getTime()).toBeLessThanOrEqual(apres.getTime() + 1000);
    expect(transition.declaredConsumptions).toEqual([]);
    expect(transition.declaredLosses).toEqual([]);

    // Les operations suivent : la coupe est terminee, l'usinage est en cours.
    const coupeEnBase = await prisma.workOrderOperation.findUniqueOrThrow({ where: { id: coupe.id } });
    const usinageEnBase = await prisma.workOrderOperation.findUniqueOrThrow({
      where: { id: usinage.id },
    });
    expect(coupeEnBase.status).toBe("TERMINEE");
    expect(coupeEnBase.actualEnd).not.toBeNull();
    expect(usinageEnBase.status).toBe("EN_COURS");
    expect(usinageEnBase.actualStart).not.toBeNull();
    const ordreEnBase = await prisma.workOrder.findUniqueOrThrow({
      where: { id: ordre.workOrderId },
    });
    expect(ordreEnBase.status).not.toBe("TERMINE");
    expect(ordreEnBase.actualEnd).toBeNull();

    // Un ordre non termine ne declenche aucun transfert inter-divisions.
    const transferts = await prisma.stockMovement.count({
      where: { workOrderId: ordre.workOrderId, documentType: "TRANSFERT_DIVISION" },
    });
    expect(transferts).toBe(0);
    expect(
      await prisma.stockMovement.count({
        where: { workOrderId: ordre.workOrderId, itemId: chassisPeint.id },
      }),
    ).toBe(0);
    const dispoChassisApres = await prisma.stockBalance.aggregate({
      where: { itemId: chassisPeint.id, warehouseId: depotMBX.id, status: "LIBRE" },
      _sum: { quantityPhysical: true },
    });
    expect(
      D.sub(
        dispoChassisApres._sum.quantityPhysical ?? D.ZERO,
        dispoChassisAvant._sum.quantityPhysical ?? D.ZERO,
      ).isZero(),
      "Aucun chassis peint ne doit etre transfere avant la fin de la chaine",
    ).toBe(true);

    // Une operation non demarree ne peut pas etre deplacee, une production
    // incomplete non plus.
    await expect(
      deplacerCarteKanban({ workOrderOperationId: soudage.id, quantite: "10", acteur }),
    ).rejects.toMatchObject({ code: "ETAT_INVALIDE" });
    await expect(
      deplacerCarteKanban({ workOrderOperationId: usinage.id, quantite: "10", acteur }),
    ).rejects.toMatchObject({ code: "ETAT_INVALIDE" });

    // L'audit de la transition est ecrit.
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "PRODUCTION",
        entity: "KanbanTransition",
        entityId: String(transition.id),
      },
    });
    expect(audit?.userId).toBe(acteur.id);
    expect((audit?.newValue as { operationSuivante?: string }).operationSuivante).toBe("USINAGE");
    expect((audit?.newValue as { ordreTermine?: boolean }).ordreTermine).toBe(false);

    await verifierGrandLivre(itemAcier.id);
  });
});

// -----------------------------------------------------------------------------
// 4. Fin de chaine POUDRAGE : transfert inter-divisions du chassis peint
// -----------------------------------------------------------------------------

describe("fin de chaine POUDRAGE", () => {
  it("consomme le reel, entree le chassis peint puis le transfere vers MOBILIX", async () => {
    const articlesChassisAvant = await prisma.item.count({ where: { code: CODE_CHASSIS } });
    expect(articlesChassisAvant, "Le chassis peint ne doit exister qu'en un seul exemplaire").toBe(1);

    const ordre = await creerOrdre("10", "POUDRAGE");
    await lancerOrdreFabrication(ordre.workOrderId, acteur);

    const dispoSourceAvant = await prisma.stockBalance.aggregate({
      where: { itemId: chassisPeint.id, warehouseId: depotMP.id, status: "LIBRE" },
      _sum: { quantityPhysical: true },
    });
    const dispoCibleAvant = await prisma.stockBalance.aggregate({
      where: { itemId: chassisPeint.id, warehouseId: depotMBX.id, status: "LIBRE" },
      _sum: { quantityPhysical: true },
    });

    const { transitions, operations } = await executerChaine(ordre.workOrderId, "10", {
      consommationsPoudrage: [
        { composant: "PEINT", quantite: "2" },
        { composant: "VIS", quantite: "1" },
      ],
      commentaireFinal: `Poudrage termine ${PREFIXE}`,
    });

    const poudrage = operationParCode(operations, "POUDRAGE");
    const finale = transitions[transitions.length - 1];
    expect(finale.deOperation).toBe("POUDRAGE");
    expect(finale.versOperation).toBeNull();
    expect(finale.ordreTermine).toBe(true);
    expect(finale.transfertDivision).not.toBeNull();
    expect(finale.transfertDivision?.effectue).toBe(true);
    expect(finale.transfertDivision?.article).toBe(CODE_CHASSIS);
    expect(finale.transfertDivision?.quantite).toBe("10.000");
    expect(finale.transfertDivision?.depotSource).toBe("DEP-MP");
    expect(finale.transfertDivision?.depotDestination).toBe("DEP-MP-MBX");

    // --- a. Les consommations reelles sont enregistrees, distinctes du theorique.
    const matierePeint = await matiereDeLOperation(ordre.workOrderId, poudrage.id, itemPeint.id);
    const matiereVis = await matiereDeLOperation(ordre.workOrderId, poudrage.id, itemVis.id);
    expect(matierePeint.quantityPlanned.toFixed(6)).toBe("15.000000");
    expect(matierePeint.quantityConsumed.toFixed(6)).toBe("17.000000");
    expect(matiereVis.quantityPlanned.toFixed(6)).toBe("80.000000");
    expect(matiereVis.quantityConsumed.toFixed(6)).toBe("81.000000");

    const mouvementsPeint = await prisma.stockMovement.findMany({
      where: {
        workOrderId: ordre.workOrderId,
        itemId: itemPeint.id,
        type: "CONSOMMATION_OPERATION",
      },
      orderBy: { id: "asc" },
    });
    expect(mouvementsPeint).toHaveLength(2);
    expect(mouvementsPeint[0].quantity.toFixed(6)).toBe("-15.000000");
    expect(mouvementsPeint[1].quantity.toFixed(6)).toBe("-2.000000");
    expect(
      mouvementsPeint.some((mouvement) => mouvement.declarationId !== null),
      "La consommation declaree en atelier est rattachee a sa declaration",
    ).toBe(true);
    expect(mouvementsPeint.every((mouvement) => mouvement.warehouseId === depotMP.id)).toBe(true);
    expect(
      D.sum(mouvementsPeint.map((mouvement) => mouvement.quantity)).toFixed(6),
    ).toBe("-17.000000");
    expect(
      (
        await prisma.stockBalance.findFirstOrThrow({
          where: { itemId: itemPeint.id, warehouseId: depotMP.id, status: "LIBRE" },
        })
      ).quantityPhysical.toFixed(6),
    ).toBe("183.000000");

    // La transition finale porte les consommations REELLEMENT declarees, avec
    // leur categorie, et non une recopie du theorique de la nomenclature.
    const transitionFinale = await prisma.kanbanTransition.findUniqueOrThrow({
      where: { id: finale.transitionId },
    });
    const consommations = (transitionFinale.declaredConsumptions ?? []) as Array<{
      article: string | null;
      quantite: string;
      categorie: LossCategory | null;
    }>;
    expect(consommations).toHaveLength(2);
    expect(consommations.find((element) => element.article === itemPeint.code)?.quantite).toBe(
      "2.000000",
    );
    expect(consommations.find((element) => element.article === itemPeint.code)?.categorie).toBe(
      "SURCONSOMMATION",
    );
    expect(consommations.find((element) => element.article === itemVis.code)?.quantite).toBe(
      "1.000000",
    );
    expect(consommations.find((element) => element.article === itemVis.code)?.categorie).toBe(
      "SURCONSOMMATION",
    );

    // --- b. Le chassis peint entre en stock puis rejoint le depot MOBILIX.
    const dispoSourceApres = await prisma.stockBalance.aggregate({
      where: { itemId: chassisPeint.id, warehouseId: depotMP.id, status: "LIBRE" },
      _sum: { quantityPhysical: true },
    });
    const dispoCibleApres = await prisma.stockBalance.aggregate({
      where: { itemId: chassisPeint.id, warehouseId: depotMBX.id, status: "LIBRE" },
      _sum: { quantityPhysical: true },
    });
    expect(
      D.sub(
        dispoCibleApres._sum.quantityPhysical ?? D.ZERO,
        dispoCibleAvant._sum.quantityPhysical ?? D.ZERO,
      ).toFixed(6),
      "Le stock de chassis peint augmente de la quantite produite dans DEP-MP-MBX",
    ).toBe("10.000000");
    expect(
      D.sub(
        dispoSourceApres._sum.quantityPhysical ?? D.ZERO,
        dispoSourceAvant._sum.quantityPhysical ?? D.ZERO,
      ).toFixed(6),
      "Le chassis ne fait que transiter par le depot ADMEDCO",
    ).toBe("0.000000");

    // --- c. Le transfert inter-ateliers est reel, valorise et relie a l'ordre.
    const mouvementsTransfert = await prisma.stockMovement.findMany({
      where: { workOrderId: ordre.workOrderId, documentType: "TRANSFERT_DIVISION" },
      orderBy: { id: "asc" },
    });
    expect(mouvementsTransfert).toHaveLength(2);
    const sortieTransfert = mouvementsTransfert[0];
    const entreeTransfert = mouvementsTransfert[1];

    expect(sortieTransfert.type).toBe("TRANSFERT_INTER_DEPOTS");
    expect(sortieTransfert.itemId).toBe(chassisPeint.id);
    expect(sortieTransfert.quantity.toFixed(6)).toBe("-10.000000");
    expect(sortieTransfert.warehouseId).toBe(depotMP.id);
    expect(sortieTransfert.sourceWarehouseId).toBe(depotMP.id);
    expect(sortieTransfert.targetWarehouseId).toBe(depotMBX.id);
    expect(sortieTransfert.workOrderId).toBe(ordre.workOrderId);
    expect(sortieTransfert.documentType).toBe("TRANSFERT_DIVISION");
    expect(sortieTransfert.documentId).toMatch(/^TRF-\d{4}-\d{5}$/);
    expect(sortieTransfert.documentNumber).toBe(sortieTransfert.documentId);
    expect(sortieTransfert.reason).toContain(`Fin de l'operation POUDRAGE`);
    expect(sortieTransfert.lotId).not.toBeNull();

    expect(entreeTransfert.type).toBe("TRANSFERT_INTER_DEPOTS");
    expect(entreeTransfert.quantity.toFixed(6)).toBe("10.000000");
    expect(entreeTransfert.warehouseId).toBe(depotMBX.id);
    expect(entreeTransfert.sourceWarehouseId).toBe(depotMP.id);
    expect(entreeTransfert.targetWarehouseId).toBe(depotMBX.id);
    expect(entreeTransfert.workOrderId).toBe(ordre.workOrderId);
    expect(entreeTransfert.documentNumber).toBe(sortieTransfert.documentNumber);
    expect(entreeTransfert.lotId).toBe(sortieTransfert.lotId);
    expect(entreeTransfert.userId).toBe(acteur.id);
    expect(entreeTransfert.userEmail).toBe(acteur.email);
    // Le semi-fini est valorise : le cout traverse le transfert sans alteration.
    expect(entreeTransfert.unitCost.toFixed(6)).toBe("1200.000000");
    expect(entreeTransfert.unitCost.toFixed(6)).toBe(sortieTransfert.unitCost.toFixed(6));
    expect(sortieTransfert.totalCost.toFixed(6)).toBe("-12000.000000");

    const lotTransfert = await prisma.stockLot.findUniqueOrThrow({
      where: { id: entreeTransfert.lotId! },
    });
    expect(lotTransfert.itemId).toBe(chassisPeint.id);
    expect(lotTransfert.lotNumber).toMatch(/^LOT-\d{4}-\d{5}$/);
    expect(lotTransfert.status).toBe("LIBRE");
    // Le lot suit le chassis : il est entre en stock a la fin du poudrage.
    const entreeProduction = await prisma.stockMovement.findMany({
      where: { workOrderId: ordre.workOrderId, type: "PRODUCTION_SEMI_FINI" },
    });
    expect(entreeProduction).toHaveLength(1);
    expect(entreeProduction[0].itemId).toBe(chassisPeint.id);
    expect(entreeProduction[0].quantity.toFixed(6)).toBe("10.000000");
    expect(entreeProduction[0].warehouseId).toBe(depotMP.id);
    expect(entreeProduction[0].documentNumber).toBe(ordre.number);
    expect(entreeProduction[0].lotId).toBe(lotTransfert.id);
    expect(entreeProduction[0].id < sortieTransfert.id).toBe(true);
    expect(sortieTransfert.lotId).toBe(lotTransfert.id);

    // --- d. Aucun doublon d'article n'a ete cree.
    expect(
      await prisma.item.count({ where: { code: CODE_CHASSIS } }),
      "Le service reutilise l'article du referentiel, il n'en cree jamais un second",
    ).toBe(articlesChassisAvant);
    const regleUtilisee = await prisma.divisionTransferRule.findUniqueOrThrow({
      where: { code: CODE_REGLE },
    });
    expect(regleUtilisee.producedItemId).toBe(chassisPeint.id);

    // --- e. Tracabilite complete : ordre, operation, transition, mouvements, audit.
    expect(transitionFinale.workOrderId).toBe(ordre.workOrderId);
    expect(transitionFinale.fromOperationId).toBe(operationPoudrage.id);
    expect(transitionFinale.fromWorkOrderOperationId).toBe(poudrage.id);
    expect(transitionFinale.toOperationId).toBeNull();
    expect(transitionFinale.toWorkOrderOperationId).toBeNull();
    expect(transitionFinale.userId).toBe(acteur.id);
    expect(transitionFinale.quantity.toFixed(6)).toBe("10.000000");
    expect(transitionFinale.comment).toBe(`Poudrage termine ${PREFIXE}`);

    const ordreEnBase = await prisma.workOrder.findUniqueOrThrow({
      where: { id: ordre.workOrderId },
      include: { operations: true },
    });
    expect(ordreEnBase.status).toBe("TERMINE");
    expect(ordreEnBase.actualEnd).not.toBeNull();
    expect(ordreEnBase.operations.every((operation) => operation.status === "TERMINEE")).toBe(true);
    expect(ordreEnBase.quantityProduced.toFixed(6)).toBe("60.000000");
    expect(
      D.sum(
        (
          await prisma.operationDeclaration.findMany({
            where: { workOrderId: ordre.workOrderId, kind: "PRODUCTION" },
          })
        ).map((declaration) => declaration.quantity),
      ).toFixed(6),
      "Le cumul de l'ordre reste la somme exacte de ses declarations",
    ).toBe(ordreEnBase.quantityProduced.toFixed(6));

    const audit = await prisma.auditLog.findFirst({
      where: { action: "TRANSFERT_DIVISION", entityId: String(entreeTransfert.id) },
    });
    expect(audit, "Le transfert inter-divisions est audite").not.toBeNull();
    expect(audit?.userId).toBe(acteur.id);
    expect(audit?.module).toBe("Production");
    expect((audit?.newValue as { numeroTransfert?: string }).numeroTransfert).toBe(
      sortieTransfert.documentNumber,
    );
    expect((audit?.newValue as { article?: string }).article).toBe(CODE_CHASSIS);
    expect((audit?.newValue as { quantite?: string }).quantite).toBe("10.000000");
    expect((audit?.newValue as { depotSource?: string }).depotSource).toBe("DEP-MP");
    expect((audit?.newValue as { depotDestination?: string }).depotDestination).toBe("DEP-MP-MBX");
    expect((audit?.newValue as { ordre?: string }).ordre).toBe(ordre.number);
    expect((audit?.newValue as { regle?: string }).regle).toBe(CODE_REGLE);

    // --- f. Le grand livre reste la seule source de verite, pour tous les articles.
    await verifierGrandLivre(itemPeint.id);
    await verifierGrandLivre(itemVis.id);
    await verifierGrandLivre(itemAcier.id);
    await verifierGrandLivre(itemPF.id);
    await verifierGrandLivre(chassisPeint.id);
  });

  it("refuse toute nouvelle declaration ou annulation sur un ordre termine", async () => {
    const ordre = await creerOrdre("4", "TERMINE");
    await lancerOrdreFabrication(ordre.workOrderId, acteur);
    const { operations } = await executerChaine(ordre.workOrderId, "4");
    const coupe = operationParCode(operations, "COUPE");

    const ordreEnBase = await prisma.workOrder.findUniqueOrThrow({
      where: { id: ordre.workOrderId },
    });
    expect(ordreEnBase.status).toBe("TERMINE");

    // Toutes les operations sont terminees : l'atelier ne peut plus produire ni
    // deplacer. Les controles reels portent sur l'etat de l'operation.
    await expect(
      declarerProduction({
        workOrderOperationId: coupe.id,
        quantiteProduite: "1",
        acteur,
      }),
    ).rejects.toMatchObject({ code: "ETAT_INVALIDE" });
    await expect(
      deplacerCarteKanban({ workOrderOperationId: coupe.id, quantite: "1", acteur }),
    ).rejects.toMatchObject({ code: "ETAT_INVALIDE" });
    await expect(
      demarrerOperation({ workOrderOperationId: coupe.id, acteur }),
    ).rejects.toMatchObject({ code: "ETAT_INVALIDE" });

    const mouvementsAvant = await prisma.stockMovement.count({
      where: { workOrderId: ordre.workOrderId },
    });
    const transitionsAvant = await prisma.kanbanTransition.count({
      where: { workOrderId: ordre.workOrderId },
    });

    // Aucune de ces tentatives n'a rien ecrit.
    expect(await prisma.stockMovement.count({ where: { workOrderId: ordre.workOrderId } })).toBe(
      mouvementsAvant,
    );
    expect(
      await prisma.kanbanTransition.count({ where: { workOrderId: ordre.workOrderId } }),
    ).toBe(transitionsAvant);
    expect(
      (await prisma.workOrder.findUniqueOrThrow({ where: { id: ordre.workOrderId } }))
        .quantityProduced.toFixed(6),
    ).toBe("24.000000");

    // Les memes controles d'etat s'appliquent a la consommation et a la perte :
    // une declaration d'atelier tardive est refusee et n'ecrit aucun mouvement.
    const matiereCoupe = await matiereDeLOperation(ordre.workOrderId, coupe.id, itemAcier.id);
    await expect(
      declarerConsommation({
        workOrderOperationId: coupe.id,
        materialId: matiereCoupe.id,
        quantite: "1",
        acteur,
        commentaire: "Consommation declaree apres la fin de la chaine",
      }),
    ).rejects.toMatchObject({ code: "ETAT_INVALIDE" });
    await expect(
      declarerPerte({
        workOrderOperationId: coupe.id,
        itemId: itemAcier.id,
        quantite: "1",
        categorie: "PERTE_NORMALE",
        motif: "CHUTE_NORMALE",
        materialId: matiereCoupe.id,
        warehouseId: depotMP.id,
        sortirDuStock: true,
        acteur,
      }),
    ).rejects.toMatchObject({ code: "ETAT_INVALIDE" });
    expect(
      await prisma.stockMovement.count({ where: { workOrderId: ordre.workOrderId } }),
      "Aucune declaration tardive n'a ecrit de mouvement",
    ).toBe(mouvementsAvant);
    expect(
      (await prisma.workOrderMaterial.findUniqueOrThrow({ where: { id: matiereCoupe.id } }))
        .quantityConsumed.toFixed(6),
    ).toBe(matiereCoupe.quantityConsumed.toFixed(6));

    // En revanche, aucune production ne peut plus etre declaree ni aucune carte
    // deplacee : le cumul de l'ordre reste fige.
    expect(
      (await prisma.workOrder.findUniqueOrThrow({ where: { id: ordre.workOrderId } }))
        .quantityProduced.toFixed(6),
    ).toBe("24.000000");
    expect(
      await prisma.kanbanTransition.count({ where: { workOrderId: ordre.workOrderId } }),
    ).toBe(transitionsAvant);

    // Un ordre termine ne peut plus etre annule : le grand livre est protege.
    await expect(
      annulerOrdreFabrication(ordre.workOrderId, "Tentative d'annulation apres la fin", acteur),
    ).rejects.toMatchObject({ code: "ETAT_INVALIDE" });

    // Toutes les operations etant terminees, la cloture est possible, et une
    // fois cloture l'ordre est fige (le motif d'annulation est exige).
    await expect(annulerOrdreFabrication(ordre.workOrderId, "bug", acteur)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await cloturerOrdreFabrication(ordre.workOrderId, acteur, "Ordre termine en atelier");
    const cloture = await prisma.workOrder.findUniqueOrThrow({ where: { id: ordre.workOrderId } });
    expect(cloture.status).toBe("CLOTURE");
    expect(cloture.notes).toContain("Ordre termine en atelier");
    await expect(cloturerOrdreFabrication(ordre.workOrderId, acteur)).rejects.toMatchObject({
      code: "CONFLIT",
    });

    await verifierGrandLivre(itemAcier.id);
    await verifierGrandLivre(chassisPeint.id);
  });

  it("ne transfere rien quand la regle de transfert est inactive", async () => {
    const dispoCibleAvant = await prisma.stockBalance.aggregate({
      where: { itemId: chassisPeint.id, warehouseId: depotMBX.id, status: "LIBRE" },
      _sum: { quantityPhysical: true },
    });

    const ordre = await creerOrdre("2", "REGLE-INACTIVE");
    await lancerOrdreFabrication(ordre.workOrderId, acteur);

    try {
      await prisma.divisionTransferRule.update({
        where: { id: regleTransfert.id },
        data: { isActive: false },
      });

      const { transitions } = await executerChaine(ordre.workOrderId, "2");
      const finale = transitions[transitions.length - 1];

      expect(finale.ordreTermine).toBe(true);
      expect(finale.transfertDivision).toBeNull();
      const ordreEnBase = await prisma.workOrder.findUniqueOrThrow({
        where: { id: ordre.workOrderId },
      });
      expect(ordreEnBase.status).toBe("TERMINE");

      // Le semi-fini n'entre meme pas en stock : rien n'est transfere.
      expect(
        await prisma.stockMovement.count({
          where: { workOrderId: ordre.workOrderId, itemId: chassisPeint.id },
        }),
      ).toBe(0);
      const dispoCibleApres = await prisma.stockBalance.aggregate({
        where: { itemId: chassisPeint.id, warehouseId: depotMBX.id, status: "LIBRE" },
        _sum: { quantityPhysical: true },
      });
      expect(
        D.sub(
          dispoCibleApres._sum.quantityPhysical ?? D.ZERO,
          dispoCibleAvant._sum.quantityPhysical ?? D.ZERO,
        ).isZero(),
      ).toBe(true);
    } finally {
      await prisma.divisionTransferRule.update({
        where: { id: regleTransfert.id },
        data: { isActive: true },
      });
    }

    const regleRestauree = await prisma.divisionTransferRule.findUniqueOrThrow({
      where: { id: regleTransfert.id },
    });
    expect(regleRestauree.isActive, "La regle du referentiel est restauree apres le test").toBe(true);
  });

  it("ne transfere rien quand le parametre TRANSFERT_AUTO_CHASSIS_PEINT est desactive", async () => {
    const dispoCibleAvant = await prisma.stockBalance.aggregate({
      where: { itemId: chassisPeint.id, warehouseId: depotMBX.id, status: "LIBRE" },
      _sum: { quantityPhysical: true },
    });

    const ordre = await creerOrdre("2", "PARAMETRE-INACTIF");
    await lancerOrdreFabrication(ordre.workOrderId, acteur);

    try {
      await prisma.appSetting.update({
        where: { key: CLE_PARAMETRE.TRANSFERT_AUTO_CHASSIS_PEINT },
        data: { value: false },
      });

      const { transitions } = await executerChaine(ordre.workOrderId, "2");
      const finale = transitions[transitions.length - 1];

      expect(finale.ordreTermine).toBe(true);
      expect(finale.transfertDivision).toBeNull();
      expect(
        await prisma.stockMovement.count({
          where: { workOrderId: ordre.workOrderId, itemId: chassisPeint.id },
        }),
      ).toBe(0);

      const dispoCibleApres = await prisma.stockBalance.aggregate({
        where: { itemId: chassisPeint.id, warehouseId: depotMBX.id, status: "LIBRE" },
        _sum: { quantityPhysical: true },
      });
      expect(
        D.sub(
          dispoCibleApres._sum.quantityPhysical ?? D.ZERO,
          dispoCibleAvant._sum.quantityPhysical ?? D.ZERO,
        ).isZero(),
      ).toBe(true);
    } finally {
      await prisma.appSetting.update({
        where: { key: CLE_PARAMETRE.TRANSFERT_AUTO_CHASSIS_PEINT },
        data: { value: parametreOrigine as Prisma.InputJsonValue },
      });
    }

    const parametreRestaure = await prisma.appSetting.findUniqueOrThrow({
      where: { key: CLE_PARAMETRE.TRANSFERT_AUTO_CHASSIS_PEINT },
    });
    expect(
      parametreRestaure.value,
      "La valeur d'origine du parametre du referentiel est restauree",
    ).toEqual(parametreOrigine);

    // Regle reactivee et parametre restaure : le transfert fonctionne de nouveau.
    const ordreSuivant = await creerOrdre("2", "REACTIVATION");
    await lancerOrdreFabrication(ordreSuivant.workOrderId, acteur);
    const { transitions } = await executerChaine(ordreSuivant.workOrderId, "2");
    const finale = transitions[transitions.length - 1];
    expect(finale.transfertDivision?.effectue).toBe(true);
    expect(
      await prisma.stockMovement.count({
        where: { workOrderId: ordreSuivant.workOrderId, documentType: "TRANSFERT_DIVISION" },
      }),
    ).toBe(2);

    await verifierGrandLivre(chassisPeint.id);
  });
});

// -----------------------------------------------------------------------------
// 6. Article semi-fini du transfert inter-divisions (chassis peint)
// -----------------------------------------------------------------------------

describe("semi-fini du transfert inter-divisions", () => {
  const CODE_IMPORTE = `${PREFIXE}-CHASSIS-PEINT-IMPORTE`;
  const CODE_AUTRE = `${PREFIXE}-AUTRE-CHASSIS`;
  const CODE_RETENU = `${PREFIXE}-CHASSIS-RETENU`;
  const CODE_ABSENT = `${PREFIXE}-SEMI-FINI-ABSENT`;
  const CODE_CREE = `${PREFIXE}-SEMI-FINI-CREE`;
  const SOURCE_OID = 9_100_001;

  let codeConfigureOrigine = CODE_CHASSIS;
  let articleImporte: { id: number; code: string } | null = null;

  /** Ecrit le code logique du semi-fini comme le ferait l'administrateur. */
  async function ecrireCodeConfigure(value: string): Promise<void> {
    await prisma.appSetting.upsert({
      where: { key: CLE_PARAMETRE.CODE_SEMI_FINI_CHASSIS },
      update: { value },
      create: {
        key: CLE_PARAMETRE.CODE_SEMI_FINI_CHASSIS,
        value,
        category: "PRODUCTION",
        label: "Code du semi-fini chassis peint",
        description: "Valeur ecrite par les tests.",
      },
    });
  }

  /** Rend a la regle du referentiel son etat initial. */
  async function restaurerRegle(): Promise<void> {
    await prisma.divisionTransferRule.update({
      where: { id: regleTransfert.id },
      data: {
        triggerOperationCode: "POUDRAGE",
        producedItemId: chassisPeint.id,
        isActive: true,
      },
    });
  }

  beforeAll(async () => {
    const parametre = await prisma.appSetting.findUnique({
      where: { key: CLE_PARAMETRE.CODE_SEMI_FINI_CHASSIS },
    });
    codeConfigureOrigine = String(parametre?.value ?? CODE_CHASSIS);
  });

  afterAll(async () => {
    await ecrireCodeConfigure(codeConfigureOrigine);
    await restaurerRegle();
    if (articleImporte) {
      await prisma.item.deleteMany({ where: { id: articleImporte.id } });
      articleImporte = null;
    }
  });

  it("adopte l'article importe equivalent au lieu de creer un doublon", async () => {
    const cree = await prisma.item.create({
      data: {
        code: CODE_IMPORTE,
        label1: "Chassis peint importe de l'ancien ERP",
        designation: "Chassis metallique peint (donnee source)",
        type: "SEMI_FINI",
        factory: "COMMUN",
        status: "ACTIF",
        unitCode: "PCS",
        sourceSystem: "SILWANE",
        sourceOid: SOURCE_OID,
        sourceSyncId: `${PREFIXE}-SYNC-CHASSIS`,
      },
      select: { id: true, code: true },
    });
    articleImporte = cree;

    // 1. Diagnostic : l'article du referentiel reste utilise, la correspondance
    //    importee est signalee sans etre adoptee automatiquement.
    const analyse = await analyserArticleChassisPeint();
    expect(analyse.article?.id).toBe(chassisPeint.id);
    expect(analyse.regle?.producedItemId).toBe(chassisPeint.id);
    expect(
      analyse.candidats.map((candidat) => candidat.id),
      "Seul l'article importe par ce test doit etre candidat",
    ).toEqual([cree.id]);
    expect(analyse.ambigu).toBe(true);
    expect(analyse.messages.length).toBeGreaterThan(0);

    // 2. Une decision deja enregistree n'est pas remplacee : aucun article cree.
    const articlesAvant = await prisma.item.count({
      where: { code: { contains: "CHASSIS", mode: "insensitive" } },
    });
    const resolution = await resoudreArticleChassisPeint(prisma, acteur);
    expect(resolution.origine).toBe("REGLE");
    expect(resolution.itemId).toBe(chassisPeint.id);
    expect(resolution.articleReference?.id).toBe(chassisPeint.id);
    expect(
      await prisma.item.count({ where: { code: { contains: "CHASSIS", mode: "insensitive" } } }),
      "Aucun article ne doit etre cree",
    ).toBe(articlesAvant);

    // 3. Regle neutralisee et code logique sans article : l'equivalent importe est
    //    adopte, et l'article de reference n'est pas duplique.
    await prisma.divisionTransferRule.update({
      where: { id: regleTransfert.id },
      data: { isActive: false },
    });
    await ecrireCodeConfigure(CODE_ABSENT);

    const adoption = await assurerChassisPeint(prisma, acteur);
    expect(adoption.origine).toBe("EQUIVALENT_IMPORTE");
    expect(adoption.itemId).toBe(cree.id);
    expect(adoption.code).toBe(CODE_IMPORTE);
    expect(
      await prisma.item.findUnique({ where: { code: CODE_ABSENT } }),
      "Aucun article ne doit etre cree quand un equivalent importe existe",
    ).toBeNull();

    const regleApres = await prisma.divisionTransferRule.findUniqueOrThrow({
      where: { id: regleTransfert.id },
    });
    expect(regleApres.producedItemId).toBe(cree.id);

    const trace = await prisma.auditLog.findFirst({
      where: { entity: "Item", entityId: String(cree.id), action: "IMPORT" },
    });
    expect(trace?.userId).toBe(acteur.id);

    // 4. Regle reactivee sur cet article : plus aucune ambiguite.
    await prisma.divisionTransferRule.update({
      where: { id: regleTransfert.id },
      data: { isActive: true },
    });
    const apres = await analyserArticleChassisPeint();
    expect(apres.article?.id).toBe(cree.id);
    expect(apres.candidats).toEqual([]);
    expect(apres.ambigu).toBe(false);
    expect(apres.divergence).toBe(false);

    await ecrireCodeConfigure(codeConfigureOrigine);
    await restaurerRegle();
  });

  it("ne remplace jamais en silence l'article designe par la regle de transfert", async () => {
    const autre = await prisma.item.create({
      data: {
        code: CODE_AUTRE,
        label1: "Article de test AUTRE-CHASSIS",
        type: "SEMI_FINI",
        factory: "COMMUN",
        status: "ACTIF",
        unitCode: "PCS",
      },
      select: { id: true, code: true },
    });

    await ecrireCodeConfigure(CODE_AUTRE);

    const analyse = await analyserArticleChassisPeint();
    expect(analyse.codeConfigure).toBe(CODE_AUTRE);
    expect(analyse.divergence, "Le code configure et la regle doivent diverger").toBe(true);
    expect(analyse.article?.id, "La decision enregistree reste prioritaire").toBe(chassisPeint.id);
    expect(analyse.candidats.map((candidat) => candidat.id)).not.toContain(autre.id);
    expect(analyse.messages.some((message) => message.includes("differents"))).toBe(true);

    const resolution = await assurerChassisPeint(prisma, acteur);
    expect(resolution.origine).toBe("REGLE");
    expect(resolution.itemId).toBe(chassisPeint.id);

    const regleApres = await prisma.divisionTransferRule.findUniqueOrThrow({
      where: { id: regleTransfert.id },
    });
    expect(
      regleApres.producedItemId,
      "La regle ne doit pas etre reaffectee en silence",
    ).toBe(chassisPeint.id);

    await ecrireCodeConfigure(codeConfigureOrigine);
  });

  it("cree l'article de reference et aligne la regle quand aucune correspondance n'existe", async () => {
    if (articleImporte) {
      await prisma.item.deleteMany({ where: { id: articleImporte.id } });
      articleImporte = null;
    }
    await prisma.divisionTransferRule.update({
      where: { id: regleTransfert.id },
      data: { isActive: false },
    });
    await ecrireCodeConfigure(CODE_CREE);

    const resolution = await assurerChassisPeint(prisma, acteur);
    expect(resolution.origine).toBe("CREE");
    expect(resolution.code).toBe(CODE_CREE);
    expect(resolution.ambigu).toBe(false);
    expect(resolution.candidats).toEqual([]);

    const cree = await prisma.item.findUnique({ where: { code: CODE_CREE } });
    expect(cree, "L'article de reference doit exister").not.toBeNull();
    expect(cree!.type).toBe("SEMI_FINI");
    expect(cree!.isSemiFinished).toBe(true);
    expect(cree!.isProducible).toBe(true);
    expect(cree!.factory).toBe("COMMUN");
    expect(cree!.status).toBe("ACTIF");
    expect(
      await prisma.item.count({ where: { code: CODE_CREE } }),
      "L'article ne doit etre cree qu'une seule fois",
    ).toBe(1);

    const regleApres = await prisma.divisionTransferRule.findUniqueOrThrow({
      where: { id: regleTransfert.id },
    });
    expect(regleApres.producedItemId).toBe(cree!.id);

    // La base de test est reutilisee entre les executions : on ne relit jamais
    // une trace d'une execution precedente. Le journal est filtre sur l'acteur
    // courant et sur la trace la plus recente.
    const trace = await prisma.auditLog.findFirst({
      where: {
        entity: "DivisionTransferRule",
        entityId: String(regleTransfert.id),
        action: "MODIFICATION",
        userId: acteur.id,
      },
      orderBy: { id: "desc" },
    });
    expect(trace?.userId).toBe(acteur.id);

    // Une seconde resolution retrouve l'article par son code : aucun doublon.
    const seconde = await resoudreArticleChassisPeint(prisma, acteur);
    expect(seconde.origine).toBe("EXISTANT");
    expect(seconde.itemId).toBe(cree!.id);
    expect(await prisma.item.count({ where: { code: CODE_CREE } })).toBe(1);

    await ecrireCodeConfigure(codeConfigureOrigine);
    await restaurerRegle();
  });

  it("permet a un administrateur de designer l'article retenu et refuse un article archive", async () => {
    const choisi = await prisma.item.create({
      data: {
        code: CODE_RETENU,
        label1: "Chassis retenu par l'administrateur",
        type: "SEMI_FINI",
        factory: "COMMUN",
        status: "ACTIF",
        unitCode: "PCS",
      },
      select: { id: true, code: true },
    });

    const resultat = await adopterArticleChassisPeint(prisma, choisi.id, acteur);
    expect(resultat.itemId).toBe(choisi.id);
    expect(resultat.reglesMisesAJour).toBeGreaterThanOrEqual(1);

    const analyse = await analyserArticleChassisPeint();
    expect(analyse.article?.id).toBe(choisi.id);
    expect(analyse.regle?.producedItemId).toBe(choisi.id);

    // Un article archive ne peut pas devenir le semi-fini du transfert.
    await prisma.item.update({ where: { id: choisi.id }, data: { status: "ARCHIVE" } });
    await expect(adopterArticleChassisPeint(prisma, choisi.id, acteur)).rejects.toThrow(/archive/);

    // Article inexistant : refus egalement.
    await expect(adopterArticleChassisPeint(prisma, 999_999_999, acteur)).rejects.toThrow();

    await prisma.item.update({ where: { id: choisi.id }, data: { status: "ACTIF" } });
    await adopterArticleChassisPeint(prisma, chassisPeint.id, acteur);

    const regleApres = await prisma.divisionTransferRule.findUniqueOrThrow({
      where: { id: regleTransfert.id },
    });
    expect(regleApres.producedItemId).toBe(chassisPeint.id);
  });
});
