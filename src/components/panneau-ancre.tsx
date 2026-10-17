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

  /*
   * Le panneau peut vivre dans un bloc replie (`SectionRepliable`).
   *
   * Le lien fait bien apparaitre le formulaire, mais un repli ferme le garde
   * invisible : l'utilisateur clique, l'URL change, et rien ne s'ouvre a
   * l'ecran. On ouvre donc le repli qui contient le panneau, puis on defile
   * jusqu'a lui — le navigateur ne peut pas le faire seul, la cible n'existant
   * qu'apres le rendu.
   */
  useEffect(() => {
    if (!ouvert) return;
    const panneau = document.getElementById(id);
    if (!panneau) return;
    const repli = panneau.closest("details");
    if (repli) repli.open = true;
    panneau.scrollIntoView({ block: "start" });
  }, [ouvert, id]);

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
