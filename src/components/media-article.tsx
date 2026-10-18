"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { actionDeposerMedia, actionRetirerMedia } from "@/actions/articles-media";

/**
 * Emplacement de piece jointe d'un article : photo du produit ou dessin
 * technique. Le fichier part au serveur avec le formulaire ; l'apercu se met a
 * jour apres revalidation, sans rechargement manuel.
 */
export function MediaArticle({
  itemId,
  type,
  existe,
  nom,
  estPdf = false,
  peutEcrire,
}: {
  itemId: number;
  type: "photo" | "dessin";
  existe: boolean;
  nom?: string | null;
  estPdf?: boolean;
  peutEcrire: boolean;
}) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const formulaire = useRef<HTMLFormElement>(null);

  const titre = type === "photo" ? "Photo du produit" : "Dessin technique";
  const adresse = `/api/articles/${itemId}/media/${type}`;
  const accept = type === "photo" ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp,application/pdf";

  const deposer = (donnees: FormData) => {
    demarrer(async () => {
      const resultat = await actionDeposerMedia(donnees);
      setMessage({ ok: resultat.ok, texte: resultat.message });
      if (resultat.ok) {
        formulaire.current?.reset();
        router.refresh();
      }
    });
  };

  const retirer = () => {
    const donnees = new FormData();
    donnees.set("itemId", String(itemId));
    donnees.set("type", type);
    demarrer(async () => {
      const resultat = await actionRetirerMedia(donnees);
      setMessage({ ok: resultat.ok, texte: resultat.message });
      if (resultat.ok) router.refresh();
    });
  };

  return (
    <div className="rounded-[var(--rayon-petit)] border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{titre}</p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--texte-doux)" }}>
            {type === "photo"
              ? "JPEG, PNG ou WebP — 10 Mo maximum."
              : "JPEG, PNG, WebP ou PDF — 10 Mo maximum."}
          </p>
        </div>
        {existe && peutEcrire && (
          <button
            type="button"
            className="bouton"
            onClick={retirer}
            disabled={enCours}
          >
            Retirer
          </button>
        )}
      </div>

      {existe ? (
        <div className="mt-3">
          {estPdf ? (
            <a
              href={adresse}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium underline"
            >
              Ouvrir le dessin ({nom ?? "PDF"})
            </a>
          ) : (
            <a href={adresse} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={adresse}
                alt={titre}
                className="max-h-56 w-full rounded-[var(--rayon-petit)] object-cover"
                style={{ background: "var(--surface-douce)" }}
              />
            </a>
          )}
          {nom && (
            <p className="mt-2 truncate text-xs" style={{ color: "var(--texte-doux)" }}>
              {nom}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm" style={{ color: "var(--texte-doux)" }}>
          Aucune piece jointe pour cet article.
        </p>
      )}

      {peutEcrire && (
        <form ref={formulaire} action={deposer} className="mt-4 space-y-2">
          <input type="hidden" name="itemId" value={itemId} />
          <input type="hidden" name="type" value={type} />
          <input
            className="champ"
            type="file"
            name="fichier"
            accept={accept}
            required
            disabled={enCours}
          />
          <button type="submit" className="bouton primaire" disabled={enCours}>
            {enCours ? "Envoi en cours..." : existe ? "Remplacer" : "Deposer le fichier"}
          </button>
        </form>
      )}

      {message && (
        <p
          className="mt-3 text-sm"
          style={{ color: message.ok ? "var(--succes)" : "var(--danger)" }}
          role={message.ok ? "status" : "alert"}
        >
          {message.texte}
        </p>
      )}
    </div>
  );
}

/** Apercu compact pour les pages de consultation (nomenclature). */
export function ApercuMedia({
  itemId,
  type,
  existe,
  nom,
  estPdf = false,
}: {
  itemId: number;
  type: "photo" | "dessin";
  existe: boolean;
  nom?: string | null;
  estPdf?: boolean;
}) {
  if (!existe) return null;
  const adresse = `/api/articles/${itemId}/media/${type}`;

  return (
    <a href={adresse} target="_blank" rel="noreferrer" className="block">
      {estPdf ? (
        <span className="flex h-28 items-center justify-center rounded-[var(--rayon-petit)] border text-xs font-medium" style={{ background: "var(--surface-douce)" }}>
          Dessin PDF — ouvrir
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={adresse}
          alt={type === "photo" ? `Photo ${nom ?? ""}` : `Dessin ${nom ?? ""}`}
          className="h-28 w-full rounded-[var(--rayon-petit)] object-cover"
          style={{ background: "var(--surface-douce)" }}
        />
      )}
    </a>
  );
}
