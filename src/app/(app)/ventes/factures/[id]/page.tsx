import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import {
  actionCreerAvoirClient,
  actionReglerFactureClient,
  actionValiderFactureClient,
} from "@/actions/vente";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { identifiantOuNull } from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  ListeDefinitions,
  Section,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatDate, formatMontant, formatPourcentage, formatQuantite, toInputDate } from "@/lib/format";
import {
  LIBELLES_MODE_REGLEMENT,
  LIBELLES_NATURE_FACTURE,
  LIBELLES_STATUT_ECRITURE,
  LIBELLES_STATUT_FACTURE,
  LIBELLES_STATUT_REGLEMENT,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Facture client" };

const MODES_REGLEMENT = [
  "ESPECES",
  "CHEQUE",
  "VIREMENT",
  "TRAITE",
  "CARTE",
  "COMPENSATION",
  "AUTRE",
] as const;

export default async function PageFactureClient({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigerPermission(PERMISSIONS.VENTE_LIRE);

  const identifiant = identifiantOuNull((await params).id);
  if (identifiant === null) notFound();

  const facture = await prisma.invoice.findUnique({
    where: { id: identifiant },
    include: {
      thirdParty: { select: { id: true, code: true, label1: true, deadlineDays: true } },
      order: { select: { id: true, number: true, status: true } },
      delivery: { select: { id: true, number: true, status: true } },
      originalInvoice: { select: { id: true, number: true, invoiceDate: true, totalTTC: true } },
      corrections: {
        orderBy: { invoiceDate: "desc" },
        select: {
          id: true,
          number: true,
          status: true,
          invoiceDate: true,
          subtotalHT: true,
          vatAmount: true,
          totalTTC: true,
          cancelReason: true,
        },
      },
      lines: {
        orderBy: { lineNo: "asc" },
        include: {
          item: { select: { code: true, label1: true } },
          vatRateRef: { select: { code: true, label: true, rate: true } },
        },
      },
      allocations: {
        orderBy: { id: "desc" },
        include: {
          payment: {
            select: {
              id: true,
              number: true,
              method: true,
              status: true,
              paymentDate: true,
              reference: true,
              bankAccount: true,
              amount: true,
              allocatedAmount: true,
            },
          },
        },
      },
      accountingEntries: {
        orderBy: { entryDate: "desc" },
        select: {
          id: true,
          number: true,
          entryDate: true,
          label: true,
          status: true,
          totalDebit: true,
          totalCredit: true,
        },
      },
    },
  });
  if (!facture) notFound();

  const estClient = facture.direction === "CLIENT";
  const estAvoir = facture.nature === "AVOIR";

  const totalHT = D.of(facture.subtotalHT);
  const remise = D.of(facture.discountAmount);
  const totalTVA = D.of(facture.vatAmount);
  const totalTTC = D.of(facture.totalTTC);
  const regle = D.of(facture.paidAmount);
  const solde = D.of(facture.balance);
  const totalAffecte = D.sum(facture.allocations.map((affectation) => D.of(affectation.amount)));
  const totalAvoirs = D.sum(
    facture.corrections
      .filter((avoir) => avoir.status !== "ANNULEE")
      .map((avoir) => D.of(avoir.totalTTC)),
  );

  const peutEtreValidee = estClient && !estAvoir && facture.status === "BROUILLON";
  const peutEtreReglee =
    estClient &&
    !estAvoir &&
    facture.status !== "BROUILLON" &&
    facture.status !== "VALIDEE" &&
    facture.status !== "ANNULEE" &&
    D.gt(solde, 0);
  const peutRecevoirAvoir = estClient && !estAvoir && facture.status !== "BROUILLON";

  const resteAvoirPossible = D.sub(totalTTC, totalAvoirs);

  return (
    <>
      <EnTetePage
        titre={`Facture client ${facture.number}`}
        description="Piece de vente et son suivi financier : validation comptable, encaissements affectes et avoirs eventuels. Aucun montant n'est calcule par l'interface."
        actions={
          <Link className="lien-nav text-sm" href="/ventes/factures">
            Retour a la liste
          </Link>
        }
      />

      <div className="space-y-6">
        {!estClient && (
          <Alerte ton="danger" titre="Cette piece n'est pas une facture client">
            Cette piece est enregistree en {libelle(LIBELLES_NATURE_FACTURE, facture.nature)} cote
            fournisseur. Les operations de vente y sont refusees par le service.
          </Alerte>
        )}

        {facture.supplierInvoiceId !== null && (
          <Alerte ton="info" titre="Piece rattachee a une facture fournisseur">
            Cette facture est liee a une facture fournisseur : son cycle est suivi depuis le module
            achats.
          </Alerte>
        )}

        <Carte titre="Entete de la facture">
          <ListeDefinitions
            elements={[
              {
                terme: "Client",
                valeur: `${facture.thirdParty.code} — ${facture.thirdParty.label1}`,
              },
              {
                terme: "Nature",
                valeur: (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <Etiquette ton={estAvoir ? "alerte" : "neutre"}>
                      {libelle(LIBELLES_NATURE_FACTURE, facture.nature)}
                    </Etiquette>
                    <EtiquetteStatut
                      code={facture.status}
                      libelle={libelle(LIBELLES_STATUT_FACTURE, facture.status)}
                    />
                    {!estAvoir && D.gt(solde, 0) && D.lt(solde, totalTTC) && (
                      <Etiquette ton="alerte">Partiellement reglee</Etiquette>
                    )}
                    {!estAvoir && D.eq(solde, D.ZERO) && <Etiquette ton="succes">Reglee</Etiquette>}
                  </span>
                ),
              },
              { terme: "Date de facture", valeur: formatDate(facture.invoiceDate) },
              { terme: "Echeance", valeur: formatDate(facture.dueDate) },
              {
                terme: "Conditions de reglement",
                valeur: `${facture.paymentTermsDays} jour(s)`,
              },
              { terme: "Devise", valeur: facture.currency },
              { terme: "Reference", valeur: facture.reference ?? "Non renseignee" },
              {
                terme: "Commande rattachee",
                valeur: facture.order ? (
                  <Link className="lien-nav" href={`/ventes/commandes/${facture.order.id}`}>
                    {facture.order.number}
                  </Link>
                ) : (
                  "Sans commande rattachee"
                ),
              },
              {
                terme: "Livraison rattachee",
                valeur: facture.delivery ? (
                  <Link className="lien-nav" href={`/ventes/livraisons/${facture.delivery.id}`}>
                    {facture.delivery.number}
                  </Link>
                ) : (
                  "Sans livraison rattachee"
                ),
              },
              {
                terme: "Facture d'origine",
                valeur: facture.originalInvoice ? (
                  <Link
                    className="lien-nav"
                    href={`/ventes/factures/${facture.originalInvoice.id}`}
                  >
                    {facture.originalInvoice.number}
                  </Link>
                ) : (
                  "Aucune"
                ),
              },
              {
                terme: "Comptabilisee le",
                valeur: facture.postedAt ? formatDate(facture.postedAt) : "Non comptabilisee",
              },
              {
                terme: "Annulation",
                valeur: facture.cancelledAt
                  ? `${formatDate(facture.cancelledAt)} — ${facture.cancelReason ?? "motif non renseigne"}`
                  : "Aucune",
              },
            ]}
          />
          {facture.notes && (
            <p className="mt-4 whitespace-pre-line text-sm" style={{ color: "var(--texte-doux)" }}>
              {facture.notes}
            </p>
          )}
        </Carte>

        <Carte titre="Montants" sansPadding>
          <ListeDefinitions
            elements={[
              { terme: "Total HT", valeur: formatMontant(totalHT, facture.currency) },
              { terme: "Remise", valeur: formatMontant(remise, facture.currency) },
              { terme: "TVA", valeur: formatMontant(totalTVA, facture.currency) },
              { terme: "Total TTC", valeur: formatMontant(totalTTC, facture.currency) },
              { terme: "Deja regle", valeur: formatMontant(regle, facture.currency) },
              {
                terme: "Solde du",
                valeur: (
                  <span
                    style={D.gt(solde, 0) ? { color: "var(--danger)", fontWeight: 600 } : undefined}
                  >
                    {formatMontant(solde, facture.currency)}
                  </span>
                ),
              },
              { terme: "Avoirs etablis", valeur: formatMontant(totalAvoirs, facture.currency) },
              {
                terme: "Reste pouvant faire l'objet d'un avoir",
                valeur: formatMontant(resteAvoirPossible, facture.currency),
              },
            ]}
          />
          <p className="mt-3 px-1 text-xs" style={{ color: "var(--texte-doux)" }}>
            Le solde est celui tenu par le service : il integre les encaissements affectes et les
            avoirs. Un avoir n&apos;est jamais deduit deux fois.
          </p>
        </Carte>

        <Carte titre="Lignes de facturation" sansPadding>
          <Tableau
            colonnes={[
              { cle: "ligne", libelle: "Ligne", nombre: true },
              { cle: "article", libelle: "Article ou designation" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "unite", libelle: "Unite" },
              { cle: "prix", libelle: "Prix unitaire", nombre: true },
              { cle: "remise", libelle: "Remise" },
              { cle: "tva", libelle: "TVA" },
              { cle: "ht", libelle: "Montant HT", nombre: true },
              { cle: "tvaMontant", libelle: "Montant TVA", nombre: true },
              { cle: "ttc", libelle: "Montant TTC", nombre: true },
            ]}
            lignes={facture.lines.map((ligne) => ({
              cle: String(ligne.id),
              cellules: [
                String(ligne.lineNo),
                ligne.item
                  ? `${ligne.item.code} — ${ligne.item.label1}`
                  : (ligne.description ?? "Ligne sans designation"),
                formatQuantite(ligne.quantity),
                ligne.unitCode ?? "Unite de l'article",
                formatMontant(ligne.unitPrice, facture.currency),
                formatPourcentage(ligne.discountRate),
                ligne.vatRateRef
                  ? `${ligne.vatRateRef.label} (${formatPourcentage(ligne.vatRateRef.rate)})`
                  : `Taux applique : ${formatPourcentage(ligne.vatRate)}`,
                formatMontant(ligne.lineHT, facture.currency),
                formatMontant(ligne.lineVAT, facture.currency),
                formatMontant(ligne.lineTTC, facture.currency),
              ],
            }))}
            messageVide="Cette facture ne comporte aucune ligne."
          />
        </Carte>

        <Carte
          titre="Reglements rattaches"
          description="Chaque encaissement est un reglement affecte a cette facture : le total affecte est celui des affectations enregistrees, jamais une saisie d'interface."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Numero" },
              { cle: "mode", libelle: "Mode" },
              { cle: "statut", libelle: "Statut" },
              { cle: "date", libelle: "Date" },
              { cle: "reference", libelle: "Reference" },
              { cle: "compte", libelle: "Compte bancaire" },
              { cle: "montant", libelle: "Montant du reglement", nombre: true },
              { cle: "affecte", libelle: "Affecte a la facture", nombre: true },
            ]}
            lignes={facture.allocations.map((affectation) => ({
              cle: String(affectation.id),
              cellules: [
                affectation.payment.number,
                libelle(LIBELLES_MODE_REGLEMENT, affectation.payment.method),
                <EtiquetteStatut
                  key="statut"
                  code={affectation.payment.status}
                  libelle={libelle(LIBELLES_STATUT_REGLEMENT, affectation.payment.status)}
                />,
                formatDate(affectation.payment.paymentDate),
                affectation.payment.reference ?? "Non renseignee",
                affectation.payment.bankAccount ?? "Non renseigne",
                formatMontant(affectation.payment.amount, facture.currency),
                formatMontant(affectation.amount, facture.currency),
              ],
            }))}
            messageVide="Aucun reglement n'est rattache a cette facture."
          />
          {facture.allocations.length > 0 && (
            <p className="px-4 py-3 text-xs" style={{ color: "var(--texte-doux)" }}>
              Total affecte a cette facture : {formatMontant(totalAffecte, facture.currency)}.
            </p>
          )}
        </Carte>

        <Carte
          titre="Avoirs rattaches"
          description="Un avoir corrige la facture d'origine sans jamais l'effacer : il vient en deduction du solde."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Numero" },
              { cle: "statut", libelle: "Statut" },
              { cle: "date", libelle: "Date" },
              { cle: "ht", libelle: "Montant HT", nombre: true },
              { cle: "tva", libelle: "Montant TVA", nombre: true },
              { cle: "ttc", libelle: "Montant TTC", nombre: true },
            ]}
            lignes={facture.corrections.map((avoir) => ({
              cle: String(avoir.id),
              cellules: [
                <Link key="numero" className="lien-nav" href={`/ventes/factures/${avoir.id}`}>
                  {avoir.number}
                </Link>,
                <EtiquetteStatut
                  key="statut"
                  code={avoir.status}
                  libelle={libelle(LIBELLES_STATUT_FACTURE, avoir.status)}
                />,
                formatDate(avoir.invoiceDate),
                formatMontant(avoir.subtotalHT, facture.currency),
                formatMontant(avoir.vatAmount, facture.currency),
                formatMontant(avoir.totalTTC, facture.currency),
              ],
            }))}
            messageVide="Aucun avoir n'a ete etabli sur cette facture."
          />
        </Carte>

        <Carte titre="Ecritures comptables rattachees" sansPadding>
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Numero" },
              { cle: "date", libelle: "Date" },
              { cle: "libelle", libelle: "Libelle" },
              { cle: "statut", libelle: "Statut" },
              { cle: "debit", libelle: "Total debit", nombre: true },
              { cle: "credit", libelle: "Total credit", nombre: true },
            ]}
            lignes={facture.accountingEntries.map((ecriture) => ({
              cle: String(ecriture.id),
              cellules: [
                ecriture.number,
                formatDate(ecriture.entryDate),
                ecriture.label,
                libelle(LIBELLES_STATUT_ECRITURE, ecriture.status),
                formatMontant(ecriture.totalDebit, facture.currency),
                formatMontant(ecriture.totalCredit, facture.currency),
              ],
            }))}
            messageVide="Aucune ecriture comptable n'est rattachee a cette facture : elle n'a pas encore ete comptabilisee."
          />
        </Carte>

        <Carte
          titre="Actions sur la facture"
          description="La validation comptable, l'encaissement et l'avoir sont des actes distincts, traces et limites par les regles du service."
        >
          <Section titre="Valider et comptabiliser la facture">
            {peutEtreValidee ? (
              <>
                <p className="mb-3 text-sm" style={{ color: "var(--texte-doux)" }}>
                  La validation genere l&apos;ecriture comptable a partir des regles configurees,
                  passe la facture au statut comptabilise et initialise son solde. Le numero
                  d&apos;ecriture est affiche dans le compte rendu.
                </p>
                <FormulaireAction
                  action={actionValiderFactureClient}
                  libelleSoumettre="Valider et comptabiliser"
                  varianteSoumettre="primaire"
                >
                  <input type="hidden" name="factureId" value={facture.id} />
                  <Champ
                    nom="dateEcriture"
                    libelle="Date d'ecriture"
                    type="date"
                    valeur={toInputDate(facture.invoiceDate)}
                    aide="Laissez la date de la facture pour une comptabilisation a sa date."
                  />
                </FormulaireAction>
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                {estAvoir
                  ? "Un avoir ne se valide pas par cette operation : il suit sa propre procedure."
                  : facture.status === "BROUILLON"
                    ? "Facture au statut brouillon sans condition de validation remplie."
                    : `Cette facture est au statut ${libelle(LIBELLES_STATUT_FACTURE, facture.status)} : elle a deja ete validee.`}
              </p>
            )}
          </Section>

          <Section titre="Enregistrer un encaissement">
            {peutEtreReglee ? (
              <FormulaireAction
                action={actionReglerFactureClient}
                libelleSoumettre="Enregistrer l'encaissement"
                varianteSoumettre="primaire"
              >
                <input type="hidden" name="factureId" value={facture.id} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Champ
                    nom="montant"
                    libelle={`Montant encaisse (${facture.currency})`}
                    type="number"
                    min={0}
                    pas="0.01"
                    aide={`Laissez vide pour encaisser le solde du : ${formatMontant(solde, facture.currency)}.`}
                  />
                  <Champ
                    nom="mode"
                    libelle="Mode de reglement"
                    type="select"
                    requis
                    options={MODES_REGLEMENT.map((mode) => ({
                      valeur: mode,
                      libelle: libelle(LIBELLES_MODE_REGLEMENT, mode),
                    }))}
                  />
                  <Champ
                    nom="datePaiement"
                    libelle="Date de l'encaissement"
                    type="date"
                    valeur={toInputDate(new Date())}
                  />
                  <Champ
                    nom="reference"
                    libelle="Reference"
                    aide="Numero de cheque, de virement ou reference interne."
                  />
                  <Champ nom="compteBancaire" libelle="Compte bancaire" />
                </div>
                <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
                  Le service refuse tout montant superieur au solde du et enregistre l&apos;ecriture
                  de tresorerie correspondante. Le numero du reglement et celui de l&apos;ecriture
                  sont affiches dans le compte rendu.
                </p>
              </FormulaireAction>
            ) : (
              <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                {estAvoir
                  ? "Un avoir ne se regle pas : il vient en deduction du solde du client."
                  : facture.status === "BROUILLON" || facture.status === "VALIDEE"
                    ? "La facture doit d'abord etre validee et comptabilisee avant tout encaissement."
                    : facture.status === "ANNULEE"
                      ? "Cette facture est annulee."
                      : "Cette facture est deja integralement reglee : aucun encaissement ne peut etre enregistre."}
              </p>
            )}
          </Section>

          <Section titre="Etablir un avoir">
            {peutRecevoirAvoir ? (
              <>
                <div className="mb-3">
                  <Alerte ton="alerte" titre="Avoir : correction de la facture d'origine">
                    L&apos;avoir est une piece distincte, numerotee et comptabilisee. Le motif ecrit
                    est obligatoire : il est transmis au service, qui le revalide. Le cumul des
                    avoirs ne peut pas depasser le montant de la facture.
                  </Alerte>
                </div>
                <FormulaireAction
                  action={actionCreerAvoirClient}
                  libelleSoumettre="Etablir l'avoir"
                  varianteSoumettre="danger"
                >
                  <input type="hidden" name="factureId" value={facture.id} />
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Champ
                      nom="montantHT"
                      libelle={`Montant HT de l'avoir (${facture.currency})`}
                      type="number"
                      requis
                      min={0}
                      pas="0.01"
                      aide={`Reste pouvant faire l'objet d'un avoir : ${formatMontant(resteAvoirPossible, facture.currency)} en TTC.`}
                    />
                    <Champ
                      nom="montantTVA"
                      libelle={`Montant TVA de l'avoir (${facture.currency})`}
                      type="number"
                      min={0}
                      pas="0.01"
                      aide="Laissez vide si l'avoir porte sur un montant hors taxes sans TVA."
                    />
                    <Champ
                      nom="dateAvoir"
                      libelle="Date de l'avoir"
                      type="date"
                      valeur={toInputDate(new Date())}
                    />
                  </div>
                  <div className="mt-4">
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium">
                        Motif de l&apos;avoir<span style={{ color: "var(--danger)" }}> *</span>
                      </span>
                      <textarea
                        className="champ"
                        name="motif"
                        rows={3}
                        required
                        minLength={10}
                        placeholder="Motif obligatoire (au moins 10 caracteres), conserve dans la piece et la trace d'audit"
                      />
                    </label>
                  </div>
                </FormulaireAction>
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                {estAvoir
                  ? "Un avoir ne peut pas faire l'objet d'un nouvel avoir."
                  : "Validez d'abord la facture : un avoir ne peut pas preceder sa facture d'origine."}
              </p>
            )}
          </Section>
        </Carte>
      </div>
    </>
  );
}
