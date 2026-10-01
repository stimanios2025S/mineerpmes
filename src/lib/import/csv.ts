import { readFileSync } from "node:fs";
import { D, type Decimal } from "@/lib/decimal";

/**
 * Lecteur CSV tolerant pour les exports de l'ancien ERP (Silwane / WinDev).
 *
 * Caracteristiques des fichiers sources :
 *   - separateur point-virgule ;
 *   - champs entre guillemets pouvant contenir des points-virgules et des
 *     retours a la ligne ;
 *   - champs vides nombreux ;
 *   - decimaux au format « 1234.56000000 » ou « 1234,56 » ;
 *   - dates au format « 2026-02-07 10:07:34.062993 » ;
 *   - booleens « t » / « f ».
 */

export interface LigneCsv {
  /** Numero de ligne physique dans le fichier (1 = premiere ligne de donnees). */
  numero: number;
  valeurs: Record<string, string>;
  brut: string;
}

export interface FichierCsv {
  entetes: string[];
  lignes: LigneCsv[];
  separateur: string;
  encodage: "utf8" | "latin1";
  lignesIgnorees: number;
}

export interface OptionsLecture {
  separateur?: string;
  encodage?: "utf8" | "latin1" | "auto";
  /** Nombre maximum de lignes lues (utile pour un apercu). */
  limite?: number;
}

/** Separeurs candidats, par ordre de probabilite pour ces exports. */
const SEPARATEURS_CANDIDATS = [";", "\t", "|", ","];

/**
 * Determine l'encodage reel du fichier.
 * Les exports anciens sont souvent encodes en Windows-1252 (accents francais) ;
 * un decodage UTF-8 errone produit des caracteres de remplacement.
 */
export function detecterEncodage(buffer: Buffer): "utf8" | "latin1" {
  const commeUtf8 = buffer.toString("utf8");
  // Le caractere de remplacement U+FFFD signale une sequence UTF-8 invalide.
  if (commeUtf8.includes("�")) return "latin1";

  // Presence de sequences multi-octets valides pour des lettres accentuees.
  let sequencesUtf8 = 0;
  for (let index = 0; index < buffer.length - 1; index += 1) {
    const octet = buffer[index];
    if (octet >= 0xc2 && octet <= 0xdf) {
      const suivant = buffer[index + 1];
      if (suivant >= 0x80 && suivant <= 0xbf) sequencesUtf8 += 1;
    }
  }
  if (sequencesUtf8 > 0) return "utf8";

  // Aucun accent : on verifie qu'aucun octet isole n'est invalide en UTF-8.
  const reencode = Buffer.from(commeUtf8, "utf8");
  if (reencode.length === buffer.length) return "utf8";

  return "latin1";
}

/** Retire le BOM UTF-8 en tete de contenu. */
function retirerBom(contenu: string): string {
  return contenu.charCodeAt(0) === 0xfeff ? contenu.slice(1) : contenu;
}

function compterOccurrences(horsGuillemets: string, caractere: string): number {
  let total = 0;
  for (const lettre of horsGuillemets) {
    if (lettre === caractere) total += 1;
  }
  return total;
}

/**
 * Devine le separateur en analysant la premiere ligne logique.
 * Les champs entre guillemets sont neutralises pour ne pas fausser le comptage.
 */
export function detecterSeparateur(contenu: string): string {
  let premiereLigne = "";
  let dansGuillemets = false;

  for (let index = 0; index < contenu.length; index += 1) {
    const lettre = contenu[index];
    if (lettre === '"') {
      if (dansGuillemets && contenu[index + 1] === '"') {
        premiereLigne += '""';
        index += 1;
        continue;
      }
      dansGuillemets = !dansGuillemets;
      premiereLigne += '"';
      continue;
    }
    if (!dansGuillemets && (lettre === "\n" || lettre === "\r")) break;
    premiereLigne += lettre;
  }

  let meilleur = ";";
  let meilleurScore = 0;

  for (const candidat of SEPARATEURS_CANDIDATS) {
    const score = compterOccurrences(premiereLigne, candidat);
    if (score > meilleurScore) {
      meilleur = candidat;
      meilleurScore = score;
    }
  }

  return meilleur;
}

/**
 * Decoupe un contenu CSV en lignes logiques, en respectant les champs
 * entre guillemets qui peuvent contenir le separateur ou des sauts de ligne.
 */
function decouperEnLignes(
  contenu: string,
  separateur: string,
): { champs: string[]; brut: string }[] {
  const resultats: { champs: string[]; brut: string }[] = [];

  let champs: string[] = [];
  let champ = "";
  let dansGuillemets = false;
  let brut = "";
  let index = 0;

  const terminerChamp = () => {
    champs.push(champ);
    champ = "";
  };

  const terminerLigne = () => {
    terminerChamp();
    resultats.push({ champs, brut });
    champs = [];
    brut = "";
  };

  while (index < contenu.length) {
    const lettre = contenu[index];

    if (dansGuillemets) {
      if (lettre === '"') {
        if (contenu[index + 1] === '"') {
          champ += '"';
          brut += '""';
          index += 2;
          continue;
        }
        dansGuillemets = false;
        brut += lettre;
        index += 1;
        continue;
      }
      champ += lettre;
      brut += lettre;
      index += 1;
      continue;
    }

    if (lettre === '"') {
      dansGuillemets = true;
      brut += lettre;
      index += 1;
      continue;
    }

    if (lettre === separateur) {
      terminerChamp();
      brut += lettre;
      index += 1;
      continue;
    }

    if (lettre === "\r") {
      if (contenu[index + 1] === "\n") index += 1;
      terminerLigne();
      index += 1;
      continue;
    }

    if (lettre === "\n") {
      terminerLigne();
      index += 1;
      continue;
    }

    champ += lettre;
    brut += lettre;
    index += 1;
  }

  if (champ.length > 0 || champs.length > 0) {
    terminerLigne();
  }

  return resultats;
}

/** Lit un contenu CSV deja decode. */
export function analyserCsv(
  contenu: string,
  options: OptionsLecture = {},
): FichierCsv {
  const texte = retirerBom(contenu);
  const separateur = options.separateur ?? detecterSeparateur(texte);
  const lignesBrutes = decouperEnLignes(texte, separateur);

  const lignesUtiles = lignesBrutes.filter(
    (ligne) => ligne.brut.trim().length > 0,
  );

  if (lignesUtiles.length === 0) {
    return {
      entetes: [],
      lignes: [],
      separateur,
      encodage: "utf8",
      lignesIgnorees: 0,
    };
  }

  const entetes = lignesUtiles[0].champs.map((entete) => entete.trim());
  const lignes: LigneCsv[] = [];
  let lignesIgnorees = 0;

  const limite = options.limite ?? Number.POSITIVE_INFINITY;

  for (let index = 1; index < lignesUtiles.length; index += 1) {
    const ligne = lignesUtiles[index];

    // Une ligne entierement vide de valeurs est ignoree et comptabilisee.
    if (ligne.champs.every((valeur) => valeur.trim().length === 0)) {
      lignesIgnorees += 1;
      continue;
    }

    const valeurs: Record<string, string> = {};
    for (let colonne = 0; colonne < entetes.length; colonne += 1) {
      const entete = entetes[colonne];
      if (!entete) continue;
      valeurs[entete] = (ligne.champs[colonne] ?? "").trim();
    }

    lignes.push({ numero: index, valeurs, brut: ligne.brut });

    if (lignes.length >= limite) break;
  }

  return { entetes, lignes, separateur, encodage: "utf8", lignesIgnorees };
}

/** Lit un fichier CSV depuis le disque, avec detection d'encodage. */
export function lireFichierCsv(
  chemin: string,
  options: OptionsLecture = {},
): FichierCsv {
  const buffer = readFileSync(chemin);
  const encodageDemande = options.encodage ?? "auto";
  const encodage =
    encodageDemande === "auto" ? detecterEncodage(buffer) : encodageDemande;

  const contenu = buffer.toString(encodage);
  const fichier = analyserCsv(contenu, options);

  return { ...fichier, encodage };
}

// -----------------------------------------------------------------------------
// Conversion de valeurs
// -----------------------------------------------------------------------------

export function texte(valeur: string | undefined | null): string | null {
  if (valeur === undefined || valeur === null) return null;
  const nettoye = valeur.trim();
  return nettoye.length === 0 ? null : nettoye;
}

export function texteOuDefaut(valeur: string | undefined | null, defaut: string): string {
  return texte(valeur) ?? defaut;
}

/**
 * Convertit un decimal source.
 * Accepte « 1234.56000000 », « 1234,56 », « 1 234,56 » et les champs vides.
 * Retourne `null` si la valeur est absente ou non interpretable, afin que
 * l'appelant decide explicitement du comportement a adopter.
 */
export function decimal(valeur: string | undefined | null): Decimal | null {
  const brut = texte(valeur);
  if (brut === null) return null;

  const normalise = brut.replace(/\s| /g, "").replace(",", ".");
  if (!/^-?\d*\.?\d*$/.test(normalise) || normalise === "" || normalise === "-") {
    return null;
  }

  try {
    return D.of(normalise);
  } catch {
    return null;
  }
}

export function decimalOuZero(valeur: string | undefined | null): Decimal {
  return decimal(valeur) ?? D.ZERO;
}

export function entier(valeur: string | undefined | null): number | null {
  const brut = texte(valeur);
  if (brut === null) return null;
  const nombre = Number.parseInt(brut.replace(/\s/g, ""), 10);
  return Number.isFinite(nombre) ? nombre : null;
}

/** Booleens de l'ancien ERP : « t » / « f », « 1 » / « 0 », « vrai » / « faux ». */
export function booleen(
  valeur: string | undefined | null,
  defaut = false,
): boolean {
  const brut = texte(valeur)?.toLowerCase();
  if (brut === null || brut === undefined) return defaut;
  if (["t", "true", "1", "vrai", "oui", "o", "yes", "y"].includes(brut)) return true;
  if (["f", "false", "0", "faux", "non", "n", "no"].includes(brut)) return false;
  return defaut;
}

/**
 * Convertit une date source « 2026-02-07 10:07:34.062993 ».
 * Retourne `null` pour une date absente ou une valeur sentinelle vide.
 */
export function date(valeur: string | undefined | null): Date | null {
  const brut = texte(valeur);
  if (brut === null) return null;

  // Valeurs sentinelles utilisees par l'ancien ERP pour signifier « vide ».
  if (
    brut === "0001-01-01 00:00:00" ||
    brut.startsWith("0001-01-01") ||
    brut === "1800-01-01 00:00:00"
  ) {
    return null;
  }

  const normalise = brut.replace(" ", "T");
  const resultat = new Date(normalise);
  if (Number.isNaN(resultat.getTime())) return null;

  // Une date hors de la plage plausible est ignoree plutot que stockee telle quelle.
  const annee = resultat.getFullYear();
  if (annee < 1990 || annee > 2100) return null;

  return resultat;
}

/** Date de derniere modification, utilisee pour proteger les saisies locales. */
export function dateModification(valeur: string | undefined | null): Date | null {
  return date(valeur);
}

export interface RapportColonnes {
  colonnesAttendues: string[];
  colonnesPresentes: string[];
  colonnesManquantes: string[];
  colonnesInconnues: string[];
  conforme: boolean;
}

/**
 * Verifie que le fichier contient bien les colonnes attendues avant tout import.
 * Un rapport est produit et presente a l'administrateur.
 */
export function verifierColonnes(
  fichier: FichierCsv,
  colonnesAttendues: string[],
  colonnesObligatoires: string[] = [],
): RapportColonnes {
  const presentes = new Set(fichier.entetes);
  const attendues = new Set(colonnesAttendues);

  const manquantes = colonnesAttendues.filter((colonne) => !presentes.has(colonne));
  const inconnues = fichier.entetes.filter(
    (colonne) => colonne.length > 0 && !attendues.has(colonne),
  );
  const obligatoiresAbsentes = colonnesObligatoires.filter(
    (colonne) => !presentes.has(colonne),
  );

  return {
    colonnesAttendues,
    colonnesPresentes: fichier.entetes,
    colonnesManquantes: manquantes,
    colonnesInconnues: inconnues,
    conforme: obligatoiresAbsentes.length === 0,
  };
}
