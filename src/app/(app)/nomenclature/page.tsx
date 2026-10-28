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

} from "@/components/ui";
import { formatEntier, formatQuantite } from "@/lib/format";
import { LIBELLES_STATUT_NOMENCLATURE, libelle } from "@/lib/libelles";
import { BoutonSupprimerProduit } from "@/components/bouton-supprimer-produit";

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
          photoFile: true,
          family: { select: { code: true, label: true } },
        },
      },
      approvedBy: { select: { email: true } },
      _count: { select: { lines: true, workOrders: true } },
    },
  });

  const peutEcrire = aLaPermission(utilisateur, PERMISSIONS.NOMENCLATURE_ECRIRE);
  const maintenant = new Date();

  /*
   * Ce que la carte doit dire en un coup d'oeil : ce que le produit consomme,
   * par quelles operations il passe, et combien on en a deja fabrique.
   */
  const idsArticles = nomenclatures.map((formule) => formule.item.id);
  const [chaines, produits] = idsArticles.length
    ? await Promise.all([
        prisma.productRoute.findMany({
          where: { itemId: { in: idsArticles } },
          orderBy: [{ itemId: "asc" }, { version: "desc" }],
          select: {
            itemId: true,
            code: true,
            version: true,
            steps: {
              orderBy: { stepNo: "asc" },
              select: { operation: { select: { code: true, label: true } } },
            },
          },
        }),
        prisma.workOrder.groupBy({
          by: ["itemId"],
          where: { itemId: { in: idsArticles } },
          _sum: { quantityConform: true },
        }),
      ])
    : [[], []];

  const operationsParArticle = new Map<number, string[]>();
  for (const chaine of chaines) {
    if (!operationsParArticle.has(chaine.itemId)) {
      operationsParArticle.set(
        chaine.itemId,
        chaine.steps.map((etape) => etape.operation.code),
      );
    }
  }
  const produitParArticle = new Map(
    produits.map((ligne) => [ligne.itemId, ligne._sum.quantityConform ?? 0]),
  );

  const filtresCourants = {
    q: parametres.recherche,
    statut: premiereValeur(parametresBruts, "statut"),
    division: premiereValeur(parametresBruts, "division"),
    famille: premiereValeur(parametresBruts, "famille"),
    taille: parametres.taille,
  };

  const cartes = nomenclatures.map((formule) => {
    const operations = operationsParArticle.get(formule.item.id) ?? [];
    const produit = produitParArticle.get(formule.item.id) ?? 0;
    return {
      formule,
      operations,
      produit,
      applicable: formule.status === "ACTIVE" && dansPeriode(formule, maintenant),
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
              <Link className="bouton primaire" href="/nomenclature/nouvelle">
                Creer une nomenclature
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

      {cartes.length === 0 ? (
        <Carte>
          <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
            Aucune nomenclature ne correspond aux filtres selectionnes.
          </p>
        </Carte>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cartes.map(({ formule, operations, produit, applicable }) => (
            <article
              key={formule.id}
              className="carte flex flex-col overflow-hidden"
            >
              <Link
                href={`/nomenclature/${formule.id}`}
                className="block"
                style={{ background: "var(--surface-douce)" }}
              >
                {formule.item.photoFile ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/articles/${formule.item.id}/media/photo`}
                    alt={formule.item.label1}
                    className="h-36 w-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-36 items-center justify-center text-xs"
                    style={{ color: "var(--texte-doux)" }}
                  >
                    Sans photo
                  </div>
                )}
              </Link>

              <div className="flex flex-1 flex-col gap-2 p-4">
                <div>
                  <Link href={`/nomenclature/${formule.id}`} className="font-semibold">
                    {formule.item.code}
                  </Link>
                  <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                    {formule.item.label1}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <EtiquetteStatut
                    libelle={libelle(LIBELLES_STATUT_NOMENCLATURE, formule.status)}
                    code={formule.status}
                  />
                  {formule.item.family && (
                    <Etiquette>{formule.item.family.label}</Etiquette>
                  )}
                  {applicable && <Etiquette ton="succes">Active</Etiquette>}
                </div>

                <p className="text-sm">
                  <span style={{ color: "var(--texte-doux)" }}>Matieres : </span>
                  <span className="font-medium">{formatEntier(formule._count.lines)}</span>
                </p>
                <p className="text-sm">
                  <span style={{ color: "var(--texte-doux)" }}>Operations : </span>
                  <span className="font-medium">
                    {operations.length === 0
                      ? "aucune"
                      : operations.join(" → ")}
                  </span>
                </p>
                <p className="text-sm">
                  <span style={{ color: "var(--texte-doux)" }}>Produit : </span>
                  <span className="font-medium">{formatQuantite(produit)}</span>
                </p>

                <div className="mt-auto flex flex-wrap gap-2 pt-2">
                  <Link className="bouton" href={`/nomenclature/${formule.id}`}>
                    Modifier
                  </Link>
                  <Link
                    className="bouton secondaire"
                    href={`/referentiel/articles/${formule.item.id}`}
                  >
                    Fiche article
                  </Link>
                  {peutEcrire && (
                    <BoutonSupprimerProduit
                      itemId={formule.item.id}
                      code={formule.item.code}
                    />
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Pagination
          page={parametres.page}
          pages={bornes.pages}
          total={total}
          construireLien={fabricantLien("/nomenclature", filtresCourants)}
        />
      </div>
    </>
  );
}
