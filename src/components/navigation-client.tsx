"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Lien de navigation marquant la page courante.
 * Composant client uniquement parce que l'etat actif depend de l'URL courante ;
 * aucune decision de securite n'est prise ici.
 */
export function LienNavigation({
  chemin,
  libelle,
  description,
}: {
  chemin: string;
  libelle: string;
  description?: string;
}) {
  const cheminCourant = usePathname();
  const actif =
    cheminCourant === chemin || cheminCourant.startsWith(`${chemin}/`);

  return (
    <Link
      href={chemin}
      className="lien-nav block rounded-md px-3 py-2 text-sm"
      aria-current={actif ? "page" : undefined}
      title={description}
    >
      {libelle}
    </Link>
  );
}
