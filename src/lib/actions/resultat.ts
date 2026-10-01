import { baseInjoignable } from "@/lib/db";
import { DomainError } from "@/lib/errors";

/**
 * Contrat unique des actions serveur.
 *
 * Toute action appelee depuis l'interface renvoie ce resultat : l'interface n'a
 * donc jamais a interpreter une exception, et aucun message technique ne peut
 * se retrouver affiche tel quel a un operateur.
 */
export type ResultatAction<T = Record<string, unknown>> =
  | ({ ok: true; message: string } & T)
  | { ok: false; message: string; champs?: Record<string, string>; code?: string };

export function succes<T extends Record<string, unknown>>(
  message: string,
  donnees?: T,
): ResultatAction<T> {
  return { ok: true, message, ...(donnees ?? ({} as T)) };
}

export function echec(
  message: string,
  options: { champs?: Record<string, string>; code?: string } = {},
): ResultatAction<never> {
  return { ok: false, message, champs: options.champs, code: options.code };
}

/**
 * Execute une operation metier et convertit toute erreur en resultat affichable.
 * Les erreurs metier (DomainError) conservent leur message francais ; les
 * erreurs inattendues sont journalisees cote serveur et remplacees par un
 * message generique, sans fuite de detail technique.
 */
export async function executer<T extends Record<string, unknown>>(
  messageSucces: string,
  operation: () => Promise<T>,
): Promise<ResultatAction<T>> {
  try {
    const donnees = await operation();
    return { ok: true, message: messageSucces, ...donnees };
  } catch (erreur) {
    if (erreur instanceof DomainError) {
      return echec(erreur.message, {
        champs: erreur.details?.fields,
        code: erreur.code,
      });
    }

    // Panne d'infrastructure connue : on le dit, au lieu de renvoyer un
    // « erreur inattendue » qui n'aide personne.
    if (baseInjoignable(erreur)) {
      console.error("[action] base de donnees injoignable :", erreur);
      return echec(
        "La base de donnees n'est pas joignable : l'operation a ete interrompue. " +
          "Demarrez PostgreSQL (Docker Desktop, puis « docker start erpmes-postgres ») " +
          "et reessayez.",
        { code: "BASE_INJOIGNABLE" },
      );
    }

    console.error("[action] erreur inattendue :", erreur);
    return echec(
      "Une erreur inattendue est survenue. L'operation a ete interrompue ; aucune donnee n'a ete enregistree.",
      { code: "ERREUR_INTERNE" },
    );
  }
}

/** Convertit une saisie de formulaire en texte nettoye, ou null si vide. */
export function texteOuNull(valeur: FormDataEntryValue | null): string | null {
  if (valeur === null) return null;
  const texte = String(valeur).trim();
  return texte === "" ? null : texte;
}

/** Convertit une saisie de formulaire en texte obligatoire. */
export function texteObligatoire(
  valeur: FormDataEntryValue | null,
  libelleChamp: string,
): string {
  const texte = texteOuNull(valeur);
  if (texte === null) {
    throw new DomainError("VALIDATION", `Le champ « ${libelleChamp} » est obligatoire.`);
  }
  return texte;
}

/** Convertit une saisie de formulaire en entier, avec valeur par defaut. */
export function entierOu(
  valeur: FormDataEntryValue | null,
  defaut: number | null = null,
): number | null {
  const texte = texteOuNull(valeur);
  if (texte === null) return defaut;
  const nombre = Number.parseInt(texte.replace(/\s/g, ""), 10);
  return Number.isFinite(nombre) ? nombre : defaut;
}

/** Convertit une saisie numerique francaise ("1 234,56") en decimal exact. */
export function decimalOuNull(valeur: FormDataEntryValue | null): string | null {
  const texte = texteOuNull(valeur);
  if (texte === null) return null;
  const normalise = texte.replace(/\s| /g, "").replace(",", ".");
  const nombre = Number(normalise);
  if (!Number.isFinite(nombre)) {
    throw new DomainError("VALIDATION", `La valeur « ${texte} » n'est pas un nombre valide.`);
  }
  return normalise;
}

export function decimalObligatoire(
  valeur: FormDataEntryValue | null,
  libelleChamp: string,
): string {
  const texte = decimalOuNull(valeur);
  if (texte === null) {
    throw new DomainError("VALIDATION", `Le champ « ${libelleChamp} » est obligatoire.`);
  }
  return texte;
}

/** Convertit une date de formulaire (aaaa-mm-jj) en Date, ou null. */
export function dateOuNull(valeur: FormDataEntryValue | null): Date | null {
  const texte = texteOuNull(valeur);
  if (texte === null) return null;
  const date = new Date(texte);
  if (Number.isNaN(date.getTime())) {
    throw new DomainError("VALIDATION", `La date « ${texte} » est invalide.`);
  }
  return date;
}

export function booleen(valeur: FormDataEntryValue | null): boolean {
  const texte = texteOuNull(valeur);
  if (texte === null) return false;
  return ["on", "true", "1", "oui", "OUI"].includes(texte);
}
