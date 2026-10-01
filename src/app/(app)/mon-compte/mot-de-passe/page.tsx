import Link from "next/link";
import { actionChangerMotDePasse } from "@/actions/auth";
import { exigerUtilisateur } from "@/lib/rbac/guard";
import { Alerte, Carte, EnTetePage } from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { REGLES_MOT_DE_PASSE } from "@/lib/auth/password";

export const metadata = { title: "Mot de passe" };

export default async function PageMotDePasse() {
  const utilisateur = await exigerUtilisateur();

  return (
    <>
      <EnTetePage
        titre="Modifier mon mot de passe"
        description="Le mot de passe est personnel et confidentiel. Aucun mot de passe n'est stocke en clair : seule une empreinte cryptographique est conservee."
        actions={
          <Link className="lien-nav text-sm" href="/mon-compte">
            Retour a mon compte
          </Link>
        }
      />

      {utilisateur.mustChangePassword && (
        <div className="mb-5">
          <Alerte ton="alerte" titre="Remplacement obligatoire">
            Votre mot de passe actuel a ete fourni par un administrateur. Vous devez le
            remplacer pour poursuivre l'utilisation de la plateforme.
          </Alerte>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Carte titre="Nouveau mot de passe">
          <FormulaireAction
            action={actionChangerMotDePasse}
            libelleSoumettre="Enregistrer le nouveau mot de passe"
            className="space-y-4"
            reinitialiser
            rafraichir={false}
          >
            <Champ
              nom="motDePasseActuel"
              libelle="Mot de passe actuel"
              type="password"
              requis
            />
            <Champ
              nom="nouveauMotDePasse"
              libelle="Nouveau mot de passe"
              type="password"
              requis
              aide={REGLES_MOT_DE_PASSE}
            />
            <Champ
              nom="confirmation"
              libelle="Confirmation du nouveau mot de passe"
              type="password"
              requis
            />
          </FormulaireAction>
        </Carte>

        <Carte titre="Consequences">
          <ul className="list-disc space-y-2 pl-5 text-sm">
            <li>Toutes vos autres sessions sont deconnectees immediatement.</li>
            <li>
              Le nouveau mot de passe doit respecter les regles de robustesse affichees dans
              le formulaire.
            </li>
            <li>
              Le changement est enregistre dans le journal d'audit avec la date et l'auteur,
              jamais le mot de passe lui-meme.
            </li>
            <li>
              En cas d'oubli, seul un administrateur peut reinitialiser l'acces : il fournit
              un mot de passe temporaire que vous devrez remplacer.
            </li>
          </ul>
        </Carte>
      </div>
    </>
  );
}
