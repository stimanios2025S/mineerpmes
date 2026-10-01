import Link from "next/link";
import type { EvaluationPeriodType, Factory, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { aLaPermission, exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fabricantLien,
  identifiantOuNull,
  lireParametresListe,
  pagination,
} from "@/lib/liste";
import {
  actionCorrigerEvaluation,
  actionEnregistrerEvaluation,
  actionValiderEvaluation,
} from "@/actions/rh";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Pagination,
  Section,
  Tableau,
} from "@/components/ui";
import {
  BoutonAction,
  Champ,
  FormulaireAction,
  FormulaireMotif,
} from "@/components/interactif";
import {
  formatDate,
  formatPourcentage,
  formatQuantite,
  toInputDate,
} from "@/lib/format";
import {
  LIBELLES_AXE_EVALUATION,
  LIBELLES_FIABILITE,
  LIBELLES_PERIODE_EVALUATION,
  LIBELLES_USINE,
  libelle,
} from "@/lib/libelles";
import {
  calculerEvaluation,
  libellesEvaluation,
  ponderationsAxes,
} from "@/lib/rh/service";

export const metadata = { title: "Evaluations de performance" };

/**
 * Evaluations de performance.
 *
 * Deux points structurants :
 *
 *  1. Les ponderations affichees proviennent de `ponderationsAxes()`, donc de la
 *     table `EvaluationWeight` modifiable par l'administrateur. Aucun poids
 *     n'est ecrit en dur dans cette page : ils sont restitues en pourcentage du
 *     total des ponderations actives.
 *  2. Le calcul porte uniquement sur les operations reellement declarees par
 *     l'employe. L'apercu affiche le niveau de fiabilite renvoye par le service
 *     et signale explicitement « donnees insuffisantes » le cas echeant ; il
 *     détaille les operations prises en compte.
 */

const STATUTS_FIABLES_EXCLUS = ["INSUFFISANTE"];

function periodeOuNull(valeur: string | null): EvaluationPeriodType | null {
  return valeur && valeur in LIBELLES_PERIODE_EVALUATION
    ? (valeur as EvaluationPeriodType)
    : null;
}

/**
 * Traduit un taux en pourcentage lisible. Le service renvoie des taux sur 100
 * pour les indicateurs deja convertis et des rapports pour les autres : la page
 * n'interprete jamais une valeur, elle affiche ce que le service a produit.
 */
function score(valeur: { toNumber(): number } | null): string {
  return valeur === null ? "—" : valeur.toNumber().toFixed(2);
}

export default async function PageEvaluations({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.RH_EVALUATION_LIRE);
  const parametres = await searchParams;
  const liste = lireParametresListe(parametres, ["division", "periode", "validees"]);

  const portee = usinesAutorisees(utilisateur);
  const divisionDemandee = liste.filtres.division;
  const division: Factory | null =
    divisionDemandee &&
    divisionDemandee in LIBELLES_USINE &&
    portee.includes(divisionDemandee as Factory)
      ? (divisionDemandee as Factory)
      : null;

  const peutCalculer = aLaPermission(utilisateur, PERMISSIONS.RH_EVALUATION_CALCULER);
  const peutValider = aLaPermission(utilisateur, PERMISSIONS.RH_EVALUATION_VALIDER);

  // --- Parametres d'apercu (lecture seule : aucun enregistrement) -------------
  const employeId = identifiantOuNull(
    typeof parametres.employe === "string" ? parametres.employe : null,
  );
  const periodeApercu = periodeOuNull(liste.filtres.periode);
  const referenceBrute =
    typeof parametres.reference === "string" ? parametres.reference : null;
  const referenceApercu = referenceBrute ? new Date(referenceBrute) : new Date();
  const operationApercuId = identifiantOuNull(
    typeof parametres.operation === "string" ? parametres.operation : null,
  );

  // L'employe demande doit appartenir a une division autorisee : sans ce
  // controle, un identifiant fabrique permettrait de calculer l'evaluation d'un
  // employe hors perimetre.
  const employeApercu =
    employeId === null
      ? null
      : await prisma.employee.findFirst({
          where: { id: employeId, factory: { in: portee } },
          select: { id: true, factory: true },
        });
  const apercuAutorise = employeApercu !== null;
  const apercuHorsPerimetre = employeId !== null && !apercuAutorise;

  const apercuActif =
    apercuAutorise &&
    periodeApercu !== null &&
    !Number.isNaN(referenceApercu.getTime());

  const ponderations = await ponderationsAxes();
  const totalPoids = ponderations.reduce(
    (cumul, ponderation) => cumul + ponderation.weight.toNumber(),
    0,
  );
  const libelles = libellesEvaluation();

  const [employes, operations, apercu] = await Promise.all([
    prisma.employee.findMany({
      where: { isActive: true, factory: { in: portee } },
      orderBy: { matricule: "asc" },
      take: 500,
      select: { id: true, matricule: true, firstName: true, lastName: true },
    }),
    prisma.operation.findMany({
      where: { isActive: true, factory: { in: portee } },
      orderBy: { code: "asc" },
      take: 300,
      select: { id: true, code: true, label: true },
    }),
    apercuActif
      ? calculerEvaluation({
          employeeId: employeId as number,
          periodType: periodeApercu as EvaluationPeriodType,
          reference: referenceApercu,
          operationId: operationApercuId,
        })
      : Promise.resolve(null),
  ]);

  // --- Liste des evaluations enregistrees -------------------------------------
  const where: Prisma.PerformanceEvaluationWhereInput = {
    factory: { in: division ? [division] : portee },
    ...(periodeApercu ? { periodType: periodeApercu } : {}),
    ...(liste.filtres.validees === "oui"
      ? { isValidated: true }
      : liste.filtres.validees === "non"
        ? { isValidated: false }
        : {}),
    ...(liste.recherche
      ? {
          employee: {
            OR: [
              { matricule: { contains: liste.recherche, mode: "insensitive" as const } },
              { firstName: { contains: liste.recherche, mode: "insensitive" as const } },
              { lastName: { contains: liste.recherche, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };

  const total = await prisma.performanceEvaluation.count({ where });
  const bornes = pagination(total, liste.page, liste.taille);
  const evaluations = await prisma.performanceEvaluation.findMany({
    where,
    orderBy: [{ periodStart: "desc" }, { employeeId: "asc" }],
    skip: bornes.skip,
    take: bornes.take,
    include: {
      employee: { select: { id: true, matricule: true, firstName: true, lastName: true } },
      operation: { select: { code: true, label: true } },
      validatedBy: { select: { firstName: true, lastName: true } },
    },
  });

  return (
    <>
      <EnTetePage
        titre="Evaluations de performance"
        description="Performance individuelle construite operation par operation, a partir du travail reellement declare. Aucune norme d'une operation non effectuee n'est appliquee."
        actions={
          <Link className="lien-nav text-sm" href="/rh/affectations">
            Affectations du jour
          </Link>
        }
      />

      <Carte
        titre="Ponderations en vigueur"
        description="Ces ponderations ne sont pas codees en dur : elles proviennent de la configuration (table des ponderations d'evaluation) et sont restituees ici en pourcentage du total des ponderations actives."
      >
        <Tableau
          colonnes={[
            { cle: "axe", libelle: "Axe" },
            { cle: "poids", libelle: "Ponderation", nombre: true },
            { cle: "part", libelle: "Part du total", nombre: true },
            { cle: "seuil", libelle: "Observations minimales", nombre: true },
          ]}
          lignes={ponderations.map((ponderation) => ({
            cle: ponderation.code,
            cellules: [
              libelle(LIBELLES_AXE_EVALUATION, ponderation.code),
              formatQuantite(ponderation.weight, 2),
              totalPoids > 0
                ? formatPourcentage(
                    (ponderation.weight.toNumber() / totalPoids) * 100,
                    2,
                  )
                : "—",
              libelles.seuils[ponderation.code as keyof typeof libelles.seuils] ?? "—",
            ],
          }))}
          messageVide="Aucune ponderation active n'est configuree."
        />
      </Carte>

      <Section titre="Calculer une evaluation">
        <Carte
          titre="Perimetre du calcul"
          description="Le calcul est effectue cote serveur a partir des affectations, declarations, pointages et controles reellement enregistres."
        >
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {liste.filtres.division && (
              <input
                type="hidden"
                name="division"
                value={liste.filtres.division}
              />
            )}
            {liste.filtres.validees && (
              <input
                type="hidden"
                name="validees"
                value={liste.filtres.validees}
              />
            )}
            <Champ
              nom="employe"
              libelle="Employe"
              type="select"
              options={employes.map((employe) => ({
                valeur: employe.id,
                libelle: `${employe.matricule} — ${employe.lastName} ${employe.firstName}`,
              }))}
              valeur={employeId}
            />
            <Champ
              nom="periode"
              libelle="Periode"
              type="select"
              valeur={liste.filtres.periode}
              options={Object.entries(LIBELLES_PERIODE_EVALUATION).map(
                ([valeur, texte]) => ({ valeur, libelle: texte }),
              )}
            />
            <Champ
              nom="reference"
              libelle="Date de reference"
              type="date"
              valeur={toInputDate(referenceApercu)}
              aide="Une date quelconque de la periode a evaluer."
            />
            <Champ
              nom="operation"
              libelle="Restreindre a une operation"
              type="select"
              valeur={operationApercuId}
              options={operations.map((operation) => ({
                valeur: operation.id,
                libelle: `${operation.code} — ${operation.label}`,
              }))}
              aide="Facultatif : sans restriction, toutes les operations reellement effectuees sont prises en compte."
            />
            <div className="flex items-end">
              <button
                type="submit"
                className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
              >
                Calculer
              </button>
            </div>
          </form>
        </Carte>

        {apercuHorsPerimetre && (
          <div className="mt-4">
            <Alerte ton="danger" titre="Acces refuse">
              L'employe demande n'appartient pas a une division autorisee pour
              votre profil. Aucune donnee n'a ete chargee et aucune evaluation n'a
              ete calculee.
            </Alerte>
          </div>
        )}

        {apercu && (
          <div className="mt-4">
            <Carte
              titre={`Apercu — ${apercu.employe} (${apercu.matricule})`}
              description={`${libelle(LIBELLES_PERIODE_EVALUATION, apercu.periodType)} du ${formatDate(apercu.periodStart)} au ${formatDate(apercu.periodEnd)} — ${libelle(LIBELLES_USINE, apercu.factory)}${apercu.operationLabel ? ` — operation ${apercu.operationLabel}` : ""}.`}
              actions={
                <EtiquetteStatut
                  libelle={libelle(LIBELLES_FIABILITE, apercu.fiabilite)}
                  code={apercu.fiabilite}
                />
              }
              sansPadding
            >
              <div className="grid gap-3 border-b p-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--texte-doux)" }}>
                    Score global
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {apercu.scoreGlobal === null ? "—" : apercu.scoreGlobal.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--texte-doux)" }}>
                    Operations reellement effectuees
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {apercu.operationsRealisees}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--texte-doux)" }}>
                    Affectations de la periode
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {apercu.affectationsCount}
                  </p>
                </div>
              </div>

              {STATUTS_FIABLES_EXCLUS.includes(apercu.fiabilite) && (
                <div className="p-4">
                  <Alerte
                    ton="danger"
                    titre={libelle(LIBELLES_FIABILITE, apercu.fiabilite)}
                  >
                    {apercu.messageFiabilite} Aucun score global ne doit etre
                    utilise pour une decision individuelle sur cette periode.
                  </Alerte>
                </div>
              )}

              {!STATUTS_FIABLES_EXCLUS.includes(apercu.fiabilite) && (
                <div className="p-4">
                  <Alerte ton="info" titre="Lecture du resultat">
                    {apercu.messageFiabilite}
                  </Alerte>
                </div>
              )}

              {apercu.avertissements.length > 0 && (
                <div className="px-4 pb-4">
                  <Alerte ton="alerte" titre="Avertissements du calcul">
                    <ul className="list-disc pl-5">
                      {apercu.avertissements.map((avertissement) => (
                        <li key={avertissement}>{avertissement}</li>
                      ))}
                    </ul>
                  </Alerte>
                </div>
              )}
            </Carte>

            <div className="mt-4">
              <Carte titre="Scores par axe" sansPadding>
                <Tableau
                  colonnes={[
                    { cle: "axe", libelle: "Axe" },
                    { cle: "poids", libelle: "Ponderation" },
                    { cle: "score", libelle: "Score", nombre: true },
                    { cle: "retenu", libelle: "Retenu dans le score global" },
                    { cle: "raison", libelle: "Motif d'exclusion" },
                  ]}
                  lignes={apercu.axes.map((axe) => ({
                    cle: axe.axe,
                    cellules: [
                      libelle(LIBELLES_AXE_EVALUATION, axe.axe),
                      totalPoids > 0
                        ? formatPourcentage(
                            (axe.poids.toNumber() / totalPoids) * 100,
                            2,
                          )
                        : "—",
                      score(axe.score),
                      axe.retenu ? (
                        <Etiquette key="r" ton="succes">
                          Oui
                        </Etiquette>
                      ) : (
                        <Etiquette key="r" ton="alerte">
                          Non
                        </Etiquette>
                      ),
                      axe.raisonExclusion ?? "—",
                    ],
                  }))}
                  messageVide="Aucun axe n'a pu etre evalue."
                />
              </Carte>
            </div>

            <div className="mt-4">
              <Carte
                titre="Detail des indicateurs"
                description="Chaque indicateur expose sa valeur, son score, son nombre d'observations et sa fiabilite."
                sansPadding
              >
                <Tableau
                  colonnes={[
                    { cle: "axe", libelle: "Axe" },
                    { cle: "indicateur", libelle: "Indicateur" },
                    { cle: "valeur", libelle: "Valeur mesuree", nombre: true },
                    { cle: "score", libelle: "Score", nombre: true },
                    { cle: "observations", libelle: "Observations", nombre: true },
                    { cle: "fiable", libelle: "Fiabilite" },
                  ]}
                  lignes={apercu.axes.flatMap((axe) =>
                    axe.indicateurs.map((indicateur) => ({
                      cle: `${axe.axe}-${indicateur.code}`,
                      cellules: [
                        libelle(LIBELLES_AXE_EVALUATION, axe.axe),
                        indicateur.label,
                        score(indicateur.valeur),
                        score(indicateur.score),
                        indicateur.observations,
                        indicateur.fiable ? (
                          <Etiquette key="f" ton="succes">
                            Suffisante
                          </Etiquette>
                        ) : (
                          <Etiquette key="f" ton="alerte">
                            Insuffisante
                          </Etiquette>
                        ),
                      ],
                    })),
                  )}
                  messageVide="Aucun indicateur disponible sur la periode."
                />
              </Carte>
            </div>

            <div className="mt-4">
              <Carte
                titre="Operations prises en compte"
                description="Seules les operations pour lesquelles une affectation ou une declaration reelle existe figurent ici. Chaque operation est comparee a sa propre norme."
                sansPadding
              >
                <Tableau
                  colonnes={[
                    { cle: "operation", libelle: "Operation" },
                    { cle: "effectuee", libelle: "Reellement effectuee" },
                    { cle: "affectations", libelle: "Affectations", nombre: true },
                    { cle: "produite", libelle: "Quantite produite", nombre: true },
                    { cle: "conforme", libelle: "Quantite conforme", nombre: true },
                    { cle: "rebut", libelle: "Rebut", nombre: true },
                    { cle: "minutesDeclarees", libelle: "Minutes declarees", nombre: true },
                    { cle: "minutesNormales", libelle: "Minutes normales", nombre: true },
                    { cle: "efficience", libelle: "Efficience temps", nombre: true },
                  ]}
                  lignes={apercu.operationsEvaluees.map((ligne) => ({
                    cle: String(ligne.operationId),
                    cellules: [
                      `${ligne.operationCode} — ${ligne.operationLabel}`,
                      ligne.reellementEffectuee ? (
                        <Etiquette key="re" ton="succes">
                          Oui
                        </Etiquette>
                      ) : (
                        <Etiquette key="re" ton="danger">
                          Non
                        </Etiquette>
                      ),
                      ligne.affectations,
                      formatQuantite(ligne.quantiteProduite),
                      formatQuantite(ligne.quantiteConforme),
                      formatQuantite(ligne.quantiteRebut),
                      formatQuantite(ligne.minutesDeclarees, 1),
                      formatQuantite(ligne.minutesNormales, 1),
                      ligne.efficienceTemps ? ligne.efficienceTemps.toFixed(4) : "—",
                    ],
                  }))}
                  messageVide="Aucune operation reellement effectuee sur la periode : l'evaluation ne peut pas etre construite."
                />
              </Carte>
            </div>

            {peutCalculer && (
              <div className="mt-4">
                <Carte
                  titre="Enregistrer cette evaluation"
                  description="L'evaluation est recalculee cote serveur avant enregistrement : aucune valeur affichee ici n'est transmise. L'enregistrement ne vaut pas validation."
                >
                  <FormulaireAction
                    action={actionEnregistrerEvaluation}
                    libelleSoumettre="Calculer et enregistrer"
                  >
                    <input type="hidden" name="employeeId" value={apercu.employeeId} />
                    <input
                      type="hidden"
                      name="periodType"
                      value={apercu.periodType}
                    />
                    <input
                      type="hidden"
                      name="reference"
                      value={toInputDate(referenceApercu)}
                    />
                    {apercu.operationId !== null && (
                      <input
                        type="hidden"
                        name="operationId"
                        value={apercu.operationId}
                      />
                    )}
                  </FormulaireAction>
                </Carte>
              </div>
            )}
          </div>
        )}
      </Section>

      <Section titre="Evaluations enregistrees">
        <Carte
          titre={`${total} evaluation(s)`}
          description="Aucune evaluation n'est validee automatiquement : la validation est un acte explicite d'un responsable distinct de l'employe evalue."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "employe", libelle: "Employe" },
              { cle: "periode", libelle: "Periode" },
              { cle: "bornes", libelle: "Bornes" },
              { cle: "operation", libelle: "Operation" },
              { cle: "productivite", libelle: "Productivite", nombre: true },
              { cle: "qualite", libelle: "Qualite", nombre: true },
              { cle: "matiere", libelle: "Efficacite matiere", nombre: true },
              { cle: "presence", libelle: "Presence", nombre: true },
              { cle: "polyvalence", libelle: "Polyvalence", nombre: true },
              { cle: "global", libelle: "Score global", nombre: true },
              { cle: "fiabilite", libelle: "Fiabilite" },
              { cle: "validation", libelle: "Validation" },
              { cle: "valideur", libelle: "Valideur" },
              { cle: "commentaire", libelle: "Commentaire" },
              { cle: "actions", libelle: "Actions" },
            ]}
            lignes={evaluations.map((evaluation) => ({
              cle: String(evaluation.id),
              cellules: [
                <Link
                  key="e"
                  className="lien-nav"
                  href={`/rh/employes/${evaluation.employee.id}`}
                >
                  {`${evaluation.employee.matricule} — ${evaluation.employee.lastName} ${evaluation.employee.firstName}`.trim()}
                </Link>,
                libelle(LIBELLES_PERIODE_EVALUATION, evaluation.periodType),
                `${formatDate(evaluation.periodStart)} au ${formatDate(evaluation.periodEnd)}`,
                evaluation.operation
                  ? `${evaluation.operation.code} — ${evaluation.operation.label}`
                  : "Toutes operations",
                score(evaluation.productivityScore),
                score(evaluation.qualityScore),
                score(evaluation.materialEfficiencyScore),
                score(evaluation.attendanceScore),
                score(evaluation.versatilityScore),
                evaluation.globalScore
                  ? score(evaluation.globalScore)
                  : "Donnees insuffisantes",
                <EtiquetteStatut
                  key="f"
                  libelle={libelle(LIBELLES_FIABILITE, evaluation.reliability)}
                  code={evaluation.reliability}
                />,
                evaluation.isValidated ? (
                  <Etiquette key="v" ton="succes" titre={formatDate(evaluation.validatedAt)}>
                    Validee
                  </Etiquette>
                ) : (
                  <Etiquette key="v" ton="alerte">
                    En attente
                  </Etiquette>
                ),
                evaluation.validatedBy
                  ? `${evaluation.validatedBy.firstName} ${evaluation.validatedBy.lastName}`.trim()
                  : "—",
                <div key="c" className="flex flex-col gap-1">
                  <span>{evaluation.comment ?? "—"}</span>
                  {evaluation.isCorrected && (
                    <span className="text-xs" style={{ color: "var(--danger)" }}>
                      {`Corrigee : ${evaluation.correctionReason ?? "motif non renseigne"}`}
                    </span>
                  )}
                </div>,
                peutValider ? (
                  <div key="a" className="flex flex-col gap-2">
                    {evaluation.isValidated ? (
                      <Etiquette ton="neutre">Deja validee</Etiquette>
                    ) : evaluation.reliability === "INSUFFISANTE" ? (
                      <Etiquette ton="danger" titre={libelle(LIBELLES_FIABILITE, "INSUFFISANTE")}>
                        Non validable
                      </Etiquette>
                    ) : (
                      <BoutonAction
                        action={actionValiderEvaluation}
                        libelle="Valider"
                        variante="primaire"
                        champsCaches={{ evaluationId: evaluation.id }}
                        confirmation="Valider cette evaluation ? Vous serez enregistre comme valideur."
                      />
                    )}
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold">
                        Corriger avec justification
                      </summary>
                      <FormulaireMotif
                        action={actionCorrigerEvaluation}
                        libelleSoumettre="Enregistrer la correction"
                        varianteSoumettre="danger"
                        libelleMotif="Justification de la correction"
                        motifMinimum={10}
                        champsCaches={{ evaluationId: evaluation.id }}
                      />
                    </details>
                  </div>
                ) : (
                  "Consultation seule"
                ),
              ],
            }))}
            messageVide="Aucune evaluation ne correspond aux filtres selectionnes."
          />
          <Pagination
            page={Math.min(liste.page, bornes.pages)}
            pages={bornes.pages}
            total={total}
            construireLien={fabricantLien("/rh/evaluations", {
              q: liste.recherche,
              division: liste.filtres.division,
              periode: liste.filtres.periode,
              validees: liste.filtres.validees,
            })}
          />
        </Carte>
      </Section>

      <div className="mt-5">
        <Carte titre="Filtres des evaluations enregistrees">
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Champ
              nom="q"
              libelle="Recherche"
              type="search"
              valeur={liste.recherche}
              aide="Matricule, nom ou prenom de l'employe evalue."
            />
            <Champ
              nom="division"
              libelle="Division"
              type="select"
              valeur={liste.filtres.division}
              options={portee.map((usine) => ({
                valeur: usine,
                libelle: libelle(LIBELLES_USINE, usine),
              }))}
            />
            <Champ
              nom="periode"
              libelle="Periode"
              type="select"
              valeur={liste.filtres.periode}
              options={Object.entries(LIBELLES_PERIODE_EVALUATION).map(
                ([valeur, texte]) => ({ valeur, libelle: texte }),
              )}
              aide="Filtre la liste et sert de periode a l'apercu de calcul."
            />
            <Champ
              nom="validees"
              libelle="Validation"
              type="select"
              valeur={liste.filtres.validees}
              options={[
                { valeur: "oui", libelle: "Validees uniquement" },
                { valeur: "non", libelle: "En attente de validation" },
              ]}
            />
            {employeId !== null && (
              <input type="hidden" name="employe" value={employeId} />
            )}
            {referenceBrute && (
              <input type="hidden" name="reference" value={referenceBrute} />
            )}
            {operationApercuId !== null && (
              <input type="hidden" name="operation" value={operationApercuId} />
            )}
            <div className="flex items-end">
              <button
                type="submit"
                className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
              >
                Filtrer
              </button>
            </div>
          </form>
        </Carte>
      </div>
    </>
  );
}
