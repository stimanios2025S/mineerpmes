import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Parametres scrypt : cout memoire 16 MiB, blocage 8, parallelisme 1.
 * Formats de mot de passe :  scrypt$N$r$p$saltBase64$hashBase64
 */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const SALT_BYTES = 16;

const ALGORITHM = "scrypt";

export const LONGUEUR_MINIMALE_MOT_DE_PASSE = 12;

/**
 * Regles affichees a l'utilisateur, exprimees en francais.
 * Ce texte doit rester aligne sur `verifierRobustesseMotDePasse` ci-dessous :
 * l'interface ne reformule jamais la politique de securite.
 */
export const REGLES_MOT_DE_PASSE =
  "Au moins 12 caracteres, comprenant une minuscule, une majuscule, un chiffre et un caractere special. Aucun mot courant et aucun caractere repete quatre fois ou plus.";

export interface PasswordStrengthResult {
  valide: boolean;
  erreurs: string[];
}

/**
 * Politique de mot de passe de la plateforme.
 * Volontairement exigeante : la plateforme porte des donnees industrielles,
 * financieres et salariales.
 */
export function verifierRobustesseMotDePasse(motDePasse: string): PasswordStrengthResult {
  const erreurs: string[] = [];

  if (!motDePasse || motDePasse.length < LONGUEUR_MINIMALE_MOT_DE_PASSE) {
    erreurs.push(
      `Le mot de passe doit contenir au moins ${LONGUEUR_MINIMALE_MOT_DE_PASSE} caracteres.`,
    );
  }
  if (!/[a-z]/.test(motDePasse)) {
    erreurs.push("Le mot de passe doit contenir au moins une lettre minuscule.");
  }
  if (!/[A-Z]/.test(motDePasse)) {
    erreurs.push("Le mot de passe doit contenir au moins une lettre majuscule.");
  }
  if (!/[0-9]/.test(motDePasse)) {
    erreurs.push("Le mot de passe doit contenir au moins un chiffre.");
  }
  if (!/[^A-Za-z0-9]/.test(motDePasse)) {
    erreurs.push("Le mot de passe doit contenir au moins un caractere special.");
  }
  if (/(.)\1{3,}/.test(motDePasse)) {
    erreurs.push("Le mot de passe ne doit pas contenir de caractere repete quatre fois ou plus.");
  }
  const motsDePasseCourants = [
    "password",
    "motdepasse",
    "azerty",
    "qwerty",
    "123456",
    "admin",
    "erpmes",
    "admedco",
    "mobilix",
  ];
  const enMinuscules = motDePasse.toLowerCase();
  if (motsDePasseCourants.some((mot) => enMinuscules.includes(mot))) {
    erreurs.push("Le mot de passe ne doit pas contenir un mot courant ou le nom du systeme.");
  }

  return { valide: erreurs.length === 0, erreurs };
}

export async function hacherMotDePasse(motDePasse: string): Promise<string> {
  if (!motDePasse) {
    throw new Error("Le mot de passe ne peut pas etre vide.");
  }

  const salt = randomBytes(SALT_BYTES);
  const cle = await scrypt(motDePasse.normalize("NFKC"), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });

  return [
    ALGORITHM,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    cle.toString("base64"),
  ].join("$");
}

/**
 * Verification en temps constant. Ne leve jamais d'exception sur un hash
 * malformé : renvoie false pour ne pas transformer une donnee corrompue en
 * fuite d'information.
 */
export async function verifierMotDePasse(
  motDePasse: string,
  hashStocke: string,
): Promise<boolean> {
  try {
    if (!motDePasse || !hashStocke) return false;

    const parties = hashStocke.split("$");
    if (parties.length !== 6) return false;

    const [algorithme, nStr, rStr, pStr, saltB64, hashB64] = parties;
    if (algorithme !== ALGORITHM) return false;

    const N = Number.parseInt(nStr, 10);
    const r = Number.parseInt(rStr, 10);
    const p = Number.parseInt(pStr, 10);
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

    const salt = Buffer.from(saltB64, "base64");
    const hashAttendu = Buffer.from(hashB64, "base64");
    if (salt.length === 0 || hashAttendu.length === 0) return false;

    const cle = await scrypt(motDePasse.normalize("NFKC"), salt, hashAttendu.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });

    if (cle.length !== hashAttendu.length) return false;
    return timingSafeEqual(cle, hashAttendu);
  } catch {
    return false;
  }
}

/** Indique si un hash doit etre recalcule (parametres obsoletes). */
export function hashDoitEtreMisAJour(hashStocke: string): boolean {
  const parties = hashStocke.split("$");
  if (parties.length !== 6) return true;
  const [algorithme, nStr, rStr, pStr] = parties;
  return (
    algorithme !== ALGORITHM ||
    Number.parseInt(nStr, 10) !== SCRYPT_N ||
    Number.parseInt(rStr, 10) !== SCRYPT_R ||
    Number.parseInt(pStr, 10) !== SCRYPT_P
  );
}

/** Generation d'un mot de passe temporaire robuste (remise de compte). */
export function genererMotDePasseTemporaire(longueur = 16): string {
  const minuscules = "abcdefghijkmnopqrstuvwxyz";
  const majuscules = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const chiffres = "23456789";
  const speciaux = "!@#$%*+-?";
  const tous = minuscules + majuscules + chiffres + speciaux;

  const tirer = (source: string): string => {
    const index = randomBytes(1)[0] % source.length;
    return source[index];
  };

  const caracteres: string[] = [
    tirer(minuscules),
    tirer(majuscules),
    tirer(chiffres),
    tirer(speciaux),
  ];

  while (caracteres.length < longueur) {
    caracteres.push(tirer(tous));
  }

  // Melange de Fisher-Yates avec une source cryptographique.
  for (let i = caracteres.length - 1; i > 0; i -= 1) {
    const j = randomBytes(1)[0] % (i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }

  return caracteres.join("");
}
