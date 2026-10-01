import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { aLaPermission, exigerPermission, peutAccederUsine } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { identifiantOuNull } from "@/lib/liste";
import { actionTransfererEtape } from "@/actions/atelier";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  Statistique,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { feuilleDeRouteOrdre } from "@/lib/mes/feuille-de-route";
import { D } from "@/lib/decimal";
import { formatDate, formatDateTime, formatQuantite } from "@/lib/format";
import { LIBELLES_USINE } from "@/lib/libelles";

export const metadata = { title: "Feuille de route d'un ordre" };

function duree(ms: bigint): string {
  const total = Number(ms / 1000n);
  const heures = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${heures} h ${String(minutes).padStart(2, "0")}`;
}

/**
 * Feuille de route vivante d'un ordre de fabrication.
 *
 * Elle montre, etape par etape, ce qui est planifie, declare, valide, en
 * attente, en reprise, en rebut ET reellement transfere. Une etape n'est jamais
 * presentee comme arrivee a la suivante tant que le transfert n'a pas eu lieu :
 * le bouton de transfert ci-dessous ne propose d'ailleurs que du conforme
 * valide, et le serveur revalide tout.
 */
export default async function PageFeuilleOrdre({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.PRODUCTION_LIRE);
  const peutTransferer = aLaPermission(
    utilisateur,
    PERMISSIONS.PRODUCTION_TRANSFERT_ETAPE,
  );

  const { id } = await params;
  const identifiant = identifiantOuNull(id);
  if (!identifiant) notFound();

  const existe = await prisma.workOrder.findUnique({
    where: { id: identifiant },
    select: { id: true },
  });
  if (!existe) notFound();

  const feuille = await feuilleDeRouteOrdre(identifiant);

  if (!peutAccederUsine(utilisateur, feuille.factory)) {
    return (
      <>
        <EnTetePage titre={`Ordre ${feuille.numero}`} />
        <Alerte ton="danger" titre="Perimetre insuffisant">
          Cet ordre appartient a la division {LIBELLES_USINE[feuille.factory] ?? feuille.factory}.
        </Alerte>
      </>
    );
  }

  const produit = D.of(feuille.quantiteProduite);
  const conforme = D.of(feuille.quantiteConforme);

  return (
    <>
      <EnTetePage
        titre={`Ordre ${feuille.numero}`}
        description={`${feuille.itemLabel} · ${LIBELLES_USINE[feuille.factory] ?? feuille.factory} · ${feuille.statut}`}
        actions={
          <Link className="bouton secondaire" href="/production/feuille-de-route">
            Toutes les feuilles de route
          </Link>
        }
      />

      {feuille.alertes.length > 0 && (
        <div className="mb-5">
          <Alerte ton="alerte" titre="Points d'attention">
            <ul className="ml-4 list-disc">
              {feuille.alertes.map((alerte) => (
                <li key={alerte}>{alerte}</li>
              ))}
            </ul>
          </Alerte>
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Statistique
          libelle="Quantite planifiee"
          valeur={formatQuantite(feuille.quantitePlanifiee)}
        />
        <Statistique libelle="Declare produite" valeur={formatQuantite(produit)} />
        <Statistique
          libelle="Conforme validee"
          valeur={formatQuantite(conforme)}
          ton={D.gte(conforme, feuille.quantitePlanifiee) ? "succes" : "neutre"}
        />
        <Statistique
          libelle="Reprise / rebut"
          valeur={`${formatQuantite(feuille.quantiteReprise)} / ${formatQuantite(feuille.quantiteRebut)}`}
          ton={D.gt(feuille.quantiteRebut, 0) ? "alerte" : "neutre"}
        />
      </div>

      <div className="grid gap-4">
        {feuille.etapes.map((etape) => (
          <Carte
            key={etape.workOrderOperationId}
            titre={`Etape ${etape.stepNo} — ${etape.operationCode} ${etape.operationLabel}`}
            description={`${etape.poste ?? "poste a definir"} · ${etape.status}`}
            actions={
              etape.complete ? (
                <Etiquette ton="succes">Transferee en totalite</Etiquette>
              ) : etape.alimenteEtapeSuivante ? (
                <Etiquette ton="info">Partiellement arrivee</Etiquette>
              ) : (
                <Etiquette ton="neutre">Pas encore arrivee a la suite</Etiquette>
              )
            }
          >
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                  Planifie
                </p>
                <p className="font-medium tabular-nums">
                  {formatQuantite(etape.quantitePlanifiee)}
                </p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                  Produit declare
                </p>
                <p className="font-medium tabular-nums">
                  {formatQuantite(etape.quantiteProduite)}
                </p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                  Conforme valide
                </p>
                <p className="font-medium tabular-nums">
                  {formatQuantite(etape.quantiteValidee)}
                </p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                  En attente de validation
                </p>
                <p className="font-medium tabular-nums">
                  {formatQuantite(etape.quantiteEnAttenteValidation)}
                </p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                  Transfere a la suite
                </p>
                <p className="font-medium tabular-nums">
                  {formatQuantite(etape.quantiteTransferee)}
                </p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                  Dans {etape.sousStockCode ?? "le sous-stock"}
                </p>
                <p className="font-medium tabular-nums">
                  {formatQuantite(etape.quantiteDansSousStock)}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                  Qui a travaille ici
                </p>
                <p>
                  {etape.acteurs.length === 0
                    ? "Aucune declaration enregistree."
                    : etape.acteurs
                        .map((acteur) => `${acteur.nom} (${acteur.declarations})`)
                        .join(", ")}
                </p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                  Debut reel / fin reelle
                </p>
                <p>
                  {etape.debutReel ? formatDateTime(etape.debutReel) : "—"} /{" "}
                  {etape.finReelle ? formatDateTime(etape.finReelle) : "en cours"}
                </p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                  Temps d'arret cumule
                </p>
                <p>{duree(etape.tempsPauseMs)}</p>
              </div>
            </div>

            {peutTransferer &&
              etape.sousStockId &&
              etape.destinations.length > 0 &&
              D.gt(etape.quantiteDansSousStock, 0) && (
                <div className="mt-4">
                  <details className="rounded border p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      Transferer vers l'etape suivante (
                      {formatQuantite(etape.quantiteDansSousStock)} disponible)
                    </summary>
                    <div className="mt-3">
                      <FormulaireAction
                        action={actionTransfererEtape}
                        libelleSoumettre="Transferer"
                        varianteSoumettre="primaire"
                      >
                        <input
                          type="hidden"
                          name="workOrderOperationId"
                          value={etape.workOrderOperationId}
                        />
                        <input
                          type="hidden"
                          name="fromSubStockId"
                          value={etape.sousStockId}
                        />
                        <input type="hidden" name="itemId" value={feuille.itemId} />
                        <div className="grid gap-3 sm:grid-cols-3">
                          <Champ
                            nom="toSubStockId"
                            libelle="Etape suivante"
                            type="select"
                            requis
                            options={etape.destinations.map((destination) => ({
                              valeur: destination.id,
                              libelle: `${destination.code} — ${destination.label}${destination.isRequired ? "" : " (facultatif)"}`,
                            }))}
                          />
                          <Champ
                            nom="quantity"
                            libelle="Quantite a transferer"
                            type="number"
                            pas="0.000001"
                            min={0}
                            requis
                            valeur={D.toFixed(etape.quantiteDansSousStock, 3)}
                            aide="La quantite disponible est verifiee a nouveau par le serveur."
                          />
                          <Champ
                            nom="comment"
                            libelle="Commentaire"
                            maxLength={200}
                          />
                        </div>
                        <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                          Le transfert est transactionnel et idempotent : un
                          double envoi ne cree pas un second mouvement. Chaque
                          passage est historise avec son auteur.
                        </p>
                      </FormulaireAction>
                    </div>
                  </details>
                </div>
              )}

            {peutTransferer &&
              etape.sousStockId &&
              etape.destinations.length === 0 &&
              D.gt(etape.quantiteDansSousStock, 0) && (
                <p className="mt-3 text-sm" style={{ color: "var(--texte-doux)" }}>
                  Aucun lien vers une etape suivante n'est declare pour ce
                  sous-stock : le transfert est impossible tant que le lien n'est
                  pas enregistre dans « Sous-stocks d'etape ».
                </p>
              )}
          </Carte>
        ))}
      </div>

      <div className="mt-4">
        <Carte
          titre="Passages enregistres"
          description="La tracabilite du passage d'etape : quoi, d'ou, vers ou, combien, par qui et quand."
        >
          <Tableau
            messageVide="Aucun passage n'a encore ete enregistre pour cet ordre."
            cleLigne={(index) => String(feuille.transferts[index]?.id ?? index)}
            colonnes={[
              { cle: "quand", libelle: "Quand" },
              { cle: "operation", libelle: "Etape" },
              { cle: "trajet", libelle: "Trajet" },
              { cle: "article", libelle: "Article" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "auteur", libelle: "Valide par" },
              { cle: "commentaire", libelle: "Commentaire" },
            ]}
            lignes={feuille.transferts.map((transfert) => ({
              cle: String(transfert.id),
              cellules: [
                formatDateTime(transfert.occurredAt),
                transfert.operation,
                `${transfert.de} -> ${transfert.vers}`,
                transfert.article,
                formatQuantite(transfert.quantity),
                transfert.validePar ?? "—",
                transfert.comment ?? "—",
              ],
            }))}
          />
        </Carte>
      </div>

      <div className="mt-4">
        <Carte titre="Synthese de l'ordre">
          <dl className="grid gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Quantite lancee</dt>
              <dd className="font-medium">
                {formatQuantite(feuille.quantiteLancee)}
              </dd>
            </div>
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Decision qualite</dt>
              <dd className="font-medium">{feuille.decisionQualite ?? "En attente"}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Libere qualite le</dt>
              <dd className="font-medium">
                {feuille.libereQualiteLe
                  ? formatDate(feuille.libereQualiteLe)
                  : "Pas encore libere"}
              </dd>
            </div>
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Echeance</dt>
              <dd className="font-medium">
                {feuille.dueDate ? formatDate(feuille.dueDate) : "—"}
              </dd>
            </div>
          </dl>
        </Carte>
      </div>
    </>
  );
}
