import Link from "next/link";

/**
 * Page 404, rendue pour une URL inconnue ou une ressource inexistante.
 */
export default function PageIntrouvable() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="carte p-6">
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--info)" }}
          >
            Erreur 404
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Page introuvable</h1>

          <p className="mt-3 text-sm" style={{ color: "var(--texte-doux)" }}>
            Cette adresse ne correspond a aucune page de la plateforme. Le lien est
            peut-etre incomplet, ou la fiche demandee a ete supprimee.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Link className="lien-nav text-sm font-semibold" href="/">
              Revenir a mon espace
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
