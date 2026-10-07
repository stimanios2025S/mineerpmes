import type { Factory } from "@prisma/client";
import type { SessionUser } from "@/lib/auth/session";

/** Regles pures de portee, partagees par la navigation et les gardes serveur. */
export function estProprietaireUsine(utilisateur: SessionUser): boolean {
  return utilisateur.roles.some((role) =>
    ["PROPRIETAIRE_ADMEDCO", "PROPRIETAIRE_MOBILIX"].includes(role.code),
  );
}

export function peutAccederUsine(utilisateur: SessionUser, usine: Factory): boolean {
  if (utilisateur.scope.allFactories) return true;
  if (usine === "COMMUN") return !estProprietaireUsine(utilisateur);
  if (usine === "ADMEDCO") return utilisateur.scope.admedco;
  if (usine === "MOBILIX") return utilisateur.scope.mobilix;
  return false;
}

export function usinesAutorisees(utilisateur: SessionUser): Factory[] {
  if (utilisateur.scope.allFactories) return ["ADMEDCO", "MOBILIX", "COMMUN"];
  return (["COMMUN", "ADMEDCO", "MOBILIX"] as Factory[]).filter((usine) =>
    peutAccederUsine(utilisateur, usine),
  );
}
