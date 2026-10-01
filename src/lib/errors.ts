/**
 * Erreurs metier de la plateforme.
 * Tous les messages sont rediges en francais : ils sont affiches tels quels
 * dans l'interface et dans les reponses d'API.
 */

export type DomainErrorCode =
  | "NON_AUTHENTIFIE"
  | "ACCES_REFUSE"
  | "NON_TROUVE"
  | "VALIDATION"
  | "CONFLIT"
  | "STOCK_INSUFFISANT"
  | "STOCK_BLOQUE"
  | "STOCK_QUARANTAINE"
  | "NON_CONFORME"
  | "ETAT_INVALIDE"
  | "DOCUMENT_VERROUILLE"
  | "ERREUR_INTERNE";

const HTTP_STATUS: Record<DomainErrorCode, number> = {
  NON_AUTHENTIFIE: 401,
  ACCES_REFUSE: 403,
  NON_TROUVE: 404,
  VALIDATION: 422,
  CONFLIT: 409,
  STOCK_INSUFFISANT: 409,
  STOCK_BLOQUE: 409,
  STOCK_QUARANTAINE: 409,
  NON_CONFORME: 409,
  ETAT_INVALIDE: 409,
  DOCUMENT_VERROUILLE: 409,
  ERREUR_INTERNE: 500,
};

export interface DomainErrorDetails {
  /** Champs de formulaire en erreur : { champ: "message" } */
  fields?: Record<string, string>;
  /** Donnees complementaires utiles au diagnostic. */
  context?: Record<string, unknown>;
}

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly httpStatus: number;
  readonly details?: DomainErrorDetails;

  constructor(
    code: DomainErrorCode,
    message: string,
    details?: DomainErrorDetails,
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.details = details;
  }

  toJSON() {
    return {
      error: true,
      code: this.code,
      message: this.message,
      details: this.details ?? null,
    };
  }
}

export const nonAuthentifie = (message = "Vous devez vous connecter pour continuer.") =>
  new DomainError("NON_AUTHENTIFIE", message);

export const accesRefuse = (message = "Vous n'avez pas les droits necessaires pour cette action.") =>
  new DomainError("ACCES_REFUSE", message);

export const nonTrouve = (quoi: string) =>
  new DomainError("NON_TROUVE", `${quoi} est introuvable.`);

export const validation = (message: string, fields?: Record<string, string>) =>
  new DomainError("VALIDATION", message, { fields });

export const conflit = (message: string) => new DomainError("CONFLIT", message);

export const etatInvalide = (message: string) => new DomainError("ETAT_INVALIDE", message);

export const stockInsuffisant = (message: string, context?: Record<string, unknown>) =>
  new DomainError("STOCK_INSUFFISANT", message, { context });

/**
 * Convertit une erreur inconnue en reponse d'API normalisee.
 */
export function toErrorResponse(error: unknown): {
  status: number;
  body: ReturnType<DomainError["toJSON"]>;
} {
  if (error instanceof DomainError) {
    return { status: error.httpStatus, body: error.toJSON() };
  }

  const message =
    error instanceof Error ? error.message : "Une erreur inattendue est survenue.";

  return {
    status: 500,
    body: {
      error: true,
      code: "ERREUR_INTERNE",
      message,
      details: null,
    },
  };
}
