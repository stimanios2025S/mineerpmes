import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { actionAnnulerCommandeFournisseur, actionApprouverCommandeFournisseur } from "@/actions/achat";
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
import { Champ, FormulaireAction, FormulaireMotif } from "@/components/interactif";
import { formatDate, formatMontant, formatPourcentage, formatQuantite } from "@/lib/format";
import {
  LIBELLES_STATUT_COMMANDE_FOURNISSEUR,
  LIBELLES_STATUT_DEMANDE_ACHAT,
  LIBELLES_STATUT_FACTURE,
  LIBELLES_STATUT_RECEPTION,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Bon de commande fournisseur" };

export default async function PageCommandeFournisseur({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigerPermission(PERMISSIONS.ACHAT_LIRE);

  const identifiant = identifiantOuNull((await params).id);
  if (identifiant === null) notFound();

  const commande = await prisma.purchaseOrder.findUnique({
    where: { id: identifiant },
    include: {
      supplier: { select: { id: true, code: true, label1: true } },
      request: { select: { id: true, number: true, status: true } },
      lines: {
        orderBy: { lineNo: "asc" },
        include: { item: { select: { code: true, label1: true } } },
      },
      receipts: {
        orderBy: { receiptDate: "desc" },
        include: { warehouse: { select: { code: true, label: true } } },
      },
      invoices: { orderBy: { invoiceDate: "desc" } },
    },
  });
  if (!commande) notFound();

  const identifiants = [commande.createdById, commande.approvedById].filter(
    (valeur): valeur is number => valeur !== null,
  );
  const utilisateurs = identifiants.length
    ? await prisma.user.findMany({
        where: { id: { in: identifiants } },
        select: {
          id: true,
          email: true,
          employee: { select: { firstName: true, lastName: true } },
        },
      })
    : [];
  const nomUtilisateur = new Map(
    utilisateurs.map((utilisateur) => [
      utilisateur.id,
      utilisateur.employee
        ? `${utilisateur.employee.firstName} ${utilisateur.employee.lastName}`
        : utilisateur.email,
    ]),
  );

  const quantiteCommandee = D.sum(commande.lines.map((ligne) => ligne.quantity));
  const quantiteRecue = D.sum(commande.lines.map((ligne) => ligne.quantityReceived));
  const quantiteFacturee = D.sum(commande.lines.map((ligne) => ligne.quantityInvoiced));
  const resteARecevoir = D.sub(quantiteCommandee, quantiteRecue);

  const peutEtreApprouvee = commande.status === "BROUILLON" || commande.status === "SOUMIS";
  const peutEtreAnnulee = commande.status !== "ANNULE" && commande.status !== "CLOTURE";

  return (
    <>
      <EnTetePage
        titre={`Bon de commande ${commande.number}`}
        description="Engagement fournisseur : quantites commandees, recues et facturees, receptions et factures rattachees."
        actions={
          <Link className="lien-nav text-sm" href="/achats/commandes">
            Retour a la liste
          </Link>
        }
      />

      <Carte titre="Entete du bon de commande">
        <ListeDefinitions
          elements={[
            {
              terme: "Statut",
              valeur: (
                <EtiquetteStatut
                  code={commande.status}
                  libelle={libelle(LIBELLES_STATUT_COMMANDE_FOURNISSEUR, commande.status)}
                />
              ),
            },
            { terme: "Numero", valeur: commande.number },
            {
              terme: "Fournisseur",
              valeur: `${commande.supplier.code} — ${commande.supplier.label1}`,
            },
            {
              terme: "Demande d'origine",
              valeur: commande.request ? (
                <Link className="lien-nav" href={`/achats/demandes/${commande.request.id}`}>
                  {commande.request.number} (
                  {libelle(LIBELLES_STATUT_DEMANDE_ACHAT, commande.request.status)})
                </Link>
              ) : (
                "Sans demande d'achat"
              ),
            },
            { terme: "Date de commande", valeur: formatDate(commande.orderDate) },
            { terme: "Date prevue", valeur: formatDate(commande.expectedDate) },
            { terme: "Devise", valeur: commande.currency },
            {
              terme: "Conditions de reglement",
              valeur: `${commande.paymentTermsDays} jour(s)`,
            },
            {
              terme: "Adresse de livraison",
              valeur: commande.deliveryAddress ?? "Non precisee",
            },
            {
              terme: "Cree par",
              valeur: commande.createdById
                ? (nomUtilisateur.get(commande.createdById) ?? "Utilisateur inconnu")
                : "Non renseigne",
            },
            {
              terme: "Approuve par",
              valeur: commande.approvedById
                ? `${nomUtilisateur.get(commande.approvedById) ?? "Utilisateur inconnu"} le ${formatDate(
                    commande.approvedAt,
                  )}`
                : "En attente d'approbation",
            },
            { terme: "Cree le", valeur: formatDate(commande.createdAt) },
          ]}
        />
        {commande.notes && (
          <p className="mt-4 text-sm">
            <span className="font-medium">Notes : </span>
            {commande.notes}
          </p>
        )}
      </Carte>

      <Section titre="Montants et avancement">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Carte titre="Total HT">
            <p className="text-xl font-semibold tabular-nums">
              {formatMontant(commande.subtotalHT, commande.currency)}
            </p>
          </Carte>
          <Carte titre="Remise">
            <p className="text-xl font-semibold tabular-nums">
              {formatMontant(commande.discountAmount, commande.currency)}
            </p>
          </Carte>
          <Carte titre="TVA">
            <p className="text-xl font-semibold tabular-nums">
              {formatMontant(commande.vatAmount, commande.currency)}
            </p>
          </Carte>
          <Carte titre="Total TTC">
            <p className="text-xl font-semibold tabular-nums">
              {formatMontant(commande.totalTTC, commande.currency)}
            </p>
          </Carte>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Carte titre="Quantites recues">
            <p className="text-lg font-semibold">
              {formatQuantite(quantiteRecue)} / {formatQuantite(quantiteCommandee)} (
              {formatPourcentage(D.percent(quantiteRecue, quantiteCommandee), 0)})
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--texte-doux)" }}>
              Reste a recevoir : {formatQuantite(resteARecevoir)}
            </p>
          </Carte>
          <Carte titre="Quantites facturees">
            <p className="text-lg font-semibold">
              {formatQuantite(quantiteFacturee)} / {formatQuantite(quantiteCommandee)} (
              {formatPourcentage(D.percent(quantiteFacturee, quantiteCommandee), 0)})
            </p>
          </Carte>
          <Carte titre="Documents rattaches">
            <p className="text-lg font-semibold">
              {commande.receipts.length} reception(s), {commande.invoices.length} facture(s)
            </p>
          </Carte>
        </div>
      </Section>

      <Section titre="Lignes de commande">
        <Carte sansPadding>
          <Tableau
            colonnes={[
              { cle: "ligne", libelle: "Ligne", nombre: true },
              { cle: "article", libelle: "Article" },
              { cle: "description", libelle: "Description" },
              { cle: "commandee", libelle: "Commandee", nombre: true },
              { cle: "recue", libelle: "Recue", nombre: true },
              { cle: "facturee", libelle: "Facturee", nombre: true },
              { cle: "prix", libelle: "Prix unitaire", nombre: true },
              { cle: "remise", libelle: "Remise", nombre: true },
              { cle: "tva", libelle: "TVA", nombre: true },
              { cle: "ht", libelle: "HT", nombre: true },
              { cle: "ttc", libelle: "TTC", nombre: true },
              { cle: "prevu", libelle: "Prevu le" },
            ]}
            lignes={commande.lines.map((ligne) => ({
              cle: String(ligne.id),
              cellules: [
                String(ligne.lineNo),
                `${ligne.item.code} — ${ligne.item.label1}`,
                ligne.description ?? "-",
                `${formatQuantite(ligne.quantity)} ${ligne.unitCode ?? ""}`.trim(),
                `${formatQuantite(ligne.quantityReceived)} ${ligne.unitCode ?? ""}`.trim(),
                `${formatQuantite(ligne.quantityInvoiced)} ${ligne.unitCode ?? ""}`.trim(),
                formatMontant(ligne.unitPrice, commande.currency),
                formatPourcentage(ligne.discountRate),
                `${formatPourcentage(ligne.vatRate)}${ligne.vatRateCode ? ` (${ligne.vatRateCode})` : ""}`,
                formatMontant(ligne.lineHT, commande.currency),
                formatMontant(ligne.lineTTC, commande.currency),
                formatDate(ligne.expectedDate),
              ],
            }))}
            messageVide="Ce bon de commande ne comporte aucune ligne."
          />
        </Carte>
      </Section>

      <Section titre="Receptions rattachees">
        <Carte sansPadding>
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Numero" },
              { cle: "date", libelle: "Date" },
              { cle: "statut", libelle: "Statut" },
              { cle: "qualite", libelle: "Controle qualite" },
              { cle: "depot", libelle: "Depot" },
              { cle: "bl", libelle: "Bon de livraison fournisseur" },
            ]}
            lignes={commande.receipts.map((reception) => ({
              cle: String(reception.id),
              cellules: [
                <Link key="numero" className="lien-nav" href={`/achats/receptions/${reception.id}`}>
                  {reception.number}
                </Link>,
                formatDate(reception.receiptDate),
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
                  "Sans controle"
                ),
                `${reception.warehouse.code} — ${reception.warehouse.label}`,
                reception.deliveryNoteNumber ?? "-",
              ],
            }))}
            messageVide="Aucune reception n'est rattachee a ce bon de commande."
          />
        </Carte>
      </Section>

      <Section titre="Factures rattachees">
        <Carte sansPadding>
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Numero" },
              { cle: "reference", libelle: "Reference fournisseur" },
              { cle: "date", libelle: "Date" },
              { cle: "statut", libelle: "Statut" },
              { cle: "rapprochement", libelle: "Rapprochement trois voies" },
              { cle: "ttc", libelle: "Total TTC", nombre: true },
              { cle: "regle", libelle: "Regle", nombre: true },
            ]}
            lignes={commande.invoices.map((facture) => ({
              cle: String(facture.id),
              cellules: [
                <Link key="numero" className="lien-nav" href={`/achats/factures/${facture.id}`}>
                  {facture.number}
                  {facture.isCreditNote ? " (avoir)" : ""}
                </Link>,
                facture.supplierRef ?? "-",
                formatDate(facture.invoiceDate),
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
              ],
            }))}
            messageVide="Aucune facture fournisseur n'est rattachee a ce bon de commande."
          />
        </Carte>
      </Section>

      {(peutEtreApprouvee || peutEtreAnnulee) && (
        <Section titre="Actions sur le bon de commande">
          <Carte>
            <div className="space-y-5">
              {peutEtreApprouvee && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Approuver le bon de commande</h3>
                  <FormulaireAction
                    action={actionApprouverCommandeFournisseur}
                    libelleSoumettre="Approuver"
                    varianteSoumettre="primaire"
                  >
                    <Champ nom="commandeId" type="hidden" valeur={commande.id} libelle="Commande" />
                    <Champ
                      nom="commentaire"
                      libelle="Commentaire d'approbation (facultatif)"
                      type="textarea"
                      maxLength={500}
                    />
                  </FormulaireAction>
                  <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                    Un bon de commande sans ligne, ou cree par vous-meme, est refuse par le service :
                    son message s&apos;affichera tel quel.
                  </p>
                </div>
              )}

              {peutEtreAnnulee && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Annuler le bon de commande</h3>
                  {commande.receipts.length > 0 && (
                    <div className="mb-3">
                      <Alerte ton="alerte" titre="Receptions deja enregistrees">
                        Ce bon de commande a fait l&apos;objet de receptions : le service refuse
                        l&apos;annulation et renverra le motif exact a traiter (retour fournisseur
                        pour les marchandises concernees).
                      </Alerte>
                    </div>
                  )}
                  <FormulaireMotif
                    action={actionAnnulerCommandeFournisseur}
                    libelleSoumettre="Annuler le bon de commande"
                    varianteSoumettre="danger"
                    libelleMotif="Motif de l'annulation (obligatoire)"
                    motifMinimum={5}
                    champsCaches={{ commandeId: commande.id }}
                  />
                </div>
              )}
            </div>
          </Carte>
        </Section>
      )}
    </>
  );
}
