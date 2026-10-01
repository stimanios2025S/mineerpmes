import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { aLaPermission, exigerPermission, peutAccederUsine } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { identifiantOuNull } from "@/lib/liste";
import {
  actionAnnulerOrdre,
  actionCloturerOrdre,
  actionDeclarerConsommation,
  actionDeclarerPerte,
  actionDeclarerProduction,
  actionDemarrerOperation,
  actionLancerOrdre,
  actionMettreEnPauseOperation,
  actionReprendreOperation,
} from "@/actions/production";
import {
  Alerte,
  Carte,
  EnTetePage,
  EtiquetteStatut,
  ListeDefinitions,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction, FormulaireMotif } from "@/components/interactif";
import { formatDate, formatDateTime, formatDuree, formatQuantite } from "@/lib/format";
import {
  LIBELLES_CATEGORIE_PERTE,
  LIBELLES_DECISION_QUALITE,
  LIBELLES_MOTIF_PERTE,
  LIBELLES_PRIORITE,
  LIBELLES_RESULTAT_CONTROLE,
  LIBELLES_SOURCE_NON_CONFORMITE,
  LIBELLES_STATUT_DECLARATION,
  LIBELLES_STATUT_NON_CONFORMITE,
  LIBELLES_STATUT_OPERATION,
  LIBELLES_STATUT_ORDRE,
  LIBELLES_TYPE_DECLARATION,
  LIBELLES_USINE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Ordre de fabrication" };

/**
 * Fiche complete d'un ordre de fabrication.
 *
 * Cette page est en lecture seule : toutes les actions proposees renvoient vers
 * les actions serveur du module, qui revalident les droits et passent par le
 * moteur de production. Aucun statut ni aucune quantite n'est ecrit ici.
 */

const STATUTS_OPERATION_TERMINES = ["TERMINEE", "VALIDEE", "ANNULEE"];
const STATUTS_ORDRE_FERMES = ["TERMINE", "CLOTURE", "ANNULE"];

export default async function PageOrdreFabrication({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.PRODUCTION_LIRE);
  const { id } = await params;
  const identifiant = identifiantOuNull(id);
  if (!identifiant) notFound();

  const ordre = await prisma.workOrder.findUnique({
    where: { id: identifiant },
    include: {
      item: true,
      formula: true,
      route: { include: { workshop: true } },
      workshop: true,
      sourceWarehouse: true,
      targetWarehouse: true,
      customer: { select: { id: true, code: true, label1: true } },
      salesOrder: { include: { customer: true } },
      salesOrderLine: true,
      responsible: true,
      operations: {
        orderBy: { stepNo: "asc" },
        include: {
          operation: true,
          workCenter: true,
          operator: true,
        },
      },
      materials: {
        orderBy: { lineNo: "asc" },
        include: {
          componentItem: true,
          operation: true,
        },
      },
      qualityChecks: {
        orderBy: { checkedAt: "desc" },
        take: 100,
        include: {
          checkpoint: true,
          checkedBy: true,
        },
      },
      nonConformities: {
        orderBy: { detectedAt: "desc" },
        take: 100,
      },
      kanbanTransitions: {
        orderBy: { occurredAt: "desc" },
        take: 200,
        include: {
          fromOperation: { select: { code: true, label: true } },
          toOperation: { select: { code: true, label: true } },
          employee: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });

  if (!ordre) notFound();
  // Un ordre d'une division hors perimetre n'est pas divulgue.
  if (!peutAccederUsine(utilisateur, ordre.factory)) notFound();

  const declarations = await prisma.operationDeclaration.findMany({
    where: { workOrderId: ordre.id },
    orderBy: { occurredAt: "desc" },
    take: 300,
    include: {
      operation: { select: { code: true, label: true } },
      employee: { select: { firstName: true, lastName: true } },
      validatedBy: { select: { firstName: true, lastName: true } },
      item: { select: { code: true } },
      componentItem: { select: { code: true } },
      warehouse: { select: { code: true } },
    },
  });

  // Transfert inter-ateliers cree automatiquement en fin de poudrage.
  const transferts = await prisma.stockMovement.findMany({
    where: { workOrderId: ordre.id, documentType: "TRANSFERT_DIVISION" },
    orderBy: { occurredAt: "desc" },
    take: 50,
    include: {
      item: { select: { code: true, label1: true } },
      sourceWarehouse: { select: { code: true } },
      targetWarehouse: { select: { code: true } },
    },
  });

  // Auteurs des operations : l'identite est resolue en une seule lecture.
  const identifiantsUtilisateurs = Array.from(
    new Set([
      ...declarations.map((declaration) => declaration.userId),
      ...ordre.kanbanTransitions.map((transition) => transition.userId),
    ].filter((valeur): valeur is number => valeur !== null)),
  );
  const auteurs =
    identifiantsUtilisateurs.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: identifiantsUtilisateurs } },
          select: { id: true, email: true },
        });
  const courrielAuteur = new Map(auteurs.map((auteur) => [auteur.id, auteur.email]));

  // Depots cites par la nomenclature figee : la relation n'existe pas sur
  // `WorkOrderMaterial`, le code est donc resolu par une lecture unique.
  const identifiantsDepotsMatieres = Array.from(
    new Set(
      ordre.materials
        .map((matiere) => matiere.warehouseId)
        .filter((valeur): valeur is number => valeur !== null),
    ),
  );
  const depotsMatieres =
    identifiantsDepotsMatieres.length === 0
      ? []
      : await prisma.warehouse.findMany({
          where: { id: { in: identifiantsDepotsMatieres } },
          select: { id: true, code: true },
        });
  const codeDepot = new Map(depotsMatieres.map((depot) => [depot.id, depot.code]));

  // Donnees de reference des formulaires d'atelier (lectures bornees).
  const [employes, depots] = await Promise.all([
    prisma.employee.findMany({
      where: { isActive: true, factory: { in: [ordre.factory, "COMMUN"] } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 500,
      select: { id: true, firstName: true, lastName: true, matricule: true },
    }),
    prisma.warehouse.findMany({
      where: { isActive: true, factory: { in: [ordre.factory, "COMMUN"] } },
      orderBy: { code: "asc" },
      take: 200,
      select: { id: true, code: true, label: true },
    }),
  ]);

  const optionsEmployes = employes.map((employe) => ({
    valeur: employe.id,
    libelle: `${employe.lastName} ${employe.firstName} (${employe.matricule})`,
  }));
  const optionsDepots = depots.map((depot) => ({
    valeur: depot.id,
    libelle: `${depot.code} — ${depot.label}`,
  }));

  // Articles pouvant etre declares en perte : le produit de l'ordre et ses composants.
  const optionsArticlesPerte = [
    {
      valeur: ordre.itemId,
      libelle: `${ordre.item.code} — ${ordre.item.label1} (produit de l'ordre)`,
    },
    ...Array.from(
      new Map(
        ordre.materials.map((matiere) => [
          matiere.componentItemId,
          {
            valeur: matiere.componentItemId,
            libelle: `${matiere.componentItem.code} — ${matiere.componentItem.label1} (composant)`,
          },
        ]),
      ).values(),
    ).filter((option) => option.valeur !== ordre.itemId),
  ];

  const optionsCategoriesPerte = Object.entries(LIBELLES_CATEGORIE_PERTE).map(
    ([valeur, texte]) => ({ valeur, libelle: texte }),
  );
  const optionsMotifsPerte = Object.entries(LIBELLES_MOTIF_PERTE).map(([valeur, texte]) => ({
    valeur,
    libelle: texte,
  }));

  const peutLancer = aLaPermission(utilisateur, PERMISSIONS.PRODUCTION_LANCER);
  const peutDeclarer = aLaPermission(utilisateur, PERMISSIONS.PRODUCTION_DECLARER);
  const peutCloturer = aLaPermission(utilisateur, PERMISSIONS.PRODUCTION_CLOTURER);
  const peutAnnuler = aLaPermission(utilisateur, PERMISSIONS.PRODUCTION_ANNULER);

  const enRetard =
    ordre.dueDate !== null &&
    ordre.dueDate < new Date() &&
    !STATUTS_ORDRE_FERMES.includes(ordre.status);

  const champsOrdre = { workOrderId: ordre.id };

  return (
    <>
      <EnTetePage
        titre={`Ordre ${ordre.number}`}
        description={`${ordre.item.code} — ${ordre.item.label1}. Toutes les valeurs affichees proviennent de la base ; aucune n'est recalculee dans le navigateur.`}
        actions={
          <Link className="lien-nav text-sm" href="/production">
            Retour a la liste
          </Link>
        }
      />

      <div className="mb-5 space-y-3">
        {enRetard && (
          <Alerte ton="danger" titre="Ordre en retard">
            L'echeance du {formatDate(ordre.dueDate)} est depassee et l'ordre est encore ouvert.
          </Alerte>
        )}
        {ordre.status === "EN_CONTROLE_QUALITE" && (
          <Alerte ton="alerte" titre="Ordre en controle qualite">
            La qualite doit statuer ({libelle(LIBELLES_DECISION_QUALITE, ordre.qualityStatus)})
            avant que l'ordre ne reprenne son cours normal.
          </Alerte>
        )}
        {ordre.status === "ANNULE" && (
          <Alerte ton="danger" titre="Ordre annule">
            Cet ordre est annule : aucune declaration ne peut plus y etre enregistree.
          </Alerte>
        )}
        {!ordre.formula && !ordre.route && (
          <Alerte ton="alerte" titre="Fabrication non configuree">
            Aucune nomenclature ni gamme n'est rattachee a cet ordre : aucune operation ne peut
            etre determinee.
          </Alerte>
        )}
      </div>

      <Carte titre="Identification de l'ordre">
        <ListeDefinitions
          elements={[
            { terme: "Numero", valeur: ordre.number },
            {
              terme: "Article",
              valeur: `${ordre.item.code} — ${ordre.item.label1}`,
            },
            { terme: "Division", valeur: libelle(LIBELLES_USINE, ordre.factory) },
            {
              terme: "Statut",
              valeur: (
                <EtiquetteStatut
                  libelle={libelle(LIBELLES_STATUT_ORDRE, ordre.status)}
                  code={ordre.status}
                />
              ),
            },
            { terme: "Priorite", valeur: libelle(LIBELLES_PRIORITE, ordre.priority) },
            {
              terme: "Debit prevu / echeance",
              valeur: `${formatDate(ordre.plannedStart)} / ${formatDate(ordre.dueDate)}`,
            },
            {
              terme: "Debut reel / fin reelle",
              valeur: `${formatDateTime(ordre.actualStart)} / ${formatDateTime(ordre.actualEnd)}`,
            },
            {
              terme: "Atelier",
              valeur:
                ordre.workshop?.label ?? ordre.route?.workshop?.label ?? "Non determine",
            },
            {
              terme: "Depot source",
              valeur: ordre.sourceWarehouse
                ? `${ordre.sourceWarehouse.code} — ${ordre.sourceWarehouse.label}`
                : "Non defini",
            },
            {
              terme: "Depot de destination",
              valeur: ordre.targetWarehouse
                ? `${ordre.targetWarehouse.code} — ${ordre.targetWarehouse.label}`
                : "Non defini",
            },
            {
              terme: "Client",
              valeur: ordre.customer
                ? `${ordre.customer.code} - ${ordre.customer.label1}`
                : "Aucun client declare",
            },
            {
              terme: "Reference client",
              valeur: ordre.customerReference ?? "Non renseignee",
            },
            {
              terme: "Adresse de livraison",
              valeur: ordre.deliveryAddress ?? "Non renseignee",
            },
            {
              terme: "Transporteur",
              valeur: ordre.carrier ?? "Non renseigne",
            },
            {
              terme: "Livraison prevue",
              valeur: ordre.plannedDeliveryDate
                ? formatDate(ordre.plannedDeliveryDate)
                : "Non planifiee",
            },
            {
              terme: "Notes de livraison",
              valeur: ordre.deliveryNotes ?? "Aucune note",
            },
            {
              terme: "Commande client d'origine",
              valeur: ordre.salesOrder
                ? `${ordre.salesOrder.number} — ${ordre.salesOrder.customer.label1}${
                    ordre.salesOrderLine ? ` (ligne ${ordre.salesOrderLine.lineNo})` : ""
                  }`
                : "Aucune (ordre interne)",
            },
            {
              terme: "Nomenclature figee",
              valeur: ordre.formula
                ? `${ordre.formula.code} v${ordre.formula.version}`
                : "Aucune",
            },
            {
              terme: "Gamme",
              valeur: ordre.route ? `${ordre.route.code} v${ordre.route.version}` : "Aucune",
            },
            {
              terme: "Responsable",
              valeur: ordre.responsible
                ? `${ordre.responsible.firstName} ${ordre.responsible.lastName}`.trim()
                : "Non affecte",
            },
            {
              terme: "Decision qualite",
              valeur: libelle(LIBELLES_DECISION_QUALITE, ordre.qualityStatus),
            },
          ]}
        />
        {ordre.notes && (
          <p className="mt-4 text-sm" style={{ color: "var(--texte-doux)" }}>
            Notes : {ordre.notes}
          </p>
        )}
      </Carte>

      <div className="mt-5 grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {[
          { libelle: "Planifiee", valeur: ordre.quantityPlanned },
          { libelle: "Lancee", valeur: ordre.quantityLaunched },
          { libelle: "Produite", valeur: ordre.quantityProduced },
          { libelle: "Conforme", valeur: ordre.quantityConform },
          { libelle: "Rebutee", valeur: ordre.quantityScrapped },
          { libelle: "Restante", valeur: ordre.quantityRemaining },
        ].map((indicateur) => (
          <div key={indicateur.libelle} className="carte p-3">
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--texte-doux)" }}
            >
              {indicateur.libelle}
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatQuantite(indicateur.valeur)}
            </p>
          </div>
        ))}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Actions sur l'ordre                                              */}
      {/* ---------------------------------------------------------------- */}
      {(peutLancer || peutCloturer || peutAnnuler) && (
        <div className="mt-5">
          <Carte
            titre="Actions sur l'ordre"
            description="Chaque action est revalidee par le serveur : la permission affichee ici n'est qu'un confort d'interface."
          >
            <div className="grid gap-4 lg:grid-cols-3">
              {peutLancer && ["BROUILLON", "PLANIFIE"].includes(ordre.status) && (
                <FormulaireAction action={actionLancerOrdre} libelleSoumettre="Lancer l'ordre">
                  <Champ nom="workOrderId" type="hidden" libelle="" valeur={ordre.id} />
                  <p className="text-sm">
                    Le lancement fige la nomenclature dans l'ordre : les composants theoriques
                    sont copies et ne changeront plus.
                  </p>
                </FormulaireAction>
              )}

              {peutCloturer && !["CLOTURE", "ANNULE"].includes(ordre.status) && (
                <>
                  <FormulaireAction
                    action={actionCloturerOrdre}
                    libelleSoumettre="Cloturer l'ordre"
                    varianteSoumettre="secondaire"
                  >
                    <Champ nom="workOrderId" type="hidden" libelle="" valeur={ordre.id} />
                    <Champ
                      nom="commentaire"
                      libelle="Commentaire de cloture"
                      type="textarea"
                      aide="La cloture exige que toutes les operations soient terminees."
                    />
                  </FormulaireAction>
                </>
              )}

              {peutAnnuler && !STATUTS_ORDRE_FERMES.includes(ordre.status) && (
                <div>
                  <p className="mb-2 text-sm">
                    L'annulation conserve l'ordre et son historique ; elle exige un motif ecrit.
                  </p>
                  <FormulaireMotif
                    action={actionAnnulerOrdre}
                    libelleSoumettre="Annuler l'ordre"
                    varianteSoumettre="danger"
                    libelleMotif="Motif d'annulation"
                    motifMinimum={5}
                    champsCaches={champsOrdre}
                  />
                </div>
              )}
            </div>
          </Carte>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Operations                                                       */}
      {/* ---------------------------------------------------------------- */}
      <div className="mt-5">
        <Carte
          titre="Operations de fabrication"
          description="Avancement enregistre operation par operation."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "etape", libelle: "Etape", nombre: true },
              { cle: "operation", libelle: "Operation" },
              { cle: "poste", libelle: "Poste de travail" },
              { cle: "statut", libelle: "Statut" },
              { cle: "operateur", libelle: "Operateur" },
              { cle: "planifiee", libelle: "Planifiee", nombre: true },
              { cle: "produite", libelle: "Produite", nombre: true },
              { cle: "conforme", libelle: "Conforme", nombre: true },
              { cle: "rebutee", libelle: "Rebutee", nombre: true },
              { cle: "consommee", libelle: "Consommee", nombre: true },
              { cle: "prevues", libelle: "Dates prevues" },
              { cle: "reelles", libelle: "Dates reelles" },
              { cle: "pause", libelle: "Pause cumulee" },
            ]}
            lignes={ordre.operations.map((operation) => ({
              cle: String(operation.id),
              cellules: [
                String(operation.stepNo),
                `${operation.operation.code} — ${operation.operation.label}`,
                operation.workCenter
                  ? `${operation.workCenter.code} — ${operation.workCenter.label}`
                  : "Non affecte",
                <EtiquetteStatut
                  key="s"
                  libelle={libelle(LIBELLES_STATUT_OPERATION, operation.status)}
                  code={operation.status}
                />,
                operation.operator
                  ? `${operation.operator.firstName} ${operation.operator.lastName}`.trim()
                  : "Non affecte",
                formatQuantite(operation.quantityPlanned),
                formatQuantite(operation.quantityProduced),
                formatQuantite(operation.quantityConform),
                formatQuantite(operation.quantityScrapped),
                formatQuantite(operation.quantityConsumed),
                `${formatDate(operation.plannedStart)} / ${formatDate(operation.plannedEnd)}`,
                `${formatDateTime(operation.actualStart)} / ${formatDateTime(operation.actualEnd)}`,
                formatDuree(Number(operation.totalPausedMs)),
              ],
            }))}
            messageVide="Aucune operation n'est definie sur cet ordre."
          />
        </Carte>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Matieres theoriques et consommations reelles                     */}
      {/* ---------------------------------------------------------------- */}
      <div className="mt-5">
        <Carte
          titre="Matieres theoriques et consommations reelles"
          description="Nomenclature figee au lancement de l'ordre, comparee aux consommations reellement enregistrees."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "ligne", libelle: "Ligne", nombre: true },
              { cle: "composant", libelle: "Composant" },
              { cle: "operation", libelle: "Operation" },
              { cle: "depot", libelle: "Depot" },
              { cle: "theorique", libelle: "Theorique", nombre: true },
              { cle: "sortie", libelle: "Sortie", nombre: true },
              { cle: "consommee", libelle: "Consommee", nombre: true },
              { cle: "ecart", libelle: "Ecart restant", nombre: true },
              { cle: "perdue", libelle: "Perdue", nombre: true },
              { cle: "retournee", libelle: "Retournee", nombre: true },
              { cle: "origine", libelle: "Origine du figeage" },
            ]}
            lignes={ordre.materials.map((matiere) => {
              const reste = D.sub(matiere.quantityPlanned, matiere.quantityConsumed);
              return {
                cle: String(matiere.id),
                cellules: [
                  String(matiere.lineNo),
                  `${matiere.componentItem.code} — ${matiere.componentItem.label1}${
                    matiere.isLabor ? " (main d'oeuvre)" : ""
                  }`,
                  matiere.operation
                    ? `${matiere.operation.code} — ${matiere.operation.label}`
                    : "Non rattachee a une operation",
                  matiere.warehouseId
                    ? (codeDepot.get(matiere.warehouseId) ?? "Depot introuvable")
                    : "Non defini",
                  `${formatQuantite(matiere.quantityPlanned)} ${matiere.unitCode ?? ""}`.trim(),
                  formatQuantite(matiere.quantityIssued),
                  formatQuantite(matiere.quantityConsumed),
                  reste.isNegative() ? (
                    <strong key="e" style={{ color: "var(--alerte)" }}>
                      {formatQuantite(reste)} (depassement)
                    </strong>
                  ) : (
                    formatQuantite(reste)
                  ),
                  formatQuantite(matiere.quantityLost),
                  formatQuantite(matiere.quantityReturned),
                  matiere.snapshotSource ?? "Origine non renseignee",
                ],
              };
            })}
            messageVide="Aucune matiere figee : l'ordre n'a pas encore ete lance ou sa nomenclature est vide."
          />
        </Carte>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Historique des declarations                                      */}
      {/* ---------------------------------------------------------------- */}
      <div className="mt-5">
        <Carte
          titre="Historique des declarations d'atelier"
          description="Toutes les declarations enregistrees sur cet ordre, dans leur ordre chronologique inverse."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "date", libelle: "Date" },
              { cle: "type", libelle: "Type" },
              { cle: "operation", libelle: "Operation" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "conforme", libelle: "Conforme", nombre: true },
              { cle: "article", libelle: "Article concerne" },
              { cle: "categorie", libelle: "Categorie" },
              { cle: "motif", libelle: "Motif" },
              { cle: "operateur", libelle: "Operateur" },
              { cle: "saisie", libelle: "Saisie par" },
              { cle: "statut", libelle: "Statut" },
              { cle: "validation", libelle: "Validation" },
              { cle: "commentaire", libelle: "Commentaire" },
            ]}
            lignes={declarations.map((declaration) => ({
              cle: String(declaration.id),
              cellules: [
                formatDateTime(declaration.occurredAt),
                libelle(LIBELLES_TYPE_DECLARATION, declaration.kind),
                `${declaration.operation.code} — ${declaration.operation.label}`,
                formatQuantite(declaration.quantity),
                formatQuantite(declaration.quantityConform),
                declaration.componentItem?.code ??
                  declaration.item?.code ??
                  "Non applicable",
                libelle(LIBELLES_CATEGORIE_PERTE, declaration.lossCategory),
                libelle(LIBELLES_MOTIF_PERTE, declaration.lossReason),
                declaration.employee
                  ? `${declaration.employee.firstName} ${declaration.employee.lastName}`.trim()
                  : "Non renseigne",
                declaration.userId
                  ? (courrielAuteur.get(declaration.userId) ?? "Utilisateur inconnu")
                  : "Non renseigne",
                <EtiquetteStatut
                  key="s"
                  libelle={libelle(LIBELLES_STATUT_DECLARATION, declaration.status)}
                  code={declaration.status}
                />,
                declaration.validatedAt
                  ? `${formatDateTime(declaration.validatedAt)}${
                      declaration.validatedBy
                        ? ` par ${declaration.validatedBy.firstName} ${declaration.validatedBy.lastName}`.trim()
                        : ""
                    }`
                  : "Non validee",
                declaration.rejectionReason ?? declaration.comment ?? "-",
              ],
            }))}
            messageVide="Aucune declaration enregistree sur cet ordre."
          />
        </Carte>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Historique Kanban                                                */}
      {/* ---------------------------------------------------------------- */}
      <div className="mt-5">
        <Carte
          titre="Historique des deplacements Kanban"
          description="Ancienne et nouvelle etape, utilisateur, date et quantite de chaque deplacement enregistre par le moteur de production."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "date", libelle: "Date" },
              { cle: "de", libelle: "Ancienne etape" },
              { cle: "vers", libelle: "Nouvelle etape" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "utilisateur", libelle: "Utilisateur" },
              { cle: "operateur", libelle: "Operateur" },
              { cle: "consommations", libelle: "Consommations declarees" },
              { cle: "pertes", libelle: "Pertes declarees" },
              { cle: "commentaire", libelle: "Commentaire" },
            ]}
            lignes={ordre.kanbanTransitions.map((transition) => ({
              cle: String(transition.id),
              cellules: [
                formatDateTime(transition.occurredAt),
                transition.fromOperation
                  ? `${transition.fromOperation.code} — ${transition.fromOperation.label}`
                  : "Origine inconnue",
                transition.toOperation
                  ? `${transition.toOperation.code} — ${transition.toOperation.label}`
                  : "Sortie de gamme",
                formatQuantite(transition.quantity),
                transition.userId
                  ? (courrielAuteur.get(transition.userId) ?? "Utilisateur inconnu")
                  : "Non renseigne",
                transition.employee
                  ? `${transition.employee.firstName} ${transition.employee.lastName}`.trim()
                  : "Non renseigne",
                resumerJson(transition.declaredConsumptions),
                resumerJson(transition.declaredLosses),
                transition.comment ?? "-",
              ],
            }))}
            messageVide="Aucun deplacement Kanban enregistre sur cet ordre."
          />
        </Carte>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Qualite                                                          */}
      {/* ---------------------------------------------------------------- */}
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Carte
          titre="Controles qualite"
          description="Controles enregistres sur cet ordre par le moteur qualite."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Numero" },
              { cle: "date", libelle: "Date" },
              { cle: "controlee", libelle: "Controlee", nombre: true },
              { cle: "conforme", libelle: "Conforme", nombre: true },
              { cle: "rejetee", libelle: "Rejetee", nombre: true },
              { cle: "resultat", libelle: "Resultat" },
              { cle: "decision", libelle: "Decision" },
              { cle: "controleur", libelle: "Controleur" },
            ]}
            lignes={ordre.qualityChecks.map((controle) => ({
              cle: String(controle.id),
              cellules: [
                controle.number,
                formatDateTime(controle.checkedAt),
                formatQuantite(controle.quantityChecked),
                formatQuantite(controle.quantityConform),
                formatQuantite(controle.quantityRejected),
                libelle(LIBELLES_RESULTAT_CONTROLE, controle.result),
                libelle(LIBELLES_DECISION_QUALITE, controle.decision),
                controle.checkedBy
                  ? `${controle.checkedBy.firstName} ${controle.checkedBy.lastName}`.trim()
                  : "Non renseigne",
              ],
            }))}
            messageVide="Aucun controle qualite enregistre sur cet ordre."
          />
        </Carte>

        <Carte
          titre="Non-conformites"
          description="Fiches ouvertes a partir de cet ordre."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Fiche" },
              { cle: "date", libelle: "Detectee le" },
              { cle: "origine", libelle: "Origine" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "statut", libelle: "Statut" },
              { cle: "description", libelle: "Description" },
            ]}
            lignes={ordre.nonConformities.map((nonConformite) => ({
              cle: String(nonConformite.id),
              cellules: [
                nonConformite.number,
                formatDateTime(nonConformite.detectedAt),
                libelle(LIBELLES_SOURCE_NON_CONFORMITE, nonConformite.source),
                formatQuantite(nonConformite.quantity),
                <EtiquetteStatut
                  key="s"
                  libelle={libelle(LIBELLES_STATUT_NON_CONFORMITE, nonConformite.status)}
                  code={nonConformite.status}
                />,
                nonConformite.description,
              ],
            }))}
            messageVide="Aucune non-conformite rattachee a cet ordre."
          />
        </Carte>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Transfert inter-ateliers                                         */}
      {/* ---------------------------------------------------------------- */}
      <div className="mt-5">
        <Carte
          titre="Transfert inter-ateliers"
          description="Transfert cree automatiquement a la fin du poudrage du chassis peint, vers la division qui poursuit la fabrication."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "date", libelle: "Date" },
              { cle: "document", libelle: "Document" },
              { cle: "article", libelle: "Article" },
              { cle: "sens", libelle: "Sens" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "source", libelle: "Depot source" },
              { cle: "destination", libelle: "Depot de destination" },
              { cle: "commentaire", libelle: "Commentaire" },
            ]}
            lignes={transferts.map((mouvement) => ({
              cle: String(mouvement.id),
              cellules: [
                formatDateTime(mouvement.occurredAt),
                mouvement.documentNumber ?? mouvement.number,
                `${mouvement.item.code} — ${mouvement.item.label1}`,
                mouvement.quantity.isNegative() ? "Sortie" : "Entree",
                formatQuantite(mouvement.quantity),
                mouvement.sourceWarehouse
                  ? `${mouvement.sourceWarehouse.code}`
                  : "Non renseigne",
                mouvement.targetWarehouse
                  ? `${mouvement.targetWarehouse.code}`
                  : "Non renseigne",
                mouvement.comment ?? "-",
              ],
            }))}
            messageVide="Aucun transfert inter-ateliers n'a encore ete cree pour cet ordre."
          />
        </Carte>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Actions d'atelier par operation                                  */}
      {/* ---------------------------------------------------------------- */}
      {peutDeclarer && (
        <div className="mt-5">
          {ordre.operations.map((operation) => {
            const terminee = STATUTS_OPERATION_TERMINES.includes(operation.status);
            const matieres = ordre.materials.filter(
              (matiere) => matiere.workOrderOperationId === operation.id,
            );

            return (
              <div key={operation.id} className="mb-5">
                <Carte titre={`Etape ${operation.stepNo} — ${operation.operation.label}`}>
                  <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                    Statut actuel :{" "}
                    {libelle(LIBELLES_STATUT_OPERATION, operation.status)}. Planifiee :{" "}
                    {formatQuantite(operation.quantityPlanned)}, conforme :{" "}
                    {formatQuantite(operation.quantityConform)}.
                  </p>

                  <div className="mt-4 grid gap-5 lg:grid-cols-2">
                    {/* Conduite de l'operation */}
                    {operation.status === "NON_DEMARREE" && (
                      <div className="rounded-lg border p-3">
                        <h3 className="mb-2 text-sm font-semibold">Demarrer l'operation</h3>
                        <FormulaireAction
                          action={actionDemarrerOperation}
                          libelleSoumettre="Demarrer"
                        >
                          <Champ
                            nom="workOrderOperationId"
                            type="hidden"
                            libelle=""
                            valeur={operation.id}
                          />
                          <Champ
                            nom="employeeId"
                            libelle="Operateur"
                            type="select"
                            options={optionsEmployes}
                          />
                          <Champ nom="commentaire" libelle="Commentaire" />
                        </FormulaireAction>
                      </div>
                    )}

                    {operation.status === "EN_COURS" && (
                      <div className="rounded-lg border p-3">
                        <h3 className="mb-2 text-sm font-semibold">Mettre en pause</h3>
                        <FormulaireAction
                          action={actionMettreEnPauseOperation}
                          libelleSoumettre="Mettre en pause"
                          varianteSoumettre="secondaire"
                        >
                          <Champ
                            nom="workOrderOperationId"
                            type="hidden"
                            libelle=""
                            valeur={operation.id}
                          />
                          <Champ
                            nom="employeeId"
                            libelle="Operateur"
                            type="select"
                            options={optionsEmployes}
                          />
                          <Champ nom="commentaire" libelle="Commentaire" />
                        </FormulaireAction>
                      </div>
                    )}

                    {operation.status === "EN_PAUSE" && (
                      <div className="rounded-lg border p-3">
                        <h3 className="mb-2 text-sm font-semibold">Reprendre</h3>
                        <FormulaireAction
                          action={actionReprendreOperation}
                          libelleSoumettre="Reprendre"
                        >
                          <Champ
                            nom="workOrderOperationId"
                            type="hidden"
                            libelle=""
                            valeur={operation.id}
                          />
                          <Champ
                            nom="employeeId"
                            libelle="Operateur"
                            type="select"
                            options={optionsEmployes}
                          />
                          <Champ nom="commentaire" libelle="Commentaire" />
                        </FormulaireAction>
                      </div>
                    )}

                    {/* Declaration de production */}
                    {!terminee && operation.status !== "NON_DEMARREE" && (
                      <div className="rounded-lg border p-3">
                        <h3 className="mb-2 text-sm font-semibold">
                          Declarer une production
                        </h3>
                        <FormulaireAction
                          action={actionDeclarerProduction}
                          libelleSoumettre="Declarer"
                        >
                          <Champ
                            nom="workOrderOperationId"
                            type="hidden"
                            libelle=""
                            valeur={operation.id}
                          />
                          <Champ
                            nom="quantiteProduite"
                            libelle="Quantite produite"
                            type="number"
                            requis
                            pas="0.001"
                            min="0.001"
                          />
                          <Champ
                            nom="quantiteConforme"
                            libelle="Dont conforme"
                            type="number"
                            pas="0.001"
                            min="0"
                            aide="Laisser vide pour considerer toute la production comme conforme."
                          />
                          <Champ
                            nom="quantiteRebutee"
                            libelle="Dont rebut"
                            type="number"
                            pas="0.001"
                            min="0"
                          />
                          <Champ
                            nom="quantiteReprise"
                            libelle="Dont reprise"
                            type="number"
                            pas="0.001"
                            min="0"
                          />
                          <Champ
                            nom="employeeId"
                            libelle="Operateur"
                            type="select"
                            options={optionsEmployes}
                          />
                          <Champ nom="commentaire" libelle="Commentaire" />
                          <label className="mt-2 flex items-center gap-2 text-sm">
                            <input type="checkbox" name="consommerComposants" defaultChecked />
                            <span>
                              Consommer les composants de cette operation selon la nomenclature
                              figee et sortir les quantites du stock.
                            </span>
                          </label>
                        </FormulaireAction>
                      </div>
                    )}

                    {/* Declaration de consommation */}
                    {!terminee && matieres.length > 0 && (
                      <div className="rounded-lg border p-3">
                        <h3 className="mb-2 text-sm font-semibold">
                          Declarer une consommation reelle
                        </h3>
                        <FormulaireAction
                          action={actionDeclarerConsommation}
                          libelleSoumettre="Declarer la consommation"
                          varianteSoumettre="secondaire"
                        >
                          <Champ
                            nom="workOrderOperationId"
                            type="hidden"
                            libelle=""
                            valeur={operation.id}
                          />
                          <Champ
                            nom="materialId"
                            libelle="Composant"
                            type="select"
                            requis
                            options={matieres.map((matiere) => ({
                              valeur: matiere.id,
                              libelle: `${matiere.componentItem.code} — ${matiere.componentItem.label1} (theorique ${formatQuantite(
                                matiere.quantityPlanned,
                              )}${matiere.unitCode ? ` ${matiere.unitCode}` : ""})`,
                            }))}
                            aide="Un ecart avec la quantite theorique est classe en surconsommation, jamais en perte."
                          />
                          <Champ
                            nom="quantite"
                            libelle="Quantite consommee"
                            type="number"
                            requis
                            pas="0.001"
                            min="0.001"
                          />
                          <Champ
                            nom="employeeId"
                            libelle="Operateur"
                            type="select"
                            options={optionsEmployes}
                          />
                          <Champ nom="commentaire" libelle="Commentaire" />
                        </FormulaireAction>
                      </div>
                    )}

                    {/* Declaration de perte */}
                    {!terminee && (
                      <div className="rounded-lg border p-3">
                        <h3 className="mb-2 text-sm font-semibold">
                          Declarer une perte ou un rebut
                        </h3>
                        <FormulaireAction
                          action={actionDeclarerPerte}
                          libelleSoumettre="Declarer la perte"
                          varianteSoumettre="danger"
                        >
                          <Champ
                            nom="workOrderOperationId"
                            type="hidden"
                            libelle=""
                            valeur={operation.id}
                          />
                          <Champ
                            nom="itemId"
                            libelle="Article concerne"
                            type="select"
                            requis
                            valeur={ordre.itemId}
                            options={optionsArticlesPerte}
                          />
                          <Champ
                            nom="quantite"
                            libelle="Quantite perdue"
                            type="number"
                            requis
                            pas="0.001"
                            min="0.001"
                          />
                          <Champ
                            nom="categorie"
                            libelle="Categorie"
                            type="select"
                            requis
                            options={optionsCategoriesPerte}
                          />
                          <Champ
                            nom="motif"
                            libelle="Motif"
                            type="select"
                            requis
                            options={optionsMotifsPerte}
                          />
                          <Champ
                            nom="warehouseId"
                            libelle="Depot"
                            type="select"
                            valeur={ordre.sourceWarehouseId ?? ""}
                            options={optionsDepots}
                            aide="Depot dont la marchandise sort ; obligatoire pour que le stock soit mouvemente."
                          />
                          <Champ
                            nom="employeeId"
                            libelle="Operateur"
                            type="select"
                            options={optionsEmployes}
                          />
                          <Champ nom="commentaire" libelle="Commentaire" />
                          <label className="mt-2 flex items-center gap-2 text-sm">
                            <input type="checkbox" name="sortirDuStock" defaultChecked />
                            <span>
                              Appliquer l'impact sur le stock (sortie pour une perte ou un rebut,
                              entree pour un retour en stock).
                            </span>
                          </label>
                        </FormulaireAction>
                      </div>
                    )}
                  </div>
                </Carte>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Resumes JSON des declarations agregees dans une transition Kanban. */
function resumerJson(valeur: unknown): string {
  if (!Array.isArray(valeur) || valeur.length === 0) return "Aucune";
  return valeur
    .map((element) => {
      if (typeof element !== "object" || element === null) return String(element);
      const ligne = element as Record<string, unknown>;
      const quantite = ligne.quantite ?? ligne.quantity ?? "?";
      const reference = ligne.article ?? ligne.libelle ?? ligne.motif ?? ligne.categorie ?? "";
      return `${reference} : ${quantite}`.trim();
    })
    .join(" ; ");
}
