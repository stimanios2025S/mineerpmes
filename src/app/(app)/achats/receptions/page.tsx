import Link from "next/link";
import type { ReceiptStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { listerReceptions, receptionsEnAttenteQualite } from "@/lib/achat/service";
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
import { formatDate, formatQuantite } from "@/lib/format";
import { LIBELLES_STATUT_RECEPTION, LIBELLES_STATUT_STOCK, libelle } from "@/lib/libelles";

export const metadata = { title: "Receptions fournisseur" };

const STATUTS_RECEPTION: ReceiptStatus[] = [
  "BROUILLON",
  "EN_CONTROLE_QUALITE",
  "ACCEPTE",
  "PARTIELLEMENT_ACCEPTE",
  "REJETE",
  "ANNULE",
];

export default async function PageReceptionsFournisseur({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.ACHAT_LIRE);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, ["statut", "depot", "fournisseur"]);

  const statut = STATUTS_RECEPTION.find((valeur) => valeur === parametres.filtres.statut);
  const depotBrut = parametres.filtres.depot;
  const depotId = depotBrut !== null && /^\d+$/.test(depotBrut) ? Number.parseInt(depotBrut, 10) : undefined;
  const fournisseurBrut = parametres.filtres.fournisseur;
  const fournisseurId =
    fournisseurBrut !== null && /^\d+$/.test(fournisseurBrut)
      ? Number.parseInt(fournisseurBrut, 10)
      : undefined;

  const [liste, enAttente, depots, fournisseurs] = await Promise.all([
    listerReceptions({
      statut,
      warehouseId: depotId,
      supplierId: fournisseurId,
      page: parametres.page,
      taille: parametres.taille,
    }),
    receptionsEnAttenteQualite(),
    prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      take: 200,
      select: { id: true, code: true, label: true },
    }),
    prisma.thirdParty.findMany({
      where: { isSupplier: true },
      orderBy: { code: "asc" },
      take: 300,
      select: { id: true, code: true, label1: true },
    }),
  ]);

  const quantiteEnAttente = D.sum(
    enAttente.flatMap((reception) => reception.lines.map((ligne) => ligne.quantityQuarantined)),
  );

  const filtresCourants = {
    statut: premiereValeur(parametresBruts, "statut"),
    depot: premiereValeur(parametresBruts, "depot"),
    fournisseur: premiereValeur(parametresBruts, "fournisseur"),
  };

  return (
    <>
      <EnTetePage
        titre="Receptions fournisseur"
        description="Entrees de marchandises rattachees aux bons de commande. Une marchandise dont le controle qualitatif est requis reste en quarantaine jusqu'a decision."
        actions={
          <Link className="lien-nav text-sm" href="/achats/receptions/nouvelle">
            Nouvelle reception
          </Link>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Statistique
          libelle="Receptions en attente de controle qualite"
          valeur={enAttente.length}
          detail={`Quantite en quarantaine : ${formatQuantite(quantiteEnAttente)}`}
          ton={enAttente.length > 0 ? "alerte" : "succes"}
        />
        <Statistique
          libelle="Receptions listees"
          valeur={liste.total}
          detail="Toutes situations confondues, selon les filtres appliques"
        />
        <Statistique
          libelle="Depots de reception actifs"
          valeur={depots.length}
          detail="Depots proposes a la saisie d'une reception"
        />
      </div>

      {enAttente.length > 0 && (
        <Section titre="A traiter par la qualite">
          <div className="mb-3">
            <Alerte ton="alerte" titre="Marchandise en quarantaine">
              Ces receptions attendent une decision qualite. La marchandise est comptee en stock mais
              n&apos;est pas disponible pour la production ou la vente.
            </Alerte>
          </div>
          <Carte sansPadding>
            <Tableau
              colonnes={[
                { cle: "numero", libelle: "Numero" },
                { cle: "date", libelle: "Date de reception" },
                { cle: "fournisseur", libelle: "Fournisseur" },
                { cle: "depot", libelle: "Depot" },
                { cle: "bl", libelle: "Bon de livraison" },
                { cle: "lignes", libelle: "Lignes en quarantaine", nombre: true },
                { cle: "quantite", libelle: "Quantite en quarantaine", nombre: true },
              ]}
              lignes={enAttente.map((reception) => ({
                cle: String(reception.id),
                cellules: [
                  <Link key="numero" className="lien-nav" href={`/achats/receptions/${reception.id}`}>
                    {reception.number}
                  </Link>,
                  formatDate(reception.receiptDate),
                  `${reception.supplier.code} — ${reception.supplier.label1}`,
                  `${reception.warehouse.code} — ${reception.warehouse.label}`,
                  reception.deliveryNoteNumber ?? "-",
                  String(reception.lines.filter((ligne) => D.gt(ligne.quantityQuarantined, 0)).length),
                  formatQuantite(
                    D.sum(reception.lines.map((ligne) => ligne.quantityQuarantined)),
                  ),
                ],
              }))}
              messageVide="Aucune reception en attente de controle qualite."
            />
          </Carte>
        </Section>
      )}

      <form
        method="get"
        className="mb-5 mt-6 flex flex-wrap items-end gap-3"
        aria-label="Filtres des receptions fournisseur"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Statut</span>
          <select className="champ" name="statut" defaultValue={filtresCourants.statut ?? ""}>
            <option value="">Tous les statuts</option>
            {STATUTS_RECEPTION.map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_STATUT_RECEPTION, valeur)}
              </option>
            ))}
          </select>
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
        <Link className="lien-nav text-sm" href="/achats/receptions">
          Reinitialiser
        </Link>
      </form>

      <Carte
        titre="Receptions"
        description={`${liste.total} reception(s) correspondant aux criteres.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "numero", libelle: "Numero" },
            { cle: "fournisseur", libelle: "Fournisseur" },
            { cle: "depot", libelle: "Depot" },
            { cle: "commande", libelle: "Commande" },
            { cle: "date", libelle: "Date" },
            { cle: "bl", libelle: "Bon de livraison" },
            { cle: "statut", libelle: "Statut" },
            { cle: "qualite", libelle: "Controle qualitatif" },
            { cle: "quantite", libelle: "Quantite recue", nombre: true },
          ]}
          lignes={liste.lignes.map((reception) => ({
            cle: String(reception.id),
            cellules: [
              <Link key="numero" className="lien-nav" href={`/achats/receptions/${reception.id}`}>
                {reception.number}
              </Link>,
              `${reception.supplier.code} — ${reception.supplier.label1}`,
              `${reception.warehouse.code} — ${reception.warehouse.label}`,
              reception.order ? (
                <Link key="commande" className="lien-nav" href={`/achats/commandes/${reception.orderId}`}>
                  {reception.order.number}
                </Link>
              ) : (
                "Sans commande"
              ),
              formatDate(reception.receiptDate),
              reception.deliveryNoteNumber ?? "-",
              <EtiquetteStatut
                key="statut"
                code={reception.status}
                libelle={libelle(LIBELLES_STATUT_RECEPTION, reception.status)}
              />,
              reception.qualityRequired ? (
                <Etiquette key="qualite" ton="alerte">
                  Controle requis
                </Etiquette>
              ) : (
                <Etiquette key="qualite" ton="neutre">
                  Sans controle
                </Etiquette>
              ),
              <span key="quantite">
                {formatQuantite(
                  D.sum(reception.lines.map((ligne) => ligne.quantityReceived)),
                )}
                <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                  Statuts :{" "}
                  {[
                    ...new Set(
                      reception.lines.map((ligne) =>
                        libelle(LIBELLES_STATUT_STOCK, ligne.qualityStatus),
                      ),
                    ),
                  ].join(", ") || "-"}
                </span>
              </span>,
            ],
          }))}
          messageVide="Aucune reception ne correspond aux criteres selectionnes."
        />
        <Pagination
          page={parametres.page}
          pages={liste.pages}
          total={liste.total}
          construireLien={fabricantLien("/achats/receptions", filtresCourants)}
        />
      </Carte>
    </>
  );
}
