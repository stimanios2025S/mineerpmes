import { Prisma, type Factory, type StockStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { quantiteDisponible } from "@/lib/stock/service";
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
import {
  Alerte,
  Carte,
  EnTetePage,
  EtiquetteStatut,
  Pagination,
  Statistique,
  Tableau,
} from "@/components/ui";
import { formatEntier, formatMontant, formatQuantite } from "@/lib/format";
import { LIBELLES_STATUT_STOCK, LIBELLES_USINE, libelle } from "@/lib/libelles";

export const metadata = { title: "Etat des stocks" };

const STATUTS_STOCK: StockStatus[] = [
  "LIBRE",
  "QUARANTAINE",
  "BLOQUE",
  "REBUT",
  "EN_COURS_PRODUCTION",
];

/**
 * Compte, cote base, les articles dont la quantite disponible cumulee est
 * inferieure au minimum configure sur l'article (`Item.quantityMin`).
 *
 * Le disponible retranche la reserve, le blocage, l'endommagement et la
 * quarantaine : c'est la quantite reellement consommable. Le calcul est fait
 * par PostgreSQL pour porter sur l'ensemble du stock, et non sur la seule page
 * affichee.
 */
async function compterArticlesSousMinimum(filtres: {
  portee: Factory[];
  recherche: string | null;
  familyId: number | null;
}): Promise<number> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`w."factory"::text IN (${Prisma.join(filtres.portee)})`,
  ];

  if (filtres.recherche) {
    const motif = `%${filtres.recherche}%`;
    conditions.push(
      Prisma.sql`(i."code" ILIKE ${motif} OR i."label1" ILIKE ${motif})`,
    );
  }
  if (filtres.familyId !== null) {
    conditions.push(Prisma.sql`i."familyId" = ${filtres.familyId}`);
  }

  const lignes = await prisma.$queryRaw<{ nombre: number }[]>`
    SELECT COUNT(*)::int AS "nombre"
    FROM (
      SELECT i."id" AS "article",
             i."quantityMin" AS "minimum",
             SUM(b."quantityPhysical" - b."quantityReserved" - b."quantityBlocked"
                 - b."quantityDamaged" - b."quantityQuarantine") AS "disponible"
      FROM "StockBalance" b
      JOIN "Warehouse" w ON w."id" = b."warehouseId"
      JOIN "Item" i ON i."id" = b."itemId"
      WHERE ${Prisma.join(conditions, " AND ")}
      GROUP BY i."id", i."quantityMin"
    ) soldes
    WHERE soldes."minimum" > 0 AND soldes."disponible" < soldes."minimum"
  `;

  return lignes[0]?.nombre ?? 0;
}

/**
 * Etat des stocks : une ligne par solde reel (article, depot, emplacement, lot,
 * statut). Aucune quantite n'est recalculee ici : le disponible provient de
 * `quantiteDisponible`, la meme fonction que celle utilisee pour refuser une
 * sortie.
 */
export default async function PageStock({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.STOCK_LIRE);
  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, [
    "depot",
    "statut",
    "famille",
    "division",
  ]);

  const portee = usinesAutorisees(utilisateur);

  const statut =
    STATUTS_STOCK.find((valeur) => valeur === parametres.filtres.statut) ?? null;
  const statutInconnu = parametres.filtres.statut !== null && statut === null;

  const depotId = identifiantOuNull(parametres.filtres.depot);
  const familleId = identifiantOuNull(parametres.filtres.famille);

  // Une division demandee hors de la portee de l'utilisateur est refusee et
  // signalee : elle n'est jamais remplacee en silence par une autre valeur.
  const divisionDemandee = parametres.filtres.division;
  const division = portee.find((valeur) => valeur === divisionDemandee) ?? null;
  const divisionRefusee = divisionDemandee !== null && division === null;

  const voirValorisation = aLaPermission(
    utilisateur,
    PERMISSIONS.STOCK_VALORISATION_LIRE,
  );

  const where: Prisma.StockBalanceWhereInput = {
    warehouse: { factory: { in: division ? [division] : portee } },
    ...(depotId ? { warehouseId: depotId } : {}),
    ...(statut ? { status: statut } : {}),
    ...(parametres.recherche || familleId
      ? {
          item: {
            ...(parametres.recherche
              ? {
                  OR: [
                    { code: modeInsensible(parametres.recherche) },
                    { label1: modeInsensible(parametres.recherche) },
                  ],
                }
              : {}),
            ...(familleId ? { familyId: familleId } : {}),
          },
        }
      : {}),
  };

  const total = await prisma.stockBalance.count({ where });
  const bornes = pagination(total, parametres.page, parametres.taille);

  const [lignes, valorisation, depots, familles, articlesSousMinimum] =
    await Promise.all([
      prisma.stockBalance.findMany({
        where,
        orderBy: [{ item: { code: "asc" } }, { warehouseId: "asc" }, { status: "asc" }],
        skip: bornes.skip,
        take: bornes.take,
        include: {
          item: {
            select: {
              code: true,
              label1: true,
              unitCode: true,
              quantityMin: true,
              family: { select: { code: true, label: true } },
            },
          },
          warehouse: { select: { code: true, label: true, factory: true } },
          location: { select: { code: true } },
          lot: { select: { lotNumber: true } },
        },
      }),
      voirValorisation
        ? prisma.stockBalance.aggregate({ where, _sum: { totalValue: true } })
        : Promise.resolve(null),
      prisma.warehouse.findMany({
        where: { isActive: true, factory: { in: portee } },
        orderBy: [{ factory: "asc" }, { code: "asc" }],
        take: 500,
        select: { id: true, code: true, label: true, factory: true },
      }),
      prisma.itemFamily.findMany({
        orderBy: { code: "asc" },
        take: 500,
        select: { id: true, code: true, label: true },
      }),
      compterArticlesSousMinimum({
        portee,
        recherche: parametres.recherche,
        familyId: familleId,
      }),
    ]);

  const valeurTotale = valorisation?._sum.totalValue ?? null;

  const filtresCourants = {
    q: premiereValeur(parametresBruts, "q"),
    depot: premiereValeur(parametresBruts, "depot"),
    statut: premiereValeur(parametresBruts, "statut"),
    famille: premiereValeur(parametresBruts, "famille"),
    division: premiereValeur(parametresBruts, "division"),
    taille: parametres.taille,
  };

  return (
    <>
      <EnTetePage
        titre="Etat des stocks"
        description="Chaque ligne est un solde reel en base : article, depot, emplacement, lot et statut qualite. Le disponible retranche les reservations, le blocage, l'endommagement et la quarantaine."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Statistique
          libelle="Lignes de stock"
          valeur={formatEntier(total)}
          detail="Soldes correspondant aux filtres appliques."
        />
        <Statistique
          libelle="Valeur du stock"
          valeur={valeurTotale ? formatMontant(valeurTotale) : "Non autorisee"}
          detail={
            voirValorisation
              ? "Cout moyen pondere des lignes affichees."
              : "La consultation de la valorisation exige une permission dediee."
          }
          ton={voirValorisation ? "neutre" : "alerte"}
        />
        <Statistique
          libelle="Articles sous le minimum"
          valeur={formatEntier(articlesSousMinimum)}
          detail="Quantite disponible inferieure au minimum configure, sur l'ensemble des depots de votre portee."
          ton={articlesSousMinimum > 0 ? "danger" : "succes"}
        />
      </div>

      {divisionRefusee && (
        <div className="mb-4">
          <Alerte ton="danger" titre="Division hors de votre portee">
            La division demandee ({libelle(LIBELLES_USINE, divisionDemandee)}) ne fait
            pas partie des divisions auxquelles votre profil donne acces. Le filtre
            n&apos;a pas ete applique.
          </Alerte>
        </div>
      )}

      {statutInconnu && (
        <div className="mb-4">
          <Alerte ton="danger" titre="Statut inconnu">
            Le statut demande ({parametres.filtres.statut}) n&apos;existe pas dans le
            referentiel des statuts de stock. Le filtre n&apos;a pas ete applique.
          </Alerte>
        </div>
      )}

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Filtres de l'etat des stocks"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Article</span>
          <input
            className="champ"
            type="search"
            name="q"
            defaultValue={parametres.recherche ?? ""}
            placeholder="Code ou libelle"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Depot</span>
          <select className="champ" name="depot" defaultValue={filtresCourants.depot ?? ""}>
            <option value="">Tous les depots</option>
            {depots.map((depot) => (
              <option key={depot.id} value={depot.id}>
                {depot.code} — {depot.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Statut</span>
          <select className="champ" name="statut" defaultValue={filtresCourants.statut ?? ""}>
            <option value="">Tous les statuts</option>
            {STATUTS_STOCK.map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_STATUT_STOCK, valeur)}
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
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Division</span>
          <select
            className="champ"
            name="division"
            defaultValue={filtresCourants.division ?? ""}
          >
            <option value="">Toutes les divisions</option>
            {portee.map((valeur) => (
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
      </form>

      <Carte
        titre="Soldes de stock"
        description={`${total} ligne(s) de solde correspondant aux criteres.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "article", libelle: "Article" },
            { cle: "depot", libelle: "Depot" },
            { cle: "emplacement", libelle: "Emplacement" },
            { cle: "lot", libelle: "Lot" },
            { cle: "statut", libelle: "Statut" },
            { cle: "physique", libelle: "Physique", nombre: true },
            { cle: "reserve", libelle: "Reservee", nombre: true },
            { cle: "bloque", libelle: "Bloquee", nombre: true },
            { cle: "quarantaine", libelle: "Quarantaine", nombre: true },
            { cle: "disponible", libelle: "Disponible", nombre: true },
            ...(voirValorisation
              ? [
                  { cle: "cout", libelle: "Cout moyen", nombre: true },
                  { cle: "valeur", libelle: "Valeur", nombre: true },
                ]
              : []),
          ]}
          lignes={lignes.map((ligne) => {
            const disponible = quantiteDisponible(ligne);
            const minimumConfigure = ligne.item.quantityMin;
            const sousMinimum =
              minimumConfigure.greaterThan(0) &&
              disponible.lessThan(minimumConfigure);

            return {
              cle: String(ligne.id),
              cellules: [
                <span key="article">
                  <span className="font-medium">{ligne.item.code}</span>
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    {ligne.item.label1}
                    {ligne.item.family ? ` — ${ligne.item.family.label}` : ""}
                  </span>
                </span>,
                <span key="depot">
                  {ligne.warehouse.code}
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    {libelle(LIBELLES_USINE, ligne.warehouse.factory)}
                  </span>
                </span>,
                ligne.location?.code ?? "Sans emplacement",
                ligne.lot?.lotNumber ?? "Sans lot",
                <EtiquetteStatut
                  key="statut"
                  code={ligne.status}
                  libelle={libelle(LIBELLES_STATUT_STOCK, ligne.status)}
                />,
                formatQuantite(ligne.quantityPhysical),
                formatQuantite(ligne.quantityReserved),
                formatQuantite(ligne.quantityBlocked),
                formatQuantite(ligne.quantityQuarantine),
                <span key="disponible">
                  <span
                    className="font-semibold"
                    style={{ color: sousMinimum ? "var(--danger)" : undefined }}
                  >
                    {formatQuantite(disponible)}
                  </span>
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    {ligne.item.unitCode ?? "unite non definie"}
                    {sousMinimum
                      ? ` — minimum ${formatQuantite(minimumConfigure)}`
                      : ""}
                  </span>
                </span>,
                ...(voirValorisation
                  ? [
                      formatMontant(ligne.unitCost),
                      formatMontant(ligne.totalValue),
                    ]
                  : []),
              ],
            };
          })}
          messageVide="Aucun solde de stock ne correspond aux criteres selectionnes."
        />
        <Pagination
          page={parametres.page}
          pages={bornes.pages}
          total={total}
          construireLien={fabricantLien("/stock", filtresCourants)}
        />
      </Carte>
    </>
  );
}
