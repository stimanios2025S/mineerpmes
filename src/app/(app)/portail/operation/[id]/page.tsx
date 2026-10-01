import Link from "next/link";
import { notFound } from "next/navigation";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  actionPortailCloturerOrdre,
  actionPortailDeclarerConsommation,
  actionPortailDeclarerPerte,
  actionPortailDeclarerProduction,
  actionPortailDemarrerOperation,
  actionPortailMettreEnPause,
  actionPortailReprendreOperation,
  actionPortailSignalerProbleme,
  actionPortailTerminerOperation,
} from "@/actions/rh";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Statistique,
  Tableau,
} from "@/components/ui";
import { BoutonAction, Champ, FormulaireAction } from "@/components/interactif";
import { chargerOperationPortail } from "@/lib/mes/portail-operation";
import { estUsinePortail, identitePortail } from "@/lib/portail-identite";
import { identifiantOuNull } from "@/lib/liste";
import { D } from "@/lib/decimal";
import {
  formatDate,
  formatDateTime,
  formatDuree,
  formatHeure,
  formatQuantite,
  formatTaux,
} from "@/lib/format";
import {
  LIBELLES_CATEGORIE_PERTE,
  LIBELLES_DECISION_QUALITE,
  LIBELLES_MOTIF_PERTE,
  LIBELLES_STATUT_AFFECTATION,
  LIBELLES_STATUT_DECLARATION,
  LIBELLES_STATUT_OPERATION,
  LIBELLES_TYPE_DECLARATION,
  LIBELLES_USINE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Portail d operation" };

function dureeReelle(
  debut: Date | null,
  fin: Date | null,
  pausesMs: bigint,
): string | null {
  if (!debut) return null;
  const borneFin = fin ?? new Date();
  const total = Math.max(
    0,
    borneFin.getTime() - debut.getTime() - Number(pausesMs),
  );
  const minutes = Math.floor(total / 60000);
  return formatDuree(minutes);
}

export default async function PagePortailOperation({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.PORTAIL_EMPLOYE);

  if (!utilisateur.employeeId) {
    return (
      <>
        <EnTetePage titre="Portail d operation" />
        <Alerte ton="danger" titre="Compte non rattache a une fiche employe">
          Le portail d operation exige une fiche employe rattachee a votre compte.
          Contactez le service des ressources humaines pour regulariser votre
          situation.
        </Alerte>
      </>
    );
  }

  const { id } = await params;
  const workOrderOperationId = identifiantOuNull(id);
  if (!workOrderOperationId) notFound();

  const portail = await chargerOperationPortail(
    workOrderOperationId,
    utilisateur.employeeId,
    utilisateur,
  );

  const { execution, operation, workOrder, affectationCourante } = portail;
  const usinePortail = estUsinePortail(workOrder.factory)
    ? identitePortail(workOrder.factory)
    : null;
  const lienIndex = usinePortail
    ? usinePortail.code === "ADMEDCO"
      ? "/portail/admedco/operations"
      : "/portail/mobilix/operations"
    : "/portail/operations";
  const lienAccueil = usinePortail
    ? usinePortail.code === "ADMEDCO"
      ? "/portail/admedco"
      : "/portail/mobilix"
    : "/portail";
  const libelleEtat = libelle(LIBELLES_STATUT_OPERATION, execution.status);
  const duree = dureeReelle(
    execution.actualStart,
    execution.actualEnd,
    execution.totalPausedMs,
  );
  const etapeActive = portail.etapeGamme;
  const affectationLibelle = affectationCourante
    ? libelle(LIBELLES_STATUT_AFFECTATION, affectationCourante.status)
    : "Non affectee";

  return (
    <div className={`portail-identite ${usinePortail?.className ?? ""}`}>
      <EnTetePage
        titre={`${usinePortail ? `${usinePortail.libelle} - ` : ""}${operation.code} - ${operation.label}`}
        description={`Ordre ${workOrder.number} - etape ${execution.stepNo}${
          portail.workCenter ? ` - poste ${portail.workCenter.code}` : ""
        } - ${LIBELLES_USINE[workOrder.factory] ?? workOrder.factory}`}
        actions={
          <>
            <Link className="bouton secondaire" href={lienIndex}>
              Portails {usinePortail?.courte ?? "d'operation"}
            </Link>
            <Link className="lien-nav text-sm" href={lienAccueil}>
              Retour au portail
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Statistique
          libelle="Statut de l operation"
          valeur={libelleEtat}
          ton={
            execution.status === "EN_COURS"
              ? "info"
              : execution.status === "EN_PAUSE"
                ? "alerte"
                : execution.status === "TERMINEE"
                  ? "succes"
                  : "neutre"
          }
          detail={
            affectationCourante
              ? `Affectation : ${affectationLibelle}`
              : "Operateur reference de l operation"
          }
        />
        <Statistique
          libelle="Quantite prevue"
          valeur={formatQuantite(execution.quantityPlanned)}
          ton="primaire"
          detail={`${workOrder.item.code} - ${workOrder.item.label1}`}
        />
        <Statistique
          libelle="Conforme declaree"
          valeur={formatQuantite(execution.quantityConform)}
          ton="succes"
          detail={`Reste a produire : ${formatQuantite(portail.resteAProduire)}`}
        />
        <Statistique
          libelle="Temps reel"
          valeur={duree ?? "Non demarree"}
          ton={execution.pausedAt ? "alerte" : "neutre"}
          detail={
            execution.pausedAt
              ? "Operation en pause"
              : `${formatQuantite(execution.quantityScrapped)} de rebut`
          }
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Carte titre="Execution de l etape">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Quantite produite</dt>
              <dd className="font-medium">
                {formatQuantite(execution.quantityProduced)}
              </dd>
            </div>
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Conforme</dt>
              <dd className="font-medium">
                {formatQuantite(execution.quantityConform)}
              </dd>
            </div>
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Rebut</dt>
              <dd className="font-medium">
                {formatQuantite(execution.quantityScrapped)}
              </dd>
            </div>
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>A reprendre</dt>
              <dd className="font-medium">
                {formatQuantite(execution.quantityRework)}
              </dd>
            </div>
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Matiere consommee</dt>
              <dd className="font-medium">
                {formatQuantite(execution.quantityConsumed)}
              </dd>
            </div>
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Priorite</dt>
              <dd className="font-medium">{workOrder.priority}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            <BoutonAction
              action={actionPortailDemarrerOperation}
              libelle="Demarrer"
              variante="primaire"
              champsCaches={{ workOrderOperationId: execution.id }}
            />
            <BoutonAction
              action={actionPortailMettreEnPause}
              libelle="Mettre en pause"
              champsCaches={{ workOrderOperationId: execution.id }}
            />
            <BoutonAction
              action={actionPortailReprendreOperation}
              libelle="Reprendre"
              champsCaches={{ workOrderOperationId: execution.id }}
            />
            <BoutonAction
              action={actionPortailTerminerOperation}
              libelle="Terminer mon intervention"
              variante="danger"
              champsCaches={{ workOrderOperationId: execution.id }}
              confirmation="Terminer votre intervention ? Vos heures reelles seront figees et serviront de base a votre evaluation."
            />
          </div>

          {portail.peutCloturerOrdre && (
            <div className="mt-4">
              <BoutonAction
                action={actionPortailCloturerOrdre}
                libelle="Cloturer l'ordre de fabrication"
                variante="danger"
                champsCaches={{ workOrderOperationId: execution.id }}
                confirmation="Cloturer l'ordre de fabrication ? Cette action est definitive."
              />
            </div>
          )}
        </Carte>

        <Carte titre="Poste et affectation">
          <dl className="grid gap-2 text-sm">
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Poste de travail</dt>
              <dd className="font-medium">
                {portail.workCenter
                  ? `${portail.workCenter.code} - ${portail.workCenter.label}`
                  : "Poste non precise"}
              </dd>
            </div>
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Atelier</dt>
              <dd className="font-medium">
                {portail.workCenter?.workshop?.label ??
                  workOrder.workshop?.label ??
                  "Non precise"}
              </dd>
            </div>
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Operateur reference</dt>
              <dd className="font-medium">
                {portail.operator
                  ? `${portail.operator.matricule} - ${portail.operator.firstName} ${portail.operator.lastName}`
                  : "Affectation par programme"}
              </dd>
            </div>
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Creneau operation</dt>
              <dd className="font-medium">
                {execution.plannedStart || execution.plannedEnd
                  ? `${formatHeure(execution.plannedStart)} - ${formatHeure(execution.plannedEnd)}`
                  : "Non planifie"}
              </dd>
            </div>
          </dl>

          {affectationCourante && (
            <div className="mt-3 rounded-md border p-2 text-sm" style={{ borderColor: "var(--bordure)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  Poste scanne :{" "}
                  {affectationCourante.scannedWorkCenter?.code ??
                    affectationCourante.workCenter?.code ??
                    "Non scanne"}
                </p>
                <EtiquetteStatut
                  libelle={affectationLibelle}
                  code={affectationCourante.status}
                />
              </div>
              <p className="mt-1" style={{ color: "var(--texte-doux)" }}>
                {affectationCourante.plannedStart || affectationCourante.plannedEnd
                  ? `Creneau prevu : ${formatHeure(affectationCourante.plannedStart)} - ${formatHeure(affectationCourante.plannedEnd)}`
                  : "Creneau non planifie"}
                {affectationCourante.actualStart
                  ? ` - demarree a ${formatDateTime(affectationCourante.actualStart)}`
                  : ""}
              </p>
              {affectationCourante.plannedLot && (
                <p className="mt-1" style={{ color: "var(--texte-doux)" }}>
                  Lot prevu : {affectationCourante.plannedLot.lotNumber}
                </p>
              )}
            </div>
          )}
        </Carte>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Carte titre="Consignes de l etape">
          {etapeActive?.isQualityGate && (
            <div className="mb-3">
              <Alerte ton="alerte" titre="Controle qualite requis">
                Cette etape est un point de controle : la quantite conforme doit
                etre validee avant de passer a la suite.
              </Alerte>
            </div>
          )}
          <div className="rounded-md p-3" style={{ background: "var(--fond-doux)" }}>
            <p className="font-semibold">Etape {execution.stepNo}</p>
            <p className="mt-1 text-sm" style={{ color: "var(--texte-doux)" }}>
              {etapeActive?.description ??
                operation.description ??
                "Aucune consigne particuliere n'est enregistree pour cette etape."}
            </p>
            {etapeActive?.instructions && (
              <p className="mt-2 whitespace-pre-line text-sm">
                {etapeActive.instructions}
              </p>
            )}
          </div>

          <div className="mt-3 grid gap-2 text-sm">
            <p>
              <span className="font-semibold">Temps standard : </span>
              {formatDuree(etapeActive?.standardTimeMinutes ?? operation.standardTimeMinutes)}
            </p>
            <p>
              <span className="font-semibold">Temps de reglage : </span>
              {formatDuree(etapeActive?.setupTimeMinutes ?? 0)}
            </p>
            <p>
              <span className="font-semibold">Taux de perte prevu : </span>
              {formatTaux(operation.standardLossRate)}
            </p>
            <p>
              <span className="font-semibold">Controle qualite : </span>
              {operation.requiresQualityCheck || etapeActive?.isQualityGate
                ? "Oui"
                : "Non"}
            </p>
          </div>
        </Carte>

        <Carte titre="Contexte de la gamme">
          <div className="grid gap-3 text-sm">
            <div className="rounded-md border p-2" style={{ borderColor: "var(--bordure)" }}>
              <p className="text-xs uppercase" style={{ color: "var(--texte-doux)" }}>
                Etape precedente
              </p>
              <p className="font-medium">
                {portail.etapePrecedente
                  ? `Etape ${portail.etapePrecedente.stepNo}`
                  : "Aucune etape precedente"}
              </p>
            </div>
            <div className="rounded-md border p-2" style={{ borderColor: "var(--primaire)", background: "var(--primaire-clair)" }}>
              <p className="text-xs uppercase" style={{ color: "var(--primaire-fonce)" }}>
                Etape en cours
              </p>
              <p className="font-medium">
                Etape {execution.stepNo} - {operation.label}
              </p>
            </div>
            <div className="rounded-md border p-2" style={{ borderColor: "var(--bordure)" }}>
              <p className="text-xs uppercase" style={{ color: "var(--texte-doux)" }}>
                Etape suivante
              </p>
              <p className="font-medium">
                {portail.etapeSuivante
                  ? `Etape ${portail.etapeSuivante.stepNo}`
                  : "Fin de gamme"}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
            L&apos;ordre des etapes est celui de la gamme publiee. Le portail ne
            permet pas de sauter une etape : le passage se fait par le circuit
            de production et de validation.
          </p>
        </Carte>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Carte titre="Sous-stock de l etape">
          {portail.sousStock && portail.positionSousStock ? (
            <>
              <p className="font-medium">
                {portail.sousStock.code} - {portail.sousStock.label}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt style={{ color: "var(--texte-doux)" }}>Physique</dt>
                  <dd className="font-medium">
                    {formatQuantite(portail.positionSousStock.quantitePhysique)}
                  </dd>
                </div>
                <div>
                  <dt style={{ color: "var(--texte-doux)" }}>Disponible</dt>
                  <dd className="font-medium">
                    {formatQuantite(portail.positionSousStock.quantiteDisponible)}
                  </dd>
                </div>
                <div>
                  <dt style={{ color: "var(--texte-doux)" }}>En attente validation</dt>
                  <dd className="font-medium">
                    {formatQuantite(portail.positionSousStock.quantiteEnAttenteValidation)}
                  </dd>
                </div>
                <div>
                  <dt style={{ color: "var(--texte-doux)" }}>Deja transmis</dt>
                  <dd className="font-medium">
                    {formatQuantite(portail.transferts.quantite)}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                Les quantites sont lues dans le grand livre de stock. Le portail
                ne modifie jamais un solde directement.
              </p>
            </>
          ) : (
            <Alerte ton="neutre" titre="Aucun sous-stock declare">
              Aucun sous-stock de sortie n&apos;est declare pour cette operation.
              Adressez-vous au responsable d&apos;atelier si le passage a
              l&apos;etape suivante doit etre trace.
            </Alerte>
          )}
        </Carte>

        <Carte titre="Branches amont">
          {portail.branchesManquantes.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
              Aucune branche amont obligatoire est signalee comme manquante.
            </p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {portail.branchesManquantes.map((branche) => (
                <li key={branche.linkId} className="rounded-md border p-2">
                  <p className="font-medium">{branche.fromLabel}</p>
                  <p style={{ color: "var(--texte-doux)" }}>
                    {formatQuantite(branche.quantitePresente)} disponible pour{" "}
                    {formatQuantite(branche.quantiteRequise)} attendu
                    {branche.isRequired ? " (obligatoire)" : " (facultative)"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Carte>
      </div>

      <div className="mt-4">
        <Carte
          titre="Matieres de cette operation"
          description="Chaque prise est une declaration tracee. Le portail ne modifie pas un stock de sa propre initiative."
        >
          {portail.matieres.length === 0 ? (
            <Alerte ton="neutre" titre="Aucune matiere rattachee">
              Aucun composant n&apos;est rattache a cette operation.
            </Alerte>
          ) : (
            <ul className="grid gap-3">
              {portail.matieres.map((matiere) => (
                <li key={matiere.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {matiere.code} - {matiere.label}
                      </p>
                      <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                        Prevu {formatQuantite(matiere.planifiee)}{" "}
                        {matiere.unite ?? ""} - sorti {formatQuantite(matiere.sortie)} -
                        consomme {formatQuantite(matiere.consommee)}
                        {D.gt(matiere.manque, 0)
                          ? ` - manque ${formatQuantite(matiere.manque)}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <FormulaireAction
                      action={actionPortailDeclarerConsommation}
                      libelleSoumettre="Declarer la matiere prise"
                      varianteSoumettre="secondaire"
                      reinitialiser
                    >
                      <input
                        type="hidden"
                        name="workOrderOperationId"
                        value={execution.id}
                      />
                      <input
                        type="hidden"
                        name="materialId"
                        value={matiere.id}
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Champ
                          nom="quantite"
                          libelle={`Quantite prise (${matiere.unite || "unite"})`}
                          type="number"
                          requis
                          pas="0.0001"
                          min="0"
                        />
                        <Champ
                          nom="commentaire"
                          libelle="Commentaire"
                          maxLength={200}
                        />
                      </div>
                    </FormulaireAction>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Carte>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Carte titre="Declarer une quantite produite">
          <FormulaireAction
            action={actionPortailDeclarerProduction}
            libelleSoumettre="Declarer la production"
            reinitialiser
          >
            <input
              type="hidden"
              name="workOrderOperationId"
              value={execution.id}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ
                nom="quantiteProduite"
                libelle="Quantite produite"
                type="number"
                requis
                pas="0.0001"
                min="0"
              />
              <Champ
                nom="quantiteConforme"
                libelle="Dont conforme"
                type="number"
                pas="0.0001"
                min="0"
              />
              <Champ
                nom="quantiteRebutee"
                libelle="Dont rebut"
                type="number"
                pas="0.0001"
                min="0"
              />
              <Champ
                nom="quantiteReprise"
                libelle="Dont a reprendre"
                type="number"
                pas="0.0001"
                min="0"
              />
            </div>
            <Champ nom="commentaire" libelle="Commentaire" type="textarea" />
          </FormulaireAction>
        </Carte>

        <Carte titre="Signaler une anomalie">
          <div className="grid gap-3">
            <FormulaireAction
              action={actionPortailSignalerProbleme}
              libelleSoumettre="Envoyer le signalement"
              varianteSoumettre="danger"
              reinitialiser
            >
              <input
                type="hidden"
                name="workOrderOperationId"
                value={execution.id}
              />
              <Champ
                nom="description"
                libelle="Description du probleme"
                type="textarea"
                requis
                aide="La description ouvre une non-conformite reelle examinee par la qualite."
              />
              <Champ
                nom="quantite"
                libelle="Quantite impactee (facultatif)"
                type="number"
                pas="0.0001"
                min="0"
              />
            </FormulaireAction>

            <FormulaireAction
              action={actionPortailDeclarerPerte}
              libelleSoumettre="Declarer une perte"
              varianteSoumettre="danger"
              reinitialiser
            >
              <input
                type="hidden"
                name="workOrderOperationId"
                value={execution.id}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Champ
                  nom="itemId"
                  libelle="Article concerne"
                  type="select"
                  requis
                  options={portail.matieres.map((matiere) => ({
                    valeur: matiere.itemId,
                    libelle: `${matiere.code} - ${matiere.label}`,
                  }))}
                />
                <Champ
                  nom="quantite"
                  libelle="Quantite perdue"
                  type="number"
                  requis
                  pas="0.0001"
                  min="0"
                />
                <Champ
                  nom="categorie"
                  libelle="Categorie de perte"
                  type="select"
                  requis
                  options={Object.entries(LIBELLES_CATEGORIE_PERTE).map(
                    ([valeur, texte]) => ({ valeur, libelle: texte }),
                  )}
                />
                <Champ
                  nom="motif"
                  libelle="Motif de perte"
                  type="select"
                  requis
                  options={Object.entries(LIBELLES_MOTIF_PERTE).map(
                    ([valeur, texte]) => ({ valeur, libelle: texte }),
                  )}
                />
              </div>
              <Champ
                nom="commentaire"
                libelle="Precisions sur la perte"
                type="textarea"
              />
            </FormulaireAction>
          </div>
        </Carte>
      </div>

      <div className="mt-4">
        <Carte
          titre="Mes declarations sur cette operation"
          description="Seules vos propres declarations sont affichees ici."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "date", libelle: "Date" },
              { cle: "type", libelle: "Type" },
              { cle: "statut", libelle: "Statut" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "conforme", libelle: "Conforme", nombre: true },
              { cle: "perte", libelle: "Perte" },
              { cle: "commentaire", libelle: "Commentaire" },
            ]}
            lignes={portail.declarations.map((declaration) => ({
              cle: String(declaration.id),
              cellules: [
                formatDateTime(declaration.occurredAt),
                libelle(LIBELLES_TYPE_DECLARATION, declaration.kind),
                <EtiquetteStatut
                  key="statut"
                  libelle={libelle(
                    LIBELLES_STATUT_DECLARATION,
                    declaration.status,
                  )}
                  code={declaration.status}
                />,
                formatQuantite(declaration.quantity),
                formatQuantite(declaration.quantityConform),
                declaration.lossCategory
                  ? `${libelle(LIBELLES_CATEGORIE_PERTE, declaration.lossCategory)} - ${libelle(LIBELLES_MOTIF_PERTE, declaration.lossReason ?? "")}`
                  : "-",
                declaration.comment ?? "-",
              ],
            }))}
            messageVide="Vous n'avez encore enregistre aucune declaration sur cette operation."
          />
        </Carte>
      </div>

      <div className="mt-4">
        <Alerte ton="neutre" titre="Ce que ce portail ne permet pas">
          Le portail d operation ne permet pas de modifier une nomenclature, un
          cout, un salaire ou le stock d&apos;un autre atelier. Toute action est
          bornee a votre fiche employe, a votre usine et a l&apos;operation qui
          vous est affectee.
        </Alerte>
      </div>
    </div>
  );
}
