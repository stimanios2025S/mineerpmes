import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { ImportEntityType, ItemStatus, ItemType, Prisma } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D, type Decimal } from "@/lib/decimal";
import { validation } from "@/lib/errors";
import { prochainNumero, SEQUENCES } from "@/lib/numbering";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import { analyserArticleChassisPeint } from "@/lib/production/chassis-peint";
import {
  enregistrerMouvement,
  reserverStock,
  changerStatutStock,
  type ActeurStock,
} from "@/lib/stock/service";
import {
  analyserCsv,
  booleen,
  date,
  decimal,
  entier,
  lireFichierCsv,
  texte,
  verifierColonnes,
  type FichierCsv,
  type LigneCsv,
  type RapportColonnes,
} from "./csv";

/**
 * Import des donnees reelles de l'ancien ERP (Silwane / WinDev).
 *
 * Principes non negociables :
 *   - aucune donnee existante n'est supprimee parce qu'une ligne disparait du
 *     fichier source : les fiches absentes sont signalees, jamais effacees ;
 *   - une fiche modifiee dans la plateforme apres un import n'est jamais
 *     ecrasee : elle est protegee et listee dans le rapport ;
 *   - un code source inconnu (type d'article, type de tiers, statut de lot)
 *     n'est jamais interprete en silence : la valeur brute est conservee, une
 *     correspondance non confirmee est creee, et le rapport le signale ;
 *   - l'import est re-executable : la cle stable (sourceSystem + sourceOid)
 *     garantit l'absence de doublon ; les ecarts de stock produisent un
 *     mouvement de correction trace, jamais une ecriture directe.
 */

export const SYSTEME_SOURCE = "SILWANE";

export const FICHIERS_SOURCE = {
  ITEM_FAMILY: "COM_ItemFamily.csv",
  ITEM: "COM_Item.csv",
  FORMULA: "COM_Formula.csv",
  FORMULA_LINE: "COM_BOM.csv",
  FORMULA_CHARGE: "COM_FormulaCharge.csv",
  FORMULA_EMPLOYEE: "COM_FormulaEmpoyees.csv",
  FORMULA_MACHINE: "COM_FormulaMachine.csv",
  BATCH: "COM_Batch.csv",
  THIRD_PARTY: "COM_ThirdParty.csv",
} as const;

// -----------------------------------------------------------------------------
// Infrastructure de suivi d'import
// -----------------------------------------------------------------------------

export interface ContexteImport {
  acteur: ActeurStock;
  fichier: FichierCsv;
  nomFichier: string;
  /** Autorise la mise a jour des fiches deja importees et non modifiees localement. */
  miseAJourAutorisee?: boolean;
  /**
   * Analyse seule : le travail est execute puis annule, aucune ecriture n'est
   * conservee. Voir `simulerImport` : la transaction doit etre fournie par
   * l'appelant via `db`.
   */
  simulation?: boolean;
  /** Transaction en cours, fournie par `simulerImport` pendant une simulation. */
  db?: Db;
}

export interface CompteursImport {
  lues: number;
  inserees: number;
  misesAJour: number;
  ignorees: number;
  protegees: number;
  rejetees: number;
}

export interface ResultatImport {
  jobId: number;
  fichier: string;
  entite: ImportEntityType;
  compteurs: CompteursImport;
  colonnes: RapportColonnes | null;
  avertissements: string[];
  messages: string[];
  dureeMs: number;
}

function compteursVides(): CompteursImport {
  return {
    lues: 0,
    inserees: 0,
    misesAJour: 0,
    ignorees: 0,
    protegees: 0,
    rejetees: 0,
  };
}

/** Duree maximale d'une simulation : un import complet dans une transaction. */
const SIMULATION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Execute une unite de travail d'import.
 *
 * Hors simulation, chaque ligne est ecrite dans sa propre transaction : une
 * ligne refusee ne remet pas en cause les lignes deja validees. Pendant une
 * simulation, le client recu est deja une transaction : le travail y est
 * execute directement et sera annule avec elle.
 */
async function enTransaction<T>(
  db: Db,
  travail: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { timeout?: number } = {},
): Promise<T> {
  if (db === prisma) {
    return prisma.$transaction(travail, options);
  }
  return travail(db as Prisma.TransactionClient);
}

/**
 * Execute un import complet en simulation.
 *
 * Tout le travail est reellement effectue — lectures, controles, compteurs et
 * rapport — puis la transaction est annulee. Aucune fiche, aucun mouvement de
 * stock et aucune ligne de journal ne subsiste : le rapport remonte est celui
 * qu'un import reel produirait, sans aucune ecriture conservee.
 */
export async function simulerImport<T>(
  travail: (db: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const marqueur = new Error("SIMULATION_ANNULEE");
  let resultat: T | undefined;

  try {
    await prisma.$transaction(
      async (tx) => {
        resultat = await travail(tx);
        throw marqueur;
      },
      { timeout: SIMULATION_TIMEOUT_MS, maxWait: 60_000 },
    );
  } catch (erreur) {
    if (erreur !== marqueur) throw erreur;
  }

  if (resultat === undefined) {
    throw new Error("La simulation n'a produit aucun rapport.");
  }

  return resultat;
}

class SuiviImport {
  readonly compteurs = compteursVides();
  readonly avertissements: string[] = [];
  private readonly erreurs: {
    rowNumber: number;
    message: string;
    field?: string;
    rawLine?: string;
    sourceOid?: number;
    action: "INSERE" | "MIS_A_JOUR" | "IGNORE" | "PROTEGE" | "REJETE";
  }[] = [];

  constructor(
    readonly jobId: number,
    readonly entite: ImportEntityType,
  ) {}

  avertir(message: string) {
    if (!this.avertissements.includes(message)) this.avertissements.push(message);
  }

  rejeter(ligne: LigneCsv, message: string, champ?: string) {
    this.compteurs.rejetees += 1;
    this.erreurs.push({
      rowNumber: ligne.numero,
      message,
      field: champ,
      rawLine: ligne.brut.slice(0, 1000),
      sourceOid: entier(ligne.valeurs.Oid) ?? undefined,
      action: "REJETE",
    });
  }

  /**
   * Ligne source sans matiere a importer : elle est comptee separement des
   * rejets. Un rejet signale une donnee refusee ; une ligne ignoree signale
   * qu'il n'y avait rien a importer. Confondre les deux ferait croire a des
   * pertes de donnees.
   */
  ignorer(ligne: LigneCsv, message: string, champ?: string) {
    this.compteurs.ignorees += 1;
    this.erreurs.push({
      rowNumber: ligne.numero,
      message,
      field: champ,
      rawLine: ligne.brut.slice(0, 1000),
      sourceOid: entier(ligne.valeurs.Oid) ?? undefined,
      action: "IGNORE",
    });
  }

  journaliser(
    ligne: LigneCsv,
    message: string,
    action: "INSERE" | "MIS_A_JOUR" | "IGNORE" | "PROTEGE",
    champ?: string,
  ) {
    this.erreurs.push({
      rowNumber: ligne.numero,
      message,
      field: champ,
      rawLine: touteLaLigne(ligne),
      sourceOid: entier(ligne.valeurs.Oid) ?? undefined,
      action,
    });
  }

  async ecrireErreurs(db: Db = prisma) {
    if (this.erreurs.length === 0) return;
    const lots = 500;
    for (let index = 0; index < this.erreurs.length; index += lots) {
      await db.importErrorLog.createMany({
        data: this.erreurs.slice(index, index + lots).map((erreur) => ({
          jobId: this.jobId,
          rowNumber: erreur.rowNumber,
          entityType: this.entite,
          sourceOid: erreur.sourceOid ?? null,
          message: erreur.message,
          field: erreur.field ?? null,
          rawLine: erreur.rawLine ?? null,
          action: erreur.action,
        })),
      });
    }
  }
}

function touteLaLigne(ligne: LigneCsv): string {
  return ligne.brut.slice(0, 1000);
}

async function ouvrirJob(
  db: Db,
  entite: ImportEntityType,
  nomFichier: string,
  acteur: ActeurStock,
  options: Prisma.InputJsonValue,
  totalRows: number,
): Promise<number> {
  const job = await db.importJob.create({
    data: {
      fileName: nomFichier,
      entityType: entite,
      status: "EN_COURS",
      totalRows,
      userId: acteur.id,
      options,
    },
  });
  return job.id;
}

async function cloturerJob(
  db: Db,
  jobId: number,
  suivi: SuiviImport,
  debut: number,
  erreur?: unknown,
) {
  const statut =
    erreur !== undefined
      ? "ECHEC"
      : suivi.compteurs.rejetees > 0 || suivi.compteurs.protegees > 0
        ? "PARTIEL"
        : "TERMINE";

  await db.importJob.update({
    where: { id: jobId },
    data: {
      status: statut,
      insertedRows: suivi.compteurs.inserees,
      updatedRows: suivi.compteurs.misesAJour,
      skippedRows: suivi.compteurs.ignorees,
      protectedRows: suivi.compteurs.protegees,
      rejectedRows: suivi.compteurs.rejetees,
      finishedAt: new Date(),
      durationMs: Date.now() - debut,
      summary: {
        lues: suivi.compteurs.lues,
        avertissements: suivi.avertissements,
      },
      errorMessage:
        erreur === undefined
          ? null
          : erreur instanceof Error
            ? erreur.message
            : String(erreur),
    },
  });

  await suivi.ecrireErreurs();
}

/**
 * Conserve la ligne source brute et sert de reference temporelle pour detecter
 * une modification faite dans la plateforme apres l'import.
 */
async function enregistrerInstantane(
  tx: Db,
  entite: ImportEntityType,
  ligne: LigneCsv,
  jobId: number,
  nomFichier: string,
) {
  const sourceOid = entier(ligne.valeurs.Oid);
  if (sourceOid === null) return;

  await tx.importRowSnapshot.upsert({
    where: {
      sourceSystem_sourceEntity_sourceOid: {
        sourceSystem: SYSTEME_SOURCE,
        sourceEntity: entite,
        sourceOid,
      },
    },
    create: {
      sourceSystem: SYSTEME_SOURCE,
      sourceEntity: entite,
      sourceOid,
      sourceSyncId: texte(ligne.valeurs.SyncId),
      fileName: nomFichier,
      jobId,
      payload: ligne.valeurs as Prisma.InputJsonValue,
    },
    update: {
      sourceSyncId: texte(ligne.valeurs.SyncId),
      fileName: nomFichier,
      jobId,
      payload: ligne.valeurs as Prisma.InputJsonValue,
    },
  });
}

async function lireInstantane(
  db: Db,
  entite: ImportEntityType,
  sourceOid: number,
) {
  return db.importRowSnapshot.findUnique({
    where: {
      sourceSystem_sourceEntity_sourceOid: {
        sourceSystem: SYSTEME_SOURCE,
        sourceEntity: entite,
        sourceOid,
      },
    },
  });
}

// -----------------------------------------------------------------------------
// Correspondances de valeurs configurables
// -----------------------------------------------------------------------------

/**
 * Resout un code source vers une valeur de la plateforme.
 * Si aucune correspondance confirmee n'existe, la valeur de repli est utilisee,
 * une correspondance NON CONFIRMEE est creee et l'avertissement est remonte.
 * Aucune interpretation silencieuse n'a lieu.
 */
async function resoudreCorrespondance(
  tx: Db,
  entite: string,
  champ: string,
  valeurSource: string,
  repli: string,
  suivi: SuiviImport,
): Promise<string> {
  const existante = await tx.importValueMapping.findUnique({
    where: {
      sourceEntity_sourceField_sourceValue: {
        sourceEntity: entite,
        sourceField: champ,
        sourceValue: valeurSource,
      },
    },
  });

  if (existante?.isConfirmed) return existante.targetValue;

  if (!existante) {
    await tx.importValueMapping.create({
      data: {
        sourceEntity: entite,
        sourceField: champ,
        sourceValue: valeurSource,
        targetValue: repli,
        isConfirmed: false,
        label: `Correspondance a confirmer (${entite}.${champ} = ${valeurSource})`,
        comment:
          "Creee automatiquement pendant l'import. Tant qu'elle n'est pas confirmee par un administrateur, la valeur de repli est appliquee et chaque ligne concernee est signalee.",
      },
    });
  }

  suivi.avertir(
    `Correspondance a confirmer : ${entite}.${champ} = « ${valeurSource} » est importe comme « ${repli} ». Validez la correspondance dans Administration > Import.`,
  );

  return repli;
}

// -----------------------------------------------------------------------------
// Familles d'articles (COM_ItemFamily.csv)
// -----------------------------------------------------------------------------

const COLONNES_FAMILLE = ["Oid", "SyncId", "Code", "Label1", "Label2", "Parent", "Hierarchy", "AccountingCode"];

export async function importerFamilles(
  contexte: ContexteImport,
): Promise<ResultatImport> {
  const debut = Date.now();
  const colonnes = verifierColonnes(contexte.fichier, COLONNES_FAMILLE, ["Oid", "Label1"]);
  if (!colonnes.conforme) {
    throw validation(
      "Le fichier des familles d'articles ne contient pas les colonnes obligatoires (Oid, Label1).",
    );
  }

  const db = contexte.db ?? prisma;

  const jobId = await ouvrirJob(
    db,
    "ITEM_FAMILY",
    contexte.nomFichier,
    contexte.acteur,
    { simulation: contexte.simulation ?? false },
    contexte.fichier.lignes.length,
  );
  const suivi = new SuiviImport(jobId, "ITEM_FAMILY");
  const messages: string[] = [];

  try {
    // Premier passage : les familles racines, pour respecter la hierarchie.
    const parOid = new Map<number, LigneCsv>();
    for (const ligne of contexte.fichier.lignes) {
      const oid = entier(ligne.valeurs.Oid);
      if (oid === null) {
        suivi.rejeter(ligne, "Identifiant source (Oid) absent ou invalide.", "Oid");
        continue;
      }
      parOid.set(oid, ligne);
    }

    const idsParOid = new Map<number, number>();
    const restantes = new Set(parOid.keys());
    let progression = true;

    while (restantes.size > 0 && progression) {
      progression = false;

      for (const oid of Array.from(restantes)) {
        const ligne = parOid.get(oid)!;
        suivi.compteurs.lues += 1;

        const parentOid = entier(ligne.valeurs.Parent);
        if (parentOid !== null && parentOid > 0 && restantes.has(parentOid)) {
          continue;
        }

        const resultat = await enTransaction(
          db,
          async (tx) => {
            const label = texte(ligne.valeurs.Label1) ?? texte(ligne.valeurs.Label2);
            if (!label) {
              suivi.rejeter(ligne, "Famille sans libelle : ligne ignoree.", "Label1");
              return null;
            }

            // Les codes sources sont souvent vides : on conserve alors la
            // reference stable de la source dans le champ dedie.
            const codeSource = texte(ligne.valeurs.Code);
            const codeExistant = await tx.itemFamily.findFirst({
              where: { sourceSystem: SYSTEME_SOURCE, sourceOid: oid },
            });
            const code =
              codeSource ??
              codeExistant?.code ??
              `FAM-${oid}`;

            const parentId =
              parentOid !== null && parentOid > 0
                ? (idsParOid.get(parentOid) ?? null)
                : null;

            const donnees = {
              code,
              label,
              label2: texte(ligne.valeurs.Label2),
              parentId,
              hierarchy: texte(ligne.valeurs.Hierarchy),
              accountingCode: texte(ligne.valeurs.AccountingCode),
              isActive: true,
              sourceSystem: SYSTEME_SOURCE,
              sourceOid: oid,
              sourceSyncId: texte(ligne.valeurs.SyncId),
            };

            const existante = codeExistant;

            if (!existante) {
              const creee = await tx.itemFamily.create({ data: donnees });
              suivi.compteurs.inserees += 1;
              await enregistrerInstantane(tx, "ITEM_FAMILY", ligne, jobId, contexte.nomFichier);
              return creee.id;
            }

            const instantane = await lireInstantane(tx, "ITEM_FAMILY", oid);
            const modifieeLocalement =
              instantane && existante.updatedAt.getTime() > instantane.updatedAt.getTime();

            if (modifieeLocalement && !contexte.miseAJourAutorisee) {
              suivi.compteurs.protegees += 1;
              suivi.journaliser(
                ligne,
                `Famille « ${existante.code} » modifiee dans la plateforme apres le dernier import : mise a jour refusee.`,
                "PROTEGE",
              );
              return existante.id;
            }

            await tx.itemFamily.update({ where: { id: existante.id }, data: donnees });
            suivi.compteurs.misesAJour += 1;
            await enregistrerInstantane(tx, "ITEM_FAMILY", ligne, jobId, contexte.nomFichier);
            return existante.id;
          },
          { timeout: 30_000 },
        );

        if (resultat !== null) idsParOid.set(oid, resultat);
        restantes.delete(oid);
        progression = true;
      }

      if (!progression && restantes.size > 0) {
        for (const oid of restantes) {
          const ligne = parOid.get(oid)!;
          suivi.rejeter(
            ligne,
            "Hierarchie de familles circulaire ou parent inconnu : ligne rejetee.",
            "Parent",
          );
        }
        restantes.clear();
      }
    }

    if (contexte.simulation) {
      messages.push("Simulation : aucune ecriture n'a ete conservee en base.");
    }
  } catch (erreur) {
    await cloturerJob(db, jobId, suivi, debut, erreur);
    throw erreur;
  }

  await cloturerJob(db, jobId, suivi, debut);

  return {
    jobId,
    fichier: contexte.nomFichier,
    entite: "ITEM_FAMILY",
    compteurs: suivi.compteurs,
    colonnes,
    avertissements: suivi.avertissements,
    messages,
    dureeMs: Date.now() - debut,
  };
}

// -----------------------------------------------------------------------------
// Articles (COM_Item.csv)
// -----------------------------------------------------------------------------

const COLONNES_ARTICLE = [
  "Oid", "SyncId", "Code", "Barcode", "Reference", "Label1", "Label2", "Label3",
  "Type", "VAT", "IsBatchManaged", "IsPerishable", "Family", "AccountingCode",
  "Brand", "Remark", "Note", "VWAP", "VWAPphysical", "Quantity", "QuantityMin",
  "QuantityMin2", "QuantityMax", "QuantityMax2", "IsOutOfService",
  "UseNegativeStock", "UnitValue", "UnitWeight", "IsRawMaterial", "UnitOfMeasure",
  "IsBOM", "IsComposableOnly", "LPP", "MinSP", "MaxSP",
  "Location", "Width", "Height", "Length", "Thickness", "DefaultFormula",
  "IsSemiFinished", "StockAccount", "ProductionAccount", "ConsumptionAccount",
  "DefaultPacking", "Image", "LastModificationDate",
];

/** Repli lorsque le code de type source n'est pas encore confirme. */
const TYPE_ARTICLE_REPLI: ItemType = "COMPOSANT";

/**
 * Indicateurs commerciaux et industriels d'un article, derives des colonnes
 * explicites du fichier source.
 *
 * L'import ne devine rien : chaque indicateur provient d'une colonne nommee du
 * fichier, ou reste a faux. Ces indicateurs conditionnent l'apparition de
 * l'article dans les achats (achetable), les ventes (vendable) et les ordres de
 * fabrication (fabricable) :
 *
 *   - `IsRawMaterial` ..... l'article est une matiere premiere -> achetable ;
 *   - `IsComposableOnly` .. l'article n'est utilise que comme composant d'une
 *                           nomenclature, il est donc procure -> achetable ;
 *   - `IsBOM` ............. l'article est assemble a partir d'une nomenclature
 *                           -> fabricable ;
 *   - prix de vente ....... `LPP`, `MinSP` ou `MaxSP` renseigne -> vendable ;
 *   - un article hors service n'est jamais vendable.
 *
 * Ces regles sont deterministes : relancer l'import donne exactement les memes
 * indicateurs, et l'administrateur peut les ajuster article par article.
 */
/**
 * Reconnait un article de main d'oeuvre : son code commence par « MD » ou son
 * libelle contient « MAIN D'OEUVRE ». La main d'oeuvre n'est pas un article de
 * stock : elle se valorise dans le cout, elle ne se consomme pas d'un depot.
 */
function estMainOeuvre(ligne: LigneCsv): boolean {
  const code = texte(ligne.valeurs.Code) ?? "";
  const label = texte(ligne.valeurs.Label1) ?? "";
  return /^MD\d/i.test(code) || /MAIN D.OEUVRE/i.test(label);
}

function indicateursArticle(ligne: LigneCsv): {
  isPurchasable: boolean;
  isSellable: boolean;
  isProducible: boolean;
  isMainOeuvre: boolean;
} {
  const horsService = booleen(ligne.valeurs.IsOutOfService);
  const matierePremiere = booleen(ligne.valeurs.IsRawMaterial);
  const composantSeul = booleen(ligne.valeurs.IsComposableOnly);
  const assemble = booleen(ligne.valeurs.IsBOM);
  const mainOeuvre = estMainOeuvre(ligne);
  const prixVente =
    D.gt(decimal(ligne.valeurs.LPP), 0) ||
    D.gt(decimal(ligne.valeurs.MinSP), 0) ||
    D.gt(decimal(ligne.valeurs.MaxSP), 0);

  return {
    // La main d'oeuvre se valorise, mais ne s'achete pas, ne se vend pas et ne
    // se fabrique pas : elle ne doit jamais entrer dans un flux de stock.
    isPurchasable: mainOeuvre ? false : matierePremiere || composantSeul,
    isSellable: mainOeuvre ? false : prixVente && !horsService,
    isProducible: mainOeuvre ? false : assemble,
    isMainOeuvre: mainOeuvre,
  };
}
function statutArticle(ligne: LigneCsv): ItemStatus {
  if (booleen(ligne.valeurs.IsOutOfService)) return "NON_COMMERCIALISABLE";
  return "ACTIF";
}

export async function importerArticles(
  contexte: ContexteImport,
): Promise<ResultatImport> {
  const debut = Date.now();
  const colonnes = verifierColonnes(contexte.fichier, COLONNES_ARTICLE, ["Oid", "Code", "Label1"]);
  if (!colonnes.conforme) {
    throw validation(
      "Le fichier des articles ne contient pas les colonnes obligatoires (Oid, Code, Label1).",
    );
  }

  const db = contexte.db ?? prisma;

  const jobId = await ouvrirJob(
    db,
    "ITEM",
    contexte.nomFichier,
    contexte.acteur,
    { simulation: contexte.simulation ?? false },
    contexte.fichier.lignes.length,
  );
  const suivi = new SuiviImport(jobId, "ITEM");
  const messages: string[] = [];

  // Index des familles source pour rattacher les articles.
  const famillesSource = await db.itemFamily.findMany({
    where: { sourceSystem: SYSTEME_SOURCE },
    select: { id: true, sourceOid: true },
  });
  const familleParOid = new Map(
    famillesSource
      .filter((famille) => famille.sourceOid !== null)
      .map((famille) => [famille.sourceOid as number, famille.id]),
  );

  const unitesConnues = new Set(
    (await db.unitOfMeasure.findMany({ select: { code: true } })).map((u) => u.code),
  );

  try {
    for (const ligne of contexte.fichier.lignes) {
      suivi.compteurs.lues += 1;

      const oid = entier(ligne.valeurs.Oid);
      const code = texte(ligne.valeurs.Code);
      const label1 = texte(ligne.valeurs.Label1);

      if (oid === null) {
        suivi.rejeter(ligne, "Identifiant source (Oid) absent ou invalide.", "Oid");
        continue;
      }
      if (!code) {
        suivi.rejeter(ligne, "Article sans code : ligne rejetee.", "Code");
        continue;
      }
      if (!label1) {
        suivi.rejeter(ligne, `Article ${code} sans libelle : ligne rejetee.`, "Label1");
        continue;
      }

      try {
        await enTransaction(
          db,
          async (tx) => {
            const typeSource = texte(ligne.valeurs.Type);
            // Un article de main d'oeuvre est toujours de type MAIN_OEUVRE,
            // quelle que soit la correspondance du code source.
            const type = estMainOeuvre(ligne)
              ? "MAIN_OEUVRE"
              : typeSource
                  ? ((await resoudreCorrespondance(
                      tx,
                      "ITEM",
                      "Type",
                      typeSource,
                      TYPE_ARTICLE_REPLI,
                      suivi,
                    )) as ItemType)
                  : TYPE_ARTICLE_REPLI;

            const uniteSource = texte(ligne.valeurs.UnitOfMeasure);
            let unitCode: string | null = null;
            if (uniteSource) {
              unitCode = await resoudreCorrespondance(
                tx,
                "ITEM",
                "UnitOfMeasure",
                uniteSource,
                unitesConnues.has("PCS") ? "PCS" : "",
                suivi,
              );
              if (!unitesConnues.has(unitCode)) unitCode = null;
            }

            const familleOid = entier(ligne.valeurs.Family);
            const familyId =
              familleOid !== null ? (familleParOid.get(familleOid) ?? null) : null;

            if (familleOid !== null && familyId === null) {
              suivi.avertir(
                `Article ${code} : famille source ${familleOid} introuvable. Renseignez la famille manuellement.`,
              );
            }

            const donnees = {
              code,
              barcode: texte(ligne.valeurs.Barcode),
              reference: texte(ligne.valeurs.Reference),
              label1,
              label2: texte(ligne.valeurs.Label2),
              label3: texte(ligne.valeurs.Label3),
              type,
              status: statutArticle(ligne),
              familyId,
              unitCode,
              taxRateCode: null,
              factory: "COMMUN" as const,
              isBatchManaged: booleen(ligne.valeurs.IsBatchManaged),
              isPerishable: booleen(ligne.valeurs.IsPerishable),
              isRawMaterial: booleen(ligne.valeurs.IsRawMaterial),
              isSemiFinished: booleen(ligne.valeurs.IsSemiFinished),
              isOutOfService: booleen(ligne.valeurs.IsOutOfService),
              ...indicateursArticle(ligne),
              useNegativeStock: booleen(ligne.valeurs.UseNegativeStock),
              vwap: D.round(decimal(ligne.valeurs.VWAP) ?? D.ZERO, 6),
              vwapPhysical: D.round(decimal(ligne.valeurs.VWAPphysical) ?? D.ZERO, 6),
              quantityMin: D.round(decimal(ligne.valeurs.QuantityMin) ?? D.ZERO, 6),
              quantityMin2: D.round(decimal(ligne.valeurs.QuantityMin2) ?? D.ZERO, 6),
              quantityMax: D.round(decimal(ligne.valeurs.QuantityMax) ?? D.ZERO, 6),
              quantityMax2: D.round(decimal(ligne.valeurs.QuantityMax2) ?? D.ZERO, 6),
              safetyStock: D.round(decimal(ligne.valeurs.QuantityMin) ?? D.ZERO, 6),
              accountingCode: texte(ligne.valeurs.AccountingCode),
              stockAccount: texte(ligne.valeurs.StockAccount),
              productionAccount: texte(ligne.valeurs.ProductionAccount),
              consumptionAccount: texte(ligne.valeurs.ConsumptionAccount),
              unitValue: D.round(decimal(ligne.valeurs.UnitValue) ?? D.ZERO, 6),
              unitWeight: D.round(decimal(ligne.valeurs.UnitWeight) ?? D.ZERO, 6),
              width: D.round(decimal(ligne.valeurs.Width) ?? D.ZERO, 6),
              height: D.round(decimal(ligne.valeurs.Height) ?? D.ZERO, 6),
              length: D.round(decimal(ligne.valeurs.Length) ?? D.ZERO, 6),
              thickness: D.round(decimal(ligne.valeurs.Thickness) ?? D.ZERO, 6),
              defaultPacking: texte(ligne.valeurs.DefaultPacking),
              image: texte(ligne.valeurs.Image),
              brand: texte(ligne.valeurs.Brand),
              remark: texte(ligne.valeurs.Remark),
              note: texte(ligne.valeurs.Note),
              sourceSystem: SYSTEME_SOURCE,
              sourceOid: oid,
              sourceSyncId: texte(ligne.valeurs.SyncId),
              sourceDefaultFormula: texte(ligne.valeurs.DefaultFormula),
            };

            // Recherche par cle stable AVANT toute creation : aucun doublon.
            const parSource = await tx.item.findFirst({
              where: { sourceSystem: SYSTEME_SOURCE, sourceOid: oid },
            });
            const parCode = await tx.item.findUnique({ where: { code } });
            const existant = parSource ?? parCode;

            if (!existant) {
              await tx.item.create({ data: donnees });
              suivi.compteurs.inserees += 1;
              await enregistrerInstantane(tx, "ITEM", ligne, jobId, contexte.nomFichier);
              return;
            }

            // Un article deja present dans le catalogue mais jamais importe
            // (cree par le referentiel) est complete, pas duplique.
            const instantane = await lireInstantane(tx, "ITEM", oid);
            const modifieLocalement =
              instantane && existant.updatedAt.getTime() > instantane.updatedAt.getTime();

            if (modifieLocalement && !contexte.miseAJourAutorisee) {
              suivi.compteurs.protegees += 1;
              suivi.journaliser(
                ligne,
                `Article « ${code} » modifie dans la plateforme apres le dernier import : mise a jour refusee.`,
                "PROTEGE",
              );
              return;
            }

            if (!instantane && parCode && !parSource) {
              // Premier import d'un article deja au catalogue : on rattache la
              // cle source sans ecraser les champs metier deja renseignes.
              await tx.item.update({
                where: { id: parCode.id },
                data: {
                  sourceSystem: SYSTEME_SOURCE,
                  sourceOid: oid,
                  sourceSyncId: donnees.sourceSyncId,
                  barcode: donnees.barcode ?? parCode.barcode,
                  reference: donnees.reference ?? parCode.reference,
                },
              });
              suivi.compteurs.misesAJour += 1;
              await enregistrerInstantane(tx, "ITEM", ligne, jobId, contexte.nomFichier);
              return;
            }

            await tx.item.update({ where: { id: existant.id }, data: donnees });
            suivi.compteurs.misesAJour += 1;
            await enregistrerInstantane(tx, "ITEM", ligne, jobId, contexte.nomFichier);
          },
          { timeout: 30_000 },
        );
      } catch (erreur) {
        suivi.rejeter(
          ligne,
          `Article ${code} : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
        );
      }
    }
  } catch (erreur) {
    await cloturerJob(db, jobId, suivi, debut, erreur);
    throw erreur;
  }

  // Le transfert ADMEDCO -> MOBILIX a besoin d'un article semi-fini unique pour
  // le chassis peint. L'import ne cree jamais cet article : il signale une
  // correspondance a confirmer des qu'un chassis peint figure dans les donnees
  // importees, afin qu'aucun doublon ne soit cree en silence.
  const chassis = await analyserArticleChassisPeint(db);
  for (const message of chassis.messages) {
    suivi.avertir(`Chassis peint : ${message}`);
  }

  await cloturerJob(db, jobId, suivi, debut);

  await enregistrerAudit({
    action: ACTIONS_AUDIT.IMPORT,
    module: MODULES_AUDIT.IMPORT,
    entity: "ImportJob",
    entityId: String(jobId),
    userId: contexte.acteur.id,
    userEmail: contexte.acteur.email,
    newValue: {
      fichier: contexte.nomFichier,
      entite: "ITEM",
      ...suivi.compteurs,
      avertissements: suivi.avertissements.length,
    },
  }, db);

  return {
    jobId,
    fichier: contexte.nomFichier,
    entite: "ITEM",
    compteurs: suivi.compteurs,
    colonnes,
    avertissements: suivi.avertissements,
    messages,
    dureeMs: Date.now() - debut,
  };
}

// -----------------------------------------------------------------------------
// Tiers : clients, fournisseurs, employes (COM_ThirdParty.csv)
// -----------------------------------------------------------------------------

const COLONNES_TIERS = [
  "Oid", "SyncId", "Code", "Label1", "Label2", "Reference", "Designation",
  "AccountingCode", "Type", "Address1", "Address2", "PostCode", "Tel1", "Tel2",
  "Fax", "Email", "Remark", "Note", "Family", "LegalForm", "Activity", "Commune",
  "Department", "Country", "Region", "DiscountRate", "DeadlineDays",
  "MaxBalanceAmount", "MethodOfPayment", "FirstName", "LastName", "BirthDate",
  "Gender", "SocialSecurityNumber", "CCPNum", "City", "Balance", "ExemptFromVat",
  "CreationDate", "LastModificationDate",
];

const MODES_PAIEMENT = [
  "ESPECES",
  "CHEQUE",
  "VIREMENT",
  "TRAITE",
  "CARTE",
  "COMPENSATION",
  "AUTRE",
] as const;

type ModePaiement = (typeof MODES_PAIEMENT)[number];

/**
 * Le mode de paiement de la source est un libelle libre : il n'est jamais
 * converti en silence. Une correspondance non confirmee est creee et la valeur
 * reste vide tant que l'administrateur ne l'a pas validee.
 */
async function resoudreModePaiement(
  tx: Db,
  ligne: LigneCsv,
  suivi: SuiviImport,
): Promise<ModePaiement | null> {
  const source = texte(ligne.valeurs.MethodOfPayment);
  if (!source) return null;

  const cible = await resoudreCorrespondance(
    tx,
    "THIRD_PARTY",
    "MethodOfPayment",
    source,
    "",
    suivi,
  );

  if (cible === "") return null;
  return (MODES_PAIEMENT as readonly string[]).includes(cible)
    ? (cible as ModePaiement)
    : null;
}

interface ProfilTiers {
  isClient: boolean;
  isSupplier: boolean;
  isEmployee: boolean;
  type: "CLIENT" | "FOURNISSEUR" | "EMPLOYE" | "AUTRE";
}

/**
 * La source ne precise pas lisiblement la nature du tiers : le code brut est
 * resolu par correspondance configurable. Par defaut, un tiers est importe en
 * « Autre tiers » et la correspondance est signalee comme a confirmer, afin
 * qu'aucune nature ne soit devinee a la place de l'administrateur.
 */
async function resoudreProfilTiers(
  tx: Db,
  ligne: LigneCsv,
  suivi: SuiviImport,
): Promise<ProfilTiers> {
  const codeSource = texte(ligne.valeurs.Type) ?? "";

  const cible = await resoudreCorrespondance(
    tx,
    "THIRD_PARTY",
    "Type",
    codeSource === "" ? "(vide)" : codeSource,
    "AUTRE",
    suivi,
  );

  switch (cible) {
    case "CLIENT":
      return { isClient: true, isSupplier: false, isEmployee: false, type: "CLIENT" };
    case "FOURNISSEUR":
      return { isClient: false, isSupplier: true, isEmployee: false, type: "FOURNISSEUR" };
    case "EMPLOYE":
      return { isClient: false, isSupplier: false, isEmployee: true, type: "EMPLOYE" };
    case "CLIENT_FOURNISSEUR":
      return { isClient: true, isSupplier: true, isEmployee: false, type: "CLIENT" };
    default:
      return { isClient: false, isSupplier: false, isEmployee: false, type: "AUTRE" };
  }
}

export async function importerTiers(
  contexte: ContexteImport,
): Promise<ResultatImport> {
  const debut = Date.now();
  const colonnes = verifierColonnes(contexte.fichier, COLONNES_TIERS, ["Oid", "Code", "Label1"]);
  if (!colonnes.conforme) {
    throw validation(
      "Le fichier des tiers ne contient pas les colonnes obligatoires (Oid, Code, Label1).",
    );
  }

  const db = contexte.db ?? prisma;

  const jobId = await ouvrirJob(
    db,
    "THIRD_PARTY",
    contexte.nomFichier,
    contexte.acteur,
    { simulation: contexte.simulation ?? false },
    contexte.fichier.lignes.length,
  );
  const suivi = new SuiviImport(jobId, "THIRD_PARTY");
  const messages: string[] = [];

  try {
    for (const ligne of contexte.fichier.lignes) {
      suivi.compteurs.lues += 1;

      const oid = entier(ligne.valeurs.Oid);
      const code = texte(ligne.valeurs.Code);
      const label1 = texte(ligne.valeurs.Label1);

      if (oid === null || !code) {
        suivi.rejeter(ligne, "Tiers sans identifiant ou sans code : ligne rejetee.");
        continue;
      }
      if (!label1) {
        suivi.rejeter(ligne, `Tiers ${code} sans libelle : ligne rejetee.`, "Label1");
        continue;
      }

      try {
        await enTransaction(
          db,
          async (tx) => {
            const profil = await resoudreProfilTiers(tx, ligne, suivi);

            const donnees = {
              code,
              label1,
              label2: texte(ligne.valeurs.Label2),
              reference: texte(ligne.valeurs.Reference),
              type: profil.type,
              isClient: profil.isClient,
              isSupplier: profil.isSupplier,
              isEmployee: profil.isEmployee,
              designation: texte(ligne.valeurs.Designation),
              accountingCode: texte(ligne.valeurs.AccountingCode),
              address1: texte(ligne.valeurs.Address1),
              address2: texte(ligne.valeurs.Address2),
              postCode: texte(ligne.valeurs.PostCode),
              phone1: texte(ligne.valeurs.Tel1),
              phone2: texte(ligne.valeurs.Tel2),
              fax: texte(ligne.valeurs.Fax),
              email: texte(ligne.valeurs.Email),
              url: texte(ligne.valeurs.URL),
              city: texte(ligne.valeurs.City) ?? texte(ligne.valeurs.Commune),
              country: texte(ligne.valeurs.Country),
              region: texte(ligne.valeurs.Region),
              legalForm: texte(ligne.valeurs.LegalForm),
              activity: texte(ligne.valeurs.Activity),
              familyCode: texte(ligne.valeurs.Family),
              category1: texte(ligne.valeurs.Category1),
              category2: texte(ligne.valeurs.Category2),
              category3: texte(ligne.valeurs.Category3),
              category4: texte(ligne.valeurs.Category4),
              category5: texte(ligne.valeurs.Category5),
              responsibilityCenter: texte(ligne.valeurs.ResponsibilityCenter),
              firstName: texte(ligne.valeurs.FirstName),
              lastName: texte(ligne.valeurs.LastName),
              birthDate: date(ligne.valeurs.BirthDate),
              gender: texte(ligne.valeurs.Gender),
              socialSecurityNumber: texte(ligne.valeurs.SocialSecurityNumber),
              ccp: texte(ligne.valeurs.CCPNum),
              paymentMethod: await resoudreModePaiement(tx, ligne, suivi),
              deadlineDays: entier(ligne.valeurs.DeadlineDays) ?? 0,
              discountRate: D.round(decimal(ligne.valeurs.DiscountRate) ?? D.ZERO, 4),
              increaseRate: D.round(decimal(ligne.valeurs.IncreaseRate) ?? D.ZERO, 4),
              maxBalanceAmount: D.round(decimal(ligne.valeurs.MaxBalanceAmount) ?? D.ZERO, 4),
              exemptFromVat: booleen(ligne.valeurs.ExemptFromVat),
              commune: texte(ligne.valeurs.Commune),
              department: texte(ligne.valeurs.Department),
              balance: D.ZERO,
              isOther: profil.type === "AUTRE",
              remark: texte(ligne.valeurs.Remark),
              note: texte(ligne.valeurs.Note),
              isActive: true,
              sourceSystem: SYSTEME_SOURCE,
              sourceOid: oid,
              sourceSyncId: texte(ligne.valeurs.SyncId),
            };

            const parSource = await tx.thirdParty.findFirst({
              where: { sourceSystem: SYSTEME_SOURCE, sourceOid: oid },
            });
            const parCode = await tx.thirdParty.findUnique({ where: { code } });
            const existant = parSource ?? parCode;

            if (!existant) {
              await tx.thirdParty.create({ data: donnees });
              suivi.compteurs.inserees += 1;
              await enregistrerInstantane(
                tx,
                "THIRD_PARTY",
                ligne,
                jobId,
                contexte.nomFichier,
              );
              return;
            }

            const instantane = await lireInstantane(tx, "THIRD_PARTY", oid);
            const modifieLocalement =
              instantane && existant.updatedAt.getTime() > instantane.updatedAt.getTime();

            if (modifieLocalement && !contexte.miseAJourAutorisee) {
              suivi.compteurs.protegees += 1;
              suivi.journaliser(
                ligne,
                `Tiers « ${code} » modifie dans la plateforme apres le dernier import : mise a jour refusee.`,
                "PROTEGE",
              );
              return;
            }

            await tx.thirdParty.update({ where: { id: existant.id }, data: donnees });
            suivi.compteurs.misesAJour += 1;
            await enregistrerInstantane(
              tx,
              "THIRD_PARTY",
              ligne,
              jobId,
              contexte.nomFichier,
            );
          },
          { timeout: 30_000 },
        );
      } catch (erreur) {
        suivi.rejeter(
          ligne,
          `Tiers ${code} : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
        );
      }
    }
  } catch (erreur) {
    await cloturerJob(db, jobId, suivi, debut, erreur);
    throw erreur;
  }

  await cloturerJob(db, jobId, suivi, debut);

  const nature = await db.thirdParty.groupBy({
    by: ["type"],
    _count: { _all: true },
  });
  messages.push(
    `Repartition des tiers en base : ${nature
      .map((groupe) => `${groupe.type} = ${groupe._count._all}`)
      .join(", ")}.`,
  );

  return {
    jobId,
    fichier: contexte.nomFichier,
    entite: "THIRD_PARTY",
    compteurs: suivi.compteurs,
    colonnes,
    avertissements: suivi.avertissements,
    messages,
    dureeMs: Date.now() - debut,
  };
}

// -----------------------------------------------------------------------------
// Fiches de personnel (COM_ThirdParty.csv, tiers de nature employe)
// -----------------------------------------------------------------------------

/**
 * Cree les fiches de personnel a partir des tiers de nature « employe ».
 *
 * L'ancien ERP ne tient pas de registre du personnel distinct : les personnes
 * physiques sont rangees dans la table des tiers et distinguees par leur nature
 * (`Type`), que l'administrateur confirme via les correspondances d'import.
 * Cette etape ne cree donc une fiche employe que pour les tiers dont la nature
 * vaut explicitement EMPLOYE : aucune personne n'est devinee.
 *
 * Regles tenues :
 *   - aucun compte utilisateur n'est cree : ouvrir un acces reste un acte
 *     separe et nominatif (voir la gestion des comptes) ;
 *   - la cle stable (sourceSystem + sourceOid) rend l'import re-executable ;
 *   - une fiche modifiee dans la plateforme n'est jamais ecrasee ;
 *   - le matricule et le nom viennent de la source ; quand le prenom manque, la
 *     fiche est creee, signalee et a completer, jamais inventee.
 */
export async function importerEmployes(
  contexte: ContexteImport,
): Promise<ResultatImport> {
  const debut = Date.now();
  const colonnes = verifierColonnes(contexte.fichier, COLONNES_TIERS, ["Oid", "Code", "Label1"]);
  if (!colonnes.conforme) {
    throw validation(
      "Le fichier des tiers ne contient pas les colonnes obligatoires (Oid, Code, Label1) : les fiches de personnel ne peuvent pas etre importees.",
    );
  }

  const db = contexte.db ?? prisma;

  const jobId = await ouvrirJob(
    db,
    "EMPLOYEE",
    contexte.nomFichier,
    contexte.acteur,
    { simulation: contexte.simulation ?? false },
    contexte.fichier.lignes.length,
  );
  const suivi = new SuiviImport(jobId, "EMPLOYEE");
  const messages: string[] = [];
  let prenomsManquants = 0;
  let fichesCreees = 0;

  try {
    for (const ligne of contexte.fichier.lignes) {
      suivi.compteurs.lues += 1;

      const oid = entier(ligne.valeurs.Oid);
      const code = texte(ligne.valeurs.Code);
      const label1 = texte(ligne.valeurs.Label1);

      if (oid === null || !code || !label1) {
        suivi.ignorer(
          ligne,
          "Ligne sans identifiant, sans code ou sans libelle : aucune fiche de personnel a creer.",
        );
        continue;
      }

      try {
        await enTransaction(
          db,
          async (tx) => {
            const profil = await resoudreProfilTiers(tx, ligne, suivi);
            if (!profil.isEmployee) {
              suivi.ignorer(
                ligne,
                `Tiers ${code} : nature « ${profil.type} » et non « employe » : aucune fiche de personnel creee.`,
              );
              return;
            }

            const tiers = await tx.thirdParty.findFirst({
              where: { sourceSystem: SYSTEME_SOURCE, sourceOid: oid },
              select: { id: true, label1: true },
            });
            if (!tiers) {
              suivi.rejeter(
                ligne,
                `Fiche de personnel ${code} : le tiers source ${oid} n'existe pas. Importez d'abord les tiers.`,
                "Oid",
              );
              return;
            }

            const prenom = texte(ligne.valeurs.FirstName);
            const nom = texte(ligne.valeurs.LastName) ?? label1;
            if (!prenom) prenomsManquants += 1;

            const donnees = {
              matricule: code,
              firstName: prenom ?? "",
              lastName: nom,
              factory: "COMMUN" as const,
              jobTitle: texte(ligne.valeurs.Activity),
              email: texte(ligne.valeurs.Email),
              phone: texte(ligne.valeurs.Tel1),
              phone2: texte(ligne.valeurs.Tel2),
              address: texte(ligne.valeurs.Address1),
              city: texte(ligne.valeurs.City) ?? texte(ligne.valeurs.Commune),
              birthDate: date(ligne.valeurs.BirthDate),
              gender: texte(ligne.valeurs.Gender),
              socialSecurityNumber: texte(ligne.valeurs.SocialSecurityNumber),
              ccp: texte(ligne.valeurs.CCPNum),
              thirdPartyId: tiers.id,
              sourceSystem: SYSTEME_SOURCE,
              sourceOid: oid,
              sourceSyncId: texte(ligne.valeurs.SyncId),
            };

            const parSource = await tx.employee.findFirst({
              where: { sourceSystem: SYSTEME_SOURCE, sourceOid: oid },
            });
            const parMatricule = await tx.employee.findUnique({ where: { matricule: code } });
            const existant = parSource ?? parMatricule;

            if (!existant) {
              await tx.employee.create({ data: donnees });
              fichesCreees += 1;
              suivi.compteurs.inserees += 1;
              await enregistrerInstantane(tx, "EMPLOYEE", ligne, jobId, contexte.nomFichier);
              return;
            }

            const instantane = await lireInstantane(tx, "EMPLOYEE", oid);
            const modifieLocalement =
              instantane && existant.updatedAt.getTime() > instantane.updatedAt.getTime();

            if (modifieLocalement && !contexte.miseAJourAutorisee) {
              suivi.compteurs.protegees += 1;
              suivi.journaliser(
                ligne,
                `Fiche de personnel « ${code} » modifiee dans la plateforme apres le dernier import : mise a jour refusee.`,
                "PROTEGE",
              );
              return;
            }

            await tx.employee.update({ where: { id: existant.id }, data: donnees });
            suivi.compteurs.misesAJour += 1;
            await enregistrerInstantane(tx, "EMPLOYEE", ligne, jobId, contexte.nomFichier);
          },
          { timeout: 30_000 },
        );
      } catch (erreur) {
        suivi.rejeter(
          ligne,
          `Fiche de personnel ${code} : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
        );
      }
    }
  } catch (erreur) {
    await cloturerJob(db, jobId, suivi, debut, erreur);
    throw erreur;
  }

  await cloturerJob(db, jobId, suivi, debut);

  if (prenomsManquants > 0) {
    suivi.avertir(
      `${prenomsManquants} fiche(s) de personnel sans prenom dans la source : le nom et le matricule sont repris tels quels, completez le prenom dans Ressources humaines.`,
    );
  }
  if (fichesCreees > 0) {
    suivi.avertir(
      `${fichesCreees} fiche(s) de personnel importee(s) en portee COMMUN : precisez l'usine (ADMEDCO ou MOBILIX) avant de les affecter en atelier.`,
    );
  }
  messages.push(
    "Aucun compte d'acces n'est cree par cette etape : chaque operateur recoit son compte nominatif separement.",
  );

  await enregistrerAudit(
    {
      action: ACTIONS_AUDIT.IMPORT,
      module: MODULES_AUDIT.IMPORT,
      entity: "ImportJob",
      entityId: String(jobId),
      userId: contexte.acteur.id,
      userEmail: contexte.acteur.email,
      newValue: {
        fichier: contexte.nomFichier,
        entite: "EMPLOYEE",
        ...suivi.compteurs,
        avertissements: suivi.avertissements.length,
      },
    },
    db,
  );

  return {
    jobId,
    fichier: contexte.nomFichier,
    entite: "EMPLOYEE",
    compteurs: suivi.compteurs,
    colonnes,
    avertissements: suivi.avertissements,
    messages,
    dureeMs: Date.now() - debut,
  };
}

// -----------------------------------------------------------------------------
// Formules et nomenclatures (COM_Formula.csv + COM_BOM.csv)
// -----------------------------------------------------------------------------

const COLONNES_FORMULE = [
  "Oid", "SyncId", "Code", "Label1", "Label2", "Item", "Blocked", "TotalQuantity",
  "TotalVWAP", "Validate", "Type", "ProductionTimeOfUnit", "ProductionCostPerUnit",
  "WarehouseProd", "WarehouseStore", "WarehouseDest", "CostCalcMethod",
  "TypeFormule", "Changeable", "MethodOfValuation", "Price", "PML",
];

const COLONNES_LIGNE_NOMENCLATURE = [
  "Oid", "SyncId", "Offset", "Parent", "Item", "Quantity", "Formula",
  "ToleratedError", "Class", "InProcess", "Label1", "Price", "ApartFromtheCost",
  "Rate", "Taux",
];

export interface ResultatImportNomenclature extends ResultatImport {
  ecartsDetectes: number;
}

/**
 * Importe les nomenclatures.
 *
 * Contradiction de quantite : lorsqu'une meme formule contient plusieurs lignes
 * pour le meme composant avec des quantites differentes, AUCUNE valeur n'est
 * choisie en silence. Les deux valeurs sont conservees, un enregistrement
 * `FormulaVariance` est cree au statut OUVERT avec les deux sources, et le
 * rapport le signale. L'administrateur tranche ensuite depuis l'ecran dedie,
 * sans que l'historique d'origine soit modifie.
 */
export async function importerNomenclatures(
  contexteFormules: ContexteImport,
  contexteLignes: ContexteImport,
): Promise<ResultatImportNomenclature> {
  const debut = Date.now();
  const colonnes = verifierColonnes(contexteFormules.fichier, COLONNES_FORMULE, ["Oid", "Item"]);
  if (!colonnes.conforme) {
    throw validation(
      "Le fichier des formules ne contient pas les colonnes obligatoires (Oid, Item).",
    );
  }
  const colonnesLignes = verifierColonnes(
    contexteLignes.fichier,
    COLONNES_LIGNE_NOMENCLATURE,
    ["Oid", "Parent", "Item", "Quantity"],
  );
  if (!colonnesLignes.conforme) {
    throw validation(
      "Le fichier des composants de nomenclature ne contient pas les colonnes obligatoires (Oid, Parent, Item, Quantity).",
    );
  }

  const db = contexteFormules.db ?? prisma;

  const jobId = await ouvrirJob(
    db,
    "FORMULA",
    `${contexteFormules.nomFichier} + ${contexteLignes.nomFichier}`,
    contexteFormules.acteur,
    { simulation: contexteFormules.simulation ?? false },
    contexteFormules.fichier.lignes.length + contexteLignes.fichier.lignes.length,
  );
  const suivi = new SuiviImport(jobId, "FORMULA");
  const messages: string[] = [];
  let ecartsDetectes = 0;

  const articlesParOid = new Map(
    (
      await db.item.findMany({
        where: { sourceSystem: SYSTEME_SOURCE, sourceOid: { not: null } },
        select: { id: true, sourceOid: true, code: true, isMainOeuvre: true },
      })
    ).map((article) => [article.sourceOid as number, article]),
  );

  const depotsParOid = new Map(
    (
      await db.warehouse.findMany({
        where: { sourceSystem: SYSTEME_SOURCE, sourceOid: { not: null } },
        select: { id: true, sourceOid: true },
      })
    ).map((depot) => [depot.sourceOid as number, depot.id]),
  );

  // Formulaire de rattachement : identifiant source de formule -> identifiant interne.
  const formuleParOid = new Map<number, number>();

  try {
    // --- 1. Entetes de formules ---
    for (const ligne of contexteFormules.fichier.lignes) {
      suivi.compteurs.lues += 1;

      const oid = entier(ligne.valeurs.Oid);
      const articleOid = entier(ligne.valeurs.Item);
      const code = texte(ligne.valeurs.Code) ?? `FORMULE-${oid ?? "?"}`;

      if (oid === null || articleOid === null) {
        suivi.rejeter(ligne, "Formule sans identifiant ou sans article parent.", "Item");
        continue;
      }

      const articleParent = articlesParOid.get(articleOid);
      if (!articleParent) {
        suivi.rejeter(
          ligne,
          `Formule ${code} : article parent (Oid ${articleOid}) absent de la base. Importez d'abord les articles.`,
          "Item",
        );
        continue;
      }

      try {
        const idFormule = await enTransaction(
          db,
          async (tx) => {
            const donnees = {
              code,
              label: texte(ligne.valeurs.Label1) ?? `Formule ${code}`,
              label2: texte(ligne.valeurs.Label2),
              itemId: articleParent.id,
              type: texte(ligne.valeurs.Type),
              typeFormule: texte(ligne.valeurs.TypeFormule),
              productionTimePerUnit: D.round(
                decimal(ligne.valeurs.ProductionTimeOfUnit) ?? D.ZERO,
                6,
              ),
              productionCostPerUnit: D.round(
                decimal(ligne.valeurs.ProductionCostPerUnit) ?? D.ZERO,
                4,
              ),
              totalQuantity: D.round(decimal(ligne.valeurs.TotalQuantity) ?? D.ZERO, 6),
              totalCost: D.round(decimal(ligne.valeurs.TotalVWAP) ?? D.ZERO, 4),
              costCalcMethod: texte(ligne.valeurs.CostCalcMethod),
              blocked: booleen(ligne.valeurs.Blocked),
              isDefault: booleen(ligne.valeurs.PML),
              // Une formule importee arrive au statut « en validation » :
              // elle ne devient active qu'apres validation par l'administrateur.
              status: "EN_VALIDATION" as const,
              warehouseProdId:
                entier(ligne.valeurs.WarehouseProd) !== null
                  ? (depotsParOid.get(entier(ligne.valeurs.WarehouseProd)!) ?? null)
                  : null,
              warehouseStoreId:
                entier(ligne.valeurs.WarehouseStore) !== null
                  ? (depotsParOid.get(entier(ligne.valeurs.WarehouseStore)!) ?? null)
                  : null,
              warehouseDestId:
                entier(ligne.valeurs.WarehouseDest) !== null
                  ? (depotsParOid.get(entier(ligne.valeurs.WarehouseDest)!) ?? null)
                  : null,
              sourceSystem: SYSTEME_SOURCE,
              sourceOid: oid,
              sourceSyncId: texte(ligne.valeurs.SyncId),
              importedFrom: contexteFormules.nomFichier,
            };

            const existante = await tx.formula.findFirst({
              where: { sourceSystem: SYSTEME_SOURCE, sourceOid: oid },
            });

            if (!existante) {
              // Une seule nomenclature peut exister par article et par version.
              // Lorsque la source contient plusieurs formules pour le meme
              // article (codes sources distincts), la suivante est enregistree
              // comme NOUVELLE VERSION : la nomenclature deja presente n'est
              // jamais ecrasee et l'enchainement des versions reste consultable.
              const precedente = await tx.formula.findFirst({
                where: { itemId: articleParent.id },
                orderBy: { version: "desc" },
                select: { id: true, version: true, code: true },
              });
              const version = precedente ? precedente.version + 1 : 1;

              const creee = await tx.formula.create({
                data: {
                  ...donnees,
                  version,
                  previousVersionId: precedente?.id ?? null,
                  changeReason: precedente
                    ? `Nouvelle version issue de l'import : l'article porte deja la nomenclature « ${precedente.code} » (version ${precedente.version}). Les deux sont conservees ; l'administrateur doit designer la version active.`
                    : null,
                },
              });
              suivi.compteurs.inserees += 1;
              if (precedente) {
                suivi.journaliser(
                  ligne,
                  `Formule « ${code} » enregistree en version ${version} : l'article porte deja une autre nomenclature (« ${precedente.code} »). Aucune nomenclature n'a ete ecrasee.`,
                  "INSERE",
                );
              }
              await enregistrerInstantane(
                tx,
                "FORMULA",
                ligne,
                jobId,
                contexteFormules.nomFichier,
              );
              return creee.id;
            }

            const instantane = await lireInstantane(tx, "FORMULA", oid);
            const modifieeLocalement =
              instantane && existante.updatedAt.getTime() > instantane.updatedAt.getTime();

            if (modifieeLocalement && !contexteFormules.miseAJourAutorisee) {
              suivi.compteurs.protegees += 1;
              suivi.journaliser(
                ligne,
                `Formule « ${code} » modifiee dans la plateforme apres le dernier import : mise a jour refusee.`,
                "PROTEGE",
              );
              return existante.id;
            }

            await tx.formula.update({
              where: { id: existante.id },
              data: { ...donnees, status: existante.status },
            });
            suivi.compteurs.misesAJour += 1;
            await enregistrerInstantane(
              tx,
              "FORMULA",
              ligne,
              jobId,
              contexteFormules.nomFichier,
            );
            return existante.id;
          },
          { timeout: 30_000 },
        );

        formuleParOid.set(oid, idFormule);
      } catch (erreur) {
        suivi.rejeter(
          ligne,
          `Formule ${code} : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
        );
      }
    }

    // Les formules deja presentes en base mais absentes de ce passage restent
    // utilisables : leur rattachement est reconstruit.
    const formulesExistantes = await db.formula.findMany({
      where: { sourceSystem: SYSTEME_SOURCE, sourceOid: { not: null } },
      select: { id: true, sourceOid: true },
    });
    for (const formule of formulesExistantes) {
      if (formule.sourceOid !== null && !formuleParOid.has(formule.sourceOid)) {
        formuleParOid.set(formule.sourceOid, formule.id);
      }
    }

    // --- 2. Composants de nomenclature et detection des ecarts ---
    for (const ligne of contexteLignes.fichier.lignes) {
      suivi.compteurs.lues += 1;

      const oid = entier(ligne.valeurs.Oid);
      const formuleOid = entier(ligne.valeurs.Parent) ?? entier(ligne.valeurs.Formula);
      const composantOid = entier(ligne.valeurs.Item);
      const quantite = decimal(ligne.valeurs.Quantity);

      // L'ancien ERP contient des lignes entierement vides (identifiant et
      // offset seuls, sans parent, sans composant et sans quantite). Il n'y a
      // rien a importer : ces lignes sont ignorees et ne sont pas comptees
      // comme des rejets, pour ne pas faire croire a une perte de donnees.
      if (formuleOid === null && composantOid === null && quantite === null) {
        suivi.ignorer(
          ligne,
          "Ligne de nomenclature vide dans la source (aucun parent, aucun composant, aucune quantite) : rien a importer.",
        );
        continue;
      }

      if (oid === null || formuleOid === null || composantOid === null) {
        suivi.rejeter(
          ligne,
          "Composant de nomenclature : identifiants source incomplets.",
        );
        continue;
      }

      const formuleId = formuleParOid.get(formuleOid);
      if (!formuleId) {
        suivi.rejeter(
          ligne,
          `Composant rattache a la formule source ${formuleOid}, introuvable en base.`,
          "Parent",
        );
        continue;
      }

      const composant = articlesParOid.get(composantOid);
      if (!composant) {
        suivi.rejeter(
          ligne,
          `Composant (Oid ${composantOid}) absent de la base. Importez d'abord les articles.`,
          "Item",
        );
        continue;
      }

      if (quantite === null) {
        suivi.rejeter(
          ligne,
          `Quantite absente ou non numerique pour le composant ${composant.code}. Aucune valeur par defaut n'est appliquee : corrigez la source ou saisissez la ligne manuellement.`,
          "Quantity",
        );
        continue;
      }

      try {
        const ecart = await enTransaction(
          db,
          async (tx) => {
            const existante = await tx.formulaLine.findFirst({
              where: { sourceSystem: SYSTEME_SOURCE, sourceOid: oid },
            });

            const donnees = {
              formulaId: formuleId,
              lineNo: entier(ligne.valeurs.Offset) ?? 0,
              componentItemId: composant.id,
              quantity: D.round(quantite, 6),
              unitCode: null,
              lossRate: D.round(decimal(ligne.valeurs.ToleratedError) ?? D.ZERO, 4),
              scrapRate: D.ZERO,
              toleratedError: decimal(ligne.valeurs.ToleratedError),
              operationCode: texte(ligne.valeurs.Class),
              unitCost: D.round(decimal(ligne.valeurs.Price) ?? D.ZERO, 4),
              price: D.round(decimal(ligne.valeurs.Price) ?? D.ZERO, 4),
              totalCost: D.round(D.mul(quantite, decimal(ligne.valeurs.Price) ?? D.ZERO), 4),
              apartFromCost: booleen(ligne.valeurs.ApartFromtheCost),
              lineClass: texte(ligne.valeurs.Class),
              inProcess: booleen(ligne.valeurs.InProcess),
              // Une ligne de main d'oeuvre se valorise mais ne sort pas de
              // stock : le drapeau permet a la production de l'ignorer.
              isLabor: composant.isMainOeuvre === true,
              label1: texte(ligne.valeurs.Label1),
              rate: decimal(ligne.valeurs.Rate),
              taux: decimal(ligne.valeurs.Taux),
              sourceSystem: SYSTEME_SOURCE,
              sourceOid: oid,
              sourceSyncId: texte(ligne.valeurs.SyncId),
              importedFrom: contexteLignes.nomFichier,
            };

            if (!existante) {
              await tx.formulaLine.create({ data: donnees });
              suivi.compteurs.inserees += 1;

              // Detection de contradiction : une autre ligne de la meme formule
              // porte-t-elle le meme composant avec une quantite differente ?
              const autres = await tx.formulaLine.findMany({
                where: {
                  formulaId: formuleId,
                  componentItemId: composant.id,
                  sourceOid: { not: oid },
                },
              });

              for (const autre of autres) {
                if (D.eq(autre.quantity, donnees.quantity)) continue;

                await tx.formulaVariance.create({
                  data: {
                    formulaId: formuleId,
                    formulaLineId: autre.id,
                    componentItemId: composant.id,
                    lineNo: donnees.lineNo,
                    sourceA: autre.importedFrom ?? "ligne existante",
                    valueA: `${D.toFixed(autre.quantity, 6)} (ligne ${autre.lineNo})`,
                    sourceB: contexteLignes.nomFichier,
                    valueB: `${D.toFixed(donnees.quantity, 6)} (ligne ${donnees.lineNo})`,
                    delta: D.toFixed(D.sub(donnees.quantity, autre.quantity), 6),
                    status: "OUVERT",
                  },
                });

                suivi.avertir(
                  `Contradiction de quantite sur le composant ${composant.code} : ${D.toFixed(autre.quantity, 6)} contre ${D.toFixed(donnees.quantity, 6)}. Les deux valeurs sont conservees ; l'administrateur doit trancher dans Nomenclatures > Ecarts.`,
                );
                return true;
              }

              await enregistrerInstantane(
                tx,
                "FORMULA_LINE",
                ligne,
                jobId,
                contexteLignes.nomFichier,
              );
              return false;
            }

            const instantane = await lireInstantane(tx, "FORMULA_LINE", oid);
            const modifieeLocalement =
              instantane && existante.updatedAt.getTime() > instantane.updatedAt.getTime();

            if (modifieeLocalement && !contexteLignes.miseAJourAutorisee) {
              suivi.compteurs.protegees += 1;
              suivi.journaliser(
                ligne,
                `Ligne de nomenclature ${existante.id} modifiee dans la plateforme apres le dernier import : mise a jour refusee.`,
                "PROTEGE",
              );
              return false;
            }

            await tx.formulaLine.update({ where: { id: existante.id }, data: donnees });
            suivi.compteurs.misesAJour += 1;
            await enregistrerInstantane(
              tx,
              "FORMULA_LINE",
              ligne,
              jobId,
              contexteLignes.nomFichier,
            );
            return false;
          },
          { timeout: 30_000 },
        );

        if (ecart) ecartsDetectes += 1;
      } catch (erreur) {
        suivi.rejeter(
          ligne,
          `Ligne de nomenclature : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
        );
      }
    }

    if (ecartsDetectes > 0) {
      messages.push(
        `${ecartsDetectes} contradiction(s) de quantite detectee(s). Elles sont enregistrees au statut « Ouvert » : aucune quantite n'a ete choisie a votre place.`,
      );
    }

    if (suivi.compteurs.ignorees > 0) {
      messages.push(
        `${suivi.compteurs.ignorees} ligne(s) vide(s) dans le fichier source : ignorees, aucune donnee n'etait presente.`,
      );
    }
  } catch (erreur) {
    await cloturerJob(db, jobId, suivi, debut, erreur);
    throw erreur;
  }

  await cloturerJob(db, jobId, suivi, debut);

  await enregistrerAudit({
    action: ACTIONS_AUDIT.CHANGEMENT_NOMENCLATURE,
    module: MODULES_AUDIT.NOMENCLATURE,
    entity: "ImportJob",
    entityId: String(jobId),
    userId: contexteFormules.acteur.id,
    userEmail: contexteFormules.acteur.email,
    newValue: {
      fichiers: [contexteFormules.nomFichier, contexteLignes.nomFichier],
      ...suivi.compteurs,
      ecartsDetectes,
    },
  }, db);

  return {
    jobId,
    fichier: `${contexteFormules.nomFichier} + ${contexteLignes.nomFichier}`,
    entite: "FORMULA",
    compteurs: suivi.compteurs,
    colonnes,
    avertissements: suivi.avertissements,
    messages,
    dureeMs: Date.now() - debut,
    ecartsDetectes,
  };
}

// -----------------------------------------------------------------------------
// Lots et stocks (COM_Batch.csv)
// -----------------------------------------------------------------------------

const COLONNES_LOT = [
  "Oid", "SyncId", "Code", "BatchNum", "Label1", "Item", "ManufactureDate",
  "ExpirationDate", "PurchasePrice", "SalesPrice", "VWAP", "PhysicalQuantity",
  "LogicalQuantity", "DamagedQuantity", "ArrivedQuantity", "ReservedQuantity",
  "DraftQuantity", "Blocked", "BlockedBy", "Status", "Location", "InventoryDate",
  "BlockingReason", "BlockedReservationQuantity", "LastModificationDate",
];

/**
 * Determine la quantite de stock importable d'une ligne COM_Batch.
 *
 * L'export source remplit soit "PhysicalQuantity", soit "LogicalQuantity" :
 * sur les donnees du client "PhysicalQuantity" est vide sur 703 des 706 lignes,
 * et le stock reel figure dans "LogicalQuantity". Lire une seule des deux
 * colonnes aboutissait a un stock nul partout, donc a une plateforme sans
 * matiere disponible alors que la source porte bien le stock.
 *
 * Regle retenue, sans devinette silencieuse :
 *   1. "PhysicalQuantity" des qu'elle porte une valeur exploitable ;
 *   2. sinon "LogicalQuantity" (repli documente, compte et signale au rapport).
 *
 * Un "0" explicite et une case vide ne sont pas equivalents : un 0 declare reste
 * un zero, il n'est jamais remplace par le repli.
 */
function resoudreQuantiteImportee(valeurs: Record<string, string>): {
  quantite: Decimal;
  champSource: "PhysicalQuantity" | "LogicalQuantity";
  repli: boolean;
} {
  const physique = decimal(valeurs.PhysicalQuantity);
  if (physique !== null) {
    return { quantite: physique, champSource: "PhysicalQuantity", repli: false };
  }
  const logique = decimal(valeurs.LogicalQuantity);
  if (logique !== null) {
    return { quantite: logique, champSource: "LogicalQuantity", repli: true };
  }
  return { quantite: D.ZERO, champSource: "PhysicalQuantity", repli: false };
}

export interface ResultatImportStock extends ResultatImport {
  entreesCreees: number;
  correctionsAppliquees: number;
}

/**
 * Importe les lots et les quantites de stock reelles.
 *
 * Les quantites ne sont jamais ecrites directement dans le solde : chaque
 * import produit un mouvement `ENTREE_INITIALE` (ou un mouvement de correction
 * d'inventaire lors d'un nouvel import avec des quantites differentes).
 * Les quantites reservees sont posees via une reservation reelle, les
 * quantites bloquees par un changement de statut qualite.
 */
export async function importerLotsEtStocks(
  contexte: ContexteImport,
  options: { depotParDefautId?: number | null } = {},
): Promise<ResultatImportStock> {
  const debut = Date.now();
  const colonnes = verifierColonnes(contexte.fichier, COLONNES_LOT, ["Oid", "Item"]);
  if (!colonnes.conforme) {
    throw validation(
      "Le fichier des lots ne contient pas les colonnes obligatoires (Oid, Item).",
    );
  }

  const db = contexte.db ?? prisma;

  const jobId = await ouvrirJob(
    db,
    "BATCH",
    contexte.nomFichier,
    contexte.acteur,
    { simulation: contexte.simulation ?? false, depotParDefautId: options.depotParDefautId ?? null },
    contexte.fichier.lignes.length,
  );
  const suivi = new SuiviImport(jobId, "BATCH");
  const messages: string[] = [];
  let entreesCreees = 0;
  let correctionsAppliquees = 0;
  let lotsImportsDepuisLogical = 0;

  const articlesParOid = new Map(
    (
      await db.item.findMany({
        where: { sourceSystem: SYSTEME_SOURCE, sourceOid: { not: null } },
        select: { id: true, sourceOid: true, code: true, unitCode: true, label1: true },
      })
    ).map((article) => [article.sourceOid as number, article]),
  );

  let depotDefautId = options.depotParDefautId ?? null;
  if (!depotDefautId) {
    const depot = await db.warehouse.findFirst({
      where: { code: "DEP-MP" },
      select: { id: true },
    });
    depotDefautId = depot?.id ?? null;
  }
  if (!depotDefautId) {
    throw validation(
      "Aucun depot de destination : créez le depot DEP-MP ou precisez un depot avant l'import des stocks.",
    );
  }

  try {
    for (const ligne of contexte.fichier.lignes) {
      suivi.compteurs.lues += 1;

      const oid = entier(ligne.valeurs.Oid);
      const articleOid = entier(ligne.valeurs.Item);

      if (oid === null || articleOid === null) {
        suivi.rejeter(ligne, "Lot sans identifiant ou sans article.", "Item");
        continue;
      }

      const article = articlesParOid.get(articleOid);
      if (!article) {
        suivi.rejeter(
          ligne,
          `Lot rattache a l'article source ${articleOid}, introuvable. Importez d'abord les articles.`,
          "Item",
        );
        continue;
      }

      const quantiteResolue = resoudreQuantiteImportee(ligne.valeurs);
      const quantitePhysique = quantiteResolue.quantite;
      if (quantiteResolue.repli) lotsImportsDepuisLogical += 1;
      const quantiteReservee = decimal(ligne.valeurs.ReservedQuantity) ?? D.ZERO;
      const quantiteBloquee = decimal(ligne.valeurs.Blocked) ?? D.ZERO;
      const quantiteDetérioree = decimal(ligne.valeurs.DamagedQuantity) ?? D.ZERO;

      try {
        await enTransaction(
          db,
          async (tx) => {
            const numeroLot =
              texte(ligne.valeurs.BatchNum) ??
              texte(ligne.valeurs.Code) ??
              `LOT-SRC-${oid}`;

            let lot = await tx.stockLot.findFirst({
              where: { sourceSystem: SYSTEME_SOURCE, sourceOid: oid },
            });

            if (!lot) {
              const memeNumero = await tx.stockLot.findFirst({
                where: { lotNumber: numeroLot, itemId: article.id },
              });
              if (!memeNumero) {
                lot = await tx.stockLot.create({
                  data: {
                    itemId: article.id,
                    warehouseId: depotDefautId!,
                    lotNumber: numeroLot,
                    status: "LIBRE",
                    manufactureDate: date(ligne.valeurs.ManufactureDate),
                    expirationDate: date(ligne.valeurs.ExpirationDate),
                    inventoryDate: date(ligne.valeurs.InventoryDate),
                    blockingReason: texte(ligne.valeurs.BlockingReason),
                    sourceSystem: SYSTEME_SOURCE,
                    sourceOid: oid,
                    sourceSyncId: texte(ligne.valeurs.SyncId),
                  },
                });
              } else {
                await tx.stockLot.update({
                  where: { id: memeNumero.id },
                  data: {
                    sourceSystem: SYSTEME_SOURCE,
                    sourceOid: oid,
                    sourceSyncId: texte(ligne.valeurs.SyncId),
                  },
                });
                lot = memeNumero;
              }
            }

            const instantane = await lireInstantane(tx, "BATCH", oid);
            const dejaImporte = instantane?.payload
              ? ((instantane.payload as Record<string, unknown>)
                  ._quantiteImportee as string | undefined)
              : undefined;

            if (dejaImporte === undefined) {
              // Premier import de ce lot : entree initiale du stock physique.
              if (D.gt(quantitePhysique, 0)) {
                await enregistrerMouvement(tx, {
                  type: "ENTREE_INITIALE",
                  itemId: article.id,
                  warehouseId: lot.warehouseId,
                  lotId: lot.id,
                  quantity: quantitePhysique,
                  unitCost: decimal(ligne.valeurs.VWAP) ?? D.ZERO,
                  unitCode: article.unitCode,
                  documentType: "IMPORT",
                  documentId: String(jobId),
                  documentNumber: contexte.nomFichier,
                  comment: `Stock initial importe depuis ${contexte.nomFichier} (lot ${numeroLot})`,
                  reason: "Import des donnees sources",
                  acteur: contexte.acteur,
                  ignorerControleStatut: true,
                });
                entreesCreees += 1;
              }

              if (D.gt(quantiteReservee, 0)) {
                await reserverStock(tx, {
                  itemId: article.id,
                  warehouseId: lot.warehouseId,
                  lotId: lot.id,
                  quantity: quantiteReservee,
                  documentType: "IMPORT",
                  documentId: String(jobId),
                  acteur: contexte.acteur,
                });
              }

              if (D.gt(quantiteBloquee, 0)) {
                await changerStatutStock(tx, {
                  itemId: article.id,
                  warehouseId: lot.warehouseId,
                  lotId: lot.id,
                  quantity: quantiteBloquee,
                  de: "LIBRE",
                  vers: "BLOQUE",
                  type: "MISE_EN_QUARANTAINE",
                  comment: `Quantite bloquee constatee dans la source (lot ${numeroLot})`,
                  reason: texte(ligne.valeurs.BlockingReason) ?? "Blocage indique dans la source",
                  documentType: "IMPORT",
                  documentId: String(jobId),
                  acteur: contexte.acteur,
                });
              }

              if (D.gt(quantiteDetérioree, 0)) {
                await changerStatutStock(tx, {
                  itemId: article.id,
                  warehouseId: lot.warehouseId,
                  lotId: lot.id,
                  quantity: quantiteDetérioree,
                  de: "LIBRE",
                  vers: "REBUT",
                  type: "REBUT",
                  comment: `Quantite deterioree constatee dans la source (lot ${numeroLot})`,
                  reason: "Quantite deterioree declaree dans la source",
                  documentType: "IMPORT",
                  documentId: String(jobId),
                  acteur: contexte.acteur,
                });
              }

              suivi.compteurs.inserees += 1;
            } else {
              // Re-import : seul l'ecart constate produit un mouvement trace.
              //
              // La comparaison se fait a la precision de stockage de la base
              // (6 decimales). L'export source porte des artefacts flottants
              // (« 0.4400000000000013 » pour 0,44) : comparer la valeur brute
              // produisait un ecart infinitesimal, donc un mouvement de
              // correction arrondi a zero, sans aucun effet sur le stock.
              const ancienne = D.round(D.of(dejaImporte), 6);
              const ecart = D.sub(D.round(quantitePhysique, 6), ancienne);

              if (!ecart.isZero()) {
                await enregistrerMouvement(tx, {
                  type: "CORRECTION_INVENTAIRE",
                  itemId: article.id,
                  warehouseId: lot.warehouseId,
                  lotId: lot.id,
                  quantity: ecart,
                  unitCost: decimal(ligne.valeurs.VWAP) ?? D.ZERO,
                  unitCode: article.unitCode,
                  documentType: "IMPORT",
                  documentId: String(jobId),
                  documentNumber: contexte.nomFichier,
                  comment: `Correction d'inventaire entre la source et la base (lot ${numeroLot})`,
                  reason: `Nouvel import de ${contexte.nomFichier} : la source indique ${D.toFixed(quantitePhysique, 6)} contre ${D.toFixed(ancienne, 6)} en base.`,
                  justification:
                    "Ecart entre deux importations successives. Aucune quantite n'a ete ecrasee : la difference est enregistree comme mouvement de correction.",
                  acteur: contexte.acteur,
                  autoriserNegatif: true,
                  ignorerControleStatut: true,
                });
                correctionsAppliquees += 1;

                suivi.journaliser(
                  ligne,
                  `Ecart d'import sur le lot ${numeroLot} : ${D.toFixed(ecart, 6)} (mouvement de correction cree).`,
                  "MIS_A_JOUR",
                  quantiteResolue.champSource,
                );
              }
              suivi.compteurs.misesAJour += 1;
            }

            await tx.importRowSnapshot.upsert({
              where: {
                sourceSystem_sourceEntity_sourceOid: {
                  sourceSystem: SYSTEME_SOURCE,
                  sourceEntity: "BATCH",
                  sourceOid: oid,
                },
              },
              create: {
                sourceSystem: SYSTEME_SOURCE,
                sourceEntity: "BATCH",
                sourceOid: oid,
                sourceSyncId: texte(ligne.valeurs.SyncId),
                fileName: contexte.nomFichier,
                jobId,
                payload: {
                  ...ligne.valeurs,
                  _quantiteImportee: D.toFixed(quantitePhysique, 6),
                } as Prisma.InputJsonValue,
              },
              update: {
                sourceSyncId: texte(ligne.valeurs.SyncId),
                fileName: contexte.nomFichier,
                jobId,
                payload: {
                  ...ligne.valeurs,
                  _quantiteImportee: D.toFixed(quantitePhysique, 6),
                } as Prisma.InputJsonValue,
              },
            });
          },
          { timeout: 60_000 },
        );
      } catch (erreur) {
        suivi.rejeter(
          ligne,
          `Lot ${texte(ligne.valeurs.BatchNum) ?? oid} : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
        );
      }
    }

    if (lotsImportsDepuisLogical > 0) {
      suivi.avertir(
        `${lotsImportsDepuisLogical} lot(s) importe(s) depuis la colonne « LogicalQuantity » : ` +
          `« PhysicalQuantity » est vide ou absente dans ${contexte.nomFichier}. ` +
          "Le stock provient donc de la quantite logique. Confirmez que cette colonne " +
          "represente bien le stock physique de l'ancien ERP avant d'exploiter ces soldes.",
      );
    }

    // Controle final : la somme du grand livre doit correspondre aux soldes.
    const verification = await prisma.$queryRaw<
      { itemId: number; warehouseId: number; solde: string; mouvement: string }[]
    >`
      SELECT b."itemId", b."warehouseId",
             SUM(b."quantityPhysical")::text AS solde,
             COALESCE((SELECT SUM(m."quantity") FROM "StockMovement" m
                       WHERE m."itemId" = b."itemId" AND m."warehouseId" = b."warehouseId"
                         AND m."status" = 'LIBRE'), 0)::text AS mouvement
      FROM "StockBalance" b
      WHERE b."status" = 'LIBRE'
      GROUP BY b."itemId", b."warehouseId"`;

    const incoherents = verification.filter(
      (ligne) => !D.eq(ligne.solde, ligne.mouvement),
    );

    if (incoherents.length > 0) {
      suivi.avertir(
        `${incoherents.length} solde(s) divergent(es) entre le grand livre des mouvements et les soldes agreges. Aucune ecriture directe n'a ete effectuee : ces ecarts proviennent d'operations anterieures et doivent etre analyses.`,
      );
    } else {
      messages.push(
        "Controle d'integrite : les soldes agreges correspondent au grand livre des mouvements.",
      );
    }

    messages.push(
      `${entreesCreees} entree(s) initiale(s) et ${correctionsAppliquees} correction(s) enregistrees sous forme de mouvements de stock traces.`,
    );
  } catch (erreur) {
    await cloturerJob(db, jobId, suivi, debut, erreur);
    throw erreur;
  }

  await cloturerJob(db, jobId, suivi, debut);

  await enregistrerAudit({
    action: ACTIONS_AUDIT.IMPORT,
    module: MODULES_AUDIT.IMPORT,
    entity: "ImportJob",
    entityId: String(jobId),
    userId: contexte.acteur.id,
    userEmail: contexte.acteur.email,
    newValue: {
      fichier: contexte.nomFichier,
      entite: "BATCH",
      ...suivi.compteurs,
      entreesCreees,
      correctionsAppliquees,
    },
  }, db);

  return {
    jobId,
    fichier: contexte.nomFichier,
    entite: "BATCH",
    compteurs: suivi.compteurs,
    colonnes,
    avertissements: suivi.avertissements,
    messages,
    dureeMs: Date.now() - debut,
    entreesCreees,
    correctionsAppliquees,
  };
}

// -----------------------------------------------------------------------------
// Analyse prealable d'un dossier source
// -----------------------------------------------------------------------------

export interface AnalyseFichier {
  fichier: string;
  present: boolean;
  chemin: string;
  separateur: string | null;
  encodage: string | null;
  nombreLignes: number;
  colonnes: RapportColonnes | null;
  message: string;
}

const COLONNES_ATTENDUES: Record<string, string[]> = {
  [FICHIERS_SOURCE.ITEM_FAMILY]: COLONNES_FAMILLE,
  [FICHIERS_SOURCE.ITEM]: COLONNES_ARTICLE,
  [FICHIERS_SOURCE.FORMULA]: COLONNES_FORMULE,
  [FICHIERS_SOURCE.FORMULA_LINE]: COLONNES_LIGNE_NOMENCLATURE,
  [FICHIERS_SOURCE.BATCH]: COLONNES_LOT,
  [FICHIERS_SOURCE.THIRD_PARTY]: COLONNES_TIERS,
};

export interface AnalyseDossier {
  dossier: string;
  fichiers: AnalyseFichier[];
  pret: boolean;
  fichiersManquants: string[];
}

/**
 * Analyse le dossier source et produit le rapport de correspondance des
 * colonnes, sans rien importer. C'est l'etape presentee a l'administrateur
 * avant tout import.
 */
export function analyserDossierSource(dossier: string): AnalyseDossier {
  const fichiers: AnalyseFichier[] = [];
  const manquants: string[] = [];

  for (const [entite, nom] of Object.entries(FICHIERS_SOURCE)) {
    const chemin = join(dossier, nom);

    if (!existsSync(chemin)) {
      manquants.push(nom);
      fichiers.push({
        fichier: nom,
        present: false,
        chemin,
        separateur: null,
        encodage: null,
        nombreLignes: 0,
        colonnes: null,
        message: "Fichier absent : cette entite ne sera pas importee.",
      });
      continue;
    }

    const fichier = lireFichierCsv(chemin, { encodage: "auto" });
    const attendues = COLONNES_ATTENDUES[nom];
    const colonnes = attendues ? verifierColonnes(fichier, attendues) : null;

    fichiers.push({
      fichier: nom,
      present: true,
      chemin,
      separateur: fichier.separateur,
      encodage: fichier.encodage,
      nombreLignes: fichier.lignes.length,
      colonnes,
      message:
        fichier.lignes.length === 0
          ? "Fichier present mais sans ligne de donnees : rien a importer."
          : colonnes && !colonnes.conforme
            ? "Colonnes obligatoires manquantes : import impossible pour cette entite."
            : "Pret a etre importe.",
    });

    if (fichier.lignes.length === 0) manquants.push(nom);
  }

  return {
    dossier,
    fichiers,
    pret: manquants.length === 0,
    fichiersManquants: manquants,
  };
}

/** Lit un fichier source du dossier par son nom logique. */
export function lireSource(dossier: string, nom: string): FichierCsv {
  const chemin = join(dossier, nom);
  if (!existsSync(chemin)) {
    throw validation(`Le fichier source « ${nom} » est introuvable dans ${dossier}.`);
  }
  return lireFichierCsv(chemin, { encodage: "auto" });
}

/**
 * Cree un contexte d'import a partir d'un contenu deja charge en memoire
 * (utilise par l'ecran d'import de l'application).
 */
export function contexteDepuisContenu(
  contenu: string,
  nomFichier: string,
  acteur: ActeurStock,
  options: { miseAJourAutorisee?: boolean; simulation?: boolean } = {},
): ContexteImport {
  return {
    acteur,
    fichier: analyserCsv(contenu),
    nomFichier: basename(nomFichier),
    miseAJourAutorisee: options.miseAJourAutorisee ?? false,
    simulation: options.simulation ?? false,
  };
}

// -----------------------------------------------------------------------------
// Gestion des correspondances
// -----------------------------------------------------------------------------

export async function listerCorrespondances(filtres: {
  sourceEntity?: string;
  confirmees?: boolean;
} = {}) {
  return prisma.importValueMapping.findMany({
    where: {
      ...(filtres.sourceEntity ? { sourceEntity: filtres.sourceEntity } : {}),
      ...(filtres.confirmees === undefined ? {} : { isConfirmed: filtres.confirmees }),
    },
    orderBy: [{ sourceEntity: "asc" }, { sourceField: "asc" }, { sourceValue: "asc" }],
  });
}

export async function definirCorrespondance(
  entree: {
    sourceEntity: string;
    sourceField: string;
    sourceValue: string;
    targetValue: string;
    label?: string;
    comment?: string;
  },
  acteur: ActeurStock,
) {
  const ancienne = await prisma.importValueMapping.findUnique({
    where: {
      sourceEntity_sourceField_sourceValue: {
        sourceEntity: entree.sourceEntity,
        sourceField: entree.sourceField,
        sourceValue: entree.sourceValue,
      },
    },
  });

  const enregistrement = await prisma.importValueMapping.upsert({
    where: {
      sourceEntity_sourceField_sourceValue: {
        sourceEntity: entree.sourceEntity,
        sourceField: entree.sourceField,
        sourceValue: entree.sourceValue,
      },
    },
    create: {
      sourceEntity: entree.sourceEntity,
      sourceField: entree.sourceField,
      sourceValue: entree.sourceValue,
      targetValue: entree.targetValue,
      label: entree.label ?? null,
      comment: entree.comment ?? null,
      isConfirmed: true,
    },
    update: {
      targetValue: entree.targetValue,
      label: entree.label ?? ancienne?.label ?? null,
      comment: entree.comment ?? ancienne?.comment ?? null,
      isConfirmed: true,
    },
  });

  await enregistrerAudit({
    action: ACTIONS_AUDIT.MODIFICATION,
    module: MODULES_AUDIT.IMPORT,
    entity: "ImportValueMapping",
    entityId: String(enregistrement.id),
    userId: acteur.id,
    userEmail: acteur.email,
    oldValue: ancienne ? { cible: ancienne.targetValue, confirmee: ancienne.isConfirmed } : null,
    newValue: { cible: entree.targetValue, confirmee: true },
    comment: entree.comment ?? "Confirmation d'une correspondance d'import",
  });

  return enregistrement;
}

/** Numero d'import lisible, journalise avec chaque execution. */
export async function numeroImport(): Promise<string> {
  return prochainNumero(SEQUENCES.IMPORT);
}
