import type { Metadata } from "next";
import { identiteUtilisateur } from "@/lib/portail-identite";
import Link from "next/link";
import { redirect } from "next/navigation";
import { actionDeconnexion } from "@/actions/auth";
import { usinesAutorisees, utilisateurCourant } from "@/lib/rbac/guard";
import { navigationAutorisee } from "@/components/navigation";
import { LienNavigation } from "@/components/navigation-client";
import { Etiquette } from "@/components/ui";
import { LIBELLES_USINE, libelle } from "@/lib/libelles";

export async function generateMetadata(): Promise<Metadata> {
  const utilisateur = await utilisateurCourant();
  const identite = utilisateur ? identiteUtilisateur(utilisateur) : null;
  const nom = identite?.libelle ?? "Direction generale";
  return {
    title: { default: `Portail ${nom}`, template: `%s - ${nom}` },
    applicationName: `${nom} ERP MES`,
    description: identite?.description ?? "Supervision des usines ADMEDCO et MOBILIX.",
  };
}

/**
 * Coquille de l'application connectee.
 *
 * La navigation affichee est filtree par permission, mais chaque page verifie
 * elle-meme ses droits : cette coquille ne constitue pas une protection.
 */
export default async function LayoutApplication({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const utilisateur = await utilisateurCourant();

  if (!utilisateur) redirect("/connexion");

  const identite = identiteUtilisateur(utilisateur);
  const nomPortail = identite?.libelle ?? "ADMEDCO / MOBILIX";
  const sections = navigationAutorisee(utilisateur);
  const usines = usinesAutorisees(utilisateur);

  const contenuNavigation = (
    <nav aria-label="Navigation principale" className="space-y-5">
      {sections.length === 0 ? (
        <p className="px-3 text-sm" style={{ color: "var(--texte-doux)" }}>
          Aucune page accessible avec vos roles actuels.
        </p>
      ) : (
        sections.map((section) => (
          <div key={section.code}>
            <p
              className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--texte-doux)" }}
            >
              {section.titre}
            </p>
            <div className="space-y-0.5">
              {section.entrees.map((entree) => (
                <LienNavigation
                  key={entree.chemin}
                  chemin={entree.chemin}
                  libelle={entree.libelle}
                  description={entree.description}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </nav>
  );

  return (
    <div className={`${identite?.className ?? ""} min-h-screen lg:grid lg:grid-cols-[17rem_1fr]`}>
      <aside
        className="hidden border-r px-2 py-4 lg:block"
        style={{ background: "var(--surface)", borderColor: "var(--bordure)" }}
      >
        <Link href="/" className="mb-4 block px-3">
          <span className="block text-base font-semibold">ERP MES</span>
          <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
            {nomPortail}
          </span>
        </Link>
        {contenuNavigation}
      </aside>

      <div className="flex min-w-0 flex-col">
        <header
          className="flex flex-wrap items-center gap-3 border-b px-4 py-2"
          style={{ background: "var(--surface)", borderColor: "var(--bordure)" }}
        >
          <details className="lg:hidden">
            <summary className="cursor-pointer rounded-md border px-3 py-1.5 text-sm">
              Menu
            </summary>
            <div
              className="absolute z-20 mt-2 max-h-[70vh] w-72 overflow-y-auto rounded-lg border p-2 shadow-lg"
              style={{ background: "var(--surface)", borderColor: "var(--bordure)" }}
            >
              {contenuNavigation}
            </div>
          </details>

          <Link href="/" className="text-sm font-semibold lg:hidden">
            {nomPortail} · ERP MES
          </Link>

          <form action="/recherche" method="get" className="flex min-w-[12rem] flex-1 items-center gap-2">
            <label className="sr-only" htmlFor="recherche-globale">
              Recherche globale
            </label>
            <input
              id="recherche-globale"
              className="champ"
              type="search"
              name="q"
              placeholder={identite ? `Rechercher dans ${nomPortail}...` : "Rechercher un article, un tiers, un document..."}
            />
            <button
              type="submit"
              className="min-h-[42px] rounded-lg border px-3 text-sm font-semibold"
            >
              Rechercher
            </button>
          </form>

          <div className="flex items-center gap-2 text-xs">
            {usines.map((usine) => (
              <Etiquette key={usine} ton="primaire">
                {libelle(LIBELLES_USINE, usine)}
              </Etiquette>
            ))}
          </div>

          <div className="flex items-center gap-3 text-sm">
            <div className="text-right">
              <p className="font-semibold">
                {utilisateur.employeeName ?? utilisateur.email}
              </p>
              <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                {utilisateur.roles.map((role) => role.label).join(", ") || "Aucun role"}
              </p>
            </div>
            <Link className="lien-nav text-xs" href="/mon-compte">
              Mon compte
            </Link>
            <form action={actionDeconnexion}>
              <button
                type="submit"
                className="min-h-[38px] rounded-lg border px-3 text-xs font-semibold"
              >
                Se deconnecter
              </button>
            </form>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5">{children}</main>

        <footer
          className="border-t px-4 py-2 text-xs"
          style={{ color: "var(--texte-doux)", borderColor: "var(--bordure)" }}
        >
          ERP MES — donnees strictement internes. Toute action est journalisee et rattachee a
          l'utilisateur connecte.
        </footer>
      </div>
    </div>
  );
}
