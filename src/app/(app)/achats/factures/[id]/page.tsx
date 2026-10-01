import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import {
  actionCreerAvoirFournisseur,
  actionReglerFactureFournisseur,
  actionValiderFactureFournisseur,
} from "@/actions/achat";
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
import {
  formatDate,
  formatDateTime,
  formatMontant,
  formatPourcentage,
  formatQuantite,
  toInputDate,
} from "@/lib/format";
import {
  LIBELLES_MODE_REGLEMENT,
  LIBELLES_STATUT_FACTURE,
  LIBELLES_STATUT_RECEPTION,
  LIBELLES_STATUT_REGLEMENT,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Facture fournisseur" };

/**
 * Libelles des ecarts de rapprochement trois voies. Les codes sont ceux du
 * service : ils sont affiches tels quels, jamais reinterpretes.
 */
const LIBELLES_ECART: Record<string, string> = {
  PRIX: "Ecart de prix",
  QUANTITE: "Ecart de quantite",
  SANS_COMMANDE: "Ligne sans commande",
  SANS_RECEPTION: "Ligne sans reception",
};

type TonEcart = "danger" | "alerte" | "neutre";

function tonEcart(type: string): TonEcart {
  if (type === "PRIX") return "alerte";
  if (type === "QUANTITE") return "alerte";
  if (type === "SANS_COMMANDE" || type === "SANS_RECEPTION") return "danger";
  return "neutre";
}

/**
 * Les ecarts sont conserves en clair dans `matchingNotes` par le service, sous
 * la forme « [TYPE] detail ». La fiche se contente de les restituer : aucun
 * ecart n'est recalcule ni corrige a l'affichage.
 */
function ecartsDepuisNotes(notes: string | null): { type: string; detail: string }[] {
  if (!notes) return [];
  return notes
    .split("\n")
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne.startsWith("["))
    .map((ligne) => {
      const correspondance = /^\[([A-Z_]+)\]\s*(.*)$/.exec(ligne);
      return correspondance
        ? { type: correspondance[1], detail: correspondance[2] }
        : { type: "", detail: ligne };
    });
}

export default async function PageFactureFournisseur({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigerPermission(PERMISSIONS.ACHAT_LIRE);

  const identifiant = identifiantOuNull((await params).id);
  if (identifiant === null) notFound();

  const facture = await prisma.supplierInvoice.findUnique({
    where: { id: identifiant },
    include: {
      supplier: { select: { id: true, code: true, label1: true } },
      order: { select: { id: true, number: true } },
      receipt: { select: { id: true, number: true, status: true } },
      lines: { orderBy: { lineNo: "asc" } },
      invoice: { select: { id: true, number: true, status: true, balance: true } },
    },
  });
  if (!facture) notFound();

  // Les lignes de facture fournisseur ne portent pas de relation vers l'article :
  // les references sont resolues explicitement, comme au moment de la saisie.
  const identifiantsArticles = [
    ...new Set(
      facture.lines
        .map((ligne) => ligne.itemId)
        .filter((valeur): valeur is number => valeur !== null),
    ),
  ];
  const identifiantsUtilisateurs = facture.createdById !== null ? [facture.createdById] : [];

  const [articles, createurs, corrections, allocations] = await Promise.all([
    identifiantsArticles.length
      ? prisma.item.findMany({
          where: { id: { in: identifiantsArticles } },
          select: { id: true, code: true, label1: true },
        })
      : Promise.resolve([]),
    identifiantsUtilisateurs.length
      ? prisma.user.findMany({
          where: { id: { in: identifiantsUtilisateurs } },
          select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
        })
      : Promise.resolve([]),
    // Avoirs etablis sur la facture : pieces comptables correctrices rattachees
    // par `originalInvoiceId`, retrouvees par leur numero dans le registre
    // fournisseur.
    facture.invoice
      ? prisma.invoice.findMany({
          where: { originalInvoiceId: facture.invoice.id },
          orderBy: { invoiceDate: "desc" },
          select: { id: true, number: true, invoiceDate: true, totalTTC: true, currency: true },
        })
      : Promise.resolve([]),
    // Reglements : les affectations portent sur la piece comptable de la facture.
    facture.invoice
      ? prisma.paymentAllocation.findMany({
          where: { invoiceId: facture.invoice.id },
          orderBy: { createdAt: "desc" },
          include: {
            payment: {
              select: {
                id: true,
                number: true,
                method: true,
                status: true,
                direction: true,
                paymentDate: true,
                amount: true,
                currency: true,
                reference: true,
                bankAccount: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const avoirs = corrections.length
    ? await prisma.supplierInvoice.findMany({
        where: { number: { in: corrections.map((correction) => correction.number) } },
        orderBy: { invoiceDate: "desc" },
        select: {
          id: true,
          number: true,
          status: true,
          supplierRef: true,
          invoiceDate: true,
          totalTTC: true,
          currency: true,
          matchingNotes: true,
        },
      })
    : [];

  const articleParId = new Map(
    articles.map((article) => [article.id, `${article.code} — ${article.label1}`]),
  );
  const createur = createurs[0]
    ? createurs[0].employee
      ? `${createurs[0].employee.firstName} ${createurs[0].employee.lastName}`
      : createurs[0].email
    : null;

  const ecarts = ecartsDepuisNotes(facture.matchingNotes);
  const resteAPayer = D.sub(D.of(facture.totalTTC), D.of(facture.paidAmount));
  const montantRegle = D.of(facture.paidAmount);

  const peutEtreValidee = facture.status === "BROUILLON";
  const pieceComptabilisee =
    facture.invoice !== null &&
    facture.invoice.status !== "BROUILLON" &&
    facture.invoice.status !== "VALIDEE";
  const peutEtreReglee =
    facture.status !== "BROUILLON" &&
    facture.status !== "ANNULEE" &&
    pieceComptabilisee &&
    D.gt(resteAPayer, 0);
  const peutRecevoirAvoir =
    !facture.isCreditNote && facture.status !== "BROUILLON" && facture.status !== "ANNULEE";

  return (
    <>
      <EnTetePage
        titre={`Facture fournisseur ${facture.number}`}
        description="Reference fournisseur, rapprochement trois voies, avoirs et reglements. Les ecarts constates restent attaches au document : ils ne sont jamais corriges automatiquement."
        actions={
          <Link className="lien-nav text-sm" href="/achats/factures">
            Retour a la liste
          </Link>
        }
      />

      <Carte titre="Entete de la facture">
        <ListeDefinitions
          elements={[
            {
              terme: "Statut",
              valeur: (
                <EtiquetteStatut
                  code={facture.status}
                  libelle={libelle(LIBELLES_STATUT_FACTURE, facture.status)}
                />
              ),
            },
            { terme: "Numero interne", valeur: facture.number },
            {
              terme: "Reference fournisseur",
              valeur: facture.supplierRef ?? "Non renseignee",
            },
            {
              terme: "Nature",
              valeur: facture.isCreditNote ? "Avoir fournisseur" : "Facture fournisseur",
            },
            {
              terme: "Fournisseur",
              valeur: `${facture.supplier.code} — ${facture.supplier.label1}`,
            },
            {
              terme: "Bon de commande",
              valeur: facture.order ? (
                <Link className="lien-nav" href={`/achats/commandes/${facture.order.id}`}>
                  {facture.order.number}
                </Link>
              ) : (
                "Sans bon de commande"
              ),
            },
            {
              terme: "Reception",
              valeur: facture.receipt ? (
                <span>
                  <Link className="lien-nav" href={`/achats/receptions/${facture.receipt.id}`}>
                    {facture.receipt.number}
                  </Link>{" "}
                  ({libelle(LIBELLES_STATUT_RECEPTION, facture.receipt.status)})
                </span>
              ) : (
                "Sans reception"
              ),
            },
            { terme: "Date de la facture", valeur: formatDate(facture.invoiceDate) },
            { terme: "Echeance", valeur: formatDate(facture.dueDate) },
            { terme: "Devise", valeur: facture.currency },
            {
              terme: "Piece comptable",
              valeur: facture.invoice ? (
                <span>
                  {facture.invoice.number} —{" "}
                  {libelle(LIBELLES_STATUT_FACTURE, facture.invoice.status)}
                </span>
              ) : (
                "Piece comptable introuvable"
              ),
            },
            {
              terme: "Comptabilisee le",
              valeur: facture.postedAt ? formatDateTime(facture.postedAt) : "Non comptabilisee",
            },
            { terme: "Saisie par", valeur: createur ?? "Non renseigne" },
            { terme: "Saisie le", valeur: formatDateTime(facture.createdAt) },
          ]}
        />
        {facture.notes && (
          <p className="mt-4 whitespace-pre-line text-sm">
            <span className="font-medium">Observations : </span>
            {facture.notes}
          </p>
        )}
      </Carte>

      <Section titre="Montants">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Carte titre="Total HT">
            <p className="text-lg font-semibold tabular-nums">
              {formatMontant(facture.subtotalHT, facture.currency)}
            </p>
          </Carte>
          <Carte titre="TVA">
            <p className="text-lg font-semibold tabular-nums">
              {formatMontant(facture.vatAmount, facture.currency)}
            </p>
          </Carte>
          <Carte titre="Total TTC">
            <p className="text-lg font-semibold tabular-nums">
              {formatMontant(facture.totalTTC, facture.currency)}
            </p>
          </Carte>
          <Carte titre="Deja regle">
            <p className="text-lg font-semibold tabular-nums">
              {formatMontant(montantRegle, facture.currency)}
            </p>
          </Carte>
          <Carte titre="Reste du">
            <p className="text-lg font-semibold tabular-nums">
              {formatMontant(resteAPayer, facture.currency)}
            </p>
          </Carte>
        </div>
      </Section>

      <Section titre="Lignes de la facture">
        <Carte sansPadding>
          <Tableau
            colonnes={[
              { cle: "ligne", libelle: "Ligne", nombre: true },
              { cle: "article", libelle: "Article" },
              { cle: "description", libelle: "Description" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "prix", libelle: "Prix unitaire", nombre: true },
              { cle: "tva", libelle: "TVA", nombre: true },
              { cle: "ht", libelle: "HT", nombre: true },
              { cle: "ttc", libelle: "TTC", nombre: true },
              { cle: "commande", libelle: "Ligne de commande" },
              { cle: "reception", libelle: "Ligne de reception" },
              { cle: "ecarts", libelle: "Ecarts de la ligne" },
            ]}
            lignes={facture.lines.map((ligne) => ({
              cle: String(ligne.id),
              cellules: [
                String(ligne.lineNo),
                ligne.itemId !== null
                  ? (articleParId.get(ligne.itemId) ?? `Article ${ligne.itemId}`)
                  : "Sans article",
                ligne.description ?? "-",
                formatQuantite(ligne.quantity),
                formatMontant(ligne.unitPrice, facture.currency),
                formatPourcentage(ligne.vatRate),
                formatMontant(ligne.lineHT, facture.currency),
                formatMontant(ligne.lineTTC, facture.currency),
                ligne.orderLineId !== null ? (
                  String(ligne.orderLineId)
                ) : (
                  <Etiquette key="commande" ton="danger">
                    Sans commande
                  </Etiquette>
                ),
                ligne.receiptLineId !== null ? (
                  String(ligne.receiptLineId)
                ) : (
                  <Etiquette key="reception" ton="danger">
                    Sans reception
                  </Etiquette>
                ),
                <span key="ecarts" className="inline-flex flex-wrap items-center gap-1">
                  {D.eq(ligne.priceVariance, 0) ? null : (
                    <Etiquette ton="alerte">
                      Prix : {formatMontant(ligne.priceVariance, facture.currency)}
                    </Etiquette>
                  )}
                  {D.eq(ligne.quantityVariance, 0) ? null : (
                    <Etiquette ton="alerte">
                      Quantite : {formatQuantite(ligne.quantityVariance)}
                    </Etiquette>
                  )}
                  {D.eq(ligne.priceVariance, 0) && D.eq(ligne.quantityVariance, 0) ? "Aucun" : null}
                </span>,
              ],
            }))}
            messageVide="Cette facture ne comporte aucune ligne."
          />
        </Carte>
      </Section>

      <Section titre="Rapprochement trois voies">
        <Carte
          titre={
            facture.threeWayMatched
              ? "Rapprochement conforme"
              : "Ecarts constates entre commande, reception et facture"
          }
          description="Ces ecarts sont ceux enregistres par le service lors de la saisie. Ils ne sont ni recalcules ni corriges a l'affichage."
        >
          {facture.threeWayMatched ? (
            <Alerte ton="succes" titre="Commande, reception et facture concordent">
              Aucun ecart n&apos;a ete constate sur cette facture : elle peut etre comptabilisee
              sans justification complementaire.
            </Alerte>
          ) : (
            <>
              <div className="mb-3">
                <Alerte ton="danger" titre="Justification ecrite obligatoire">
                  Une facture dont le rapprochement n&apos;est pas conforme ne peut pas etre
                  comptabilisee sans justification ecrite (au moins 10 caracteres). Les ecarts
                  restent attaches au document.
                </Alerte>
              </div>
              <Tableau
                colonnes={[
                  { cle: "type", libelle: "Nature de l'ecart" },
                  { cle: "detail", libelle: "Detail constate" },
                ]}
                lignes={ecarts.map((ecart, index) => ({
                  cle: `${ecart.type}-${index}`,
                  cellules: [
                    <Etiquette key="type" ton={tonEcart(ecart.type)}>
                      {ecart.type ? libelle(LIBELLES_ECART, ecart.type) : "Ecart non type"}
                    </Etiquette>,
                    ecart.detail,
                  ],
                }))}
                messageVide="Aucun ecart n'est detaille : la facture est marquee comme non rapprochee."
              />
            </>
          )}
        </Carte>
      </Section>

      <Section titre="Avoirs rattaches">
        <Carte sansPadding>
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Numero" },
              { cle: "reference", libelle: "Reference" },
              { cle: "date", libelle: "Date" },
              { cle: "statut", libelle: "Statut" },
              { cle: "total", libelle: "Total TTC", nombre: true },
              { cle: "motif", libelle: "Motif" },
            ]}
            lignes={avoirs.map((avoir) => ({
              cle: String(avoir.id),
              cellules: [
                <Link key="numero" className="lien-nav" href={`/achats/factures/${avoir.id}`}>
                  {avoir.number}
                </Link>,
                avoir.supplierRef ?? "-",
                formatDate(avoir.invoiceDate),
                <EtiquetteStatut
                  key="statut"
                  code={avoir.status}
                  libelle={libelle(LIBELLES_STATUT_FACTURE, avoir.status)}
                />,
                formatMontant(avoir.totalTTC, avoir.currency),
                avoir.matchingNotes ?? "-",
              ],
            }))}
            messageVide="Aucun avoir n'est rattache a cette facture."
          />
        </Carte>
      </Section>

      <Section titre="Reglements">
        <Carte sansPadding>
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Reglement" },
              { cle: "date", libelle: "Date" },
              { cle: "mode", libelle: "Mode" },
              { cle: "statut", libelle: "Statut" },
              { cle: "reference", libelle: "Reference" },
              { cle: "compte", libelle: "Compte" },
              { cle: "montant", libelle: "Montant affecte", nombre: true },
            ]}
            lignes={allocations.map((allocation) => ({
              cle: String(allocation.id),
              cellules: [
                allocation.payment.number,
                formatDate(allocation.payment.paymentDate),
                libelle(LIBELLES_MODE_REGLEMENT, allocation.payment.method),
                <EtiquetteStatut
                  key="statut"
                  code={allocation.payment.status}
                  libelle={libelle(LIBELLES_STATUT_REGLEMENT, allocation.payment.status)}
                />,
                allocation.payment.reference ?? "-",
                allocation.payment.bankAccount ?? "-",
                formatMontant(allocation.amount, allocation.payment.currency),
              ],
            }))}
            messageVide="Aucun reglement n'a encore ete affecte a cette facture."
          />
        </Carte>
      </Section>

      <Section titre="Actions sur la facture">
        <Carte>
          <div className="space-y-6">
            {peutEtreValidee && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Valider et comptabiliser la facture</h3>
                {!facture.threeWayMatched && (
                  <div className="mb-3">
                    <Alerte ton="alerte" titre="Ecarts de rapprochement">
                      Cette facture presente des ecarts : la justification ecrite ci-dessous est
                      obligatoire (au moins 10 caracteres). Sans elle, le service refuse la
                      comptabilisation et renvoie son propre message.
                    </Alerte>
                  </div>
                )}
                <FormulaireAction
                  action={actionValiderFactureFournisseur}
                  libelleSoumettre="Valider et comptabiliser"
                  varianteSoumettre="primaire"
                >
                  <input type="hidden" name="factureId" value={facture.id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Champ
                      nom="dateEcriture"
                      libelle="Date de l'ecriture comptable"
                      type="date"
                      valeur={toInputDate(new Date())}
                    />
                    <Champ
                      nom="justificationEcart"
                      libelle={
                        facture.threeWayMatched
                          ? "Justification (facultative, rapprochement conforme)"
                          : "Justification des ecarts (obligatoire, au moins 10 caracteres)"
                      }
                      type="textarea"
                      requis={!facture.threeWayMatched}
                      maxLength={1000}
                    />
                  </div>
                </FormulaireAction>
                <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                  La comptabilisation utilise la regle comptable « FACTURE_FOURNISSEUR » : aucun
                  compte n&apos;est saisi ici.
                </p>
              </div>
            )}

            {peutEtreReglee && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Regler la facture</h3>
                <p className="mb-3 text-sm" style={{ color: "var(--texte-doux)" }}>
                  Reste du : {formatMontant(resteAPayer, facture.currency)}. Laissez le montant vide
                  pour solder la facture.
                </p>
                <FormulaireAction
                  action={actionReglerFactureFournisseur}
                  libelleSoumettre="Enregistrer le reglement"
                  varianteSoumettre="secondaire"
                >
                  <input type="hidden" name="factureId" value={facture.id} />
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Champ
                      nom="montant"
                      libelle={`Montant (${facture.currency})`}
                      type="number"
                      min={0}
                      pas="0.01"
                      valeur={D.toFixed(resteAPayer, 2)}
                    />
                    <Champ
                      nom="mode"
                      libelle="Mode de reglement"
                      type="select"
                      requis
                      valeur="VIREMENT"
                      options={Object.entries(LIBELLES_MODE_REGLEMENT).map(([code, texte]) => ({
                        valeur: code,
                        libelle: texte,
                      }))}
                    />
                    <Champ
                      nom="datePaiement"
                      libelle="Date du reglement"
                      type="date"
                      valeur={toInputDate(new Date())}
                    />
                    <Champ nom="reference" libelle="Reference du reglement" maxLength={60} />
                    <Champ nom="compteBancaire" libelle="Compte bancaire" maxLength={60} />
                  </div>
                </FormulaireAction>
                <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                  Un montant superieur au reste du, un mode inconnu ou une facture non comptabilisee
                  sont refuses par le service.
                </p>
              </div>
            )}

            {facture.status !== "BROUILLON" && facture.status !== "ANNULEE" && !pieceComptabilisee && (
              <div>
                <Alerte ton="info" titre="Reglement impossible pour le moment">
                  La piece comptable de cette facture n&apos;est pas encore comptabilisee : validez
                  d&apos;abord la facture, le reglement suivra.
                </Alerte>
              </div>
            )}

            {facture.status !== "BROUILLON" &&
              facture.status !== "ANNULEE" &&
              pieceComptabilisee &&
              !D.gt(resteAPayer, 0) && (
                <div>
                  <Alerte ton="succes" titre="Facture integralement reglee">
                    Aucun solde ne reste du sur cette facture.
                  </Alerte>
                </div>
              )}

            {peutRecevoirAvoir && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Etablir un avoir fournisseur</h3>
                <p className="mb-3 text-sm" style={{ color: "var(--texte-doux)" }}>
                  L&apos;avoir vient en deduction de la facture d&apos;origine. Son cumul est
                  plafonne au montant de cette facture par le service.
                </p>
                <FormulaireAction
                  action={actionCreerAvoirFournisseur}
                  libelleSoumettre="Etablir l'avoir"
                  varianteSoumettre="danger"
                >
                  <input type="hidden" name="factureId" value={facture.id} />
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Champ
                      nom="montantHT"
                      libelle={`Montant HT de l'avoir (${facture.currency})`}
                      type="number"
                      min={0}
                      pas="0.01"
                      requis
                    />
                    <Champ
                      nom="montantTVA"
                      libelle={`Montant TVA de l'avoir (${facture.currency})`}
                      type="number"
                      min={0}
                      pas="0.01"
                    />
                    <Champ nom="dateAvoir" libelle="Date de l'avoir" type="date" valeur={toInputDate(new Date())} />
                  </div>
                  <div className="mt-4">
                    <Champ
                      nom="motif"
                      libelle="Motif de l'avoir (obligatoire, au moins 5 caracteres)"
                      type="textarea"
                      requis
                      maxLength={1000}
                    />
                  </div>
                </FormulaireAction>
              </div>
            )}

            {facture.isCreditNote && (
              <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                Cette piece est un avoir : aucun avoir ne peut etre etabli sur un autre avoir.
              </p>
            )}

            {!peutEtreValidee && !peutEtreReglee && !peutRecevoirAvoir && (
              <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                Cette facture est au statut{" "}
                {libelle(LIBELLES_STATUT_FACTURE, facture.status)} : aucune action n&apos;est
                disponible.
              </p>
            )}
          </div>
        </Carte>
      </Section>
    </>
  );
}
