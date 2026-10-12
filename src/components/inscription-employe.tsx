"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import type { ResultatAction } from "@/lib/actions/resultat";
import type { AccesNouvelEmploye } from "@/lib/rh/inscription";
import { BoutonSoumettre } from "./interactif";

/** Les identifiants restent dans la reponse de creation, jamais en stockage navigateur. */
export function FormulaireInscriptionEmploye({ action, children, libelleSoumettre }: {
  action: (formData: FormData) => Promise<ResultatAction<AccesNouvelEmploye>>;
  children: ReactNode;
  libelleSoumettre: string;
}) {
  const [resultat, setResultat] = useState<ResultatAction<AccesNouvelEmploye> | null>(null);
  const [enCours, demarrer] = useTransition();
  const [copie, setCopie] = useState("");
  const [version, setVersion] = useState(0);

  if (resultat?.ok) {
    const texte = ["Acces " + resultat.factory, resultat.nom, "Matricule : " + resultat.matricule,
    "Identifiant : " + resultat.identifiant, "Mot de passe temporaire : " + resultat.motDePasseTemporaire,
      "Changer le mot de passe a la premiere connexion."].join("\n");
    return (
      <section className="space-y-4" aria-label="Identifiants du nouvel employe">
        <div role="status" className="rounded-lg border p-4" style={{ borderColor: "var(--succes)", background: "var(--succes-clair)" }}>
          <h2 className="text-lg font-semibold">Employe et acces crees</h2>
          <p className="mt-1">{resultat.nom} · {resultat.factory} · Operateur</p>
        </div>
        <dl className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
          <div><dt className="text-sm">Matricule</dt><dd className="font-mono font-semibold">{resultat.matricule}</dd></div>
          <div><dt className="text-sm">Identifiant de connexion</dt><dd className="break-all font-mono font-semibold">{resultat.identifiant}</dd></div>
          <div><dt className="text-sm">Mot de passe temporaire</dt><dd className="font-mono text-lg font-semibold">{resultat.motDePasseTemporaire}</dd></div>
        </dl>
        <p className="text-sm">Remettez ces identifiants a l'employe. Le mot de passe n'est affiche qu'apres cette creation et devra etre change a la premiere connexion. L'identifiant automatique ne necessite pas de boite mail.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="bouton primaire" onClick={async () => {
            try { await navigator.clipboard.writeText(texte); setCopie("Identifiants copies."); }
            catch { setCopie("La copie automatique est indisponible. Selectionnez les identifiants pour les copier."); }
          }}>Copier les identifiants</button>
          <Link className="bouton secondaire" href={"/rh/employes/" + resultat.id}>Ouvrir la fiche</Link>
          <button type="button" className="bouton secondaire" onClick={() => { setResultat(null); setCopie(""); setVersion(version + 1); }}>Ajouter un autre employe</button>
        </div>
        {copie && <p role="status" className="text-sm">{copie}</p>}
      </section>
    );
  }
  return (
    <form key={version} action={(formData) => demarrer(async () => {
      try { setResultat(await action(formData)); }
      catch { setResultat({ ok: false, message: "La creation n'a pas pu etre confirmee. Consultez la liste des employes avant de reessayer." }); }
    })}>
      <fieldset disabled={enCours}>{children}</fieldset>
      {resultat && <div role="alert" className="mt-4 rounded-lg border p-3 text-sm" style={{ color: "var(--danger)" }}>{resultat.message}</div>}
      <div className="mt-5"><BoutonSoumettre enCours={enCours}>{libelleSoumettre}</BoutonSoumettre></div>
    </form>
  );
}
