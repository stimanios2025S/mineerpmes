"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Panneau revele par une ancre.
 *
 * Le contenu n'est pas rendu tant que l'URL ne pointe pas sur `id`. Les boutons
 * « Modifier » de la fiche article sont de simples liens vers `#modification-fiche` :
 * cliquer l'un d'eux fait apparaitre le formulaire, et le navigateur defile
 * jusqu'a lui. Aucun etat partage n'est necessaire entre les sections et le
 * panneau, et les liens restent de vrais liens.
 */
export function PanneauAncre({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const [ouvert, setOuvert] = useState(false);

  useEffect(() => {
    const maj = () => setOuvert(window.location.hash === `#${id}`);
    maj();
    window.addEventListener("hashchange", maj);
    return () => window.removeEventListener("hashchange", maj);
  }, [id]);

  if (!ouvert) {
    return (
      <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
        Le formulaire de modification s&apos;ouvre en cliquant sur « Modifier » dans
        l&apos;une des sections ci-dessus, ou sur « Modifier la fiche » en haut de page.
      </p>
    );
  }

  return <div id={id}>{children}</div>;
}
