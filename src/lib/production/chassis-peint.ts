/**
 * Resolution de l'article semi-fini « chassis peint » du transfert
 * inter-divisions ADMEDCO -> MOBILIX.
 *
 * Le transfert automatique de fin de poudrage a besoin d'un article unique pour
 * representer le chassis peint. Cet article ne doit jamais exister en double :
 * l'import des donnees sources (COM_Item.csv) peut deja contenir un chassis
 * peint, et creer un second article casserait la tracabilite du transfert.
 *
 * Ordre de resolution :
 *   1. la regle de transfert active (POUDRAGE) designe deja un article : c'est la
 *      decision enregistree, elle est prioritaire ;
 *   2. sinon un article porte exactement le code configure par l'administrateur
 *      (`CODE_SEMI_FINI_CHASSIS`, valeur initiale `SF-CHASSIS-PEINT`) ;
 *   3. sinon les donnees importees sont interrogees : un equivalent importe
 *      unique est adopte, aucun doublon n'est cree ;
 *   4. sinon l'article de reference est cree.
 *
 * Aucun choix n'est fait en silence : les equivalents importes qui n'ont pas ete
 * adoptes sont remontes (`candidats`, `ambigu`) pour confirmation par un
 * administrateur, et la divergence entre le code configure et l'article designe
 * par la regle est signalee (`divergence`). L'adoption d'un article est
 * journalisee dans l'audit.
 */

import { prisma, type Db } from "@/lib/db";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import { etatInvalide, nonTrouve } from "@/lib/errors";
import { CLE_PARAMETRE, lireParametreTexte } from "@/lib/settings";

/** Code logique utilise lorsque le parametre n'est pas renseigne. */
export const CODE_CHASSIS_PEINT_PAR_DEFAUT = "SF-CHASSIS-PEINT";

/** Operation dont la fin declenche le transfert du chassis peint. */
export const OPERATION_TRANSFERT_CHASSIS = "POUDRAGE";

/** Famille d'articles accueillant le semi-fini s'il doit etre cree. */
export const FAMILLE_SEMI_FINI = "FAM-SF";

export interface CandidatChassisPeint {
  id: number;
  code: string;
  label1: string;
  sourceSystem: string | null;
}

export type OrigineChassisPeint =
  /** La regle de transfert active designait deja cet article. */
  | "REGLE"
  /** Un article porte exactement le code configure. */
  | "EXISTANT"
  /** Un article importe equivalent a ete adopte : aucun doublon cree. */
  | "EQUIVALENT_IMPORTE"
  /** Aucune correspondance : l'article de reference a ete cree. */
  | "CREE";

export interface ResolutionChassisPeint {
  itemId: number;
  code: string;
  origine: OrigineChassisPeint;
  /** Vrai lorsqu'une decision humaine est necessaire (voir la documentation). */
  ambigu: boolean;
  /** Article de reference deja en place avant cette resolution, s'il existait. */
  articleReference: { id: number; code: string } | null;
  /** Equivalents importes non adoptes. */
  candidats: CandidatChassisPeint[];
}

/** Diagnostic en lecture seule, sans aucune ecriture ni creation d'article. */
export interface AnalyseChassisPeint {
  codeConfigure: string;
  article: { id: number; code: string; label1: string } | null;
  /** Article designe par la regle de transfert active, s'il existe encore. */
  articleRegle: { id: number; code: string } | null;
  regle: { id: number; code: string; producedItemId: number } | null;
  candidats: CandidatChassisPeint[];
  /** Le code configure et l'article de la regle ne designent pas le meme article. */
  divergence: boolean;
  /** Une confirmation par un administrateur est necessaire. */
  ambigu: boolean;
  /** Explication affichable a l'administrateur. */
  messages: string[];
}

export interface ActeurResolution {
  id: number | null;
  email: string | null;
}

const ACTEUR_SYSTEME: ActeurResolution = { id: null, email: null };

type ArticleCompact = { id: number; code: string; label1: string; sourceSystem: string | null };

/** Lit le code logique du semi-fini configure par l'administrateur. */
export async function codeChassisPeintConfigure(db: Db = prisma): Promise<string> {
  const parametre = await lireParametreTexte(
    CLE_PARAMETRE.CODE_SEMI_FINI_CHASSIS,
    CODE_CHASSIS_PEINT_PAR_DEFAUT,
    db,
  );
  return parametre.trim() || CODE_CHASSIS_PEINT_PAR_DEFAUT;
}

/** Regle de transfert qui declenche la mise a disposition du chassis peint. */
export async function regleTransfertChassis(db: Db = prisma) {
  return db.divisionTransferRule.findFirst({
    where: { triggerOperationCode: OPERATION_TRANSFERT_CHASSIS, isActive: true },
    select: { id: true, code: true, producedItemId: true, isActive: true },
    orderBy: { id: "asc" },
  });
}

/**
 * Articles importes pouvant tenir le role de chassis peint : le code ou le
 * libelle mentionne a la fois « chassis » et « peint ».
 */
export async function rechercherEquivalentsImportes(
  db: Db,
  exclureId?: number | null,
): Promise<CandidatChassisPeint[]> {
  const mention = (mot: string) => ({
    OR: [
      { code: { contains: mot, mode: "insensitive" as const } },
      { label1: { contains: mot, mode: "insensitive" as const } },
      { designation: { contains: mot, mode: "insensitive" as const } },
    ],
  });

  return db.item.findMany({
    where: {
      sourceOid: { not: null },
      status: { not: "ARCHIVE" },
      isOutOfService: false,
      ...(exclureId ? { id: { not: exclureId } } : {}),
      AND: [mention("chassis"), mention("peint")],
    },
    select: { id: true, code: true, label1: true, sourceSystem: true },
    orderBy: [{ code: "asc" }],
    take: 25,
  });
}

async function chargerArticle(
  db: Db,
  where: { id?: number; code?: string },
): Promise<ArticleCompact | null> {
  const article = await db.item.findFirst({
    where: { ...where, status: { not: "ARCHIVE" } },
    select: { id: true, code: true, label1: true, sourceSystem: true },
  });
  return article ?? null;
}

/**
 * Diagnostic complet, en lecture seule : aucun article n'est cree, aucune
 * regle n'est modifiee. Utilise par l'import pour signaler une correspondance a
 * confirmer sans jamais creer de donnee absente du fichier source.
 */
export async function analyserArticleChassisPeint(
  db: Db = prisma,
): Promise<AnalyseChassisPeint> {
  const codeConfigure = await codeChassisPeintConfigure(db);
  const regle = await regleTransfertChassis(db);

  const articleRegle = regle ? await chargerArticle(db, { id: regle.producedItemId }) : null;
  const articleCode = await chargerArticle(db, { code: codeConfigure });
  const article = articleRegle ?? articleCode;

  const candidats = await rechercherEquivalentsImportes(db, article?.id ?? null);
  const divergence = Boolean(articleRegle && articleCode && articleRegle.id !== articleCode.id);

  const messages: string[] = [];
  if (divergence && articleRegle && articleCode) {
    messages.push(
      `Le code configure (${articleCode.code}) et l'article designe par la regle de transfert (${articleRegle.code}) sont differents : la correspondance doit etre confirmee avant tout transfert.`,
    );
  }
  if (candidats.length > 1) {
    messages.push(
      `${candidats.length} articles importes peuvent tenir le role de chassis peint (${candidats
        .map((candidat) => candidat.code)
        .join(", ")}) : aucune adoption automatique, la correspondance doit etre confirmee.`,
    );
  } else if (candidats.length === 1 && article && candidats[0]!.id !== article.id) {
    messages.push(
      `L'article importe ${candidats[0]!.code} peut tenir le role de chassis peint : le transfert utilise actuellement ${article.code}. Confirmez la correspondance si necessaire.`,
    );
  }

  return {
    codeConfigure,
    article: article ? { id: article.id, code: article.code, label1: article.label1 } : null,
    articleRegle: articleRegle ? { id: articleRegle.id, code: articleRegle.code } : null,
    regle: regle ? { id: regle.id, code: regle.code, producedItemId: regle.producedItemId } : null,
    candidats,
    divergence,
    ambigu: divergence || candidats.length > 0,
    messages,
  };
}

/** Cree l'article semi-fini de reference lorsque rien ne convient. */
async function creerArticleChassisPeint(db: Db, code: string): Promise<ArticleCompact> {
  const famille = await db.itemFamily.findUnique({
    where: { code: FAMILLE_SEMI_FINI },
    select: { id: true },
  });

  return db.item.create({
    data: {
      code,
      label1: "Chassis peint (semi-fini inter-divisions)",
      designation:
        "Chassis metallique peint issu du poudrage ADMEDCO, transfere vers MOBILIX pour capitonnage.",
      type: "SEMI_FINI",
      factory: "COMMUN",
      status: "ACTIF",
      familyId: famille?.id ?? null,
      unitCode: "PCS",
      isProducible: true,
      isSemiFinished: true,
    },
    select: { id: true, code: true, label1: true, sourceSystem: true },
  });
}

/**
 * Repointe les regles de transfert de poudrage sur l'article retenu.
 * Chaque changement est journalise : aucune reaffectation n'est silencieuse.
 */
export async function synchroniserRegleTransfertChassis(
  db: Db = prisma,
  itemId: number,
  acteur: ActeurResolution = ACTEUR_SYSTEME,
): Promise<number> {
  const regles = await db.divisionTransferRule.findMany({
    where: {
      triggerOperationCode: OPERATION_TRANSFERT_CHASSIS,
      producedItemId: { not: itemId },
    },
    select: { id: true, code: true, producedItemId: true },
  });
  if (regles.length === 0) return 0;

  const cible = await db.item.findUnique({
    where: { id: itemId },
    select: { id: true, code: true },
  });
  if (!cible) throw nonTrouve("Article semi-fini introuvable.");

  for (const regle of regles) {
    await db.divisionTransferRule.update({
      where: { id: regle.id },
      data: { producedItemId: itemId },
    });
    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.MODIFICATION,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "DivisionTransferRule",
        entityId: regle.id,
        userId: acteur.id,
        userEmail: acteur.email,
        oldValue: { producedItemId: regle.producedItemId },
        newValue: { producedItemId: itemId, code: cible.code },
        comment: `Article semi-fini du transfert inter-divisions reaffecte a ${cible.code}.`,
      },
      db,
    );
  }

  return regles.length;
}

/**
 * Determine l'article semi-fini « chassis peint », en recherchant d'abord un
 * article equivalent deja importe : aucun doublon n'est cree.
 */
export async function resoudreArticleChassisPeint(
  db: Db = prisma,
  acteur: ActeurResolution = ACTEUR_SYSTEME,
): Promise<ResolutionChassisPeint> {
  const analyse = await analyserArticleChassisPeint(db);

  if (analyse.article) {
    const origine: OrigineChassisPeint =
      analyse.articleRegle?.id === analyse.article.id ? "REGLE" : "EXISTANT";
    return {
      itemId: analyse.article.id,
      code: analyse.article.code,
      origine,
      ambigu: analyse.divergence || analyse.candidats.length > 0,
      articleReference: { id: analyse.article.id, code: analyse.article.code },
      candidats: analyse.candidats,
    };
  }

  // Un seul equivalent importe : il est adopte, aucun article n'est cree.
  if (analyse.candidats.length === 1) {
    const retenu = analyse.candidats[0]!;
    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.IMPORT,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "Item",
        entityId: retenu.id,
        userId: acteur.id,
        userEmail: acteur.email,
        newValue: {
          codeConfigure: analyse.codeConfigure,
          articleAdopte: retenu.code,
          origine: "EQUIVALENT_IMPORTE",
        },
        comment: `Le semi-fini « chassis peint » est rattache a l'article importe ${retenu.code} : aucun doublon n'est cree.`,
      },
      db,
    );

    return {
      itemId: retenu.id,
      code: retenu.code,
      origine: "EQUIVALENT_IMPORTE",
      ambigu: false,
      articleReference: null,
      candidats: analyse.candidats,
    };
  }

  const cree = await creerArticleChassisPeint(db, analyse.codeConfigure);

  await enregistrerAudit(
    {
      action: ACTIONS_AUDIT.CREATION,
      module: MODULES_AUDIT.PRODUCTION,
      entity: "Item",
      entityId: cree.id,
      userId: acteur.id,
      userEmail: acteur.email,
      newValue: {
        code: cree.code,
        origine: "CREE",
        candidats: analyse.candidats.map((candidat) => candidat.code),
      },
      comment:
        analyse.candidats.length > 1
          ? `Article semi-fini « chassis peint » cree. ${analyse.candidats.length} articles importes pouvaient convenir : la correspondance doit etre confirmee par un administrateur.`
          : "Article semi-fini « chassis peint » cree : aucune correspondance importee.",
    },
    db,
  );

  return {
    itemId: cree.id,
    code: cree.code,
    origine: "CREE",
    ambigu: analyse.candidats.length > 1,
    articleReference: null,
    candidats: analyse.candidats,
  };
}

/**
 * Resolution complete utilisee au demarrage : l'article est determine puis la
 * regle de transfert est alignee uniquement lorsqu'un article vient d'etre
 * adopte ou cree (une decision deja enregistree n'est jamais ecrasee).
 */
export async function assurerChassisPeint(
  db: Db = prisma,
  acteur: ActeurResolution = ACTEUR_SYSTEME,
): Promise<ResolutionChassisPeint> {
  const resolution = await resoudreArticleChassisPeint(db, acteur);
  if (resolution.origine === "CREE" || resolution.origine === "EQUIVALENT_IMPORTE") {
    await synchroniserRegleTransfertChassis(db, resolution.itemId, acteur);
  }
  return resolution;
}

/**
 * Decision d'un administrateur : le transfert de fin de poudrage utilise
 * desormais l'article choisi. L'ancien article n'est ni supprime ni modifie.
 */
export async function adopterArticleChassisPeint(
  db: Db = prisma,
  itemId: number,
  acteur: ActeurResolution = ACTEUR_SYSTEME,
): Promise<{ itemId: number; code: string; reglesMisesAJour: number }> {
  const article = await db.item.findUnique({
    where: { id: itemId },
    select: { id: true, code: true, status: true },
  });
  if (!article) throw nonTrouve("Article introuvable.");
  if (article.status === "ARCHIVE") {
    throw etatInvalide(
      `L'article ${article.code} est archive : il ne peut pas devenir le semi-fini du transfert inter-divisions.`,
    );
  }

  const reglesMisesAJour = await synchroniserRegleTransfertChassis(db, article.id, acteur);
  return { itemId: article.id, code: article.code, reglesMisesAJour };
}
