import Link from "next/link";

/**
 * Page 401, rendue lorsque `unauthorized()` est appele par une garde serveur.
 *
 * Cas typique : session expiree ou cookie de session invalide, sur une route
 * qui ne passe pas par la coquille connectee (qui, elle, redirige vers
 * /connexion).
 */
export default function PageNonAutorise() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="carte p-6">
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--alerte)" }}
          >
            Erreur 401
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Session expiree
          </h1>

          <p className="mt-3 text-sm" style={{ color: "var(--texte-doux)" }}>
            Votre session n&apos;est plus valide. Reconnectez-vous pour continuer : aucune
            donnee n&apos;a ete affichee ni modifiee.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Link className="lien-nav text-sm font-semibold" href="/connexion">
              Se reconnecter
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
