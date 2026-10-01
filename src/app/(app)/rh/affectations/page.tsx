import Link from "next/link";
import type { AssignmentStatus, Factory, Prisma } from "@prisma/client";
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
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Pagination,
  Statistique,
  Tableau,
} from "@/components/ui";
import { BoutonAction, Champ, FormulaireAction } from "@/components/interactif";
import { formatDate, formatDateTime, formatDuree, toInputDate } from "@/lib/format";
import { LIBELLES_STATUT_AFFECTATION, LIBELLES_USINE, libelle } from "@/lib/libelles";
import {
  actionAffecterEmploye,
  actionCloturerAffectation,
  actionDemarrerAffectation,
  actionReaffecterEmploye,
} from "@/actions/rh";

export const metadata = { title: "Affectations quotidiennes" };

/**
 * Affectations quotidiennes de l'atelier.
 *
 * Rappel metier affiche en tete de page : la polyvalence est la regle, un employe
 * peut etre affecte chaque jour a une operation differente, et son evaluation ne
 * portera que sur les operations qu'il aura reellement effectuees.
 */

function jourSeul(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function dateDemandee(valeur: string | null): Date {
  if (!valeur) return jourSeul(new Date());
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? jourSeul(new Date()) : jourSeul(date);
}

function statutDemande(valeur: string | null): AssignmentStatus | null {
  return valeur && valeur in LIBELLES_STATUT_AFFECTATION
    ? (valeur as AssignmentStatus)
    : null;
}

/** Duree reelle entre le debut et la fin d'une affectation, pauses deduites. */
function dureeReelle(affectation: {
  actualStart: Date | null;
  actualEnd: Date | null;
  breakMinutes: number;
}): number | null {
  if (!affectation.actualStart) return null;
  const fin = affectation.actualEnd ?? new Date();
  const minutes =
    (fin.getTime() - affectation.actualStart.getTime()) / 60_000 -
    affectation.breakMinutes;
  return minutes > 0 ? minutes : 0;
}

const STATUTS_FERMES: AssignmentStatus[] = ["TERMINEE", "ANNULEE"];

export default async function PageAffectations({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.RH_AFFECTATION_LIRE);
  const parametres = await searchParams;
  const liste = lireParametresListe(parametres, ["date", "division", "atelier", "statut"]);

  const portee = usinesAutorisees(utilisateur);
  const jour = dateDemandee(liste.filtres.date);
  const divisionDemandee = liste.filtres.division;
  const division: Factory | null =
    divisionDemandee &&
    divisionDemandee in LIBELLES_USINE &&
    portee.includes(divisionDemandee as Factory)
      ? (divisionDemandee as Factory)
      : null;
  const atelierId = identifiantOuNull(liste.filtres.atelier);
  const statut = statutDemande(liste.filtres.statut);

  const peutGerer = aLaPermission(utilisateur, PERMISSIONS.RH_AFFECTATION_GERER);

  const where: Prisma.AssignmentWhereInput = {
    date: jour,
    factory: { in: division ? [division] : portee },
    ...(atelierId ? { workshopId: atelierId } : {}),
    ...(statut ? { status: statut } : {}),
  };

  const total = await prisma.assignment.count({ where });
  const bornes = pagination(total, liste.page, liste.taille);

  const [affectations, employes, operations, ordresFabrication, ateliers] =
    await Promise.all([
      prisma.assignment.findMany({
        where,
        orderBy: [{ status: "asc" }, { employeeId: "asc" }],
        skip: bornes.skip,
        take: bornes.take,
        include: {
          employee: {
            select: { id: true, matricule: true, firstName: true, lastName: true },
          },
          operation: { select: { code: true, label: true } },
          workOrder: { select: { id: true, number: true } },
          workCenter: { select: { code: true, label: true } },
          workshop: { select: { code: true, label: true } },
          responsible: { select: { firstName: true, lastName: true } },
        },
      }),
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
      prisma.workOrder.findMany({
        where: {
          factory: { in: portee },
          status: { notIn: ["CLOTURE", "ANNULE"] },
        },
        orderBy: { number: "desc" },
        take: 200,
        select: { id: true, number: true },
      }),
      prisma.workshop.findMany({
        where: {
          isActive: true,
          factory: { in: division ? [division, "COMMUN"] : portee },
        },
        orderBy: [{ factory: "asc" }, { code: "asc" }],
        take: 200,
        select: { id: true, code: true, label: true },
      }),
    ]);

  const enCours = await prisma.assignment.count({
    where: { ...where, status: "EN_COURS" },
  });
  const planifiees = await prisma.assignment.count({
    where: { ...where, status: "PLANIFIEE" },
  });
  const terminees = await prisma.assignment.count({
    where: { ...where, status: "TERMINEE" },
  });

  return (
    <>
      <EnTetePage
        titre="Affectations quotidiennes"
        description={`Journee du ${formatDate(jour)}. La polyvalence est la regle : un employe peut etre affecte chaque jour a une operation differente, et son evaluation ne portera que sur les operations qu'il a reellement effectuees.`}
        actions={
          <Link className="lien-nav text-sm" href="/rh/employes">
            Fiches employes
          </Link>
        }
      />

      <Alerte ton="info" titre="Portee de l'evaluation">
        Une affectation n'est jamais une evaluation : seul le travail reellement
        declare, operation par operation, alimente le calcul de performance. Une
        affectation planifiee mais non effectuee ne produit aucun resultat.
      </Alerte>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Statistique libelle="Planifiees" valeur={planifiees} ton="info" />
        <Statistique libelle="En cours" valeur={enCours} ton="primaire" />
        <Statistique libelle="Terminees" valeur={terminees} ton="succes" />
      </div>

      <div className="mt-5">
        <Carte titre="Filtres">
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Champ
              nom="date"
              libelle="Journee"
              type="date"
              valeur={toInputDate(jour)}
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
              nom="atelier"
              libelle="Atelier"
              type="select"
              valeur={liste.filtres.atelier}
              options={ateliers.map((atelier) => ({
                valeur: atelier.id,
                libelle: `${atelier.code} — ${atelier.label}`,
              }))}
            />
            <Champ
              nom="statut"
              libelle="Statut"
              type="select"
              valeur={liste.filtres.statut}
              options={Object.entries(LIBELLES_STATUT_AFFECTATION).map(
                ([valeur, texte]) => ({ valeur, libelle: texte }),
              )}
            />
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

      {peutGerer && (
        <div className="mt-5">
          <Carte
            titre="Affecter un employe"
            description="Affectation a une operation pour la journee choisie. Une affectation deja planifiee sur le meme creneau horaire est refusee."
          >
            <FormulaireAction
              action={actionAffecterEmploye}
              libelleSoumettre="Affecter l'employe"
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Champ
                  nom="date"
                  libelle="Journee"
                  type="date"
                  requis
                  valeur={toInputDate(jour)}
                />
                <Champ
                  nom="employeeId"
                  libelle="Employe"
                  type="select"
                  requis
                  options={employes.map((employe) => ({
                    valeur: employe.id,
                    libelle: `${employe.matricule} — ${employe.lastName} ${employe.firstName}`,
                  }))}
                />
                <Champ
                  nom="operationId"
                  libelle="Operation"
                  type="select"
                  requis
                  options={operations.map((operation) => ({
                    valeur: operation.id,
                    libelle: `${operation.code} — ${operation.label}`,
                  }))}
                />
                <Champ
                  nom="workOrderId"
                  libelle="Ordre de fabrication"
                  type="select"
                  options={ordresFabrication.map((ordre) => ({
                    valeur: ordre.id,
                    libelle: ordre.number,
                  }))}
                  aide="Facultatif : une affectation peut porter sur une operation hors ordre."
                />
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">
                    Heure de debut prevue
                  </span>
                  <input className="champ" type="time" name="plannedStart" />
                  <span
                    className="mt-1 block text-xs"
                    style={{ color: "var(--texte-doux)" }}
                  >
                    Les deux heures doivent etre renseignees pour controler les
                    chevauchements.
                  </span>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Heure de fin prevue</span>
                  <input className="champ" type="time" name="plannedEnd" />
                </label>
                <Champ nom="comment" libelle="Commentaire" type="textarea" />
              </div>
              {utilisateur.employeeId && (
                <input
                  type="hidden"
                  name="responsibleId"
                  value={utilisateur.employeeId}
                />
              )}
            </FormulaireAction>
          </Carte>
        </div>
      )}

      <div className="mt-5">
        <Carte
          titre={`${total} affectation(s)`}
          description="Heures prevues et heures reelles constatees."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "employe", libelle: "Employe" },
              { cle: "operation", libelle: "Operation ou poste" },
              { cle: "ordre", libelle: "Ordre de fabrication" },
              { cle: "atelier", libelle: "Atelier" },
              { cle: "statut", libelle: "Statut" },
              { cle: "prevu", libelle: "Heures prevues" },
              { cle: "reel", libelle: "Heures reelles" },
              { cle: "responsable", libelle: "Responsable" },
              { cle: "actions", libelle: "Actions" },
            ]}
            lignes={affectations.map((affectation) => ({
              cle: String(affectation.id),
              cellules: [
                <Link
                  key="e"
                  className="lien-nav"
                  href={`/rh/employes/${affectation.employee.id}`}
                >
                  {`${affectation.employee.matricule} — ${affectation.employee.lastName} ${affectation.employee.firstName}`.trim()}
                </Link>,
                `${affectation.operation.code} — ${affectation.operation.label}${
                  affectation.workCenter
                    ? ` (${affectation.workCenter.code})`
                    : ""
                }`,
                affectation.workOrder ? (
                  <Link
                    key="o"
                    className="lien-nav"
                    href={`/production/${affectation.workOrder.id}`}
                  >
                    {affectation.workOrder.number}
                  </Link>
                ) : (
                  "Hors ordre"
                ),
                affectation.workshop
                  ? `${affectation.workshop.code} — ${affectation.workshop.label}`
                  : "-",
                <div key="s" className="flex flex-col gap-1">
                  <EtiquetteStatut
                    libelle={libelle(
                      LIBELLES_STATUT_AFFECTATION,
                      affectation.status,
                    )}
                    code={affectation.status}
                  />
                  {affectation.changeReason && (
                    <span className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      {`Motif : ${affectation.changeReason}`}
                    </span>
                  )}
                </div>,
                affectation.plannedStart || affectation.plannedEnd
                  ? `${formatDateTime(affectation.plannedStart)} → ${formatDateTime(affectation.plannedEnd)}`
                  : "Non planifiees",
                affectation.actualStart
                  ? `${formatDateTime(affectation.actualStart)} → ${formatDateTime(affectation.actualEnd)} (${formatDuree(dureeReelle(affectation) ?? 0)} nettes)`
                  : "Aucun pointage",
                affectation.responsible
                  ? `${affectation.responsible.firstName} ${affectation.responsible.lastName}`.trim()
                  : "-",
                peutGerer ? (
                  <div key="a" className="flex flex-col gap-2">
                    {affectation.status === "PLANIFIEE" ||
                    affectation.status === "EN_PAUSE" ? (
                      <BoutonAction
                        action={actionDemarrerAffectation}
                        libelle="Demarrer"
                        variante="primaire"
                        champsCaches={{ assignmentId: affectation.id }}
                      />
                    ) : null}
                    {!STATUTS_FERMES.includes(affectation.status) ? (
                      <>
                        <BoutonAction
                          action={actionCloturerAffectation}
                          libelle="Cloturer"
                          champsCaches={{ assignmentId: affectation.id }}
                          confirmation="Cloturer cette affectation ? Les heures reelles serviront de base a l'evaluation."
                        />
                        <details>
                          <summary className="cursor-pointer text-xs font-semibold">
                            Reaffecter en cours de journee
                          </summary>
                          <FormulaireAction
                            action={actionReaffecterEmploye}
                            libelleSoumettre="Reaffecter"
                            varianteSoumettre="danger"
                            reinitialiser
                            discret
                          >
                            <input
                              type="hidden"
                              name="assignmentId"
                              value={affectation.id}
                            />
                            <Champ
                              nom="versOperationId"
                              libelle="Nouvelle operation"
                              type="select"
                              requis
                              options={operations.map((operation) => ({
                                valeur: operation.id,
                                libelle: `${operation.code} — ${operation.label}`,
                              }))}
                            />
                            <label className="mt-2 block text-sm">
                              <span className="mb-1 block font-medium">
                                Motif de la reaffectation
                              </span>
                              <textarea
                                className="champ"
                                name="motif"
                                rows={2}
                                required
                                minLength={5}
                                placeholder="Motif obligatoire (au moins 5 caracteres)"
                              />
                            </label>
                          </FormulaireAction>
                        </details>
                      </>
                    ) : null}
                    {STATUTS_FERMES.includes(affectation.status) ? (
                      <Etiquette ton="neutre">Affectation close</Etiquette>
                    ) : null}
                  </div>
                ) : (
                  "Consultation seule"
                ),
              ],
            }))}
            messageVide="Aucune affectation ne correspond a la journee et aux filtres selectionnes."
          />
          <Pagination
            page={Math.min(liste.page, bornes.pages)}
            pages={bornes.pages}
            total={total}
            construireLien={fabricantLien("/rh/affectations", {
              date: liste.filtres.date,
              division: liste.filtres.division,
              atelier: liste.filtres.atelier,
              statut: liste.filtres.statut,
            })}
          />
        </Carte>
      </div>
    </>
  );
}
