import Link from "next/link";
import type { Factory, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fabricantLien,
  identifiantOuNull,
  lireParametresListe,
  modeInsensible,
  pagination,
} from "@/lib/liste";
import {
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Pagination,
  Tableau,
} from "@/components/ui";
import { Champ } from "@/components/interactif";
import { formatDate } from "@/lib/format";
import { LIBELLES_USINE, libelle } from "@/lib/libelles";

export const metadata = { title: "Employes" };

/**
 * Liste des employes.
 *
 * Point de vigilance : les colonnes salariales ne figurent pas dans le `select`
 * Prisma. Sans `RH_SALAIRE_LIRE`, aucune donnee de salaire ne quitte la base :
 * elle n'est pas chargee puis masquee, elle n'est pas lue du tout.
 *
 * Le filtre de division est toujours combine a la portee de l'utilisateur : une
 * division demandee hors portee est ignoree, jamais appliquee.
 */

function divisionAutorisee(
  valeur: string | null,
  portee: Factory[],
): Factory | null {
  if (!valeur || !(valeur in LIBELLES_USINE)) return null;
  return portee.includes(valeur as Factory) ? (valeur as Factory) : null;
}

export default async function PageEmployes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.RH_LIRE);
  const parametres = await searchParams;
  const liste = lireParametresListe(parametres, ["division", "atelier", "actif"]);

  const portee = usinesAutorisees(utilisateur);
  const division = divisionAutorisee(liste.filtres.division, portee);
  const atelierId = identifiantOuNull(liste.filtres.atelier);
  const actif =
    liste.filtres.actif === "actif"
      ? true
      : liste.filtres.actif === "inactif"
        ? false
        : null;

  const where: Prisma.EmployeeWhereInput = {
    factory: { in: division ? [division] : portee },
    ...(atelierId ? { workshopId: atelierId } : {}),
    ...(actif === null ? {} : { isActive: actif }),
    ...(liste.recherche
      ? {
          OR: [
            { matricule: modeInsensible(liste.recherche) },
            { firstName: modeInsensible(liste.recherche) },
            { lastName: modeInsensible(liste.recherche) },
            { jobTitle: modeInsensible(liste.recherche) },
          ],
        }
      : {}),
  };

  const total = await prisma.employee.count({ where });
  const bornes = pagination(total, liste.page, liste.taille);

  const [employes, ateliers] = await Promise.all([
    prisma.employee.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { matricule: "asc" }],
      skip: bornes.skip,
      take: bornes.take,
      // Selection explicite : les champs salariaux sont volontairement absents.
      select: {
        id: true,
        matricule: true,
        firstName: true,
        lastName: true,
        jobTitle: true,
        factory: true,
        hireDate: true,
        isActive: true,
        workshop: { select: { code: true, label: true } },
        user: { select: { email: true, isActive: true } },
      },
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

  return (
    <>
      <EnTetePage
        titre="Employes"
        description="Fiches du personnel, rattachement a un atelier et compte utilisateur nominatif. Les donnees salariales ne sont affichees qu'aux profils autorises."
        actions={
          <Link className="lien-nav text-sm" href="/rh/employes/nouveau">
            Nouvel employe
          </Link>
        }
      />

      <Carte titre="Filtres">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Champ
            nom="q"
            libelle="Recherche"
            type="search"
            valeur={liste.recherche}
            aide="Matricule, nom, prenom ou poste."
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
            nom="actif"
            libelle="Statut"
            type="select"
            valeur={liste.filtres.actif}
            options={[
              { valeur: "actif", libelle: "Actifs uniquement" },
              { valeur: "inactif", libelle: "Inactifs uniquement" },
            ]}
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

      <div className="mt-5">
        <Carte
          titre={`${total} employe(s)`}
          description="Perimetre borne par votre portee de division."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "matricule", libelle: "Matricule" },
              { cle: "nom", libelle: "Nom et prenom" },
              { cle: "poste", libelle: "Poste" },
              { cle: "division", libelle: "Division" },
              { cle: "atelier", libelle: "Atelier" },
              { cle: "embauche", libelle: "Date d'embauche" },
              { cle: "statut", libelle: "Statut" },
              { cle: "compte", libelle: "Compte utilisateur" },
            ]}
            lignes={employes.map((employe) => ({
              cle: String(employe.id),
              cellules: [
                <Link
                  key="m"
                  className="lien-nav"
                  href={`/rh/employes/${employe.id}`}
                >
                  {employe.matricule}
                </Link>,
                `${employe.lastName} ${employe.firstName}`.trim(),
                employe.jobTitle ?? "-",
                libelle(LIBELLES_USINE, employe.factory),
                employe.workshop
                  ? `${employe.workshop.code} — ${employe.workshop.label}`
                  : "Non rattache",
                formatDate(employe.hireDate),
                <EtiquetteStatut
                  key="s"
                  libelle={employe.isActive ? "Actif" : "Inactif"}
                  code={employe.isActive ? "ACTIF" : "INACTIF"}
                />,
                employe.user ? (
                  <span key="c" className="flex flex-wrap items-center gap-2">
                    <Etiquette ton="succes" titre="Compte nominatif rattache">
                      Oui
                    </Etiquette>
                    <span className="text-xs">{employe.user.email}</span>
                  </span>
                ) : (
                  <Etiquette
                    key="c"
                    ton="alerte"
                    titre="Aucun compte : l'employe ne peut pas acceder au portail"
                  >
                    Aucun compte
                  </Etiquette>
                ),
              ],
            }))}
            messageVide="Aucun employe ne correspond aux filtres selectionnes."
          />
          <Pagination
            page={Math.min(liste.page, bornes.pages)}
            pages={bornes.pages}
            total={total}
            construireLien={fabricantLien("/rh/employes", {
              q: liste.recherche,
              division: liste.filtres.division,
              atelier: liste.filtres.atelier,
              actif: liste.filtres.actif,
            })}
          />
        </Carte>
      </div>
    </>
  );
}
