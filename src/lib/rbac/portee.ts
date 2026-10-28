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
  /*
   * « Transversal » signifie utilisable par les deux divisions. Le refuser a un
   * proprietaire d'usine fermait sa propre fiche produit : les articles importes
   * sont transversaux, et il ne pouvait ni les consulter ni les modifier depuis
   * son portail. Il accede donc au transversal, et seulement a cela en plus de
   * sa division — jamais a l'autre usine.
   */
  if (usine === "COMMUN") return true;
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
