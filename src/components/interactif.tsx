"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import type { ResultatAction } from "@/lib/actions/resultat";

/**
 * Composants interactifs communs.
 *
 * Regle de conception : toute action sensible passe par un formulaire explicite
 * et affiche le message renvoye par le serveur. L'interface ne decide jamais
 * elle-meme si une operation est autorisee : elle affiche la reponse du serveur.
 */

function Message({ resultat }: { resultat: ResultatAction | null }) {
  if (!resultat) return null;

  const ton = resultat.ok ? "succes" : "danger";
  const variables =
    ton === "succes"
      ? { fond: "var(--succes-clair)", bordure: "var(--succes)", texte: "var(--succes)" }
      : { fond: "var(--danger-clair)", bordure: "var(--danger)", texte: "var(--danger)" };

  return (
    <div
      role={resultat.ok ? "status" : "alert"}
      className="rounded-lg border p-3 text-sm"
      style={{ background: variables.fond, borderColor: variables.bordure, color: variables.texte }}
    >
      <p>{resultat.message}</p>
      {!resultat.ok && resultat.champs && Object.keys(resultat.champs).length > 0 && (
        <ul className="mt-2 list-disc pl-5">
          {Object.entries(resultat.champs).map(([champ, message]) => (
            <li key={champ}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BoutonSoumettre({
  children,
  enCours,
  variante = "primaire",
  titre,
}: {
  children: ReactNode;
  enCours?: boolean;
  variante?: "primaire" | "secondaire" | "danger";
  titre?: string;
}) {
  const styles: Record<string, { fond: string; texte: string; bordure: string }> = {
    primaire: { fond: "var(--primaire)", texte: "#ffffff", bordure: "var(--primaire)" },
    secondaire: { fond: "var(--surface)", texte: "var(--texte)", bordure: "var(--bordure-forte)" },
    danger: { fond: "var(--danger)", texte: "#ffffff", bordure: "var(--danger)" },
  };
  const style = styles[variante];

  return (
    <button
      type="submit"
      disabled={enCours}
      title={titre}
      className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold disabled:opacity-60"
      style={{ background: style.fond, color: style.texte, borderColor: style.bordure }}
    >
      {enCours ? "Traitement en cours..." : children}
    </button>
  );
}

/**
 * Formulaire relie a une action serveur, avec etat d'attente et message clair.
 * Le rafraichissement des donnees serveur est automatique apres succes, afin
 * que l'affichage reste toujours le reflet de la base.
 */
export function FormulaireAction({
  action,
  children,
  libelleSoumettre,
  varianteSoumettre = "primaire",
  rafraichir = true,
  reinitialiser = false,
  className,
  discret = false,
}: {
  action: (formData: FormData) => Promise<ResultatAction>;
  children?: ReactNode;
  libelleSoumettre: string;
  varianteSoumettre?: "primaire" | "secondaire" | "danger";
  rafraichir?: boolean;
  reinitialiser?: boolean;
  className?: string;
  discret?: boolean;
}) {
  const router = useRouter();
  const [resultat, setResultat] = useState<ResultatAction | null>(null);
  const [enCours, demarrer] = useTransition();

  return (
    <form
      className={className}
      action={(formData: FormData) => {
        demarrer(async () => {
          const reponse = await action(formData);
          setResultat(reponse);
          if (reponse.ok) {
            if (rafraichir) router.refresh();
            if (reinitialiser) {
              const formulaire = document.activeElement?.closest("form");
              if (formulaire instanceof HTMLFormElement) formulaire.reset();
            }
          }
        });
      }}
    >
      {children}
      <div className={discret ? "mt-2" : "mt-4 flex flex-wrap items-center gap-3"}>
        <BoutonSoumettre enCours={enCours} variante={varianteSoumettre}>
          {libelleSoumettre}
        </BoutonSoumettre>
        {!discret && resultat && (
          <div className="min-w-[16rem] flex-1">
            <Message resultat={resultat} />
          </div>
        )}
      </div>
      {discret && resultat && (
        <div className="mt-2">
          <Message resultat={resultat} />
        </div>
      )}
    </form>
  );
}

/**
 * Bouton declenchant une action serveur sans saisie (confirmer, approuver,
 * expedier...). Une confirmation navigateur est demandee lorsque l'action est
 * irreversible.
 */
export function BoutonAction({
  action,
  libelle,
  variante = "secondaire",
  confirmation,
  champsCaches,
  titre,
}: {
  action: (formData: FormData) => Promise<ResultatAction>;
  libelle: string;
  variante?: "primaire" | "secondaire" | "danger";
  confirmation?: string;
  champsCaches?: Record<string, string | number>;
  titre?: string;
}) {
  const router = useRouter();
  const [resultat, setResultat] = useState<ResultatAction | null>(null);
  const [enCours, demarrer] = useTransition();

  return (
    <form
      className="inline-flex flex-col gap-1"
      action={(formData: FormData) => {
        if (confirmation && !window.confirm(confirmation)) return;
        demarrer(async () => {
          const reponse = await action(formData);
          setResultat(reponse);
          if (reponse.ok) router.refresh();
        });
      }}
    >
      {champsCaches &&
        Object.entries(champsCaches).map(([nom, valeur]) => (
          <input key={nom} type="hidden" name={nom} value={String(valeur)} />
        ))}
      <BoutonSoumettre enCours={enCours} variante={variante} titre={titre}>
        {libelle}
      </BoutonSoumettre>
      {resultat && !resultat.ok && (
        <span className="text-xs" style={{ color: "var(--danger)" }}>
          {resultat.message}
        </span>
      )}
    </form>
  );
}

/**
 * Action sensible : la justification ecrite est exigee par le formulaire et
 * verifiee de nouveau cote serveur.
 */
export function FormulaireMotif({
  action,
  libelleSoumettre,
  libelleMotif,
  champsCaches,
  varianteSoumettre = "secondaire",
  motifMinimum = 10,
  placeholder,
}: {
  action: (formData: FormData) => Promise<ResultatAction>;
  libelleSoumettre: string;
  libelleMotif: string;
  champsCaches?: Record<string, string | number>;
  varianteSoumettre?: "primaire" | "secondaire" | "danger";
  motifMinimum?: number;
  placeholder?: string;
}) {
  return (
    <FormulaireAction
      action={action}
      libelleSoumettre={libelleSoumettre}
      varianteSoumettre={varianteSoumettre}
      reinitialiser
    >
      {champsCaches &&
        Object.entries(champsCaches).map(([nom, valeur]) => (
          <input key={nom} type="hidden" name={nom} value={String(valeur)} />
        ))}
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{libelleMotif}</span>
        <textarea
          className="champ"
          name="motif"
          rows={3}
          required
          minLength={motifMinimum}
          placeholder={placeholder ?? `Motif obligatoire (au moins ${motifMinimum} caracteres)`}
        />
      </label>
    </FormulaireAction>
  );
}

/** Champ de saisie avec libelle, unite et message d'aide. */
export function Champ({
  nom,
  libelle,
  type = "text",
  requis = false,
  valeur,
  aide,
  pas,
  min,
  max,
  maxLength,
  options,
  plusieurs = false,
}: {
  nom: string;
  libelle: string;
  type?: "text" | "number" | "date" | "time" | "email" | "password" | "search" | "hidden" | "textarea" | "select";
  requis?: boolean;
  valeur?: string | number | (string | number)[] | null;
  aide?: string;
  pas?: string;
  min?: string | number;
  max?: string | number;
  maxLength?: number;
  options?: { valeur: string | number; libelle: string }[];
  plusieurs?: boolean;
}) {
  const valeurTexte = Array.isArray(valeur) ? valeur.map(String).join(",") : (valeur ?? "");

  if (type === "hidden") {
    return <input type="hidden" name={nom} defaultValue={valeurTexte} />;
  }

  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">
        {libelle}
        {requis && <span style={{ color: "var(--danger)" }}> *</span>}
      </span>

      {type === "textarea" ? (
        <textarea
          className="champ"
          name={nom}
          rows={3}
          required={requis}
          maxLength={maxLength}
          defaultValue={valeurTexte}
        />
      ) : type === "select" ? (
        <select
          className="champ"
          name={nom}
          required={requis}
          multiple={plusieurs}
          defaultValue={
            plusieurs
              ? Array.isArray(valeur)
                ? valeur.map(String)
                : valeur === null || valeur === undefined || valeur === ""
                  ? []
                  : [String(valeur)]
              : ((valeur as string | number | null | undefined) ?? "")
          }
        >
          {!plusieurs && <option value="">— Selectionner —</option>}
          {(options ?? []).map((option) => (
            <option key={String(option.valeur)} value={String(option.valeur)}>
              {option.libelle}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="champ"
          type={type}
          name={nom}
          required={requis}
          step={pas}
          min={min}
          max={max}
          maxLength={maxLength}
          defaultValue={valeurTexte}
          inputMode={type === "number" ? "decimal" : undefined}
        />
      )}

      {aide && (
        <span className="mt-1 block text-xs" style={{ color: "var(--texte-doux)" }}>
          {aide}
        </span>
      )}
    </label>
  );
}
