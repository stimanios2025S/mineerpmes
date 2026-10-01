/**
 * Acces rapide de developpement — un bouton par portail sur la page de
 * connexion.
 *
 * But unique : pendant la mise au point, eviter de ressaisir son adresse et son
 * mot de passe a chaque connexion. Ce module existe pour cette seule raison et
 * s'efface de lui-meme en production : `accesRapideActif()` renvoie toujours
 * `false` des que NODE_ENV vaut « production », quelle que soit la valeur de la
 * variable d'activation.
 *
 * Deux regles tenues ici :
 *
 *  1. Aucun identifiant n'est ecrit dans le depot : la liste des comptes est
 *     lue dans le fichier .env, qui n'est jamais versionne.
 *  2. Le mot de passe ne quitte jamais le serveur : l'interface n'envoie que
 *     l'adresse du compte choisi, la resolution du mot de passe est faite ici
 *     au moment de la connexion. Rien n'est journalise : ni la liste, ni les
 *     mots de passe.
 *
 * Configuration attendue dans .env :
 *
 *   AUTH_ACCES_RAPIDE="true"
 *   AUTH_ACCES_RAPIDE_COMPTES="Direction|direction@admedco.dz|MotDePasse!2026;Portail employe|operateur1@admedco.dz|MotDePasse!2026"
 *
 * Une entree par compte, entrees separees par « ; » ou par un retour a la ligne,
 * champs separes par « | » : libelle | adresse | mot de passe.
 * Une entree incomplete est ignoree sans bruit : la page de connexion reste
 * utilisable meme si la configuration est erronee.
 */

export interface CompteAccesRapide {
  libelle: string;
  email: string;
  motDePasse: string;
}

const VARIABLE_ACTIVATION = "AUTH_ACCES_RAPIDE";
const VARIABLE_COMPTES = "AUTH_ACCES_RAPIDE_COMPTES";

/**
 * Indique si le panneau d'acces rapide doit etre affiche.
 * Jamais vrai en production : c'est une garantie, pas un reglage.
 */
export function accesRapideActif(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return (process.env[VARIABLE_ACTIVATION] ?? "").trim().toLowerCase() === "true";
}

/** Comptes declares dans .env, dans l'ordre de saisie. */
export function comptesAccesRapide(): CompteAccesRapide[] {
  if (!accesRapideActif()) return [];

  return (process.env[VARIABLE_COMPTES] ?? "")
    .split(/[;\r\n]+/)
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne.length > 0 && !ligne.startsWith("#"))
    .map((ligne) => {
      const champs = ligne.split("|");
      const libelle = (champs.shift() ?? "").trim();
      const email = (champs.shift() ?? "").trim().toLowerCase();
      // Le mot de passe est le dernier champ : il peut donc contenir « | ».
      const motDePasse = champs.join("|").trim();
      return { libelle, email, motDePasse };
    })
    .filter(
      (compte) =>
        compte.libelle.length > 0 &&
        compte.email.includes("@") &&
        compte.motDePasse.length > 0,
    );
}

/**
 * Retrouve un compte declare, par adresse exacte.
 * Renvoie null si l'acces rapide est desactive ou si l'adresse n'est pas dans la
 * liste : aucune autre adresse ne peut donc emprunter ce chemin.
 */
export function compteAccesRapide(email: string): CompteAccesRapide | null {
  const recherche = email.trim().toLowerCase();
  if (!recherche) return null;
  return comptesAccesRapide().find((compte) => compte.email === recherche) ?? null;
}
