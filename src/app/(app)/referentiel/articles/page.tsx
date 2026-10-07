import Link from "next/link";
import type { Factory, ItemStatus, ItemType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { aLaPermission, exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fabricantLien,
  identifiantOuNull,
  lireParametresListe,
  modeInsensible,
  pagination,
  premiereValeur,
} from "@/lib/liste";
import { CLE_PARAMETRE, lireParametreTexte } from "@/lib/settings";
import {
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Pagination,
  Tableau,
} from "@/components/ui";
import { DEVISE_PAR_DEFAUT, formatMontant, formatQuantite } from "@/lib/format";
import {
  LIBELLES_STATUT_ARTICLE,
  LIBELLES_TYPE_ARTICLE,
  LIBELLES_USINE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Articles" };

const TYPES_ARTICLE: ItemType[] = [
  "MATIERE_PREMIERE",
  "COMPOSANT",
  "SEMI_FINI",
  "PRODUIT_FINI",
  "EMBALLAGE",
  "CONSOMMABLE",
  "SERVICE",
  "MAIN_OEUVRE",
];

const STATUTS_ARTICLE: ItemStatus[] = [
  "ACTIF",
  "INACTIF",
  "ARCHIVE",
  "NON_COMMERCIALISABLE",
  "NON_PRODUCTIBLE",
];

const DIVISIONS: Factory[] = ["ADMEDCO", "MOBILIX", "COMMUN"];

/**
 * Quantite disponible totale d'un article.
 *
 * Le disponible reprend exactement la regle du grand livre de stock : seul le
 * stock physique libre de toute reservation, de tout blocage, de toute
 * deterioration et de toute quarantaine est disponible a la sortie.
 */
function disponibleTotal(somme: {
  quantityPhysical: Prisma.Decimal | null;
  quantityReserved: Prisma.Decimal | null;
  quantityBlocked: Prisma.Decimal | null;
  quantityDamaged: Prisma.Decimal | null;
  quantityQuarantine: Prisma.Decimal | null;
}): Prisma.Decimal {
  return D.sub(
    D.of(somme.quantityPhysical),
    D.sum([
      somme.quantityReserved,
      somme.quantityBlocked,
      somme.quantityDamaged,
      somme.quantityQuarantine,
    ]),
  );
}

export default async function PageArticles({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.ARTICLE_LIRE);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, [
    "famille",
    "type",
    "statut",
    "division",
  ]);

  const familleId = identifiantOuNull(parametres.filtres.famille);
  const typeArticle = TYPES_ARTICLE.find((valeur) => valeur === parametres.filtres.type);
  const statut = STATUTS_ARTICLE.find((valeur) => valeur === parametres.filtres.statut);
  const division = DIVISIONS.find((valeur) => valeur === parametres.filtres.division);

  // Conditions cumulatives : la portee de l'utilisateur ne doit jamais etre
  // ecrasee par le filtre de division saisi dans le formulaire.
  const conditions: Prisma.ItemWhereInput[] = [];
  if (!utilisateur.scope.allFactories) {
    conditions.push({ factory: { in: usinesAutorisees(utilisateur) } });
  }
  if (familleId !== null) conditions.push({ familyId: familleId });
  if (typeArticle) conditions.push({ type: typeArticle });
  if (statut) conditions.push({ status: statut });
  if (division) conditions.push({ factory: division });
  if (parametres.recherche) {
    const recherche = parametres.recherche;
    conditions.push({
      OR: [
        { code: modeInsensible(recherche) },
        { label1: modeInsensible(recherche) },
        { label2: modeInsensible(recherche) },
        { designation: modeInsensible(recherche) },
        { barcode: modeInsensible(recherche) },
      ],
    });
  }
  const where: Prisma.ItemWhereInput =
    conditions.length > 0 ? { AND: conditions } : {};

  const [total, familles, devise] = await Promise.all([
    prisma.item.count({ where }),
    prisma.itemFamily.findMany({
      orderBy: { code: "asc" },
      take: 300,
      select: { id: true, code: true, label: true },
    }),
    lireParametreTexte(CLE_PARAMETRE.DEVISE, DEVISE_PAR_DEFAUT),
  ]);

  const bornes = pagination(total, parametres.page, parametres.taille);
  const articles = await prisma.item.findMany({
    where,
    orderBy: { code: "asc" },
    skip: bornes.skip,
    take: bornes.take,
    include: {
      family: { select: { code: true, label: true } },
      unit: { select: { code: true, label: true } },
    },
  });

  // Disponibles consolides : l'agregation est faite par PostgreSQL, jamais dans
  // le navigateur, et le calcul decimal reste exact.
  const identifiants = articles.map((article) => article.id);
  const soldes =
    identifiants.length === 0
      ? []
      : await prisma.stockBalance.groupBy({
          by: ["itemId"],
          where: { itemId: { in: identifiants }, warehouse: { factory: { in: usinesAutorisees(utilisateur) } } },
          _sum: {
            quantityPhysical: true,
            quantityReserved: true,
            quantityBlocked: true,
            quantityDamaged: true,
            quantityQuarantine: true,
          },
        });
  const disponibles = new Map<number, Prisma.Decimal>();
  for (const solde of soldes) {
    disponibles.set(
      solde.itemId,
      disponibleTotal({
        quantityPhysical: solde._sum.quantityPhysical,
        quantityReserved: solde._sum.quantityReserved,
        quantityBlocked: solde._sum.quantityBlocked,
        quantityDamaged: solde._sum.quantityDamaged,
        quantityQuarantine: solde._sum.quantityQuarantine,
      }),
    );
  }

  const filtresCourants = {
    q: parametres.recherche,
    famille: premiereValeur(parametresBruts, "famille"),
    type: premiereValeur(parametresBruts, "type"),
    statut: premiereValeur(parametresBruts, "statut"),
    division: premiereValeur(parametresBruts, "division"),
  };

  return (
    <>
      <EnTetePage
        titre="Articles"
        description={`Referentiel des articles de ${usinesAutorisees(utilisateur).join(" / ")}. Le disponible est calcule dans les depots de votre perimetre.`}
        actions={
          aLaPermission(utilisateur, PERMISSIONS.ARTICLE_ECRIRE) && <Link className="lien-nav text-sm" href="/referentiel/articles/nouveau">
            Nouvel article
          </Link>
        }
      />

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Filtres des articles"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Recherche</span>
          <input
            className="champ"
            type="search"
            name="q"
            defaultValue={parametres.recherche ?? ""}
            placeholder="Code, designation ou code-barres"
          />
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
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Type</span>
          <select className="champ" name="type" defaultValue={filtresCourants.type ?? ""}>
            <option value="">Tous les types</option>
            {TYPES_ARTICLE.map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_TYPE_ARTICLE, valeur)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Statut</span>
          <select className="champ" name="statut" defaultValue={filtresCourants.statut ?? ""}>
            <option value="">Tous les statuts</option>
            {STATUTS_ARTICLE.map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_STATUT_ARTICLE, valeur)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Division</span>
          <select className="champ" name="division" defaultValue={filtresCourants.division ?? ""}>
            <option value="">Toutes les divisions</option>
            {usinesAutorisees(utilisateur).map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_USINE, valeur)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
        >
          Filtrer
        </button>
        <Link className="lien-nav text-sm" href="/referentiel/articles">
          Reinitialiser
        </Link>
      </form>

      <Carte
        titre="Liste des articles"
        description={`${total} article(s) correspondant aux criteres.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "code", libelle: "Code" },
            { cle: "designation", libelle: "Designation" },
            { cle: "famille", libelle: "Famille" },
            { cle: "type", libelle: "Type" },
            { cle: "statut", libelle: "Statut" },
            { cle: "unite", libelle: "Unite" },
            { cle: "cout", libelle: "Cout moyen (VWAP)", nombre: true },
            { cle: "disponible", libelle: "Disponible total", nombre: true },
          ]}
          lignes={articles.map((article) => {
            const disponible = disponibles.get(article.id) ?? D.ZERO;
            const enAlerte =
              disponible.isZero() &&
              D.gt(article.safetyStock, 0) &&
              article.status === "ACTIF";
            return {
              cle: String(article.id),
              cellules: [
                <Link
                  key="code"
                  className="lien-nav"
                  href={`/referentiel/articles/${article.id}`}
                >
                  {article.code}
                </Link>,
                <span key="designation">
                  {article.label1}
                  {article.designation && article.designation !== article.label1 && (
                    <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                      {article.designation}
                    </span>
                  )}
                </span>,
                article.family
                  ? `${article.family.code} — ${article.family.label}`
                  : "Sans famille",
                libelle(LIBELLES_TYPE_ARTICLE, article.type),
                <EtiquetteStatut
                  key="statut"
                  code={article.status}
                  libelle={libelle(LIBELLES_STATUT_ARTICLE, article.status)}
                />,
                article.unit ? article.unit.code : "Non definie",
                formatMontant(article.vwap, devise),
                <span key="disponible" className="inline-flex flex-wrap items-center gap-1">
                  {formatQuantite(disponible)}
                  {enAlerte && <Etiquette ton="alerte">Sous le stock de securite</Etiquette>}
                </span>,
              ],
            };
          })}
          messageVide="Aucun article ne correspond aux criteres selectionnes."
        />
        <Pagination
          page={parametres.page}
          pages={bornes.pages}
          total={total}
          construireLien={fabricantLien("/referentiel/articles", filtresCourants)}
        />
      </Carte>
    </>
  );
}
