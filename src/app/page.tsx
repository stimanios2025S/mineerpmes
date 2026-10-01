import { redirect } from "next/navigation";
import { utilisateurCourant } from "@/lib/rbac/guard";
import { premierCheminAccessible } from "@/components/navigation";

/**
 * Point d'entree : oriente vers la premiere page reellement accessible
 * a l'utilisateur connecte, ou vers la page de connexion.
 */
export default async function PageAccueil() {
  const utilisateur = await utilisateurCourant();

  if (!utilisateur) redirect("/connexion");
  if (utilisateur.mustChangePassword) redirect("/mon-compte/mot-de-passe");

  redirect(premierCheminAccessible(utilisateur) ?? "/aucun-acces");
}
