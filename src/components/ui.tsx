import Link from "next/link";
import type { ReactNode } from "react";
import { tonStatut, type TonEtiquette } from "@/lib/libelles";

/**
 * Bibliotheque d'affichage de la plateforme.
 * Tous les composants sont des composants serveur : ils ne portent aucune
 * logique metier, seulement la mise en forme francaise et l'accessibilite.
 */

const TONS: Record<TonEtiquette, { fond: string; texte: string; bordure: string }> = {
  neutre: { fond: "var(--surface-douce)", texte: "var(--texte-doux)", bordure: "var(--bordure)" },
  succes: { fond: "var(--succes-clair)", texte: "var(--succes)", bordure: "var(--succes)" },
  alerte: { fond: "var(--alerte-clair)", texte: "var(--alerte)", bordure: "var(--alerte)" },
  danger: { fond: "var(--danger-clair)", texte: "var(--danger)", bordure: "var(--danger)" },
  info: { fond: "var(--info-clair)", texte: "var(--info)", bordure: "var(--info)" },
  primaire: {
    fond: "var(--primaire-clair)",
    texte: "var(--primaire-fonce)",
    bordure: "var(--primaire)",
  },
};

export function Etiquette({
  children,
  ton = "neutre",
  titre,
}: {
  children: ReactNode;
  ton?: TonEtiquette;
  titre?: string;
}) {
  const style = TONS[ton];
  return (
    <span
      className="etiquette"
      title={titre}
      style={{ background: style.fond, color: style.texte, borderColor: style.bordure }}
    >
      {children}
    </span>
  );
}

/** Etiquette de statut : le libelle francais est toujours affiche. */
export function EtiquetteStatut({
  libelle,
  code,
}: {
  libelle: string;
  code?: string | null;
}) {
  return <Etiquette ton={tonStatut(code ?? libelle)}>{libelle}</Etiquette>;
}

export function Carte({
  id,
  titre,
  description,
  actions,
  children,
  sansPadding = false,
}: {
  /** Ancre HTML : permet de pointer une section depuis un bouton de la page. */
  id?: string;
  titre?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  sansPadding?: boolean;
}) {
  return (
    <section id={id} className="carte overflow-hidden">
      {(titre || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            {titre && <h2 className="text-base font-semibold">{titre}</h2>}
            {description && (
              <p className="mt-0.5 text-sm" style={{ color: "var(--texte-doux)" }}>
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={sansPadding ? "" : "p-4"}>{children}</div>
    </section>
  );
}

/**
 * Bloc de page repliable.
 *
 * Meme socle visuel que `Carte`, mais refermable. Le titre reste visible une
 * fois le bloc ferme : on sait toujours ce qu'il y a derriere. Le repli
 * s'appuie sur <details>/<summary> natif, donc accessible au clavier et
 * fonctionnel sans JavaScript.
 *
 * Regle d'usage : on replie ce qui se consulte rarement, jamais une information
 * necessaire a l'action en cours. Aucun contenu n'est supprime par un repli.
 */
export function SectionRepliable({
  id,
  titre,
  description,
  ouvertParDefaut = false,
  className,
  children,
}: {
  /** Ancre HTML : permet de pointer le bloc depuis un lien de la page. */
  id?: string;
  titre: ReactNode;
  description?: ReactNode;
  /** Replie par defaut : le bloc ne prend la place que si on l'ouvre. */
  ouvertParDefaut?: boolean;
  /** Espacement exterieur, laisse au contexte d'appel. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <details
      id={id}
      className={className ? `carte repli ${className}` : "carte repli"}
      open={ouvertParDefaut}
    >
      <summary>
        <span className="font-semibold">{titre}</span>
        <span className="chevron" aria-hidden="true" />
      </summary>
      <div className="p-4">
        {description && (
          <p className="mb-4 text-sm" style={{ color: "var(--texte-doux)" }}>
            {description}
          </p>
        )}
        {children}
      </div>
    </details>
  );
}


export function EnTetePage({
  titre,
  description,
  actions,
}: {
  titre: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{titre}</h1>
        {description && (
          <p className="mt-1 max-w-3xl text-sm" style={{ color: "var(--texte-doux)" }}>
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Teintes pastel des cartes de statistique.
 *
 * Le ton reste semantique (succes, alerte, danger) : il choisit la teinte de
 * fond et la pastille. La valeur reste en encre foncee, seule la couleur de la
 * pastille porte le sens — un grand nombre colore se lit mal.
 */
const PASTELS: Record<TonEtiquette, { fond: string; accent: string }> = {
  neutre: { fond: "var(--surface)", accent: "var(--texte-doux)" },
  primaire: { fond: "var(--orange-clair)", accent: "var(--orange)" },
  succes: { fond: "var(--menthe-clair)", accent: "var(--menthe)" },
  info: { fond: "var(--menthe-clair)", accent: "var(--menthe)" },
  alerte: { fond: "var(--orange-clair)", accent: "var(--alerte)" },
  danger: { fond: "var(--danger-clair)", accent: "var(--danger)" },
};

export function Statistique({
  libelle,
  valeur,
  detail,
  ton = "neutre",
  href,
}: {
  libelle: string;
  valeur: ReactNode;
  detail?: ReactNode;
  ton?: TonEtiquette;
  href?: string;
}) {
  const pastel = PASTELS[ton];
  const contenu = (
    <div className="carte h-full p-5" style={{ background: pastel.fond }}>
      <p
        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide"
        style={{ color: "var(--texte-doux)" }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: 999,
            background: pastel.accent,
            flex: "none",
          }}
        />
        {libelle}
      </p>
      <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">
        {valeur}
      </p>
      {detail && (
        <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
          {detail}
        </p>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block rounded-[20px] transition-opacity hover:opacity-90">
        {contenu}
      </Link>
    );
  }
  return contenu;
}

export function Alerte({
  ton = "info",
  titre,
  children,
}: {
  ton?: TonEtiquette;
  titre?: string;
  children: ReactNode;
}) {
  const style = TONS[ton];
  return (
    <div
      role={ton === "danger" ? "alert" : "status"}
      className="rounded-lg border p-3 text-sm"
      style={{ background: style.fond, borderColor: style.bordure, color: style.texte }}
    >
      {titre && <p className="mb-1 font-semibold">{titre}</p>}
      <div>{children}</div>
    </div>
  );
}

export function Vide({
  titre = "Aucun resultat",
  message,
  action,
}: {
  titre?: string;
  message?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <p className="font-semibold">{titre}</p>
      {message && (
        <p className="max-w-lg text-sm" style={{ color: "var(--texte-doux)" }}>
          {message}
        </p>
      )}
      {action}
    </div>
  );
}

export function Tableau({
  colonnes,
  lignes,
  cleLigne,
  chargement,
  messageVide,
}: {
  colonnes: { cle: string; libelle: string; nombre?: boolean; largeur?: string }[];
  lignes: { cle: string; cellules: ReactNode[] }[];
  cleLigne?: (index: number) => string;
  chargement?: boolean;
  messageVide?: ReactNode;
}) {
  if (!chargement && lignes.length === 0) {
    return <Vide message={messageVide} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="donnees">
        <thead>
          <tr>
            {colonnes.map((colonne) => (
              <th
                key={colonne.cle}
                className={colonne.nombre ? "nombre" : undefined}
                style={colonne.largeur ? { width: colonne.largeur } : undefined}
              >
                {colonne.libelle}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((ligne, index) => (
            <tr key={cleLigne ? cleLigne(index) : ligne.cle}>
              {ligne.cellules.map((cellule, indexCellule) => (
                <td
                  key={`${ligne.cle}-${colonnes[indexCellule]?.cle ?? indexCellule}`}
                  className={colonnes[indexCellule]?.nombre ? "nombre" : undefined}
                >
                  {cellule}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  pages,
  total,
  construireLien,
}: {
  page: number;
  pages: number;
  total: number;
  construireLien: (page: number) => string;
}) {
  if (pages <= 1) {
    return (
      <p className="px-4 py-2 text-xs" style={{ color: "var(--texte-doux)" }}>
        {total} ligne{total > 1 ? "s" : ""}
      </p>
    );
  }

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-sm"
      aria-label="Pagination"
    >
      <span style={{ color: "var(--texte-doux)" }}>
        Page {page} sur {pages} — {total} ligne{total > 1 ? "s" : ""}
      </span>
      <span className="flex items-center gap-2">
        {page > 1 ? (
          <Link className="lien-nav" href={construireLien(page - 1)}>
            Precedent
          </Link>
        ) : null}
        {page < pages ? (
          <Link className="lien-nav" href={construireLien(page + 1)}>
            Suivant
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

export function ListeDefinitions({
  elements,
}: {
  elements: { terme: string; valeur: ReactNode }[];
}) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {elements.map((element) => (
        <div key={element.terme}>
          <dt className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--texte-doux)" }}>
            {element.terme}
          </dt>
          <dd className="mt-0.5 text-sm">{element.valeur}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Titre de section interne a une page. */
export function Section({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <div className="mt-6">
      <h2 className="mb-3 text-lg font-semibold">{titre}</h2>
      {children}
    </div>
  );
}
