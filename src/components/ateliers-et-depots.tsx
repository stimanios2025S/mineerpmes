"use client";

import { useEffect, useState } from "react";
import type { Factory } from "@prisma/client";
import { Champ } from "./interactif";
import { LIBELLES_USINE, libelle } from "@/lib/libelles";

/**
 * Atelier de rattachement et depot par defaut, BORNES A LA DIVISION CHOISIE.
 *
 * Les deux listes etaient servies telles quelles, avec les ateliers et depots de
 * toutes les usines du perimetre. L'encadrement pouvait donc rattacher un
 * employe ADMEDCO a un atelier MOBILIX, et ne decouvrait le refus qu'a la
 * soumission — une liste qui propose ce qui sera refuse n'est pas une liste.
 *
 * Le composant observe le champ « Division » du formulaire et filtre en direct :
 * changer de division reborne immediatement les deux listes. Aucun aller-retour
 * serveur, donc aucun rechargement et aucune saisie perdue.
 *
 * Le choix initial de la division (vide ou premiere option) est applique des le
 * montage : les listes ne montrent jamais un melange, meme avant le premier clic.
 */
export interface LieuOption {
  id: number;
  code: string;
  label: string;
  factory: Factory;
}

export function AteliersEtDepots({
  ateliers,
  depots,
}: {
  ateliers: LieuOption[];
  depots: LieuOption[];
}) {
  const [usine, setUsine] = useState<Factory | "">("");

  useEffect(() => {
    // Le champ « Division » est rendu ailleurs dans le formulaire, parfois en
    // champ cache quand une seule usine est possible. On l'observe tel quel :
    // le composant n'a pas besoin de savoir comment il est construit.
    const champ = document.querySelector<
      HTMLSelectElement | HTMLInputElement
    >('[name="factory"]');
    if (!champ) return;

    const appliquer = () => setUsine((champ.value as Factory) || "");
    appliquer();
    champ.addEventListener("change", appliquer);
    return () => champ.removeEventListener("change", appliquer);
  }, []);

  const borner = (options: LieuOption[]) =>
    usine ? options.filter((option) => option.factory === usine) : options;

  const ateliersVisibles = borner(ateliers);
  const depotsVisibles = borner(depots);

  return (
    <>
      {usine && (
        <p
          className="sm:col-span-2 lg:col-span-3 text-sm"
          style={{ color: "var(--texte-doux)" }}
        >
          Ateliers et depots de {libelle(LIBELLES_USINE, usine)} uniquement.
        </p>
      )}
      <Champ
        nom="workshopId"
        libelle="Atelier de rattachement"
        type="select"
        options={ateliersVisibles.map((atelier) => ({
          valeur: atelier.id,
          libelle: `${atelier.code} — ${atelier.label}`,
        }))}
        aide={
          ateliersVisibles.length === 0
            ? "Aucun atelier actif dans cette division."
            : undefined
        }
      />
      <Champ
        nom="defaultWarehouseId"
        libelle="Depot par defaut"
        type="select"
        options={depotsVisibles.map((depot) => ({
          valeur: depot.id,
          libelle: `${depot.code} — ${depot.label}`,
        }))}
        aide={
          depotsVisibles.length === 0
            ? "Aucun depot actif dans cette division."
            : undefined
        }
      />
    </>
  );
}
