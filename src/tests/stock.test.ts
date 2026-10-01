/**
 * Tests d'integration du domaine STOCK.
 *
 * Ils s'executent contre la vraie base PostgreSQL preparee par `src/tests/setup.ts` :
 * aucun service n'est simule, aucun solde n'est calcule en memoire. Chaque
 * quantite verifiee ici a ete ecrite par `src/lib/stock/service.ts` puis relue
 * en base.
 *
 * Regle verifiee de bout en bout : le grand livre `StockMovement` est la seule
 * source de verite. Pour chaque ligne `StockBalance`, la somme des mouvements de
 * meme cle (article, depot, emplacement, lot, statut) doit egaler exactement la
 * quantite physique de la ligne.
 */

import { Prisma, type ItemType, type MovementType, type StockStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import {
  annulerMouvement,
  changerStatutStock,
  cleSolde,
  disponibleArticle,
  enregistrerInventaire,
  enregistrerMouvement,
  libererReservation,
  reserverStock,
  soldesArticle,
  transfererStock,
  type ActeurStock,
  type MouvementInput,
} from "@/lib/stock/service";
import { acteurTest, jeton, supprimerParPrefixe } from "@/tests/aide";

/** Prefixe unique : toutes les donnees creees par ce fichier portent ce jeton. */
const PREFIXE = jeton("TSTK");

let acteur: ActeurStock;
let depotMP: { id: number; code: string };
let depotMBX: { id: number; code: string };
let depotENC: { id: number; code: string };

// -----------------------------------------------------------------------------
// Outils de test
// -----------------------------------------------------------------------------

function dansTransaction<T>(
  travail: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(travail, { timeout: 30_000 });
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
  options: { type?: ItemType; unitCode?: string; useNegativeStock?: boolean } = {},
): Promise<{ id: number; code: string; label1: string }> {
  const article = await prisma.item.create({
    data: {
      code: `${PREFIXE}-${suffixe}`,
      label1: `Article de test ${suffixe}`,
      type: options.type ?? "MATIERE_PREMIERE",
      status: "ACTIF",
      factory: "ADMEDCO",
      unitCode: options.unitCode ?? "PCS",
      useNegativeStock: options.useNegativeStock ?? false,
    },
    select: { id: true, code: true, label1: true },
  });
  return article;
}

async function mouvement(entree: MouvementInput) {
  return dansTransaction((tx) => enregistrerMouvement(tx, entree));
}

function entree(
  itemId: number,
  warehouseId: number,
  quantity: string,
  unitCost = "0",
  options: Partial<MouvementInput> = {},
) {
  return mouvement({
    type: "ENTREE_INITIALE",
    itemId,
    warehouseId,
    quantity,
    unitCost,
    comment: "Entree de test",
    acteur,
    ...options,
  });
}

function sortie(
  itemId: number,
  warehouseId: number,
  quantity: string,
  options: Partial<MouvementInput> = {},
) {
  return mouvement({
    type: "SORTIE_PRODUCTION",
    itemId,
    warehouseId,
    quantity,
    comment: "Sortie de test",
    acteur,
    ...options,
  });
}

function changerStatut(
  itemId: number,
  warehouseId: number,
  quantity: string,
  de: StockStatus,
  vers: StockStatus,
  type: MovementType,
  options: { lotId?: number | null; reason?: string | null; comment?: string | null } = {},
) {
  return dansTransaction((tx) =>
    changerStatutStock(tx, {
      itemId,
      warehouseId,
      quantity,
      de,
      vers,
      type,
      lotId: options.lotId ?? null,
      reason: options.reason ?? null,
      comment: options.comment ?? null,
      acteur,
    }),
  );
}

async function lireSolde(
  itemId: number,
  warehouseId: number,
  status: StockStatus = "LIBRE",
  lotId: number | null = null,
) {
  return prisma.stockBalance.findUnique({
    where: { balanceKey: cleSolde({ itemId, warehouseId, lotId, status }) },
  });
}

async function soldeExistant(
  itemId: number,
  warehouseId: number,
  status: StockStatus = "LIBRE",
  lotId: number | null = null,
) {
  const solde = await lireSolde(itemId, warehouseId, status, lotId);
  expect(solde, `La ligne de solde ${itemId}/${warehouseId}/${status} doit exister`).not.toBeNull();
  return solde!;
}

/**
 * Verifie la coherence du grand livre pour un article :
 *   - chaque ligne de solde egale la somme des mouvements de meme cle ;
 *   - aucun mouvement n'existe sans ligne de solde.
 */
async function verifierGrandLivre(itemId: number): Promise<void> {
  const soldes = await prisma.stockBalance.findMany({ where: { itemId } });
  expect(soldes.length, "Un article mouvemente doit avoir au moins une ligne de solde").toBeGreaterThan(0);

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
    const total = somme._sum.quantity ?? D.ZERO;
    expect(
      total.toFixed(6),
      `Solde ${solde.balanceKey} : la somme des mouvements doit egaler la quantite physique`,
    ).toBe(solde.quantityPhysical.toFixed(6));
  }

  const mouvements = await prisma.stockMovement.findMany({
    where: { itemId },
    select: { warehouseId: true, locationId: true, lotId: true, status: true },
  });
  const clesSoldes = new Set(
    soldes.map((solde) =>
      [solde.warehouseId, solde.locationId ?? 0, solde.lotId ?? 0, solde.status].join(":"),
    ),
  );
  for (const mouvement of mouvements) {
    const cle = [
      mouvement.warehouseId,
      mouvement.locationId ?? 0,
      mouvement.lotId ?? 0,
      mouvement.status,
    ].join(":");
    expect(clesSoldes.has(cle), `Le mouvement ${cle} doit avoir sa ligne de solde`).toBe(true);
  }
}

// -----------------------------------------------------------------------------
// Preparation
// -----------------------------------------------------------------------------

beforeAll(async () => {
  acteur = await acteurTest();
  depotMP = await chargerDepot("DEP-MP");
  depotMBX = await chargerDepot("DEP-MP-MBX");
  depotENC = await chargerDepot("DEP-ENC");

  // Garde-fou : les unites utilisees par les articles de test existent bien.
  const unites = await prisma.unitOfMeasure.count({ where: { code: { in: ["PCS", "KG"] } } });
  expect(unites, "Le referentiel de test doit contenir les unites PCS et KG").toBe(2);
});

afterAll(async () => {
  await supprimerParPrefixe(PREFIXE);
});

// -----------------------------------------------------------------------------
// 1. Le grand livre est la seule source de verite
// -----------------------------------------------------------------------------

describe("grand livre de stock", () => {
  it("enregistre une entree puis une sortie : le solde suit exactement les mouvements", async () => {
    const article = await creerArticle("MV1");

    const entreeInitiale = await entree(article.id, depotMP.id, "12.5", "100");
    expect(entreeInitiale.soldeApres.toFixed(6)).toBe("12.500000");
    expect(entreeInitiale.disponibleApres.toFixed(6)).toBe("12.500000");
    expect(entreeInitiale.coutUnitaire.toFixed(6)).toBe("100.000000");
    expect(entreeInitiale.numero).toMatch(/^MVT-\d{4}-\d{6}$/);

    const sortieProduction = await sortie(article.id, depotMP.id, "-4.5");
    expect(sortieProduction.soldeApres.toFixed(6)).toBe("8.000000");
    expect(sortieProduction.disponibleApres.toFixed(6)).toBe("8.000000");

    const solde = await soldeExistant(article.id, depotMP.id);
    expect(solde.quantityPhysical.toFixed(6)).toBe("8.000000");
    expect(solde.unitCost.toFixed(6)).toBe("100.000000");
    expect(solde.totalValue.toFixed(6)).toBe("800.000000");

    const soldes = await soldesArticle(article.id);
    expect(soldes).toHaveLength(1);
    expect(soldes[0].warehouseCode).toBe("DEP-MP");
    expect(soldes[0].quantityPhysical.toFixed(6)).toBe("8.000000");
    expect(soldes[0].quantityAvailable.toFixed(6)).toBe("8.000000");
    expect((await disponibleArticle(article.id, depotMP.id)).toFixed(6)).toBe("8.000000");

    const mouvements = await prisma.stockMovement.findMany({
      where: { itemId: article.id },
      orderBy: { id: "asc" },
    });
    expect(mouvements).toHaveLength(2);
    expect(mouvements[0].type).toBe("ENTREE_INITIALE");
    expect(mouvements[1].type).toBe("SORTIE_PRODUCTION");
    expect(mouvements[1].quantity.toFixed(6)).toBe("-4.500000");
    expect(mouvements[0].balanceAfter?.toFixed(6)).toBe("12.500000");
    expect(mouvements[1].balanceAfter?.toFixed(6)).toBe("8.000000");
    expect(mouvements.every((mouvement) => mouvement.userId === acteur.id)).toBe(true);
    expect(mouvements.every((mouvement) => mouvement.userEmail === acteur.email)).toBe(true);
    expect(D.sum(mouvements.map((mouvement) => mouvement.quantity)).toFixed(6)).toBe("8.000000");

    // La somme des mouvements de l'article egale son solde, depot par depot.
    await verifierGrandLivre(article.id);
  });

  it("refuse une sortie superieure au disponible et documente l'autorisation explicite", async () => {
    const article = await creerArticle("MV2");
    await entree(article.id, depotMP.id, "5");

    await expect(
      sortie(article.id, depotMP.id, "-6"),
    ).rejects.toMatchObject({ name: "DomainError", code: "STOCK_INSUFFISANT" });

    // Un refus ne doit rien ecrire : ni solde, ni mouvement.
    expect((await soldeExistant(article.id, depotMP.id)).quantityPhysical.toFixed(6)).toBe("5.000000");
    expect(await prisma.stockMovement.count({ where: { itemId: article.id } })).toBe(1);

    // Mecanisme reel d'autorisation : `MouvementInput.autoriserNegatif`, porte par
    // la permission STOCK_NEGATIF_AUTORISER (verifiee cote route/action serveur).
    const force = await sortie(article.id, depotMP.id, "-6", { autoriserNegatif: true });
    expect(force.soldeApres.toFixed(6)).toBe("-1.000000");

    // Second mecanisme, porte par la fiche article : `Item.useNegativeStock`.
    const articleNegatif = await creerArticle("MV2B", { useNegativeStock: true });
    await entree(articleNegatif.id, depotMP.id, "2");
    const sortieNegative = await sortie(articleNegatif.id, depotMP.id, "-3");
    expect(sortieNegative.soldeApres.toFixed(6)).toBe("-1.000000");

    // Une quantite nulle n'est jamais un mouvement.
    await expect(
      mouvement({ type: "AJUSTEMENT", itemId: article.id, warehouseId: depotMP.id, quantity: "0", acteur }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await verifierGrandLivre(article.id);
    await verifierGrandLivre(articleNegatif.id);
  });

  it("calcule les quantites en decimal exact : 0,3 - 3 x 0,1 = 0", async () => {
    // Le meme calcul en flottant ne tombe pas sur zero : c'est ce piege que le
    // service evite en passant par Prisma.Decimal.
    expect(0.3 - 0.1 - 0.1 - 0.1).not.toBe(0);

    const article = await creerArticle("DC1");
    await entree(article.id, depotMP.id, "0.3", "7.9");

    for (let index = 0; index < 3; index += 1) {
      const resultat = await sortie(article.id, depotMP.id, "-0.1");
      expect(resultat.disponibleApres.toFixed(6)).toBe(
        ["0.200000", "0.100000", "0.000000"][index],
      );
    }

    const solde = await soldeExistant(article.id, depotMP.id);
    expect(solde.quantityPhysical.isZero()).toBe(true);
    expect(solde.quantityPhysical.toFixed(6)).toBe("0.000000");
    expect((await disponibleArticle(article.id, depotMP.id)).isZero()).toBe(true);

    const somme = await prisma.stockMovement.aggregate({
      where: { itemId: article.id },
      _sum: { quantity: true },
    });
    expect((somme._sum.quantity ?? D.UN).isZero()).toBe(true);

    // Un solde nul n'est plus retourne par la consultation des soldes non vides.
    expect(await soldesArticle(article.id)).toHaveLength(0);
    await verifierGrandLivre(article.id);
  });

  it("valorise au cout moyen pondere sans derive flottante", async () => {
    // (0,3 x 1 + 0,3 x 2) / 0,6 : exact en decimal, faux en flottant.
    expect(0.3 * 1 + 0.3 * 2).not.toBe(0.9);

    const article = await creerArticle("VW1");
    await entree(article.id, depotMP.id, "0.3", "1");
    const seconde = await entree(article.id, depotMP.id, "0.3", "2");
    expect(seconde.coutUnitaire.toFixed(6)).toBe("1.500000");

    const solde = await soldeExistant(article.id, depotMP.id);
    expect(solde.quantityPhysical.toFixed(6)).toBe("0.600000");
    expect(solde.unitCost.toFixed(6)).toBe("1.500000");
    expect(solde.totalValue.toFixed(6)).toBe("0.900000");

    const articleEnBase = await prisma.item.findUniqueOrThrow({ where: { id: article.id } });
    expect(articleEnBase.vwap.toFixed(6)).toBe("1.500000");

    // Une sortie ne modifie pas le cout moyen : elle sort au cout courant.
    await sortie(article.id, depotMP.id, "-0.1");
    const apresSortie = await soldeExistant(article.id, depotMP.id);
    expect(apresSortie.unitCost.toFixed(6)).toBe("1.500000");
    expect(apresSortie.quantityPhysical.toFixed(6)).toBe("0.500000");
    expect(apresSortie.totalValue.toFixed(6)).toBe("0.750000");

    await verifierGrandLivre(article.id);
  });
});

// -----------------------------------------------------------------------------
// 2. Statuts qualite : quarantaine, blocage, rebut
// -----------------------------------------------------------------------------

describe("statuts qualite", () => {
  it("refuse toute sortie d'un article en quarantaine, bloque ou en rebut", async () => {
    const article = await creerArticle("QT1");
    await entree(article.id, depotMP.id, "10", "3");

    await changerStatut(article.id, depotMP.id, "10", "LIBRE", "QUARANTAINE", "MISE_EN_QUARANTAINE", {
      reason: "Attente du controle qualite",
    });

    // La quantite physique totale n'a pas bouge : elle a change de statut.
    expect((await soldeExistant(article.id, depotMP.id, "LIBRE")).quantityPhysical.isZero()).toBe(true);
    expect(
      (await soldeExistant(article.id, depotMP.id, "QUARANTAINE")).quantityPhysical.toFixed(6),
    ).toBe("10.000000");
    expect((await disponibleArticle(article.id, depotMP.id)).isZero()).toBe(true);

    await expect(
      sortie(article.id, depotMP.id, "-1", { status: "QUARANTAINE" }),
    ).rejects.toMatchObject({ name: "DomainError", code: "CONFLIT" });
    // Sans stock libre disponible, une sortie libre est egalement refusee.
    await expect(sortie(article.id, depotMP.id, "-1")).rejects.toMatchObject({
      code: "STOCK_INSUFFISANT",
    });
    // Aucune sortie n'a ete ecrite : le grand livre est fige par les refus.
    // (Le changement de statut, lui, a bien ecrit ses deux ecritures.)
    const mouvementsApresEntree = await prisma.stockMovement.count({ where: { itemId: article.id } });
    expect(mouvementsApresEntree).toBe(3);
    expect(
      (await soldeExistant(article.id, depotMP.id, "QUARANTAINE")).quantityPhysical.toFixed(6),
    ).toBe("10.000000");

    // Seule une liberation qualite rouvre le stock a la consommation.
    await changerStatut(article.id, depotMP.id, "10", "QUARANTAINE", "LIBRE", "LIBERATION_QUALITE");
    expect((await disponibleArticle(article.id, depotMP.id)).toFixed(6)).toBe("10.000000");
    const sortieApresLiberation = await sortie(article.id, depotMP.id, "-4");
    expect(sortieApresLiberation.soldeApres.toFixed(6)).toBe("6.000000");
    await verifierGrandLivre(article.id);
  });

  it("refuse la sortie d'un article bloque ou classe en rebut", async () => {
    const bloque = await creerArticle("QT2");
    await entree(bloque.id, depotMP.id, "10", "1");
    await changerStatut(bloque.id, depotMP.id, "10", "LIBRE", "BLOQUE", "AJUSTEMENT", {
      reason: "Blocage qualite",
    });
    await expect(
      sortie(bloque.id, depotMP.id, "-1", { status: "BLOQUE" }),
    ).rejects.toMatchObject({ code: "CONFLIT" });
    expect(
      await prisma.stockMovement.count({ where: { itemId: bloque.id } }),
      "Le refus n'ajoute aucune ecriture : seule l'entree et le changement de statut existent",
    ).toBe(3);
    await verifierGrandLivre(bloque.id);

    const rebut = await creerArticle("QT3");
    await entree(rebut.id, depotMP.id, "5", "1");
    await changerStatut(rebut.id, depotMP.id, "5", "LIBRE", "REBUT", "REBUT", {
      reason: "Pieces non conformes",
    });
    await expect(
      sortie(rebut.id, depotMP.id, "-1", { status: "REBUT" }),
    ).rejects.toMatchObject({ code: "CONFLIT" });
    expect((await disponibleArticle(rebut.id, depotMP.id)).isZero()).toBe(true);
    await verifierGrandLivre(rebut.id);
  });

  it("refuse la consommation d'un lot en quarantaine jusqu'a sa liberation qualite", async () => {
    const article = await creerArticle("LOT1");
    const lot = await prisma.stockLot.create({
      data: {
        itemId: article.id,
        warehouseId: depotMP.id,
        lotNumber: `${PREFIXE}-LOT1`,
        status: "LIBRE",
        manufactureDate: new Date(),
      },
    });

    await entree(article.id, depotMP.id, "5", "2", { lotId: lot.id });
    await changerStatut(article.id, depotMP.id, "5", "LIBRE", "QUARANTAINE", "MISE_EN_QUARANTAINE", {
      lotId: lot.id,
      reason: "Attente controle qualite",
    });

    const lotEnQuarantaine = await prisma.stockLot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(lotEnQuarantaine.status).toBe("QUARANTAINE");
    expect(lotEnQuarantaine.blockingReason).toBe("Attente controle qualite");
    expect((await disponibleArticle(article.id, depotMP.id)).isZero()).toBe(true);

    await expect(
      sortie(article.id, depotMP.id, "-1", { lotId: lot.id, status: "QUARANTAINE" }),
    ).rejects.toMatchObject({ code: "CONFLIT" });

    await changerStatut(article.id, depotMP.id, "5", "QUARANTAINE", "LIBRE", "LIBERATION_QUALITE", {
      lotId: lot.id,
    });
    const lotLibere = await prisma.stockLot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(lotLibere.status).toBe("LIBRE");
    expect(lotLibere.blockingReason).toBeNull();

    const sortieLot = await sortie(article.id, depotMP.id, "-5", { lotId: lot.id });
    expect(sortieLot.soldeApres.toFixed(6)).toBe("0.000000");
    await verifierGrandLivre(article.id);
  });

  it("changerStatutStock deplace les quantites entre statuts sans modifier le physique total", async () => {
    const article = await creerArticle("CS1");
    await entree(article.id, depotMP.id, "20", "3");

    await changerStatut(article.id, depotMP.id, "5", "LIBRE", "QUARANTAINE", "MISE_EN_QUARANTAINE");
    await changerStatut(article.id, depotMP.id, "3", "LIBRE", "BLOQUE", "AJUSTEMENT", {
      reason: "Blocage qualite",
    });
    await changerStatut(article.id, depotMP.id, "2", "LIBRE", "REBUT", "REBUT");
    await changerStatut(article.id, depotMP.id, "1", "LIBRE", "EN_COURS_PRODUCTION", "AJUSTEMENT");

    const lignes = await prisma.stockBalance.findMany({ where: { itemId: article.id } });
    const physiques = new Map(lignes.map((ligne) => [ligne.status, ligne.quantityPhysical.toFixed(6)]));
    expect(physiques.get("LIBRE")).toBe("9.000000");
    expect(physiques.get("QUARANTAINE")).toBe("5.000000");
    expect(physiques.get("BLOQUE")).toBe("3.000000");
    expect(physiques.get("REBUT")).toBe("2.000000");
    expect(physiques.get("EN_COURS_PRODUCTION")).toBe("1.000000");

    // Le physique total est strictement inchange : aucun mouvement n'a ete perdu
    // ni cree, seule la repartition par statut a change.
    expect(
      D.sum(lignes.map((ligne) => ligne.quantityPhysical)).toFixed(6),
      "La somme des quantites physiques doit rester egale a l'entree initiale",
    ).toBe("20.000000");

    // Seul le statut LIBRE est disponible a la sortie.
    expect((await disponibleArticle(article.id, depotMP.id)).toFixed(6)).toBe("9.000000");
    const sortieLibre = await sortie(article.id, depotMP.id, "-9");
    expect(sortieLibre.soldeApres.toFixed(6)).toBe("0.000000");
    expect(
      D.sum(
        (await prisma.stockBalance.findMany({ where: { itemId: article.id } })).map(
          (ligne) => ligne.quantityPhysical,
        ),
      ).toFixed(6),
    ).toBe("11.000000");

    // Un statut vers lui-meme n'a aucun sens, et une quantite nulle non plus.
    await expect(
      changerStatut(article.id, depotMP.id, "1", "LIBRE", "LIBRE", "AJUSTEMENT"),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      changerStatut(article.id, depotMP.id, "0", "QUARANTAINE", "LIBRE", "LIBERATION_QUALITE"),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    // On ne peut pas deplacer plus que ce que le statut d'origine contient.
    await expect(
      changerStatut(article.id, depotMP.id, "99", "QUARANTAINE", "LIBRE", "LIBERATION_QUALITE"),
    ).rejects.toMatchObject({ code: "STOCK_INSUFFISANT" });

    await verifierGrandLivre(article.id);
  });
});

// -----------------------------------------------------------------------------
// 3. Transferts, contre-passation, reservation, inventaire
// -----------------------------------------------------------------------------

describe("transfert entre depots", () => {
  it("cree une sortie et une entree liees a la quantite exacte, et refuse un transfert impossible", async () => {
    const article = await creerArticle("TR1");
    await entree(article.id, depotMP.id, "10", "2.5");

    const { sortieId, entreeId } = await dansTransaction((tx) =>
      transfererStock(tx, {
        itemId: article.id,
        quantity: "3.25",
        sourceWarehouseId: depotMP.id,
        targetWarehouseId: depotMBX.id,
        documentType: "TRANSFERT_TEST",
        documentId: `${PREFIXE}-TR1`,
        documentNumber: `${PREFIXE}-TR1`,
        comment: "Transfert de test",
        acteur,
      }),
    );
    expect(entreeId).not.toBe(sortieId);

    const mouvementSortie = await prisma.stockMovement.findUniqueOrThrow({ where: { id: sortieId } });
    const mouvementEntree = await prisma.stockMovement.findUniqueOrThrow({ where: { id: entreeId } });

    expect(mouvementSortie.type).toBe("TRANSFERT_INTER_DEPOTS");
    expect(mouvementEntree.type).toBe("TRANSFERT_INTER_DEPOTS");
    expect(mouvementSortie.quantity.toFixed(6)).toBe("-3.250000");
    expect(mouvementEntree.quantity.toFixed(6)).toBe("3.250000");
    expect(mouvementSortie.warehouseId).toBe(depotMP.id);
    expect(mouvementEntree.warehouseId).toBe(depotMBX.id);
    expect(mouvementSortie.sourceWarehouseId).toBe(depotMP.id);
    expect(mouvementEntree.sourceWarehouseId).toBe(depotMP.id);
    expect(mouvementSortie.targetWarehouseId).toBe(depotMBX.id);
    expect(mouvementEntree.targetWarehouseId).toBe(depotMBX.id);
    expect(mouvementSortie.documentNumber).toBe(`${PREFIXE}-TR1`);
    expect(mouvementEntree.documentNumber).toBe(`${PREFIXE}-TR1`);
    // Le cout est transfere tel quel de la sortie vers l'entree.
    expect(mouvementEntree.unitCost.toFixed(6)).toBe(mouvementSortie.unitCost.toFixed(6));

    expect((await soldeExistant(article.id, depotMP.id)).quantityPhysical.toFixed(6)).toBe("6.750000");
    expect((await soldeExistant(article.id, depotMBX.id)).quantityPhysical.toFixed(6)).toBe("3.250000");
    expect((await disponibleArticle(article.id, depotMBX.id)).toFixed(6)).toBe("3.250000");
    await verifierGrandLivre(article.id);

    // Transfert impossible : meme depot, quantite nulle ou negative, stock manquant.
    await expect(
      dansTransaction((tx) =>
        transfererStock(tx, {
          itemId: article.id,
          quantity: "1",
          sourceWarehouseId: depotMP.id,
          targetWarehouseId: depotMP.id,
          acteur,
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      dansTransaction((tx) =>
        transfererStock(tx, {
          itemId: article.id,
          quantity: "0",
          sourceWarehouseId: depotMP.id,
          targetWarehouseId: depotMBX.id,
          acteur,
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      dansTransaction((tx) =>
        transfererStock(tx, {
          itemId: article.id,
          quantity: "100",
          sourceWarehouseId: depotMP.id,
          targetWarehouseId: depotMBX.id,
          acteur,
        }),
      ),
    ).rejects.toMatchObject({ code: "STOCK_INSUFFISANT" });

    // Aucun de ces refus n'a laisse d'ecriture.
    expect(await prisma.stockMovement.count({ where: { itemId: article.id } })).toBe(3);
    expect((await soldeExistant(article.id, depotMP.id)).quantityPhysical.toFixed(6)).toBe("6.750000");
    expect((await soldeExistant(article.id, depotMBX.id)).quantityPhysical.toFixed(6)).toBe("3.250000");
  });

  it("annule un mouvement par contre-passation sans jamais supprimer l'original", async () => {
    const article = await creerArticle("AN1");
    const initial = await entree(article.id, depotMP.id, "10", "4");

    const motif = "Erreur de saisie sur l'entree initiale";
    const { mouvementInverseId } = await annulerMouvement(initial.mouvementId, motif, acteur);

    const original = await prisma.stockMovement.findUniqueOrThrow({
      where: { id: initial.mouvementId },
      include: { reverses: true },
    });
    // Le mouvement d'origine est intact : il porte toujours sa quantite et sa
    // nature. Le lien d'annulation est ecrit sur la contre-passation, et
    // l'ecriture d'origine expose sa contre-passation via la relation `reverses`.
    expect(original.quantity.toFixed(6)).toBe("10.000000");
    expect(original.type).toBe("ENTREE_INITIALE");
    expect(original.isReversal).toBe(false);
    expect(original.reversedById).toBeNull();
    expect(original.reverses?.id).toBe(mouvementInverseId);
    expect(original.reverses?.isReversal).toBe(true);

    const inverse = await prisma.stockMovement.findUniqueOrThrow({
      where: { id: mouvementInverseId },
    });
    expect(inverse.isReversal).toBe(true);
    expect(inverse.reversedById).toBe(initial.mouvementId);
    expect(inverse.type).toBe("AJUSTEMENT");
    expect(inverse.quantity.toFixed(6)).toBe("-10.000000");
    expect(inverse.itemId).toBe(article.id);
    expect(inverse.warehouseId).toBe(depotMP.id);
    expect(inverse.reason).toBe(motif);
    expect(inverse.balanceAfter?.toFixed(6)).toBe("0.000000");
    expect(inverse.userId).toBe(acteur.id);

    // L'ecriture d'origine est toujours dans le grand livre, et le solde revient a zero.
    expect(await prisma.stockMovement.count({ where: { itemId: article.id } })).toBe(2);
    expect((await soldeExistant(article.id, depotMP.id)).quantityPhysical.isZero()).toBe(true);
    await verifierGrandLivre(article.id);

    // La contre-passation est auditee.
    const journal = await prisma.auditLog.findFirst({
      where: { action: "MOUVEMENT_ANNULE", entityId: String(initial.mouvementId) },
    });
    expect(journal).not.toBeNull();
    expect(journal?.reason).toBe(motif);
    expect((journal?.newValue as { numeroAnnulation?: string }).numeroAnnulation).toBe(inverse.number);

    // Une double annulation est refusee, et une contre-passation ne s'annule pas.
    await expect(
      annulerMouvement(initial.mouvementId, "Seconde tentative d'annulation", acteur),
    ).rejects.toMatchObject({ code: "CONFLIT" });
    await expect(
      annulerMouvement(mouvementInverseId, "Annulation de la contre-passation", acteur),
    ).rejects.toMatchObject({ code: "CONFLIT" });

    // Un motif trop court est refuse.
    await expect(annulerMouvement(initial.mouvementId, "bug", acteur)).rejects.toMatchObject({
      code: "VALIDATION",
    });

    // Aucun de ces refus n'a supprime ni cree d'ecriture.
    expect(await prisma.stockMovement.count({ where: { itemId: article.id } })).toBe(2);
    expect(
      await prisma.stockMovement.count({ where: { id: initial.mouvementId } }),
      "Le mouvement d'origine ne doit jamais etre supprime",
    ).toBe(1);
  });
});

describe("reservation et inventaire", () => {
  it("reserverStock puis libererReservation restituent la disponibilite a l'identique", async () => {
    const article = await creerArticle("RS1");
    await entree(article.id, depotMP.id, "10", "2");

    const disponibiliteInitiale = await disponibleArticle(article.id, depotMP.id);
    expect(disponibiliteInitiale.toFixed(6)).toBe("10.000000");

    await dansTransaction((tx) =>
      reserverStock(tx, {
        itemId: article.id,
        warehouseId: depotMP.id,
        quantity: "4",
        documentType: "COMMANDE_CLIENT",
        documentId: `${PREFIXE}-CC1`,
        acteur,
      }),
    );

    const soldeReserve = await soldeExistant(article.id, depotMP.id);
    expect(soldeReserve.quantityPhysical.toFixed(6)).toBe("10.000000");
    expect(soldeReserve.quantityReserved.toFixed(6)).toBe("4.000000");
    expect((await disponibleArticle(article.id, depotMP.id)).toFixed(6)).toBe("6.000000");
    // Une reservation n'est pas un mouvement de stock : rien n'entre dans le grand livre.
    expect(await prisma.stockMovement.count({ where: { itemId: article.id } })).toBe(1);

    await expect(
      dansTransaction((tx) =>
        reserverStock(tx, {
          itemId: article.id,
          warehouseId: depotMP.id,
          quantity: "7",
          acteur,
        }),
      ),
    ).rejects.toMatchObject({ code: "STOCK_INSUFFISANT" });
    await expect(
      dansTransaction((tx) =>
        reserverStock(tx, { itemId: article.id, warehouseId: depotMP.id, quantity: "-1", acteur }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await dansTransaction((tx) =>
      libererReservation(tx, {
        itemId: article.id,
        warehouseId: depotMP.id,
        quantity: "4",
        documentType: "COMMANDE_CLIENT",
        documentId: `${PREFIXE}-CC1`,
        acteur,
      }),
    );

    const soldeLibere = await soldeExistant(article.id, depotMP.id);
    expect(soldeLibere.quantityReserved.isZero()).toBe(true);
    expect(soldeLibere.quantityPhysical.toFixed(6)).toBe("10.000000");
    const disponibiliteFinale = await disponibleArticle(article.id, depotMP.id);
    expect(disponibiliteFinale.toFixed(6), "La disponibilite doit revenir a son etat initial").toBe(
      disponibiliteInitiale.toFixed(6),
    );

    // Liberation sans reservation : refusee.
    await expect(
      dansTransaction((tx) =>
        libererReservation(tx, { itemId: article.id, warehouseId: depotMP.id, quantity: "1", acteur }),
      ),
    ).rejects.toMatchObject({ code: "ETAT_INVALIDE" });

    expect(await prisma.stockMovement.count({ where: { itemId: article.id } })).toBe(1);
    await verifierGrandLivre(article.id);
  });

  it("materialise tout ecart d'inventaire par un mouvement, et rien sans ecart", async () => {
    const article = await creerArticle("IV1");
    await entree(article.id, depotMP.id, "10", "1.2");

    const premier = await dansTransaction((tx) =>
      enregistrerInventaire(tx, {
        itemId: article.id,
        warehouseId: depotMP.id,
        quantityComptee: "7",
        commentaire: "Comptage physique de test",
        acteur,
      }),
    );
    expect(premier.ecart.toFixed(6)).toBe("-3.000000");
    expect(premier.mouvementId).not.toBeNull();

    const mouvementEcart = await prisma.stockMovement.findUniqueOrThrow({
      where: { id: premier.mouvementId! },
    });
    expect(mouvementEcart.type).toBe("INVENTAIRE_PHYSIQUE");
    expect(mouvementEcart.quantity.toFixed(6)).toBe("-3.000000");
    expect(mouvementEcart.userId).toBe(acteur.id);
    expect((await soldeExistant(article.id, depotMP.id)).quantityPhysical.toFixed(6)).toBe("7.000000");
    await verifierGrandLivre(article.id);

    // Sans ecart, aucun mouvement n'est ecrit.
    const second = await dansTransaction((tx) =>
      enregistrerInventaire(tx, {
        itemId: article.id,
        warehouseId: depotMP.id,
        quantityComptee: "7",
        acteur,
      }),
    );
    expect(second.ecart.isZero()).toBe(true);
    expect(second.mouvementId).toBeNull();
    expect(await prisma.stockMovement.count({ where: { itemId: article.id } })).toBe(2);

    // Un ecart positif est materialise de la meme facon.
    const troisieme = await dansTransaction((tx) =>
      enregistrerInventaire(tx, {
        itemId: article.id,
        warehouseId: depotMP.id,
        quantityComptee: "9",
        acteur,
      }),
    );
    expect(troisieme.ecart.toFixed(6)).toBe("2.000000");
    expect((await soldeExistant(article.id, depotMP.id)).quantityPhysical.toFixed(6)).toBe("9.000000");
    await verifierGrandLivre(article.id);
  });

  it("ne laisse aucun solde varier sans mouvement, sur l'ensemble des articles de test", async () => {
    const articles = await prisma.item.findMany({
      where: { code: { startsWith: PREFIXE } },
      select: { id: true, code: true },
      orderBy: { id: "asc" },
    });
    expect(articles.length).toBeGreaterThan(5);

    for (const article of articles) {
      const mouvements = await prisma.stockMovement.count({ where: { itemId: article.id } });
      expect(mouvements, `${article.code} doit avoir un grand livre`).toBeGreaterThan(0);
      await verifierGrandLivre(article.id);
    }
  });
});
