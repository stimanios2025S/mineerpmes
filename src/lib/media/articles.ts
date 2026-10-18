import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Stockage des pieces jointes produit.
 *
 * Les fichiers vivent hors du depot, dans `storage/articles/<article>/`. Ils ne
 * sont jamais exposes par `/public` : une photo de produit et un dessin
 * technique sont des documents internes, servis par une route qui verifie la
 * session et la permission de lecture.
 *
 * Le nom enregistre en base est relatif (`12/photo-....jpg`) ; le nom d'origine
 * est conserve a part pour l'affichage.
 */

export const TAILLE_MAX = 10 * 1024 * 1024;

export const TYPES_MEDIA = ["photo", "dessin"] as const;
export type TypeMedia = (typeof TYPES_MEDIA)[number];

/** Formats acceptes par emplacement. */
export const FORMATS: Record<TypeMedia, string[]> = {
  photo: ["image/jpeg", "image/png", "image/webp"],
  dessin: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
};

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

const RACINE = resolve(process.env.MEDIA_DIR ?? join(process.cwd(), "storage"));
const RACINE_ARTICLES = resolve(RACINE, "articles");

/** Chemin absolu d'un fichier, ou null s'il sort du dossier autorise. */
export function cheminAbsolu(relatif: string): string | null {
  const absolu = resolve(RACINE_ARTICLES, relatif);
  if (absolu !== RACINE_ARTICLES && !absolu.startsWith(RACINE_ARTICLES + sep)) return null;
  return absolu;
}

export async function enregistrerMedia(
  itemId: number,
  type: TypeMedia,
  nomOriginal: string,
  mime: string,
  donnees: Buffer,
): Promise<{ fichier: string; nom: string }> {
  const dossier = join(RACINE_ARTICLES, String(itemId));
  await mkdir(dossier, { recursive: true });

  const extension = EXTENSIONS[mime] ?? ".bin";
  const nomFichier = `${type}-${Date.now()}-${randomBytes(4).toString("hex")}${extension}`;
  await writeFile(join(dossier, nomFichier), donnees);

  return { fichier: `${itemId}/${nomFichier}`, nom: nomOriginal };
}

export async function supprimerMedia(relatif: string | null | undefined): Promise<void> {
  if (!relatif) return;
  const absolu = cheminAbsolu(relatif);
  if (!absolu) return;
  await unlink(absolu).catch(() => {});
}

export async function lireMedia(
  relatif: string | null | undefined,
): Promise<Buffer | null> {
  if (!relatif) return null;
  const absolu = cheminAbsolu(relatif);
  if (!absolu) return null;
  return readFile(absolu).catch(() => null);
}

/** Type MIME deduit de l'extension, pour servir un fichier deja enregistre. */
export function mimeDe(relatif: string): string {
  if (relatif.endsWith(".png")) return "image/png";
  if (relatif.endsWith(".webp")) return "image/webp";
  if (relatif.endsWith(".pdf")) return "application/pdf";
  return "image/jpeg";
}
