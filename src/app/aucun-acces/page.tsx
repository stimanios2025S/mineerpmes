import Link from "next/link";
import { redirect } from "next/navigation";
import { actionDeconnexion } from "@/actions/auth";
import { utilisateurCourant } from "@/lib/rbac/guard";
import { Carte, EnTetePage } from "@/components/ui";

export const metadata = { title: "Aucun acces" };

/**
 * Page affichee lorsqu'un compte authentifie ne dispose d'aucune permission
 * lui ouvrant une page : le blocage est explicite, jamais silencieux.
 */
export default async function PageAucunAcces() {
  const utilisateur = await utilisateurCourant();
  if (!utilisateur) redirect("/connexion");

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <EnTetePage
        titre="Aucune page accessible"
        description="Votre compte est bien authentifie, mais aucun de vos roles ne vous ouvre de page dans la plateforme."
      />
      <Carte titre="Que faire ?">
        <p className="text-sm">
          Demandez a l'administrateur de la plateforme d'attribuer un role a votre compte
          (<strong>{utilisateur.email}</strong>). Les roles determinent les pages, les actions
          et les donnees auxquelles vous avez droit.
        </p>
        <dl className="mt-4 text-sm">
          <dt className="font-semibold">Roles actuellement attribues</dt>
          <dd>
            {utilisateur.roles.length === 0
              ? "Aucun role"
              : utilisateur.roles.map((role) => role.label).join(", ")}
          </dd>
        </dl>
        <form action={actionDeconnexion} className="mt-6">
          <button type="submit" className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold">
            Se deconnecter
          </button>
        </form>
        <p className="mt-4 text-xs">
          <Link className="lien-nav" href="/connexion">
            Retour a la page de connexion
          </Link>
        </p>
      </Carte>
    </main>
  );
}
