/**
 * Codes d'evenement comptable — source unique.
 *
 * Une regle d'ecriture (`AccountingRule.eventCode`) et le code metier qui la
 * declenche doivent citer LA MEME constante. Une chaine ecrite deux fois finit
 * par diverger, et une regle qui ne se declenche jamais est affichee sur l'ecran
 * Regles alors qu'elle ne produit rien : c'est un mensonge fonctionnel.
 *
 * -------------------------------------------------------------------------
 * PIEGE A CONNAITRE — deux namespaces differents portent les memes libelles
 * -------------------------------------------------------------------------
 * `RECEPTION_FOURNISSEUR`, `PRODUCTION_PRODUIT_FINI` et `CONSOMMATION_PRODUCTION`
 * existent AUSSI comme type de mouvement de stock (voir LIBELLES_TYPE_MOUVEMENT
 * dans src/lib/libelles.ts). Ce sont deux faits distincts :
 *
 *   - un mouvement de stock dit « de la marchandise est entree ou sortie » ;
 *   - un evenement comptable dit « il faut passer une ecriture ».
 *
 * Une reception peut tres bien creer un mouvement de stock sans generer
 * d'ecriture, et c'est exactement l'etat actuel du depot : les trois evenements
 * marques `aBrancher` ci-dessous ne sont jamais declenches. Ne JAMAIS passer un
 * type de mouvement a `genererEcriture` : ce module est le seul passage autorise.
 */

export const EVENEMENTS_COMPTABLES = {
  // --- Ventes ---------------------------------------------------------------
  FACTURE_CLIENT: "FACTURE_CLIENT",
  SORTIE_STOCK_LIVRAISON: "SORTIE_STOCK_LIVRAISON",
  REGLEMENT_CLIENT: "REGLEMENT_CLIENT",

  // --- Achats ---------------------------------------------------------------
  FACTURE_FOURNISSEUR: "FACTURE_FOURNISSEUR",
  RECEPTION_FOURNISSEUR: "RECEPTION_FOURNISSEUR",
  REGLEMENT_FOURNISSEUR: "REGLEMENT_FOURNISSEUR",

  // --- Production -----------------------------------------------------------
  PRODUCTION_PRODUIT_FINI: "PRODUCTION_PRODUIT_FINI",
  CONSOMMATION_PRODUCTION: "CONSOMMATION_PRODUCTION",
} as const;

export type EvenementComptable =
  (typeof EVENEMENTS_COMPTABLES)[keyof typeof EVENEMENTS_COMPTABLES];

/** Tous les codes, dans l'ordre de declenchement d'un cycle d'exploitation. */
export const TOUS_LES_EVENEMENTS: EvenementComptable[] = Object.values(
  EVENEMENTS_COMPTABLES,
);

export interface DefinitionEvenement {
  code: EvenementComptable;
  libelle: string;
  /** Fichier et fonction qui declenche l'ecriture. */
  declencheur: string;
  /**
   * `true` quand aucun code du depot ne declenche encore cet evenement : la
   * regle est semee mais ne produit rien. Afficher la liste de ces evenements
   * doit rester possible et visible, jamais silencieux.
   */
  aBrancher?: boolean;
  /** Sens de l'ecriture attendue, pour relecture par le comptable. */
  sens: string;
}

export const EVENEMENT_DEFINITIONS: DefinitionEvenement[] = [
  {
    code: EVENEMENTS_COMPTABLES.FACTURE_CLIENT,
    libelle: "Facture client validee",
    declencheur: "src/lib/vente/service.ts — validation de facture",
    sens: "Debit 411 client / Credit 7xx produit + 4457 TVA collectee",
  },
  {
    code: EVENEMENTS_COMPTABLES.SORTIE_STOCK_LIVRAISON,
    libelle: "Sortie de stock sur bon de livraison",
    declencheur: "src/lib/vente/service.ts — validation de livraison",
    sens: "Debit 6xx cout des ventes / Credit 3xx stock",
  },
  {
    code: EVENEMENTS_COMPTABLES.REGLEMENT_CLIENT,
    libelle: "Encaissement d'un reglement client",
    declencheur: "src/lib/comptabilite/reglement.ts — enregistrerReglement",
    sens: "Debit 5xx tresorerie / Credit 411 client",
  },
  {
    code: EVENEMENTS_COMPTABLES.FACTURE_FOURNISSEUR,
    libelle: "Facture fournisseur validee",
    declencheur: "src/lib/achat/service.ts — validation de facture",
    sens: "Debit 6xx charge + 4456 TVA deductible / Credit 401 fournisseur",
  },
  {
    code: EVENEMENTS_COMPTABLES.RECEPTION_FOURNISSEUR,
    libelle: "Reception fournisseur entree en stock",
    declencheur: "src/lib/achat/service.ts — validation de reception",
    sens: "Debit 3xx stock / Credit 6xx ou 408 fournisseur",
    aBrancher: true,
  },
  {
    code: EVENEMENTS_COMPTABLES.REGLEMENT_FOURNISSEUR,
    libelle: "Decaissement d'un reglement fournisseur",
    declencheur: "src/lib/comptabilite/reglement.ts — enregistrerReglement",
    sens: "Debit 401 fournisseur / Credit 5xx tresorerie",
  },
  {
    code: EVENEMENTS_COMPTABLES.PRODUCTION_PRODUIT_FINI,
    libelle: "Entree en stock de produits finis",
    declencheur: "src/lib/production — entree en stock de la production",
    sens: "Debit 3xx stock produits finis / Credit 7xx production stockee",
    aBrancher: true,
  },
  {
    code: EVENEMENTS_COMPTABLES.CONSOMMATION_PRODUCTION,
    libelle: "Consommation de matieres en production",
    declencheur: "src/lib/production — consommation reelle declaree",
    sens: "Debit 6xx consommation / Credit 3xx stock matieres",
    aBrancher: true,
  },
];

/** Evenements semes mais qu'aucun code ne declenche encore. */
export function evenementsNonBranches(): EvenementComptable[] {
  return EVENEMENT_DEFINITIONS.filter((definition) => definition.aBrancher).map(
    (definition) => definition.code,
  );
}

export function definitionEvenement(
  code: string,
): DefinitionEvenement | undefined {
  return EVENEMENT_DEFINITIONS.find((definition) => definition.code === code);
}

export function estEvenementComptable(valeur: string): valeur is EvenementComptable {
  return (TOUS_LES_EVENEMENTS as string[]).includes(valeur);
}
