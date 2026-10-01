import type { SessionUser } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/rbac/permissions";

/**
 * Definition centrale de la navigation.
 *
 * Chaque entree declare la permission reellement exigee par la page qu'elle
 * pointe. Le filtrage affiche ici est un confort d'usage : la meme permission
 * est verifiee de nouveau dans la page, dans l'action serveur et dans l'API.
 * Masquer une entree ne protege donc jamais une donnee.
 */

export interface EntreeNavigation {
  chemin: string;
  libelle: string;
  /** Permission unique requise. */
  permission?: string;
  /** Permissions alternatives : l'une d'elles suffit. */
  permissionsAlternatives?: string[];
  description?: string;
  rolesVisibles?: string[];
}

export interface SectionNavigation {
  code: string;
  titre: string;
  entrees: EntreeNavigation[];
  rolesVisibles?: string[];
}

export const NAVIGATION: SectionNavigation[] = [
  {
    code: "pilotage",
    titre: "Pilotage",
    entrees: [
      {
        chemin: "/tableau-de-bord",
        libelle: "Tableau de bord",
        permission: PERMISSIONS.TABLEAU_BORD_LIRE,
        description: "Indicateurs consolides des deux divisions",
      },
      {
        chemin: "/direction/admedco",
        libelle: "Direction ADMEDCO",
        permission: PERMISSIONS.TABLEAU_BORD_LIRE,
      },
      {
        chemin: "/direction/mobilix",
        libelle: "Direction MOBILIX",
        permission: PERMISSIONS.TABLEAU_BORD_LIRE,
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
        libelle: "ADMEDCO A01 — Coupe avec centrage",
        permission: PERMISSIONS.TABLEAU_BORD_PRODUCTION,
      },
      {
        chemin: "/atelier/ADM-A02",
        libelle: "ADMEDCO A02 — Coupe sans centrage",
        permission: PERMISSIONS.TABLEAU_BORD_PRODUCTION,
      },
      {
        chemin: "/atelier/ADM-A03",
        libelle: "ADMEDCO A03 — Poudrage et emballage",
        permission: PERMISSIONS.TABLEAU_BORD_PRODUCTION,
      },
      {
        chemin: "/atelier/MBX-A01",
        libelle: "MOBILIX A01 — Decoupe bois",
        permission: PERMISSIONS.TABLEAU_BORD_PRODUCTION,
      },
      {
        chemin: "/atelier/MBX-A02",
        libelle: "MOBILIX A02 — Tapissage",
        permission: PERMISSIONS.TABLEAU_BORD_PRODUCTION,
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
        description: "Mes ordres de fabrication, mes declarations, mes pointages",
      },
      {
        chemin: "/portail/operations",
        libelle: "Mes portails d'operation",
        permission: PERMISSIONS.PORTAIL_EMPLOYE,
        description: "Un espace dedie a chaque etape qui vous est affectee",
      },
    ],
  },
  {
    code: "referentiel",
    titre: "Referentiel",
    rolesVisibles: [],
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
    rolesVisibles: [],
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
        description: "Contradictions de quantite a arbitrer, jamais corrigees automatiquement",
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
    titre: "Stocks",
    rolesVisibles: [],
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
        chemin: "/stock/bci",
        libelle: "BCI (Bons de commande internes)",
        permission: PERMISSIONS.STOCK_LIRE,
      },
      {
        chemin: "/magasinier/admedco",
        libelle: "Magasinier ADMEDCO",
        permission: PERMISSIONS.STOCK_LIRE,
      },
      {
        chemin: "/magasinier/mobilix",
        libelle: "Magasinier MOBILIX",
        permission: PERMISSIONS.STOCK_LIRE,
      },
      {
        chemin: "/magasinier",
        libelle: "Magasinier",
        permission: PERMISSIONS.STOCK_LIRE,
      },
      {
        chemin: "/stock/lots",
        libelle: "Lots et tracabilite",
        permission: PERMISSIONS.STOCK_LOT_GERER,
      },
    ],
  },
  {
    code: "production",
    titre: "Production",
    rolesVisibles: [],
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
        chemin: "/production/declarations",
        libelle: "Declarations a valider",
        permission: PERMISSIONS.PRODUCTION_VALIDER_DECLARATION,
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
    rolesVisibles: [],
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
    titre: "Achats",
    rolesVisibles: [],
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
    titre: "Ventes",
    rolesVisibles: [],
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
    rolesVisibles: [],
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
    rolesVisibles: [],
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
    rolesVisibles: [],
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
        chemin: "/administration/scans",
        libelle: "Historique des scans QR",
        permission: PERMISSIONS.ADMINISTRER_SYSTEME,
      },
      {
        chemin: "/administration/qr-codes",
        libelle: "QR Codes des postes",
        permission: PERMISSIONS.ADMINISTRER_SYSTEME,
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

/** Une entree est visible si l'utilisateur detient la permission declaree. */
export function entreeAutorisee(
  utilisateur: SessionUser,
  entree: EntreeNavigation,
): boolean {
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
 * Navigation reellement accessible a l'utilisateur, sections vides retirees.
 * L'ordre de declaration est conserve.
 */
export function navigationAutorisee(utilisateur: SessionUser): SectionNavigation[] {
  const roleCodes = utilisateur.roles.map((r: { code: string }) => r.code);
  const estOperateur = roleCodes.some(
    (r: string) => r === "OPERATEUR_ADMEDCO" || r === "OPERATEUR_MOBILIX",
  );
  return NAVIGATION.map((section) => ({
    ...section,
    entrees: section.entrees.filter((entree) => entreeAutorisee(utilisateur, entree)),
  })).filter((section) => {
    if (section.entrees.length === 0) return false;
    if (estOperateur && section.rolesVisibles && section.rolesVisibles.length === 0) return false;
    return true;
  });
}

/**
 * Page d'accueil par metier.
 *
 * Chaque role arrive sur son propre ecran, pas sur un tableau de bord commun :
 * un tableau de bord partage donne a tout le monde l'illusion de voir la meme
 * chose, et noie chaque metier sous les chiffres des autres.
 *
 * Un role absent de cette table retombe sur sa premiere page accessible.
 */
const ACCUEIL_PAR_ROLE: Record<string, string> = {
  ADMIN_SYSTEME: "/tableau-de-bord",
  DIRECTION: "/tableau-de-bord",
  RESPONSABLE_USINE: "/tableau-de-bord/production",
  RESPONSABLE_ADMEDCO: "/tableau-de-bord/production",
  RESPONSABLE_MOBILIX: "/tableau-de-bord/production",
  RESPONSABLE_PRODUCTION: "/production",
  OPERATEUR_ADMEDCO: "/portail/admedco",
  OPERATEUR_MOBILIX: "/portail/mobilix",
  RESPONSABLE_STOCK: "/stock",
  MAGASINIER: "/stock",
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
 *
 * L'accueil du metier n'est retenu que si l'interesse peut reellement ouvrir la
 * page. Si une permission lui a ete retiree, on retombe sur sa premiere page
 * accessible au lieu de l'envoyer sur un refus d'acces des la connexion.
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
