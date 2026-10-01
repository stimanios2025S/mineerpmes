import type { Prisma, StockStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { quantiteDisponible } from "@/lib/stock/service";
import {
  aLaPermission,
  exigerAuMoinsUnePermission,
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
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatDate, formatQuantite } from "@/lib/format";
import { LIBELLES_STATUT_STOCK, libelle } from "@/lib/libelles";
import { actionChangerStatutLot } from "@/actions/stock";

export const metadata = { title: "Lots et tracabilite" };

const STATUTS_STOCK: StockStatus[] = [
  "LIBRE",
  "QUARANTAINE",
  "BLOQUE",
  "REBUT",
  "EN_COURS_PRODUCTION",
];

/** Bascule de statut qualite proposee a l'operateur. */
interface TransitionStatut {
  cible: StockStatus;
  libelle: string;
}

const TRANSITIONS: TransitionStatut[] = [
  { cible: "QUARANTAINE", libelle: "Mettre en quarantaine" },
  { cible: "BLOQUE", libelle: "Bloquer le lot" },
  { cible: "LIBRE", libelle: "Liberer le lot" },
  { cible: "REBUT", libelle: "Mettre au rebut" },
];

/**
 * Le rebut est definitif et le statut de production est pilote par le MES :
 * ces deux statuts ne se modifient pas depuis l'ecran des lots. Aucune bascule
 * n'est proposee vers le statut deja porte par le lot.
 */
function transitionsPossibles(statut: StockStatus): TransitionStatut[] {
  if (statut === "REBUT" || statut === "EN_COURS_PRODUCTION") return [];
  return TRANSITIONS.filter((transition) => transition.cible !== statut);
}

/** Une ligne de solde rattachee a un lot : emplacement et statut reels. */
interface LigneSoldeLot {
  locationId: number | null;
  locationCode: string | null;
  status: StockStatus;
  physique: Prisma.Decimal;
  disponible: Prisma.Decimal;
}

/**
 * Lots et tracabilite.
 *
 * Un lot porte son propre statut qualite, mais sa quantite vit dans le grand
 * livre : elle est donc lue dans les soldes reels du lot, jamais deduite du
 * document. Lorsque le statut du lot et celui de ses soldes divergent, la
 * divergence est affichee : elle n'est jamais resolue en silence.
 *
 * Les actions de statut passent par `changerStatutStock`, qui deplace la
 * quantite concernee entre deux statuts du meme depot et met le lot a jour.
 */
export default async function PageLots({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerAuMoinsUnePermission([
    PERMISSIONS.STOCK_LIRE,
    PERMISSIONS.STOCK_LOT_GERER,
  ]);
  const peutGerer = aLaPermission(utilisateur, PERMISSIONS.STOCK_LOT_GERER);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, ["depot", "statut"]);

  const portee = usinesAutorisees(utilisateur);
  const depotId = identifiantOuNull(parametres.filtres.depot);
  const statut =
    STATUTS_STOCK.find((valeur) => valeur === parametres.filtres.statut) ?? null;

  const where: Prisma.StockLotWhereInput = {
    warehouse: { factory: { in: portee } },
    ...(depotId ? { warehouseId: depotId } : {}),
    ...(statut ? { status: statut } : {}),
    ...(parametres.recherche
      ? {
          OR: [
            { lotNumber: modeInsensible(parametres.recherche) },
            { item: { code: modeInsensible(parametres.recherche) } },
            { item: { label1: modeInsensible(parametres.recherche) } },
          ],
        }
      : {}),
  };

  const total = await prisma.stockLot.count({ where });
  const bornes = pagination(total, parametres.page, parametres.taille);

  const [lots, depots] = await Promise.all([
    prisma.stockLot.findMany({
      where,
      orderBy: { id: "desc" },
      skip: bornes.skip,
      take: bornes.take,
      include: {
        item: { select: { code: true, label1: true, unitCode: true } },
        warehouse: { select: { code: true, label: true } },
        location: { select: { code: true } },
        supplier: { select: { code: true, label1: true } },
        workOrder: { select: { number: true } },
      },
    }),
    prisma.warehouse.findMany({
      where: { isActive: true, factory: { in: portee } },
      orderBy: [{ factory: "asc" }, { code: "asc" }],
      take: 500,
      select: { id: true, code: true, label: true },
    }),
  ]);

  const identifiants = lots.map((lot) => lot.id);
  const soldes = identifiants.length
    ? await prisma.stockBalance.findMany({
        where: { lotId: { in: identifiants } },
        orderBy: [{ locationId: "asc" }, { status: "asc" }],
        select: {
          lotId: true,
          locationId: true,
          status: true,
          quantityPhysical: true,
          quantityReserved: true,
          quantityBlocked: true,
          quantityDamaged: true,
          quantityQuarantine: true,
          location: { select: { code: true } },
        },
      })
    : [];

  const soldesParLot = new Map<number, LigneSoldeLot[]>();
  for (const solde of soldes) {
    if (solde.lotId === null) continue;
    const ligne: LigneSoldeLot = {
      locationId: solde.locationId,
      locationCode: solde.location?.code ?? null,
      status: solde.status,
      physique: solde.quantityPhysical,
      disponible: quantiteDisponible(solde),
    };
    const existantes = soldesParLot.get(solde.lotId);
    if (existantes) existantes.push(ligne);
    else soldesParLot.set(solde.lotId, [ligne]);
  }

  const filtresCourants = {
    q: premiereValeur(parametresBruts, "q"),
    depot: premiereValeur(parametresBruts, "depot"),
    statut: premiereValeur(parametresBruts, "statut"),
    taille: parametres.taille,
  };

  return (
    <>
      <EnTetePage
        titre="Lots et tracabilite"
        description="Un lot porte son statut qualite, sa tracabilite amont (fournisseur, ordre de fabrication d'origine) et sa quantite reelle. La quarantaine, le blocage, la liberation et la mise au rebut passent par le grand livre : chaque bascule est motivee par ecrit."
      />

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Filtres des lots"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Recherche</span>
          <input
            className="champ"
            type="search"
            name="q"
            defaultValue={parametres.recherche ?? ""}
            placeholder="Numero de lot ou article"
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
        <button
          type="submit"
          className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
        >
          Filtrer
        </button>
      </form>

      {!peutGerer && (
        <div className="mb-4">
          <Alerte ton="info" titre="Consultation seule">
            La gestion des statuts de lot exige une permission dediee : votre profil
            consulte les lots sans pouvoir les basculer.
          </Alerte>
        </div>
      )}

      <Carte
        titre="Lots"
        description={`${total} lot(s) correspondant aux criteres.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "numero", libelle: "Numero de lot" },
            { cle: "article", libelle: "Article" },
            { cle: "depot", libelle: "Depot" },
            { cle: "statut", libelle: "Statut" },
            { cle: "quantite", libelle: "Quantite", nombre: true },
            { cle: "reception", libelle: "Reception" },
            { cle: "peremption", libelle: "Peremption" },
            { cle: "fournisseur", libelle: "Fournisseur" },
            { cle: "ordre", libelle: "Ordre d'origine" },
            { cle: "blocage", libelle: "Motif de blocage" },
            { cle: "actions", libelle: "Actions", largeur: "22rem" },
          ]}
          lignes={lots.map((lot) => {
            const lignesSolde = soldesParLot.get(lot.id) ?? [];
            const quantiteTotale = D.sum(lignesSolde.map((ligne) => ligne.physique));
            const lignesStatut = lignesSolde.filter(
              (ligne) => ligne.status === lot.status,
            );
            const transitions = peutGerer ? transitionsPossibles(lot.status) : [];

            const repartition = STATUTS_STOCK.map((valeur) => {
              const quantite = D.sum(
                lignesSolde
                  .filter((ligne) => ligne.status === valeur)
                  .map((ligne) => ligne.physique),
              );
              return quantite.isZero()
                ? null
                : `${libelle(LIBELLES_STATUT_STOCK, valeur)} ${formatQuantite(quantite)}`;
            }).filter((element): element is string => element !== null);

            return {
              cle: String(lot.id),
              cellules: [
                <span key="numero" className="font-medium">
                  {lot.lotNumber}
                </span>,
                <span key="article">
                  <span className="font-medium">{lot.item.code}</span>
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    {lot.item.label1}
                  </span>
                </span>,
                <span key="depot">
                  {lot.warehouse.code}
                  {lot.location ? (
                    <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                      emplacement {lot.location.code}
                    </span>
                  ) : null}
                </span>,
                <EtiquetteStatut
                  key="statut"
                  code={lot.status}
                  libelle={libelle(LIBELLES_STATUT_STOCK, lot.status)}
                />,
                <span key="quantite">
                  <span className="font-semibold">{formatQuantite(quantiteTotale)}</span>
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    {lot.item.unitCode ?? "unite non definie"}
                    {repartition.length > 0 ? ` — ${repartition.join(" / ")}` : ""}
                  </span>
                </span>,
                formatDate(lot.receivedAt),
                formatDate(lot.expirationDate),
                lot.supplier ? `${lot.supplier.code} — ${lot.supplier.label1}` : "-",
                lot.workOrder?.number ?? "-",
                <span key="blocage">
                  {lot.blockingReason ?? "-"}
                  {lot.isImmobilization && (
                    <span className="mt-1 block">
                      <Etiquette ton="alerte">Immobilisation</Etiquette>
                    </span>
                  )}
                </span>,
                <span key="actions" className="flex flex-col items-start gap-2">
                  {!peutGerer ? (
                    <span className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      Permission de gestion requise
                    </span>
                  ) : transitions.length === 0 ? (
                    <span className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      {lot.status === "REBUT"
                        ? "Statut definitif : aucune bascule proposee."
                        : "Statut pilote par la production."}
                    </span>
                  ) : lignesStatut.length === 0 ? (
                    <Etiquette ton="danger">
                      Divergence : aucun solde au statut {libelle(LIBELLES_STATUT_STOCK, lot.status)}
                    </Etiquette>
                  ) : (
                    <details className="w-full">
                      <summary className="lien-nav cursor-pointer text-xs">
                        Changer le statut
                      </summary>
                      <div className="mt-2">
                        <FormulaireAction
                          action={actionChangerStatutLot}
                          libelleSoumettre="Appliquer le statut"
                          varianteSoumettre="secondaire"
                          reinitialiser
                          discret
                        >
                          <input type="hidden" name="lotId" value={lot.id} />
                          <input type="hidden" name="itemId" value={lot.itemId} />
                          <input type="hidden" name="warehouseId" value={lot.warehouseId} />
                          <input type="hidden" name="de" value={lot.status} />
                          <Champ
                            nom="vers"
                            libelle="Nouveau statut"
                            type="select"
                            requis
                            options={transitions.map((transition) => ({
                              valeur: transition.cible,
                              libelle: transition.libelle,
                            }))}
                          />
                          <div className="mt-2">
                            <Champ
                              nom="locationId"
                              libelle="Emplacement"
                              type="select"
                              options={lignesStatut.map((ligne) => ({
                                valeur: ligne.locationId ?? "",
                                libelle: `${ligne.locationCode ?? "Sans emplacement"} — ${formatQuantite(
                                  ligne.disponible,
                                )} disponible(s)`,
                              }))}
                              aide="Le lot doit etre choisi dans l'emplacement qui porte reellement le stock."
                            />
                          </div>
                          <div className="mt-2">
                            <Champ
                              nom="quantity"
                              libelle="Quantite a deplacer"
                              type="number"
                              pas="any"
                              min="0"
                              requis
                              aide={`Disponible dans le statut courant : ${formatQuantite(
                                D.sum(lignesStatut.map((ligne) => ligne.disponible)),
                              )}`}
                            />
                          </div>
                          <div className="mt-2">
                            <label className="block text-sm">
                              <span className="mb-1 block font-medium">
                                Motif<span style={{ color: "var(--danger)" }}> *</span>
                              </span>
                              <textarea
                                className="champ"
                                name="motif"
                                rows={2}
                                required
                                minLength={10}
                                placeholder="Motif obligatoire (au moins 10 caracteres)"
                              />
                            </label>
                          </div>
                        </FormulaireAction>
                      </div>
                    </details>
                  )}
                </span>,
              ],
            };
          })}
          messageVide="Aucun lot ne correspond aux criteres selectionnes."
        />
        <Pagination
          page={parametres.page}
          pages={bornes.pages}
          total={total}
          construireLien={fabricantLien("/stock/lots", filtresCourants)}
        />
      </Carte>
    </>
  );
}
