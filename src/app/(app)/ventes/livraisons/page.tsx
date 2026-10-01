import Link from "next/link";
import type { DeliveryStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D, type Decimal } from "@/lib/decimal";
import {
  commandesARelivrer,
  listerBonsLivraison,
  livraisonsEnAttenteDeStock,
} from "@/lib/vente/service";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { fabricantLien, lireParametresListe, modeInsensible, premiereValeur } from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  EtiquetteStatut,
  Pagination,
  Tableau,
} from "@/components/ui";
import { formatDate, formatQuantite } from "@/lib/format";
import { LIBELLES_STATUT_LIVRAISON, libelle } from "@/lib/libelles";

export const metadata = { title: "Bons de livraison" };

const STATUTS_LIVRAISON: DeliveryStatus[] = [
  "BROUILLON",
  "PREPAREE",
  "EXPEDIEE",
  "LIVREE",
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

interface LigneLivraison {
  id: number;
  numero: string;
  client: string;
  commande: string | null;
  statut: DeliveryStatus;
  dateLivraison: Date;
  depot: string;
  nombreLignes: number;
  factures: number;
  quantiteLivree: Decimal;
}

/**
 * Consultation des bons de livraison.
 *
 * Le service ne filtre que par statut et par client : la recherche textuelle et
 * la periode sont appliquees en base, en lecture seule et sur des pages bornees,
 * afin que le total et la pagination restent exacts.
 */
async function chargerLivraisons(entree: {
  statut: DeliveryStatus | undefined;
  clientId: number | undefined;
  recherche: string | null;
  du: Date | null;
  au: Date | null;
  page: number;
  taille: number;
}): Promise<{ lignes: LigneLivraison[]; total: number; pages: number }> {
  const versLigne = (livraison: {
    id: number;
    number: string;
    status: DeliveryStatus;
    deliveryDate: Date;
    customer: { code: string; label1: string };
    order: { number: string } | null;
    warehouse: { code: string };
    lines: { quantityDelivered: Decimal }[];
    _count: { invoices: number };
  }): LigneLivraison => ({
    id: livraison.id,
    numero: livraison.number,
    client: `${livraison.customer.code} — ${livraison.customer.label1}`,
    commande: livraison.order?.number ?? null,
    statut: livraison.status,
    dateLivraison: livraison.deliveryDate,
    depot: livraison.warehouse.code,
    nombreLignes: livraison.lines.length,
    factures: livraison._count.invoices,
    quantiteLivree: D.sum(livraison.lines.map((ligne) => ligne.quantityDelivered)),
  });

  if (!entree.recherche && !entree.du && !entree.au) {
    const liste = await listerBonsLivraison({
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

  const where: Prisma.DeliveryNoteWhereInput = {};
  if (entree.statut) where.status = entree.statut;
  if (entree.clientId) where.customerId = entree.clientId;
  if (entree.recherche) {
    where.OR = [
      { number: modeInsensible(entree.recherche) },
      { customerRef: modeInsensible(entree.recherche) },
      { order: { number: modeInsensible(entree.recherche) } },
      { customer: { code: modeInsensible(entree.recherche) } },
      { customer: { label1: modeInsensible(entree.recherche) } },
    ];
  }
  if (entree.du || entree.au) {
    where.deliveryDate = {
      ...(entree.du ? { gte: entree.du } : {}),
      ...(entree.au ? { lt: finDeJournee(entree.au) } : {}),
    };
  }

  const [total, lignes] = await Promise.all([
    prisma.deliveryNote.count({ where }),
    prisma.deliveryNote.findMany({
      where,
      orderBy: { deliveryDate: "desc" },
      skip: (entree.page - 1) * entree.taille,
      take: entree.taille,
      include: {
        customer: { select: { code: true, label1: true } },
        order: { select: { number: true } },
        warehouse: { select: { code: true } },
        lines: { select: { quantityDelivered: true } },
        _count: { select: { invoices: true } },
      },
    }),
  ]);

  return {
    lignes: lignes.map(versLigne),
    total,
    pages: Math.max(1, Math.ceil(total / entree.taille)),
  };
}

export default async function PageLivraisons({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.VENTE_LIRE);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, ["statut", "client", "du", "au"]);

  const statut = STATUTS_LIVRAISON.find((valeur) => valeur === parametres.filtres.statut);
  const clientBrut = parametres.filtres.client;
  const clientId =
    clientBrut !== null && /^\d+$/.test(clientBrut) ? Number.parseInt(clientBrut, 10) : undefined;
  const du = dateDeFiltre(parametres.filtres.du);
  const au = dateDeFiltre(parametres.filtres.au);
  const filtreEtendu = parametres.recherche !== null || du !== null || au !== null;

  const [liste, clients, enAttenteDeStock, aRelivrer] = await Promise.all([
    chargerLivraisons({
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
    livraisonsEnAttenteDeStock(),
    commandesARelivrer(),
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
        titre="Bons de livraison"
        description="Sortie de la marchandise chez le client : preparation, expedition (mouvement de stock reel, lot par lot) puis confirmation de livraison."
        actions={
          <Link className="lien-nav text-sm" href="/ventes/livraisons/nouvelle">
            Nouveau bon de livraison
          </Link>
        }
      />

      <div className="mb-6 space-y-4">
        <Carte
          titre={`Livraisons en attente de stock (${enAttenteDeStock.length})`}
          description="Bons de livraison en brouillon ou prepares dont la marchandise n'est pas entierement disponible dans le depot de depart. L'expedition sera refusee tant que le stock reste insuffisant."
          sansPadding
        >
          {enAttenteDeStock.length === 0 ? (
            <p className="px-4 py-3 text-sm" style={{ color: "var(--texte-doux)" }}>
              Aucun bon de livraison en attente de marchandise : tout le disponible necessaire est
              present dans les depots de depart.
            </p>
          ) : (
            <Tableau
              colonnes={[
                { cle: "numero", libelle: "Bon de livraison" },
                { cle: "client", libelle: "Client" },
                { cle: "article", libelle: "Article" },
                { cle: "demande", libelle: "Demande", nombre: true },
                { cle: "disponible", libelle: "Disponible", nombre: true },
                { cle: "manquant", libelle: "Manquant", nombre: true },
              ]}
              lignes={enAttenteDeStock.flatMap((element) =>
                element.lignes.map((ligne) => ({
                  cle: `${element.livraisonId}-${ligne.itemCode}`,
                  cellules: [
                    <Link
                      key="numero"
                      className="lien-nav"
                      href={`/ventes/livraisons/${element.livraisonId}`}
                    >
                      {element.numero}
                    </Link>,
                    element.client,
                    ligne.itemCode,
                    formatQuantite(ligne.demande),
                    formatQuantite(ligne.disponible),
                    formatQuantite(ligne.manquant),
                  ],
                })),
              )}
              messageVide="Aucune ligne en manque."
            />
          )}
        </Carte>

        <Carte
          titre={`Commandes a relivrer (${aRelivrer.length})`}
          description="Commandes confirmees dont la production ou la livraison reste inachevee. Le reste a livrer est calcule sur les quantites reelles."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Commande" },
              { cle: "client", libelle: "Client" },
              { cle: "date", libelle: "Date de commande" },
              { cle: "prevue", libelle: "Livraison prevue" },
              { cle: "reste", libelle: "Reste a livrer", nombre: true },
              { cle: "lignes", libelle: "Lignes restantes" },
            ]}
            lignes={aRelivrer.map((commande) => {
              const restes = commande.lines
                .map((ligne) => ({
                  code: ligne.item.code,
                  reste: D.sub(D.of(ligne.quantity), D.of(ligne.quantityDelivered)),
                }))
                .filter((element) => D.gt(element.reste, 0));
              return {
                cle: String(commande.id),
                cellules: [
                  <Link key="numero" className="lien-nav" href={`/ventes/commandes/${commande.id}`}>
                    {commande.number}
                  </Link>,
                  `${commande.customer.code} — ${commande.customer.label1}`,
                  formatDate(commande.orderDate),
                  formatDate(commande.expectedDate),
                  formatQuantite(restes.reduce((total, element) => D.add(total, element.reste), D.ZERO)),
                  restes.length > 0
                    ? restes
                        .map((element) => `${element.code} : ${formatQuantite(element.reste)}`)
                        .join(" — ")
                    : "Aucune quantite restante a livrer",
                ],
              };
            })}
            messageVide="Aucune commande confirmee n'attend de livraison."
          />
          <p className="px-4 py-3 text-xs" style={{ color: "var(--texte-doux)" }}>
            <Link className="lien-nav" href="/ventes/livraisons/nouvelle">
              Preparer un bon de livraison a partir d&apos;une de ces commandes
            </Link>
          </p>
        </Carte>
      </div>

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Filtres des bons de livraison"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Recherche</span>
          <input
            className="champ"
            type="search"
            name="q"
            defaultValue={filtresCourants.q ?? ""}
            placeholder="Numero de bon, commande ou client"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Statut</span>
          <select className="champ" name="statut" defaultValue={filtresCourants.statut ?? ""}>
            <option value="">Tous les statuts</option>
            {STATUTS_LIVRAISON.map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_STATUT_LIVRAISON, valeur)}
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
          <span className="mb-1 block font-medium">Livrees a partir du</span>
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
        <Link className="lien-nav text-sm" href="/ventes/livraisons">
          Reinitialiser
        </Link>
      </form>

      {filtreEtendu && (
        <div className="mb-4">
          <Alerte ton="info" titre="Recherche et periode filtrees en base">
            Le total et la pagination portent sur l&apos;ensemble des bons de livraison
            correspondant a la recherche et a la periode, et non sur la seule page affichee.
          </Alerte>
        </div>
      )}

      <Carte
        titre="Bons de livraison"
        description={`${liste.total} bon(s) de livraison correspondant aux criteres.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "numero", libelle: "Numero" },
            { cle: "client", libelle: "Client" },
            { cle: "commande", libelle: "Commande" },
            { cle: "statut", libelle: "Statut" },
            { cle: "date", libelle: "Date de livraison" },
            { cle: "depot", libelle: "Depot de depart" },
            { cle: "lignes", libelle: "Lignes", nombre: true },
            { cle: "quantite", libelle: "Quantite livree", nombre: true },
            { cle: "factures", libelle: "Factures", nombre: true },
          ]}
          lignes={liste.lignes.map((livraison) => ({
            cle: String(livraison.id),
            cellules: [
              <Link key="numero" className="lien-nav" href={`/ventes/livraisons/${livraison.id}`}>
                {livraison.numero}
              </Link>,
              livraison.client,
              livraison.commande ?? "Sans commande rattachee",
              <EtiquetteStatut
                key="statut"
                code={livraison.statut}
                libelle={libelle(LIBELLES_STATUT_LIVRAISON, livraison.statut)}
              />,
              formatDate(livraison.dateLivraison),
              livraison.depot,
              String(livraison.nombreLignes),
              formatQuantite(livraison.quantiteLivree),
              String(livraison.factures),
            ],
          }))}
          messageVide="Aucun bon de livraison ne correspond aux criteres selectionnes."
        />
        <Pagination
          page={parametres.page}
          pages={liste.pages}
          total={liste.total}
          construireLien={fabricantLien("/ventes/livraisons", filtresCourants)}
        />
      </Carte>
    </>
  );
}
