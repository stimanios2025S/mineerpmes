import Link from "next/link";
import type { Prisma, QuoteStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D, type Decimal } from "@/lib/decimal";
import { listerDevis } from "@/lib/vente/service";
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
import { DEVISE_PAR_DEFAUT, formatDate, formatMontant } from "@/lib/format";
import { LIBELLES_STATUT_DEVIS, libelle } from "@/lib/libelles";

export const metadata = { title: "Devis clients" };

const STATUTS_DEVIS: QuoteStatus[] = [
  "BROUILLON",
  "ENVOYE",
  "ACCEPTE",
  "REFUSE",
  "EXPIRE",
  "CONVERTI",
  "ANNULE",
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

interface LigneDevis {
  id: number;
  numero: string;
  statut: QuoteStatus;
  client: string;
  devise: string;
  dateDevis: Date;
  validite: Date | null;
  totalTTC: Decimal;
  nombreLignes: number;
}

/**
 * Consultation des devis.
 *
 * Le service de vente ne filtre que par statut et par client : la recherche
 * textuelle et la periode sont alors appliquees en base, en lecture seule et
 * sur des pages bornees, afin que le total et la pagination restent exacts.
 * Filtrer les lignes de la page courante fausserait l'un et l'autre.
 */
async function chargerDevis(entree: {
  statut: QuoteStatus | undefined;
  clientId: number | undefined;
  recherche: string | null;
  du: Date | null;
  au: Date | null;
  page: number;
  taille: number;
}): Promise<{ lignes: LigneDevis[]; total: number; pages: number }> {
  const versLigne = (devis: {
    id: number;
    number: string;
    status: QuoteStatus;
    quoteDate: Date;
    validUntil: Date | null;
    currency: string;
    totalTTC: Decimal;
    customer: { code: string; label1: string };
    lines: unknown[];
  }): LigneDevis => ({
    id: devis.id,
    numero: devis.number,
    statut: devis.status,
    client: `${devis.customer.code} — ${devis.customer.label1}`,
    devise: devis.currency,
    dateDevis: devis.quoteDate,
    validite: devis.validUntil,
    totalTTC: D.of(devis.totalTTC),
    nombreLignes: devis.lines.length,
  });

  // Sans recherche ni periode : la consultation officielle du module est utilisee.
  if (!entree.recherche && !entree.du && !entree.au) {
    const liste = await listerDevis({
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

  const where: Prisma.QuoteWhereInput = {};
  if (entree.statut) where.status = entree.statut;
  if (entree.clientId) where.customerId = entree.clientId;
  if (entree.recherche) {
    where.OR = [
      { number: modeInsensible(entree.recherche) },
      { customer: { code: modeInsensible(entree.recherche) } },
      { customer: { label1: modeInsensible(entree.recherche) } },
    ];
  }
  if (entree.du || entree.au) {
    where.quoteDate = {
      ...(entree.du ? { gte: entree.du } : {}),
      ...(entree.au ? { lt: finDeJournee(entree.au) } : {}),
    };
  }

  const [total, lignes] = await Promise.all([
    prisma.quote.count({ where }),
    prisma.quote.findMany({
      where,
      orderBy: { quoteDate: "desc" },
      skip: (entree.page - 1) * entree.taille,
      take: entree.taille,
      include: {
        customer: { select: { code: true, label1: true } },
        lines: { select: { id: true } },
      },
    }),
  ]);

  return {
    lignes: lignes.map(versLigne),
    total,
    pages: Math.max(1, Math.ceil(total / entree.taille)),
  };
}

export default async function PageDevis({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.VENTE_LIRE);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, [
    "statut",
    "client",
    "du",
    "au",
  ]);

  const statut = STATUTS_DEVIS.find((valeur) => valeur === parametres.filtres.statut);
  const clientBrut = parametres.filtres.client;
  const clientId =
    clientBrut !== null && /^\d+$/.test(clientBrut) ? Number.parseInt(clientBrut, 10) : undefined;
  const du = dateDeFiltre(parametres.filtres.du);
  const au = dateDeFiltre(parametres.filtres.au);
  const filtreEtendu = parametres.recherche !== null || du !== null || au !== null;

  const [liste, clients, devise] = await Promise.all([
    chargerDevis({
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

  const maintenant = Date.now();
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
        titre="Devis clients"
        description={`Propositions commerciales adressees aux clients, de la saisie a la transformation en commande. Les montants sont exprimes en ${devise}.`}
        actions={
          <Link className="lien-nav text-sm" href="/ventes/devis/nouveau">
            Nouveau devis
          </Link>
        }
      />

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Filtres des devis"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Recherche</span>
          <input
            className="champ"
            type="search"
            name="q"
            defaultValue={filtresCourants.q ?? ""}
            placeholder="Numero de devis, code ou nom du client"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Statut</span>
          <select className="champ" name="statut" defaultValue={filtresCourants.statut ?? ""}>
            <option value="">Tous les statuts</option>
            {STATUTS_DEVIS.map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_STATUT_DEVIS, valeur)}
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
          <span className="mb-1 block font-medium">Emis a partir du</span>
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
        <Link className="lien-nav text-sm" href="/ventes/devis">
          Reinitialiser
        </Link>
      </form>

      {filtreEtendu && (
        <div className="mb-4">
          <Alerte ton="info" titre="Recherche et periode filtrees en base">
            Le total et la pagination portent sur l&apos;ensemble des devis correspondant a la
            recherche et a la periode, et non sur la seule page affichee.
          </Alerte>
        </div>
      )}

      <Carte
        titre="Devis"
        description={`${liste.total} devis correspondant aux criteres.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "numero", libelle: "Numero" },
            { cle: "client", libelle: "Client" },
            { cle: "statut", libelle: "Statut" },
            { cle: "date", libelle: "Date d'emission" },
            { cle: "validite", libelle: "Validite" },
            { cle: "lignes", libelle: "Lignes", nombre: true },
            { cle: "ttc", libelle: "Montant TTC", nombre: true },
          ]}
          lignes={liste.lignes.map((devis) => ({
            cle: String(devis.id),
            cellules: [
              <Link key="numero" className="lien-nav" href={`/ventes/devis/${devis.id}`}>
                {devis.numero}
              </Link>,
              devis.client,
              <EtiquetteStatut
                key="statut"
                code={devis.statut}
                libelle={libelle(LIBELLES_STATUT_DEVIS, devis.statut)}
              />,
              formatDate(devis.dateDevis),
              <span key="validite" className="inline-flex flex-wrap items-center gap-1">
                {devis.validite ? formatDate(devis.validite) : "Sans echeance"}
                {devis.validite &&
                  devis.validite.getTime() < maintenant &&
                  devis.statut !== "CONVERTI" &&
                  devis.statut !== "ANNULE" && (
                    <Etiquette ton="alerte">Echeance depassee</Etiquette>
                  )}
              </span>,
              String(devis.nombreLignes),
              formatMontant(devis.totalTTC, devis.devise),
            ],
          }))}
          messageVide="Aucun devis ne correspond aux criteres selectionnes."
        />
        <Pagination
          page={parametres.page}
          pages={liste.pages}
          total={liste.total}
          construireLien={fabricantLien("/ventes/devis", filtresCourants)}
        />
      </Carte>
    </>
  );
}
