import Link from "next/link";
import { exigerUtilisateur } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import {
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Statistique,
  Tableau,
  Vide,
} from "@/components/ui";
import { premiereValeur } from "@/lib/liste";
import { formatDate, formatEntier, formatMontant, formatQuantite } from "@/lib/format";
import {
  LIBELLES_STATUT_ARTICLE,
  LIBELLES_STATUT_COMMANDE_CLIENT,
  LIBELLES_STATUT_COMMANDE_FOURNISSEUR,
  LIBELLES_STATUT_DEVIS,
  LIBELLES_STATUT_FACTURE,
  LIBELLES_STATUT_LIVRAISON,
  LIBELLES_STATUT_NOMENCLATURE,
  LIBELLES_STATUT_ORDRE,
  LIBELLES_STATUT_RECEPTION,
  LIBELLES_STATUT_STOCK,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Recherche" };

const LIMITE = 20;

/**
 * Recherche globale.
 *
 * Chaque domaine n'est interroge que si l'utilisateur possede la permission de
 * consultation correspondante : la recherche ne peut donc pas devenir un moyen
 * de contourner les droits.
 */
export default async function PageRecherche({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerUtilisateur();
  const parametres = await searchParams;
  const requete = (premiereValeur(parametres, "q") ?? "").trim();

  if (requete.length < 2) {
    return (
      <>
        <EnTetePage
          titre="Recherche"
          description="Recherche sur les articles, les tiers, les documents commerciaux, les ordres de fabrication, les lots et les employes."
        />
        <Vide message="Saisissez au moins deux caracteres pour lancer une recherche." />
      </>
    );
  }

  const peut = (permission: string) => utilisateur.permissions.includes(permission);
  const comme = { contains: requete, mode: "insensitive" as const };

  const [
    articles,
    tiers,
    ordres,
    lots,
    devis,
    commandesClient,
    livraisons,
    facturesClient,
    commandesFournisseur,
    receptions,
    nomenclatures,
    employes,
    depots,
  ] = await Promise.all([
    peut(PERMISSIONS.ARTICLE_LIRE)
      ? prisma.item.findMany({
          where: { OR: [{ code: comme }, { label1: comme }] },
          take: LIMITE,
          orderBy: { code: "asc" },
          select: {
            id: true,
            code: true,
            label1: true,
            status: true,
            unit: { select: { code: true } },
          },
        })
      : [],
    peut(PERMISSIONS.TIERS_LIRE)
      ? prisma.thirdParty.findMany({
          where: { OR: [{ code: comme }, { label1: comme }] },
          take: LIMITE,
          orderBy: { code: "asc" },
          select: {
            id: true,
            code: true,
            label1: true,
            isClient: true,
            isSupplier: true,
            isEmployee: true,
            isActive: true,
          },
        })
      : [],
    peut(PERMISSIONS.PRODUCTION_LIRE)
      ? prisma.workOrder.findMany({
          where: { OR: [{ number: comme }, { item: { is: { code: comme } } }] },
          take: LIMITE,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            number: true,
            status: true,
            factory: true,
            quantityPlanned: true,
            item: { select: { code: true, label1: true } },
          },
        })
      : [],
    peut(PERMISSIONS.STOCK_LIRE)
      ? prisma.stockLot.findMany({
          where: { OR: [{ lotNumber: comme }, { item: { is: { code: comme } } }] },
          take: LIMITE,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            lotNumber: true,
            status: true,
            item: { select: { code: true, label1: true } },
            warehouse: { select: { code: true } },
            balances: { select: { quantityPhysical: true, quantityReserved: true } },
          },
        })
      : [],
    peut(PERMISSIONS.VENTE_LIRE)
      ? prisma.quote.findMany({
          where: { OR: [{ number: comme }, { customer: { is: { label1: comme } } }] },
          take: LIMITE,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            number: true,
            status: true,
            quoteDate: true,
            totalTTC: true,
            customer: { select: { code: true, label1: true } },
          },
        })
      : [],
    peut(PERMISSIONS.VENTE_LIRE)
      ? prisma.salesOrder.findMany({
          where: { OR: [{ number: comme }, { customer: { is: { label1: comme } } }] },
          take: LIMITE,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            number: true,
            status: true,
            orderDate: true,
            totalTTC: true,
            customer: { select: { code: true, label1: true } },
          },
        })
      : [],
    peut(PERMISSIONS.VENTE_LIRE)
      ? prisma.deliveryNote.findMany({
          where: { OR: [{ number: comme }, { customer: { is: { label1: comme } } }] },
          take: LIMITE,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            number: true,
            status: true,
            deliveryDate: true,
            customer: { select: { code: true, label1: true } },
          },
        })
      : [],
    peut(PERMISSIONS.VENTE_LIRE)
      ? prisma.invoice.findMany({
          where: {
            direction: "CLIENT",
            OR: [{ number: comme }, { thirdParty: { is: { label1: comme } } }],
          },
          take: LIMITE,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            number: true,
            status: true,
            invoiceDate: true,
            totalTTC: true,
            thirdParty: { select: { code: true, label1: true } },
          },
        })
      : [],
    peut(PERMISSIONS.ACHAT_LIRE)
      ? prisma.purchaseOrder.findMany({
          where: { OR: [{ number: comme }, { supplier: { is: { label1: comme } } }] },
          take: LIMITE,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            number: true,
            status: true,
            orderDate: true,
            totalTTC: true,
            supplier: { select: { code: true, label1: true } },
          },
        })
      : [],
    peut(PERMISSIONS.ACHAT_LIRE)
      ? prisma.goodsReceipt.findMany({
          where: { OR: [{ number: comme }, { supplier: { is: { label1: comme } } }] },
          take: LIMITE,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            number: true,
            status: true,
            receiptDate: true,
            supplier: { select: { code: true, label1: true } },
          },
        })
      : [],
    peut(PERMISSIONS.NOMENCLATURE_LIRE)
      ? prisma.formula.findMany({
          where: {
            OR: [{ code: comme }, { label: comme }, { item: { is: { code: comme } } }],
          },
          take: LIMITE,
          orderBy: [{ itemId: "asc" }, { version: "desc" }],
          select: {
            id: true,
            code: true,
            label: true,
            version: true,
            status: true,
            item: { select: { code: true, label1: true } },
          },
        })
      : [],
    peut(PERMISSIONS.RH_LIRE)
      ? prisma.employee.findMany({
          where: {
            OR: [{ matricule: comme }, { firstName: comme }, { lastName: comme }],
          },
          take: LIMITE,
          orderBy: { lastName: "asc" },
          select: {
            id: true,
            matricule: true,
            firstName: true,
            lastName: true,
            jobTitle: true,
            factory: true,
            isActive: true,
          },
        })
      : [],
    peut(PERMISSIONS.DEPOT_LIRE)
      ? prisma.warehouse.findMany({
          where: { OR: [{ code: comme }, { label: comme }] },
          take: LIMITE,
          orderBy: { code: "asc" },
          select: { id: true, code: true, label: true, factory: true, isActive: true },
        })
      : [],
  ]);

  const totalTrouve =
    articles.length +
    tiers.length +
    ordres.length +
    lots.length +
    devis.length +
    commandesClient.length +
    livraisons.length +
    facturesClient.length +
    commandesFournisseur.length +
    receptions.length +
    nomenclatures.length +
    employes.length +
    depots.length;

  const domainesInterroges = [
    peut(PERMISSIONS.ARTICLE_LIRE),
    peut(PERMISSIONS.TIERS_LIRE),
    peut(PERMISSIONS.PRODUCTION_LIRE),
    peut(PERMISSIONS.STOCK_LIRE),
    peut(PERMISSIONS.VENTE_LIRE),
    peut(PERMISSIONS.ACHAT_LIRE),
    peut(PERMISSIONS.NOMENCLATURE_LIRE),
    peut(PERMISSIONS.RH_LIRE),
    peut(PERMISSIONS.DEPOT_LIRE),
  ].filter(Boolean).length;

  const domainesRefuses: [string, string][] = (
    [
      [PERMISSIONS.ARTICLE_LIRE, "Articles"],
      [PERMISSIONS.TIERS_LIRE, "Tiers"],
      [PERMISSIONS.PRODUCTION_LIRE, "Production"],
      [PERMISSIONS.STOCK_LIRE, "Stocks"],
      [PERMISSIONS.VENTE_LIRE, "Ventes"],
      [PERMISSIONS.ACHAT_LIRE, "Achats"],
      [PERMISSIONS.NOMENCLATURE_LIRE, "Nomenclatures"],
      [PERMISSIONS.RH_LIRE, "Ressources humaines"],
      [PERMISSIONS.DEPOT_LIRE, "Depots"],
    ] as [string, string][]
  ).filter(([permission]) => !peut(permission));

  return (
    <>
      <EnTetePage
        titre={`Recherche : ${requete}`}
        description="Les domaines affiches dependent de vos droits : une rubrique sans permission de consultation n'est pas interrogee."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistique
          libelle="Resultats affiches"
          valeur={formatEntier(totalTrouve)}
          ton="primaire"
        />
        <Statistique
          libelle="Domaines interroges"
          valeur={formatEntier(domainesInterroges)}
          detail="Selon vos permissions"
        />
        <Statistique libelle="Limite par domaine" valeur={formatEntier(LIMITE)} />
        <Statistique
          libelle="Domaines non autorises"
          valeur={formatEntier(domainesRefuses.length)}
          ton={domainesRefuses.length > 0 ? "alerte" : "succes"}
          detail="Consultation refusee par vos droits"
        />
      </div>

      <div className="space-y-5">
        {totalTrouve === 0 && (
          <Vide
            message={`Aucun resultat pour « ${requete} » dans les domaines auxquels vous avez acces.`}
          />
        )}

        {articles.length > 0 && (
          <Carte titre={`Articles (${articles.length})`} sansPadding>
            <Tableau
              colonnes={[
                { cle: "code", libelle: "Code" },
                { cle: "libelle", libelle: "Designation" },
                { cle: "unite", libelle: "Unite" },
                { cle: "etat", libelle: "Etat" },
              ]}
              lignes={articles.map((article) => ({
                cle: String(article.id),
                cellules: [
                  <Link
                    key="lien"
                    className="lien-nav"
                    href={`/referentiel/articles/${article.id}`}
                  >
                    {article.code}
                  </Link>,
                  article.label1,
                  article.unit?.code ?? "-",
                  <EtiquetteStatut
                    key="etat"
                    libelle={libelle(LIBELLES_STATUT_ARTICLE, article.status)}
                    code={article.status}
                  />,
                ],
              }))}
            />
          </Carte>
        )}

        {tiers.length > 0 && (
          <Carte titre={`Clients, fournisseurs et employes (${tiers.length})`} sansPadding>
            <Tableau
              colonnes={[
                { cle: "code", libelle: "Code" },
                { cle: "libelle", libelle: "Raison sociale" },
                { cle: "nature", libelle: "Nature" },
                { cle: "etat", libelle: "Etat" },
              ]}
              lignes={tiers.map((ligneTiers) => ({
                cle: String(ligneTiers.id),
                cellules: [
                  <Link
                    key="lien"
                    className="lien-nav"
                    href={`/referentiel/tiers/${ligneTiers.id}`}
                  >
                    {ligneTiers.code}
                  </Link>,
                  ligneTiers.label1,
                  [
                    ligneTiers.isClient ? "Client" : null,
                    ligneTiers.isSupplier ? "Fournisseur" : null,
                    ligneTiers.isEmployee ? "Employe" : null,
                  ]
                    .filter(Boolean)
                    .join(", ") || "Autre tiers",
                  <EtiquetteStatut
                    key="etat"
                    libelle={ligneTiers.isActive ? "Actif" : "Inactif"}
                    code={ligneTiers.isActive ? "ACTIF" : "INACTIF"}
                  />,
                ],
              }))}
            />
          </Carte>
        )}

        {ordres.length > 0 && (
          <Carte titre={`Ordres de fabrication (${ordres.length})`} sansPadding>
            <Tableau
              colonnes={[
                { cle: "numero", libelle: "Numero" },
                { cle: "article", libelle: "Article" },
                { cle: "quantite", libelle: "Quantite prevue", nombre: true },
                { cle: "statut", libelle: "Statut" },
              ]}
              lignes={ordres.map((ordre) => ({
                cle: String(ordre.id),
                cellules: [
                  <Link key="lien" className="lien-nav" href={`/production/${ordre.id}`}>
                    {ordre.number}
                  </Link>,
                  `${ordre.item.code} — ${ordre.item.label1}`,
                  formatQuantite(ordre.quantityPlanned),
                  <EtiquetteStatut
                    key="statut"
                    libelle={libelle(LIBELLES_STATUT_ORDRE, ordre.status)}
                    code={ordre.status}
                  />,
                ],
              }))}
            />
          </Carte>
        )}

        {nomenclatures.length > 0 && (
          <Carte titre={`Nomenclatures (${nomenclatures.length})`} sansPadding>
            <Tableau
              colonnes={[
                { cle: "article", libelle: "Article" },
                { cle: "code", libelle: "Nomenclature" },
                { cle: "version", libelle: "Version" },
                { cle: "statut", libelle: "Statut" },
              ]}
              lignes={nomenclatures.map((formule) => ({
                cle: String(formule.id),
                cellules: [
                  `${formule.item.code} — ${formule.item.label1}`,
                  <Link key="lien" className="lien-nav" href={`/nomenclature/${formule.id}`}>
                    {formule.code} — {formule.label}
                  </Link>,
                  String(formule.version),
                  <EtiquetteStatut
                    key="statut"
                    libelle={libelle(LIBELLES_STATUT_NOMENCLATURE, formule.status)}
                    code={formule.status}
                  />,
                ],
              }))}
            />
          </Carte>
        )}

        {devis.length > 0 && (
          <Carte titre={`Devis (${devis.length})`} sansPadding>
            <Tableau
              colonnes={[
                { cle: "numero", libelle: "Numero" },
                { cle: "client", libelle: "Client" },
                { cle: "date", libelle: "Date" },
                { cle: "montant", libelle: "Montant TTC", nombre: true },
                { cle: "statut", libelle: "Statut" },
              ]}
              lignes={devis.map((ligneDevis) => ({
                cle: String(ligneDevis.id),
                cellules: [
                  <Link key="lien" className="lien-nav" href={`/ventes/devis/${ligneDevis.id}`}>
                    {ligneDevis.number}
                  </Link>,
                  ligneDevis.customer.label1,
                  formatDate(ligneDevis.quoteDate),
                  formatMontant(ligneDevis.totalTTC),
                  <EtiquetteStatut
                    key="statut"
                    libelle={libelle(LIBELLES_STATUT_DEVIS, ligneDevis.status)}
                    code={ligneDevis.status}
                  />,
                ],
              }))}
            />
          </Carte>
        )}

        {commandesClient.length > 0 && (
          <Carte titre={`Commandes client (${commandesClient.length})`} sansPadding>
            <Tableau
              colonnes={[
                { cle: "numero", libelle: "Numero" },
                { cle: "client", libelle: "Client" },
                { cle: "date", libelle: "Date" },
                { cle: "montant", libelle: "Montant TTC", nombre: true },
                { cle: "statut", libelle: "Statut" },
              ]}
              lignes={commandesClient.map((commande) => ({
                cle: String(commande.id),
                cellules: [
                  <Link key="lien" className="lien-nav" href={`/ventes/commandes/${commande.id}`}>
                    {commande.number}
                  </Link>,
                  commande.customer.label1,
                  formatDate(commande.orderDate),
                  formatMontant(commande.totalTTC),
                  <EtiquetteStatut
                    key="statut"
                    libelle={libelle(LIBELLES_STATUT_COMMANDE_CLIENT, commande.status)}
                    code={commande.status}
                  />,
                ],
              }))}
            />
          </Carte>
        )}

        {livraisons.length > 0 && (
          <Carte titre={`Bons de livraison (${livraisons.length})`} sansPadding>
            <Tableau
              colonnes={[
                { cle: "numero", libelle: "Numero" },
                { cle: "client", libelle: "Client" },
                { cle: "date", libelle: "Date" },
                { cle: "statut", libelle: "Statut" },
              ]}
              lignes={livraisons.map((livraison) => ({
                cle: String(livraison.id),
                cellules: [
                  <Link
                    key="lien"
                    className="lien-nav"
                    href={`/ventes/livraisons/${livraison.id}`}
                  >
                    {livraison.number}
                  </Link>,
                  livraison.customer.label1,
                  formatDate(livraison.deliveryDate),
                  <EtiquetteStatut
                    key="statut"
                    libelle={libelle(LIBELLES_STATUT_LIVRAISON, livraison.status)}
                    code={livraison.status}
                  />,
                ],
              }))}
            />
          </Carte>
        )}

        {facturesClient.length > 0 && (
          <Carte titre={`Factures clients (${facturesClient.length})`} sansPadding>
            <Tableau
              colonnes={[
                { cle: "numero", libelle: "Numero" },
                { cle: "tiers", libelle: "Client" },
                { cle: "date", libelle: "Date" },
                { cle: "montant", libelle: "Montant TTC", nombre: true },
                { cle: "statut", libelle: "Statut" },
              ]}
              lignes={facturesClient.map((facture) => ({
                cle: String(facture.id),
                cellules: [
                  <Link key="lien" className="lien-nav" href={`/ventes/factures/${facture.id}`}>
                    {facture.number}
                  </Link>,
                  facture.thirdParty.label1,
                  formatDate(facture.invoiceDate),
                  formatMontant(facture.totalTTC),
                  <EtiquetteStatut
                    key="statut"
                    libelle={libelle(LIBELLES_STATUT_FACTURE, facture.status)}
                    code={facture.status}
                  />,
                ],
              }))}
            />
          </Carte>
        )}

        {commandesFournisseur.length > 0 && (
          <Carte titre={`Commandes fournisseur (${commandesFournisseur.length})`} sansPadding>
            <Tableau
              colonnes={[
                { cle: "numero", libelle: "Numero" },
                { cle: "fournisseur", libelle: "Fournisseur" },
                { cle: "date", libelle: "Date" },
                { cle: "montant", libelle: "Montant TTC", nombre: true },
                { cle: "statut", libelle: "Statut" },
              ]}
              lignes={commandesFournisseur.map((commande) => ({
                cle: String(commande.id),
                cellules: [
                  <Link key="lien" className="lien-nav" href={`/achats/commandes/${commande.id}`}>
                    {commande.number}
                  </Link>,
                  commande.supplier.label1,
                  formatDate(commande.orderDate),
                  formatMontant(commande.totalTTC),
                  <EtiquetteStatut
                    key="statut"
                    libelle={libelle(LIBELLES_STATUT_COMMANDE_FOURNISSEUR, commande.status)}
                    code={commande.status}
                  />,
                ],
              }))}
            />
          </Carte>
        )}

        {receptions.length > 0 && (
          <Carte titre={`Receptions fournisseur (${receptions.length})`} sansPadding>
            <Tableau
              colonnes={[
                { cle: "numero", libelle: "Numero" },
                { cle: "fournisseur", libelle: "Fournisseur" },
                { cle: "date", libelle: "Date" },
                { cle: "statut", libelle: "Statut" },
              ]}
              lignes={receptions.map((reception) => ({
                cle: String(reception.id),
                cellules: [
                  <Link
                    key="lien"
                    className="lien-nav"
                    href={`/achats/receptions/${reception.id}`}
                  >
                    {reception.number}
                  </Link>,
                  reception.supplier.label1,
                  formatDate(reception.receiptDate),
                  <EtiquetteStatut
                    key="statut"
                    libelle={libelle(LIBELLES_STATUT_RECEPTION, reception.status)}
                    code={reception.status}
                  />,
                ],
              }))}
            />
          </Carte>
        )}

        {lots.length > 0 && (
          <Carte titre={`Lots de stock (${lots.length})`} sansPadding>
            <Tableau
              colonnes={[
                { cle: "lot", libelle: "Lot" },
                { cle: "article", libelle: "Article" },
                { cle: "depot", libelle: "Depot" },
                { cle: "physique", libelle: "Quantite physique", nombre: true },
                { cle: "reserve", libelle: "Quantite reservee", nombre: true },
                { cle: "statut", libelle: "Statut" },
              ]}
              lignes={lots.map((lot) => ({
                cle: String(lot.id),
                cellules: [
                  lot.lotNumber,
                  `${lot.item.code} — ${lot.item.label1}`,
                  lot.warehouse.code,
                  formatQuantite(D.sum(lot.balances.map((solde) => solde.quantityPhysical))),
                  formatQuantite(D.sum(lot.balances.map((solde) => solde.quantityReserved))),
                  <EtiquetteStatut
                    key="statut"
                    libelle={libelle(LIBELLES_STATUT_STOCK, lot.status)}
                    code={lot.status}
                  />,
                ],
              }))}
            />
          </Carte>
        )}

        {employes.length > 0 && (
          <Carte titre={`Employes (${employes.length})`} sansPadding>
            <Tableau
              colonnes={[
                { cle: "matricule", libelle: "Matricule" },
                { cle: "nom", libelle: "Nom" },
                { cle: "poste", libelle: "Poste" },
                { cle: "etat", libelle: "Etat" },
              ]}
              lignes={employes.map((employe) => ({
                cle: String(employe.id),
                cellules: [
                  <Link key="lien" className="lien-nav" href={`/rh/employes/${employe.id}`}>
                    {employe.matricule}
                  </Link>,
                  `${employe.lastName} ${employe.firstName}`,
                  employe.jobTitle ?? "-",
                  <EtiquetteStatut
                    key="etat"
                    libelle={employe.isActive ? "Actif" : "Inactif"}
                    code={employe.isActive ? "ACTIF" : "INACTIF"}
                  />,
                ],
              }))}
            />
          </Carte>
        )}

        {depots.length > 0 && (
          <Carte titre={`Depots (${depots.length})`} sansPadding>
            <Tableau
              colonnes={[
                { cle: "code", libelle: "Code" },
                { cle: "libelle", libelle: "Libelle" },
                { cle: "etat", libelle: "Etat" },
              ]}
              lignes={depots.map((depot) => ({
                cle: String(depot.id),
                cellules: [
                  depot.code,
                  depot.label,
                  <EtiquetteStatut
                    key="etat"
                    libelle={depot.isActive ? "Actif" : "Inactif"}
                    code={depot.isActive ? "ACTIF" : "INACTIF"}
                  />,
                ],
              }))}
            />
          </Carte>
        )}

        <Carte titre="Domaines non interroges">
          <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
            Les domaines pour lesquels vous ne disposez pas de permission de consultation ne sont
            pas recherches. Pour y acceder, une autorisation doit vous etre accordee par un
            administrateur : masquer un lien ne remplacerait pas cette autorisation.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {domainesRefuses.length === 0 ? (
              <Etiquette ton="succes">Tous les domaines consultables sont recherches</Etiquette>
            ) : (
              domainesRefuses.map(([, libelleDomaine]) => (
                <Etiquette key={libelleDomaine} ton="danger">
                  {libelleDomaine} — acces non autorise
                </Etiquette>
              ))
            )}
          </div>
        </Carte>
      </div>
    </>
  );
}
