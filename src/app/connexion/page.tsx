import { redirect } from "next/navigation";
import { actionConnexion, actionConnexionRapide } from "@/actions/auth";
import { utilisateurCourant } from "@/lib/rbac/guard";
import { comptesAccesRapide } from "@/lib/auth/acces-rapide";
import { premierCheminAccessible } from "@/components/navigation";
import { BoutonAction, Champ, FormulaireAction } from "@/components/interactif";

export const metadata = { title: "Connexion" };

export default async function PageConnexion() {
  const utilisateur = await utilisateurCourant();
  if (utilisateur) {
    redirect(
      utilisateur.mustChangePassword
        ? "/mon-compte/mot-de-passe"
        : (premierCheminAccessible(utilisateur) ?? "/aucun-acces"),
    );
  }

  // Acces rapide : uniquement hors production, et uniquement si .env declare
  // des comptes. Sans configuration, la page est strictement la meme qu'avant.
  const comptesRapides = comptesAccesRapide();

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">ERP MES</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--texte-doux)" }}>
            ADMEDCO — fabrication metallique · MOBILIX — bois, couture et garnissage
          </p>
        </header>

        <section className="carte p-6">
          <h2 className="mb-4 text-lg font-semibold">Connexion a la plateforme</h2>

          <FormulaireAction
            action={actionConnexion}
            libelleSoumettre="Se connecter"
            className="space-y-4"
          >
            <Champ
              nom="email"
              libelle="Adresse electronique"
              type="email"
              requis
              maxLength={200}
            />
            <Champ nom="motDePasse" libelle="Mot de passe" type="password" requis />
          </FormulaireAction>

          <p className="mt-5 text-xs" style={{ color: "var(--texte-doux)" }}>
            Chaque utilisateur dispose de son compte personnel, rattache a sa fiche employe.
            Les comptes partages sont interdits : toute action est rattachee a l'identite
            reelle de la personne connectee.
          </p>
        </section>

        {comptesRapides.length > 0 && (
          <section
            className="carte mt-4 p-4"
            style={{ background: "var(--alerte-clair)", borderColor: "var(--bordure-forte)" }}
          >
            <h2 className="text-sm font-semibold" style={{ color: "var(--alerte)" }}>
              Acces rapide — developpement uniquement
            </h2>
            <p className="mt-1 mb-3 text-xs" style={{ color: "var(--texte-doux)" }}>
              Un bouton par portail. Les identifiants proviennent du fichier .env, jamais du
              code : ce bloc disparait en production et des que AUTH_ACCES_RAPIDE est desactive.
            </p>

            <div className="flex flex-wrap gap-2">
              {comptesRapides.map((compte) => (
                <BoutonAction
                  key={compte.email}
                  action={actionConnexionRapide}
                  libelle={compte.libelle}
                  champsCaches={{ email: compte.email }}
                  titre={`Se connecter en tant que ${compte.email}`}
                />
              ))}
            </div>
          </section>
        )}

        <p className="mt-4 text-center text-xs" style={{ color: "var(--texte-doux)" }}>
          Aucun compte ne dispose d'un mot de passe par defaut. Le premier administrateur est
          cree par la procedure securisee d'initialisation.
        </p>
      </div>
    </main>
  );
}
