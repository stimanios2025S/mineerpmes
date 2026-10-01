import Link from "next/link";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { actionEnregistrerFactureFournisseur } from "@/actions/achat";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { identifiantOuNull, premiereValeur } from "@/lib/liste";
import { CLE_PARAMETRE, lireParametreTexte } from "@/lib/settings";
import { Alerte, Carte, EnTetePage, ListeDefinitions, Section } from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import {
  DEVISE_PAR_DEFAUT,
  formatDate,
  formatMontant,
  formatPourcentage,
  formatQuantite,
  toInputDate,
} from "@/lib/format";
import {
  LIBELLES_STATUT_COMMANDE_FOURNISSEUR,
  LIBELLES_STATUT_RECEPTION,
  LIBELLES_STATUT_STOCK,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Nouvelle facture fournisseur" };

/** Statuts de commande dont les lignes peuvent encore etre facturees. */
const STATUTS_FACTURABLES = ["APPROUVE", "PARTIELLEMENT_RECU", "RECU", "FACTURE", "CLOTURE"] as const;

const NOMBRE_LIGNES_LIBRES = 5;
const NOMBRE_LIGNES_LIBRES_AVEC_SOURCE = 3;
const NOMBRE_LIGNES_MAX = 30;

/** Convertit une valeur d'URL en entier borne, sans jamais faire echouer la page. */
function entierDeFiltre(valeur: string | null, defaut: number, minimum: number, maximum: number) {
  if (valeur === null) return defaut;
  const nombre = Number.parseInt(valeur, 10);
  if (!Number.isFinite(nombre)) return defaut;
  return Math.min(Math.max(nombre, minimum), maximum);
}

/**
 * Ligne saisie dans le formulaire de facture. Les lignes issues d'une commande
 * ou d'une reception portent leur identifiant de reference : le rapprochement
 * trois voies du service s'appuie alors sur la ligne exacte.
 */
interface LigneSaisie {
  cle: string;
  libre: boolean;
  itemId: number | null;
  orderLineId: number | null;
  receiptLineId: number | null;
  article: string;
  origine: string;
  quantite: string;
  prixUnitaire: string;
  codeTva: string;
  description: string;
}

export default async function PageNouvelleFactureFournisseur({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.ACHAT_FACTURE_SAISIR);

  const parametres = await searchParams;
  const recherche = premiereValeur(parametres, "q");
  const fournisseurId = identifiantOuNull(premiereValeur(parametres, "fournisseur"));
  const commandeId = identifiantOuNull(premiereValeur(parametres, "commande"));
  const receptionId = identifiantOuNull(premiereValeur(parametres, "reception"));

  const [fournisseurs, tauxTva, articles, deviseParametre] = await Promise.all([
    prisma.thirdParty.findMany({
      where: { isSupplier: true, isActive: true },
      orderBy: { code: "asc" },
      take: 500,
      select: { id: true, code: true, label1: true, deadlineDays: true },
    }),
    prisma.taxRate.findMany({
      where: { isActive: true },
      orderBy: { rate: "asc" },
      select: { code: true, label: true, rate: true },
    }),
    prisma.item.findMany({
      where: {
        status: "ACTIF",
        isPurchasable: true,
        ...(recherche
          ? {
              OR: [
                { code: { contains: recherche, mode: "insensitive" as const } },
                { label1: { contains: recherche, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { code: "asc" },
      take: 300,
      select: { id: true, code: true, label1: true, taxRateCode: true },
    }),
    lireParametreTexte(CLE_PARAMETRE.DEVISE, DEVISE_PAR_DEFAUT),
  ]);

  const fournisseur = fournisseurId
    ? (fournisseurs.find((element) => element.id === fournisseurId) ?? null)
    : null;

  const [commandes, receptions, commande, reception] = await Promise.all([
    fournisseurId
      ? prisma.purchaseOrder.findMany({
          where: { supplierId: fournisseurId, status: { in: [...STATUTS_FACTURABLES] } },
          orderBy: { orderDate: "desc" },
          take: 100,
          select: {
            id: true,
            number: true,
            orderDate: true,
            status: true,
            currency: true,
            subtotalHT: true,
            totalTTC: true,
          },
        })
      : Promise.resolve([]),
    fournisseurId
      ? prisma.goodsReceipt.findMany({
          where: { supplierId: fournisseurId },
          orderBy: { receiptDate: "desc" },
          take: 100,
          select: {
            id: true,
            number: true,
            orderId: true,
            receiptDate: true,
            status: true,
            deliveryNoteNumber: true,
          },
        })
      : Promise.resolve([]),
    commandeId
      ? prisma.purchaseOrder.findUnique({
          where: { id: commandeId },
          include: {
            supplier: { select: { id: true, code: true, label1: true } },
            lines: {
              orderBy: { lineNo: "asc" },
              include: { item: { select: { code: true, label1: true } } },
            },
          },
        })
      : Promise.resolve(null),
    receptionId
      ? prisma.goodsReceipt.findUnique({
          where: { id: receptionId },
          include: {
            supplier: { select: { id: true, code: true, label1: true } },
            order: { select: { id: true, number: true } },
            lines: {
              orderBy: { lineNo: "asc" },
              include: { item: { select: { code: true, label1: true } } },
            },
          },
        })
      : Promise.resolve(null),
  ]);

  // La commande et la reception retenues doivent appartenir au fournisseur
  // selectionne : sinon la saisie repartirait sur un dossier incoherent.
  const commandeRetenue = commande && commande.supplierId === fournisseurId ? commande : null;
  const receptionRetenue = reception && reception.supplierId === fournisseurId ? reception : null;

  const lignesSource: LigneSaisie[] = [];

  if (receptionRetenue) {
    for (const ligne of receptionRetenue.lines) {
      lignesSource.push({
        cle: `reception-${ligne.id}`,
        libre: false,
        itemId: ligne.itemId,
        orderLineId: ligne.orderLineId,
        receiptLineId: ligne.id,
        article: `${ligne.item.code} — ${ligne.item.label1}`,
        origine:
          `Reception ${receptionRetenue.number} : recue ${formatQuantite(ligne.quantityReceived)}, ` +
          `acceptee ${formatQuantite(ligne.quantityAccepted)}, quarantaine ${formatQuantite(
            ligne.quantityQuarantined,
          )} (${libelle(LIBELLES_STATUT_STOCK, ligne.qualityStatus)})`,
        quantite: D.toFixed(D.of(ligne.quantityReceived), 3),
        prixUnitaire: D.toFixed(D.of(ligne.unitPrice), 4),
        codeTva: "",
        description: ligne.notes ?? "",
      });
    }
  } else if (commandeRetenue) {
    for (const ligne of commandeRetenue.lines) {
      const resteARecevoir = D.sub(D.of(ligne.quantity), D.of(ligne.quantityReceived));
      const resteAFacturer = D.sub(D.of(ligne.quantity), D.of(ligne.quantityInvoiced));
      lignesSource.push({
        cle: `commande-${ligne.id}`,
        libre: false,
        itemId: ligne.itemId,
        orderLineId: ligne.id,
        receiptLineId: null,
        article: `${ligne.item.code} — ${ligne.item.label1}`,
        origine:
          `Commande ${commandeRetenue.number} : commandee ${formatQuantite(ligne.quantity)}, ` +
          `recue ${formatQuantite(ligne.quantityReceived)}, facturee ${formatQuantite(
            ligne.quantityInvoiced,
          )}, reste a recevoir ${formatQuantite(resteARecevoir)}`,
        quantite: D.gt(resteAFacturer, 0) ? D.toFixed(resteAFacturer, 3) : "0.000",
        prixUnitaire: D.toFixed(D.of(ligne.unitPrice), 4),
        codeTva: ligne.vatRateCode ?? "",
        description: ligne.description ?? "",
      });
    }
  }

  // Lignes libres : elles permettent de facturer une ligne hors commande
  // (frais, marchandise non commandee). Le service les signalera comme
  // « ligne sans commande » : cet ecart est volontairement visible.
  const nombreLignesLibres = entierDeFiltre(
    premiereValeur(parametres, "lignes"),
    lignesSource.length > 0 ? NOMBRE_LIGNES_LIBRES_AVEC_SOURCE : NOMBRE_LIGNES_LIBRES,
    0,
    NOMBRE_LIGNES_MAX,
  );

  const lignes: LigneSaisie[] = [
    ...lignesSource,
    ...Array.from({ length: nombreLignesLibres }, (_, index): LigneSaisie => ({
      cle: `libre-${index}`,
      libre: true,
      itemId: null,
      orderLineId: null,
      receiptLineId: null,
      article: "",
      origine: "",
      quantite: "",
      prixUnitaire: "",
      codeTva: "",
      description: "",
    })),
  ];

  const optionsArticles = articles.map((element) => ({
    valeur: element.id,
    libelle: `${element.code} — ${element.label1}`,
  }));

  return (
    <>
      <EnTetePage
        titre="Nouvelle facture fournisseur"
        description="Saisie d'une facture recue : reference fournisseur, pieces rattachees et lignes. Les totaux et les ecarts de rapprochement trois voies sont etablis par le service, jamais par l'ecran."
        actions={
          <Link className="lien-nav text-sm" href="/achats/factures">
            Retour a la liste
          </Link>
        }
      />

      <div className="space-y-6">
        <Carte
          titre="Selectionner le dossier d'achat"
          description="Le fournisseur est obligatoire. Rattacher la facture a sa commande et a sa reception permet au service de calculer le rapprochement trois voies."
        >
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Fournisseur</span>
              <select className="champ" name="fournisseur" defaultValue={fournisseurId ?? ""}>
                <option value="">— Selectionner —</option>
                {fournisseurs.map((element) => (
                  <option key={element.id} value={element.id}>
                    {element.code} — {element.label1}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Bon de commande</span>
              <select className="champ" name="commande" defaultValue={commandeId ?? ""}>
                <option value="">Aucune commande rattachee</option>
                {commandes.map((element) => (
                  <option key={element.id} value={element.id}>
                    {element.number} — {formatDate(element.orderDate)} —{" "}
                    {libelle(LIBELLES_STATUT_COMMANDE_FOURNISSEUR, element.status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Reception</span>
              <select className="champ" name="reception" defaultValue={receptionId ?? ""}>
                <option value="">Aucune reception rattachee</option>
                {receptions.map((element) => (
                  <option key={element.id} value={element.id}>
                    {element.number} — {formatDate(element.receiptDate)} —{" "}
                    {libelle(LIBELLES_STATUT_RECEPTION, element.status)}
                    {element.orderId ? ` — commande ${element.orderId}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <input type="hidden" name="lignes" value={nombreLignesLibres} />
            <button
              type="submit"
              className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
            >
              Charger les lignes
            </button>
            <Link className="lien-nav text-sm" href="/achats/factures/nouvelle">
              Reinitialiser
            </Link>
          </form>

          {fournisseur === null && (
            <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
              Choisissez d&apos;abord le fournisseur : les commandes et receptions proposees en
              dependent, et la saisie libre des lignes reste possible.
            </p>
          )}
          {fournisseur !== null && commandes.length === 0 && receptions.length === 0 && (
            <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
              Ce fournisseur n&apos;a ni commande facturable ni reception enregistree : la facture
              sera saisie en lignes libres, et le service la signalera comme non rapprochee.
            </p>
          )}
        </Carte>

        {receptionRetenue && (
          <Carte titre={`Reception ${receptionRetenue.number}`}>
            <ListeDefinitions
              elements={[
                {
                  terme: "Fournisseur",
                  valeur: `${receptionRetenue.supplier.code} — ${receptionRetenue.supplier.label1}`,
                },
                {
                  terme: "Bon de commande",
                  valeur: receptionRetenue.order ? receptionRetenue.order.number : "Sans commande",
                },
                {
                  terme: "Bon de livraison",
                  valeur: receptionRetenue.deliveryNoteNumber ?? "Non renseigne",
                },
                { terme: "Date", valeur: formatDate(receptionRetenue.receiptDate) },
                {
                  terme: "Statut",
                  valeur: libelle(LIBELLES_STATUT_RECEPTION, receptionRetenue.status),
                },
              ]}
            />
          </Carte>
        )}

        {commandeRetenue && !receptionRetenue && (
          <Carte titre={`Bon de commande ${commandeRetenue.number}`}>
            <ListeDefinitions
              elements={[
                {
                  terme: "Fournisseur",
                  valeur: `${commandeRetenue.supplier.code} — ${commandeRetenue.supplier.label1}`,
                },
                { terme: "Date", valeur: formatDate(commandeRetenue.orderDate) },
                {
                  terme: "Statut",
                  valeur: libelle(LIBELLES_STATUT_COMMANDE_FOURNISSEUR, commandeRetenue.status),
                },
                {
                  terme: "Total TTC commande",
                  valeur: formatMontant(commandeRetenue.totalTTC, commandeRetenue.currency),
                },
                {
                  terme: "Conditions de reglement",
                  valeur: `${commandeRetenue.paymentTermsDays} jour(s)`,
                },
              ]}
            />
          </Carte>
        )}

        {fournisseur !== null && (
          <Carte
            titre="Affiner les choix de lignes"
            description="La recherche restreint la liste d'articles proposee sur les lignes libres ; le nombre de lignes libres ajoutees au formulaire est ajustable."
          >
            <form method="get" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="fournisseur" value={fournisseur.id} />
              {commandeRetenue && <input type="hidden" name="commande" value={commandeRetenue.id} />}
              {receptionRetenue && (
                <input type="hidden" name="reception" value={receptionRetenue.id} />
              )}
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Code ou designation de l&apos;article</span>
                <input className="champ" type="search" name="q" defaultValue={recherche ?? ""} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Lignes libres</span>
                <input
                  className="champ"
                  type="number"
                  name="lignes"
                  min={0}
                  max={NOMBRE_LIGNES_MAX}
                  defaultValue={nombreLignesLibres}
                />
              </label>
              <button
                type="submit"
                className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
              >
                Actualiser les choix
              </button>
            </form>
            <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
              {articles.length} article(s) achetable(s) propose(s){recherche ? ` pour « ${recherche} »` : ""}.
            </p>
          </Carte>
        )}

        {fournisseur !== null && (
          <Carte
            titre="Facture fournisseur"
            description="La quantite facturee est celle portee par la facture du fournisseur : elle n'est jamais alignee d'office sur la commande ou la reception."
          >
            <FormulaireAction
              action={actionEnregistrerFactureFournisseur}
              libelleSoumettre="Enregistrer la facture"
              varianteSoumettre="primaire"
            >
              <input type="hidden" name="nombreLignes" value={lignes.length} />
              <input type="hidden" name="fournisseurId" value={fournisseur.id} />
              {commandeRetenue && (
                <input type="hidden" name="commandeId" value={commandeRetenue.id} />
              )}
              {receptionRetenue && (
                <input type="hidden" name="receptionId" value={receptionRetenue.id} />
              )}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Champ
                  nom="referenceFournisseur"
                  libelle="Reference de la facture fournisseur"
                  requis
                  maxLength={60}
                  aide="Numero porte sur la facture remise par le fournisseur. Une reference deja saisie pour ce fournisseur est refusee."
                />
                <Champ
                  nom="dateFacture"
                  libelle="Date de la facture"
                  type="date"
                  valeur={toInputDate(new Date())}
                />
                <Champ nom="dateEcheance" libelle="Date d'echeance" type="date" />
                <Champ
                  nom="conditionsReglement"
                  libelle="Conditions de reglement (jours)"
                  type="number"
                  min={0}
                  pas="1"
                  valeur={fournisseur.deadlineDays}
                  aide="Laisser vide pour reprendre le delai du fournisseur."
                />
                <Champ
                  nom="devise"
                  libelle="Devise"
                  valeur={commandeRetenue?.currency ?? deviseParametre}
                />
                <Champ nom="notes" libelle="Observations" type="textarea" maxLength={1000} />
              </div>

              <div className="mt-4">
                <Alerte ton="info" titre="Rapprochement trois voies">
                  Le service compare chaque ligne facturee au prix commande et aux quantites recues.
                  Tout ecart (prix, quantite, ligne sans commande, ligne sans reception, marchandise
                  en quarantaine) est conserve et affiche sur la fiche de la facture : il devra etre
                  justifie par ecrit avant comptabilisation.
                </Alerte>
              </div>

              <Section titre="Lignes facturees">
                <div className="overflow-x-auto">
                  <table className="donnees">
                    <thead>
                      <tr>
                        <th style={{ minWidth: "18rem" }}>Article</th>
                        <th className="nombre">Quantite facturee</th>
                        <th className="nombre">Prix unitaire</th>
                        <th style={{ minWidth: "10rem" }}>Code TVA</th>
                        <th style={{ minWidth: "12rem" }}>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignes.map((ligne, index) => (
                        <tr key={ligne.cle}>
                          <td>
                            {ligne.libre ? (
                              <select className="champ" name={`ligne_${index}_itemId`} defaultValue="">
                                <option value="">— Selectionner —</option>
                                {optionsArticles.map((option) => (
                                  <option key={String(option.valeur)} value={String(option.valeur)}>
                                    {option.libelle}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <>
                                <input
                                  type="hidden"
                                  name={`ligne_${index}_itemId`}
                                  value={ligne.itemId ?? ""}
                                />
                                {ligne.orderLineId !== null && (
                                  <input
                                    type="hidden"
                                    name={`ligne_${index}_orderLineId`}
                                    value={ligne.orderLineId}
                                  />
                                )}
                                {ligne.receiptLineId !== null && (
                                  <input
                                    type="hidden"
                                    name={`ligne_${index}_receiptLineId`}
                                    value={ligne.receiptLineId}
                                  />
                                )}
                                {ligne.article}
                                <span
                                  className="block text-xs"
                                  style={{ color: "var(--texte-doux)" }}
                                >
                                  {ligne.origine}
                                </span>
                              </>
                            )}
                          </td>
                          <td className="nombre">
                            <input
                              className="champ"
                              type="number"
                              name={`ligne_${index}_quantite`}
                              step="0.001"
                              min="0"
                              inputMode="decimal"
                              defaultValue={ligne.quantite}
                            />
                          </td>
                          <td className="nombre">
                            <input
                              className="champ"
                              type="number"
                              name={`ligne_${index}_prixUnitaire`}
                              step="0.0001"
                              min="0"
                              inputMode="decimal"
                              defaultValue={ligne.prixUnitaire}
                            />
                          </td>
                          <td>
                            <select
                              className="champ"
                              name={`ligne_${index}_codeTva`}
                              defaultValue={ligne.codeTva}
                            >
                              <option value="">Taux par defaut de l&apos;article</option>
                              {tauxTva.map((taux) => (
                                <option key={taux.code} value={taux.code}>
                                  {taux.label} ({formatPourcentage(taux.rate)})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className="champ"
                              type="text"
                              name={`ligne_${index}_description`}
                              defaultValue={ligne.description}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
                  Les totaux HT, TVA et TTC sont calcules par le service a partir des taux en
                  vigueur. Une ligne libre sans article ou sans quantite est ignoree ; une ligne
                  facturee sans commande ni reception est signalee comme ecart.
                </p>
              </Section>
            </FormulaireAction>
          </Carte>
        )}
      </div>
    </>
  );
}
