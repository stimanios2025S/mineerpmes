"use server";

import { revalidatePath } from "next/cache";
import type {
  Factory,
  FormulaStatus,
  RouteStatus,
} from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D } from "@/lib/decimal";
import { conflit, etatInvalide, nonTrouve, validation } from "@/lib/errors";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  LIBELLES_STATUT_ECART_NOMENCLATURE,
  LIBELLES_STATUT_GAMME,
  LIBELLES_STATUT_NOMENCLATURE,
  libelle,
} from "@/lib/libelles";
import {
  booleen,
  dateOuNull,
  decimalObligatoire,
  decimalOuNull,
  entierOu,
  executer,
  texteObligatoire,
  texteOuNull,
  type ResultatAction,
} from "@/lib/actions/resultat";

/**
 * Actions serveur du module Nomenclature et gammes.
 *
 * Deux regles metier structurent ce fichier :
 *
 *  1. Une nomenclature utilisee ne se modifie JAMAIS en silence. Des qu'une
 *     version quitte le brouillon, ses composants sont figes : toute evolution
 *     passe par la creation d'une nouvelle version, qui copie les lignes puis
 *     repart au statut BROUILLON. L'ancienne version passe a REMPLACEE a la
 *     creation de sa remplacante, puis a ARCHIVEE a l'activation de celle-ci.
 *
 *  2. Une contradiction de quantite ne se tranche jamais toute seule. Les
 *     ecarts (`FormulaVariance`) conservent les deux valeurs d'origine ; seule
 *     une decision explicite et motivee de l'administrateur les resout. Aucune
 *     ligne de nomenclature n'est reecrite par l'arbitrage : l'historique
 *     d'origine reste consultable tel quel.
 *
 * Les ecritures de referentiel passent directement par `prisma` (aucun
 * mouvement de stock n'est genere ici), dans une transaction qui porte aussi la
 * trace d'audit.
 */

interface Acteur {
  id: number;
  email: string;
}

// -----------------------------------------------------------------------------
// Aides de saisie
// -----------------------------------------------------------------------------

/** Identifiant obligatoire issu d'un formulaire. */
function identifiantObligatoire(
  formData: FormData,
  champ: string,
  libelleChamp: string,
): number {
  const valeur = entierOu(formData.get(champ), null);
  if (valeur === null || valeur <= 0) {
    throw validation(`Le champ « ${libelleChamp} » est obligatoire.`, {
      [champ]: `Selectionnez ${libelleChamp}.`,
    });
  }
  return valeur;
}

/**
 * Motif ecrit obligatoire. Toute decision d'arbitrage ou de cycle de vie est
 * justifiee : une trace d'audit sans motif ne permet aucun controle ulterieur.
 */
function motifObligatoire(formData: FormData, libelleChamp: string, minimum = 10): string {
  const motif = texteObligatoire(formData.get("motif"), libelleChamp);
  if (motif.length < minimum) {
    throw validation(
      `Le motif « ${libelleChamp} » doit comporter au moins ${minimum} caracteres.`,
      { motif: `Motif trop court (${motif.length} caractere(s) sur ${minimum} exiges).` },
    );
  }
  return motif;
}

/** Decimal de formulaire non negatif, avec 0 par defaut. */
function decimalPositifOuZero(
  formData: FormData,
  champ: string,
  libelleChamp: string,
): string {
  const valeur = decimalOuNull(formData.get(champ)) ?? "0";
  if (D.lt(valeur, 0)) {
    throw validation(`Le champ « ${libelleChamp} » ne peut pas etre negatif.`, {
      [champ]: "Une valeur negative n'a pas de sens ici.",
    });
  }
  return valeur;
}

/** Verifie qu'un depot existe avant de le rattacher a une nomenclature. */
async function verifierDepot(
  db: Db,
  depotId: number | null,
  libelleChamp: string,
): Promise<void> {
  if (depotId === null) return;
  const depot = await db.warehouse.findUnique({
    where: { id: depotId },
    select: { id: true, code: true },
  });
  if (!depot) {
    throw validation(`Le depot renseigne pour « ${libelleChamp} » est introuvable.`, {
      depot: "Depot inconnu.",
    });
  }
}

const STATUTS_FORMULE_FIGES: readonly FormulaStatus[] = [
  "EN_VALIDATION",
  "VALIDEE",
  "ACTIVE",
  "REMPLACEE",
  "ARCHIVEE",
];

/**
 * Charge une nomenclature et refuse toute ecriture de ligne des qu'elle n'est
 * plus un brouillon. Le refus est motive : l'interface affiche ce message tel
 * quel et explique la marche a suivre (creer une nouvelle version).
 */
async function chargerFormuleBrouillon(
  db: Db,
  formulaId: number,
): Promise<{ id: number; code: string; version: number; itemId: number; status: FormulaStatus }> {
  const formule = await db.formula.findUnique({
    where: { id: formulaId },
    select: { id: true, code: true, version: true, itemId: true, status: true },
  });
  if (!formule) throw nonTrouve("La nomenclature");
  if (STATUTS_FORMULE_FIGES.includes(formule.status)) {
    throw etatInvalide(
      `Les composants de la nomenclature ${formule.code} version ${formule.version} ne sont plus modifiables : cette version est au statut « ${libelle(
        LIBELLES_STATUT_NOMENCLATURE,
        formule.status,
      )} ». Pour faire evoluer la formulation, creez une nouvelle version a partir de cette fiche : les ordres de fabrication deja lances continueront de consommer la version figee.`,
    );
  }
  return formule;
}

/**
 * Extrait la quantite exploitable d'une valeur de source d'ecart.
 * Les sources importees sont stockees sous la forme « 12.500000 (ligne 3) ».
 * Si la tete n'est pas un nombre lisible, on ne devine rien : le validateur
 * devra saisir lui-meme la quantite arbitree.
 */
function quantiteDeSource(valeur: string | null): string | null {
  if (!valeur) return null;
  const trouvee = valeur.trim().match(/^-?\d+(?:[.,]\d+)?/);
  if (!trouvee) return null;
  const normalisee = trouvee[0].replace(",", ".");
  return Number.isFinite(Number(normalisee)) ? normalisee : null;
}

// =============================================================================
// 1. Nomenclatures — creation
// =============================================================================

export async function actionCreerNomenclature(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_ECRIRE);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer(
    "La nomenclature a ete creee au statut brouillon. Ajoutez ses composants, puis soumettez-la a validation.",
    async () => {
      const itemId = identifiantObligatoire(formData, "articleId", "l'article parent");
      const code = texteObligatoire(formData.get("code"), "code de la nomenclature");
      const label = texteObligatoire(formData.get("libelle"), "libelle");
      const version = entierOu(formData.get("version"), 1) ?? 1;
      if (version < 1) {
        throw validation(
          "Le numero de version doit etre un entier superieur ou egal a 1.",
          { version: "Version invalide." },
        );
      }

      const effectiveFrom = dateOuNull(formData.get("dateEffet"));
      const effectiveTo = dateOuNull(formData.get("dateFin"));
      if (effectiveFrom && effectiveTo && effectiveTo.getTime() < effectiveFrom.getTime()) {
        throw validation(
          "La date de fin ne peut pas preceder la date d'effet : la periode d'application serait vide.",
          { dateFin: "Date de fin anterieure a la date d'effet." },
        );
      }

      const warehouseStoreId = entierOu(formData.get("depotConsommation"), null);
      const warehouseProdId = entierOu(formData.get("depotProduction"), null);
      const notes = texteOuNull(formData.get("notes"));

      const creee = await prisma.$transaction(async (tx) => {
        const article = await tx.item.findUnique({
          where: { id: itemId },
          select: { id: true, code: true },
        });
        if (!article) throw nonTrouve("L'article parent");

        const doublon = await tx.formula.findFirst({
          where: { itemId, version },
          select: { id: true },
        });
        if (doublon) {
          throw conflit(
            `L'article ${article.code} possede deja une nomenclature de version ${version} (n° ${doublon.id}). Choisissez un autre numero de version, ou creez une nouvelle version depuis la fiche existante.`,
          );
        }

        await verifierDepot(tx, warehouseStoreId, "depot de consommation");
        await verifierDepot(tx, warehouseProdId, "depot de production");

        const formule = await tx.formula.create({
          data: {
            itemId,
            code,
            label,
            version,
            status: "BROUILLON",
            effectiveFrom,
            effectiveTo,
            warehouseStoreId,
            warehouseProdId,
            notes,
          },
        });

        await enregistrerAudit(
          {
            action: ACTIONS_AUDIT.CREATION,
            module: MODULES_AUDIT.NOMENCLATURE,
            entity: "Formula",
            entityId: formule.id,
            userId: acteur.id,
            userEmail: acteur.email,
            newValue: formule,
            comment: `Creation de la nomenclature ${formule.code} version ${formule.version} pour l'article ${article.code}`,
          },
          tx,
        );

        return formule;
      });

      revalidatePath("/nomenclature");
      return { id: creee.id };
    },
  );
}

// =============================================================================
// 2. Nomenclatures — composants (brouillon uniquement)
// =============================================================================

/** Champs communs d'une ligne de nomenclature, verifies contre le referentiel. */
async function champsLigneNomenclature(db: Db, formData: FormData) {
  const composantId = identifiantObligatoire(formData, "composantId", "l'article composant");

  const quantite = decimalObligatoire(formData.get("quantite"), "quantite");
  if (D.lte(quantite, 0)) {
    throw validation("La quantite du composant doit etre strictement positive.", {
      quantite: "Saisissez une quantite superieure a zero.",
    });
  }

  const tauxPerte = decimalPositifOuZero(formData, "tauxPerte", "taux de perte prevu");
  const tauxRebut = decimalPositifOuZero(formData, "tauxRebut", "taux de rebut");

  const composant = await db.item.findUnique({
    where: { id: composantId },
    select: { id: true, code: true, unitCode: true },
  });
  if (!composant) {
    throw validation("L'article composant selectionne est introuvable.", {
      composantId: "Article inconnu.",
    });
  }

  // L'unite par defaut est celle de l'article ; une unite explicite doit
  // appartenir au referentiel des unites.
  const uniteSaisie = texteOuNull(formData.get("unite"));
  const unitCode = uniteSaisie ?? composant.unitCode;
  if (unitCode !== null) {
    const unite = await db.unitOfMeasure.findUnique({
      where: { code: unitCode },
      select: { code: true },
    });
    if (!unite) {
      throw validation(
        `L'unite « ${unitCode} » n'existe pas dans le referentiel des unites.`,
        { unite: "Unite inconnue." },
      );
    }
  }

  // L'operation de consommation est un code d'operation : il doit exister, sans
  // quoi l'eclatement en atelier serait impossible au lancement.
  const operationCode = texteOuNull(formData.get("operation"));
  if (operationCode !== null) {
    const operation = await db.operation.findUnique({
      where: { code: operationCode },
      select: { code: true },
    });
    if (!operation) {
      throw validation(
        `L'operation de consommation « ${operationCode} » n'existe pas dans le referentiel des operations.`,
        { operation: "Operation inconnue." },
      );
    }
  }

  const consumptionWarehouseId = entierOu(formData.get("depotConsommation"), null);
  await verifierDepot(db, consumptionWarehouseId, "depot de consommation de la ligne");

  // Le cout n'est volontairement PAS fige ici : le cout matiere theorique est
  // recalcule a l'affichage a partir du cout moyen reel (VWAP) des articles, et
  // non d'un instantane qui vieillirait sans que personne ne le voie.
  return {
    componentItemId: composantId,
    quantity: D.roundQuantity(quantite),
    unitCode,
    lossRate: D.roundRate(tauxPerte),
    scrapRate: D.roundRate(tauxRebut),
    operationCode,
    consumptionWarehouseId,
    notes: texteOuNull(formData.get("notes")),
  };
}

export async function actionAjouterComposant(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_ECRIRE);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("Le composant a ete ajoute a la nomenclature.", async () => {
    const formulaId = identifiantObligatoire(formData, "formulaId", "la nomenclature");

    const ligne = await prisma.$transaction(async (tx) => {
      const formule = await chargerFormuleBrouillon(tx, formulaId);
      const champs = await champsLigneNomenclature(tx, formData);

      const lineNoSaisi = entierOu(formData.get("lineNo"), null);
      let lineNo = lineNoSaisi;
      if (lineNo === null) {
        const derniere = await tx.formulaLine.findFirst({
          where: { formulaId },
          orderBy: { lineNo: "desc" },
          select: { lineNo: true },
        });
        lineNo = (derniere?.lineNo ?? 0) + 1;
      } else if (lineNo < 1) {
        throw validation("L'ordre d'affichage doit etre un entier superieur ou egal a 1.", {
          lineNo: "Ordre invalide.",
        });
      }

      const creee = await tx.formulaLine.create({
        data: { formulaId, lineNo, ...champs },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.NOMENCLATURE,
          entity: "FormulaLine",
          entityId: creee.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: creee,
          comment: `Ajout du composant n° ${creee.componentItemId} sur la nomenclature ${formule.code} version ${formule.version} (ligne ${creee.lineNo})`,
        },
        tx,
      );

      return creee;
    });

    revalidatePath(`/nomenclature/${formulaId}`);
    revalidatePath("/nomenclature");
    return { id: ligne.id };
  });
}

export async function actionModifierComposant(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_ECRIRE);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("Le composant a ete mis a jour.", async () => {
    const ligneId = identifiantObligatoire(formData, "ligneId", "le composant");

    const resultat = await prisma.$transaction(async (tx) => {
      const existante = await tx.formulaLine.findUnique({
        where: { id: ligneId },
        select: { id: true, formulaId: true, lineNo: true },
      });
      if (!existante) throw nonTrouve("Le composant de nomenclature");

      const formule = await chargerFormuleBrouillon(tx, existante.formulaId);
      const champs = await champsLigneNomenclature(tx, formData);

      const lineNoSaisi = entierOu(formData.get("lineNo"), existante.lineNo) ?? existante.lineNo;
      if (lineNoSaisi < 1) {
        throw validation("L'ordre d'affichage doit etre un entier superieur ou egal a 1.", {
          lineNo: "Ordre invalide.",
        });
      }

      const modifiee = await tx.formulaLine.update({
        where: { id: ligneId },
        data: { ...champs, lineNo: lineNoSaisi },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.NOMENCLATURE,
          entity: "FormulaLine",
          entityId: modifiee.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: existante,
          newValue: modifiee,
          comment: `Modification de la ligne ${modifiee.lineNo} de la nomenclature ${formule.code} version ${formule.version}`,
        },
        tx,
      );

      return { formule, ligne: modifiee };
    });

    revalidatePath(`/nomenclature/${resultat.formule.id}`);
    return { id: resultat.ligne.id };
  });
}

/**
 * Retrait d'un composant d'un brouillon.
 *
 * La ligne appartient a une version jamais validee : sa suppression ne detruit
 * aucune donnee figee. En revanche, si la ligne est citée par un ecart de
 * quantite, la suppression est refusee : l'ecart constitue la trace d'origine
 * d'une contradiction, et cette trace n'est jamais effacee.
 */
export async function actionRetirerComposant(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_ECRIRE);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("Le composant a ete retire du brouillon.", async () => {
    const ligneId = identifiantObligatoire(formData, "ligneId", "le composant");

    const formulaId = await prisma.$transaction(async (tx) => {
      const existante = await tx.formulaLine.findUnique({
        where: { id: ligneId },
        include: { componentItem: { select: { code: true, label1: true } } },
      });
      if (!existante) throw nonTrouve("Le composant de nomenclature");

      const formule = await chargerFormuleBrouillon(tx, existante.formulaId);

      const ecarts = await tx.formulaVariance.count({
        where: { formulaLineId: ligneId },
      });
      if (ecarts > 0) {
        throw etatInvalide(
          `La ligne ${existante.lineNo} (${existante.componentItem.code}) est citee par ${ecarts} ecart(s) de quantite. Ces ecarts conservent les valeurs d'origine et ne sont jamais effaces : arbitrez-les d'abord depuis Nomenclatures > Ecarts, puis retirez la ligne.`,
        );
      }

      await tx.formulaLine.delete({ where: { id: ligneId } });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.SUPPRESSION_LOGIQUE,
          module: MODULES_AUDIT.NOMENCLATURE,
          entity: "FormulaLine",
          entityId: ligneId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: existante,
          comment: `Retrait du composant ${existante.componentItem.code} (ligne ${existante.lineNo}) du brouillon ${formule.code} version ${formule.version}`,
        },
        tx,
      );

      return formule.id;
    });

    revalidatePath(`/nomenclature/${formulaId}`);
    revalidatePath("/nomenclature");
    return { id: ligneId };
  });
}

// =============================================================================
// 3. Nomenclatures — cycle de vie de la version
// =============================================================================

async function chargerFormule(db: Db, formulaId: number) {
  const formule = await db.formula.findUnique({
    where: { id: formulaId },
    include: { item: { select: { id: true, code: true, label1: true } } },
  });
  if (!formule) throw nonTrouve("La nomenclature");
  return formule;
}

export async function actionSoumettreNomenclature(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_VALIDER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer(
    "La version a ete soumise a validation. Ses composants sont desormais figes jusqu'a la decision du valideur.",
    async () => {
      const formulaId = identifiantObligatoire(formData, "formulaId", "la nomenclature");

      const formule = await prisma.$transaction(async (tx) => {
        const existante = await chargerFormule(tx, formulaId);
        if (existante.status !== "BROUILLON") {
          throw etatInvalide(
            `Seule une nomenclature au statut « ${libelle(LIBELLES_STATUT_NOMENCLATURE, "BROUILLON")} » peut etre soumise a validation. La version ${existante.version} est au statut « ${libelle(LIBELLES_STATUT_NOMENCLATURE, existante.status)} ».`,
          );
        }

        const nombreLignes = await tx.formulaLine.count({ where: { formulaId } });
        if (nombreLignes === 0) {
          throw etatInvalide(
            "Une nomenclature sans aucun composant ne peut pas etre soumise a validation : ajoutez au moins une ligne avant de continuer.",
          );
        }

        const modifiee = await tx.formula.update({
          where: { id: formulaId },
          data: { status: "EN_VALIDATION" },
        });

        await enregistrerAudit(
          {
            action: ACTIONS_AUDIT.MODIFICATION,
            module: MODULES_AUDIT.NOMENCLATURE,
            entity: "Formula",
            entityId: modifiee.id,
            userId: acteur.id,
            userEmail: acteur.email,
            oldValue: { status: existante.status },
            newValue: { status: modifiee.status },
            comment: `Soumission a validation de la nomenclature ${modifiee.code} version ${modifiee.version} (${nombreLignes} composant(s))`,
          },
          tx,
        );

        return modifiee;
      });

      revalidatePath("/nomenclature");
      revalidatePath(`/nomenclature/${formule.id}`);
      return { id: formule.id };
    },
  );
}

export async function actionValiderNomenclature(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_VALIDER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer(
    "La version a ete validee. Elle peut maintenant etre activee pour la production.",
    async () => {
      const formulaId = identifiantObligatoire(formData, "formulaId", "la nomenclature");
      const motif = texteOuNull(formData.get("motif"));

      const formule = await prisma.$transaction(async (tx) => {
        const existante = await chargerFormule(tx, formulaId);
        if (existante.status !== "EN_VALIDATION") {
          throw etatInvalide(
            `Seule une nomenclature au statut « ${libelle(LIBELLES_STATUT_NOMENCLATURE, "EN_VALIDATION")} » peut etre validee. La version ${existante.version} est au statut « ${libelle(LIBELLES_STATUT_NOMENCLATURE, existante.status)} ».`,
          );
        }

        const modifiee = await tx.formula.update({
          where: { id: formulaId },
          data: {
            status: "VALIDEE",
            approvedById: acteur.id,
            approvedAt: new Date(),
          },
        });

        await enregistrerAudit(
          {
            action: ACTIONS_AUDIT.VALIDATION,
            module: MODULES_AUDIT.NOMENCLATURE,
            entity: "Formula",
            entityId: modifiee.id,
            userId: acteur.id,
            userEmail: acteur.email,
            oldValue: { status: existante.status },
            newValue: {
              status: modifiee.status,
              approvedById: modifiee.approvedById,
              approvedAt: modifiee.approvedAt,
            },
            comment: `Validation de la nomenclature ${modifiee.code} version ${modifiee.version}`,
            reason: motif,
          },
          tx,
        );

        return modifiee;
      });

      revalidatePath("/nomenclature");
      revalidatePath(`/nomenclature/${formule.id}`);
      return { id: formule.id };
    },
  );
}

/**
 * Activation : la version devient la version de production de l'article.
 * Toute autre version active du meme article est archivee au meme instant,
 * sinon deux nomenclatures concurrentes resteraient actives en production.
 * Les ordres de fabrication en cours gardent la version qui leur a ete figee :
 * leur `formulaId` n'est jamais reecrit.
 */
export async function actionActiverNomenclature(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_VALIDER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer(
    "La version a ete activee : elle devient la nomenclature de production de l'article, et les versions concurrentes ont ete archivees.",
    async () => {
      const formulaId = identifiantObligatoire(formData, "formulaId", "la nomenclature");

      const formule = await prisma.$transaction(async (tx) => {
        const existante = await chargerFormule(tx, formulaId);
        if (existante.status !== "VALIDEE") {
          throw etatInvalide(
            `Seule une nomenclature au statut « ${libelle(LIBELLES_STATUT_NOMENCLATURE, "VALIDEE")} » peut etre activee. La version ${existante.version} est au statut « ${libelle(LIBELLES_STATUT_NOMENCLATURE, existante.status)} ».`,
          );
        }

        const lignes = await tx.formulaLine.count({ where: { formulaId } });
        if (lignes === 0) {
          throw etatInvalide(
            "Une nomenclature sans composant ne peut pas etre activee.",
          );
        }

        // Versions encore actives ou deja remplacees du meme article : elles sont
        // archivees, jamais supprimees. La version remplacee lors de la creation
        // de celle-ci termine donc son cycle (REMPLACEE puis ARCHIVEE) et reste
        // consultable, rattachee aux ordres de fabrication qui l'ont consommee.
        const concurrentes = await tx.formula.findMany({
          where: {
            itemId: existante.itemId,
            status: { in: ["ACTIVE", "REMPLACEE"] },
            id: { not: formulaId },
          },
          select: { id: true, code: true, version: true, status: true },
        });

        for (const concurrente of concurrentes) {
          await tx.formula.update({
            where: { id: concurrente.id },
            data: { status: "ARCHIVEE" },
          });
          await enregistrerAudit(
            {
              action: ACTIONS_AUDIT.SUPPRESSION_LOGIQUE,
              module: MODULES_AUDIT.NOMENCLATURE,
              entity: "Formula",
              entityId: concurrente.id,
              userId: acteur.id,
              userEmail: acteur.email,
              oldValue: { status: concurrente.status },
              newValue: { status: "ARCHIVEE" },
              comment: `Archivage automatique de la version ${concurrente.version} remplacee par la version ${existante.version} activee`,
              reason: `Activation de la nomenclature ${existante.code} version ${existante.version} pour l'article ${existante.item.code}`,
            },
            tx,
          );
        }

        const modifiee = await tx.formula.update({
          where: { id: formulaId },
          data: {
            status: "ACTIVE",
            approvedById: existante.approvedById ?? acteur.id,
            approvedAt: existante.approvedAt ?? new Date(),
          },
        });

        await enregistrerAudit(
          {
            action: ACTIONS_AUDIT.APPROBATION,
            module: MODULES_AUDIT.NOMENCLATURE,
            entity: "Formula",
            entityId: modifiee.id,
            userId: acteur.id,
            userEmail: acteur.email,
            oldValue: { status: existante.status },
            newValue: { status: modifiee.status },
            comment: `Activation de la nomenclature ${modifiee.code} version ${modifiee.version} pour l'article ${existante.item.code}`,
          },
          tx,
        );

        return modifiee;
      });

      revalidatePath("/nomenclature");
      revalidatePath(`/nomenclature/${formule.id}`);
      return { id: formule.id };
    },
  );
}

/**
 * Nouvelle version : seul moyen de modifier une nomenclature qui n'est plus un
 * brouillon, et donc seul moyen de faire evoluer une formulation deja utilisee
 * par des ordres de fabrication.
 *
 * La copie des lignes est integrale ; la nouvelle version repart en BROUILLON,
 * avec un numero incremente et un lien vers sa precedente. L'ancienne version
 * passe a REMPLACEE (elle sera ARCHIVEE a l'activation de la nouvelle).
 */
export async function actionCreerVersionNomenclature(
  formData: FormData,
): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_ECRIRE);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer(
    "La nouvelle version a ete creee au statut brouillon, avec une copie des composants. Modifiez-la puis soumettez-la a validation.",
    async () => {
      const sourceId = identifiantObligatoire(formData, "formulaId", "la nomenclature d'origine");
      const motif = motifObligatoire(formData, "motif de creation de version");
      const effectiveFrom = dateOuNull(formData.get("dateEffet"));
      const effectiveTo = dateOuNull(formData.get("dateFin"));
      if (effectiveFrom && effectiveTo && effectiveTo.getTime() < effectiveFrom.getTime()) {
        throw validation(
          "La date de fin ne peut pas preceder la date d'effet.",
          { dateFin: "Date de fin anterieure a la date d'effet." },
        );
      }

      const nouvelle = await prisma.$transaction(async (tx) => {
        const source = await tx.formula.findUnique({
          where: { id: sourceId },
          include: {
            item: { select: { id: true, code: true } },
            lines: { orderBy: { lineNo: "asc" } },
          },
        });
        if (!source) throw nonTrouve("La nomenclature d'origine");

        if (source.status === "BROUILLON" || source.status === "EN_VALIDATION") {
          throw etatInvalide(
            `La version ${source.version} est au statut « ${libelle(LIBELLES_STATUT_NOMENCLATURE, source.status)} » : elle n'est pas encore figee, ses composants sont donc directement modifiables. Une nouvelle version ne se cree qu'a partir d'une version validee, active ou remplacee.`,
          );
        }

        const derniere = await tx.formula.findFirst({
          where: { itemId: source.itemId },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        const version = (derniere?.version ?? source.version) + 1;

        const doublon = await tx.formula.findFirst({
          where: { itemId: source.itemId, version },
          select: { id: true },
        });
        if (doublon) {
          throw conflit(
            `Une nomenclature de version ${version} existe deja pour l'article ${source.item.code} (n° ${doublon.id}).`,
          );
        }

        const creee = await tx.formula.create({
          data: {
            itemId: source.itemId,
            code: source.code,
            label: source.label,
            label2: source.label2,
            version,
            status: "BROUILLON",
            type: source.type,
            typeFormule: source.typeFormule,
            effectiveFrom: effectiveFrom ?? source.effectiveFrom,
            effectiveTo: effectiveTo ?? null,
            warehouseProdId: source.warehouseProdId,
            warehouseStoreId: source.warehouseStoreId,
            warehouseDestId: source.warehouseDestId,
            productionTimePerUnit: source.productionTimePerUnit,
            productionCostPerUnit: source.productionCostPerUnit,
            costCalcMethod: source.costCalcMethod,
            notes: source.notes,
            previousVersionId: source.id,
            changeReason: motif,
          },
        });

        if (source.lines.length > 0) {
          await tx.formulaLine.createMany({
            data: source.lines.map((ligne) => ({
              formulaId: creee.id,
              lineNo: ligne.lineNo,
              componentItemId: ligne.componentItemId,
              quantity: ligne.quantity,
              unitCode: ligne.unitCode,
              lossRate: ligne.lossRate,
              scrapRate: ligne.scrapRate,
              toleratedError: ligne.toleratedError,
              operationCode: ligne.operationCode,
              consumptionWarehouseId: ligne.consumptionWarehouseId,
              productionWarehouseId: ligne.productionWarehouseId,
              unitCost: ligne.unitCost,
              price: ligne.price,
              totalCost: ligne.totalCost,
              apartFromCost: ligne.apartFromCost,
              lineClass: ligne.lineClass,
              inProcess: ligne.inProcess,
              isLabor: ligne.isLabor,
              rate: ligne.rate,
              taux: ligne.taux,
              label1: ligne.label1,
              notes: ligne.notes,
            })),
          });
        }

        // L'ancienne version n'est jamais modifiee : elle change seulement de
        // statut, ce qui preserve integralement la formulation consommee par les
        // ordres de fabrication deja lances.
        if (source.status === "ACTIVE" || source.status === "VALIDEE") {
          await tx.formula.update({
            where: { id: source.id },
            data: { status: "REMPLACEE" },
          });
          await enregistrerAudit(
            {
              action: ACTIONS_AUDIT.CHANGEMENT_NOMENCLATURE,
              module: MODULES_AUDIT.NOMENCLATURE,
              entity: "Formula",
              entityId: source.id,
              userId: acteur.id,
              userEmail: acteur.email,
              oldValue: { status: source.status },
              newValue: { status: "REMPLACEE" },
              comment: `Version ${source.version} remplacee par la version ${version}`,
              reason: motif,
            },
            tx,
          );
        }

        await enregistrerAudit(
          {
            action: ACTIONS_AUDIT.CHANGEMENT_NOMENCLATURE,
            module: MODULES_AUDIT.NOMENCLATURE,
            entity: "Formula",
            entityId: creee.id,
            userId: acteur.id,
            userEmail: acteur.email,
            newValue: {
              code: creee.code,
              version: creee.version,
              status: creee.status,
              previousVersionId: creee.previousVersionId,
              lignesCopiees: source.lines.length,
            },
            comment: `Creation de la version ${creee.version} de la nomenclature ${creee.code} a partir de la version ${source.version} (${source.lines.length} composant(s) copie(s))`,
            reason: motif,
          },
          tx,
        );

        return creee;
      });

      revalidatePath("/nomenclature");
      revalidatePath(`/nomenclature/${nouvelle.id}`);
      revalidatePath(`/nomenclature/${sourceId}`);
      return { id: nouvelle.id };
    },
  );
}

/**
 * Archivage : la version quitte le cycle de vie sans etre supprimee.
 * Les ordres de fabrication qui l'ont consommee conservent leur rattachement.
 */
export async function actionArchiverNomenclature(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_VALIDER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer(
    "La version a ete archivee. Elle reste consultable et les ordres de fabrication qui l'utilisent conservent leur version figee.",
    async () => {
      const formulaId = identifiantObligatoire(formData, "formulaId", "la nomenclature");
      const motif = motifObligatoire(formData, "motif d'archivage");

      const formule = await prisma.$transaction(async (tx) => {
        const existante = await chargerFormule(tx, formulaId);
        if (existante.status === "ARCHIVEE") {
          throw conflit(
            `La nomenclature ${existante.code} version ${existante.version} est deja archivee.`,
          );
        }
        if (existante.status === "EN_VALIDATION") {
          throw etatInvalide(
            "Une version en cours de validation ne peut pas etre archivee : validez-la ou laissez le valideur statuer.",
          );
        }

        const modifiee = await tx.formula.update({
          where: { id: formulaId },
          data: { status: "ARCHIVEE" },
        });

        await enregistrerAudit(
          {
            action: ACTIONS_AUDIT.SUPPRESSION_LOGIQUE,
            module: MODULES_AUDIT.NOMENCLATURE,
            entity: "Formula",
            entityId: modifiee.id,
            userId: acteur.id,
            userEmail: acteur.email,
            oldValue: { status: existante.status },
            newValue: { status: modifiee.status },
            comment: `Archivage de la nomenclature ${modifiee.code} version ${modifiee.version}`,
            reason: motif,
          },
          tx,
        );

        return modifiee;
      });

      revalidatePath("/nomenclature");
      revalidatePath(`/nomenclature/${formule.id}`);
      return { id: formule.id };
    },
  );
}

// =============================================================================
// 4. Ecarts de quantite (FormulaVariance) — arbitrage
// =============================================================================

async function chargerEcartOuvert(db: Db, varianceId: number) {
  const ecart = await db.formulaVariance.findUnique({
    where: { id: varianceId },
    include: {
      formula: {
        select: {
          id: true,
          code: true,
          version: true,
          item: { select: { code: true, label1: true } },
        },
      },
    },
  });
  if (!ecart) throw nonTrouve("L'ecart de quantite");
  if (ecart.status === "RESOLU" || ecart.status === "ACCEPTE") {
    throw etatInvalide(
      `Cet ecart a deja ete arbitre (${libelle(LIBELLES_STATUT_ECART_NOMENCLATURE, ecart.status)}). Son historique est conserve tel quel et n'est plus modifiable.`,
    );
  }
  return ecart;
}

export async function actionPrendreEcartEnAnalyse(
  formData: FormData,
): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_VALIDER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("L'ecart est passe en analyse.", async () => {
    const varianceId = identifiantObligatoire(formData, "varianceId", "l'ecart");

    const ecart = await prisma.$transaction(async (tx) => {
      const existant = await chargerEcartOuvert(tx, varianceId);
      if (existant.status !== "OUVERT") {
        throw etatInvalide(
          `Seul un ecart au statut « ${libelle(LIBELLES_STATUT_ECART_NOMENCLATURE, "OUVERT")} » peut etre pris en analyse.`,
        );
      }

      const modifie = await tx.formulaVariance.update({
        where: { id: varianceId },
        data: { status: "EN_ANALYSE" },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.NOMENCLATURE,
          entity: "FormulaVariance",
          entityId: modifie.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { status: existant.status },
          newValue: { status: modifie.status },
          comment: `Prise en analyse de l'ecart de quantite n° ${modifie.id} sur la nomenclature ${existant.formula.code} version ${existant.formula.version}`,
        },
        tx,
      );

      return modifie;
    });

    revalidatePath("/nomenclature/ecarts");
    return { id: ecart.id };
  });
}

export async function actionResoudreEcart(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_VALIDER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer(
    "L'ecart a ete resolu : la quantite retenue, le valideur et le motif sont consignes. Les valeurs d'origine restent inchangees.",
    async () => {
      const varianceId = identifiantObligatoire(formData, "varianceId", "l'ecart");
      const motif = motifObligatoire(formData, "note d'ecart");

      const ecart = await prisma.$transaction(async (tx) => {
        const existant = await chargerEcartOuvert(tx, varianceId);

        // Le choix est forcement explicite : soit l'une des deux valeurs
        // comparees, telle qu'elle a ete detectee, soit une quantite saisie par
        // le valideur. Aucune quantite n'est deduite ni moyennee.
        const saisieLibre = decimalOuNull(formData.get("quantiteRetenueAutre"));
        const choixSource = texteOuNull(formData.get("quantiteRetenueSource"));

        let quantiteRetenue: string;
        if (saisieLibre !== null) {
          quantiteRetenue = saisieLibre;
        } else if (choixSource !== null) {
          const sources = [existant.valueA, existant.valueB].filter(
            (valeur): valeur is string => valeur !== null,
          );
          if (!sources.includes(choixSource)) {
            throw validation(
              "La quantite retenue doit provenir de l'une des deux sources comparees, ou etre saisie explicitement. Aucune quantite n'est choisie a votre place.",
              { quantiteRetenueSource: "Source inconnue pour cet ecart." },
            );
          }
          const extraite = quantiteDeSource(choixSource);
          if (extraite === null) {
            throw validation(
              "La valeur de la source choisie n'est pas une quantite lisible. Saisissez explicitement la quantite arbitree.",
              { quantiteRetenueAutre: "Saisie explicite requise." },
            );
          }
          quantiteRetenue = extraite;
        } else {
          throw validation(
            "Vous devez choisir explicitement la quantite retenue : selectionnez l'une des deux sources comparees ou saisissez la quantite arbitree.",
            { quantiteRetenueSource: "Choix obligatoire." },
          );
        }

        if (D.lt(quantiteRetenue, 0)) {
          throw validation("La quantite retenue ne peut pas etre negative.", {
            quantiteRetenueAutre: "Quantite negative refusee.",
          });
        }

        const valeurRetenue = D.toFixed(quantiteRetenue, 6);

        // Aucune ligne de nomenclature n'est reecrite ici : l'arbitrage est une
        // decision tracee, pas une correction silencieuse de l'historique.
        const modifie = await tx.formulaVariance.update({
          where: { id: varianceId },
          data: {
            status: "RESOLU",
            resolvedValue: valeurRetenue,
            resolutionNote: motif,
            resolvedById: acteur.id,
            resolvedAt: new Date(),
          },
        });

        await enregistrerAudit(
          {
            action: ACTIONS_AUDIT.CHANGEMENT_NOMENCLATURE,
            module: MODULES_AUDIT.NOMENCLATURE,
            entity: "FormulaVariance",
            entityId: modifie.id,
            userId: acteur.id,
            userEmail: acteur.email,
            oldValue: {
              status: existant.status,
              sourceA: existant.sourceA,
              valueA: existant.valueA,
              sourceB: existant.sourceB,
              valueB: existant.valueB,
              delta: existant.delta,
            },
            newValue: {
              status: modifie.status,
              resolvedValue: modifie.resolvedValue,
              resolvedById: modifie.resolvedById,
              resolvedAt: modifie.resolvedAt,
            },
            comment: `Resolution de l'ecart de quantite n° ${modifie.id} : quantite retenue ${valeurRetenue} (nomenclature ${existant.formula.code} version ${existant.formula.version})`,
            reason: motif,
          },
          tx,
        );

        return modifie;
      });

      revalidatePath("/nomenclature/ecarts");
      revalidatePath(`/nomenclature/${ecart.formulaId}`);
      return { id: ecart.id };
    },
  );
}

export async function actionAccepterEcart(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_VALIDER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer(
    "L'ecart a ete accepte et motive. Les deux valeurs d'origine sont conservees telles quelles.",
    async () => {
      const varianceId = identifiantObligatoire(formData, "varianceId", "l'ecart");
      const motif = motifObligatoire(formData, "motif d'acceptation de l'ecart");

      const ecart = await prisma.$transaction(async (tx) => {
        const existant = await chargerEcartOuvert(tx, varianceId);

        // Accepter un ecart ne revient pas a le resoudre : aucune quantite
        // retenue n'est enregistree, car aucune n'a ete choisie.
        const modifie = await tx.formulaVariance.update({
          where: { id: varianceId },
          data: {
            status: "ACCEPTE",
            resolutionNote: motif,
            resolvedById: acteur.id,
            resolvedAt: new Date(),
          },
        });

        await enregistrerAudit(
          {
            action: ACTIONS_AUDIT.APPROBATION,
            module: MODULES_AUDIT.NOMENCLATURE,
            entity: "FormulaVariance",
            entityId: modifie.id,
            userId: acteur.id,
            userEmail: acteur.email,
            oldValue: { status: existant.status },
            newValue: {
              status: modifie.status,
              resolvedById: modifie.resolvedById,
              resolvedAt: modifie.resolvedAt,
            },
            comment: `Acceptation de l'ecart de quantite n° ${modifie.id} sur la nomenclature ${existant.formula.code} version ${existant.formula.version}`,
            reason: motif,
          },
          tx,
        );

        return modifie;
      });

      revalidatePath("/nomenclature/ecarts");
      revalidatePath(`/nomenclature/${ecart.formulaId}`);
      return { id: ecart.id };
    },
  );
}

// =============================================================================
// 5. Gammes de fabrication (ProductRoute / RouteStep)
// =============================================================================

const STATUTS_GAMME_MODIFIABLES: readonly RouteStatus[] = ["BROUILLON"];

/** Charge une gamme et refuse toute ecriture d'etape des qu'elle n'est plus un brouillon. */
async function chargerGammeBrouillon(
  db: Db,
  routeId: number,
): Promise<{ id: number; code: string; version: number; status: RouteStatus }> {
  const gamme = await db.productRoute.findUnique({
    where: { id: routeId },
    select: { id: true, code: true, version: true, status: true },
  });
  if (!gamme) throw nonTrouve("La gamme");
  if (!STATUTS_GAMME_MODIFIABLES.includes(gamme.status)) {
    throw etatInvalide(
      `Les etapes de la gamme ${gamme.code} version ${gamme.version} ne sont plus modifiables : la gamme est au statut « ${libelle(
        LIBELLES_STATUT_GAMME,
        gamme.status,
      )} ». Creez une nouvelle gamme brouillon pour faire evoluer l'enchainement des operations.`,
    );
  }
  return gamme;
}

export async function actionCreerGamme(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.GAMME_GERER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer(
    "La gamme a ete creee au statut brouillon. Ajoutez ses etapes, puis activez-la.",
    async () => {
      const itemId = identifiantObligatoire(formData, "articleId", "l'article");
      const code = texteObligatoire(formData.get("code"), "code de la gamme");
      const label = texteObligatoire(formData.get("libelle"), "libelle");
      const version = entierOu(formData.get("version"), 1) ?? 1;
      if (version < 1) {
        throw validation("Le numero de version doit etre un entier superieur ou egal a 1.", {
          version: "Version invalide.",
        });
      }

      const divisionSaisie = texteOuNull(formData.get("division"));
      const divisions: readonly Factory[] = ["ADMEDCO", "MOBILIX", "COMMUN"];
      const factory = divisionSaisie === null
        ? "COMMUN"
        : divisions.find((valeur) => valeur === divisionSaisie);
      if (!factory) {
        throw validation("La division selectionnee n'est pas valide.", {
          division: "Division inconnue.",
        });
      }

      const workshopId = entierOu(formData.get("atelier"), null);
      const notes = texteOuNull(formData.get("notes"));
      const parDefaut = booleen(formData.get("parDefaut"));

      const creee = await prisma.$transaction(async (tx) => {
        const article = await tx.item.findUnique({
          where: { id: itemId },
          select: { id: true, code: true },
        });
        if (!article) throw nonTrouve("L'article");

        const doublonCode = await tx.productRoute.findUnique({
          where: { code },
          select: { id: true },
        });
        if (doublonCode) {
          throw conflit(
            `Le code de gamme « ${code} » est deja utilise (gamme n° ${doublonCode.id}). Choisissez un code distinct.`,
          );
        }

        const doublonVersion = await tx.productRoute.findFirst({
          where: { itemId, version },
          select: { id: true },
        });
        if (doublonVersion) {
          throw conflit(
            `L'article ${article.code} possede deja une gamme de version ${version} (n° ${doublonVersion.id}).`,
          );
        }

        if (workshopId !== null) {
          const atelier = await tx.workshop.findUnique({
            where: { id: workshopId },
            select: { id: true },
          });
          if (!atelier) {
            throw validation("L'atelier selectionne est introuvable.", {
              atelier: "Atelier inconnu.",
            });
          }
        }

        if (parDefaut) {
          // Une seule gamme par defaut par article : le choix est explicite et
          // les autres gammes de l'article sont decotees en consequence.
          await tx.productRoute.updateMany({
            where: { itemId, isDefault: true },
            data: { isDefault: false },
          });
        }

        const gamme = await tx.productRoute.create({
          data: {
            code,
            label,
            itemId,
            version,
            status: "BROUILLON",
            factory,
            workshopId,
            isDefault: parDefaut,
            notes,
          },
        });

        await enregistrerAudit(
          {
            action: ACTIONS_AUDIT.CREATION,
            module: MODULES_AUDIT.NOMENCLATURE,
            entity: "ProductRoute",
            entityId: gamme.id,
            userId: acteur.id,
            userEmail: acteur.email,
            newValue: gamme,
            comment: `Creation de la gamme ${gamme.code} version ${gamme.version} pour l'article ${article.code}`,
          },
          tx,
        );

        return gamme;
      });

      revalidatePath("/nomenclature/gammes");
      return { id: creee.id };
    },
  );
}

/** Champs communs d'une etape de gamme, verifies contre le referentiel. */
async function champsEtapeGamme(db: Db, formData: FormData) {
  const operationId = identifiantObligatoire(formData, "operationId", "l'operation");

  const operation = await db.operation.findUnique({
    where: { id: operationId },
    select: { id: true, code: true, factory: true, workshopId: true, requiresQualityCheck: true },
  });
  if (!operation) {
    throw validation("L'operation selectionnee est introuvable.", {
      operationId: "Operation inconnue.",
    });
  }

  const workCenterId = entierOu(formData.get("workCenterId"), null);
  if (workCenterId !== null) {
    const poste = await db.workCenter.findUnique({
      where: { id: workCenterId },
      select: { id: true, operationId: true },
    });
    if (!poste) {
      throw validation("Le poste de travail selectionne est introuvable.", {
        workCenterId: "Poste inconnu.",
      });
    }
    if (poste.operationId !== null && poste.operationId !== operationId) {
      throw validation(
        "Le poste de travail selectionne n'est pas rattache a l'operation choisie. Selectionnez un poste compatible, ou laissez le poste vide.",
        { workCenterId: "Poste incompatible avec l'operation." },
      );
    }
  }

  const tempsPrevu = decimalPositifOuZero(
    formData,
    "tempsPrevu",
    "temps prevu (minutes)",
  );
  const tempsReglage = decimalPositifOuZero(
    formData,
    "tempsReglage",
    "temps de reglage (minutes)",
  );

  return {
    operationId,
    workCenterId,
    standardTimeMinutes: D.roundAmount(tempsPrevu),
    setupTimeMinutes: D.roundAmount(tempsReglage),
    isQualityGate: booleen(formData.get("controleQualite")),
    isFinalStep: booleen(formData.get("etapeFinale")),
    consumesSemiFinished: booleen(formData.get("consommeSemiFini")),
    producesSemiFinished: booleen(formData.get("produitSemiFini")),
    description: texteOuNull(formData.get("description")),
    instructions: texteOuNull(formData.get("instructions")),
  };
}

export async function actionAjouterEtape(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.GAMME_GERER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("L'etape a ete ajoutee a la gamme.", async () => {
    const routeId = identifiantObligatoire(formData, "routeId", "la gamme");

    const etape = await prisma.$transaction(async (tx) => {
      const gamme = await chargerGammeBrouillon(tx, routeId);
      const champs = await champsEtapeGamme(tx, formData);

      const stepNoSaisi = entierOu(formData.get("stepNo"), null);
      let stepNo = stepNoSaisi;
      if (stepNo === null) {
        const derniere = await tx.routeStep.findFirst({
          where: { routeId },
          orderBy: { stepNo: "desc" },
          select: { stepNo: true },
        });
        stepNo = (derniere?.stepNo ?? 0) + 1;
      }

      const doublon = await tx.routeStep.findFirst({
        where: { routeId, stepNo },
        select: { id: true },
      });
      if (doublon) {
        throw conflit(
          `Le numero d'etape ${stepNo} est deja utilise par cette gamme. Choisissez un numero libre.`,
        );
      }

      const creee = await tx.routeStep.create({
        data: { routeId, stepNo, ...champs },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.NOMENCLATURE,
          entity: "RouteStep",
          entityId: creee.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: creee,
          comment: `Ajout de l'etape ${creee.stepNo} sur la gamme ${gamme.code} version ${gamme.version}`,
        },
        tx,
      );

      return creee;
    });

    revalidatePath("/nomenclature/gammes");
    revalidatePath(`/nomenclature/gammes/${routeId}`);
    return { id: etape.id };
  });
}

export async function actionModifierEtape(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.GAMME_GERER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("L'etape a ete mise a jour.", async () => {
    const etapeId = identifiantObligatoire(formData, "etapeId", "l'etape");

    const resultat = await prisma.$transaction(async (tx) => {
      const existante = await tx.routeStep.findUnique({ where: { id: etapeId } });
      if (!existante) throw nonTrouve("L'etape de gamme");

      const gamme = await chargerGammeBrouillon(tx, existante.routeId);
      const champs = await champsEtapeGamme(tx, formData);

      const modifiee = await tx.routeStep.update({
        where: { id: etapeId },
        data: { ...champs, stepNo: existante.stepNo },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.NOMENCLATURE,
          entity: "RouteStep",
          entityId: modifiee.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: existante,
          newValue: modifiee,
          comment: `Modification de l'etape ${modifiee.stepNo} de la gamme ${gamme.code} version ${gamme.version}`,
        },
        tx,
      );

      return { gamme, etape: modifiee };
    });

    revalidatePath(`/nomenclature/gammes/${resultat.gamme.id}`);
    return { id: resultat.etape.id };
  });
}

/**
 * Reordonnancement : l'etape remonte ou descend d'un rang.
 *
 * La contrainte d'unicite (gamme, numero d'etape) empeche tout echange direct :
 * les etapes sont donc temporairement decalees, puis renumérotees de 1 a n dans
 * l'ordre resultant. L'operation est transactionnelle : aucune numerotation
 * intermediaire ne peut subsister.
 */
export async function actionDeplacerEtape(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.GAMME_GERER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("L'ordre des etapes a ete mis a jour.", async () => {
    const etapeId = identifiantObligatoire(formData, "etapeId", "l'etape");
    const sens = texteObligatoire(formData.get("sens"), "sens du deplacement");
    if (sens !== "HAUT" && sens !== "BAS") {
      throw validation("Le sens du deplacement doit etre « HAUT » ou « BAS ».", {
        sens: "Sens invalide.",
      });
    }

    const routeId = await prisma.$transaction(async (tx) => {
      const existante = await tx.routeStep.findUnique({
        where: { id: etapeId },
        select: { id: true, routeId: true, stepNo: true },
      });
      if (!existante) throw nonTrouve("L'etape de gamme");

      const gamme = await chargerGammeBrouillon(tx, existante.routeId);

      const etapes = await tx.routeStep.findMany({
        where: { routeId: existante.routeId },
        orderBy: { stepNo: "asc" },
        select: { id: true, stepNo: true },
      });

      const index = etapes.findIndex((etape) => etape.id === etapeId);
      const indexCible = sens === "HAUT" ? index - 1 : index + 1;
      if (indexCible < 0 || indexCible >= etapes.length) {
        throw etatInvalide(
          sens === "HAUT"
            ? "Cette etape est deja la premiere de la gamme."
            : "Cette etape est deja la derniere de la gamme.",
        );
      }

      const reordonnees = [...etapes];
      const temporaire = reordonnees[index];
      reordonnees[index] = reordonnees[indexCible];
      reordonnees[indexCible] = temporaire;

      // Etape 1 : decalage de toutes les etapes pour liberer la numerotation.
      await tx.routeStep.updateMany({
        where: { routeId: existante.routeId },
        data: { stepNo: { increment: 100000 } },
      });
      // Etape 2 : numerotation continue 1..n selon le nouvel ordre.
      for (let position = 0; position < reordonnees.length; position += 1) {
        await tx.routeStep.update({
          where: { id: reordonnees[position].id },
          data: { stepNo: position + 1 },
        });
      }

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.NOMENCLATURE,
          entity: "RouteStep",
          entityId: etapeId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: etapes.map((etape) => ({ id: etape.id, stepNo: etape.stepNo })),
          newValue: reordonnees.map((etape, position) => ({
            id: etape.id,
            stepNo: position + 1,
          })),
          comment: `Reordonnancement des etapes de la gamme ${gamme.code} version ${gamme.version} (etape ${existante.stepNo} deplacee vers le ${sens === "HAUT" ? "haut" : "bas"})`,
        },
        tx,
      );

      return existante.routeId;
    });

    revalidatePath(`/nomenclature/gammes/${routeId}`);
    return { id: etapeId };
  });
}

/**
 * Suppression d'une etape d'un brouillon. Aucune gamme active n'est concernee :
 * le statut est verifie cote serveur, pas seulement masque dans l'interface.
 * La numerotation restante est rendue continue et la renumérotation est tracee.
 */
export async function actionSupprimerEtape(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.GAMME_GERER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("L'etape a ete supprimee et les etapes restantes renumerotees.", async () => {
    const etapeId = identifiantObligatoire(formData, "etapeId", "l'etape");

    const routeId = await prisma.$transaction(async (tx) => {
      const existante = await tx.routeStep.findUnique({ where: { id: etapeId } });
      if (!existante) throw nonTrouve("L'etape de gamme");

      const gamme = await chargerGammeBrouillon(tx, existante.routeId);

      await tx.routeStep.delete({ where: { id: etapeId } });

      const restantes = await tx.routeStep.findMany({
        where: { routeId: existante.routeId },
        orderBy: { stepNo: "asc" },
        select: { id: true, stepNo: true },
      });

      await tx.routeStep.updateMany({
        where: { routeId: existante.routeId },
        data: { stepNo: { increment: 100000 } },
      });
      for (let position = 0; position < restantes.length; position += 1) {
        await tx.routeStep.update({
          where: { id: restantes[position].id },
          data: { stepNo: position + 1 },
        });
      }

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.SUPPRESSION_LOGIQUE,
          module: MODULES_AUDIT.NOMENCLATURE,
          entity: "RouteStep",
          entityId: etapeId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: existante,
          newValue: restantes.map((etape, position) => ({
            id: etape.id,
            stepNo: position + 1,
            ancienStepNo: etape.stepNo,
          })),
          comment: `Suppression de l'etape ${existante.stepNo} de la gamme ${gamme.code} version ${gamme.version} (brouillon)`,
        },
        tx,
      );

      return existante.routeId;
    });

    revalidatePath("/nomenclature/gammes");
    revalidatePath(`/nomenclature/gammes/${routeId}`);
    return { id: etapeId };
  });
}

export async function actionActiverGamme(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.GAMME_GERER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer(
    "La gamme a ete activee : elle est desormais utilisee pour la planification des ordres de fabrication.",
    async () => {
      const routeId = identifiantObligatoire(formData, "routeId", "la gamme");
      const parDefaut = booleen(formData.get("parDefaut"));

      const gamme = await prisma.$transaction(async (tx) => {
        const existante = await tx.productRoute.findUnique({
          where: { id: routeId },
          include: { item: { select: { id: true, code: true } } },
        });
        if (!existante) throw nonTrouve("La gamme");
        if (existante.status !== "BROUILLON") {
          throw etatInvalide(
            `Seule une gamme au statut « ${libelle(LIBELLES_STATUT_GAMME, "BROUILLON")} » peut etre activee. La gamme ${existante.code} est au statut « ${libelle(LIBELLES_STATUT_GAMME, existante.status)} ».`,
          );
        }

        const nombreEtapes = await tx.routeStep.count({ where: { routeId } });
        if (nombreEtapes === 0) {
          throw etatInvalide(
            "Une gamme sans aucune etape ne peut pas etre activee : ajoutez au moins une operation avant de continuer.",
          );
        }

        // Les gammes encore actives du meme article sont archivees : une seule
        // gamme de production reste active a la fois. Elles ne sont pas
        // supprimees, leurs ordres de fabrication restent rattaches.
        const concurrentes = await tx.productRoute.findMany({
          where: { itemId: existante.itemId, status: "ACTIVE", id: { not: routeId } },
          select: { id: true, code: true, version: true },
        });
        for (const concurrente of concurrentes) {
          await tx.productRoute.update({
            where: { id: concurrente.id },
            data: { status: "ARCHIVEE" },
          });
          await enregistrerAudit(
            {
              action: ACTIONS_AUDIT.SUPPRESSION_LOGIQUE,
              module: MODULES_AUDIT.NOMENCLATURE,
              entity: "ProductRoute",
              entityId: concurrente.id,
              userId: acteur.id,
              userEmail: acteur.email,
              oldValue: { status: "ACTIVE" },
              newValue: { status: "ARCHIVEE" },
              comment: `Archivage de la gamme ${concurrente.code} version ${concurrente.version} remplacee par la gamme ${existante.code} activee`,
            },
            tx,
          );
        }

        if (parDefaut) {
          await tx.productRoute.updateMany({
            where: { itemId: existante.itemId, id: { not: routeId } },
            data: { isDefault: false },
          });
        }

        const modifiee = await tx.productRoute.update({
          where: { id: routeId },
          data: {
            status: "ACTIVE",
            approvedById: acteur.id,
            approvedAt: new Date(),
            ...(parDefaut ? { isDefault: true } : {}),
          },
        });

        await enregistrerAudit(
          {
            action: ACTIONS_AUDIT.APPROBATION,
            module: MODULES_AUDIT.NOMENCLATURE,
            entity: "ProductRoute",
            entityId: modifiee.id,
            userId: acteur.id,
            userEmail: acteur.email,
            oldValue: { status: existante.status, isDefault: existante.isDefault },
            newValue: {
              status: modifiee.status,
              isDefault: modifiee.isDefault,
              approvedById: modifiee.approvedById,
              approvedAt: modifiee.approvedAt,
            },
            comment: `Activation de la gamme ${modifiee.code} version ${modifiee.version} pour l'article ${existante.item.code} (${nombreEtapes} etape(s))`,
          },
          tx,
        );

        return modifiee;
      });

      revalidatePath("/nomenclature/gammes");
      revalidatePath(`/nomenclature/gammes/${gamme.id}`);
      return { id: gamme.id };
    },
  );
}
