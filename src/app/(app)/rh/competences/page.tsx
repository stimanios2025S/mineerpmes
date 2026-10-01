import Link from "next/link";
import type { Factory, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fabricantLien,
  identifiantOuNull,
  lireParametresListe,
  pagination,
} from "@/lib/liste";
import { actionDeclarerCompetence } from "@/actions/rh";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  Pagination,
  Statistique,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatDate, formatQuantite } from "@/lib/format";
import { LIBELLES_USINE, libelle } from "@/lib/libelles";

export const metadata = { title: "Competences et polyvalence" };

/**
 * Referentiel des competences et matrice de polyvalence.
 *
 * La polyvalence est la regle de l'atelier : cette page sert a savoir qui sait
 * faire quoi. Une competence peut etre rattachee a une operation (savoir-faire
 * de fabrication) ou a un article. Le niveau detenu par un employe va de 1 a 5
 * et n'est jamais deduit automatiquement : il est declare.
 */

const NIVEAUX: { valeur: number; libelle: string }[] = [
  { valeur: 1, libelle: "1 — Notions" },
  { valeur: 2, libelle: "2 — Autonome sur tache simple" },
  { valeur: 3, libelle: "3 — Autonome" },
  { valeur: 4, libelle: "4 — Confirme / formateur" },
  { valeur: 5, libelle: "5 — Expert" },
];

function divisionDemandee(valeur: string | null, portee: Factory[]): Factory | null {
  return valeur && valeur in LIBELLES_USINE && portee.includes(valeur as Factory)
    ? (valeur as Factory)
    : null;
}

export default async function PageCompetences({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.RH_COMPETENCE_GERER);
  const parametres = await searchParams;
  const liste = lireParametresListe(parametres, [
    "division",
    "statut",
    "couverture",
    "competence",
    "employe",
    "niveauMin",
  ]);

  const portee = usinesAutorisees(utilisateur);
  const division = divisionDemandee(liste.filtres.division, portee);
  const competenceId = identifiantOuNull(liste.filtres.competence);
  const employeId = identifiantOuNull(liste.filtres.employe);
  const niveauMin = identifiantOuNull(liste.filtres.niveauMin);
  const couverture = liste.filtres.couverture;

  // ---------------------------------------------------------------------------
  // Referentiel des competences
  // ---------------------------------------------------------------------------
  const whereCompetence: Prisma.SkillWhereInput = {
    factory: { in: division ? [division, "COMMUN"] : [...portee, "COMMUN"] },
    ...(liste.filtres.statut === "inactives"
      ? { isActive: false }
      : liste.filtres.statut === "toutes"
        ? {}
        : { isActive: true }),
    ...(liste.recherche
      ? {
          OR: [
            { code: { contains: liste.recherche, mode: "insensitive" as const } },
            { label: { contains: liste.recherche, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(couverture === "non-couvertes"
      ? { employeeSkills: { none: {} } }
      : couverture === "couvertes"
        ? { employeeSkills: { some: {} } }
        : {}),
  };

  const totalCompetences = await prisma.skill.count({ where: whereCompetence });
  const bornesCompetences = pagination(totalCompetences, liste.page, liste.taille);

  const competences = await prisma.skill.findMany({
    where: whereCompetence,
    orderBy: [{ factory: "asc" }, { code: "asc" }],
    skip: bornesCompetences.skip,
    take: bornesCompetences.take,
    select: {
      id: true,
      code: true,
      label: true,
      factory: true,
      isActive: true,
      description: true,
      operation: { select: { id: true, code: true, label: true } },
      item: { select: { id: true, code: true, label1: true } },
      _count: { select: { employeeSkills: true } },
    },
  });

  const niveauxDetenus = await prisma.employeeSkill.groupBy({
    by: ["skillId"],
    where: { skillId: { in: competences.map((competence) => competence.id) } },
    _min: { level: true },
    _max: { level: true },
  });
  const niveauParCompetence = new Map(
    niveauxDetenus.map((ligne) => [ligne.skillId, ligne]),
  );

  // ---------------------------------------------------------------------------
  // Matrice de polyvalence (niveau detenu par chaque employe)
  // ---------------------------------------------------------------------------
  const whereMatrice: Prisma.EmployeeSkillWhereInput = {
    employee: {
      factory: { in: division ? [division] : portee },
    },
    ...(competenceId ? { skillId: competenceId } : {}),
    ...(employeId ? { employeeId: employeId } : {}),
    ...(niveauMin ? { level: { gte: niveauMin } } : {}),
  };

  const totalMatrice = await prisma.employeeSkill.count({ where: whereMatrice });
  const bornesMatrice = pagination(totalMatrice, liste.page, liste.taille);

  const [lignesMatrice, employes, competencesDisponibles, nonCouvertes, nonCertifiees] =
    await Promise.all([
      prisma.employeeSkill.findMany({
        where: whereMatrice,
        orderBy: [{ skill: { factory: "asc" } }, { skill: { code: "asc" } }, { level: "desc" }],
        skip: bornesMatrice.skip,
        take: bornesMatrice.take,
        select: {
          id: true,
          level: true,
          certifiedAt: true,
          notes: true,
          employee: {
            select: {
              id: true,
              matricule: true,
              firstName: true,
              lastName: true,
              isActive: true,
              workshop: { select: { code: true } },
            },
          },
          skill: {
            select: {
              id: true,
              code: true,
              label: true,
              factory: true,
              operation: { select: { code: true, label: true } },
              item: { select: { code: true } },
            },
          },
        },
      }),
      prisma.employee.findMany({
        where: { factory: { in: portee } },
        orderBy: [{ isActive: "desc" }, { matricule: "asc" }],
        take: 500,
        select: { id: true, matricule: true, firstName: true, lastName: true },
      }),
      prisma.skill.findMany({
        where: {
          isActive: true,
          factory: { in: division ? [division, "COMMUN"] : [...portee, "COMMUN"] },
        },
        orderBy: [{ factory: "asc" }, { code: "asc" }],
        take: 500,
        select: { id: true, code: true, label: true, factory: true },
      }),
      prisma.skill.count({
        where: {
          isActive: true,
          factory: { in: division ? [division, "COMMUN"] : [...portee, "COMMUN"] },
          employeeSkills: { none: {} },
        },
      }),
      prisma.employeeSkill.count({
        where: {
          certifiedAt: null,
          employee: { factory: { in: division ? [division] : portee } },
        },
      }),
    ]);

  return (
    <>
      <EnTetePage
        titre="Competences et polyvalence"
        description="Qui sait faire quoi, et a quel niveau. Les niveaux sont declares : ils ne sont jamais deduits d'une affectation ni d'une evaluation."
        actions={
          <Link className="lien-nav text-sm" href="/rh/employes">
            Fiches employes
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Statistique
          libelle="Competences actives"
          valeur={totalCompetences}
          detail="Selon les filtres du referentiel"
        />
        <Statistique
          libelle="Competences sans aucun detenteur"
          valeur={nonCouvertes}
          ton={nonCouvertes > 0 ? "alerte" : "succes"}
          detail="Aucun employe ne detient cette competence"
        />
        <Statistique
          libelle="Niveaux non certifies"
          valeur={nonCertifiees}
          ton="neutre"
          detail="Competences declarees sans date de certification"
        />
        <Statistique
          libelle="Lignes de la matrice"
          valeur={totalMatrice}
          ton="info"
          detail="Couples employe / competence"
        />
      </div>

      <div className="mt-5">
        <Carte
          titre="Referentiel des competences"
          description="Une competence se rattache a une operation de fabrication ou a un article. Le nombre de detenteurs est compte sur les declarations reelles."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "code", libelle: "Code" },
              { cle: "label", libelle: "Competence" },
              { cle: "division", libelle: "Division" },
              { cle: "support", libelle: "Operation ou article associe" },
              { cle: "detenteurs", libelle: "Detenteurs", nombre: true },
              { cle: "niveaux", libelle: "Niveaux detenus" },
              { cle: "etat", libelle: "Etat" },
            ]}
            lignes={competences.map((competence) => {
              const niveaux = niveauParCompetence.get(competence.id);
              return {
                cle: String(competence.id),
                cellules: [
                  competence.code,
                  competence.label,
                  libelle(LIBELLES_USINE, competence.factory),
                  competence.operation
                    ? `${competence.operation.code} — ${competence.operation.label}`
                    : competence.item
                      ? `Article ${competence.item.code} — ${competence.item.label1}`
                      : "Aucun support associe",
                  <Link
                    key="d"
                    className="lien-nav"
                    href={`/rh/competences?competence=${competence.id}`}
                  >
                    {competence._count.employeeSkills}
                  </Link>,
                  niveaux?._min.level && niveaux?._max.level
                    ? niveaux._min.level === niveaux._max.level
                      ? `Niveau ${niveaux._min.level}`
                      : `Niveaux ${niveaux._min.level} a ${niveaux._max.level}`
                    : "Aucun niveau declare",
                  competence.isActive ? (
                    <Etiquette key="e" ton="succes">
                      Active
                    </Etiquette>
                  ) : (
                    <Etiquette key="e" ton="neutre">
                      Inactive
                    </Etiquette>
                  ),
                ],
              };
            })}
            messageVide="Aucune competence ne correspond aux filtres selectionnes."
          />
          <Pagination
            page={Math.min(liste.page, bornesCompetences.pages)}
            pages={bornesCompetences.pages}
            total={totalCompetences}
            construireLien={fabricantLien("/rh/competences", {
              q: liste.recherche,
              division: liste.filtres.division,
              statut: liste.filtres.statut,
              couverture: liste.filtres.couverture,
            })}
          />
        </Carte>
      </div>

      <div className="mt-5">
        <Carte titre="Filtres">
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Champ
              nom="q"
              libelle="Recherche"
              type="search"
              valeur={liste.recherche}
              aide="Code ou libelle de la competence."
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
              nom="couverture"
              libelle="Couverture"
              type="select"
              valeur={liste.filtres.couverture}
              options={[
                { valeur: "couvertes", libelle: "Competences detenues" },
                { valeur: "non-couvertes", libelle: "Competences sans detenteur" },
              ]}
            />
            <Champ
              nom="statut"
              libelle="Etat"
              type="select"
              valeur={liste.filtres.statut}
              options={[
                { valeur: "actives", libelle: "Actives" },
                { valeur: "inactives", libelle: "Inactives" },
                { valeur: "toutes", libelle: "Toutes" },
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
      </div>

      <div className="mt-5">
        <Carte
          titre="Declarer une competence detenue"
          description="Le niveau declare engage l'affectation : un employe ne doit etre affecte qu'a une operation qu'il maitrise, sauf decision encadree du responsable."
        >
          <Alerte ton="info" titre="Un compte par employe">
            Une declaration porte sur un employe identifie. Declarer une
            competence n'ouvre aucun droit supplementaire : les droits d'acces
            restent ceux du compte nominatif de l'employe.
          </Alerte>
          <div className="mt-3">
            <FormulaireAction
              action={actionDeclarerCompetence}
              libelleSoumettre="Declarer la competence"
              reinitialiser
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  nom="skillId"
                  libelle="Competence"
                  type="select"
                  requis
                  options={competencesDisponibles.map((competence) => ({
                    valeur: competence.id,
                    libelle: `${competence.code} — ${competence.label} (${libelle(LIBELLES_USINE, competence.factory)})`,
                  }))}
                />
                <Champ
                  nom="level"
                  libelle="Niveau detenu"
                  type="select"
                  requis
                  options={NIVEAUX.map((niveau) => ({
                    valeur: niveau.valeur,
                    libelle: niveau.libelle,
                  }))}
                />
                <Champ nom="notes" libelle="Observations" type="textarea" />
              </div>
            </FormulaireAction>
          </div>
        </Carte>
      </div>

      <div className="mt-5" id="matrice">
        <Carte
          titre={`Matrice de polyvalence — ${totalMatrice} niveau(x) declare(s)`}
          description="Un employe peut detenir plusieurs competences, et une competence peut etre detenue par plusieurs employes : c'est cette matrice qui porte la polyvalence de l'atelier."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "employe", libelle: "Employe" },
              { cle: "atelier", libelle: "Atelier" },
              { cle: "competence", libelle: "Competence" },
              { cle: "division", libelle: "Division" },
              { cle: "support", libelle: "Operation ou article" },
              { cle: "niveau", libelle: "Niveau detenu", nombre: true },
              { cle: "certification", libelle: "Certifie le" },
              { cle: "observations", libelle: "Observations" },
            ]}
            lignes={lignesMatrice.map((ligne) => ({
              cle: String(ligne.id),
              cellules: [
                <Link
                  key="e"
                  className="lien-nav"
                  href={`/rh/employes/${ligne.employee.id}`}
                >
                  {`${ligne.employee.matricule} — ${ligne.employee.lastName} ${ligne.employee.firstName}`.trim()}
                </Link>,
                ligne.employee.workshop?.code ?? "Non rattache",
                `${ligne.skill.code} — ${ligne.skill.label}`,
                libelle(LIBELLES_USINE, ligne.skill.factory),
                ligne.skill.operation
                  ? `${ligne.skill.operation.code} — ${ligne.skill.operation.label}`
                  : ligne.skill.item
                    ? `Article ${ligne.skill.item.code}`
                    : "-",
                formatQuantite(ligne.level, 0),
                ligne.certifiedAt ? formatDate(ligne.certifiedAt) : "Non certifie",
                ligne.notes ?? "-",
              ],
            }))}
            messageVide="Aucun niveau declare ne correspond aux filtres selectionnes."
          />
          <Pagination
            page={Math.min(liste.page, bornesMatrice.pages)}
            pages={bornesMatrice.pages}
            total={totalMatrice}
            construireLien={fabricantLien("/rh/competences", {
              q: liste.recherche,
              division: liste.filtres.division,
              statut: liste.filtres.statut,
              couverture: liste.filtres.couverture,
              competence: liste.filtres.competence,
              employe: liste.filtres.employe,
              niveauMin: liste.filtres.niveauMin,
            })}
          />
        </Carte>

        <div className="mt-4">
          <Carte titre="Filtres de la matrice">
            <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Champ
                nom="competence"
                libelle="Competence"
                type="select"
                valeur={competenceId}
                options={competencesDisponibles.map((competence) => ({
                  valeur: competence.id,
                  libelle: `${competence.code} — ${competence.label}`,
                }))}
              />
              <Champ
                nom="employe"
                libelle="Employe"
                type="select"
                valeur={employeId}
                options={employes.map((employe) => ({
                  valeur: employe.id,
                  libelle: `${employe.matricule} — ${employe.lastName} ${employe.firstName}`,
                }))}
              />
              <Champ
                nom="niveauMin"
                libelle="Niveau minimum"
                type="select"
                valeur={niveauMin}
                options={NIVEAUX.map((niveau) => ({
                  valeur: niveau.valeur,
                  libelle: niveau.libelle,
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
      </div>
    </>
  );
}
