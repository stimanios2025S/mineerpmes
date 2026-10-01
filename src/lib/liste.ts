/**
 * Aides de listes : filtres, tri, pagination et construction de liens.
 *
 * Toutes les pages de consultation partagent ces fonctions afin que les
 * comportements (taille de page, bornes, encodage des liens) restent identiques
 * dans toute la plateforme.
 */

export type ParametresBruts = Record<string, string | string[] | undefined>;

export interface ParametresListe {
  recherche: string | null;
  page: number;
  taille: number;
  skip: number;
  /** Filtres additionnels declares par la page (statut, division, periode...). */
  filtres: Record<string, string | null>;
}

export const TAILLE_PAGE_DEFAUT = 25;
const TAILLE_PAGE_MIN = 5;
const TAILLE_PAGE_MAX = 200;

/** Premiere valeur d'un parametre de requete (les tableaux sont ignores). */
export function premiereValeur(
  parametres: ParametresBruts,
  cle: string,
): string | null {
  const valeur = parametres[cle];
  if (valeur === undefined) return null;
  const brut = Array.isArray(valeur) ? valeur[0] : valeur;
  if (typeof brut !== "string") return null;
  const nettoye = brut.trim();
  return nettoye === "" ? null : nettoye;
}

export function lireParametresListe(
  parametres: ParametresBruts,
  clesFiltres: string[] = [],
  options: { tailleDefaut?: number } = {},
): ParametresListe {
  const pageBrute = Number.parseInt(premiereValeur(parametres, "page") ?? "1", 10);
  const page = Number.isFinite(pageBrute) && pageBrute > 0 ? pageBrute : 1;

  const tailleBrute = Number.parseInt(
    premiereValeur(parametres, "taille") ?? String(options.tailleDefaut ?? TAILLE_PAGE_DEFAUT),
    10,
  );
  const taille = Number.isFinite(tailleBrute)
    ? Math.min(TAILLE_PAGE_MAX, Math.max(TAILLE_PAGE_MIN, tailleBrute))
    : (options.tailleDefaut ?? TAILLE_PAGE_DEFAUT);

  const filtres: Record<string, string | null> = {};
  for (const cle of clesFiltres) {
    filtres[cle] = premiereValeur(parametres, cle);
  }

  return {
    recherche: premiereValeur(parametres, "q"),
    page,
    taille,
    skip: (page - 1) * taille,
    filtres,
  };
}

export interface ResultatPagination {
  pages: number;
  skip: number;
  take: number;
}

/** Bornes de pagination coherentes avec le nombre total de lignes. */
export function pagination(
  total: number,
  page: number,
  taille: number,
): ResultatPagination {
  const pages = Math.max(1, Math.ceil(total / taille));
  const pageBornee = Math.min(Math.max(1, page), pages);
  return {
    pages,
    skip: (pageBornee - 1) * taille,
    take: taille,
  };
}

/**
 * Construit un lien en conservant les filtres courants.
 * Les valeurs nulles, vides ou indefinies sont retirees de l'URL.
 */
export function construireLien(
  chemin: string,
  parametres: Record<string, string | number | null | undefined>,
): string {
  const recherche = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(parametres)) {
    if (valeur === null || valeur === undefined) continue;
    const texte = String(valeur).trim();
    if (texte === "") continue;
    recherche.set(cle, texte);
  }
  const requete = recherche.toString();
  return requete === "" ? chemin : `${chemin}?${requete}`;
}

/** Fabrique une fonction de lien de pagination pour un chemin et des filtres. */
export function fabricantLien(
  chemin: string,
  parametresCourants: Record<string, string | number | null | undefined>,
): (page: number) => string {
  return (page: number) => construireLien(chemin, { ...parametresCourants, page });
}

/** Uniformise une recherche pour un champ insensible a la casse. */
export function modeInsensible(valeur: string): { contains: string; mode: "insensitive" } {
  return { contains: valeur.trim(), mode: "insensitive" };
}

/** Convertit un identifiant de route en entier, ou null. */
export function identifiantOuNull(valeur: string | null | undefined): number | null {
  if (!valeur) return null;
  const nombre = Number.parseInt(valeur, 10);
  return Number.isFinite(nombre) && nombre > 0 ? nombre : null;
}
