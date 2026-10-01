import Link from "next/link";
import type { InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D, type Decimal } from "@/lib/decimal";
import { listerFacturesClient } from "@/lib/vente/service";
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
  Statistique,
  Tableau,
} from "@/components/ui";
import { formatDate, formatMontant } from "@/lib/format";
import {
  LIBELLES_NATURE_FACTURE,
  LIBELLES_STATUT_FACTURE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Factures client" };

const STATUTS_FACTURE: InvoiceStatus[] = [
  "BROUILLON",
  "VALIDEE",
  "POSTEE",
  "PARTIELLEMENT_REGLEE",
  "REGLEE",
  "EN_RETARD",
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

interface LigneFacture {
  id: number;
  numero: string;
  nature: string;
  client: string;
  commande: string | null;
  livraison: string | null;
  statut: InvoiceStatus;
  devise: string;
  dateFacture: Date;
  echeance: Date | null;
  totalTTC: Decimal;
  regle: Decimal;
  solde: Decimal;
  enRetard: boolean;
}

/**
 * Consultation des factures client.
 *
 * Le service ne filtre que par statut et par client : la recherche textuelle et
 * la periode sont alors appliquees en base, en lecture seule et sur des pages
 * bornees, pour que le total, les indicateurs et la pagination restent exacts.
 */
function construireFiltre(entree: {
  statut: InvoiceStatus | undefined;
  clientId: number | undefined;
  recherche: string | null;
  du: Date | null;
  au: Date | null;
}): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = { direction: "CLIENT" };
  if (entree.statut) where.status = entree.statut;
  if (entree.clientId) where.thirdPartyId = entree.clientId;
  if (entree.recherche) {
    where.OR = [
      { number: modeInsensible(entree.recherche) },
      { reference: modeInsensible(entree.recherche) },
      { order: { number: modeInsensible(entree.recherche) } },
      { delivery: { number: modeInsensible(entree.recherche) } },
      { thirdParty: { code: modeInsensible(entree.recherche) } },
      { thirdParty: { label1: modeInsensible(entree.recherche) } },
    ];
  }
  if (entree.du || entree.au) {
    where.invoiceDate = {
      ...(entree.du ? { gte: entree.du } : {}),
      ...(entree.au ? { lt: finDeJournee(entree.au) } : {}),
    };
  }
  return where;
}

async function chargerFactures(entree: {
  where: Prisma.InvoiceWhereInput;
  recherche: string | null;
  du: Date | null;
  au: Date | null;
  page: number;
  taille: number;
  statut: InvoiceStatus | undefined;
  clientId: number | undefined;
}): Promise<{ lignes: LigneFacture[]; total: number; pages: number }> {
  const maintenant = Date.now();

  const versLigne = (facture: {
    id: number;
    number: string;
    nature: string;
    status: InvoiceStatus;
    invoiceDate: Date;
    dueDate: Date | null;
    currency: string;
    totalTTC: Decimal;
    paidAmount: Decimal;
    balance: Decimal;
    reference: string | null;
    thirdParty: { code: string; label1: string };
    order: { number: string } | null;
    delivery: { number: string } | null;
  }): LigneFacture => ({
    id: facture.id,
    numero: facture.number,
    nature: facture.nature,
    client: `${facture.thirdParty.code} — ${facture.thirdParty.label1}`,
    commande: facture.order?.number ?? null,
    livraison: facture.delivery?.number ?? null,
    statut: facture.status,
    devise: facture.currency,
    dateFacture: facture.invoiceDate,
    echeance: facture.dueDate,
    totalTTC: D.of(facture.totalTTC),
    regle: D.of(facture.paidAmount),
    solde: D.of(facture.balance),
    enRetard:
      facture.dueDate !== null &&
      facture.dueDate.getTime() < maintenant &&
      D.gt(D.of(facture.balance), 0) &&
      facture.status !== "REGLEE" &&
      facture.status !== "ANNULEE",
  });

  const champs = {
    thirdParty: { select: { code: true, label1: true } },
    order: { select: { number: true } },
    delivery: { select: { number: true } },
  } as const;

  if (!entree.recherche && !entree.du && !entree.au) {
    // Sans filtre etendu, la liste vient du service : il porte les regles de
    // selection des factures client (direction, tri, bornes de pagination).
    const liste = await listerFacturesClient({
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

  const [total, lignes] = await Promise.all([
    prisma.invoice.count({ where: entree.where }),
    prisma.invoice.findMany({
      where: entree.where,
      orderBy: { invoiceDate: "desc" },
      skip: (entree.page - 1) * entree.taille,
      take: entree.taille,
      include: champs,
    }),
  ]);

  return {
    lignes: lignes.map(versLigne),
    total,
    pages: Math.max(1, Math.ceil(total / entree.taille)),
  };
}

export default async function PageFacturesClient({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.VENTE_LIRE);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, ["statut", "client", "du", "au"]);

  const statut = STATUTS_FACTURE.find((valeur) => valeur === parametres.filtres.statut);
  const clientBrut = parametres.filtres.client;
  const clientId =
    clientBrut !== null && /^\d+$/.test(clientBrut) ? Number.parseInt(clientBrut, 10) : undefined;
  const du = dateDeFiltre(parametres.filtres.du);
  const au = dateDeFiltre(parametres.filtres.au);
  const filtreEtendu = parametres.recherche !== null || du !== null || au !== null;

  // Les indicateurs portent sur la totalite des factures correspondant aux
  // criteres, pas sur la page affichee : ils sont agreges en base.
  const where = construireFiltre({
    statut,
    clientId,
    recherche: parametres.recherche,
    du,
    au,
  });

  const [liste, clients, totaux] = await Promise.all([
    chargerFactures({
      where,
      recherche: parametres.recherche,
      du,
      au,
      page: parametres.page,
      taille: parametres.taille,
      statut,
      clientId,
    }),
    prisma.thirdParty.findMany({
      where: { isClient: true },
      orderBy: { code: "asc" },
      take: 500,
      select: { id: true, code: true, label1: true },
    }),
    prisma.invoice.aggregate({
      where,
      _sum: { totalTTC: true, paidAmount: true, balance: true },
    }),
  ]);

  const totalFacture = D.of(totaux._sum.totalTTC ?? 0);
  const totalRegle = D.of(totaux._sum.paidAmount ?? 0);
  const soldeRestant = D.of(totaux._sum.balance ?? 0);

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
        titre="Factures client"
        description="Facturation des livraisons, validation comptable, encaissements et avoirs : chaque montant affiche provient des pieces enregistrees, jamais d'un calcul d'interface."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Statistique libelle="Factures correspondantes" valeur={String(liste.total)} />
        <Statistique libelle="Total facture (TTC)" valeur={formatMontant(totalFacture)} />
        <Statistique libelle="Total regle" valeur={formatMontant(totalRegle)} />
        <Statistique libelle="Solde restant" valeur={formatMontant(soldeRestant)} />
      </div>

      <p className="mb-5 text-xs" style={{ color: "var(--texte-doux)" }}>
        Les indicateurs portent sur toutes les pieces client correspondant aux criteres, avoirs et
        brouillons compris, et sont agreges en base : ils ne dependent pas de la page affichee. Un
        avoir vient en deduction du solde du client par son propre solde negatif.
      </p>

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Filtres des factures client"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Recherche</span>
          <input
            className="champ"
            type="search"
            name="q"
            defaultValue={filtresCourants.q ?? ""}
            placeholder="Numero de facture, commande, livraison ou client"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Statut</span>
          <select className="champ" name="statut" defaultValue={filtresCourants.statut ?? ""}>
            <option value="">Tous les statuts</option>
            {STATUTS_FACTURE.map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_STATUT_FACTURE, valeur)}
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
          <span className="mb-1 block font-medium">Facturees a partir du</span>
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
        <Link className="lien-nav text-sm" href="/ventes/factures">
          Reinitialiser
        </Link>
      </form>

      {filtreEtendu && (
        <div className="mb-4">
          <Alerte ton="info" titre="Recherche et periode filtrees en base">
            Le total, les indicateurs et la pagination portent sur l&apos;ensemble des factures
            correspondant a la recherche et a la periode, et non sur la seule page affichee.
          </Alerte>
        </div>
      )}

      <Carte
        titre="Factures client"
        description={`${liste.total} facture(s) correspondant aux criteres. Le solde affiche est celui tenu par le service, avoirs deducts.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "numero", libelle: "Numero" },
            { cle: "nature", libelle: "Nature" },
            { cle: "client", libelle: "Client" },
            { cle: "statut", libelle: "Statut" },
            { cle: "date", libelle: "Date" },
            { cle: "echeance", libelle: "Echeance" },
            { cle: "ttc", libelle: "Total TTC", nombre: true },
            { cle: "regle", libelle: "Regle", nombre: true },
            { cle: "solde", libelle: "Solde", nombre: true },
            { cle: "origine", libelle: "Origine" },
          ]}
          lignes={liste.lignes.map((facture) => ({
            cle: String(facture.id),
            cellules: [
              <Link key="numero" className="lien-nav" href={`/ventes/factures/${facture.id}`}>
                {facture.numero}
              </Link>,
              libelle(LIBELLES_NATURE_FACTURE, facture.nature),
              facture.client,
              <span key="statut" className="inline-flex flex-wrap items-center gap-1">
                <EtiquetteStatut
                  code={facture.statut}
                  libelle={libelle(LIBELLES_STATUT_FACTURE, facture.statut)}
                />
                {facture.enRetard && <Etiquette ton="danger">En retard</Etiquette>}
              </span>,
              formatDate(facture.dateFacture),
              formatDate(facture.echeance),
              formatMontant(facture.totalTTC, facture.devise),
              formatMontant(facture.regle, facture.devise),
              formatMontant(facture.solde, facture.devise),
              <span key="origine" className="text-xs">
                {facture.commande ? `Commande ${facture.commande}` : "Sans commande"}
                <span className="block">
                  {facture.livraison ? `Livraison ${facture.livraison}` : "Sans livraison"}
                </span>
              </span>,
            ],
          }))}
          messageVide="Aucune facture client ne correspond aux criteres selectionnes."
        />
        <Pagination
          page={parametres.page}
          pages={liste.pages}
          total={liste.total}
          construireLien={fabricantLien("/ventes/factures", filtresCourants)}
        />
      </Carte>
    </>
  );
}
