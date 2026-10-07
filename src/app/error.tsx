"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Filet de securite des pages de l'application.
 *
 * Avant ce fichier, la moindre erreur serveur affichait la page d'erreur brute
 * de Next.js (« This page couldn't load ») et l'utilisateur ne pouvait rien
 * faire. Ici il reste dans la plateforme, avec une action possible.
 *
 * Next.js masque le message d'erreur en production : le detail complet reste
 * dans logs/erpmes.err.log, a retrouver par le digest affiche ci-dessous.
 *
 * Les refus d'acces prevus (403 / 401 / 404) ne passent PAS par ici : ils sont
 * interceptes en amont par les pages forbidden / unauthorized / not-found.
 */
export default function ErreurApplication({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[erpmes] erreur de page :", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="carte p-6">
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--danger)" }}
          >
            Erreur inattendue
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Cette page n&apos;a pas pu etre chargee
          </h1>

          <p className="mt-3 text-sm" style={{ color: "var(--texte-doux)" }}>
            L&apos;incident a ete journalise sur le serveur. Vous pouvez reessayer ; si le
            probleme persiste, transmettez la reference ci-dessous a
            l&apos;administration.
          </p>

          {error.digest ? (
            <p
              className="mt-3 font-mono text-xs"
              style={{ color: "var(--texte-doux)" }}
            >
              Reference : {error.digest}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={reset}
              className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
            >
              Reessayer
            </button>
            <Link className="lien-nav text-sm" href="/">
              Revenir a mon espace
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
