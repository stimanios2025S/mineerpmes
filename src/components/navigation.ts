import type { Factory } from "@prisma/client";
import { peutAccederUsine, estProprietaireUsine } from "@/lib/rbac/portee";
import type { SessionUser } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/rbac/permissions";

/**
 * Definition centrale de la navigation.
 *
 * Deux niveaux de filtrage, purement d'affichage :
 *  1. la PERMISSION exigee par la page (verifiee aussi dans la page) ;
 *  2. le PROFIL DE MENU du role (PROFIL_MENU), qui decide quelles sections
 *     apparaissent pour chaque metier.
 *
 * Le profil de menu ne protege rien : il organise. Masquer un onglet ne donne
 * aucun droit, et l'afficher n'en donne aucun non plus. La securite reste dans
 * la page, l'action serveur et la requete.
 */

export interface EntreeNavigation {
  chemin: string;
  usine?: Factory;
  libelle: string;
  /** Permission unique requise. */
  permission?: string;
  /** Permissions alternatives : l'une d'elles suffit. */
  permissionsAlternatives?: string[];
  description?: string;
  /** Restreint l'entree a certains roles (en plus de la permission). */
  rolesVisibles?: string[];
}

export interface SectionNavigation {
  code: string;
  titre: string;
  entrees: EntreeNavigation[];
}

export const NAVIGATION: SectionNavigation[] = [
  {
    code: "pilotage",
    titre: "Pilotage",
    entrees: [
      {
        chemin: "/tableau-de-bord",
        libelle: "Tableau de bord general",
        permission: PERMISSIONS.TABLEAU_BORD_LIRE,
        description: "Indicateurs consolides des deux divisions",
      },
      {
        chemin: "/direction/admedco",
        usine: "ADMEDCO",
        libelle: "Direction ADMEDCO",
        permission: PERMISSIONS.TABLEAU_BORD_LIRE,
        description: "Pilotage de la division metallurgie",
      },
      {
        chemin: "/direction/mobilix",
        usine: "MOBILIX",
        libelle: "Direction MOBILIX",
        permission: PERMISSIONS.TABLEAU_BORD_LIRE,
        description: "Pilotage de la division bois et garnissage",
      },
      {
        chemin: "/tableau-de-bord/production",
        libelle: "Pilotage production",
        permission: PERMISSIONS.TABLEAU_BORD_PRODUCTION,
      },
      {
        chemin: "/tableau-de-bord/finance",
        libelle: "Pilotage finance",
        permission: PERMISSIONS.TABLEAU_BORD_FINANCE,
      },
      {
        chemin: "/tableau-de-bord/rh",
        libelle: "Pilotage ressources humaines",
        permission: PERMISSIONS.TABLEAU_BORD_RH,
      },
    ],
  },
  {
    code: "ateliers",
    titre: "Mes ateliers",
    entrees: [
      {
        chemin: "/atelier/ADM-A01",
        usine: "ADMEDCO",
        libelle: "ADMEDCO A01 - Coupe avec centrage",
        permission: PERMISSIONS.TABLEAU_BORD_PRODUCTION,
        rolesVisibles: ["ADMIN_SYSTEME", "RESPONSABLE_USINE", "RESPONSABLE_ADMEDCO", "RESPONSABLE_PRODUCTION", "CHEF_ADM_A01"],
      },
      {
        chemin: "/atelier/ADM-A02",
        usine: "ADMEDCO",
        libelle: "ADMEDCO A02 - Coupe sans centrage",
        permission: PERMISSIONS.TABLEAU_BORD_PRODUCTION,
        rolesVisibles: ["ADMIN_SYSTEME", "RESPONSABLE_USINE", "RESPONSABLE_ADMEDCO", "RESPONSABLE_PRODUCTION", "CHEF_ADM_A02"],
      },
      {
        chemin: "/atelier/ADM-A03",
        usine: "ADMEDCO",
        libelle: "ADMEDCO A03 - Poudrage et emballage",
        permission: PERMISSIONS.TABLEAU_BORD_PRODUCTION,
        rolesVisibles: ["ADMIN_SYSTEME", "RESPONSABLE_USINE", "RESPONSABLE_ADMEDCO", "RESPONSABLE_PRODUCTION", "CHEF_ADM_A03"],
      },
      {
        chemin: "/atelier/MBX-A01",
        usine: "MOBILIX",
        libelle: "MOBILIX A01 - Decoupe bois",
        permission: PERMISSIONS.TABLEAU_BORD_PRODUCTION,
        rolesVisibles: ["ADMIN_SYSTEME", "RESPONSABLE_USINE", "RESPONSABLE_MOBILIX", "RESPONSABLE_PRODUCTION", "CHEF_MBX_A01"],
      },
      {
        chemin: "/atelier/MBX-A02",
        usine: "MOBILIX",
        libelle: "MOBILIX A02 - Tapissage",
        permission: PERMISSIONS.TABLEAU_BORD_PRODUCTION,
        rolesVisibles: ["ADMIN_SYSTEME", "RESPONSABLE_USINE", "RESPONSABLE_MOBILIX", "RESPONSABLE_PRODUCTION", "CHEF_MBX_A02"],
      },
    ],
  },
  {
    code: "portail",
    titre: "Mon espace",
    entrees: [
      {
        chemin: "/portail",
        libelle: "Portail employe",
        permission: PERMISSIONS.PORTAIL_EMPLOYE,
        description: "Mes ordres, mes declarations, mon pointage",
      },
      {
        chemin: "/portail/operations",
        libelle: "Mes portails d'operation",
        permission: PERMISSIONS.PORTAIL_EMPLOYE,
        description: "Un espace dedie a chaque etape qui vous est affectee",
      },
      {
        chemin: "/portail/admedco",
        usine: "ADMEDCO",
        libelle: "Portail ADMEDCO",
        permission: PERMISSIONS.PORTAIL_EMPLOYE,
        rolesVisibles: ["ADMIN_SYSTEME", "OPERATEUR_ADMEDCO"],
      },
      {
        chemin: "/portail/mobilix",
        usine: "MOBILIX",
        libelle: "Portail MOBILIX",
        permission: PERMISSIONS.PORTAIL_EMPLOYE,
        rolesVisibles: ["ADMIN_SYSTEME", "OPERATEUR_MOBILIX"],
      },
    ],
  },
  {
    code: "referentiel",
    titre: "Referentiel",
    entrees: [
      {
        chemin: "/referentiel/articles",
        libelle: "Articles",
        permission: PERMISSIONS.ARTICLE_LIRE,
      },
      {
        chemin: "/referentiel/familles",
        libelle: "Familles d'articles",
        permission: PERMISSIONS.FAMILLE_LIRE,
      },
      {
        chemin: "/referentiel/tiers",
        libelle: "Clients et fournisseurs",
        permission: PERMISSIONS.TIERS_LIRE,
      },
      {
        chemin: "/referentiel/depots",
        libelle: "Depots et emplacements",
        permission: PERMISSIONS.DEPOT_LIRE,
      },
      {
        chemin: "/referentiel/tarifs",
        libelle: "Tarifs et prix",
        permission: PERMISSIONS.PRIX_LIRE,
      },
    ],
  },
  {
    code: "nomenclature",
    titre: "Nomenclature et gammes",
    entrees: [
      {
        chemin: "/nomenclature",
        libelle: "Nomenclatures",
        permission: PERMISSIONS.NOMENCLATURE_LIRE,
      },
      {
        chemin: "/nomenclature/ecarts",
        libelle: "Ecarts de quantite",
        permission: PERMISSIONS.NOMENCLATURE_LIRE,
        description: "Contradictions de quantite a arbitrer",
      },
      {
        chemin: "/nomenclature/gammes",
        libelle: "Gammes de fabrication",
        permission: PERMISSIONS.GAMME_LIRE,
      },
    ],
  },
  {
    code: "stock",
    titre: "Stocks et depots",
    entrees: [
      {
        chemin: "/stock",
        libelle: "Etat des stocks",
        permission: PERMISSIONS.STOCK_LIRE,
      },
      {
        chemin: "/stock/mouvements",
        libelle: "Mouvements de stock",
        permission: PERMISSIONS.STOCK_LIRE,
      },
      {
        chemin: "/stock/transferts",
        libelle: "Transferts inter-ateliers",
        permission: PERMISSIONS.STOCK_TRANSFERT,
      },
      {
        chemin: "/stock/inventaire",
        libelle: "Inventaire physique",
        permission: PERMISSIONS.STOCK_INVENTAIRE,
      },
      {
        chemin: "/stock/lots",
        libelle: "Lots et tracabilite",
        permission: PERMISSIONS.STOCK_LOT_GERER,
      },
      {
        chemin: "/magasinier/admedco",
        usine: "ADMEDCO",
        libelle: "Magasinier ADMEDCO",
        permission: PERMISSIONS.STOCK_LIRE,
        description: "Stocks et BCI de la division ADMEDCO",
      },
      {
        chemin: "/magasinier/mobilix",
        usine: "MOBILIX",
        libelle: "Magasinier MOBILIX",
        permission: PERMISSIONS.STOCK_LIRE,
        description: "Stocks et BCI de la division MOBILIX",
      },
      {
        chemin: "/magasinier",
        libelle: "Magasinier central",
        permission: PERMISSIONS.STOCK_LIRE,
        description: "Cumul des deux usines",
      },
    ],
  },
  {
    code: "production",
    titre: "Production",
    entrees: [
      {
        chemin: "/production",
        libelle: "Ordres de fabrication",
        permission: PERMISSIONS.PRODUCTION_LIRE,
      },
      {
        chemin: "/production/kanban",
        libelle: "Kanban atelier",
        permission: PERMISSIONS.PRODUCTION_LIRE,
      },
      {
        chemin: "/production/programme",
        libelle: "Programme de travail",
        permission: PERMISSIONS.PRODUCTION_PLANNING_LIRE,
        description: "Planning du jour et de la semaine, poste par poste",
      },
      {
        chemin: "/production/feuille-de-route",
        libelle: "Feuille de route",
        permission: PERMISSIONS.PRODUCTION_LIRE,
        description: "Ou en sont reellement les quantites, etape par etape",
      },
      {
        chemin: "/production/declarations",
        libelle: "Declarations a valider",
        permission: PERMISSIONS.PRODUCTION_VALIDER_DECLARATION,
      },
      {
        chemin: "/production/sous-stocks",
        libelle: "Sous-stocks d'etape",
        permission: PERMISSIONS.PRODUCTION_SOUS_STOCK_LIRE,
      },
      {
        chemin: "/production/postes",
        libelle: "QR des postes",
        permission: PERMISSIONS.POSTE_QR_GERER,
      },
    ],
  },
  {
    code: "qualite",
    titre: "Qualite",
    entrees: [
      {
        chemin: "/qualite",
        libelle: "Controles qualite",
        permission: PERMISSIONS.QUALITE_LIRE,
      },
      {
        chemin: "/qualite/non-conformites",
        libelle: "Non-conformites",
        permission: PERMISSIONS.QUALITE_LIRE,
      },
      {
        chemin: "/qualite/a-liberer",
        libelle: "Articles a liberer",
        permission: PERMISSIONS.QUALITE_LIBERER,
      },
    ],
  },
  {
    code: "achats",
    titre: "Achats et fournisseurs",
    entrees: [
      {
        chemin: "/achats/demandes",
        libelle: "Demandes d'achat",
        permission: PERMISSIONS.ACHAT_LIRE,
      },
      {
        chemin: "/achats/commandes",
        libelle: "Bons de commande fournisseur",
        permission: PERMISSIONS.ACHAT_LIRE,
      },
      {
        chemin: "/achats/receptions",
        libelle: "Receptions fournisseur",
        permission: PERMISSIONS.ACHAT_LIRE,
      },
      {
        chemin: "/achats/factures",
        libelle: "Factures fournisseur",
        permission: PERMISSIONS.ACHAT_LIRE,
      },
    ],
  },
  {
    code: "ventes",
    titre: "Ventes et clients",
    entrees: [
      {
        chemin: "/ventes/devis",
        libelle: "Devis",
        permission: PERMISSIONS.VENTE_LIRE,
      },
      {
        chemin: "/ventes/commandes",
        libelle: "Commandes client",
        permission: PERMISSIONS.VENTE_LIRE,
      },
      {
        chemin: "/ventes/livraisons",
        libelle: "Bons de livraison",
        permission: PERMISSIONS.VENTE_LIRE,
      },
      {
        chemin: "/ventes/factures",
        libelle: "Factures client",
        permission: PERMISSIONS.VENTE_LIRE,
      },
    ],
  },
  {
    code: "finance",
    titre: "Finance et comptabilite",
    entrees: [
      {
        chemin: "/comptabilite/ecritures",
        libelle: "Ecritures comptables",
        permission: PERMISSIONS.COMPTABILITE_LIRE,
      },
      {
        chemin: "/comptabilite/balance",
        libelle: "Balance et grand livre",
        permission: PERMISSIONS.COMPTABILITE_LIRE,
      },
      {
        chemin: "/comptabilite/reglements",
        libelle: "Reglements",
        permission: PERMISSIONS.FINANCE_LIRE,
      },
      {
        chemin: "/comptabilite/regles",
        libelle: "Regles d'ecriture",
        permission: PERMISSIONS.COMPTABILITE_REGLES_GERER,
      },
      {
        chemin: "/comptabilite/plan",
        libelle: "Plan comptable et journaux",
        permission: PERMISSIONS.PLAN_COMPTABLE_GERER,
      },
    ],
  },
  {
    code: "rh",
    titre: "Ressources humaines",
    entrees: [
      {
        chemin: "/rh/employes",
        libelle: "Employes",
        permission: PERMISSIONS.RH_LIRE,
      },
      {
        chemin: "/rh/affectations",
        libelle: "Affectations quotidiennes",
        permission: PERMISSIONS.RH_AFFECTATION_LIRE,
      },
      {
        chemin: "/rh/presences",
        libelle: "Presences et temps de travail",
        permission: PERMISSIONS.RH_PRESENCE_LIRE,
      },
      {
        chemin: "/rh/evaluations",
        libelle: "Evaluations",
        permission: PERMISSIONS.RH_EVALUATION_LIRE,
      },
      {
        chemin: "/rh/competences",
        libelle: "Competences et polyvalence",
        permission: PERMISSIONS.RH_COMPETENCE_GERER,
      },
    ],
  },
  {
    code: "administration",
    titre: "Administration",
    entrees: [
      {
        chemin: "/administration/utilisateurs",
        libelle: "Utilisateurs",
        permission: PERMISSIONS.UTILISATEUR_LIRE,
      },
      {
        chemin: "/administration/roles",
        libelle: "Roles et permissions",
        permission: PERMISSIONS.ROLE_LIRE,
      },
      {
        chemin: "/administration/parametres",
        libelle: "Parametres",
        permission: PERMISSIONS.CONFIG_LIRE,
      },
      {
        chemin: "/administration/qr-codes",
        libelle: "QR Codes des postes",
        permission: PERMISSIONS.SYSTEME_ADMIN,
      },
      {
        chemin: "/administration/scans",
        libelle: "Historique des scans QR",
        permission: PERMISSIONS.SYSTEME_ADMIN,
      },
      {
        chemin: "/administration/import",
        libelle: "Import de donnees",
        permission: PERMISSIONS.IMPORT_LIRE,
      },
      {
        chemin: "/administration/audit",
        libelle: "Journal d'audit",
        permission: PERMISSIONS.AUDIT_LIRE,
      },
    ],
  },
];

/**
 * Profil de menu par role : quelles sections apparaissent.
 *
 * C'est un choix d'ergonomie, pas de securite. Un role absent de cette table
 * retombe sur le filtrage par permission, afin qu'aucune section ne disparaisse
 * par oubli.
 *
 * Seul ADMIN_SYSTEME voit les 13 sections.
 */
const TOUT = ["pilotage", "ateliers", "portail", "referentiel", "nomenclature", "stock", "production", "qualite", "achats", "ventes", "finance", "rh", "administration"];

export const PROFIL_MENU: Record<string, string[]> = {
  ADMIN_SYSTEME: TOUT,
  PROPRIETAIRE_ADMEDCO: ["pilotage", "referentiel", "stock", "production"],
  PROPRIETAIRE_MOBILIX: ["pilotage", "referentiel", "stock", "production"],

  DIRECTION: [
    "pilotage", "referentiel", "nomenclature", "stock", "production",
    "qualite", "achats", "ventes", "finance", "rh", "administration",
  ],

  RESPONSABLE_USINE: [
    "pilotage", "ateliers", "referentiel", "nomenclature", "stock",
    "production", "qualite", "achats", "rh",
  ],
  RESPONSABLE_ADMEDCO: [
    "pilotage", "ateliers", "referentiel", "nomenclature", "stock",
    "production", "qualite", "achats", "rh",
  ],
  RESPONSABLE_MOBILIX: [
    "pilotage", "ateliers", "referentiel", "nomenclature", "stock",
    "production", "qualite", "achats", "rh",
  ],
  RESPONSABLE_PRODUCTION: [
    "ateliers", "referentiel", "nomenclature", "stock", "production",
    "qualite", "rh",
  ],

  CHEF_ADM_A01: ["ateliers", "production", "qualite", "stock", "rh"],
  CHEF_ADM_A02: ["ateliers", "production", "qualite", "stock", "rh"],
  CHEF_ADM_A03: ["ateliers", "production", "qualite", "stock", "rh"],
  CHEF_MBX_A01: ["ateliers", "production", "qualite", "stock", "rh"],
  CHEF_MBX_A02: ["ateliers", "production", "qualite", "stock", "rh"],

  OPERATEUR_ADMEDCO: ["portail"],
  OPERATEUR_MOBILIX: ["portail"],

  RESPONSABLE_STOCK: [
    "pilotage", "referentiel", "nomenclature", "stock", "production", "qualite",
  ],
  MAGASINIER: ["referentiel", "nomenclature", "stock", "production", "qualite"],
  MAGASINIER_ADMEDCO: ["referentiel", "nomenclature", "stock", "production"],
  MAGASINIER_MOBILIX: ["referentiel", "nomenclature", "stock", "production"],

  RESPONSABLE_QUALITE: [
    "pilotage", "referentiel", "nomenclature", "stock", "production", "qualite",
  ],
  ACHETEUR: ["pilotage", "referentiel", "nomenclature", "stock", "achats"],
  COMMERCIAL: ["pilotage", "referentiel", "nomenclature", "stock", "ventes"],
  COMPTABLE: [
    "pilotage", "referentiel", "nomenclature", "stock", "achats", "ventes", "finance",
  ],
  RESPONSABLE_FINANCIER: [
    "pilotage", "referentiel", "nomenclature", "stock", "achats", "ventes",
    "finance", "administration",
  ],
  RESPONSABLE_RH: ["pilotage", "rh"],

  AUDITEUR: [
    "pilotage", "referentiel", "nomenclature", "stock", "production",
    "qualite", "achats", "ventes", "finance", "rh", "administration",
  ],
  LECTURE_SEULE: ["referentiel", "nomenclature", "stock", "production"],
};

/** Une entree est visible si la permission ET, le cas echeant, le role concordent. */
export function entreeAutorisee(
  utilisateur: SessionUser,
  entree: EntreeNavigation,
): boolean {
  if (entree.usine && !peutAccederUsine(utilisateur, entree.usine)) return false;
  if (estProprietaireUsine(utilisateur) && !utilisateur.scope.allFactories &&
      ["/tableau-de-bord", "/magasinier"].includes(entree.chemin)) return false;

  if (entree.rolesVisibles && entree.rolesVisibles.length > 0) {
    const codes = utilisateur.roles.map((role) => role.code);
    if (!codes.some((code) => entree.rolesVisibles!.includes(code))) return false;
  }

  if (entree.permission) return utilisateur.permissions.includes(entree.permission);
  if (entree.permissionsAlternatives && entree.permissionsAlternatives.length > 0) {
    return entree.permissionsAlternatives.some((permission) =>
      utilisateur.permissions.includes(permission),
    );
  }
  // Aucune permission declaree : l'entree n'est jamais affichee par defaut.
  return false;
}

/**
 * Sections de menu visibles par l'utilisateur.
 *
 * Un role dont le profil est declare restreint l'affichage aux sections de ce
 * profil. Un role inconnu conserve le filtrage par permission seul.
 */
export function navigationAutorisee(utilisateur: SessionUser): SectionNavigation[] {
  const codes = utilisateur.roles.map((role) => role.code);

  const profilsConnus = codes
    .map((code) => PROFIL_MENU[code])
    .filter((profil): profil is string[] => Array.isArray(profil));

  const sectionsAutorisees =
    profilsConnus.length === 0 ? null : new Set(profilsConnus.flat());

  return NAVIGATION.map((section) => ({
    ...section,
    entrees: section.entrees.filter((entree) => entreeAutorisee(utilisateur, entree)),
  })).filter((section) => {
    if (section.entrees.length === 0) return false;
    if (sectionsAutorisees && !sectionsAutorisees.has(section.code)) return false;
    return true;
  });
}

/**
 * Page d'accueil par metier : chaque role arrive sur son propre ecran.
 * Un role absent de cette table retombe sur sa premiere page accessible.
 */
const ACCUEIL_PAR_ROLE: Record<string, string> = {
  ADMIN_SYSTEME: "/tableau-de-bord",
  PROPRIETAIRE_ADMEDCO: "/direction/admedco",
  PROPRIETAIRE_MOBILIX: "/direction/mobilix",
  DIRECTION: "/tableau-de-bord",
  RESPONSABLE_USINE: "/tableau-de-bord/production",
  RESPONSABLE_ADMEDCO: "/direction/admedco",
  RESPONSABLE_MOBILIX: "/direction/mobilix",
  RESPONSABLE_PRODUCTION: "/production",
  OPERATEUR_ADMEDCO: "/portail/admedco",
  OPERATEUR_MOBILIX: "/portail/mobilix",
  RESPONSABLE_STOCK: "/magasinier",
  MAGASINIER: "/magasinier",
  MAGASINIER_ADMEDCO: "/magasinier/admedco",
  MAGASINIER_MOBILIX: "/magasinier/mobilix",
  CHEF_ADM_A01: "/atelier/ADM-A01",
  CHEF_ADM_A02: "/atelier/ADM-A02",
  CHEF_ADM_A03: "/atelier/ADM-A03",
  CHEF_MBX_A01: "/atelier/MBX-A01",
  CHEF_MBX_A02: "/atelier/MBX-A02",
  RESPONSABLE_QUALITE: "/qualite",
  ACHETEUR: "/achats/demandes",
  COMMERCIAL: "/ventes/devis",
  COMPTABLE: "/comptabilite/ecritures",
  RESPONSABLE_FINANCIER: "/comptabilite/ecritures",
  RESPONSABLE_RH: "/rh/employes",
  AUDITEUR: "/tableau-de-bord",
  LECTURE_SEULE: "/referentiel/articles",
};

/**
 * Premiere page accessible : utilisee pour rediriger apres connexion.
 * L'accueil du metier n'est retenu que si l'interesse peut reellement l'ouvrir.
 */
export function premierCheminAccessible(utilisateur: SessionUser): string | null {
  const sections = navigationAutorisee(utilisateur);

  for (const role of utilisateur.roles) {
    const chemin = ACCUEIL_PAR_ROLE[role.code];
    if (!chemin) continue;
    const accessible = sections.some((section) =>
      section.entrees.some((entree) => entree.chemin === chemin),
    );
    if (accessible) return chemin;
  }

  return sections[0]?.entrees[0]?.chemin ?? null;
}
