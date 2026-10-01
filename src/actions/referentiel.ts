"use server";

import { revalidatePath } from "next/cache";
import type {
  Factory,
  ItemStatus,
  ItemType,
  PaymentMethod,
  ThirdPartyType,
} from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D } from "@/lib/decimal";
import { conflit, etatInvalide, nonTrouve, validation } from "@/lib/errors";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { CLE_PARAMETRE, lireParametreTexte } from "@/lib/settings";
import { DEVISE_PAR_DEFAUT } from "@/lib/format";
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
 * Actions serveur du referentiel (articles, familles, tiers, depots, tarifs).
 *
 * Principes appliques ici :
 *  - l'ecriture se fait directement avec `prisma` : ce sont des donnees de
 *    referentiel, pas des mouvements de stock. Le grand livre de stock reste
 *    reserve a `@/lib/stock/service` ;
 *  - aucune suppression : l'archivage d'un article est un changement de statut,
 *    jamais un `delete` ; un tiers se desactive, il ne disparait pas ;
 *  - le controle d'acces est refait cote serveur pour chaque action, avec la
 *    permission du geste metier et non celle de la page ;
 *  - chaque creation ou modification laisse une trace dans `AuditLog`, dans la
 *    meme transaction que l'ecriture metier ;
 *  - les montants et quantites sont transmis a Prisma sous forme de chaines
 *    decimales exactes (`decimalOuNull`), jamais de flottant.
 */

interface Acteur {
  id: number;
  email: string;
}

// -----------------------------------------------------------------------------
// Catalogues de valeurs autorisees
//
// Les listes sont ecrites ici pour refuser explicitement toute valeur hors
// catalogue : une saisie falsifiee ne doit jamais atteindre la base.
// -----------------------------------------------------------------------------

const TYPES_ARTICLE: readonly ItemType[] = [
  "MATIERE_PREMIERE",
  "COMPOSANT",
  "SEMI_FINI",
  "PRODUIT_FINI",
  "EMBALLAGE",
  "CONSOMMABLE",
  "SERVICE",
  "MAIN_OEUVRE",
];

/**
 * Statuts accessibles depuis la fiche article. ARCHIVE n'y figure pas :
 * l'archivage est un acte distinct, protege par ARTICLE_ARCHIVER.
 */
const STATUTS_ARTICLE: readonly ItemStatus[] = [
  "ACTIF",
  "INACTIF",
  "NON_COMMERCIALISABLE",
  "NON_PRODUCTIBLE",
];

const DIVISIONS: readonly Factory[] = ["ADMEDCO", "MOBILIX", "COMMUN"];

const NATURES_TIERS: readonly ThirdPartyType[] = [
  "CLIENT",
  "FOURNISSEUR",
  "EMPLOYE",
  "AUTRE",
];

const MODES_REGLEMENT: readonly PaymentMethod[] = [
  "ESPECES",
  "CHEQUE",
  "VIREMENT",
  "TRAITE",
  "CARTE",
  "COMPENSATION",
  "AUTRE",
];

// -----------------------------------------------------------------------------
// Aides de saisie
// -----------------------------------------------------------------------------

/** Vérifie qu'une valeur saisie appartient au catalogue, sinon refuse. */
function valeurEnumeree<T extends string>(
  valeurs: readonly T[],
  saisie: string | null,
  libelleChamp: string,
): T | null {
  if (saisie === null) return null;
  const trouvee = valeurs.find((valeur) => valeur === saisie);
  if (!trouvee) {
    throw validation(
      `La valeur « ${saisie} » n'est pas un ${libelleChamp} valide. Selectionnez une valeur de la liste.`,
    );
  }
  return trouvee;
}

function valeurObligatoire<T extends string>(
  valeurs: readonly T[],
  saisie: string | null,
  libelleChamp: string,
): T {
  const valeur = valeurEnumeree(valeurs, saisie, libelleChamp);
  if (valeur === null) {
    throw validation(`Le champ « ${libelleChamp} » est obligatoire.`);
  }
  return valeur;
}

/** Decimal de formulaire, avec 0 par defaut : aucun null sur une colonne non nullable. */
function decimalZero(formData: FormData, champ: string, libelleChamp: string): string {
  const valeur = decimalOuNull(formData.get(champ)) ?? "0";
  if (D.lt(valeur, 0)) {
    throw validation(`Le champ « ${libelleChamp} » ne peut pas etre negatif.`, {
      [champ]: "Une valeur negative n'a pas de sens ici.",
    });
  }
  return valeur;
}

/** Taux en pourcentage borne a 100, pour ne jamais enregistrer un taux absurde. */
function tauxPourcent(formData: FormData, champ: string, libelleChamp: string): string {
  const valeur = decimalZero(formData, champ, libelleChamp);
  if (D.gt(valeur, 100)) {
    throw validation(`Le champ « ${libelleChamp} » ne peut pas depasser 100 %.`, {
      [champ]: "Taux hors bornes (0 a 100).",
    });
  }
  return valeur;
}

function identifiantObligatoire(
  formData: FormData,
  champ: string,
  libelleChamp: string,
): number {
  const valeur = entierOu(formData.get(champ));
  if (!valeur || valeur <= 0) {
    throw validation(`Le champ « ${libelleChamp} » est obligatoire.`);
  }
  return valeur;
}

// -----------------------------------------------------------------------------
// 1. Articles
// -----------------------------------------------------------------------------

/** Verifie l'existence des references externes avant toute ecriture. */
async function verifierReferencesArticle(
  tx: Db,
  references: { familyId: number | null; unitCode: string | null; taxRateCode: string | null },
): Promise<void> {
  if (references.familyId !== null) {
    const famille = await tx.itemFamily.findUnique({
      where: { id: references.familyId },
      select: { id: true },
    });
    if (!famille) throw nonTrouve("La famille d'articles selectionnee");
  }
  if (references.unitCode !== null) {
    const unite = await tx.unitOfMeasure.findUnique({
      where: { code: references.unitCode },
      select: { code: true },
    });
    if (!unite) throw nonTrouve("L'unite de mesure selectionnee");
  }
  if (references.taxRateCode !== null) {
    const taux = await tx.taxRate.findUnique({
      where: { code: references.taxRateCode },
      select: { code: true },
    });
    if (!taux) throw nonTrouve("Le taux de TVA selectionne");
  }
}

/** Champs communs a la creation et a la modification d'un article. */
function champsArticle(formData: FormData) {
  return {
    code: texteObligatoire(formData.get("code"), "code article"),
    barcode: texteOuNull(formData.get("codeBarres")),
    reference: texteOuNull(formData.get("reference")),
    label1: texteObligatoire(formData.get("libelle1"), "libelle"),
    label2: texteOuNull(formData.get("libelle2")),
    label3: texteOuNull(formData.get("libelle3")),
    designation: texteOuNull(formData.get("designation")),
    type: valeurObligatoire(
      TYPES_ARTICLE,
      texteOuNull(formData.get("type")),
      "type d'article",
    ),
    familyId: entierOu(formData.get("familleId")),
    unitCode: texteOuNull(formData.get("unite")),
    taxRateCode: texteOuNull(formData.get("codeTva")),
    factory: valeurObligatoire(
      DIVISIONS,
      texteOuNull(formData.get("division")),
      "division",
    ),

    // Configuration industrielle et commerciale
    isPurchasable: booleen(formData.get("achetable")),
    isSellable: booleen(formData.get("vendable")),
    isProducible: booleen(formData.get("fabricable")),
    isSemiFinished: booleen(formData.get("semiFini")),
    isBatchManaged: booleen(formData.get("suiviParLot")),
    isRawMaterial: booleen(formData.get("matierePremiere")),
    isMainOeuvre: booleen(formData.get("mainOeuvre")),
    isOutOfService: booleen(formData.get("horsService")),
    useNegativeStock: booleen(formData.get("stockNegatifAutorise")),

    // Seuils de stock
    quantityMin: decimalZero(formData, "quantiteMin", "quantite minimum"),
    quantityMax: decimalZero(formData, "quantiteMax", "quantite maximum"),
    safetyStock: decimalZero(formData, "stockSecurite", "stock de securite"),

    // Logistique
    unitWeight: decimalZero(formData, "poidsUnitaire", "poids unitaire"),
    width: decimalZero(formData, "largeur", "largeur"),
    height: decimalZero(formData, "hauteur", "hauteur"),
    length: decimalZero(formData, "longueur", "longueur"),
    thickness: decimalZero(formData, "epaisseur", "epaisseur"),
  };
}

export async function actionCreerArticle(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.ARTICLE_ECRIRE);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("L'article a ete cree.", async () => {
    const champs = champsArticle(formData);

    const article = await prisma.$transaction(async (tx) => {
      const doublon = await tx.item.findUnique({
        where: { code: champs.code },
        select: { id: true },
      });
      if (doublon) {
        throw conflit(
          `Le code article « ${champs.code} » est deja utilise (article n° ${doublon.id}). Choisissez un code distinct ou modifiez la fiche existante.`,
        );
      }

      await verifierReferencesArticle(tx, champs);

      const cree = await tx.item.create({
        data: { ...champs, status: "ACTIF" },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.REFERENTIEL,
          entity: "Item",
          entityId: cree.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: cree,
          comment: `Creation de l'article ${cree.code}`,
        },
        tx,
      );

      return cree;
    });

    revalidatePath("/referentiel/articles");
    return { id: article.id };
  });
}

export async function actionModifierArticle(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.ARTICLE_ECRIRE);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("Les modifications de l'article ont ete enregistrees.", async () => {
    const articleId = identifiantObligatoire(formData, "articleId", "article");
    const champs = champsArticle(formData);
    const statut = valeurObligatoire(
      STATUTS_ARTICLE,
      texteOuNull(formData.get("statut")),
      "statut de l'article",
    );

    const article = await prisma.$transaction(async (tx) => {
      const existant = await tx.item.findUnique({ where: { id: articleId } });
      if (!existant) throw nonTrouve("L'article");

      // Un article archive est fige : l'archivage remplace la suppression, il
      // n'est donc pas reversible par une simple modification de fiche.
      if (existant.status === "ARCHIVE") {
        throw etatInvalide(
          `L'article ${existant.code} est archive : sa fiche n'est plus modifiable. Creez un nouvel article si le besoin reapparait.`,
        );
      }

      if (champs.code !== existant.code) {
        const doublon = await tx.item.findUnique({
          where: { code: champs.code },
          select: { id: true },
        });
        if (doublon) {
          throw conflit(
            `Le code article « ${champs.code} » est deja utilise (article n° ${doublon.id}).`,
          );
        }
      }

      await verifierReferencesArticle(tx, champs);

      const modifie = await tx.item.update({
        where: { id: articleId },
        data: { ...champs, status: statut },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.REFERENTIEL,
          entity: "Item",
          entityId: modifie.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: existant,
          newValue: modifie,
          comment: `Modification de l'article ${modifie.code}`,
        },
        tx,
      );

      return modifie;
    });

    revalidatePath("/referentiel/articles");
    revalidatePath(`/referentiel/articles/${article.id}`);
    return { id: article.id };
  });
}

/**
 * Archivage : l'article passe au statut ARCHIVE et reste consultable.
 * Aucune ligne n'est supprimee, l'historique de stock et de production reste
 * donc intact et verifiable.
 */
export async function actionArchiverArticle(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.ARTICLE_ARCHIVER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("L'article a ete archive. Il reste consultable mais n'est plus mouvemente.", async () => {
    const articleId = identifiantObligatoire(formData, "articleId", "article");
    const motif = texteObligatoire(formData.get("motif"), "motif d'archivage");
    if (motif.length < 10) {
      throw validation(
        "Le motif d'archivage doit comporter au moins 10 caracteres.",
        { motif: "Motif trop court." },
      );
    }

    const article = await prisma.$transaction(async (tx) => {
      const existant = await tx.item.findUnique({ where: { id: articleId } });
      if (!existant) throw nonTrouve("L'article");
      if (existant.status === "ARCHIVE") {
        throw conflit(`L'article ${existant.code} est deja archive.`);
      }

      const modifie = await tx.item.update({
        where: { id: articleId },
        data: { status: "ARCHIVE" },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.SUPPRESSION_LOGIQUE,
          module: MODULES_AUDIT.REFERENTIEL,
          entity: "Item",
          entityId: modifie.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { status: existant.status },
          newValue: { status: modifie.status },
          comment: `Archivage de l'article ${modifie.code}`,
          reason: motif,
        },
        tx,
      );

      return modifie;
    });

    revalidatePath("/referentiel/articles");
    revalidatePath(`/referentiel/articles/${article.id}`);
    return { id: article.id };
  });
}

// -----------------------------------------------------------------------------
// 2. Familles d'articles
// -----------------------------------------------------------------------------

function champsFamille(formData: FormData) {
  return {
    code: texteObligatoire(formData.get("code"), "code famille"),
    label: texteObligatoire(formData.get("libelle"), "libelle"),
    label2: texteOuNull(formData.get("libelle2")),
    parentId: entierOu(formData.get("familleParenteId")),
    accountingCode: texteOuNull(formData.get("compteComptable")),
    isActive: booleen(formData.get("actif")),
  };
}

/**
 * Verifie que la famille parente existe et que le rattachement ne cree pas de
 * boucle : une famille ne peut jamais descendre d'elle-meme.
 */
async function verifierParentFamille(
  tx: Db,
  familleId: number | null,
  parentId: number | null,
): Promise<void> {
  if (parentId === null) return;

  const parent = await tx.itemFamily.findUnique({
    where: { id: parentId },
    select: { id: true },
  });
  if (!parent) throw nonTrouve("La famille parente selectionnee");

  if (familleId === null) return;
  if (parentId === familleId) {
    throw validation("Une famille ne peut pas etre sa propre famille parente.");
  }

  let courant: number | null = parentId;
  let profondeur = 0;
  while (courant !== null && profondeur < 32) {
    if (courant === familleId) {
      throw validation(
        "Ce rattachement creerait une boucle : la famille parente choisie descend de la famille modifiee.",
      );
    }
    const suivant: { parentId: number | null } | null = await tx.itemFamily.findUnique({
      where: { id: courant },
      select: { parentId: true },
    });
    courant = suivant?.parentId ?? null;
    profondeur += 1;
  }
}

export async function actionCreerFamille(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.FAMILLE_GERER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("La famille d'articles a ete creee.", async () => {
    const champs = champsFamille(formData);

    const famille = await prisma.$transaction(async (tx) => {
      const doublon = await tx.itemFamily.findUnique({
        where: { code: champs.code },
        select: { id: true },
      });
      if (doublon) {
        throw conflit(`Le code famille « ${champs.code} » est deja utilise.`);
      }

      await verifierParentFamille(tx, null, champs.parentId);

      const cree = await tx.itemFamily.create({
        data: {
          code: champs.code,
          label: champs.label,
          label2: champs.label2,
          parentId: champs.parentId,
          accountingCode: champs.accountingCode,
          isActive: champs.isActive,
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.REFERENTIEL,
          entity: "ItemFamily",
          entityId: cree.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: cree,
          comment: `Creation de la famille ${cree.code}`,
        },
        tx,
      );

      return cree;
    });

    revalidatePath("/referentiel/familles");
    return { id: famille.id };
  });
}

export async function actionModifierFamille(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.FAMILLE_GERER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("La famille d'articles a ete modifiee.", async () => {
    const familleId = identifiantObligatoire(formData, "familleId", "famille");
    const champs = champsFamille(formData);

    const famille = await prisma.$transaction(async (tx) => {
      const existante = await tx.itemFamily.findUnique({ where: { id: familleId } });
      if (!existante) throw nonTrouve("La famille d'articles");

      if (champs.code !== existante.code) {
        const doublon = await tx.itemFamily.findUnique({
          where: { code: champs.code },
          select: { id: true },
        });
        if (doublon) {
          throw conflit(`Le code famille « ${champs.code} » est deja utilise.`);
        }
      }

      await verifierParentFamille(tx, familleId, champs.parentId);

      const modifiee = await tx.itemFamily.update({
        where: { id: familleId },
        data: {
          code: champs.code,
          label: champs.label,
          label2: champs.label2,
          parentId: champs.parentId,
          accountingCode: champs.accountingCode,
          isActive: champs.isActive,
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.REFERENTIEL,
          entity: "ItemFamily",
          entityId: modifiee.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: existante,
          newValue: modifiee,
          comment: `Modification de la famille ${modifiee.code}`,
        },
        tx,
      );

      return modifiee;
    });

    revalidatePath("/referentiel/familles");
    return { id: famille.id };
  });
}

// -----------------------------------------------------------------------------
// 3. Tiers (clients, fournisseurs, employes, autres)
// -----------------------------------------------------------------------------

function champsTiers(formData: FormData) {
  const isClient = booleen(formData.get("natureClient"));
  const isSupplier = booleen(formData.get("natureFournisseur"));
  const isEmployee = booleen(formData.get("natureEmploye"));
  const isOther = booleen(formData.get("natureAutre"));

  // Un tiers sans nature n'apparaitrait dans aucun filtre ni aucun document :
  // la saisie est refusee plutot que d'enregistrer une fiche inexploitable.
  if (!isClient && !isSupplier && !isEmployee && !isOther) {
    throw validation(
      "Selectionnez au moins une nature : client, fournisseur, employe ou autre tiers.",
      { natures: "Aucune nature selectionnee." },
    );
  }

  // Le blocage d'un tiers est un acte de gestion : il doit etre motive.
  const isBlocked = booleen(formData.get("bloque"));
  const motifBlocage = texteOuNull(formData.get("motifBlocage"));
  if (isBlocked && (motifBlocage === null || motifBlocage.length < 5)) {
    throw validation(
      "Le blocage d'un tiers exige un motif ecrit d'au moins 5 caracteres.",
      { motifBlocage: "Motif obligatoire pour bloquer un tiers." },
    );
  }

  const delaiBrut = entierOu(formData.get("delaiReglement"), 0) ?? 0;
  if (delaiBrut < 0) {
    throw validation("Le delai de reglement ne peut pas etre negatif.", {
      delaiReglement: "Valeur negative interdite.",
    });
  }

  return {
    code: texteObligatoire(formData.get("code"), "code tiers"),
    type: valeurObligatoire(
      NATURES_TIERS,
      texteOuNull(formData.get("naturePrincipale")),
      "nature de tiers",
    ),
    isClient,
    isSupplier,
    isEmployee,
    isOther,

    label1: texteObligatoire(formData.get("libelle1"), "libelle"),
    label2: texteOuNull(formData.get("libelle2")),
    designation: texteOuNull(formData.get("designation")),
    firstName: texteOuNull(formData.get("prenom")),
    lastName: texteOuNull(formData.get("nom")),

    address1: texteOuNull(formData.get("adresse1")),
    address2: texteOuNull(formData.get("adresse2")),
    city: texteOuNull(formData.get("ville")),
    postCode: texteOuNull(formData.get("codePostal")),
    commune: texteOuNull(formData.get("commune")),
    department: texteOuNull(formData.get("wilaya")),
    country: texteOuNull(formData.get("pays")) ?? "Algerie",

    phone1: texteOuNull(formData.get("telephone1")),
    phone2: texteOuNull(formData.get("telephone2")),
    mobile: texteOuNull(formData.get("mobile")),
    fax: texteOuNull(formData.get("fax")),
    email: texteOuNull(formData.get("email")),
    url: texteOuNull(formData.get("siteWeb")),

    taxId: texteOuNull(formData.get("identifiantFiscal")),
    nif: texteOuNull(formData.get("nif")),
    nis: texteOuNull(formData.get("nis")),
    rc: texteOuNull(formData.get("rc")),
    ai: texteOuNull(formData.get("ai")),
    ccp: texteOuNull(formData.get("ccp")),
    legalForm: texteOuNull(formData.get("formeJuridique")),
    activity: texteOuNull(formData.get("activite")),
    accountingCode: texteOuNull(formData.get("compteComptable")),

    paymentMethod: valeurEnumeree(
      MODES_REGLEMENT,
      texteOuNull(formData.get("modeReglement")),
      "mode de reglement",
    ),
    deadlineDays: delaiBrut,
    discountRate: tauxPourcent(formData, "remise", "remise"),
    increaseRate: tauxPourcent(formData, "majoration", "majoration"),
    maxBalanceAmount: decimalZero(formData, "plafondEncours", "plafond d'encours"),
    exemptFromVat: booleen(formData.get("exonereTva")),

    isActive: booleen(formData.get("actif")),
    isBlocked,
    blockedReason: isBlocked ? motifBlocage : null,
    remark: texteOuNull(formData.get("remarque")),
  };
}

export async function actionCreerTiers(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.TIERS_ECRIRE);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("Le tiers a ete cree.", async () => {
    const champs = champsTiers(formData);

    const tiers = await prisma.$transaction(async (tx) => {
      const doublon = await tx.thirdParty.findUnique({
        where: { code: champs.code },
        select: { id: true },
      });
      if (doublon) {
        throw conflit(
          `Le code tiers « ${champs.code} » est deja utilise (tiers n° ${doublon.id}).`,
        );
      }

      // Le solde (`balance`) n'est jamais saisi : il provient des reglements et
      // des factures. Une fiche nouvelle demarre donc a zero.
      const cree = await tx.thirdParty.create({ data: { ...champs, balance: "0" } });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.REFERENTIEL,
          entity: "ThirdParty",
          entityId: cree.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: cree,
          comment: `Creation du tiers ${cree.code}`,
        },
        tx,
      );

      return cree;
    });

    revalidatePath("/referentiel/tiers");
    return { id: tiers.id };
  });
}

export async function actionModifierTiers(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.TIERS_ECRIRE);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("Les modifications du tiers ont ete enregistrees.", async () => {
    const tiersId = identifiantObligatoire(formData, "tiersId", "tiers");
    const champs = champsTiers(formData);

    const tiers = await prisma.$transaction(async (tx) => {
      const existant = await tx.thirdParty.findUnique({ where: { id: tiersId } });
      if (!existant) throw nonTrouve("Le tiers");

      if (champs.code !== existant.code) {
        const doublon = await tx.thirdParty.findUnique({
          where: { code: champs.code },
          select: { id: true },
        });
        if (doublon) {
          throw conflit(`Le code tiers « ${champs.code} » est deja utilise.`);
        }
      }

      // `balance` est volontairement absent de la mise a jour : le solde ne se
      // corrige jamais a la main depuis la fiche du tiers.
      const modifie = await tx.thirdParty.update({
        where: { id: tiersId },
        data: champs,
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.REFERENTIEL,
          entity: "ThirdParty",
          entityId: modifie.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: existant,
          newValue: modifie,
          comment: `Modification du tiers ${modifie.code}`,
          reason: modifie.isBlocked ? modifie.blockedReason : null,
        },
        tx,
      );

      return modifie;
    });

    revalidatePath("/referentiel/tiers");
    revalidatePath(`/referentiel/tiers/${tiers.id}`);
    return { id: tiers.id };
  });
}

// -----------------------------------------------------------------------------
// 4. Depots : creation d'emplacements
// -----------------------------------------------------------------------------

export async function actionCreerEmplacement(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.DEPOT_GERER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("L'emplacement a ete cree dans le depot.", async () => {
    const warehouseId = identifiantObligatoire(formData, "depotId", "depot");
    const code = texteObligatoire(formData.get("code"), "code emplacement");
    const label = texteObligatoire(formData.get("libelle"), "libelle emplacement");

    const emplacement = await prisma.$transaction(async (tx) => {
      const depot = await tx.warehouse.findUnique({
        where: { id: warehouseId },
        select: { id: true, code: true },
      });
      if (!depot) throw nonTrouve("Le depot");

      const doublon = await tx.location.findUnique({
        where: { warehouseId_code: { warehouseId, code } },
        select: { id: true },
      });
      if (doublon) {
        throw conflit(
          `L'emplacement « ${code} » existe deja dans le depot ${depot.code}.`,
        );
      }

      const cree = await tx.location.create({
        data: {
          warehouseId,
          code,
          label,
          aisle: texteOuNull(formData.get("allee")),
          rack: texteOuNull(formData.get("rayon")),
          level: texteOuNull(formData.get("niveau")),
          isActive: booleen(formData.get("actif")),
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.REFERENTIEL,
          entity: "Location",
          entityId: cree.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: cree,
          comment: `Creation de l'emplacement ${depot.code}/${cree.code}`,
        },
        tx,
      );

      return cree;
    });

    revalidatePath("/referentiel/depots");
    return { id: emplacement.id };
  });
}

// -----------------------------------------------------------------------------
// 5. Tarifs et prix
// -----------------------------------------------------------------------------

/** Contrôle la cohérence d'une période de validité saisie. */
function verifierPeriode(du: Date | null, au: Date | null): void {
  if (du !== null && au !== null && au.getTime() < du.getTime()) {
    throw validation(
      "La date de fin de validite ne peut pas preceder la date de debut.",
    );
  }
}

export async function actionCreerPrixVente(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.PRIX_GERER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("Le prix de vente a ete enregistre.", async () => {
    const itemId = identifiantObligatoire(formData, "articleId", "article");
    const thirdPartyId = entierOu(formData.get("tiersId"));
    const priceType = texteOuNull(formData.get("typePrix")) ?? "VENTE";
    const prix = decimalObligatoire(formData.get("prix"), "prix unitaire");
    if (D.lt(prix, 0)) {
      throw validation("Le prix unitaire ne peut pas etre negatif.", {
        prix: "Une valeur negative n'a pas de sens ici.",
      });
    }
    const remise = tauxPourcent(formData, "remise", "remise");
    const devise =
      texteOuNull(formData.get("devise")) ??
      (await lireParametreTexte(CLE_PARAMETRE.DEVISE, DEVISE_PAR_DEFAUT));
    const du = dateOuNull(formData.get("du"));
    const au = dateOuNull(formData.get("au"));
    verifierPeriode(du, au);

    const prixCree = await prisma.$transaction(async (tx) => {
      const article = await tx.item.findUnique({
        where: { id: itemId },
        select: { id: true, code: true },
      });
      if (!article) throw nonTrouve("L'article");

      if (thirdPartyId !== null) {
        const tiers = await tx.thirdParty.findUnique({
          where: { id: thirdPartyId },
          select: { id: true },
        });
        if (!tiers) throw nonTrouve("Le tiers");
      }

      const cree = await tx.itemPrice.create({
        data: {
          itemId,
          thirdPartyId,
          priceType,
          price: prix,
          currency: devise,
          discountRate: remise,
          validFrom: du,
          validTo: au,
          isActive: true,
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.REFERENTIEL,
          entity: "ItemPrice",
          entityId: cree.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: cree,
          comment: `Prix de vente ${priceType} pour l'article ${article.code}`,
        },
        tx,
      );

      return cree;
    });

    revalidatePath("/referentiel/tarifs");
    revalidatePath(`/referentiel/articles/${itemId}`);
    return { id: prixCree.id };
  });
}

/**
 * Retrait d'un prix de vente : la ligne n'est jamais supprimee, elle devient
 * inactive pour rester consultable dans l'historique des tarifs.
 */
export async function actionDesactiverPrixVente(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.PRIX_GERER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("Le prix de vente a ete retire du catalogue actif.", async () => {
    const prixId = identifiantObligatoire(formData, "prixId", "prix");

    const prix = await prisma.$transaction(async (tx) => {
      const existant = await tx.itemPrice.findUnique({ where: { id: prixId } });
      if (!existant) throw nonTrouve("Le prix de vente");
      if (!existant.isActive) {
        throw conflit("Ce prix de vente est deja inactif.");
      }

      const modifie = await tx.itemPrice.update({
        where: { id: prixId },
        data: { isActive: false },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.REFERENTIEL,
          entity: "ItemPrice",
          entityId: modifie.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { isActive: existant.isActive },
          newValue: { isActive: modifie.isActive },
          comment: "Retrait d'un prix de vente du catalogue actif",
        },
        tx,
      );

      return modifie;
    });

    revalidatePath("/referentiel/tarifs");
    revalidatePath(`/referentiel/articles/${prix.itemId}`);
    return { id: prix.id };
  });
}

export async function actionCreerPrixFournisseur(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.PRIX_GERER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("Le tarif fournisseur a ete enregistre.", async () => {
    const itemId = identifiantObligatoire(formData, "articleId", "article");
    const supplierId = identifiantObligatoire(formData, "fournisseurId", "fournisseur");
    const prix = decimalObligatoire(formData.get("prix"), "prix unitaire");
    if (D.lt(prix, 0)) {
      throw validation("Le prix unitaire ne peut pas etre negatif.", {
        prix: "Une valeur negative n'a pas de sens ici.",
      });
    }
    const quantiteMini = decimalZero(formData, "quantiteMini", "quantite minimum");
    const delaiBrut = entierOu(formData.get("delaiLivraison"), 0) ?? 0;
    if (delaiBrut < 0) {
      throw validation("Le delai de livraison ne peut pas etre negatif.", {
        delaiLivraison: "Valeur negative interdite.",
      });
    }
    const devise =
      texteOuNull(formData.get("devise")) ??
      (await lireParametreTexte(CLE_PARAMETRE.DEVISE, DEVISE_PAR_DEFAUT));
    const du = dateOuNull(formData.get("du"));
    const au = dateOuNull(formData.get("au"));
    verifierPeriode(du, au);

    const tarif = await prisma.$transaction(async (tx) => {
      const article = await tx.item.findUnique({
        where: { id: itemId },
        select: { id: true, code: true },
      });
      if (!article) throw nonTrouve("L'article");

      const fournisseur = await tx.thirdParty.findUnique({
        where: { id: supplierId },
        select: { id: true, code: true, isSupplier: true },
      });
      if (!fournisseur) throw nonTrouve("Le fournisseur");
      if (!fournisseur.isSupplier) {
        throw validation(
          `Le tiers ${fournisseur.code} n'est pas declare comme fournisseur : activez cette nature sur sa fiche avant de saisir un tarif d'achat.`,
        );
      }

      const cree = await tx.itemSupplierPrice.create({
        data: {
          itemId,
          supplierId,
          supplierRef: texteOuNull(formData.get("referenceFournisseur")),
          price: prix,
          currency: devise,
          leadTimeDays: delaiBrut,
          minQuantity: quantiteMini,
          validFrom: du,
          validTo: au,
          isPreferred: booleen(formData.get("offrePreferee")),
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.REFERENTIEL,
          entity: "ItemSupplierPrice",
          entityId: cree.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: cree,
          comment: `Tarif fournisseur ${fournisseur.code} pour l'article ${article.code}`,
        },
        tx,
      );

      return cree;
    });

    revalidatePath("/referentiel/tarifs");
    revalidatePath(`/referentiel/articles/${itemId}`);
    return { id: tarif.id };
  });
}

/**
 * Cloture d'un tarif fournisseur : la validite est arretee a la date du jour.
 * L'offre reste consultable, elle n'est simplement plus courante.
 */
export async function actionCloturerPrixFournisseur(
  formData: FormData,
): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.PRIX_GERER);
  const acteur: Acteur = { id: utilisateur.id, email: utilisateur.email };

  return executer("Le tarif fournisseur a ete cloture.", async () => {
    const tarifId = identifiantObligatoire(formData, "tarifId", "tarif fournisseur");

    const tarif = await prisma.$transaction(async (tx) => {
      const existant = await tx.itemSupplierPrice.findUnique({ where: { id: tarifId } });
      if (!existant) throw nonTrouve("Le tarif fournisseur");
      if (existant.validTo !== null) {
        throw conflit("Ce tarif fournisseur est deja cloture.");
      }

      const modifie = await tx.itemSupplierPrice.update({
        where: { id: tarifId },
        data: { validTo: new Date() },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.REFERENTIEL,
          entity: "ItemSupplierPrice",
          entityId: modifie.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { validTo: null },
          newValue: { validTo: modifie.validTo },
          comment: "Cloture d'un tarif fournisseur",
        },
        tx,
      );

      return modifie;
    });

    revalidatePath("/referentiel/tarifs");
    revalidatePath(`/referentiel/articles/${tarif.itemId}`);
    return { id: tarif.id };
  });
}
