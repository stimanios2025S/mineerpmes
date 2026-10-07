import type { Factory } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { DomainError } from "@/lib/errors";
import { exigerPermissionEtUsine } from "./guard";

/**
 * Statut HTTP porte par une interruption Next.js (`forbidden`, `unauthorized`,
 * `notFound`). Next.js documente ce format de digest : `forbidden()` leve
 * `NEXT_HTTP_ERROR_FALLBACK;403`.
 */
function statutInterruption(erreur: unknown): number | null {
  if (typeof erreur !== "object" || erreur === null) return null;

  const digest = (erreur as { digest?: unknown }).digest;
  if (typeof digest !== "string") return null;

  const [prefixe, statut] = digest.split(";");
  if (prefixe !== "NEXT_HTTP_ERROR_FALLBACK") return null;

  const code = Number(statut);
  return code === 401 || code === 403 || code === 404 ? code : null;
}

/**
 * Refuse une page hors usine avant toute lecture metier.
 *
 * Le refus est volontairement rendu en 404, y compris lorsque les droits sont
 * insuffisants : l'existence d'une ressource d'une autre usine n'est jamais
 * confirmee a l'appelant. Les gardes levant des interruptions Next.js depuis
 * l'activation de `experimental.authInterrupts`, elles sont retraduites ici
 * pour conserver ce comportement.
 */
export async function exigerPageUsine(permission: string, usine: Factory) {
  try {
    return await exigerPermissionEtUsine(permission, usine);
  } catch (erreur) {
    const statut = statutInterruption(erreur);
    if (statut === 401) redirect("/connexion");
    if (statut === 403) notFound();

    // Chemin conserve pour les erreurs metier qui ne viennent pas des gardes.
    if (erreur instanceof DomainError) {
      if (erreur.code === "NON_AUTHENTIFIE") redirect("/connexion");
      if (erreur.code === "ACCES_REFUSE") notFound();
    }
    throw erreur;
  }
}
