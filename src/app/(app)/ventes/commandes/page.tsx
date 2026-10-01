import Link from "next/link";
import type { Prisma, SalesOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D, type Decimal } from "@/lib/decimal";
import { listerCommandesClient } from "@/lib/vente/service";
import { lireParametreTexte, CLE_PARAMETRE } from "@/lib/settings";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { fabricantLien, lireParametresListe, modeInsensible, premiereValeur } from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Pagination,
  Tableau,
} from "@/components/ui";
import {
  DEVISE_PAR_DEFAUT,
  formatDate,
  formatMontant,
  formatPourcentage,
  formatQuantite,
} from "@/lib/format";
import { LIBELLES_STATUT_COMMANDE_CLIENT, libelle } from "@/lib/libelles";

export const metadata = { title: "Commandes client" };

const STATUTS_COMMANDE: SalesOrderStatus[] = [
  "BROUILLON",
  "CONFIRMEE",
  "PARTIELLEMENT_PRODUITE",
  "PRODUITE",
  "PARTIELLEMENT_LIVREE",
  "LIVREE",
  "FACTUREE",
  "CLOTUREE",
  "ANNULEE",
];

/** Date de filtre lue dans l'URL : une saisie invalide est ignoree, jamais fatale. */
function dateDeFiltre(valeur: string | null): Date | null {
  if (!valeur) return null;
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Borne haute d'une periode : le jour saisi est inclus en entier. */
function finDeJournee(valeur: Date): Date {
  return new Date(valeur.getTime() + 24 * 60 * 60 * 1000);
}

interface Avancement {
  commandee: Decimal;
  produite: Decimal;
  livree: Decimal;
  facturee: Decimal;
}

interface LigneCommande {
  id: number;
  numero: string;
  client: string;
  statut: SalesOrderStatus;
  devise: string;
  dateCommande: Date;
  datePrevue: Date | null;
  totalTTC: Decimal;
  avancement: Avancement;
  ordresDeFabrication: number;
  bonsDeLivraison: number;
  factures: number;
  enRetard: boolean;
}

function calculerAvancement(
  lignes: {
    quantity: Decimal;
    quantityProduced: Decimal;
    quantityDelivered: Decimal;
    quantityInvoiced: Decimal;
  }[],
): Avancement {
  return {
    commandee: D.sum(lignes.map((ligne) => ligne.quantity)),
    produite: D.sum(lignes.map((ligne) => ligne.quantityProduced)),
    livree: D.sum(lignes.map((ligne) => ligne.quantityDelivered)),
    facturee: D.sum(lignes.map((ligne) => ligne.quantityInvoiced)),
  };
}

/**
 * Consultation des commandes client.
 *
 * Le service ne filtre que par statut et par client : la recherche textuelle et
 * la periode sont alors appliquees en base, en lecture seule et sur des pages
 * bornees, pour que le total et la pagination restent exacts.
 */
async function chargerCommandes(entree: {
  statut: SalesOrderStatus | undefined;
  clientId: number | undefined;
  recherche: string | null;
  du: Date | null;
  au: Date | null;
  page: number;
  taille: number;
}): Promise<{ lignes: LigneCommande[]; total: number; pages: number }> {
  const maintenant = Date.now();

  const versLigne = (commande: {
    id: number;
    number: string;
    status: SalesOrderStatus;
    orderDate: Date;
    expectedDate: Date | null;
    currency: string;
    totalTTC: Decimal;
    customer: { code: string; label1: string };
    lines: {
      quantity: Decimal;
      quantityProduced: Decimal;
      quantityDelivered: Decimal;
      quantityInvoiced: Decimal;
    }[];
    workOrders: unknown[];
    _count: { deliveryNotes: number; invoices: number };
  }): LigneCommande => ({
    id: commande.id,
    numero: commande.number,
    client: `${commande.customer.code} — ${commande.customer.label1}`,
    statut: commande.status,
    devise: commande.currency,
    dateCommande: commande.orderDate,
    datePrevue: commande.expectedDate,
    totalTTC: D.of(commande.totalTTC),
    avancement: calculerAvancement(commande.lines),
    ordresDeFabrication: commande.workOrders.length,
    bonsDeLivraison: commande._count.deliveryNotes,
    factures: commande._count.invoices,
    enRetard:
      commande.expectedDate !== null &&
      commande.expectedDate.getTime() < maintenant &&
      commande.status !== "LIVREE" &&
      commande.status !== "FACTUREE" &&
      commande.status !== "CLOTUREE" &&
      commande.status !== "ANNULEE",
  });

  if (!entree.recherche && !entree.du && !entree.au) {
    const liste = await listerCommandesClient({
      statut: entree.statut,
      customerId: entree.clientId,
      page: entree.page,
      taille: entree.taille,
    });
    return {
      lignes: liste.lignes.map(versLigne),
      total: liste.total,
      pages: liste.pages,
    };
  }

  const where: Prisma.SalesOrderWhereInput = {};
  if (entree.statut) where.status = entree.statut;
  if (entree.clientId) where.customerId = entree.clientId;
  if (entree.recherche) {
    where.OR = [
      { number: modeInsensible(entree.recherche) },
      { customerRef: modeInsensible(entree.recherche) },
      { customer: { code: modeInsensible(entree.recherche) } },
      { customer: { label1: modeInsensible(entree.recherche) } },
    ];
  }
  if (entree.du || entree.au) {
    where.orderDate = {
      ...(entree.du ? { gte: entree.du } : {}),
      ...(entree.au ? { lt: finDeJournee(entree.au) } : {}),
    };
  }

  const [total, lignes] = await Promise.all([
    prisma.salesOrder.count({ where }),
    prisma.salesOrder.findMany({
      where,
      orderBy: { orderDate: "desc" },
      skip: (entree.page - 1) * entree.taille,
      take: entree.taille,
      include: {
        customer: { select: { code: true, label1: true } },
        lines: {
          select: {
            quantity: true,
            quantityProduced: true,
            quantityDelivered: true,
            quantityInvoiced: true,
          },
        },
        workOrders: { select: { id: true } },
        _count: { select: { deliveryNotes: true, invoices: true } },
      },
    }),
  ]);

  return {
    lignes: lignes.map(versLigne),
    total,
    pages: Math.max(1, Math.ceil(total / entree.taille)),
  };
}

export default async function PageCommandesClient({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.VENTE_LIRE);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, ["statut", "client", "du", "au"]);

  const statut = STATUTS_COMMANDE.find((valeur) => valeur === parametres.filtres.statut);
  const clientBrut = parametres.filtres.client;
  const clientId =
    clientBrut !== null && /^\d+$/.test(clientBrut) ? Number.parseInt(clientBrut, 10) : undefined;
  const du = dateDeFiltre(parametres.filtres.du);
  const au = dateDeFiltre(parametres.filtres.au);
  const filtreEtendu = parametres.recherche !== null || du !== null || au !== null;

  const [liste, clients, devise] = await Promise.all([
    chargerCommandes({
      statut,
      clientId,
      recherche: parametres.recherche,
      du,
      au,
      page: parametres.page,
      taille: parametres.taille,
    }),
    prisma.thirdParty.findMany({
      where: { isClient: true },
      orderBy: { code: "asc" },
      take: 500,
      select: { id: true, code: true, label1: true },
    }),
    lireParametreTexte(CLE_PARAMETRE.DEVISE, DEVISE_PAR_DEFAUT),
  ]);

  const filtresCourants = {
    statut: premiereValeur(parametresBruts, "statut"),
    client: premiereValeur(parametresBruts, "client"),
    du: premiereValeur(parametresBruts, "du"),
    au: premiereValeur(parametresBruts, "au"),
    q: premiereValeur(parametresBruts, "q"),
  };

  return (
    <>
      <EnTetePage
        titre="Commandes client"
        description={`Engagements clients suivis quantite par quantite : production, livraison et facturation reelles. Les montants sont exprimes en ${devise}.`}
        actions={
          <Link className="lien-nav text-sm" href="/ventes/commandes/nouvelle">
            Nouvelle commande client
          </Link>
        }
      />

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Filtres des commandes client"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Recherche</span>
          <input
            className="champ"
            type="search"
            name="q"
            defaultValue={filtresCourants.q ?? ""}
            placeholder="Numero de commande, reference ou client"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Statut</span>
          <select className="champ" name="statut" defaultValue={filtresCourants.statut ?? ""}>
            <option value="">Tous les statuts</option>
            {STATUTS_COMMANDE.map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_STATUT_COMMANDE_CLIENT, valeur)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Client</span>
          <select className="champ" name="client" defaultValue={filtresCourants.client ?? ""}>
            <option value="">Tous les clients</option>
            {clients.map((element) => (
              <option key={element.id} value={element.id}>
                {element.code} — {element.label1}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Commandees a partir du</span>
          <input className="champ" type="date" name="du" defaultValue={filtresCourants.du ?? ""} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Jusqu&apos;au</span>
          <input className="champ" type="date" name="au" defaultValue={filtresCourants.au ?? ""} />
        </label>
        <button
          type="submit"
          className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
        >
          Filtrer
        </button>
        <Link className="lien-nav text-sm" href="/ventes/commandes">
          Reinitialiser
        </Link>
      </form>

      {filtreEtendu && (
        <div className="mb-4">
          <Alerte ton="info" titre="Recherche et periode filtrees en base">
            Le total et la pagination portent sur l&apos;ensemble des commandes correspondant a la
            recherche et a la periode, et non sur la seule page affichee.
          </Alerte>
        </div>
      )}

      <Carte
        titre="Commandes client"
        description={`${liste.total} commande(s) correspondant aux criteres.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "numero", libelle: "Numero" },
            { cle: "client", libelle: "Client" },
            { cle: "statut", libelle: "Statut" },
            { cle: "date", libelle: "Date" },
            { cle: "prevue", libelle: "Date prevue" },
            { cle: "ttc", libelle: "Montant TTC", nombre: true },
            { cle: "produit", libelle: "Produit", nombre: true },
            { cle: "livre", libelle: "Livre", nombre: true },
            { cle: "facture", libelle: "Facture", nombre: true },
            { cle: "documents", libelle: "Documents" },
          ]}
          lignes={liste.lignes.map((commande) => ({
            cle: String(commande.id),
            cellules: [
              <Link key="numero" className="lien-nav" href={`/ventes/commandes/${commande.id}`}>
                {commande.numero}
              </Link>,
              commande.client,
              <span key="statut" className="inline-flex flex-wrap items-center gap-1">
                <EtiquetteStatut
                  code={commande.statut}
                  libelle={libelle(LIBELLES_STATUT_COMMANDE_CLIENT, commande.statut)}
                />
                {commande.enRetard && <Etiquette ton="danger">En retard</Etiquette>}
              </span>,
              formatDate(commande.dateCommande),
              formatDate(commande.datePrevue),
              formatMontant(commande.totalTTC, commande.devise),
              <span key="produit">
                {formatPourcentage(
                  D.percent(commande.avancement.produite, commande.avancement.commandee),
                  0,
                )}
                <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                  {formatQuantite(commande.avancement.produite)} /{" "}
                  {formatQuantite(commande.avancement.commandee)}
                </span>
              </span>,
              <span key="livre">
                {formatPourcentage(
                  D.percent(commande.avancement.livree, commande.avancement.commandee),
                  0,
                )}
                <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                  {formatQuantite(commande.avancement.livree)} /{" "}
                  {formatQuantite(commande.avancement.commandee)}
                </span>
              </span>,
              <span key="facture">
                {formatPourcentage(
                  D.percent(commande.avancement.facturee, commande.avancement.commandee),
                  0,
                )}
                <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                  {formatQuantite(commande.avancement.facturee)} /{" "}
                  {formatQuantite(commande.avancement.commandee)}
                </span>
              </span>,
              <span key="documents" className="text-xs">
                {commande.ordresDeFabrication} ordre(s) de fabrication
                <span className="block">{commande.bonsDeLivraison} bon(s) de livraison</span>
                <span className="block">{commande.factures} facture(s)</span>
              </span>,
            ],
          }))}
          messageVide="Aucune commande client ne correspond aux criteres selectionnes."
        />
        <Pagination
          page={parametres.page}
          pages={liste.pages}
          total={liste.total}
          construireLien={fabricantLien("/ventes/commandes", filtresCourants)}
        />
      </Carte>
    </>
  );
}
