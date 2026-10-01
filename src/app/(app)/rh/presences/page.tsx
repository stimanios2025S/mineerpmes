import Link from "next/link";
import type { AttendanceStatus, Factory, Prisma } from "@prisma/client";
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
  Carte,
  EnTetePage,
  EtiquetteStatut,
  Pagination,
  Statistique,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import {
  formatDate,
  formatHeure,
  formatQuantite,
  toInputDate,
} from "@/lib/format";
import { LIBELLES_PRESENCE, LIBELLES_USINE, libelle } from "@/lib/libelles";
import { actionEnregistrerPresence } from "@/actions/rh";

export const metadata = { title: "Presences et temps de travail" };

/**
 * Pointages du personnel.
 *
 * Les heures travaillees ne sont pas saisies librement lorsque les heures
 * d'arrivee et de depart sont fournies : le service `enregistrerPresence` les
 * deduit du pointage, ce qui evite une incoherence entre les deux valeurs.
 */

function jourSeul(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function dateOu(valeur: string | null, defaut: Date): Date {
  if (!valeur) return defaut;
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? defaut : jourSeul(date);
}

function statutDemande(valeur: string | null): AttendanceStatus | null {
  return valeur && valeur in LIBELLES_PRESENCE ? (valeur as AttendanceStatus) : null;
}

export default async function PagePresences({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.RH_PRESENCE_LIRE);
  const parametres = await searchParams;
  const liste = lireParametresListe(parametres, [
    "du",
    "au",
    "division",
    "atelier",
    "statut",
  ]);

  const portee = usinesAutorisees(utilisateur);
  const aujourdhui = jourSeul(new Date());
  const du = dateOu(liste.filtres.du, aujourdhui);
  const au = dateOu(liste.filtres.au, aujourdhui);
  const [debut, finPeriode] = du <= au ? [du, au] : [au, du];

  const divisionDemandee = liste.filtres.division;
  const division: Factory | null =
    divisionDemandee &&
    divisionDemandee in LIBELLES_USINE &&
    portee.includes(divisionDemandee as Factory)
      ? (divisionDemandee as Factory)
      : null;
  const atelierId = identifiantOuNull(liste.filtres.atelier);
  const statut = statutDemande(liste.filtres.statut);

  const peutSaisir = aLaPermission(utilisateur, PERMISSIONS.RH_PRESENCE_GERER);

  const porteeEmploye: Prisma.EmployeeWhereInput = {
    factory: { in: division ? [division] : portee },
    ...(atelierId ? { workshopId: atelierId } : {}),
  };

  const where: Prisma.AttendanceWhereInput = {
    date: { gte: debut, lte: finPeriode },
    employee: porteeEmploye,
    ...(statut ? { status: statut } : {}),
  };

  const total = await prisma.attendance.count({ where });
  const bornes = pagination(total, liste.page, liste.taille);

  const [pointages, employes, ateliers, synthese] = await Promise.all([
    prisma.attendance.findMany({
      where,
      orderBy: [{ date: "desc" }, { employeeId: "asc" }],
      skip: bornes.skip,
      take: bornes.take,
      include: {
        employee: {
          select: {
            id: true,
            matricule: true,
            firstName: true,
            lastName: true,
            workshop: { select: { code: true } },
          },
        },
      },
    }),
    prisma.employee.findMany({
      where: { isActive: true, ...porteeEmploye },
      orderBy: { matricule: "asc" },
      take: 500,
      select: { id: true, matricule: true, firstName: true, lastName: true },
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
    prisma.attendance.groupBy({
      by: ["status"],
      where: {
        date: aujourdhui,
        employee: { factory: { in: division ? [division] : portee } },
      },
      _count: { _all: true },
      _sum: { lateMinutes: true },
    }),
  ]);

  const compte = (valeur: AttendanceStatus): number =>
    synthese.find((ligne) => ligne.status === valeur)?._count._all ?? 0;
  const minutesRetard = synthese.reduce(
    (totalRetard, ligne) => totalRetard + (ligne._sum.lateMinutes ?? 0),
    0,
  );

  const heuresPeriode = pointages.reduce(
    (cumul, pointage) => cumul + pointage.workedHours.toNumber(),
    0,
  );

  return (
    <>
      <EnTetePage
        titre="Presences et temps de travail"
        description={`Periode du ${formatDate(debut)} au ${formatDate(finPeriode)}. Un seul pointage est possible par employe et par journee : une nouvelle saisie met a jour celui du jour.`}
        actions={
          <Link className="lien-nav text-sm" href="/rh/employes">
            Fiches employes
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Statistique
          libelle={`Presents le ${formatDate(aujourdhui)}`}
          valeur={compte("PRESENT")}
          ton="succes"
        />
        <Statistique libelle="Absents du jour" valeur={compte("ABSENT")} ton="danger" />
        <Statistique libelle="Retards du jour" valeur={compte("RETARD")} ton="alerte" />
        <Statistique
          libelle="Minutes de retard cumulees"
          valeur={minutesRetard}
          detail="Sur la journee du jour"
          ton="neutre"
        />
      </div>

      <div className="mt-5">
        <Carte titre="Filtres">
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Champ nom="du" libelle="Du" type="date" valeur={toInputDate(du)} />
            <Champ nom="au" libelle="Au" type="date" valeur={toInputDate(au)} />
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
              options={Object.entries(LIBELLES_PRESENCE).map(([valeur, texte]) => ({
                valeur,
                libelle: texte,
              }))}
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

      {peutSaisir ? (
        <div className="mt-5">
          <Carte
            titre="Saisir un pointage"
            description="Laissez les heures travaillees vides pour qu'elles soient deduites du pointage d'arrivee et de depart."
          >
            <FormulaireAction
              action={actionEnregistrerPresence}
              libelleSoumettre="Enregistrer le pointage"
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Champ
                  nom="date"
                  libelle="Journee"
                  type="date"
                  requis
                  valeur={toInputDate(aujourdhui)}
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
                  nom="status"
                  libelle="Statut"
                  type="select"
                  requis
                  options={Object.entries(LIBELLES_PRESENCE).map(([valeur, texte]) => ({
                    valeur,
                    libelle: texte,
                  }))}
                />
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Heure d'arrivee</span>
                  <input className="champ" type="time" name="checkIn" />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Heure de depart</span>
                  <input className="champ" type="time" name="checkOut" />
                </label>
                <Champ
                  nom="workedHours"
                  libelle="Heures travaillees"
                  type="number"
                  pas="0.25"
                  min="0"
                  aide="Deduites du pointage si les deux heures sont saisies."
                />
                <Champ
                  nom="overtimeHours"
                  libelle="Heures supplementaires"
                  type="number"
                  pas="0.25"
                  min="0"
                />
                <Champ
                  nom="lateMinutes"
                  libelle="Minutes de retard"
                  type="number"
                  min="0"
                />
                <Champ nom="comment" libelle="Commentaire" type="textarea" />
              </div>
            </FormulaireAction>
          </Carte>
        </div>
      ) : (
        <p className="mt-5 text-sm" style={{ color: "var(--texte-doux)" }}>
          Votre profil permet la consultation des pointages mais pas leur saisie.
        </p>
      )}

      <div className="mt-5">
        <Carte
          titre={`${total} pointage(s)`}
          description={`${formatQuantite(heuresPeriode)} heures travaillees sur la page affichee.`}
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "date", libelle: "Journee" },
              { cle: "employe", libelle: "Employe" },
              { cle: "atelier", libelle: "Atelier" },
              { cle: "statut", libelle: "Statut" },
              { cle: "arrivee", libelle: "Arrivee" },
              { cle: "depart", libelle: "Depart" },
              { cle: "heures", libelle: "Heures travaillees", nombre: true },
              { cle: "supp", libelle: "Heures supplementaires", nombre: true },
              { cle: "retard", libelle: "Retard (min)", nombre: true },
              { cle: "commentaire", libelle: "Commentaire" },
            ]}
            lignes={pointages.map((pointage) => ({
              cle: String(pointage.id),
              cellules: [
                formatDate(pointage.date),
                <Link
                  key="e"
                  className="lien-nav"
                  href={`/rh/employes/${pointage.employee.id}`}
                >
                  {`${pointage.employee.matricule} — ${pointage.employee.lastName} ${pointage.employee.firstName}`.trim()}
                </Link>,
                pointage.employee.workshop?.code ?? "Non rattache",
                <EtiquetteStatut
                  key="s"
                  libelle={libelle(LIBELLES_PRESENCE, pointage.status)}
                  code={pointage.status}
                />,
                formatHeure(pointage.checkIn),
                formatHeure(pointage.checkOut),
                formatQuantite(pointage.workedHours),
                formatQuantite(pointage.overtimeHours),
                pointage.lateMinutes,
                pointage.comment ?? "-",
              ],
            }))}
            messageVide="Aucun pointage ne correspond aux filtres selectionnes."
          />
          <Pagination
            page={Math.min(liste.page, bornes.pages)}
            pages={bornes.pages}
            total={total}
            construireLien={fabricantLien("/rh/presences", {
              du: liste.filtres.du,
              au: liste.filtres.au,
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
