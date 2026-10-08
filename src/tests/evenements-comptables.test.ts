/**
 * Garde-fou sur les codes d'evenement comptable.
 *
 * Deux derives sont possibles et silencieuses, donc testees ici :
 *
 *  1. un code litteral ecrit quelque part qui n'existe pas dans la constante
 *     (faute de frappe, renommage partiel) : la regle semee ne se declenche
 *     jamais et personne ne s'en apercoit ;
 *  2. un code declare dans la constante qu'aucun code metier ne declenche :
 *     c'est l'etat des trois evenements `aBrancher`, et la liste doit rester
 *     exacte. Ajouter une regle au seed sans la brancher fera echouer ce test.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  TOUS_LES_EVENEMENTS,
  evenementsNonBranches,
  type EvenementComptable,
} from "@/lib/comptabilite/evenements";

const RACINE = resolve(__dirname, "..");
const DOSSIERS = [join(RACINE, "lib"), join(RACINE, "actions")];

/** Tous les .ts sous les dossiers surveilles, sauf les tests. */
function fichiersSources(): string[] {
  const resultats: string[] = [];

  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier)) {
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) {
        parcourir(chemin);
        continue;
      }
      if (!chemin.endsWith(".ts") || chemin.includes(".test.")) continue;
      resultats.push(chemin);
    }
  };

  for (const dossier of DOSSIERS) parcourir(dossier);
  return resultats;
}

/** Le module de constantes est la reference : il ne se cite pas lui-meme. */
const MODULE_CONSTANTES = join(RACINE, "lib", "comptabilite", "evenements.ts");

function contenuSurveille(): string {
  return fichiersSources()
    .filter((chemin) => chemin !== MODULE_CONSTANTES)
    .map((chemin) => readFileSync(chemin, "utf8"))
    .join("\n");
}

describe("Codes d'evenement comptable", () => {
  it("le module de constantes est la source unique", () => {
    expect(TOUS_LES_EVENEMENTS.length).toBeGreaterThan(0);
    // Aucun doublon : les valeurs doivent etre uniques.
    expect(new Set(TOUS_LES_EVENEMENTS).size).toBe(TOUS_LES_EVENEMENTS.length);
  });

  it("chaque eventCode litteral du code correspond a une constante connue", () => {
    const contenu = contenuSurveille();

    // Preuve que le balayage lit bien du code reel : sans ce temoin, une erreur
    // de chemin rendrait le test vacu et vert a tort. On ne peut PAS exiger la
    // presence de litteraux : une fois le cablage termine, il n'en reste aucun,
    // et c'est le resultat souhaite.
    expect(contenu).toContain("EVENEMENTS_COMPTABLES.FACTURE_CLIENT");
    expect(fichiersSources().length).toBeGreaterThan(20);

    const litteraux = [...contenu.matchAll(/eventCode:\s*"([A-Za-z_]+)"/g)].map(
      (correspondance) => correspondance[1],
    );

    const inconnus = litteraux.filter(
      (code) => !(TOUS_LES_EVENEMENTS as string[]).includes(code),
    );

    expect(inconnus).toEqual([]);
  });

  it("la liste des evenements a brancher correspond exactement a la realite du code", () => {
    const contenu = contenuSurveille();

    // Un evenement est considere branche des qu'il est cite quelque part dans le
    // code metier : soit par la constante (EVENEMENTS_COMPTABLES.CODE), ce qui
    // est la forme attendue, soit par la chaine litterale, ce qui reste tolere
    // dans le seed et les tables de correspondance.
    const branches = TOUS_LES_EVENEMENTS.filter(
      (code) =>
        contenu.includes(`"${code}"`) ||
        contenu.includes(`EVENEMENTS_COMPTABLES.${code}`),
    );

    const nonBranches = TOUS_LES_EVENEMENTS.filter(
      (code) => !branches.includes(code),
    );

    expect(new Set(nonBranches)).toEqual(new Set(evenementsNonBranches()));

    // Garde-fou de lecture : les trois evenements attendus non branches.
    // Si un evenement est branche, mettre a jour sa definition (`aBrancher`).
    const attendus: EvenementComptable[] = [
      "RECEPTION_FOURNISSEUR",
      "PRODUCTION_PRODUIT_FINI",
      "CONSOMMATION_PRODUCTION",
    ];
    expect(new Set(nonBranches)).toEqual(new Set(attendus));
  });
});
