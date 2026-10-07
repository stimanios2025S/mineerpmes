import Link from "next/link";

/**
 * Page 403, rendue lorsque `forbidden()` est appele par une garde serveur.
 *
 * Cas typique : un profil authentifie ouvre une URL hors de son perimetre
 * (un proprietaire d'usine sur une page de validation, par exemple). Avant
 * l'ajout de ce fichier, ce refus legitime affichait la page d'erreur brute
 * de Next.js, illisible pour l'utilisateur.
 */
export default function PageAccesRefuse() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="carte p-6">
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--danger)" }}
          >
            Erreur 403
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Acces refuse</h1>

          <p className="mt-3 text-sm" style={{ color: "var(--texte-doux)" }}>
            Votre profil ne vous autorise pas a ouvrir cette page. La demande a ete
            refusee par le serveur : aucune donnee n&apos;a ete affichee ni modifiee.
          </p>
          <p className="mt-3 text-sm" style={{ color: "var(--texte-doux)" }}>
            Si cette page fait partie de votre travail, demandez a l&apos;administration de
            verifier les permissions et l&apos;usine rattachees a votre compte.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Link className="lien-nav text-sm font-semibold" href="/">
              Revenir a mon espace
            </Link>
            <Link className="lien-nav text-sm" href="/mon-compte">
              Mon compte
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
