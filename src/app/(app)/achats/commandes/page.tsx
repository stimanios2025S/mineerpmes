import Link from "next/link";
import type { PurchaseOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D, type Decimal } from "@/lib/decimal";
import { listerCommandesFournisseur } from "@/lib/achat/service";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { fabricantLien, lireParametresListe, premiereValeur } from "@/lib/liste";
import {
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Pagination,
  Tableau,
} from "@/components/ui";
import { formatDate, formatMontant, formatPourcentage, formatQuantite } from "@/lib/format";
import { LIBELLES_STATUT_COMMANDE_FOURNISSEUR, libelle } from "@/lib/libelles";

export const metadata = { title: "Bons de commande fournisseur" };

const STATUTS_COMMANDE: PurchaseOrderStatus[] = [
  "BROUILLON",
  "SOUMIS",
  "APPROUVE",
  "PARTIELLEMENT_RECU",
  "RECU",
  "FACTURE",
  "CLOTURE",
  "ANNULE",
];

/** Etat d'avancement d'une commande, calcule sur les quantites reelles. */
interface Avancement {
  commandee: Decimal;
  recue: Decimal;
  facturee: Decimal;
  tauxRecu: Decimal;
  tauxFacture: Decimal;
}

interface LigneCommande {
  id: number;
  numero: string;
  fournisseur: string;
  statut: PurchaseOrderStatus;
  dateCommande: Date;
  datePrevue: Date | null;
  devise: string;
  totalTTC: Decimal;
  nombreReceptions: number;
  avancement: Avancement;
  enRetard: boolean;
}

function calculerAvancement(
  lignes: { quantity: Decimal; quantityReceived: Decimal; quantityInvoiced: Decimal }[],
): Avancement {
  const commandee = D.sum(lignes.map((ligne) => ligne.quantity));
  const recue = D.sum(lignes.map((ligne) => ligne.quantityReceived));
  const facturee = D.sum(lignes.map((ligne) => ligne.quantityInvoiced));
  return {
    commandee,
    recue,
    facturee,
    tauxRecu: D.percent(recue, commandee),
    tauxFacture: D.percent(facturee, commandee),
  };
}

export default async function PageCommandesFournisseur({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.ACHAT_LIRE);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, ["statut", "fournisseur"]);

  const statut = STATUTS_COMMANDE.find((valeur) => valeur === parametres.filtres.statut);
  const fournisseurBrut = parametres.filtres.fournisseur;
  const fournisseurId =
    fournisseurBrut !== null && /^\d+$/.test(fournisseurBrut)
      ? Number.parseInt(fournisseurBrut, 10)
      : undefined;

  const [liste, fournisseurs] = await Promise.all([
    listerCommandesFournisseur({
      statut,
      supplierId: fournisseurId,
      page: parametres.page,
      taille: parametres.taille,
    }),
    prisma.thirdParty.findMany({
      where: { isSupplier: true },
      orderBy: { code: "asc" },
      take: 300,
      select: { id: true, code: true, label1: true },
    }),
  ]);

  const maintenant = Date.now();
  const lignes: LigneCommande[] = liste.lignes.map((commande) => ({
    id: commande.id,
    numero: commande.number,
    fournisseur: `${commande.supplier.code} — ${commande.supplier.label1}`,
    statut: commande.status,
    dateCommande: commande.orderDate,
    datePrevue: commande.expectedDate,
    devise: commande.currency,
    totalTTC: D.of(commande.totalTTC),
    nombreReceptions: commande._count.receipts,
    avancement: calculerAvancement(commande.lines),
    enRetard:
      commande.expectedDate !== null &&
      commande.expectedDate.getTime() < maintenant &&
      commande.status !== "RECU" &&
      commande.status !== "FACTURE" &&
      commande.status !== "CLOTURE" &&
      commande.status !== "ANNULE",
  }));

  const filtresCourants = {
    statut: premiereValeur(parametresBruts, "statut"),
    fournisseur: premiereValeur(parametresBruts, "fournisseur"),
  };

  return (
    <>
      <EnTetePage
        titre="Bons de commande fournisseur"
        description="Commandes engagees aupres des fournisseurs, avec l'avancement reel des receptions et de la facturation, quantite par quantite."
        actions={
          <Link className="lien-nav text-sm" href="/achats/commandes/nouvelle">
            Nouveau bon de commande
          </Link>
        }
      />

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Filtres des bons de commande"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Statut</span>
          <select className="champ" name="statut" defaultValue={filtresCourants.statut ?? ""}>
            <option value="">Tous les statuts</option>
            {STATUTS_COMMANDE.map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_STATUT_COMMANDE_FOURNISSEUR, valeur)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Fournisseur</span>
          <select className="champ" name="fournisseur" defaultValue={filtresCourants.fournisseur ?? ""}>
            <option value="">Tous les fournisseurs</option>
            {fournisseurs.map((fournisseur) => (
              <option key={fournisseur.id} value={fournisseur.id}>
                {fournisseur.code} — {fournisseur.label1}
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
        titre="Bons de commande"
        description={`${liste.total} commande(s) correspondant aux criteres.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "numero", libelle: "Numero" },
            { cle: "fournisseur", libelle: "Fournisseur" },
            { cle: "statut", libelle: "Statut" },
            { cle: "date", libelle: "Date" },
            { cle: "prevue", libelle: "Date prevue" },
            { cle: "total", libelle: "Montant TTC", nombre: true },
            { cle: "recu", libelle: "Recu", nombre: true },
            { cle: "facture", libelle: "Facture", nombre: true },
          ]}
          lignes={lignes.map((commande) => ({
            cle: String(commande.id),
            cellules: [
              <Link key="numero" className="lien-nav" href={`/achats/commandes/${commande.id}`}>
                {commande.numero}
              </Link>,
              commande.fournisseur,
              <span key="statut" className="inline-flex flex-wrap items-center gap-1">
                <EtiquetteStatut
                  code={commande.statut}
                  libelle={libelle(LIBELLES_STATUT_COMMANDE_FOURNISSEUR, commande.statut)}
                />
                {commande.enRetard && <Etiquette ton="danger">En retard</Etiquette>}
              </span>,
              formatDate(commande.dateCommande),
              formatDate(commande.datePrevue),
              formatMontant(commande.totalTTC, commande.devise),
              <span key="recu">
                {formatPourcentage(commande.avancement.tauxRecu, 0)}
                <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                  {formatQuantite(commande.avancement.recue)} /{" "}
                  {formatQuantite(commande.avancement.commandee)} — {commande.nombreReceptions}{" "}
                  reception(s)
                </span>
              </span>,
              <span key="facture">
                {formatPourcentage(commande.avancement.tauxFacture, 0)}
                <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                  {formatQuantite(commande.avancement.facturee)} /{" "}
                  {formatQuantite(commande.avancement.commandee)}
                </span>
              </span>,
            ],
          }))}
          messageVide="Aucun bon de commande ne correspond aux criteres selectionnes."
        />
        <Pagination
          page={parametres.page}
          pages={liste.pages}
          total={liste.total}
          construireLien={fabricantLien("/achats/commandes", filtresCourants)}
        />
      </Carte>
    </>
  );
}
