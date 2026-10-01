import { Prisma } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D } from "@/lib/decimal";

/**
 * Parametres applicatifs configurables.
 * Aucune valeur metier sensible (devise, TVA, ponderation d'evaluation,
 * tolerances) n'est codee en dur : tout est pilotable par l'administrateur.
 */

export const CLE_PARAMETRE = {
  DEVISE: "DEVISE",
  DEVISE_SYMBOLE: "DEVISE_SYMBOLE",
  LOCALE: "LOCALE",
  TVA_DEFAUT: "TVA_DEFAUT",
  PAYS: "PAYS",
  RAISON_SOCIALE: "RAISON_SOCIALE",
  NIF: "NIF",
  RC: "RC",
  AI: "AI",
  ADRESSE_SOCIETE: "ADRESSE_SOCIETE",
  TELEPHONE_SOCIETE: "TELEPHONE_SOCIETE",

  STOCK_NEGATIF_AUTORISE: "STOCK_NEGATIF_AUTORISE",
  STOCK_TOLERANCE_ECART_INVENTAIRE: "STOCK_TOLERANCE_ECART_INVENTAIRE",
  QUALITE_LIBERATION_OBLIGATOIRE: "QUALITE_LIBERATION_OBLIGATOIRE",
  QUALITE_CONTROLE_RECEPTION_OBLIGATOIRE: "QUALITE_CONTROLE_RECEPTION_OBLIGATOIRE",
  PERTE_EXCEPTIONNELLE_VALIDATION_REQUISE: "PERTE_EXCEPTIONNELLE_VALIDATION_REQUISE",
  SEUIL_PERTE_EXCEPTIONNELLE_POURCENT: "SEUIL_PERTE_EXCEPTIONNELLE_POURCENT",

  EVAL_POIDS_PRODUCTIVITE: "EVAL_POIDS_PRODUCTIVITE",
  EVAL_POIDS_QUALITE: "EVAL_POIDS_QUALITE",
  EVAL_POIDS_EFFICACITE_MATIERE: "EVAL_POIDS_EFFICACITE_MATIERE",
  EVAL_POIDS_PRESENCE: "EVAL_POIDS_PRESENCE",
  EVAL_POIDS_POLYVALENCE: "EVAL_POIDS_POLYVALENCE",
  EVAL_AFFECTATIONS_MINIMUM: "EVAL_AFFECTATIONS_MINIMUM",
  EVAL_SEUIL_FIABILITE_FAIBLE: "EVAL_SEUIL_FIABILITE_FAIBLE",
  EVAL_SEUIL_FIABILITE_MOYENNE: "EVAL_SEUIL_FIABILITE_MOYENNE",
  EVAL_SEUIL_FIABILITE_BONNE: "EVAL_SEUIL_FIABILITE_BONNE",

  CATALOGUE_AUTO_PRODUCTION: "CATALOGUE_AUTO_PRODUCTION",
  TRANSFERT_AUTO_CHASSIS_PEINT: "TRANSFERT_AUTO_CHASSIS_PEINT",
  CODE_SEMI_FINI_CHASSIS: "CODE_SEMI_FINI_CHASSIS",

  DOSSIER_IMPORT_SOURCE: "DOSSIER_IMPORT_SOURCE",
  IMPORT_MISE_A_JOUR_AUTORISEE: "IMPORT_MISE_A_JOUR_AUTORISEE",
} as const;

export type CleParametre = (typeof CLE_PARAMETRE)[keyof typeof CLE_PARAMETRE];

interface DefinitionParametre {
  label: string;
  description: string;
  category: string;
  valeur: Prisma.InputJsonValue;
}

export const DEFINITIONS_PARAMETRES: Record<string, DefinitionParametre> = {
  [CLE_PARAMETRE.DEVISE]: {
    label: "Devise",
    description: "Code ISO de la devise utilisee pour les documents commerciaux.",
    category: "GENERAL",
    valeur: "DZD",
  },
  [CLE_PARAMETRE.DEVISE_SYMBOLE]: {
    label: "Symbole de la devise",
    description: "Symbole affiche apres les montants.",
    category: "GENERAL",
    valeur: "DA",
  },
  [CLE_PARAMETRE.LOCALE]: {
    label: "Langue de l'interface",
    description: "Locale utilisee pour les formats de date et de nombre.",
    category: "GENERAL",
    valeur: "fr-FR",
  },
  [CLE_PARAMETRE.TVA_DEFAUT]: {
    label: "Taux de TVA par defaut",
    description: "Taux applique lorsqu'aucun taux n'est precise sur une ligne.",
    category: "GENERAL",
    valeur: 19,
  },
  [CLE_PARAMETRE.PAYS]: {
    label: "Pays",
    description: "Pays de rattachement fiscal de l'entreprise.",
    category: "GENERAL",
    valeur: "Algerie",
  },
  [CLE_PARAMETRE.RAISON_SOCIALE]: {
    label: "Raison sociale",
    description: "Nom de l'entreprise figurant sur les documents imprimes.",
    category: "GENERAL",
    valeur: "ADMEDCO / MOBILIX",
  },
  [CLE_PARAMETRE.NIF]: {
    label: "Numero d'identification fiscale",
    description: "NIF imprime sur les factures.",
    category: "GENERAL",
    valeur: "",
  },
  [CLE_PARAMETRE.RC]: {
    label: "Registre de commerce",
    description: "Numero de registre de commerce.",
    category: "GENERAL",
    valeur: "",
  },
  [CLE_PARAMETRE.AI]: {
    label: "Article d'imposition",
    description: "Numero d'article d'imposition.",
    category: "GENERAL",
    valeur: "",
  },
  [CLE_PARAMETRE.ADRESSE_SOCIETE]: {
    label: "Adresse de l'entreprise",
    description: "Adresse postale complete.",
    category: "GENERAL",
    valeur: "",
  },
  [CLE_PARAMETRE.TELEPHONE_SOCIETE]: {
    label: "Telephone de l'entreprise",
    description: "Numero de telephone principal.",
    category: "GENERAL",
    valeur: "",
  },

  [CLE_PARAMETRE.STOCK_NEGATIF_AUTORISE]: {
    label: "Autoriser le stock negatif",
    description:
      "Si desactive, toute sortie superieure au stock disponible est refusee, sauf permission explicite.",
    category: "STOCK",
    valeur: false,
  },
  [CLE_PARAMETRE.STOCK_TOLERANCE_ECART_INVENTAIRE]: {
    label: "Tolerance d'ecart d'inventaire",
    description: "Pourcentage d'ecart au-dela duquel un inventaire exige une justification.",
    category: "STOCK",
    valeur: 5,
  },
  [CLE_PARAMETRE.QUALITE_LIBERATION_OBLIGATOIRE]: {
    label: "Liberation qualite obligatoire avant vente",
    description:
      "Lorsque cette option est active, un produit fini ne devient vendable qu'apres liberation par la qualite.",
    category: "QUALITE",
    valeur: true,
  },
  [CLE_PARAMETRE.QUALITE_CONTROLE_RECEPTION_OBLIGATOIRE]: {
    label: "Controle qualite obligatoire a la reception",
    description: "Chaque reception fournisseur passe en controle qualite avant mise en stock libre.",
    category: "QUALITE",
    valeur: true,
  },
  [CLE_PARAMETRE.PERTE_EXCEPTIONNELLE_VALIDATION_REQUISE]: {
    label: "Validation requise pour une perte exceptionnelle",
    description: "Une perte exceptionnelle doit etre validee par un responsable.",
    category: "PRODUCTION",
    valeur: true,
  },
  [CLE_PARAMETRE.SEUIL_PERTE_EXCEPTIONNELLE_POURCENT]: {
    label: "Seuil de perte exceptionnelle",
    description: "Pourcentage de perte au-dela duquel la declaration est consideree exceptionnelle.",
    category: "PRODUCTION",
    valeur: 3,
  },

  [CLE_PARAMETRE.EVAL_POIDS_PRODUCTIVITE]: {
    label: "Ponderation - productivite",
    description: "Poids de la productivite dans la performance globale (en pourcentage).",
    category: "EVALUATION",
    valeur: 30,
  },
  [CLE_PARAMETRE.EVAL_POIDS_QUALITE]: {
    label: "Ponderation - qualite",
    description: "Poids de la qualite dans la performance globale (en pourcentage).",
    category: "EVALUATION",
    valeur: 25,
  },
  [CLE_PARAMETRE.EVAL_POIDS_EFFICACITE_MATIERE]: {
    label: "Ponderation - efficacite matiere",
    description: "Poids de l'efficacite matiere dans la performance globale (en pourcentage).",
    category: "EVALUATION",
    valeur: 20,
  },
  [CLE_PARAMETRE.EVAL_POIDS_PRESENCE]: {
    label: "Ponderation - presence",
    description: "Poids de la presence dans la performance globale (en pourcentage).",
    category: "EVALUATION",
    valeur: 15,
  },
  [CLE_PARAMETRE.EVAL_POIDS_POLYVALENCE]: {
    label: "Ponderation - polyvalence",
    description: "Poids de la polyvalence dans la performance globale (en pourcentage).",
    category: "EVALUATION",
    valeur: 10,
  },
  [CLE_PARAMETRE.EVAL_AFFECTATIONS_MINIMUM]: {
    label: "Nombre minimum d'affectations",
    description:
      "En dessous de ce nombre d'affectations sur la periode, la fiabilite de l'evaluation est signalee comme insuffisante.",
    category: "EVALUATION",
    valeur: 3,
  },
  [CLE_PARAMETRE.EVAL_SEUIL_FIABILITE_FAIBLE]: {
    label: "Seuil de fiabilite - faible",
    description: "Nombre d'affectations a partir duquel la fiabilite devient faible.",
    category: "EVALUATION",
    valeur: 3,
  },
  [CLE_PARAMETRE.EVAL_SEUIL_FIABILITE_MOYENNE]: {
    label: "Seuil de fiabilite - moyenne",
    description: "Nombre d'affectations a partir duquel la fiabilite devient moyenne.",
    category: "EVALUATION",
    valeur: 8,
  },
  [CLE_PARAMETRE.EVAL_SEUIL_FIABILITE_BONNE]: {
    label: "Seuil de fiabilite - bonne",
    description: "Nombre d'affectations a partir duquel la fiabilite devient bonne.",
    category: "EVALUATION",
    valeur: 20,
  },

  [CLE_PARAMETRE.CATALOGUE_AUTO_PRODUCTION]: {
    label: "Creation automatique de l'ordre de fabrication",
    description:
      "Une commande client confirmee cree automatiquement un ordre de fabrication pour les articles configurables.",
    category: "COMMERCIAL",
    valeur: true,
  },
  [CLE_PARAMETRE.TRANSFERT_AUTO_CHASSIS_PEINT]: {
    label: "Transfert automatique du chassis peint",
    description:
      "A la fin de l'operation de poudrage, le chassis peint est transfere du depot ADMEDCO vers le depot MOBILIX.",
    category: "PRODUCTION",
    valeur: true,
  },
  [CLE_PARAMETRE.CODE_SEMI_FINI_CHASSIS]: {
    label: "Code du semi-fini chassis peint",
    description:
      "Code logique de l'article semi-fini produit par la fin du poudrage, avant recherche d'un article equivalent importe.",
    category: "PRODUCTION",
    valeur: "SF-CHASSIS-PEINT",
  },

  [CLE_PARAMETRE.DOSSIER_IMPORT_SOURCE]: {
    label: "Dossier des fichiers sources",
    description:
      "Dossier contenant les fichiers CSV de l'ancien ERP (COM_ItemFamily.csv, COM_Item.csv, COM_Formula.csv, COM_BOM.csv, COM_Batch.csv, COM_ThirdParty.csv, ...).",
    category: "IMPORT",
    valeur: "E:\\Massiexporte",
  },
  [CLE_PARAMETRE.IMPORT_MISE_A_JOUR_AUTORISEE]: {
    label: "Mise a jour des fiches lors des imports",
    description:
      "Autorise un import a mettre a jour une fiche deja importee. Une fiche modifiee dans la plateforme reste protegee et n'est jamais ecrasee.",
    category: "IMPORT",
    valeur: false,
  },
};

export interface ParametreAffiche {
  key: string;
  label: string;
  description: string;
  category: string;
  value: Prisma.JsonValue;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/** Cree les parametres manquants sans ecraser les valeurs existantes. */
export async function initialiserParametres(db: Db = prisma): Promise<number> {
  let crees = 0;
  for (const [key, definition] of Object.entries(DEFINITIONS_PARAMETRES)) {
    const existant = await db.appSetting.findUnique({ where: { key } });
    if (!existant) {
      await db.appSetting.create({
        data: {
          key,
          value: definition.valeur,
          category: definition.category,
          label: definition.label,
          description: definition.description,
        },
      });
      crees += 1;
    }
  }
  return crees;
}

export async function lireParametre<T = Prisma.JsonValue>(
  key: string,
  db: Db = prisma,
): Promise<T | null> {
  const enregistrement = await db.appSetting.findUnique({ where: { key } });
  if (enregistrement) return enregistrement.value as T;
  const definition = DEFINITIONS_PARAMETRES[key];
  return definition ? (definition.valeur as T) : null;
}

export async function lireParametreTexte(
  key: string,
  defaut = "",
  db: Db = prisma,
): Promise<string> {
  const valeur = await lireParametre(key, db);
  return typeof valeur === "string" ? valeur : defaut;
}

export async function lireParametreNombre(
  key: string,
  defaut = 0,
  db: Db = prisma,
): Promise<number> {
  const valeur = await lireParametre(key, db);
  if (typeof valeur === "number") return valeur;
  if (typeof valeur === "string") {
    const nombre = Number(valeur.replace(",", "."));
    return Number.isFinite(nombre) ? nombre : defaut;
  }
  return defaut;
}

export async function lireParametreBooleen(
  key: string,
  defaut = false,
  db: Db = prisma,
): Promise<boolean> {
  const valeur = await lireParametre(key, db);
  return typeof valeur === "boolean" ? valeur : defaut;
}

export async function ecrireParametre(
  key: string,
  valeur: Prisma.InputJsonValue,
  utilisateur: { id: number; email: string },
  db: Db = prisma,
): Promise<void> {
  const definition = DEFINITIONS_PARAMETRES[key];
  const ancien = await db.appSetting.findUnique({ where: { key } });

  await db.appSetting.upsert({
    where: { key },
    create: {
      key,
      value: valeur,
      category: definition?.category ?? "GENERAL",
      label: definition?.label ?? key,
      description: definition?.description ?? null,
      updatedBy: utilisateur.email,
    },
    update: {
      value: valeur,
      updatedBy: utilisateur.email,
    },
  });

  const { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } = await import("@/lib/audit");
  await enregistrerAudit(
    {
      action: ACTIONS_AUDIT.MODIFICATION,
      module: MODULES_AUDIT.SYSTEME,
      entity: "AppSetting",
      entityId: key,
      userId: utilisateur.id,
      userEmail: utilisateur.email,
      oldValue: ancien?.value ?? null,
      newValue: valeur,
    },
    db,
  );
}

export async function listerParametres(db: Db = prisma): Promise<ParametreAffiche[]> {
  const enregistrements = await db.appSetting.findMany({ orderBy: { key: "asc" } });
  const parCle = new Map(enregistrements.map((e) => [e.key, e]));

  const resultat: ParametreAffiche[] = [];

  for (const [key, definition] of Object.entries(DEFINITIONS_PARAMETRES)) {
    const enregistrement = parCle.get(key);
    resultat.push({
      key,
      label: definition.label,
      description: definition.description,
      category: definition.category,
      value: (enregistrement?.value ?? definition.valeur) as Prisma.JsonValue,
      updatedAt: enregistrement?.updatedAt ?? null,
      updatedBy: enregistrement?.updatedBy ?? null,
    });
  }

  // Parametres presents en base mais absents du catalogue : ils restent visibles.
  for (const enregistrement of enregistrements) {
    if (!DEFINITIONS_PARAMETRES[enregistrement.key]) {
      resultat.push({
        key: enregistrement.key,
        label: enregistrement.label,
        description: enregistrement.description ?? "",
        category: enregistrement.category,
        value: enregistrement.value,
        updatedAt: enregistrement.updatedAt,
        updatedBy: enregistrement.updatedBy,
      });
    }
  }

  return resultat;
}

export interface PonderationEvaluation {
  productivite: Prisma.Decimal;
  qualite: Prisma.Decimal;
  efficaciteMatiere: Prisma.Decimal;
  presence: Prisma.Decimal;
  polyvalence: Prisma.Decimal;
  total: Prisma.Decimal;
  copie: Record<string, number>;
}

/** Ponderations d'evaluation lues en base : jamais codees en dur. */
export async function ponderationsEvaluation(db: Db = prisma): Promise<PonderationEvaluation> {
  const [productivite, qualite, efficaciteMatiere, presence, polyvalence] = await Promise.all([
    lireParametreNombre(CLE_PARAMETRE.EVAL_POIDS_PRODUCTIVITE, 30, db),
    lireParametreNombre(CLE_PARAMETRE.EVAL_POIDS_QUALITE, 25, db),
    lireParametreNombre(CLE_PARAMETRE.EVAL_POIDS_EFFICACITE_MATIERE, 20, db),
    lireParametreNombre(CLE_PARAMETRE.EVAL_POIDS_PRESENCE, 15, db),
    lireParametreNombre(CLE_PARAMETRE.EVAL_POIDS_POLYVALENCE, 10, db),
  ]);

  const copie = {
    productivite,
    qualite,
    efficaciteMatiere,
    presence,
    polyvalence,
  };

  const total = D.sum([
    productivite,
    qualite,
    efficaciteMatiere,
    presence,
    polyvalence,
  ]);

  return {
    productivite: D.of(productivite),
    qualite: D.of(qualite),
    efficaciteMatiere: D.of(efficaciteMatiere),
    presence: D.of(presence),
    polyvalence: D.of(polyvalence),
    total,
    copie,
  };
}
