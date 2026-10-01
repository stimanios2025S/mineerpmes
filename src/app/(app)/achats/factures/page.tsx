import Link from "next/link";
import type { InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { listerFacturesFournisseur } from "@/lib/achat/service";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { fabricantLien, lireParametresListe, premiereValeur } from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Pagination,
  Section,
  Statistique,
  Tableau,
} from "@/components/ui";
import { formatDate, formatMontant } from "@/lib/format";
import { LIBELLES_STATUT_FACTURE, libelle } from "@/lib/libelles";

export const metadata = { title: "Factures fournisseur" };

const STATUTS_FACTURE: InvoiceStatus[] = [
  "BROUILLON",
  "VALIDEE",
  "POSTEE",
  "PARTIELLEMENT_REGLEE",
  "REGLEE",
  "EN_RETARD",
  "ANNULEE",
];

/** Statuts pour lesquels un solde reste du au fournisseur. */
const STATUTS_A_PAYER: InvoiceStatus[] = ["VALIDEE", "POSTEE", "PARTIELLEMENT_REGLEE", "EN_RETARD"];

export default async function PageFacturesFournisseur({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.ACHAT_LIRE);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, ["statut", "fournisseur"]);

  const statut = STATUTS_FACTURE.find((valeur) => valeur === parametres.filtres.statut);
  const fournisseurBrut = parametres.filtres.fournisseur;
  const fournisseurId =
    fournisseurBrut !== null && /^\d+$/.test(fournisseurBrut)
      ? Number.parseInt(fournisseurBrut, 10)
      : undefined;

  const where: Prisma.SupplierInvoiceWhereInput = {};
  if (statut) where.status = statut;
  if (fournisseurId) where.supplierId = fournisseurId;

  const [liste, fournisseurs, nonRapprochees, agregatNonRapprochees, aPayer, agregatAPayer] =
    await Promise.all([
      listerFacturesFournisseur({
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
      // Factures dont le rapprochement trois voies n'est pas conforme : elles
      // sont listees a part car elles exigent une justification ecrite avant
      // comptabilisation. Aucun ecart n'est corrige automatiquement.
      prisma.supplierInvoice.findMany({
        where: { ...where, threeWayMatched: false, isCreditNote: false },
        orderBy: { invoiceDate: "desc" },
        take: 50,
        select: {
          id: true,
          number: true,
          supplierRef: true,
          invoiceDate: true,
          totalTTC: true,
          currency: true,
          status: true,
          matchingNotes: true,
          supplier: { select: { code: true, label1: true } },
        },
      }),
      prisma.supplierInvoice.aggregate({
        where: { ...where, threeWayMatched: false, isCreditNote: false },
        _count: { _all: true },
        _sum: { totalTTC: true },
      }),
      prisma.supplierInvoice.findMany({
        where: { ...where, status: { in: STATUTS_A_PAYER } },
        select: { totalTTC: true, paidAmount: true },
      }),
      prisma.supplierInvoice.aggregate({
        where: { ...where, status: { in: STATUTS_A_PAYER } },
        _count: { _all: true },
      }),
    ]);

  const montantNonRapproche = D.of(agregatNonRapprochees._sum.totalTTC ?? 0);
  const restantAPayer = D.sub(
    D.sum(aPayer.map((facture) => facture.totalTTC)),
    D.sum(aPayer.map((facture) => facture.paidAmount)),
  );

  const filtresCourants = {
    statut: premiereValeur(parametresBruts, "statut"),
    fournisseur: premiereValeur(parametresBruts, "fournisseur"),
  };

  return (
    <>
      <EnTetePage
        titre="Factures fournisseur"
        description="Factures recues, rapprochement trois voies et reglements. Une facture dont le rapprochement n'est pas conforme ne peut pas etre comptabilisee sans justification ecrite."
        actions={
          <Link className="lien-nav text-sm" href="/achats/factures/nouvelle">
            Nouvelle facture
          </Link>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Statistique
          libelle="Factures non rapprochees"
          valeur={agregatNonRapprochees._count._all}
          detail={`Montant TTC cumule : ${formatMontant(montantNonRapproche)}`}
          ton={agregatNonRapprochees._count._all > 0 ? "danger" : "succes"}
        />
        <Statistique
          libelle="Factures listees"
          valeur={liste.total}
          detail="Selon les filtres appliques, avoirs inclus"
        />
        <Statistique
          libelle="Solde a payer"
          valeur={formatMontant(restantAPayer)}
          detail={`${agregatAPayer._count._all} facture(s) validee(s) non integralement reglee(s)`}
          ton={D.gt(restantAPayer, 0) ? "alerte" : "succes"}
        />
      </div>

      {nonRapprochees.length > 0 && (
        <Section titre="Rapprochement trois voies a arbitrer">
          <div className="mb-3">
            <Alerte ton="danger" titre="Ecarts de rapprochement">
              Ces factures presentent des ecarts avec la commande ou la reception (prix, quantite,
              ligne sans commande, ligne sans reception, marchandise en quarantaine). Les ecarts ne
              sont jamais corriges automatiquement : ils doivent etre arbitres, puis justifies par
              ecrit au moment de la validation.
            </Alerte>
          </div>
          <Carte sansPadding>
            <Tableau
              colonnes={[
                { cle: "numero", libelle: "Numero" },
                { cle: "fournisseur", libelle: "Fournisseur" },
                { cle: "reference", libelle: "Reference fournisseur" },
                { cle: "date", libelle: "Date" },
                { cle: "statut", libelle: "Statut" },
                { cle: "montant", libelle: "Total TTC", nombre: true },
                { cle: "ecarts", libelle: "Ecarts constates" },
              ]}
              lignes={nonRapprochees.map((facture) => ({
                cle: String(facture.id),
                cellules: [
                  <Link key="numero" className="lien-nav" href={`/achats/factures/${facture.id}`}>
                    {facture.number}
                  </Link>,
                  `${facture.supplier.code} — ${facture.supplier.label1}`,
                  facture.supplierRef ?? "-",
                  formatDate(facture.invoiceDate),
                  <EtiquetteStatut
                    key="statut"
                    code={facture.status}
                    libelle={libelle(LIBELLES_STATUT_FACTURE, facture.status)}
                  />,
                  formatMontant(facture.totalTTC, facture.currency),
                  <span
                    key="ecarts"
                    className="block max-w-[32rem] whitespace-pre-line text-xs"
                    style={{ color: "var(--danger)" }}
                  >
                    {facture.matchingNotes ?? "Ecarts non detailles"}
                  </span>,
                ],
              }))}
              messageVide="Aucune facture presentant un ecart de rapprochement."
            />
          </Carte>
        </Section>
      )}

      <form
        method="get"
        className="mb-5 mt-6 flex flex-wrap items-end gap-3"
        aria-label="Filtres des factures fournisseur"
      >
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
        <button type="submit" className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold">
          Filtrer
        </button>
        <Link className="lien-nav text-sm" href="/achats/factures">
          Reinitialiser
        </Link>
      </form>

      <Carte
        titre="Factures fournisseur"
        description={`${liste.total} facture(s) correspondant aux criteres.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "numero", libelle: "Numero" },
            { cle: "fournisseur", libelle: "Fournisseur" },
            { cle: "reference", libelle: "Reference fournisseur" },
            { cle: "commande", libelle: "Commande" },
            { cle: "reception", libelle: "Reception" },
            { cle: "date", libelle: "Date" },
            { cle: "echeance", libelle: "Echeance" },
            { cle: "statut", libelle: "Statut" },
            { cle: "rapprochement", libelle: "Rapprochement trois voies" },
            { cle: "ttc", libelle: "Total TTC", nombre: true },
            { cle: "regle", libelle: "Regle", nombre: true },
            { cle: "reste", libelle: "Reste du", nombre: true },
          ]}
          lignes={liste.lignes.map((facture) => {
            const reste = D.sub(D.of(facture.totalTTC), D.of(facture.paidAmount));
            return {
              cle: String(facture.id),
              cellules: [
                <Link key="numero" className="lien-nav" href={`/achats/factures/${facture.id}`}>
                  {facture.number}
                  {facture.isCreditNote && <Etiquette ton="info">Avoir</Etiquette>}
                </Link>,
                `${facture.supplier.code} — ${facture.supplier.label1}`,
                facture.supplierRef ?? "-",
                facture.order ? facture.order.number : "-",
                facture.receipt ? facture.receipt.number : "-",
                formatDate(facture.invoiceDate),
                formatDate(facture.dueDate),
                <EtiquetteStatut
                  key="statut"
                  code={facture.status}
                  libelle={libelle(LIBELLES_STATUT_FACTURE, facture.status)}
                />,
                facture.threeWayMatched ? (
                  <Etiquette key="rapprochement" ton="succes">
                    Conforme
                  </Etiquette>
                ) : (
                  <Etiquette key="rapprochement" ton="danger">
                    Ecarts a arbitrer
                  </Etiquette>
                ),
                formatMontant(facture.totalTTC, facture.currency),
                formatMontant(facture.paidAmount, facture.currency),
                formatMontant(reste, facture.currency),
              ],
            };
          })}
          messageVide="Aucune facture fournisseur ne correspond aux criteres selectionnes."
        />
        <Pagination
          page={parametres.page}
          pages={liste.pages}
          total={liste.total}
          construireLien={fabricantLien("/achats/factures", filtresCourants)}
        />
      </Carte>
    </>
  );
}
