/**
 * Catalogue des permissions de la plateforme.
 * Source unique de verite : le seed cree ces permissions en base, et le code
 * les verifie via `requirePermission`. Aucune permission n'est inventee ailleurs.
 */

export const MODULES = {
  SYSTEME: "Systeme",
  REFERENTIEL: "Referentiel",
  NOMENCLATURE: "Nomenclature",
  STOCK: "Stocks",
  PRODUCTION: "Production",
  QUALITE: "Qualite",
  ACHAT: "Achats",
  VENTE: "Ventes",
  FINANCE: "Finance",
  RH: "Ressources humaines",
  PORTAIL: "Portail employe",
  RAPPORT: "Rapports",
} as const;

export type ModuleCode = keyof typeof MODULES;

export interface PermissionDefinition {
  code: string;
  label: string;
  module: ModuleCode;
  description?: string;
}

export const PERMISSIONS = {
  // --- Systeme -------------------------------------------------------------
  SYSTEME_ADMIN: "SYSTEME_ADMIN",
  UTILISATEUR_LIRE: "UTILISATEUR_LIRE",
  UTILISATEUR_GERER: "UTILISATEUR_GERER",
  ROLE_LIRE: "ROLE_LIRE",
  ROLE_GERER: "ROLE_GERER",
  CONFIG_LIRE: "CONFIG_LIRE",
  CONFIG_GERER: "CONFIG_GERER",
  IMPORT_EXECUTER: "IMPORT_EXECUTER",
  IMPORT_LIRE: "IMPORT_LIRE",
  AUDIT_LIRE: "AUDIT_LIRE",

  // --- Referentiel ---------------------------------------------------------
  ARTICLE_LIRE: "ARTICLE_LIRE",
  ARTICLE_ECRIRE: "ARTICLE_ECRIRE",
  ARTICLE_ARCHIVER: "ARTICLE_ARCHIVER",
  FAMILLE_LIRE: "FAMILLE_LIRE",
  FAMILLE_GERER: "FAMILLE_GERER",
  DEPOT_LIRE: "DEPOT_LIRE",
  DEPOT_GERER: "DEPOT_GERER",
  TIERS_LIRE: "TIERS_LIRE",
  TIERS_ECRIRE: "TIERS_ECRIRE",
  PRIX_LIRE: "PRIX_LIRE",
  PRIX_GERER: "PRIX_GERER",

  // --- Nomenclature --------------------------------------------------------
  NOMENCLATURE_LIRE: "NOMENCLATURE_LIRE",
  NOMENCLATURE_ECRIRE: "NOMENCLATURE_ECRIRE",
  NOMENCLATURE_VALIDER: "NOMENCLATURE_VALIDER",
  GAMME_LIRE: "GAMME_LIRE",
  GAMME_GERER: "GAMME_GERER",

  // --- Stocks --------------------------------------------------------------
  STOCK_LIRE: "STOCK_LIRE",
  STOCK_MOUVEMENT_CREER: "STOCK_MOUVEMENT_CREER",
  STOCK_TRANSFERT: "STOCK_TRANSFERT",
  STOCK_INVENTAIRE: "STOCK_INVENTAIRE",
  STOCK_CORRECTION: "STOCK_CORRECTION",
  STOCK_ANNULER_MOUVEMENT: "STOCK_ANNULER_MOUVEMENT",
  STOCK_NEGATIF_AUTORISER: "STOCK_NEGATIF_AUTORISER",
  STOCK_LOT_GERER: "STOCK_LOT_GERER",
  STOCK_VALORISATION_LIRE: "STOCK_VALORISATION_LIRE",

  // --- Production ----------------------------------------------------------
  PRODUCTION_LIRE: "PRODUCTION_LIRE",
  PRODUCTION_ORDRE_CREER: "PRODUCTION_ORDRE_CREER",
  PRODUCTION_ORDRE_MODIFIER: "PRODUCTION_ORDRE_MODIFIER",
  PRODUCTION_LANCER: "PRODUCTION_LANCER",
  PRODUCTION_DECLARER: "PRODUCTION_DECLARER",
  PRODUCTION_KANBAN_DEPLACER: "PRODUCTION_KANBAN_DEPLACER",
  PRODUCTION_VALIDER_DECLARATION: "PRODUCTION_VALIDER_DECLARATION",
  PRODUCTION_CLOTURER: "PRODUCTION_CLOTURER",
  PRODUCTION_ANNULER: "PRODUCTION_ANNULER",

  // --- Atelier : sous-stocks, transferts d'etape, programme, QR de poste ----
  PRODUCTION_SOUS_STOCK_LIRE: "PRODUCTION_SOUS_STOCK_LIRE",
  PRODUCTION_SOUS_STOCK_GERER: "PRODUCTION_SOUS_STOCK_GERER",
  PRODUCTION_TRANSFERT_ETAPE: "PRODUCTION_TRANSFERT_ETAPE",
  PRODUCTION_PLANNING_LIRE: "PRODUCTION_PLANNING_LIRE",
  PRODUCTION_PLANNING_GERER: "PRODUCTION_PLANNING_GERER",
  POSTE_QR_GERER: "POSTE_QR_GERER",

  // --- Qualite -------------------------------------------------------------
  QUALITE_LIRE: "QUALITE_LIRE",
  QUALITE_CONTROLER: "QUALITE_CONTROLER",
  QUALITE_DECIDER: "QUALITE_DECIDER",
  QUALITE_LIBERER: "QUALITE_LIBERER",
  QUALITE_NONCONFORMITE_GERER: "QUALITE_NONCONFORMITE_GERER",
  QUALITE_PLAN_GERER: "QUALITE_PLAN_GERER",

  // --- Achats --------------------------------------------------------------
  ACHAT_LIRE: "ACHAT_LIRE",
  ACHAT_DEMANDE_CREER: "ACHAT_DEMANDE_CREER",
  ACHAT_COMMANDE_CREER: "ACHAT_COMMANDE_CREER",
  ACHAT_COMMANDE_APPROUVER: "ACHAT_COMMANDE_APPROUVER",
  ACHAT_RECEPTIONNER: "ACHAT_RECEPTIONNER",
  ACHAT_FACTURE_SAISIR: "ACHAT_FACTURE_SAISIR",
  ACHAT_TIERS_MATCHING: "ACHAT_TIERS_MATCHING",

  // --- Ventes --------------------------------------------------------------
  VENTE_LIRE: "VENTE_LIRE",
  VENTE_DEVIS_CREER: "VENTE_DEVIS_CREER",
  VENTE_COMMANDE_CREER: "VENTE_COMMANDE_CREER",
  VENTE_COMMANDE_CONFIRMER: "VENTE_COMMANDE_CONFIRMER",
  VENTE_LIVRER: "VENTE_LIVRER",
  VENTE_FACTURER: "VENTE_FACTURER",
  VENTE_TARIF_GERER: "VENTE_TARIF_GERER",

  // --- Finance -------------------------------------------------------------
  FINANCE_LIRE: "FINANCE_LIRE",
  REGLEMENT_SAISIR: "REGLEMENT_SAISIR",
  REGLEMENT_VALIDER: "REGLEMENT_VALIDER",
  COMPTABILITE_LIRE: "COMPTABILITE_LIRE",
  COMPTABILITE_SAISIR: "COMPTABILITE_SAISIR",
  COMPTABILITE_POSTER: "COMPTABILITE_POSTER",
  COMPTABILITE_CONTREPASSER: "COMPTABILITE_CONTREPASSER",
  COMPTABILITE_CLOTURER: "COMPTABILITE_CLOTURER",
  COMPTABILITE_REGLES_GERER: "COMPTABILITE_REGLES_GERER",
  PLAN_COMPTABLE_GERER: "PLAN_COMPTABLE_GERER",

  // --- Ressources humaines -------------------------------------------------
  RH_LIRE: "RH_LIRE",
  RH_ECRIRE: "RH_ECRIRE",
  RH_SALAIRE_LIRE: "RH_SALAIRE_LIRE",
  RH_AFFECTATION_LIRE: "RH_AFFECTATION_LIRE",
  RH_AFFECTATION_GERER: "RH_AFFECTATION_GERER",
  RH_PRESENCE_LIRE: "RH_PRESENCE_LIRE",
  RH_PRESENCE_GERER: "RH_PRESENCE_GERER",
  RH_EVALUATION_LIRE: "RH_EVALUATION_LIRE",
  RH_EVALUATION_CALCULER: "RH_EVALUATION_CALCULER",
  RH_EVALUATION_VALIDER: "RH_EVALUATION_VALIDER",
  RH_COMPETENCE_GERER: "RH_COMPETENCE_GERER",

  // --- Portail employe -----------------------------------------------------
  PORTAIL_EMPLOYE: "PORTAIL_EMPLOYE",
  PORTAIL_POSTE_SCANNER: "PORTAIL_POSTE_SCANNER",

  // --- Rapports ------------------------------------------------------------
  RAPPORT_LIRE: "RAPPORT_LIRE",
  RAPPORT_EXPORTER: "RAPPORT_EXPORTER",
  TABLEAU_BORD_LIRE: "TABLEAU_BORD_LIRE",
  TABLEAU_BORD_FINANCE: "TABLEAU_BORD_FINANCE",
  TABLEAU_BORD_RH: "TABLEAU_BORD_RH",
  TABLEAU_BORD_PRODUCTION: "TABLEAU_BORD_PRODUCTION",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Portee geographique / division d'un utilisateur. */
export const SCOPE_PERMISSIONS = {
  PORTEE_TOUTES_USINES: "PORTEE_TOUTES_USINES",
  PORTEE_ADMEDCO: "PORTEE_ADMEDCO",
  PORTEE_MOBILIX: "PORTEE_MOBILIX",
} as const;

export type ScopePermissionCode =
  (typeof SCOPE_PERMISSIONS)[keyof typeof SCOPE_PERMISSIONS];

const def = (
  code: string,
  label: string,
  module: ModuleCode,
  description?: string,
): PermissionDefinition => ({ code, label, module, description });

/**
 * Definitions completes : libelles francais affiches dans l'administration
 * des roles et des permissions.
 */
export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  // Systeme
  def(PERMISSIONS.SYSTEME_ADMIN, "Administration complete du systeme", "SYSTEME"),
  def(PERMISSIONS.UTILISATEUR_LIRE, "Consulter les utilisateurs", "SYSTEME"),
  def(PERMISSIONS.UTILISATEUR_GERER, "Creer et modifier les utilisateurs", "SYSTEME"),
  def(PERMISSIONS.ROLE_LIRE, "Consulter les roles", "SYSTEME"),
  def(PERMISSIONS.ROLE_GERER, "Gerer les roles et permissions", "SYSTEME"),
  def(PERMISSIONS.CONFIG_LIRE, "Consulter la configuration", "SYSTEME"),
  def(PERMISSIONS.CONFIG_GERER, "Modifier la configuration", "SYSTEME"),
  def(PERMISSIONS.IMPORT_LIRE, "Consulter les journaux d'import", "SYSTEME"),
  def(PERMISSIONS.IMPORT_EXECUTER, "Lancer un import de donnees", "SYSTEME"),
  def(PERMISSIONS.AUDIT_LIRE, "Consulter le journal d'audit", "SYSTEME"),

  // Referentiel
  def(PERMISSIONS.ARTICLE_LIRE, "Consulter les articles", "REFERENTIEL"),
  def(PERMISSIONS.ARTICLE_ECRIRE, "Creer et modifier les articles", "REFERENTIEL"),
  def(PERMISSIONS.ARTICLE_ARCHIVER, "Archiver un article", "REFERENTIEL"),
  def(PERMISSIONS.FAMILLE_LIRE, "Consulter les familles d'articles", "REFERENTIEL"),
  def(PERMISSIONS.FAMILLE_GERER, "Gerer les familles d'articles", "REFERENTIEL"),
  def(PERMISSIONS.DEPOT_LIRE, "Consulter les depots et emplacements", "REFERENTIEL"),
  def(PERMISSIONS.DEPOT_GERER, "Gerer les depots et emplacements", "REFERENTIEL"),
  def(PERMISSIONS.TIERS_LIRE, "Consulter les clients et fournisseurs", "REFERENTIEL"),
  def(PERMISSIONS.TIERS_ECRIRE, "Creer et modifier les tiers", "REFERENTIEL"),
  def(PERMISSIONS.PRIX_LIRE, "Consulter les prix et tarifs", "REFERENTIEL"),
  def(PERMISSIONS.PRIX_GERER, "Gerer les prix et tarifs", "REFERENTIEL"),

  // Nomenclature
  def(PERMISSIONS.NOMENCLATURE_LIRE, "Consulter les nomenclatures", "NOMENCLATURE"),
  def(PERMISSIONS.NOMENCLATURE_ECRIRE, "Creer et modifier les nomenclatures", "NOMENCLATURE"),
  def(PERMISSIONS.NOMENCLATURE_VALIDER, "Valider et activer une version de nomenclature", "NOMENCLATURE"),
  def(PERMISSIONS.GAMME_LIRE, "Consulter les gammes de fabrication", "NOMENCLATURE"),
  def(PERMISSIONS.GAMME_GERER, "Gerer les gammes de fabrication", "NOMENCLATURE"),

  // Stock
  def(PERMISSIONS.STOCK_LIRE, "Consulter les stocks et mouvements", "STOCK"),
  def(PERMISSIONS.STOCK_MOUVEMENT_CREER, "Enregistrer un mouvement de stock", "STOCK"),
  def(PERMISSIONS.STOCK_TRANSFERT, "Effectuer un transfert entre depots", "STOCK"),
  def(PERMISSIONS.STOCK_INVENTAIRE, "Saisir un inventaire physique", "STOCK"),
  def(PERMISSIONS.STOCK_CORRECTION, "Corriger un stock avec justification", "STOCK"),
  def(PERMISSIONS.STOCK_ANNULER_MOUVEMENT, "Annuler un mouvement de stock", "STOCK"),
  def(PERMISSIONS.STOCK_NEGATIF_AUTORISER, "Autoriser une sortie superieure au stock disponible", "STOCK"),
  def(PERMISSIONS.STOCK_LOT_GERER, "Gerer les lots et leurs statuts", "STOCK"),
  def(PERMISSIONS.STOCK_VALORISATION_LIRE, "Consulter la valorisation du stock", "STOCK"),

  // Production
  def(PERMISSIONS.PRODUCTION_LIRE, "Consulter les ordres de fabrication", "PRODUCTION"),
  def(PERMISSIONS.PRODUCTION_ORDRE_CREER, "Creer un ordre de fabrication", "PRODUCTION"),
  def(PERMISSIONS.PRODUCTION_ORDRE_MODIFIER, "Modifier un ordre de fabrication", "PRODUCTION"),
  def(PERMISSIONS.PRODUCTION_LANCER, "Lancer un ordre de fabrication", "PRODUCTION"),
  def(PERMISSIONS.PRODUCTION_DECLARER, "Declarer production, consommation et pertes", "PRODUCTION"),
  def(PERMISSIONS.PRODUCTION_KANBAN_DEPLACER, "Deplacer une carte Kanban", "PRODUCTION"),
  def(PERMISSIONS.PRODUCTION_VALIDER_DECLARATION, "Valider les declarations d'atelier", "PRODUCTION"),
  def(PERMISSIONS.PRODUCTION_CLOTURER, "Cloturer un ordre de fabrication", "PRODUCTION"),
  def(PERMISSIONS.PRODUCTION_ANNULER, "Annuler un ordre de fabrication", "PRODUCTION"),

  // Atelier : sous-stocks, transferts d'etape, programme, QR de poste
  def(PERMISSIONS.PRODUCTION_SOUS_STOCK_LIRE, "Consulter les sous-stocks d'operation", "PRODUCTION"),
  def(PERMISSIONS.PRODUCTION_SOUS_STOCK_GERER, "Creer et definir les sous-stocks d'operation", "PRODUCTION"),
  def(PERMISSIONS.PRODUCTION_TRANSFERT_ETAPE, "Transferer une quantite conforme vers l'etape suivante", "PRODUCTION"),
  def(PERMISSIONS.PRODUCTION_PLANNING_LIRE, "Consulter le programme de travail des ateliers", "PRODUCTION"),
  def(PERMISSIONS.PRODUCTION_PLANNING_GERER, "Etablir, publier et reaffecter le programme de travail", "PRODUCTION"),
  def(PERMISSIONS.POSTE_QR_GERER, "Generer, imprimer et revoquer les QR de poste", "PRODUCTION"),

  // Qualite
  def(PERMISSIONS.QUALITE_LIRE, "Consulter les controles et non-conformites", "QUALITE"),
  def(PERMISSIONS.QUALITE_CONTROLER, "Saisir un controle qualite", "QUALITE"),
  def(PERMISSIONS.QUALITE_DECIDER, "Rendre une decision qualite", "QUALITE"),
  def(PERMISSIONS.QUALITE_LIBERER, "Liberer un article ou un lot bloque", "QUALITE"),
  def(PERMISSIONS.QUALITE_NONCONFORMITE_GERER, "Gerer les non-conformites", "QUALITE"),
  def(PERMISSIONS.QUALITE_PLAN_GERER, "Gerer les plans de controle", "QUALITE"),

  // Achats
  def(PERMISSIONS.ACHAT_LIRE, "Consulter les achats", "ACHAT"),
  def(PERMISSIONS.ACHAT_DEMANDE_CREER, "Creer une demande d'achat", "ACHAT"),
  def(PERMISSIONS.ACHAT_COMMANDE_CREER, "Creer un bon de commande fournisseur", "ACHAT"),
  def(PERMISSIONS.ACHAT_COMMANDE_APPROUVER, "Approuver un bon de commande", "ACHAT"),
  def(PERMISSIONS.ACHAT_RECEPTIONNER, "Receptionner une commande fournisseur", "ACHAT"),
  def(PERMISSIONS.ACHAT_FACTURE_SAISIR, "Saisir une facture fournisseur", "ACHAT"),
  def(PERMISSIONS.ACHAT_TIERS_MATCHING, "Rapprocher commande, reception et facture", "ACHAT"),

  // Ventes
  def(PERMISSIONS.VENTE_LIRE, "Consulter les ventes", "VENTE"),
  def(PERMISSIONS.VENTE_DEVIS_CREER, "Creer un devis", "VENTE"),
  def(PERMISSIONS.VENTE_COMMANDE_CREER, "Creer une commande client", "VENTE"),
  def(PERMISSIONS.VENTE_COMMANDE_CONFIRMER, "Confirmer une commande client", "VENTE"),
  def(PERMISSIONS.VENTE_LIVRER, "Creer un bon de livraison", "VENTE"),
  def(PERMISSIONS.VENTE_FACTURER, "Creer une facture client", "VENTE"),
  def(PERMISSIONS.VENTE_TARIF_GERER, "Gerer les tarifs clients", "VENTE"),

  // Finance
  def(PERMISSIONS.FINANCE_LIRE, "Consulter les donnees financieres", "FINANCE"),
  def(PERMISSIONS.REGLEMENT_SAISIR, "Saisir un reglement", "FINANCE"),
  def(PERMISSIONS.REGLEMENT_VALIDER, "Valider un reglement", "FINANCE"),
  def(PERMISSIONS.COMPTABILITE_LIRE, "Consulter la comptabilite", "FINANCE"),
  def(PERMISSIONS.COMPTABILITE_SAISIR, "Saisir une ecriture comptable", "FINANCE"),
  def(PERMISSIONS.COMPTABILITE_POSTER, "Poster une ecriture comptable", "FINANCE"),
  def(PERMISSIONS.COMPTABILITE_CONTREPASSER, "Contrepasser une ecriture postee", "FINANCE"),
  def(PERMISSIONS.COMPTABILITE_CLOTURER, "Cloturer un exercice ou une periode", "FINANCE"),
  def(PERMISSIONS.COMPTABILITE_REGLES_GERER, "Gerer les regles d'ecriture", "FINANCE"),
  def(PERMISSIONS.PLAN_COMPTABLE_GERER, "Gerer le plan comptable et les journaux", "FINANCE"),

  // RH
  def(PERMISSIONS.RH_LIRE, "Consulter les employes", "RH"),
  def(PERMISSIONS.RH_ECRIRE, "Creer et modifier les employes", "RH"),
  def(PERMISSIONS.RH_SALAIRE_LIRE, "Consulter les donnees salariales", "RH"),
  def(PERMISSIONS.RH_AFFECTATION_LIRE, "Consulter les affectations", "RH"),
  def(PERMISSIONS.RH_AFFECTATION_GERER, "Gerer les affectations quotidiennes", "RH"),
  def(PERMISSIONS.RH_PRESENCE_LIRE, "Consulter les presences", "RH"),
  def(PERMISSIONS.RH_PRESENCE_GERER, "Gerer les presences", "RH"),
  def(PERMISSIONS.RH_EVALUATION_LIRE, "Consulter les evaluations", "RH"),
  def(PERMISSIONS.RH_EVALUATION_CALCULER, "Calculer les evaluations", "RH"),
  def(PERMISSIONS.RH_EVALUATION_VALIDER, "Valider une evaluation", "RH"),
  def(PERMISSIONS.RH_COMPETENCE_GERER, "Gerer les competences et la polyvalence", "RH"),

  // Portail
  def(PERMISSIONS.PORTAIL_EMPLOYE, "Acceder au portail employe", "PORTAIL"),
  def(PERMISSIONS.PORTAIL_POSTE_SCANNER, "Scanner le QR d'un poste de travail", "PORTAIL"),

  // Rapports
  def(PERMISSIONS.RAPPORT_LIRE, "Consulter les rapports", "RAPPORT"),
  def(PERMISSIONS.RAPPORT_EXPORTER, "Exporter les donnees", "RAPPORT"),
  def(PERMISSIONS.TABLEAU_BORD_LIRE, "Consulter les tableaux de bord", "RAPPORT"),
  def(PERMISSIONS.TABLEAU_BORD_FINANCE, "Consulter le tableau de bord financier", "RAPPORT"),
  def(PERMISSIONS.TABLEAU_BORD_RH, "Consulter le tableau de bord RH", "RAPPORT"),
  def(PERMISSIONS.TABLEAU_BORD_PRODUCTION, "Consulter le tableau de bord production", "RAPPORT"),
];

/** Liste exhaustive des codes de permission (utilisee par le seed). */
export const ALL_PERMISSION_CODES: string[] = PERMISSION_DEFINITIONS.map((p) => p.code);

export const ALL_SCOPE_CODES: string[] = Object.values(SCOPE_PERMISSIONS);

export function getPermissionLabel(code: string): string {
  return PERMISSION_DEFINITIONS.find((p) => p.code === code)?.label ?? code;
}

export function getPermissionModule(code: string): string {
  const definition = PERMISSION_DEFINITIONS.find((p) => p.code === code);
  return definition ? MODULES[definition.module] : "Autre";
}
