import type { SessionUser } from "@/lib/auth/session";
import { usinesAutorisees } from "@/lib/rbac/portee";

export type UsinePortail = "ADMEDCO" | "MOBILIX";

export interface IdentitePortail {
  code: UsinePortail;
  libelle: string;
  courte: string;
  description: string;
  className: string;
}

const IDENTITES: Record<UsinePortail, IdentitePortail> = {
  ADMEDCO: {
    code: "ADMEDCO",
    libelle: "ADMEDCO",
    courte: "ADMEDCO",
    description: "Portail atelier ADMEDCO - fabrication metallique",
    className: "portail-admedco",
  },
  MOBILIX: {
    code: "MOBILIX",
    libelle: "MOBILIX",
    courte: "MOBILIX",
    description: "Portail atelier MOBILIX - bois, couture et garnissage",
    className: "portail-mobilix",
  },
};

export function estUsinePortail(valeur: string | null | undefined): valeur is UsinePortail {
  return valeur === "ADMEDCO" || valeur === "MOBILIX";
}

export function identitePortail(usine: UsinePortail): IdentitePortail {
  return IDENTITES[usine];
}

/** Identite du portail connecte : une seule usine, ou la supervision globale. */
export function identiteUtilisateur(utilisateur: SessionUser): IdentitePortail | null {
  const usines = usinesAutorisees(utilisateur).filter(estUsinePortail);
  return usines.length === 1 ? identitePortail(usines[0]) : null;
}
