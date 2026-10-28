"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ResultatAction } from "@/lib/actions/resultat";
import { actionCreerProduit, actionCreerFamilleProduit } from "@/actions/produit";

/**
 * Creation d'un produit en trois etapes.
 *
 * 1. les matieres premieres, avec leur quantite ;
 * 2. les operations, dans l'ordre ou le produit les traverse ;
 * 3. l'identite : code, nom, famille, photo, dessin technique.
 *
 * Rien n'est perdu en cours de route : la saisie est memorisee, y compris si
 * l'envoi echoue ou si la page est rechargee. Refaire une etape ne fait jamais
 * retaper ce qui a deja ete rempli.
 */

export interface OptionMatiere {
  id: number;
  code: string;
  label: string;
  unitCode: string | null;
  factory: string;
}

export interface OptionOperation {
  id: number;
  code: string;
  label: string;
  workshop: string | null;
  factory: string;
}

export interface OptionFamille {
  id: number;
  code: string;
  label: string;
}

interface EtatSauve {
  division: string;
  lignes: { id: number; quantite: string }[];
  choisies: number[];
  code: string;
  libelle: string;
  familleId: string;
}

const CLE = "nomenclature-brouillon";
const ETAPES = ["Matieres premieres", "Operations", "Produit"] as const;

export function AssistantNomenclature({
  divisions,
  divisionImposee,
  matieres,
  operations,
  familles,
}: {
  divisions: { code: string; libelle: string }[];
  divisionImposee: string | null;
  matieres: OptionMatiere[];
  operations: OptionOperation[];
  familles: OptionFamille[];
}) {
  const [etape, setEtape] = useState(0);
  const [division, setDivision] = useState(divisionImposee ?? divisions[0]?.code ?? "ADMEDCO");
  const [recherche, setRecherche] = useState("");
  const [lignes, setLignes] = useState<{ id: number; quantite: string }[]>([]);
  const [choisies, setChoisies] = useState<number[]>([]);
  const [code, setCode] = useState("");
  const [libelle, setLibelle] = useState("");
  const [familleId, setFamilleId] = useState("");
  const [famillesLocales, setFamillesLocales] = useState<OptionFamille[]>(familles);
  const [nouvelleFamille, setNouvelleFamille] = useState("");
  const [erreurFamille, setErreurFamille] = useState<string | null>(null);
  const [resultat, setResultat] = useState<ResultatAction | null>(null);
  const [enCours, demarrer] = useTransition();
  const [pret, setPret] = useState(false);

  // Restauration : la saisie survit a un rechargement ou a un retour arriere.
  useEffect(() => {
    try {
      const brut = window.sessionStorage.getItem(CLE);
      if (brut) {
        const etat = JSON.parse(brut) as EtatSauve;
        if (etat.division) setDivision(etat.division);
        if (Array.isArray(etat.lignes)) setLignes(etat.lignes);
        if (Array.isArray(etat.choisies)) setChoisies(etat.choisies);
        if (etat.code) setCode(etat.code);
        if (etat.libelle) setLibelle(etat.libelle);
        if (etat.familleId) setFamilleId(etat.familleId);
      }
    } catch {
      /* stockage indisponible : on repart d'un formulaire vide */
    }
    setPret(true);
  }, []);

  useEffect(() => {
    if (!pret) return;
    const etat: EtatSauve = { division, lignes, choisies, code, libelle, familleId };
    try {
      window.sessionStorage.setItem(CLE, JSON.stringify(etat));
    } catch {
      /* stockage indisponible : sans consequence sur la saisie en cours */
    }
  }, [pret, division, lignes, choisies, code, libelle, familleId]);

  const matieresFiltrees = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    return matieres
      .filter((m) => m.factory === division || m.factory === "COMMUN")
      .filter(
        (m) =>
          terme === "" ||
          m.code.toLowerCase().includes(terme) ||
          m.label.toLowerCase().includes(terme),
      )
      .slice(0, 40);
  }, [matieres, division, recherche]);

  const operationsDisponibles = useMemo(
    () => operations.filter((o) => o.factory === division || o.factory === "COMMUN"),
    [operations, division],
  );

  const nommer = (id: number) =>
    matieres.find((m) => m.id === id) ?? {
      id,
      code: String(id),
      label: "?",
      unitCode: null,
      factory: "",
    };

  const nommerOperation = (id: number) =>
    operations.find((o) => o.id === id) ?? {
      id,
      code: String(id),
      label: "?",
      workshop: null,
      factory: "",
    };

  const creerFamille = () => {
    const nom = nouvelleFamille.trim();
    if (nom === "") return;
    const donnees = new FormData();
    donnees.set("libelle", nom);
    demarrer(async () => {
      const reponse = await actionCreerFamilleProduit(donnees);
      if (reponse.ok) {
        const id = String((reponse as unknown as { familleId: number }).familleId);
        setFamillesLocales((actuel) => [
          ...actuel,
          { id: Number(id), code: "", label: nom },
        ]);
        setFamilleId(id);
        setNouvelleFamille("");
        setErreurFamille(null);
      } else {
        setErreurFamille(reponse.message);
      }
    });
  };

  const soumettre = (evenement: React.FormEvent<HTMLFormElement>) => {
    evenement.preventDefault();
    const donnees = new FormData(evenement.currentTarget);
    // La division est transmise sous le nom attendu par le serveur.
    donnees.set("division", division);
    donnees.set("familleId", familleId);

    demarrer(async () => {
      const reponse = await actionCreerProduit(donnees);
      setResultat(reponse);
      if (reponse.ok) {
        try {
          window.sessionStorage.removeItem(CLE);
        } catch {
          /* sans consequence */
        }
        setLignes([]);
        setChoisies([]);
        setCode("");
        setLibelle("");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  };

  return (
    <div>
      <ol className="mb-5 flex flex-wrap gap-2">
        {ETAPES.map((titre, index) => (
          <li key={titre}>
            <button
              type="button"
              onClick={() => index < etape && setEtape(index)}
              className="bouton"
              style={{
                background: index === etape ? "var(--accent)" : "var(--surface)",
                borderColor: index === etape ? "var(--accent)" : "var(--bordure-forte)",
                cursor: index < etape ? "pointer" : "default",
              }}
            >
              {index + 1}. {titre}
            </button>
          </li>
        ))}
      </ol>

      {resultat && (
        <p
          className="mb-4 rounded-[var(--rayon-petit)] border p-3 text-sm"
          style={{
            color: resultat.ok ? "var(--succes)" : "var(--danger)",
            borderColor: resultat.ok ? "var(--succes)" : "var(--danger)",
            background: resultat.ok ? "var(--succes-clair)" : "var(--danger-clair)",
          }}
          role={resultat.ok ? "status" : "alert"}
        >
          {resultat.message}
        </p>
      )}

      <form onSubmit={soumettre}>
        {lignes.map((ligne) => (
          <input key={ligne.id} type="hidden" name="composant" value={ligne.id} />
        ))}
        {lignes.map((ligne) => (
          <input
            key={`q${ligne.id}`}
            type="hidden"
            name={`qte_${ligne.id}`}
            value={ligne.quantite}
          />
        ))}
        {choisies.map((id) => (
          <input key={id} type="hidden" name="etape" value={id} />
        ))}

        {divisions.length > 1 && (
          <div className="mb-4 max-w-xs">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Division</span>
              <select
                className="champ"
                value={division}
                onChange={(evenement) => {
                  setDivision(evenement.target.value);
                  setLignes([]);
                  setChoisies([]);
                }}
              >
                {divisions.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.libelle}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {/* ---------------- Etape 1 : matieres premieres ---------------- */}
        {etape === 0 && (
          <div>
            <p className="mb-3 text-sm" style={{ color: "var(--texte-doux)" }}>
              Choisissez ce que le produit consomme. Tapez une lettre pour filtrer.
            </p>

            <input
              className="champ"
              type="search"
              placeholder="Rechercher une matiere : code ou nom..."
              value={recherche}
              onChange={(evenement) => setRecherche(evenement.target.value)}
            />

            {recherche !== "" && (
              <ul className="mt-2 max-h-64 overflow-y-auto rounded-[var(--rayon-petit)] border">
                {matieresFiltrees.length === 0 ? (
                  <li className="p-3 text-sm" style={{ color: "var(--texte-doux)" }}>
                    Aucune matiere ne correspond.
                  </li>
                ) : (
                  matieresFiltrees.map((matiere) => (
                    <li key={matiere.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-douce)]"
                        onClick={() => {
                          setLignes((actuel) =>
                            actuel.some((l) => l.id === matiere.id)
                              ? actuel
                              : [...actuel, { id: matiere.id, quantite: "1" }],
                          );
                          setRecherche("");
                        }}
                      >
                        <span className="font-mono">{matiere.code}</span> — {matiere.label}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}

            <div className="mt-4 space-y-2">
              {lignes.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                  Aucune matiere selectionnee pour l&apos;instant.
                </p>
              ) : (
                lignes.map((ligne) => {
                  const matiere = nommer(ligne.id);
                  return (
                    <div
                      key={ligne.id}
                      className="flex flex-wrap items-center gap-3 rounded-[var(--rayon-petit)] border p-3"
                    >
                      <span className="flex-1 text-sm">
                        <span className="font-mono">{matiere.code}</span> — {matiere.label}
                      </span>
                      <label className="flex items-center gap-2 text-sm">
                        Quantite
                        <input
                          className="champ w-24"
                          type="number"
                          min="0"
                          step="0.000001"
                          value={ligne.quantite}
                          onChange={(evenement) =>
                            setLignes((actuel) =>
                              actuel.map((l) =>
                                l.id === ligne.id
                                  ? { ...l, quantite: evenement.target.value }
                                  : l,
                              ),
                            )
                          }
                        />
                        <span style={{ color: "var(--texte-doux)" }}>
                          {matiere.unitCode ?? ""}
                        </span>
                      </label>
                      <button
                        type="button"
                        className="bouton"
                        onClick={() =>
                          setLignes((actuel) => actuel.filter((l) => l.id !== ligne.id))
                        }
                      >
                        Retirer
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ---------------- Etape 2 : operations ---------------- */}
        {etape === 1 && (
          <div>
            <p className="mb-3 text-sm" style={{ color: "var(--texte-doux)" }}>
              Cliquez les operations dans l&apos;ordre ou le produit les traverse.
              Le premier clic est la premiere operation.
            </p>

            <div className="mb-4 space-y-2">
              {choisies.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                  Aucune operation selectionnee.
                </p>
              ) : (
                choisies.map((id, index) => {
                  const operation = nommerOperation(id);
                  return (
                    <div
                      key={id}
                      className="flex flex-wrap items-center gap-3 rounded-[var(--rayon-petit)] border p-3"
                    >
                      <span className="font-mono text-sm">{index + 1}.</span>
                      <span className="flex-1 text-sm">
                        {operation.code} — {operation.label}
                        <span className="ml-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                          {operation.workshop ?? ""}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="bouton"
                        onClick={() =>
                          setChoisies((actuel) => {
                            const cible = index - 1;
                            if (cible < 0) return actuel;
                            const copie = [...actuel];
                            [copie[index], copie[cible]] = [copie[cible], copie[index]];
                            return copie;
                          })
                        }
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="bouton"
                        onClick={() =>
                          setChoisies((actuel) => {
                            const cible = index + 1;
                            if (cible >= actuel.length) return actuel;
                            const copie = [...actuel];
                            [copie[index], copie[cible]] = [copie[cible], copie[index]];
                            return copie;
                          })
                        }
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="bouton"
                        onClick={() =>
                          setChoisies((actuel) => actuel.filter((x) => x !== id))
                        }
                      >
                        Retirer
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {operationsDisponibles.map((operation) => {
                const pris = choisies.includes(operation.id);
                return (
                  <button
                    key={operation.id}
                    type="button"
                    onClick={() =>
                      setChoisies((actuel) =>
                        actuel.includes(operation.id)
                          ? actuel.filter((x) => x !== operation.id)
                          : [...actuel, operation.id],
                      )
                    }
                    className="rounded-[var(--rayon-petit)] border p-3 text-left text-sm"
                    style={{
                      background: pris ? "var(--accent)" : "var(--surface)",
                      borderColor: pris ? "var(--accent)" : "var(--bordure-forte)",
                    }}
                  >
                    <span className="font-mono">{operation.code}</span> — {operation.label}
                    <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                      {operation.workshop ?? ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ---------------- Etape 3 : produit ---------------- */}
        {etape === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Code produit *</span>
              <input
                className="champ"
                name="code"
                required
                maxLength={40}
                value={code}
                onChange={(evenement) => setCode(evenement.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Nom du produit *</span>
              <input
                className="champ"
                name="libelle"
                required
                maxLength={200}
                value={libelle}
                onChange={(evenement) => setLibelle(evenement.target.value)}
              />
            </label>

            <div className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Famille de produits</span>
              <select
                className="champ"
                value={familleId}
                onChange={(evenement) => setFamilleId(evenement.target.value)}
              >
                <option value="">— Aucune —</option>
                {famillesLocales.map((famille) => (
                  <option key={famille.id} value={famille.id}>
                    {famille.label}
                  </option>
                ))}
              </select>

              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="flex-1 text-sm">
                  <span className="mb-1 block" style={{ color: "var(--texte-doux)" }}>
                    La famille n&apos;existe pas encore ? Donnez-lui un nom.
                  </span>
                  <input
                    className="champ"
                    placeholder="Nouvelle famille : table, etagere..."
                    value={nouvelleFamille}
                    onChange={(evenement) => setNouvelleFamille(evenement.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="bouton"
                  disabled={enCours || nouvelleFamille.trim() === ""}
                  onClick={creerFamille}
                >
                  Creer et selectionner
                </button>
              </div>
              {erreurFamille && (
                <p className="mt-1 text-xs" style={{ color: "var(--danger)" }}>
                  {erreurFamille}
                </p>
              )}
            </div>

            <label className="block text-sm">
              <span className="mb-1 block font-medium">Photo du produit</span>
              <input
                className="champ"
                type="file"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Dessin technique</span>
              <input
                className="champ"
                type="file"
                name="dessin"
                accept="image/jpeg,image/png,image/webp,application/pdf"
              />
              <span className="mt-1 block text-xs" style={{ color: "var(--texte-doux)" }}>
                Sera affiche a l&apos;ouvrier sur chaque operation : montage, centrage, percage.
              </span>
            </label>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {etape > 0 && (
            <button type="button" className="bouton" onClick={() => setEtape(etape - 1)}>
              Retour
            </button>
          )}
          {etape < 2 ? (
            <button
              type="button"
              className="bouton primaire"
              disabled={etape === 1 && choisies.length === 0}
              onClick={() => setEtape(etape + 1)}
            >
              Suivant
            </button>
          ) : (
            <button type="submit" className="bouton primaire" disabled={enCours}>
              {enCours ? "Creation..." : "Creer le produit"}
            </button>
          )}
          <span className="text-xs" style={{ color: "var(--texte-doux)" }}>
            {lignes.length} matiere(s) · {choisies.length} operation(s)
          </span>
        </div>
      </form>
    </div>
  );
}
