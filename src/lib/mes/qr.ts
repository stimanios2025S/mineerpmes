import QRCode from "qrcode";

/**
 * Rendu des QR de poste.
 *
 * Le QR contient une URL absolue vers la page de scan du portail, avec le jeton
 * du poste. Il ne contient ni secret de connexion, ni donnee personnelle, ni
 * tache figee : tout ce qui s'affiche apres le scan est recalcule cote serveur
 * depuis les affectations reelles du jour.
 *
 * L'URL doit etre absolue : un telephone qui scanne une etiquette imprimee n'a
 * aucun contexte pour resoudre un chemin relatif.
 */

/** Chemin de scan d'un poste. */
export function cheminScanPoste(token: string): string {
  return `/portail/poste/${encodeURIComponent(token)}`;
}

/**
 * URL absolue inscrite dans le QR.
 * `baseUrl` vient de l'en-tete `host` au moment de l'impression : c'est
 * l'adresse a laquelle la plateforme est reellement joignable depuis l'atelier.
 */
export function urlScanPoste(baseUrl: string, token: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${cheminScanPoste(token)}`;
}

export interface OptionsQr {
  /** Largeur en pixels du carre. 512 convient a une etiquette A6 imprimee. */
  largeur?: number;
  marge?: number;
  /** Niveau de correction d'erreur. M resiste aux taches et aux plis d'atelier. */
  correction?: "L" | "M" | "Q" | "H";
}

/**
 * QR en SVG : net a l'impression et a toute taille, sans dependance a une
 * bibliotheque d'image cote navigateur.
 */
export async function qrSvg(
  contenu: string,
  options: OptionsQr = {},
): Promise<string> {
  if (!contenu.trim()) {
    throw new Error("Impossible de generer un QR vide.");
  }

  return QRCode.toString(contenu, {
    type: "svg",
    errorCorrectionLevel: options.correction ?? "M",
    margin: options.marge ?? 2,
    width: options.largeur ?? 512,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/** QR en data-URL PNG, pour les cas ou un `<img>` est plus simple qu'un SVG. */
export async function qrDataUrl(
  contenu: string,
  options: OptionsQr = {},
): Promise<string> {
  if (!contenu.trim()) {
    throw new Error("Impossible de generer un QR vide.");
  }

  return QRCode.toDataURL(contenu, {
    errorCorrectionLevel: options.correction ?? "M",
    margin: options.marge ?? 2,
    width: options.largeur ?? 512,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
