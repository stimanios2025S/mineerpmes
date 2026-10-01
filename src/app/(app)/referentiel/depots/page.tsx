import Link from "next/link";
import type { Factory, Prisma, WarehouseType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { actionCreerEmplacement } from "@/actions/referentiel";
import { aLaPermission, exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fabricantLien,
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
  Pagination,
  Statistique,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatEntier } from "@/lib/format";
import { LIBELLES_TYPE_DEPOT, LIBELLES_USINE, libelle } from "@/lib/libelles";

export const metadata = { title: "Depots et emplacements" };

const TYPES_DEPOT: WarehouseType[] = [
  "MATIERES_PREMIERES",
  "PRODUITS_FINIS",
  "EN_COURS",
  "QUARANTAINE",
  "REBUT",
  "TRANSIT",
  "CONSOMMABLES",
];

const DIVISIONS: Factory[] = ["ADMEDCO", "MOBILIX", "COMMUN"];

const NOMBRE_EMPLACEMENTS_AFFICHES = 50;

/** Un depot de quarantaine ou de rebut n'a pas le meme usage : il est signale. */
function estDepotQuarantaine(depot: {
  type: WarehouseType;
  isQuarantineWarehouse: boolean;
}): boolean {
  return depot.isQuarantineWarehouse || depot.type === "QUARANTAINE";
}

export default async function PageDepots({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.DEPOT_LIRE);
  const peutGerer = aLaPermission(utilisateur, PERMISSIONS.DEPOT_GERER);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, ["type", "division"]);

  const typeDepot = TYPES_DEPOT.find((valeur) => valeur === parametres.filtres.type);
  const division = DIVISIONS.find((valeur) => valeur === parametres.filtres.division);

  const conditions: Prisma.WarehouseWhereInput[] = [];
  if (!utilisateur.scope.allFactories) {
    conditions.push({ factory: { in: usinesAutorisees(utilisateur) } });
  }
  if (typeDepot) conditions.push({ type: typeDepot });
  if (division) conditions.push({ factory: division });
  if (parametres.recherche) {
    const recherche = parametres.recherche;
    conditions.push({
      OR: [
        { code: modeInsensible(recherche) },
        { label: modeInsensible(recherche) },
        { address: modeInsensible(recherche) },
      ],
    });
  }
  const where: Prisma.WarehouseWhereInput =
    conditions.length > 0 ? { AND: conditions } : {};

  const [total, nombreQuarantaine, nombreRebut, depotsPourSaisie] = await Promise.all([
    prisma.warehouse.count({ where }),
    prisma.warehouse.count({ where: { type: "QUARANTAINE" } }),
    prisma.warehouse.count({ where: { type: "REBUT" } }),
    peutGerer
      ? prisma.warehouse.findMany({
          where: { isActive: true },
          orderBy: { code: "asc" },
          take: 300,
          select: { id: true, code: true, label: true },
        })
      : Promise.resolve([]),
  ]);

  const bornes = pagination(total, parametres.page, parametres.taille);
  const depots = await prisma.warehouse.findMany({
    where,
    orderBy: { code: "asc" },
    skip: bornes.skip,
    take: bornes.take,
    include: {
      locations: {
        orderBy: { code: "asc" },
        take: NOMBRE_EMPLACEMENTS_AFFICHES,
      },
      _count: { select: { locations: true, balances: true, lots: true } },
    },
  });

  const filtresCourants = {
    q: parametres.recherche,
    type: premiereValeur(parametresBruts, "type"),
    division: premiereValeur(parametresBruts, "division"),
  };

  return (
    <>
      <EnTetePage
        titre="Depots et emplacements"
        description="Organisation physique du stock : chaque depot porte un type, une division et ses emplacements. Les depots de quarantaine et de rebut sont signales : le stock qui s'y trouve n'est jamais disponible a la sortie."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Statistique
          libelle="Depots affiches"
          valeur={formatEntier(total)}
          detail="Selon les filtres et votre portee de division"
        />
        <Statistique
          libelle="Depots de quarantaine"
          valeur={formatEntier(nombreQuarantaine)}
          detail="Stock en attente de decision qualite"
          ton={nombreQuarantaine > 0 ? "alerte" : "neutre"}
        />
        <Statistique
          libelle="Depots de rebut"
          valeur={formatEntier(nombreRebut)}
          detail="Stock non commercialisable"
          ton={nombreRebut > 0 ? "danger" : "neutre"}
        />
        <Statistique
          libelle="Emplacements par page"
          valeur={formatEntier(NOMBRE_EMPLACEMENTS_AFFICHES)}
          detail="Nombre d'emplacements detailles par depot"
        />
      </div>

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Filtres des depots"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Recherche</span>
          <input
            className="champ"
            type="search"
            name="q"
            defaultValue={parametres.recherche ?? ""}
            placeholder="Code, libelle ou adresse"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Type de depot</span>
          <select className="champ" name="type" defaultValue={filtresCourants.type ?? ""}>
            <option value="">Tous les types</option>
            {TYPES_DEPOT.map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_TYPE_DEPOT, valeur)}
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
        <Link className="lien-nav text-sm" href="/referentiel/depots">
          Reinitialiser
        </Link>
      </form>

      {peutGerer && (
        <div className="mb-6">
          <Carte
            titre="Nouvel emplacement"
            description="Un emplacement appartient a un seul depot. Le couple depot / code doit etre unique."
          >
            <FormulaireAction
              action={actionCreerEmplacement}
              libelleSoumettre="Creer l'emplacement"
              varianteSoumettre="primaire"
              reinitialiser
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Champ
                  nom="depotId"
                  libelle="Depot"
                  type="select"
                  requis
                  options={depotsPourSaisie.map((depot) => ({
                    valeur: depot.id,
                    libelle: `${depot.code} — ${depot.label}`,
                  }))}
                  aide={
                    depotsPourSaisie.length === 0
                      ? "Aucun depot actif : la creation d'un emplacement est impossible."
                      : undefined
                  }
                />
                <Champ nom="code" libelle="Code emplacement" requis maxLength={40} />
                <Champ nom="libelle" libelle="Libelle" requis maxLength={200} />
                <Champ nom="allee" libelle="Allee" maxLength={40} />
                <Champ nom="rayon" libelle="Rayon" maxLength={40} />
                <Champ nom="niveau" libelle="Niveau" maxLength={40} />
              </div>
              <div className="mt-4">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="actif" defaultChecked className="mt-1" />
                  <span className="font-medium">Emplacement actif</span>
                </label>
              </div>
            </FormulaireAction>
          </Carte>
        </div>
      )}

      <div className="space-y-6">
        {depots.length === 0 && (
          <Carte>
            <Alerte ton="info" titre="Aucun depot">
              Aucun depot ne correspond aux criteres selectionnes.
            </Alerte>
          </Carte>
        )}

        {depots.map((depot) => {
          const quarantine = estDepotQuarantaine(depot);
          const rebut = depot.type === "REBUT";
          return (
            <Carte
              key={depot.id}
              titre={
                <span className="inline-flex flex-wrap items-center gap-2">
                  {depot.code} — {depot.label}
                  {depot.isDefault && <Etiquette ton="primaire">Depot par defaut</Etiquette>}
                  {quarantine && <Etiquette ton="alerte">Quarantaine</Etiquette>}
                  {rebut && <Etiquette ton="danger">Rebut</Etiquette>}
                  {!depot.isActive && <Etiquette ton="neutre">Inactif</Etiquette>}
                </span>
              }
              description={
                <>
                  {libelle(LIBELLES_TYPE_DEPOT, depot.type)} —{" "}
                  {libelle(LIBELLES_USINE, depot.factory)}
                  {depot.address ? ` — ${depot.address}` : ""}
                  {" — "}
                  {formatEntier(depot._count.locations)} emplacement(s),{" "}
                  {formatEntier(depot._count.balances)} solde(s) de stock,{" "}
                  {formatEntier(depot._count.lots)} lot(s)
                </>
              }
              sansPadding
            >
              {(quarantine || rebut) && (
                <div className="p-4 pb-0">
                  <Alerte ton={rebut ? "danger" : "alerte"} titre="Depot non disponible">
                    {rebut
                      ? "Le stock classe en rebut n'est jamais disponible a la sortie : il ne peut etre ni consomme, ni vendu, ni transfere vers un statut libre sans decision qualite."
                      : "Le stock en quarantaine est exclu du disponible : une liberation qualite est necessaire avant toute consommation ou livraison."}
                  </Alerte>
                </div>
              )}

              <Tableau
                colonnes={[
                  { cle: "code", libelle: "Code emplacement" },
                  { cle: "libelle", libelle: "Libelle" },
                  { cle: "allee", libelle: "Allee" },
                  { cle: "rayon", libelle: "Rayon" },
                  { cle: "niveau", libelle: "Niveau" },
                  { cle: "statut", libelle: "Statut" },
                ]}
                lignes={depot.locations.map((emplacement) => ({
                  cle: String(emplacement.id),
                  cellules: [
                    emplacement.code,
                    emplacement.label,
                    emplacement.aisle ?? "-",
                    emplacement.rack ?? "-",
                    emplacement.level ?? "-",
                    <Etiquette key="statut" ton={emplacement.isActive ? "succes" : "neutre"}>
                      {emplacement.isActive ? "Actif" : "Inactif"}
                    </Etiquette>,
                  ],
                }))}
                messageVide="Ce depot ne comporte aucun emplacement : adressez-vous a un responsable de depot pour en declarer."
              />

              {depot._count.locations > depot.locations.length && (
                <p className="px-4 py-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                  Seuls les {NOMBRE_EMPLACEMENTS_AFFICHES} premiers emplacements sont detailles
                  (le depot en compte {formatEntier(depot._count.locations)}).
                </p>
              )}
            </Carte>
          );
        })}

        {total > 0 && (
          <Carte sansPadding>
            <Pagination
              page={parametres.page}
              pages={bornes.pages}
              total={total}
              construireLien={fabricantLien("/referentiel/depots", filtresCourants)}
            />
          </Carte>
        )}
      </div>
    </>
  );
}
