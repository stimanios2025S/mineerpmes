"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  changerMotDePasse,
  connecter,
  deconnecter,
} from "@/lib/auth/service";
import { exigerUtilisateur } from "@/lib/rbac/guard";
import { compteAccesRapide } from "@/lib/auth/acces-rapide";
import { premierCheminAccessible } from "@/components/navigation";
import { echec, executer, texteObligatoire, type ResultatAction } from "@/lib/actions/resultat";

/**
 * Actions d'authentification.
 * Le mot de passe n'est jamais journalise ni renvoye : seuls les messages
 * francais du service d'authentification remontent a l'interface.
 */

export async function actionConnexion(formData: FormData): Promise<ResultatAction> {
  const email = texteObligatoire(formData.get("email"), "Adresse electronique");
  const motDePasse = String(formData.get("motDePasse") ?? "");

  const resultat = await executer("Connexion reussie.", async () => {
    const { utilisateur } = await connecter(email, motDePasse);
    return {
      destination: premierCheminAccessible(utilisateur),
      doitChangerMotDePasse: utilisateur.mustChangePassword,
    };
  });

  if (!resultat.ok) return resultat;

  revalidatePath("/", "layout");

  if (resultat.doitChangerMotDePasse) {
    redirect("/mon-compte/mot-de-passe");
  }

  redirect(resultat.destination ?? "/aucun-acces");
}

/**
 * Connexion rapide de developpement, declenchee par les boutons de portail de
 * la page de connexion.
 *
 * L'interface n'envoie que l'adresse du compte : le mot de passe correspondant
 * est resolu cote serveur depuis .env (voir src/lib/auth/acces-rapide.ts), il ne
 * transite donc jamais par le navigateur. Hors developpement, ou pour toute
 * adresse absente de la liste, cette action refuse : la connexion nominale reste
 * le seul chemin.
 */
export async function actionConnexionRapide(formData: FormData): Promise<ResultatAction> {
  const email = texteObligatoire(formData.get("email"), "Adresse electronique");
  const compte = compteAccesRapide(email);

  if (!compte) {
    return echec("Acces rapide indisponible pour ce compte. Utilisez la connexion habituelle.");
  }

  const resultat = await executer("Connexion reussie.", async () => {
    const { utilisateur } = await connecter(compte.email, compte.motDePasse);
    return {
      destination: premierCheminAccessible(utilisateur),
      doitChangerMotDePasse: utilisateur.mustChangePassword,
    };
  });

  if (!resultat.ok) return resultat;

  revalidatePath("/", "layout");

  if (resultat.doitChangerMotDePasse) {
    redirect("/mon-compte/mot-de-passe");
  }

  redirect(resultat.destination ?? "/aucun-acces");
}

/**
 * Deconnexion. Utilisee directement comme action de formulaire dans l'en-tete :
 * la session est revoquee en base avant la suppression du cookie.
 */
export async function actionDeconnexion(): Promise<void> {
  await deconnecter();
  revalidatePath("/", "layout");
  redirect("/connexion");
}

export async function actionChangerMotDePasse(
  formData: FormData,
): Promise<ResultatAction> {
  const utilisateur = await exigerUtilisateur();

  const motDePasseActuel = String(formData.get("motDePasseActuel") ?? "");
  const nouveauMotDePasse = String(formData.get("nouveauMotDePasse") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  if (!motDePasseActuel || !nouveauMotDePasse || !confirmation) {
    return echec("Les trois champs de mot de passe sont obligatoires.");
  }

  return executer("Votre mot de passe a ete modifie. Vos autres sessions ont ete deconnectees.", async () => {
    await changerMotDePasse(
      utilisateur.id,
      motDePasseActuel,
      nouveauMotDePasse,
      confirmation,
    );
    return {};
  });
}
