import { peutAccederUsine, usinesAutorisees } from "./portee";
export { peutAccederUsine, usinesAutorisees } from "./portee";
import type { Factory } from "@prisma/client";
import { forbidden, unauthorized } from "next/navigation";
import {
  chargerUtilisateurCourant,
  type SessionUser,
} from "@/lib/auth/session";
import { SCOPE_PERMISSIONS } from "./permissions";

/**
 * Controle d'acces cote serveur.
 * Aucune route, aucune action serveur et aucune API ne doit lire ou ecrire des
 * donnees sans passer par ces fonctions : masquer un menu ne protege rien.
 */

export async function utilisateurCourant(): Promise<SessionUser | null> {
  return chargerUtilisateurCourant();
}

/**
 * Refuse l'acces courant.
 *
 * Le motif part dans le journal serveur, car Next.js masque les messages
 * d'erreur en production. `forbidden()` interrompt ensuite le rendu et
 * Next.js affiche src/app/forbidden.tsx avec un vrai code HTTP 403.
 *
 * Ne jamais entourer cet appel d'un `try/catch` : l'interruption serait avalee
 * et aucune page 403 ne s'afficherait.
 */
function refuser(motif: string): never {
  console.warn(`[rbac] acces refuse : ${motif}`);
  forbidden();
}

export async function exigerUtilisateur(): Promise<SessionUser> {
  const utilisateur = await chargerUtilisateurCourant();
  if (!utilisateur) unauthorized();
  return utilisateur;
}

export function aLaPermission(utilisateur: SessionUser, permission: string): boolean {
  return utilisateur.permissions.includes(permission);
}

export function aToutesLesPermissions(
  utilisateur: SessionUser,
  permissions: string[],
): boolean {
  return permissions.every((permission) => utilisateur.permissions.includes(permission));
}

export function aAuMoinsUnePermission(
  utilisateur: SessionUser,
  permissions: string[],
): boolean {
  return permissions.some((permission) => utilisateur.permissions.includes(permission));
}

export async function exigerPermission(permission: string): Promise<SessionUser> {
  const utilisateur = await exigerUtilisateur();
  if (!aLaPermission(utilisateur, permission)) {
    refuser(`la permission « ${libellePermission(permission)} » est requise.`);
  }
  return utilisateur;
}

export async function exigerToutesLesPermissions(
  permissions: string[],
): Promise<SessionUser> {
  const utilisateur = await exigerUtilisateur();
  const manquantes = permissions.filter((p) => !utilisateur.permissions.includes(p));
  if (manquantes.length > 0) {
    refuser(
      `permissions requises manquantes (${manquantes
        .map(libellePermission)
        .join(", ")}).`,
    );
  }
  return utilisateur;
}

export async function exigerAuMoinsUnePermission(
  permissions: string[],
): Promise<SessionUser> {
  const utilisateur = await exigerUtilisateur();
  if (!aAuMoinsUnePermission(utilisateur, permissions)) {
    refuser(
      `l'une des permissions suivantes est requise (${permissions
        .map(libellePermission)
        .join(", ")}).`,
    );
  }
  return utilisateur;
}

/**
 * Verifie que l'utilisateur a le droit d'agir sur la division demandee.
 * Un operateur ADMEDCO ne peut pas agir sur MOBILIX, et inversement.
 */

export async function exigerAccesUsine(usine: Factory): Promise<SessionUser> {
  const utilisateur = await exigerUtilisateur();
  if (!peutAccederUsine(utilisateur, usine)) {
    refuser(
      `votre profil ne vous autorise pas a intervenir sur la division ${libelleUsine(usine)}.`,
    );
  }
  return utilisateur;
}

export async function exigerPermissionEtUsine(
  permission: string,
  usine: Factory,
): Promise<SessionUser> {
  const utilisateur = await exigerPermission(permission);
  if (!peutAccederUsine(utilisateur, usine)) {
    refuser(
      `votre profil ne vous autorise pas a intervenir sur la division ${libelleUsine(usine)}.`,
    );
  }
  return utilisateur;
}

/** Filtre les usines visibles pour construire des requetes bornees. */

/** Restriction de portee a appliquer dans les clauses `where` Prisma. */
export function filtreUsine(
  utilisateur: SessionUser,
): { factory: { in: Factory[] } } | Record<string, never> {
  if (utilisateur.scope.allFactories) return {};
  return { factory: { in: usinesAutorisees(utilisateur) } };
}

export function libelleUsine(usine: Factory | string): string {
  switch (usine) {
    case "ADMEDCO":
      return "ADMEDCO (fabrication metallique)";
    case "MOBILIX":
      return "MOBILIX (bois, couture et garnissage)";
    default:
      return "transversale";
  }
}

const LIBELLES_PERMISSIONS: Record<string, string> = {
  SYSTEME_ADMIN: "administration du systeme",
  UTILISATEUR_GERER: "gestion des utilisateurs",
  ROLE_GERER: "gestion des roles",
  CONFIG_GERER: "gestion de la configuration",
  IMPORT_EXECUTER: "execution d'un import",
  AUDIT_LIRE: "consultation du journal d'audit",
  ARTICLE_ECRIRE: "modification des articles",
  STOCK_LIRE: "consultation des stocks",
  STOCK_MOUVEMENT_CREER: "saisie d'un mouvement de stock",
  STOCK_TRANSFERT: "transfert entre depots",
  STOCK_CORRECTION: "correction de stock",
  STOCK_ANNULER_MOUVEMENT: "annulation d'un mouvement de stock",
  STOCK_NEGATIF_AUTORISER: "autorisation de stock negatif",
  PRODUCTION_LIRE: "consultation de la production",
  PRODUCTION_ORDRE_CREER: "creation d'un ordre de fabrication",
  PRODUCTION_LANCER: "lancement d'un ordre de fabrication",
  PRODUCTION_DECLARER: "declaration d'atelier",
  PRODUCTION_KANBAN_DEPLACER: "deplacement Kanban",
  PRODUCTION_VALIDER_DECLARATION: "validation des declarations",
  PRODUCTION_CLOTURER: "cloture d'un ordre de fabrication",
  QUALITE_CONTROLER: "saisie d'un controle qualite",
  QUALITE_DECIDER: "decision qualite",
  QUALITE_LIBERER: "liberation qualite",
  ACHAT_COMMANDE_CREER: "creation d'un bon de commande",
  ACHAT_COMMANDE_APPROUVER: "approbation d'un bon de commande",
  ACHAT_RECEPTIONNER: "reception fournisseur",
  VENTE_DEVIS_CREER: "creation d'un devis",
  VENTE_COMMANDE_CREER: "creation d'une commande client",
  VENTE_COMMANDE_CONFIRMER: "confirmation d'une commande client",
  VENTE_LIVRER: "creation d'un bon de livraison",
  VENTE_FACTURER: "facturation client",
  REGLEMENT_SAISIR: "saisie d'un reglement",
  REGLEMENT_VALIDER: "validation d'un reglement",
  COMPTABILITE_POSTER: "postage d'une ecriture",
  COMPTABILITE_CONTREPASSER: "contrepassation",
  RH_LIRE: "consultation des employes",
  RH_ECRIRE: "modification des employes",
  RH_SALAIRE_LIRE: "consultation des salaires",
  RH_AFFECTATION_GERER: "gestion des affectations",
  RH_EVALUATION_CALCULER: "calcul des evaluations",
  RH_EVALUATION_VALIDER: "validation des evaluations",
  PORTAIL_EMPLOYE: "acces au portail employe",
  RAPPORT_EXPORTER: "export de donnees",
  TABLEAU_BORD_LIRE: "consultation des tableaux de bord",
  TABLEAU_BORD_FINANCE: "consultation du tableau de bord financier",
  TABLEAU_BORD_RH: "consultation du tableau de bord RH",
  TABLEAU_BORD_PRODUCTION: "consultation du tableau de bord production",
  STOCK_VALORISATION_LIRE: "consultation de la valorisation",
  STOCK_LOT_GERER: "gestion des lots",
  PLAN_COMPTABLE_GERER: "gestion du plan comptable",
  COMPTABILITE_REGLES_GERER: "gestion des regles d'ecriture",
};

export function libellePermission(code: string): string {
  return LIBELLES_PERMISSIONS[code] ?? code;
}

export { SCOPE_PERMISSIONS };
