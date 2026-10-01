import Link from "next/link";
import type { Factory, FormulaStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  aLaPermission,
  exigerPermission,
  usinesAutorisees,
} from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fabricantLien,
  identifiantOuNull,
  lireParametresListe,
  modeInsensible,
  pagination,
  premiereValeur,
} from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Pagination,
  Tableau,
} from "@/components/ui";
import { formatDate, formatEntier } from "@/lib/format";
import { LIBELLES_STATUT_NOMENCLATURE, libelle } from "@/lib/libelles";

export const metadata = { title: "Nomenclatures" };

const STATUTS_NOMENCLATURE: FormulaStatus[] = [
  "BROUILLON",
  "EN_VALIDATION",
  "VALIDEE",
  "ACTIVE",
  "REMPLACEE",
  "ARCHIVEE",
];

const DIVISIONS: Factory[] = ["ADMEDCO", "MOBILIX", "COMMUN"];

/**
 * Une version est « active » lorsqu'elle porte le statut ACTIVE et que la date
 * du jour tombe dans sa periode d'effet. Hors periode, l'information est
 * affichee distinctement : la version reste active en base mais ne s'applique
 * pas aujourd'hui.
 */
function dansPeriode(
  formule: { effectiveFrom: Date | null; effectiveTo: Date | null },
  maintenant: Date,
): boolean {
  if (formule.effectiveFrom && formule.effectiveFrom.getTime() > maintenant.getTime()) {
    return false;
  }
  if (formule.effectiveTo && formule.effectiveTo.getTime() < maintenant.getTime()) {
    return false;
  }
  return true;
}

export default async function PageNomenclatures({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_LIRE);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, [
    "statut",
    "division",
    "famille",
  ]);

  const statut = STATUTS_NOMENCLATURE.find(
    (valeur) => valeur === parametres.filtres.statut,
  );
  const division = DIVISIONS.find(
    (valeur) => valeur === parametres.filtres.division,
  );
  const familleId = identifiantOuNull(parametres.filtres.famille);

  // La portee de l'utilisateur est cumulee avec les filtres saisis : elle n'est
  // jamais ecrasee par le formulaire de recherche.
  const conditions: Prisma.FormulaWhereInput[] = [
    { item: { factory: { in: usinesAutorisees(utilisateur) } } },
  ];
  if (statut) conditions.push({ status: statut });
  if (division) conditions.push({ item: { factory: division } });
  if (familleId !== null) conditions.push({ item: { familyId: familleId } });
  if (parametres.recherche) {
    const recherche = parametres.recherche;
    conditions.push({
      OR: [
        { code: modeInsensible(recherche) },
        { label: modeInsensible(recherche) },
        { item: { code: modeInsensible(recherche) } },
        { item: { label1: modeInsensible(recherche) } },
        { item: { designation: modeInsensible(recherche) } },
      ],
    });
  }

  const where: Prisma.FormulaWhereInput = { AND: conditions };

  const [total, familles, ecartsOuverts] = await Promise.all([
    prisma.formula.count({ where }),
    prisma.itemFamily.findMany({
      orderBy: { code: "asc" },
      take: 300,
      select: { id: true, code: true, label: true },
    }),
    prisma.formulaVariance.count({
      where: { status: { in: ["OUVERT", "EN_ANALYSE"] } },
    }),
  ]);

  const bornes = pagination(total, parametres.page, parametres.taille);
  const nomenclatures = await prisma.formula.findMany({
    where,
    orderBy: [{ item: { code: "asc" } }, { version: "desc" }],
    skip: bornes.skip,
    take: bornes.take,
    include: {
      item: {
        select: {
          id: true,
          code: true,
          label1: true,
          factory: true,
          family: { select: { code: true, label: true } },
        },
      },
      approvedBy: { select: { email: true } },
      _count: { select: { lines: true, workOrders: true } },
    },
  });

  const maintenant = new Date();

  const filtresCourants = {
    q: parametres.recherche,
    statut: premiereValeur(parametresBruts, "statut"),
    division: premiereValeur(parametresBruts, "division"),
    famille: premiereValeur(parametresBruts, "famille"),
    taille: parametres.taille,
  };

  const lignes = nomenclatures.map((formule) => {
    const active = formule.status === "ACTIVE";
    const applicable = active && dansPeriode(formule, maintenant);

    return {
      cle: String(formule.id),
      cellules: [
        <div key="article">
          <Link className="lien-nav" href={`/referentiel/articles/${formule.item.id}`}>
            {formule.item.code}
          </Link>
          <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
            {formule.item.label1}
            {formule.item.family ? ` — ${formule.item.family.label}` : ""}
          </span>
        </div>,
        <Link key="code" className="lien-nav" href={`/nomenclature/${formule.id}`}>
          {formule.code}
        </Link>,
        <span key="version" className="tabular-nums">
          v{formule.version}
        </span>,
        <EtiquetteStatut
          key="statut"
          libelle={libelle(LIBELLES_STATUT_NOMENCLATURE, formule.status)}
          code={formule.status}
        />,
        <span key="effet">{formatDate(formule.effectiveFrom)}</span>,
        <span key="fin">{formatDate(formule.effectiveTo)}</span>,
        <span key="composants" className="tabular-nums">
          {formatEntier(formule._count.lines)}
        </span>,
        <span key="valideur">
          {formule.approvedBy
            ? formule.approvedBy.email
            : "Non renseigne"}
        </span>,
        <div key="active">
          {applicable ? (
            <Etiquette ton="succes" titre="Version active et dans sa periode d'effet">
              Version active
            </Etiquette>
          ) : active ? (
            <Etiquette ton="alerte" titre="Statut actif, mais hors periode d'effet">
              Active hors periode
            </Etiquette>
          ) : (
            <span style={{ color: "var(--texte-doux)" }}>—</span>
          )}
          {formule._count.workOrders > 0 && (
            <span className="mt-1 block text-xs" style={{ color: "var(--texte-doux)" }}>
              {formatEntier(formule._count.workOrders)} ordre(s) fige(s) sur cette version
            </span>
          )}
        </div>,
      ],
    };
  });

  return (
    <>
      <EnTetePage
        titre="Nomenclatures"
        description="Versions de formulation par article. Une version utilisee par un ordre de fabrication ne se modifie jamais : elle est remplacee par une nouvelle version, et l'ancienne reste consultable."
        actions={
          <>
            <Link className="lien-nav text-sm" href="/nomenclature/ecarts">
              Ecarts a arbitrer
            </Link>
            <Link className="lien-nav text-sm" href="/nomenclature/gammes">
              Gammes de fabrication
            </Link>
            {aLaPermission(utilisateur, PERMISSIONS.NOMENCLATURE_ECRIRE) && (
              <Link className="lien-nav text-sm" href="/nomenclature/nouvelle">
                Nouvelle nomenclature
              </Link>
            )}
          </>
        }
      />

      {ecartsOuverts > 0 && (
        <div className="mb-5">
          <Alerte
            ton="alerte"
            titre={`${formatEntier(ecartsOuverts)} ecart(s) de quantite non arbitre(s)`}
          >
            Des sources contradictoires proposent des quantites differentes pour un meme
            composant. Aucune quantite n'est choisie automatiquement : consultez la page{" "}
            <Link className="lien-nav" href="/nomenclature/ecarts">
              Ecarts
            </Link>{" "}
            pour les trancher explicitement.
          </Alerte>
        </div>
      )}

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Filtres des nomenclatures"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Recherche article</span>
          <input
            className="champ"
            type="search"
            name="q"
            defaultValue={parametres.recherche ?? ""}
            placeholder="Code, designation, code ou libelle de version"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Statut</span>
          <select className="champ" name="statut" defaultValue={filtresCourants.statut ?? ""}>
            <option value="">Tous les statuts</option>
            {STATUTS_NOMENCLATURE.map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_STATUT_NOMENCLATURE, valeur)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Division</span>
          <select className="champ" name="division" defaultValue={filtresCourants.division ?? ""}>
            <option value="">Toutes les divisions</option>
            {DIVISIONS.map((valeur) => (
              <option key={valeur} value={valeur}>
                {valeur}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Famille</span>
          <select className="champ" name="famille" defaultValue={filtresCourants.famille ?? ""}>
            <option value="">Toutes les familles</option>
            {familles.map((famille) => (
              <option key={famille.id} value={famille.id}>
                {famille.code} — {famille.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex min-h-[42px] items-center rounded-lg border px-4 text-sm font-semibold"
          style={{
            background: "var(--surface)",
            borderColor: "var(--bordure-forte)",
            color: "var(--texte)",
          }}
        >
          Filtrer
        </button>
        <Link className="lien-nav text-sm" href="/nomenclature">
          Reinitialiser
        </Link>
      </form>

      <Carte
        titre="Versions de nomenclature"
        description="Liste bornee et paginee. Le nombre de composants et le nombre d'ordres fige(s) sont comptes en base."
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "article", libelle: "Article parent" },
            { cle: "code", libelle: "Code" },
            { cle: "version", libelle: "Version", nombre: true },
            { cle: "statut", libelle: "Statut" },
            { cle: "effet", libelle: "Date d'effet" },
            { cle: "fin", libelle: "Date de fin" },
            { cle: "composants", libelle: "Composants", nombre: true },
            { cle: "valideur", libelle: "Valideur" },
            { cle: "active", libelle: "Version active" },
          ]}
          lignes={lignes}
          messageVide="Aucune nomenclature ne correspond aux filtres selectionnes."
        />
        <Pagination
          page={parametres.page}
          pages={bornes.pages}
          total={total}
          construireLien={fabricantLien("/nomenclature", filtresCourants)}
        />
      </Carte>
    </>
  );
}
