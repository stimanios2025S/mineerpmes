import { Prisma } from "@prisma/client";

/**
 * Mise en forme francaise (fr-FR) de toutes les valeurs affichees.
 * Devise et TVA sont configurables ; le dinar algerien est la valeur initiale.
 */

export const LOCALE_FR = "fr-FR";
export const DEVISE_PAR_DEFAUT = "DZD";
export const TVA_PAR_DEFAUT = 19;

type NumericInput = Prisma.Decimal | number | string | null | undefined;

function toNumber(value: NumericInput): number {
  if (value === null || value === undefined || value === "") return 0;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (typeof value === "number") return value;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(LOCALE_FR, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(LOCALE_FR, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatHeure(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(LOCALE_FR, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Date au format ISO court attendu par les champs <input type="date">. */
export function toInputDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatNombre(value: NumericInput, decimals = 2): string {
  return new Intl.NumberFormat(LOCALE_FR, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(toNumber(value));
}

/** Quantite : decimales significatives, sans zeros inutiles. */
export function formatQuantite(value: NumericInput, decimalsMax = 3): string {
  return new Intl.NumberFormat(LOCALE_FR, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimalsMax,
  }).format(toNumber(value));
}

export function formatEntier(value: NumericInput): string {
  return new Intl.NumberFormat(LOCALE_FR, { maximumFractionDigits: 0 }).format(
    toNumber(value),
  );
}

export function formatMontant(
  value: NumericInput,
  devise: string = DEVISE_PAR_DEFAUT,
): string {
  return new Intl.NumberFormat(LOCALE_FR, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value)) +
    (devise ? ` ${devise}` : "");
}

export function formatPourcentage(value: NumericInput, decimals = 2): string {
  return `${formatNombre(value, decimals)} %`;
}

export function formatTaux(value: NumericInput, decimals = 2): string {
  return `${formatNombre(value, decimals)} %`;
}

/** Parse une saisie utilisateur au format francais ("1 234,56" ou "1234.56"). */
export function parseNombreFr(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const cleaned = String(input)
    .replace(/\s| /g, "")
    .replace(",", ".");
  if (cleaned === "") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatDuree(minutes: NumericInput): string {
  const total = Math.round(toNumber(minutes));
  if (total <= 0) return "0 min";
  const heures = Math.floor(total / 60);
  const mins = total % 60;
  if (heures === 0) return `${mins} min`;
  if (mins === 0) return `${heures} h`;
  return `${heures} h ${String(mins).padStart(2, "0")}`;
}

export function formatTaille(fichier: NumericInput): string {
  const octets = toNumber(fichier);
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${formatNombre(octets / 1024, 1)} Ko`;
  return `${formatNombre(octets / (1024 * 1024), 1)} Mo`;
}
