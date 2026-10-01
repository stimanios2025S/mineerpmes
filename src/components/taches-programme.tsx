import Link from "next/link";
import { Carte, Etiquette, Tableau, Vide } from "@/components/ui";
import { formatHeure, formatQuantite } from "@/lib/format";
import type { TacheProgrammee } from "@/lib/mes/postes";

/**
 * Affichage du programme d'un operateur.
 *
 * Composant serveur : il ne fait que rendre ce que le service a deja borne sur
 * l'employe connecte. Il ne filtre rien lui-meme, et il n'affiche jamais une
 * tache comme demarrable si un blocage est remonte.
 */

const TONS_PRIORITE: Record<string, "neutre" | "info" | "alerte" | "danger"> = {
  BASSE: "neutre",
  NORMALE: "info",
  HAUTE: "alerte",
  URGENTE: "danger",
};

function CarteTache({ tache, rang }: { tache: TacheProgrammee; rang: number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            style={{ background: "var(--fond-doux)" }}
          >
            {rang}
          </span>
          <div>
            <p className="font-semibold">
              {tache.operationCode} — {tache.operationLabel}
            </p>
            <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
              {tache.workOrderNumber
                ? `OF ${tache.workOrderNumber}`
                : "Sans ordre de fabrication"}
              {tache.produit ? ` · ${tache.produit}` : ""}
              {tache.stepNo !== null ? ` · etape ${tache.stepNo}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Etiquette ton={TONS_PRIORITE[tache.priority] ?? "neutre"}>
            Priorite {tache.libellePriorite}
          </Etiquette>
          {tache.posteDeControleQualite && (
            <Etiquette ton="alerte">Controle qualite</Etiquette>
          )}
          {tache.workOrderOperationId && (
            <Link
              className="lien-nav text-sm font-semibold"
              href={`/portail/operation/${tache.workOrderOperationId}`}
            >
              Ouvrir le portail
            </Link>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt style={{ color: "var(--texte-doux)" }}>Quantite attendue</dt>
          <dd className="font-medium">
            {formatQuantite(tache.quantitePrevue)} {tache.unite ?? ""}
          </dd>
        </div>
        <div>
          <dt style={{ color: "var(--texte-doux)" }}>Deja conforme</dt>
          <dd className="font-medium">{formatQuantite(tache.quantiteDejaConforme)}</dd>
        </div>
        <div>
          <dt style={{ color: "var(--texte-doux)" }}>Reste a faire</dt>
          <dd className="font-medium">{formatQuantite(tache.quantiteRestante)}</dd>
        </div>
        <div>
          <dt style={{ color: "var(--texte-doux)" }}>Horaire prevu</dt>
          <dd className="font-medium">
            {tache.plannedStart ? formatHeure(tache.plannedStart) : "—"}
            {tache.plannedEnd ? ` → ${formatHeure(tache.plannedEnd)}` : ""}
          </dd>
        </div>
      </dl>

      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <p style={{ color: "var(--texte-doux)" }}>Sous-stock de l'etape</p>
          <p className="font-medium">
            {tache.sousStockCode ? (
              <>
                {tache.sousStockCode} · disponible{" "}
                {formatQuantite(tache.disponibleDansSousStock ?? 0)}
                {tache.unite ? ` ${tache.unite}` : ""}
              </>
            ) : (
              "Non declare"
            )}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--texte-doux)" }}>Lot</p>
          <p className="font-medium">{tache.lotCode ?? "—"}</p>
        </div>
      </div>

      {tache.instructions && (
        <div className="mt-3 rounded-md p-2 text-sm" style={{ background: "var(--fond-doux)" }}>
          <p className="font-medium">Consignes</p>
          <p className="whitespace-pre-line">{tache.instructions}</p>
        </div>
      )}

      {tache.branchesManquantes.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="font-medium">Etapes amont a completer</p>
          <ul className="mt-1 list-disc pl-5">
            {tache.branchesManquantes.map((branche) => (
              <li key={branche.linkId}>
                {branche.fromLabel} : {formatQuantite(branche.quantitePresente)} disponible
                pour {formatQuantite(branche.quantiteRequise)} attendu
                {branche.isRequired ? " (obligatoire)" : " (facultative)"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tache.matieresManquantes.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="font-medium">Matieres a sortir</p>
          <ul className="mt-1 list-disc pl-5">
            {tache.matieresManquantes.map((matiere) => (
              <li key={matiere.articleId}>
                {matiere.article} : {formatQuantite(matiere.quantiteSortie)} sorti sur{" "}
                {formatQuantite(matiere.quantiteRequise)} — manque{" "}
                {formatQuantite(matiere.manque)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tache.blocages.length > 0 && (
        <div
          className="mt-3 rounded-md border p-2 text-sm"
          style={{ borderColor: "var(--bordure)", background: "var(--fond-doux)" }}
        >
          <p className="font-semibold">Ce qui bloque le demarrage</p>
          <ul className="mt-1 list-disc pl-5">
            {tache.blocages.map((blocage, index) => (
              <li key={index}>{blocage}</li>
            ))}
          </ul>
        </div>
      )}

      {tache.changements && tache.changements.length > 0 && (
        <p className="mt-3 text-sm" style={{ color: "var(--texte-doux)" }}>
          {tache.changements.length} reaffectation(s) enregistree(s) depuis la
          publication du programme.
        </p>
      )}
    </div>
  );
}

export function ProgrammeTaches({
  taches,
  titre = "Mon programme du jour",
  messageVide = "Aucune tache ne vous est affectee pour le moment.",
}: {
  taches: TacheProgrammee[];
  titre?: string;
  messageVide?: string;
}) {
  if (taches.length === 0) {
    return (
      <Carte titre={titre}>
        <Vide message={messageVide} />
      </Carte>
    );
  }

  return (
    <Carte
      titre={titre}
      description={`${taches.length} tache(s), dans l'ordre decide par votre responsable : priorite, puis ordre explicite, puis heure prevue.`}
    >
      <div className="grid gap-3">
        {taches.map((tache, index) => (
          <CarteTache key={tache.assignmentId} tache={tache} rang={index + 1} />
        ))}
      </div>
    </Carte>
  );
}

/** Vue tabulaire, pour la planification cote responsable. */
export function TableauTaches({
  taches,
  messageVide = "Aucune tache pour cette journee.",
}: {
  taches: TacheProgrammee[];
  messageVide?: string;
}) {
  return (
    <Tableau
      messageVide={messageVide}
      cleLigne={(index) => String(taches[index]?.assignmentId ?? index)}
      colonnes={[
        { cle: "poste", libelle: "Poste" },
        { cle: "operation", libelle: "Operation" },
        { cle: "of", libelle: "Ordre" },
        { cle: "priorite", libelle: "Priorite" },
        { cle: "ordre", libelle: "Ordre", nombre: true },
        { cle: "quantite", libelle: "Quantite", nombre: true },
        { cle: "horaire", libelle: "Horaire" },
        { cle: "blocages", libelle: "Blocages" },
      ]}
      lignes={taches.map((tache) => ({
        cle: String(tache.assignmentId),
        cellules: [
          tache.poste ?? "—",
          tache.operationLabel,
          tache.workOrderNumber ?? "—",
          tache.libellePriorite,
          String(tache.sequenceOrder),
          formatQuantite(tache.quantitePrevue),
          tache.plannedStart
            ? `${formatHeure(tache.plannedStart)}${tache.plannedEnd ? ` → ${formatHeure(tache.plannedEnd)}` : ""}`
            : "—",
          tache.blocages.length === 0 ? (
            <Etiquette ton="succes">Pret</Etiquette>
          ) : (
            <Etiquette ton="alerte">{tache.blocages.length} point(s)</Etiquette>
          ),
        ],
      }))}
    />
  );
}
