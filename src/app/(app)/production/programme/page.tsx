import Link from "next/link";
import { prisma } from "@/lib/db";
import { aLaPermission, exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { premiereValeur, construireLien } from "@/lib/liste";
import {
  actionAjouterTacheProgramme,
  actionOuvrirProgramme,
  actionPublierProgramme,
  actionReaffecterTacheProgramme,
  actionReviserProgramme,
} from "@/actions/atelier";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  Statistique,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { ProgrammeTaches } from "@/components/taches-programme";
import {
  codeProgramme,
  programmeDeLaSemaine,
  programmeDuJour,
  proposerAffectations,
  type PropositionAffectation,
} from "@/lib/mes/programme";
import { jourCivilDecale, jourCivilMetier, jourMetier, semaineIso } from "@/lib/mes/jour";
import { formatDate, formatHeure, formatQuantite } from "@/lib/format";
import { LIBELLES_USINE } from "@/lib/libelles";
import type { Factory } from "@prisma/client";

export const metadata = { title: "Programme de travail" };

const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function estFactory(valeur: string | null): valeur is Factory {
  return valeur === "ADMEDCO" || valeur === "MOBILIX" || valeur === "COMMUN";
}

/**
 * Programme de travail de l'atelier.
 *
 * La journee est celle d'Africa/Algiers : elle ne depend ni du fuseau du
 * serveur ni de celui du navigateur. La vue « semaine » est une lecture : on ne
 * publie qu'une journee ou une semaine a la fois, et un programme deja publie
 * ne se modifie plus en silence — il se revise.
 */
export default async function PageProgramme({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.PRODUCTION_PLANNING_LIRE);
  const peutGerer = aLaPermission(utilisateur, PERMISSIONS.PRODUCTION_PLANNING_GERER);

  const parametres = await searchParams;
  const vueSemaine = premiereValeur(parametres, "vue") === "semaine";
  const dateSaisie = premiereValeur(parametres, "date");
  const reference = dateSaisie
    ? new Date(`${dateSaisie}T12:00:00Z`)
    : new Date();
  const referenceValide = Number.isNaN(reference.getTime()) ? new Date() : reference;
  const jour = jourMetier(referenceValide);

  const usines = usinesAutorisees(utilisateur);
  const usineParam = premiereValeur(parametres, "usine");
  const usineFiltre: Factory | undefined = estFactory(usineParam)
    ? usineParam
    : (usines[0] ?? undefined);
  if (usineFiltre && !usines.includes(usineFiltre)) {
    return (
      <>
        <EnTetePage titre="Programme de travail" />
        <Alerte ton="danger" titre="Perimetre insuffisant">
          Vous n'avez pas acces a la division {usineFiltre}.
        </Alerte>
      </>
    );
  }

  const atelierId = premiereValeur(parametres, "atelier");
  const posteId = premiereValeur(parametres, "poste");
  const atelierNumerique = atelierId ? Number.parseInt(atelierId, 10) : null;
  const posteNumerique = posteId ? Number.parseInt(posteId, 10) : null;

  const filtres = {
    factory: usineFiltre,
    workshopId:
      atelierNumerique && Number.isFinite(atelierNumerique)
        ? atelierNumerique
        : undefined,
    workCenterId:
      posteNumerique && Number.isFinite(posteNumerique) ? posteNumerique : undefined,
  };

  const [ateliers, postes, employes, semaineProgramme] = await Promise.all([
    usineFiltre
      ? prisma.workshop.findMany({
          where: { factory: usineFiltre, isActive: true },
          select: { id: true, code: true, label: true },
          orderBy: { code: "asc" },
        })
      : Promise.resolve([]),
    prisma.workCenter.findMany({
      where: {
        isActive: true,
        ...(usineFiltre ? { factory: usineFiltre } : {}),
        ...(filtres.workshopId ? { workshopId: filtres.workshopId } : {}),
      },
      select: { id: true, code: true, label: true },
      orderBy: { code: "asc" },
    }),
    prisma.employee.findMany({
      where: {
        isActive: true,
        ...(usineFiltre && usineFiltre !== "COMMUN"
          ? { factory: { in: [usineFiltre, "COMMUN"] } }
          : {}),
      },
      select: { id: true, matricule: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 500,
    }),
    programmeDeLaSemaine(filtres),
  ]);

  const programmeJour = await programmeDuJour(filtres);
  const tachesDuJour = vueSemaine
    ? (semaineProgramme.jours.find((item) => item.jour === jour)?.taches ?? [])
    : programmeJour.taches;

  // Programmes couvrant la journee : l'un est publie, l'autre en brouillon.
  const dateCivile = jourCivilMetier(referenceValide);
  const programmes = await prisma.workSchedule.findMany({
    where: {
      periodStart: { lte: dateCivile },
      periodEnd: { gte: dateCivile },
      ...(usineFiltre ? { factory: usineFiltre } : {}),
      ...(filtres.workshopId ? { workshopId: filtres.workshopId } : {}),
    },
    include: {
      workshop: { select: { code: true, label: true } },
      replaces: { select: { code: true } },
      _count: { select: { assignments: true } },
    },    orderBy: { createdAt: "desc" },
  });

  const brouillon = programmes.find((item) => item.status === "BROUILLON") ?? null;
  const publie = programmes.find((item) => item.status === "PUBLIE") ?? null;

  // Propositions : rien n'est ecrit, chaque ligne dit pourquoi et avec quelles
  // reserves. Le responsable tranche.
  const propositions = peutGerer
    ? await proposerAffectations({ ...filtres, at: referenceValide, limite: 25 })
    : [];

  const { annee, semaine } = semaineIso(referenceValide);
  const jourSuivant = jourMetier(jourCivilDecale(referenceValide, vueSemaine ? 7 : 1));
  const jourPrecedent = jourMetier(jourCivilDecale(referenceValide, vueSemaine ? -7 : -1));
  const lienBase = { vue: vueSemaine ? "semaine" : null, usine: usineFiltre ?? null, atelier: atelierId, poste: posteId };

  // Operations d'OF reellement planifiables : celles qui restent a produire sur
  // des ordres lances. Le poste est propose depuis l'operation, pas l'inverse.
  const operationsPlanifiables = peutGerer
    ? await prisma.workOrderOperation.findMany({
        where: {
          status: { in: ["NON_DEMARREE", "EN_COURS", "EN_PAUSE"] },
          workOrder: {
            status: { in: ["LANCE", "EN_COURS", "SUSPENDU", "PARTIELLEMENT_TERMINE"] },
            ...(usineFiltre ? { factory: usineFiltre } : {}),
            ...(filtres.workshopId ? { workshopId: filtres.workshopId } : {}),
          },
        },
        select: {
          id: true,
          stepNo: true,
          quantityPlanned: true,
          quantityProduced: true,
          workCenterId: true,
          operation: { select: { code: true, label: true } },
          workOrder: {
            select: { id: true, number: true, priority: true, dueDate: true },
          },
        },
        orderBy: [{ workOrder: { number: "asc" } }, { stepNo: "asc" }],
        take: 300,
      })
    : [];

  const tachesParEmploye = new Map<string, typeof tachesDuJour>();
  for (const tache of tachesDuJour) {
    const cle = `${tache.matricule} — ${tache.employe}`;
    const liste = tachesParEmploye.get(cle) ?? [];
    liste.push(tache);
    tachesParEmploye.set(cle, liste);
  }

  const employesSansTache = employes.filter(
    (employe) =>
      !tachesDuJour.some((tache) => tache.employeId === employe.id),
  );

  return (
    <>
      <EnTetePage
        titre="Programme de travail"
        description={`Journee metier Africa/Algiers · ${formatDate(referenceValide)}${vueSemaine ? ` · semaine ${semaine} de ${annee}` : ""}`}
        actions={
          <>
            <Link
              className="bouton secondaire"
              href={construireLien("/production/programme", {
                ...lienBase,
                vue: vueSemaine ? null : "semaine",
                date: `${jour}`,
              })}
            >
              {vueSemaine ? "Vue du jour" : "Vue de la semaine"}
            </Link>
            <Link className="bouton secondaire" href="/production/feuille-de-route">
              Feuille de route
            </Link>
            <Link className="bouton secondaire" href="/production/postes">
              QR des postes
            </Link>
          </>
        }
      />

      <Carte titre="Periode et filtres">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
          <input type="hidden" name="vue" value={vueSemaine ? "semaine" : "jour"} />
          <Champ
            nom="date"
            libelle="Journee de reference"
            type="date"
            valeur={jour}
          />
          <Champ
            nom="usine"
            libelle="Division"
            type="select"
            valeur={usineFiltre ?? ""}
            options={usines.map((usine) => ({
              valeur: usine,
              libelle: LIBELLES_USINE[usine] ?? usine,
            }))}
          />
          <Champ
            nom="atelier"
            libelle="Atelier"
            type="select"
            valeur={atelierId ?? ""}
            options={[
              { valeur: "", libelle: "Tous les ateliers" },
              ...ateliers.map((atelier) => ({
                valeur: atelier.id,
                libelle: `${atelier.code} — ${atelier.label}`,
              })),
            ]}
          />
          <Champ
            nom="poste"
            libelle="Poste"
            type="select"
            valeur={posteId ?? ""}
            options={[
              { valeur: "", libelle: "Tous les postes" },
              ...postes.map((poste) => ({
                valeur: poste.id,
                libelle: `${poste.code} — ${poste.label}`,
              })),
            ]}
          />
          <div className="flex items-end gap-2">
            <button className="bouton primaire" type="submit">
              Appliquer
            </button>
            <Link
              className="bouton secondaire"
              href={construireLien("/production/programme", { ...lienBase, date: jourPrecedent })}
            >
              Precedent
            </Link>
            <Link
              className="bouton secondaire"
              href={construireLien("/production/programme", { ...lienBase, date: jourSuivant })}
            >
              Suivant
            </Link>
          </div>
        </form>
      </Carte>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Statistique libelle="Taches du jour" valeur={tachesDuJour.length} />
        <Statistique
          libelle="Employes affectes"
          valeur={new Set(tachesDuJour.map((tache) => tache.employeId)).size}
        />
        <Statistique
          libelle="Employes sans tache"
          valeur={employesSansTache.length}
          detail={vueSemaine ? undefined : "Sur la journee affichee"}
        />
        <Statistique
          libelle="Programme"
          valeur={publie ? "Publie" : brouillon ? "Brouillon" : "Aucun"}
          detail={publie?.code ?? brouillon?.code ?? codeProgramme({
            factory: usineFiltre ?? "ADMEDCO",
            reference: referenceValide,
            portee: "JOUR",
            workshopId: filtres.workshopId,
          })}
          ton={publie ? "succes" : brouillon ? "alerte" : "neutre"}
        />
      </div>

      {!publie && !brouillon && (
        <div className="mt-4">
          <Alerte ton="alerte" titre="Aucun programme pour cette periode">
            Les taches affichees ci-dessous viennent des affectations existantes.
            Ouvrez un programme pour cette periode afin de pouvoir le diffuser et
            le suivre comme une reference unique.
          </Alerte>
        </div>
      )}

      {brouillon && peutGerer && (
        <div className="mt-4">
          <Carte
            titre={`Programme brouillon ${brouillon.code}`}
            description={`Periode du ${formatDate(brouillon.periodStart)} au ${formatDate(brouillon.periodEnd)} · ${brouillon._count.assignments} tache(s)${brouillon.replaces ? ` · remplace ${brouillon.replaces.code}` : ""}`}
            actions={
              <FormulaireAction
                action={actionPublierProgramme}
                libelleSoumettre="Publier le programme"
                varianteSoumettre="primaire"
              >
                <input type="hidden" name="scheduleId" value={brouillon.id} />
                <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                  Publier diffuse le programme a l'atelier. Un programme publie ne
                  se modifie plus : toute evolution passe par une revision tracee.
                </p>
              </FormulaireAction>
            }
          >
            <FormulaireAction
              action={actionReviserProgramme}
              libelleSoumettre="Ouvrir une revision"
              varianteSoumettre="secondaire"
            >
              <input type="hidden" name="scheduleId" value={brouillon.id} />
              <Champ
                nom="motif"
                libelle="Motif de la revision"
                requis
                maxLength={200}
                aide="Obligatoire : l'ancienne version reste consultable en archive."
              />
            </FormulaireAction>
          </Carte>
        </div>
      )}

      {publie && peutGerer && !brouillon && (
        <div className="mt-4">
          <Carte
            titre={`Programme publie ${publie.code}`}
            description={`Periode du ${formatDate(publie.periodStart)} au ${formatDate(publie.periodEnd)}${publie.publishedAt ? ` · publie le ${formatDate(publie.publishedAt)}` : ""}${publie.replaces ? ` · remplace ${publie.replaces.code}` : ""}`}
          >
            <FormulaireAction
              action={actionReviserProgramme}
              libelleSoumettre="Ouvrir une revision"
              varianteSoumettre="secondaire"
            >
              <input type="hidden" name="scheduleId" value={publie.id} />
              <Champ
                nom="motif"
                libelle="Motif de la revision"
                requis
                maxLength={200}
                aide="Une revision cree un nouveau programme ; l'ancien passe en archive."
              />
            </FormulaireAction>
          </Carte>
        </div>
      )}

      {!brouillon && peutGerer && (
        <div className="mt-4">
          <Carte
            titre="Ouvrir un programme"
            description="Un programme par journee ou par semaine, pour une division et un atelier."
          >
            <FormulaireAction
              action={actionOuvrirProgramme}
              libelleSoumettre="Ouvrir le programme"
              varianteSoumettre="primaire"
            >
              <input type="hidden" name="reference" value={jour} />
              <input type="hidden" name="factory" value={usineFiltre ?? ""} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Champ
                  nom="portee"
                  libelle="Portee"
                  type="select"
                  valeur="JOUR"
                  options={[
                    { valeur: "JOUR", libelle: "Journee" },
                    { valeur: "SEMAINE", libelle: "Semaine entiere" },
                  ]}
                />
                <Champ
                  nom="workshopId"
                  libelle="Atelier"
                  type="select"
                  valeur={atelierId ?? ""}
                  options={[
                    { valeur: "", libelle: "Tous les ateliers de la division" },
                    ...ateliers.map((atelier) => ({
                      valeur: atelier.id,
                      libelle: `${atelier.code} — ${atelier.label}`,
                    })),
                  ]}
                />
                <Champ
                  nom="label"
                  libelle="Libelle (facultatif)"
                  maxLength={120}
                />
              </div>
            </FormulaireAction>
          </Carte>
        </div>
      )}

      {vueSemaine ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {semaineProgramme.jours.map((item, index) => (
            <Carte
              key={item.jour}
              titre={`${JOURS_COURTS[index] ?? ""} ${formatDate(new Date(`${item.jour}T12:00:00Z`))}`}
              description={`${item.taches.length} tache(s)`}
            >
              {item.taches.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                  Aucune tache planifiee.
                </p>
              ) : (
                <ul className="grid gap-2 text-sm">
                  {item.taches.map((tache) => (
                    <li key={tache.assignmentId} className="flex flex-wrap items-center gap-2">
                      <Etiquette
                        ton={
                          tache.priority === "URGENTE"
                            ? "danger"
                            : tache.priority === "HAUTE"
                              ? "alerte"
                              : "neutre"
                        }
                      >
                        {tache.libellePriorite}
                      </Etiquette>
                      <span className="font-medium">
                        {tache.plannedStart ? formatHeure(tache.plannedStart) : "--:--"}
                      </span>
                      <span>{tache.operation}</span>
                      <span style={{ color: "var(--texte-doux)" }}>
                        {tache.poste ?? "poste a definir"}
                      </span>
                      <span style={{ color: "var(--texte-doux)" }}>
                        {tache.employe}
                      </span>
                      {tache.ordreFabrication && (
                        <span style={{ color: "var(--texte-doux)" }}>
                          OF {tache.ordreFabrication}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Carte>
          ))}
        </div>
      ) : (
        <>
          {tachesParEmploye.size === 0 ? (
            <div className="mt-4">
              <Alerte ton="info" titre="Aucune tache ce jour">
                Aucune affectation n'est planifiee pour cette journee et ces
                filtres. Ajoutez une tache, ou partez d'une proposition
                ci-dessous.
              </Alerte>
            </div>
          ) : (
            <div className="mt-4 grid gap-4">
              {[...tachesParEmploye.entries()].map(([nom, taches]) => (
                <div key={nom}>
                  <ProgrammeTaches taches={taches} titre={nom} />
                </div>
              ))}
            </div>
          )}

          {peutGerer && tachesDuJour.length > 0 && (
            <div className="mt-4">
              <Carte
                titre="Reaffecter une tache"
                description="Chaque reaffectation est historisee : qui, quand, pourquoi, et ce qui a change. Le poste scanne est remis a zero afin que la nouvelle paire employe/poste soit reverifiee par un scan reel."
              >
                <div className="grid gap-3">
                  {tachesDuJour.map((tache) => (
                    <details key={tache.assignmentId} className="rounded border p-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        {tache.employe} · {tache.operation} ·{" "}
                        {tache.poste ?? "poste a definir"} ·{" "}
                        {formatQuantite(tache.quantitePrevue)}
                        {tache.changements.length > 0
                          ? ` · ${tache.changements.length} changement(s)`
                          : ""}
                      </summary>
                      <div className="mt-3">
                        <FormulaireAction
                          action={actionReaffecterTacheProgramme}
                          libelleSoumettre="Reaffecter"
                          varianteSoumettre="primaire"
                        >
                          <input
                            type="hidden"
                            name="assignmentId"
                            value={tache.assignmentId}
                          />
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <Champ
                              nom="versEmployeeId"
                              libelle="Nouvel employe"
                              type="select"
                              valeur={String(tache.employeId)}
                              options={employes.map((employe) => ({
                                valeur: employe.id,
                                libelle: `${employe.matricule} — ${employe.lastName} ${employe.firstName}`,
                              }))}
                            />
                            <Champ
                              nom="versWorkCenterId"
                              libelle="Nouveau poste"
                              type="select"
                              valeur={tache.workCenterId ? String(tache.workCenterId) : ""}
                              options={[
                                { valeur: "", libelle: "Poste inchange / a definir" },
                                ...postes.map((poste) => ({
                                  valeur: poste.id,
                                  libelle: `${poste.code} — ${poste.label}`,
                                })),
                              ]}
                            />
                            <Champ
                              nom="priority"
                              libelle="Priorite"
                              type="select"
                              valeur={tache.priority}
                              options={[
                                { valeur: "BASSE", libelle: "Basse" },
                                { valeur: "NORMALE", libelle: "Normale" },
                                { valeur: "HAUTE", libelle: "Haute" },
                                { valeur: "URGENTE", libelle: "Urgente" },
                              ]}
                            />
                            <Champ
                              nom="versSequence"
                              libelle="Ordre dans la journee"
                              type="number"
                              min={0}
                              valeur={String(tache.sequenceOrder)}
                              aide="1 = premiere tache de la journee."
                            />
                          </div>
                          <Champ
                            nom="motif"
                            libelle="Motif"
                            requis
                            maxLength={200}
                          />
                        </FormulaireAction>

                        {tache.changements.length > 0 && (
                          <Tableau
                            colonnes={[
                              { cle: "quand", libelle: "Quand" },
                              { cle: "type", libelle: "Type" },
                              { cle: "motif", libelle: "Motif" },
                            ]}
                            lignes={tache.changements.map((changement, index) => ({
                              cle: `${tache.assignmentId}-${index}`,
                              cellules: [
                                formatHeure(changement.changedAt),
                                changement.changeType,
                                changement.reason ?? "—",
                              ],
                            }))}
                          />
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </Carte>
            </div>
          )}

          {peutGerer && (
            <div className="mt-4">
              <Carte
                titre="Ajouter une tache"
                description="La tache est rattachee au programme de la periode. Si aucun programme n'est ouvert, ouvrez-le d'abord."
              >
                <FormulaireAction
                  action={actionAjouterTacheProgramme}
                  libelleSoumettre="Ajouter la tache"
                  varianteSoumettre="primaire"
                  rafraichir
                  reinitialiser
                >
                  <input
                    type="hidden"
                    name="scheduleId"
                    value={brouillon?.id ?? publie?.id ?? ""}
                  />
                  <input type="hidden" name="date" value={jour} />
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Champ
                      nom="workOrderOperationId"
                      libelle="Operation d'ordre de fabrication"
                      type="select"
                      requis
                      aide="L'operation et l'OF sont deduits de ce choix et verifies par le serveur."
                      options={[
                        { valeur: "", libelle: "Choisir une operation d'OF" },
                        ...operationsPlanifiables.map((operation) => ({
                          valeur: operation.id,
                          libelle: `${operation.workOrder.number} · etape ${operation.stepNo} · ${operation.operation.label} (${formatQuantite(operation.quantityProduced)} / ${formatQuantite(operation.quantityPlanned)})`,
                        })),
                      ]}
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
                      nom="workCenterId"
                      libelle="Poste"
                      type="select"
                      options={[
                        { valeur: "", libelle: "A definir" },
                        ...postes.map((poste) => ({
                          valeur: poste.id,
                          libelle: `${poste.code} — ${poste.label}`,
                        })),
                      ]}
                    />
                    <Champ
                      nom="plannedQuantity"
                      libelle="Quantite attendue"
                      type="number"
                      pas="0.000001"
                      min={0}
                    />
                    <Champ
                      nom="sequenceOrder"
                      libelle="Ordre"
                      type="number"
                      min={0}
                      valeur="0"
                    />
                    <Champ
                      nom="plannedStart"
                      libelle="Heure de debut"
                      type="time"
                      aide="Heure d'atelier (Africa/Algiers)."
                    />
                    <Champ
                      nom="plannedEnd"
                      libelle="Heure de fin"
                      type="time"
                      aide="Heure d'atelier (Africa/Algiers)."
                    />
                    <Champ
                      nom="priority"
                      libelle="Priorite"
                      type="select"
                      valeur="NORMALE"
                      options={[
                        { valeur: "BASSE", libelle: "Basse" },
                        { valeur: "NORMALE", libelle: "Normale" },
                        { valeur: "HAUTE", libelle: "Haute" },
                        { valeur: "URGENTE", libelle: "Urgente" },
                      ]}
                    />
                    <Champ nom="comment" libelle="Consigne" maxLength={200} />
                  </div>
                  <PropositionsAtelier propositions={propositions} />
                </FormulaireAction>
              </Carte>
            </div>
          )}
        </>
      )}
    </>
  );
}

/**
 * Propositions d'affectation : lecture seule, aucune ecriture. Chaque ligne
 * rappelle ses propres reserves pour que le responsable decide en connaissance
 * de cause, et non parce qu'un bouton etait disponible.
 */
function PropositionsAtelier({
  propositions,
}: {
  propositions: PropositionAffectation[];
}) {
  if (propositions.length === 0) return null;

  return (
    <div className="mt-5">
      <h3 className="text-sm font-semibold">
        Propositions (aucune ecriture, aucune commande)
      </h3>
      <p className="mb-2 text-sm" style={{ color: "var(--texte-doux)" }}>
        Ces propositions sont indicatives : elles ne remplacent ni les absences
        non saisies, ni les competences non renseignees, ni la decision du
        responsable.
      </p>
      <Tableau
        colonnes={[
          { cle: "of", libelle: "OF" },
          { cle: "operation", libelle: "Operation" },
          { cle: "poste", libelle: "Poste" },
          { cle: "reste", libelle: "Reste a produire", nombre: true },
          { cle: "employe", libelle: "Employe propose" },
          { cle: "pourquoi", libelle: "Pourquoi" },
        ]}
        lignes={propositions.map((proposition) => ({
          cle: String(proposition.workOrderOperationId),
          cellules: [
            proposition.ordreFabrication,
            proposition.operation,
            proposition.poste ?? "poste a definir",
            formatQuantite(proposition.quantiteRestante),
            proposition.employe ?? "aucun disponible identifie",
            <span key={`j-${proposition.workOrderOperationId}`} className="text-sm">
              {proposition.justification}
              {proposition.reserves.length > 0 && (
                <span className="block" style={{ color: "var(--texte-doux)" }}>
                  {proposition.reserves.join(" ")}
                </span>
              )}
            </span>,
          ],
        }))}
      />
    </div>
  );
}
