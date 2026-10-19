"use client";

import { useEffect } from "react";

/**
 * Filtre les listes selon la division choisie.
 *
 * Le formulaire de creation d'ordre se remplit dans l'ordre : on choisit la
 * division, puis l'article et les depots. Sans filtre, un responsable ADMEDCO
 * voyait les articles et les depots de MOBILIX, et pouvait composer un ordre
 * incoherent.
 *
 * Les options portent leur usine (`data-factory`). Au changement de division,
 * celles des autres usines sont masquees et desactivees — elles restent dans le
 * document, donc rien n'est perdu si l'on revient en arriere. Aucun aller-retour
 * serveur : la saisie en cours est conservee.
 */
export function FiltreOptionsDivision() {
  useEffect(() => {
    const division = document.querySelector<HTMLSelectElement>('select[name="factory"]');
    if (!division) return;

    const dependants = ["itemId", "sourceWarehouseId", "targetWarehouseId"];

    const filtrer = () => {
      const choix = division.value;
      for (const nom of dependants) {
        const liste = document.querySelector<HTMLSelectElement>(`select[name="${nom}"]`);
        if (!liste) continue;

        for (const option of Array.from(liste.options)) {
          const usine = option.dataset.factory;
          const garder = !usine || !choix || usine === choix || usine === "COMMUN";
          option.hidden = !garder;
          option.disabled = !garder;
        }

        const selection = liste.selectedOptions[0];
        if (selection && selection.disabled) liste.value = "";
      }
    };

    filtrer();
    division.addEventListener("change", filtrer);
    return () => division.removeEventListener("change", filtrer);
  }, []);

  return null;
}
