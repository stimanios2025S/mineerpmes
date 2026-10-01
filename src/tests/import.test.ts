/**
 * Tests de l'import des donnees sources.
 *
 * Trois niveaux sont verifies :
 *   1. la lecture des fichiers CSV (separateur, accents, guillemets, lignes
 *      vides de valeurs) ;
 *   2. des imports reels contre PostgreSQL : creation, cle stable
 *      (systeme source + identifiant d'origine) donc re-executabilite sans
 *      doublon, protection d'une fiche modifiee dans la plateforme, aucune
 *      suppression d'une fiche absente du fichier ;
 *   3. les regles metier de l'import : aucune nature de tiers ni aucun type
 *      d'article devine en silence, aucune quantite choisie lorsqu'une
 *      contradiction est detectee, lignes vides ignorees et non rejetees,
 *      stock importe sous forme de mouvements traces, simulation sans ecriture.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import {
  analyserCsv,
  detecterEncodage,
  detecterSeparateur,
  verifierColonnes,
} from "@/lib/import/csv";
import {
  SYSTEME_SOURCE,
  contexteDepuisContenu,
  definirCorrespondance,
  importerArticles,
  importerFamilles,
  importerLotsEtStocks,
  importerNomenclatures,
  importerTiers,
  simulerImport,
  type ContexteImport,
  type ResultatImport,
} from "@/lib/import/service";
import { acteurTest, jeton, type ActeurTest } from "@/tests/aide";

// -----------------------------------------------------------------------------
// Jeu de donnees
// -----------------------------------------------------------------------------

/**
 * Les identifiants sources sont tires aleatoirement dans une plage tres haute :
 * ils ne peuvent ni entrer en collision avec les donnees reellement importees,
 * ni etre reutilises d'une execution a l'autre.
 */
const BASE = 600_000_000 + Math.floor(Math.random() * 200_000_000);

const OID_FAMILLE = BASE + 1;
const OID_FAMILLE_ENFANT = BASE + 2;
const OID_FAMILLE_ISOLee = BASE + 3;
const OID_ARTICLE = BASE + 11;
const OID_COMPOSANT = BASE + 12;
const OID_ARTICLE_HS = BASE + 13;
const OID_TIERS_AUTRE = BASE + 21;
const OID_TIERS_EMPLOYE = BASE + 22;
const OID_FORMULE = BASE + 31;
const OID_LIGNE_A = BASE + 41;
const OID_LIGNE_B = BASE + 42;
const OID_LIGNE_VIDE = BASE + 43;
const OID_LOT = BASE + 51;

const JETON = jeton("TIMPORT");
const CODE_FAMILLE = `${JETON}-FAM`;
const CODE_ARTICLE = `${JETON}-ART`;
const CODE_COMPOSANT = `${JETON}-CMP`;
const CODE_ARTICLE_HS = `${JETON}-HS`;
const CODE_TIERS_AUTRE = `${JETON}-TA`;
const CODE_TIERS_EMPLOYE = `${JETON}-TE`;
const CODE_FORMULE = `${JETON}-NOM`;
const NUMERO_LOT = `${JETON}-LOT`;
const EMAIL_EMPLOYE = `${JETON.toLowerCase()}@admedco.local`;

/** Valeurs de source volontairement inconnues : rien ne doit etre devine. */
const TYPE_ARTICLE_INCONNU = `${JETON}_TYPE_ARTICLE`;
const TYPE_TIERS_INCONNU = `${JETON}_TYPE_TIERS`;
const TYPE_TIERS_EMPLOYE = `${JETON}_TYPE_EMPLOYE`;

const jobIds: number[] = [];

function csv(entetes: string[], lignes: (string | number | null)[][]): string {
  const valeur = (brut: string | number | null): string => (brut === null ? "" : String(brut));
  return [entetes.join(";"), ...lignes.map((ligne) => ligne.map(valeur).join(";"))].join("\r\n");
}

const CONTENU_FAMILLES = csv(
  ["Oid", "SyncId", "Code", "Label1", "Label2", "Parent", "Hierarchy", "AccountingCode"],
  [
    [OID_FAMILLE, "S1", CODE_FAMILLE, "Famille de recette", "", "", "1", "701"],
    [OID_FAMILLE_ENFANT, "S2", "", "Sous-famille de recette", "", OID_FAMILLE, "1.1", ""],
    ["", "S3", "", "Famille sans identifiant source", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
  ],
);

const CONTENU_FAMILLE_ISOLEE = csv(
  ["Oid", "SyncId", "Code", "Label1", "Label2", "Parent", "Hierarchy", "AccountingCode"],
  [[OID_FAMILLE_ISOLee, "S9", `${JETON}-FAM9`, "Famille ajoutee plus tard", "", "", "9", ""]],
);

const CONTENU_ARTICLES = csv(
  ["Oid", "SyncId", "Code", "Label1", "Type", "Family", "UnitOfMeasure", "IsOutOfService"],
  [
    [OID_ARTICLE, "S1", CODE_ARTICLE, "Article parent de recette", TYPE_ARTICLE_INCONNU, OID_FAMILLE, "U", "0"],
    [OID_COMPOSANT, "S2", CODE_COMPOSANT, "Composant de recette", TYPE_ARTICLE_INCONNU, OID_FAMILLE, "U", "0"],
    [OID_ARTICLE_HS, "S3", CODE_ARTICLE_HS, "Article hors service", TYPE_ARTICLE_INCONNU, "", "", "1"],
  ],
);

const CONTENU_TIERS = csv(
  ["Oid", "SyncId", "Code", "Label1", "Type", "Email", "PostCode", "Balance"],
  [
    [OID_TIERS_AUTRE, "S1", CODE_TIERS_AUTRE, "Tiers de recette", TYPE_TIERS_INCONNU, "", "16000", "0"],
    [OID_TIERS_EMPLOYE, "S2", CODE_TIERS_EMPLOYE, "Employe de recette", TYPE_TIERS_EMPLOYE, EMAIL_EMPLOYE, "", "0"],
  ],
);

const CONTENU_FORMULES = csv(
  ["Oid", "SyncId", "Code", "Label1", "Item", "Type", "TypeFormule", "TotalQuantity", "Blocked", "PML"],
  [[OID_FORMULE, "S1", CODE_FORMULE, "Nomenclature de recette", OID_ARTICLE, "", "", "1", "0", "1"]],
);

const CONTENU_BOM = csv(
  ["Oid", "Offset", "Parent", "Item", "Quantity", "ToleratedError", "Class", "Price"],
  [
    [OID_LIGNE_A, 1, OID_FORMULE, OID_COMPOSANT, "2.500000", "0", "", "10"],
    [OID_LIGNE_B, 2, OID_FORMULE, OID_COMPOSANT, "3.000000", "0", "", "10"],
    [OID_LIGNE_VIDE, 3, "", "", "", "", "", ""],
  ],
);

const CONTENU_LOTS = csv(
  ["Oid", "SyncId", "Code", "BatchNum", "Item", "PhysicalQuantity", "ReservedQuantity", "Blocked", "DamagedQuantity", "VWAP"],
  [[OID_LOT, "S1", NUMERO_LOT, NUMERO_LOT, OID_ARTICLE, "12.500000", "0", "0", "0", "150"]],
);

let acteur: ActeurTest;
let depotId: number | null = null;

function contexte(
  contenu: string,
  nomFichier: string,
  options: { miseAJourAutorisee?: boolean; simulation?: boolean } = {},
): ContexteImport {
  return contexteDepuisContenu(contenu, nomFichier, acteur, options);
}

function retenir(resultat: ResultatImport): ResultatImport {
  jobIds.push(resultat.jobId);
  return resultat;
}

// -----------------------------------------------------------------------------
// Preparation et nettoyage
// -----------------------------------------------------------------------------

beforeAll(async () => {
  acteur = await acteurTest();

  const depot = await prisma.warehouse.findFirst({ where: { code: "DEP-MP" }, select: { id: true } });
  const premierDepot = depot ?? (await prisma.warehouse.findFirst({ select: { id: true } }));
  depotId = premierDepot?.id ?? null;
});

afterAll(async () => {
  try {
    const plage = { gte: BASE, lt: BASE + 1000 };
    const parSource = { sourceSystem: SYSTEME_SOURCE, sourceOid: plage };

    // Les journaux d'erreur d'abord : ils peuvent referencer un article cree
    // par ce fichier de tests.
    if (jobIds.length > 0) {
      await prisma.importErrorLog.deleteMany({ where: { jobId: { in: jobIds } } });
    }

    const formules = await prisma.formula.findMany({
      where: parSource,
      select: { id: true },
    });
    const formuleIds = formules.map((formule) => formule.id);

    if (formuleIds.length > 0) {
      await prisma.formulaVariance.deleteMany({ where: { formulaId: { in: formuleIds } } });
      await prisma.formulaLine.deleteMany({ where: { formulaId: { in: formuleIds } } });
    }

    const articles = await prisma.item.findMany({ where: parSource, select: { id: true } });
    const articleIds = articles.map((article) => article.id);

    if (articleIds.length > 0) {
      await prisma.stockMovement.deleteMany({ where: { itemId: { in: articleIds } } });
      await prisma.stockBalance.deleteMany({ where: { itemId: { in: articleIds } } });
      await prisma.stockLot.deleteMany({ where: { itemId: { in: articleIds } } });
    }

    await prisma.formulaLine.deleteMany({ where: parSource });
    await prisma.formula.deleteMany({ where: { id: { in: formuleIds } } });
    await prisma.item.deleteMany({ where: { id: { in: articleIds } } });
    await prisma.thirdParty.deleteMany({ where: parSource });
    await prisma.itemFamily.deleteMany({ where: parSource });

    await prisma.importValueMapping.deleteMany({
      where: {
        sourceValue: { in: [TYPE_ARTICLE_INCONNU, TYPE_TIERS_INCONNU, TYPE_TIERS_EMPLOYE] },
      },
    });
    await prisma.importRowSnapshot.deleteMany({ where: parSource });

    if (jobIds.length > 0) {
      await prisma.importJob.deleteMany({ where: { id: { in: jobIds } } });
    }

    if (acteur) await prisma.user.deleteMany({ where: { id: acteur.id } });
  } catch (erreur) {
    console.warn("[import.test] Nettoyage incomplet :", erreur);
  }
});

// -----------------------------------------------------------------------------
// Lecture des fichiers
// -----------------------------------------------------------------------------

describe("Lecture des fichiers CSV", () => {
  it("detecte le separateur point-virgule des fichiers de l'ancien ERP", () => {
    expect(detecterSeparateur("Oid;Code;Label1\n1;A;Chaise")).toBe(";");
    expect(detecterSeparateur("Oid,Code,Label1\n1,A,Chaise")).toBe(",");
  });

  it("conserve les accents et les libelles francais", () => {
    const fichier = analyserCsv("Code;Label1\r\nA1;Châssis peint\r\nA2;Réglage précision");

    expect(fichier.entetes).toEqual(["Code", "Label1"]);
    expect(fichier.lignes).toHaveLength(2);
    expect(fichier.lignes[0].valeurs.Label1).toBe("Châssis peint");
    expect(fichier.lignes[1].valeurs.Label1).toBe("Réglage précision");
  });

  it("respecte les champs entre guillemets contenant le separateur", () => {
    const fichier = analyserCsv('Oid;Label1\n1;"Chaise; garnie"\n2;Simple');

    expect(fichier.lignes[0].valeurs.Label1).toBe("Chaise; garnie");
    expect(fichier.lignes[1].valeurs.Label1).toBe("Simple");
  });

  it("compte les lignes sans aucune valeur sans les confondre avec des rejets", () => {
    const fichier = analyserCsv("Oid;Code;Label1\n1;A;Chaise\n;;;\n2;B;Table\n");

    expect(fichier.lignes).toHaveLength(2);
    expect(fichier.lignesIgnorees).toBe(1);
  });

  it("retire le BOM et detecte l'encodage", () => {
    const fichier = analyserCsv("﻿Oid;Label1\n1;Chaise");
    expect(fichier.entetes).toEqual(["Oid", "Label1"]);

    expect(detecterEncodage(Buffer.from("Châssis", "utf8"))).toBe("utf8");
    expect(detecterEncodage(Buffer.from("Châssis", "latin1"))).toBe("latin1");
  });

  it("signale les colonnes obligatoires manquantes", () => {
    const fichier = analyserCsv("Oid;Label1\n1;Chaise");

    const manquante = verifierColonnes(fichier, ["Oid", "Code", "Label1"], ["Oid", "Code"]);
    expect(manquante.conforme).toBe(false);
    expect(manquante.colonnesManquantes).toContain("Code");
    expect(manquante.colonnesPresentes).toEqual(["Oid", "Label1"]);
    expect(manquante.colonnesInconnues).toEqual([]);

    // « conforme » ne depend que des colonnes obligatoires : une colonne
    // attendue mais facultative peut manquer sans bloquer l'import.
    const facultative = verifierColonnes(fichier, ["Oid", "Code", "Label1"], ["Oid", "Label1"]);
    expect(facultative.conforme).toBe(true);
    expect(facultative.colonnesManquantes).toContain("Code");

    // Une colonne obligatoire absente du fichier bloque, meme si elle n'est pas
    // listee parmi les colonnes attendues.
    const inconnue = verifierColonnes(fichier, ["Oid", "Label1"], ["Oid", "NumeroPiece"]);
    expect(inconnue.conforme).toBe(false);
    expect(inconnue.colonnesManquantes).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// Familles d'articles
// -----------------------------------------------------------------------------

describe("Import des familles d'articles", () => {
  it("cree les familles en conservant la hierarchie et la cle source", async () => {
    const resultat = retenir(await importerFamilles(contexte(CONTENU_FAMILLES, "COM_ItemFamily.csv")));

    expect(resultat.compteurs.inserees).toBe(2);
    expect(resultat.compteurs.rejetees).toBe(1);

    const famille = await prisma.itemFamily.findFirst({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: OID_FAMILLE },
    });
    expect(famille?.code).toBe(CODE_FAMILLE);
    expect(famille?.label).toBe("Famille de recette");

    const enfant = await prisma.itemFamily.findFirst({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: OID_FAMILLE_ENFANT },
    });
    // Le code source etant vide, la reference stable de la source est conservee.
    expect(enfant?.code).toBe(`FAM-${OID_FAMILLE_ENFANT}`);
    expect(enfant?.parentId).toBe(famille?.id);

    const job = await prisma.importJob.findUnique({ where: { id: resultat.jobId } });
    expect(job?.entityType).toBe("ITEM_FAMILY");
    expect(job?.rejectedRows).toBe(1);

    const rejet = await prisma.importErrorLog.findFirst({
      where: { jobId: resultat.jobId, action: "REJETE" },
    });
    expect(rejet?.message).toContain("Identifiant source");
  });

  it("est re-executable sans creer de doublon", async () => {
    const resultat = retenir(await importerFamilles(contexte(CONTENU_FAMILLES, "COM_ItemFamily.csv")));

    expect(resultat.compteurs.inserees).toBe(0);
    expect(resultat.compteurs.misesAJour).toBeGreaterThanOrEqual(2);

    const doublons = await prisma.itemFamily.count({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: OID_FAMILLE },
    });
    expect(doublons).toBe(1);
  });

  it("protege une fiche modifiee dans la plateforme", async () => {
    const famille = await prisma.itemFamily.findFirst({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: OID_FAMILLE },
      select: { id: true },
    });
    if (!famille) throw new Error("Famille de recette absente.");

    await prisma.itemFamily.update({
      where: { id: famille.id },
      data: { label: "Libelle corrige dans la plateforme" },
    });

    const protege = retenir(await importerFamilles(contexte(CONTENU_FAMILLES, "COM_ItemFamily.csv")));
    expect(protege.compteurs.protegees).toBeGreaterThanOrEqual(1);

    const inchangee = await prisma.itemFamily.findUnique({ where: { id: famille.id } });
    expect(inchangee?.label).toBe("Libelle corrige dans la plateforme");

    const trace = await prisma.importErrorLog.findFirst({
      where: { jobId: protege.jobId, action: "PROTEGE" },
    });
    expect(trace).not.toBeNull();

    // Avec l'autorisation explicite, la mise a jour est appliquee.
    const autorise = retenir(
      await importerFamilles(
        contexte(CONTENU_FAMILLES, "COM_ItemFamily.csv", { miseAJourAutorisee: true }),
      ),
    );
    expect(autorise.compteurs.misesAJour).toBeGreaterThanOrEqual(2);

    const restauree = await prisma.itemFamily.findUnique({ where: { id: famille.id } });
    expect(restauree?.label).toBe("Famille de recette");
  });

  it("ne supprime jamais une fiche absente du fichier source", async () => {
    retenir(await importerFamilles(contexte(CONTENU_FAMILLE_ISOLEE, "COM_ItemFamily.csv")));

    const ancienne = await prisma.itemFamily.findFirst({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: OID_FAMILLE },
    });
    const nouvelle = await prisma.itemFamily.findFirst({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: OID_FAMILLE_ISOLee },
    });

    expect(nouvelle?.isActive).toBe(true);
    expect(ancienne).not.toBeNull();
    expect(ancienne?.code).toBe(CODE_FAMILLE);
  });
});

// -----------------------------------------------------------------------------
// Articles et tiers
// -----------------------------------------------------------------------------

describe("Import des articles", () => {
  it("conserve les codes sources et ne devine aucun type inconnu", async () => {
    const resultat = retenir(await importerArticles(contexte(CONTENU_ARTICLES, "COM_Item.csv")));

    expect(resultat.compteurs.inserees).toBe(3);
    expect(resultat.compteurs.rejetees).toBe(0);

    const article = await prisma.item.findFirst({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: OID_ARTICLE },
    });
    expect(article?.code).toBe(CODE_ARTICLE);
    expect(article?.label1).toBe("Article parent de recette");
    expect(article?.status).toBe("ACTIF");

    const horsService = await prisma.item.findFirst({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: OID_ARTICLE_HS },
    });
    expect(horsService?.status).toBe("NON_COMMERCIALISABLE");

    // Le code de type est inconnu : une correspondance NON CONFIRMEE est creee
    // et l'avertissement est remonte, aucune valeur n'est inventee en silence.
    const correspondance = await prisma.importValueMapping.findUnique({
      where: {
        sourceEntity_sourceField_sourceValue: {
          sourceEntity: "ITEM",
          sourceField: "Type",
          sourceValue: TYPE_ARTICLE_INCONNU,
        },
      },
    });
    expect(correspondance?.isConfirmed).toBe(false);
    expect(
      resultat.avertissements.some((message) => message.includes("Correspondance a confirmer")),
    ).toBe(true);
  });
});

describe("Import des tiers", () => {
  it("distingue les natures et ne cree aucun compte employe", async () => {
    await definirCorrespondance(
      {
        sourceEntity: "THIRD_PARTY",
        sourceField: "Type",
        sourceValue: TYPE_TIERS_EMPLOYE,
        targetValue: "EMPLOYE",
        label: "Correspondance de recette",
      },
      acteur,
    );

    const comptesAvant = await prisma.user.count();
    const resultat = retenir(await importerTiers(contexte(CONTENU_TIERS, "COM_ThirdParty.csv")));

    expect(resultat.compteurs.inserees).toBe(2);

    const autre = await prisma.thirdParty.findFirst({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: OID_TIERS_AUTRE },
    });
    expect(autre?.type).toBe("AUTRE");
    expect(autre?.isClient).toBe(false);
    expect(autre?.isSupplier).toBe(false);
    expect(autre?.isEmployee).toBe(false);

    const employe = await prisma.thirdParty.findFirst({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: OID_TIERS_EMPLOYE },
    });
    expect(employe?.type).toBe("EMPLOYE");
    expect(employe?.isEmployee).toBe(true);
    expect(employe?.isClient).toBe(false);

    // Un tiers employe n'ouvre jamais de compte utilisateur automatiquement.
    expect(await prisma.user.count()).toBe(comptesAvant);
    expect(await prisma.user.findFirst({ where: { email: EMAIL_EMPLOYE } })).toBeNull();

    // Une nature inconnue reste « a confirmer » tant que l'administrateur n'a
    // pas tranche.
    const correspondance = await prisma.importValueMapping.findUnique({
      where: {
        sourceEntity_sourceField_sourceValue: {
          sourceEntity: "THIRD_PARTY",
          sourceField: "Type",
          sourceValue: TYPE_TIERS_INCONNU,
        },
      },
    });
    expect(correspondance?.isConfirmed).toBe(false);
  });

  it("applique la nature des que l'administrateur a confirme la correspondance", async () => {
    await definirCorrespondance(
      {
        sourceEntity: "THIRD_PARTY",
        sourceField: "Type",
        sourceValue: TYPE_TIERS_INCONNU,
        targetValue: "CLIENT",
        label: "Nature confirmee par l'administrateur",
      },
      acteur,
    );

    retenir(
      await importerTiers(
        contexte(CONTENU_TIERS, "COM_ThirdParty.csv", { miseAJourAutorisee: true }),
      ),
    );

    const tiers = await prisma.thirdParty.findFirst({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: OID_TIERS_AUTRE },
    });
    expect(tiers?.type).toBe("CLIENT");
    expect(tiers?.isClient).toBe(true);

    const correspondance = await prisma.importValueMapping.findUnique({
      where: {
        sourceEntity_sourceField_sourceValue: {
          sourceEntity: "THIRD_PARTY",
          sourceField: "Type",
          sourceValue: TYPE_TIERS_INCONNU,
        },
      },
    });
    expect(correspondance?.isConfirmed).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Nomenclatures
// -----------------------------------------------------------------------------

describe("Import des nomenclatures", () => {
  it("conserve les deux quantites contradictoires sans en choisir une", async () => {
    const resultat = await importerNomenclatures(
      contexte(CONTENU_FORMULES, "COM_Formula.csv"),
      contexte(CONTENU_BOM, "COM_BOM.csv"),
    );
    jobIds.push(resultat.jobId);

    expect(resultat.compteurs.rejetees).toBe(0);
    expect(resultat.compteurs.ignorees).toBe(1);
    expect(resultat.ecartsDetectes).toBeGreaterThanOrEqual(1);
    expect(
      resultat.avertissements.some((message) => message.includes("Contradiction de quantite")),
    ).toBe(true);

    const formule = await prisma.formula.findFirst({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: OID_FORMULE },
    });
    expect(formule?.code).toBe(CODE_FORMULE);
    // Une nomenclature importee n'est jamais activee d'office.
    expect(formule?.status).toBe("EN_VALIDATION");

    const lignes = await prisma.formulaLine.findMany({
      where: { formulaId: formule!.id },
      orderBy: { lineNo: "asc" },
    });
    expect(lignes).toHaveLength(2);
    expect(D.eq(lignes[0].quantity, D.of("2.5"))).toBe(true);
    expect(D.eq(lignes[1].quantity, D.of("3"))).toBe(true);

    const ecarts = await prisma.formulaVariance.findMany({ where: { formulaId: formule!.id } });
    expect(ecarts).toHaveLength(1);
    expect(ecarts[0].status).toBe("OUVERT");
    expect(ecarts[0].valueA).toContain("2.500000");
    expect(ecarts[0].valueB).toContain("3.000000");
    expect(ecarts[0].delta).toBe("0.500000");
  });

  it("ne recree pas d'ecart lors d'un nouvel import identique", async () => {
    const formule = await prisma.formula.findFirst({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: OID_FORMULE },
      select: { id: true },
    });
    if (!formule) throw new Error("Nomenclature de recette absente.");

    const resultat = await importerNomenclatures(
      contexte(CONTENU_FORMULES, "COM_Formula.csv"),
      contexte(CONTENU_BOM, "COM_BOM.csv"),
    );
    jobIds.push(resultat.jobId);

    expect(resultat.compteurs.inserees).toBe(0);
    expect(await prisma.formulaVariance.count({ where: { formulaId: formule.id } })).toBe(1);
    expect(await prisma.formulaLine.count({ where: { formulaId: formule.id } })).toBe(2);
  });

  it("refuse une ligne de composant sans quantite plutot que d'inventer une valeur", async () => {
    const contenuSansQuantite = csv(
      ["Oid", "Offset", "Parent", "Item", "Quantity"],
      [[BASE + 61, 1, OID_FORMULE, OID_COMPOSANT, ""]],
    );

    const resultat = await importerNomenclatures(
      contexte(CONTENU_FORMULES, "COM_Formula.csv"),
      contexte(contenuSansQuantite, "COM_BOM.csv"),
    );
    jobIds.push(resultat.jobId);

    expect(resultat.compteurs.rejetees).toBe(1);
    expect(resultat.compteurs.inserees).toBe(0);

    const rejet = await prisma.importErrorLog.findFirst({
      where: { jobId: resultat.jobId, action: "REJETE" },
    });
    expect(rejet?.message).toContain("Aucune valeur par defaut");
  });
});

// -----------------------------------------------------------------------------
// Stocks
// -----------------------------------------------------------------------------

describe("Import des lots et des stocks", () => {
  it("cree le stock par un mouvement trace, jamais par une ecriture directe", async () => {
    const resultat = await importerLotsEtStocks(contexte(CONTENU_LOTS, "COM_Batch.csv"), {
      depotParDefautId: depotId,
    });
    jobIds.push(resultat.jobId);

    expect(resultat.entreesCreees).toBe(1);
    expect(resultat.compteurs.rejetees).toBe(0);

    const article = await prisma.item.findFirst({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: OID_ARTICLE },
      select: { id: true },
    });
    if (!article) throw new Error("Article de recette absent.");

    const mouvement = await prisma.stockMovement.findFirst({
      where: { itemId: article.id, type: "ENTREE_INITIALE" },
    });
    expect(mouvement).not.toBeNull();
    expect(D.eq(mouvement!.quantity, D.of("12.5"))).toBe(true);

    const soldes = await prisma.stockBalance.findMany({
      where: { itemId: article.id },
      select: { quantityPhysical: true },
    });
    expect(soldes.length).toBeGreaterThan(0);
    expect(D.eq(D.sum(soldes.map((solde) => solde.quantityPhysical)), D.of("12.5"))).toBe(true);

    const lot = await prisma.stockLot.findFirst({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: OID_LOT },
    });
    expect(lot?.lotNumber).toBe(NUMERO_LOT);
  });

  it("enregistre l'ecart d'un nouvel import comme mouvement de correction", async () => {
    const contenuCorrige = csv(
      ["Oid", "SyncId", "Code", "BatchNum", "Item", "PhysicalQuantity", "VWAP"],
      [[OID_LOT, "S1", NUMERO_LOT, NUMERO_LOT, OID_ARTICLE, "10.000000", "150"]],
    );

    const resultat = await importerLotsEtStocks(contexte(contenuCorrige, "COM_Batch.csv"), {
      depotParDefautId: depotId,
    });
    jobIds.push(resultat.jobId);

    expect(resultat.correctionsAppliquees).toBe(1);

    const article = await prisma.item.findFirst({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: OID_ARTICLE },
      select: { id: true },
    });
    const correction = await prisma.stockMovement.findFirst({
      where: { itemId: article!.id, type: "CORRECTION_INVENTAIRE" },
    });
    expect(correction).not.toBeNull();
    expect(D.eq(correction!.quantity, D.of("-2.5"))).toBe(true);

    const soldes = await prisma.stockBalance.findMany({
      where: { itemId: article!.id },
      select: { quantityPhysical: true },
    });
    expect(D.eq(D.sum(soldes.map((solde) => solde.quantityPhysical)), D.of("10"))).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Simulation
// -----------------------------------------------------------------------------

describe("Simulation d'import", () => {
  it("produit un rapport complet sans conserver la moindre ecriture", async () => {
    const oidSimule = BASE + 900;
    const contenu = csv(
      ["Oid", "SyncId", "Code", "Label1", "Label2", "Parent", "Hierarchy", "AccountingCode"],
      [[oidSimule, "S1", `${JETON}-SIM`, "Famille simulee", "", "", "1", ""]],
    );

    const resultat = await simulerImport((db) =>
      importerFamilles({
        ...contexte(contenu, "COM_ItemFamily.csv", { simulation: true }),
        db,
      }),
    );

    // Le rapport est celui d'un import reel...
    expect(resultat.compteurs.inserees).toBe(1);

    // ...mais rien n'a ete conserve.
    expect(
      await prisma.itemFamily.findFirst({
        where: { sourceSystem: SYSTEME_SOURCE, sourceOid: oidSimule },
      }),
    ).toBeNull();
    expect(await prisma.importJob.findUnique({ where: { id: resultat.jobId } })).toBeNull();
  });
});
