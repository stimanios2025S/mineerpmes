import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { actionAnnulerCommandeClient, actionConfirmerCommandeClient } from "@/actions/vente";
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
  LIBELLES_NATURE_FACTURE,
  LIBELLES_STATUT_COMMANDE_CLIENT,
  LIBELLES_STATUT_DEVIS,
  LIBELLES_STATUT_FACTURE,
  LIBELLES_STATUT_LIVRAISON,
  LIBELLES_STATUT_ORDRE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Commande client" };

export default async function PageCommandeClient({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigerPermission(PERMISSIONS.VENTE_LIRE);

  const identifiant = identifiantOuNull((await params).id);
  if (identifiant === null) notFound();

  const commande = await prisma.salesOrder.findUnique({
    where: { id: identifiant },
    include: {
      customer: { select: { id: true, code: true, label1: true } },
      lines: {
        orderBy: { lineNo: "asc" },
        include: { item: { select: { code: true, label1: true, isProducible: true } } },
      },
      workOrders: {
        orderBy: { createdAt: "desc" },
        include: {
          item: { select: { code: true, label1: true } },
          responsible: { select: { firstName: true, lastName: true } },
        },
      },
      deliveryNotes: {
        orderBy: { deliveryDate: "desc" },
        select: {
          id: true,
          number: true,
          status: true,
          deliveryDate: true,
          warehouse: { select: { code: true, label: true } },
          _count: { select: { invoices: true } },
        },
      },
      invoices: {
        orderBy: { invoiceDate: "desc" },
        select: {
          id: true,
          number: true,
          nature: true,
          status: true,
          invoiceDate: true,
          dueDate: true,
          currency: true,
          totalTTC: true,
          paidAmount: true,
        },
      },
    },
  });
  if (!commande) notFound();

  const [devisOrigine, createur, depots, employes] = await Promise.all([
    commande.quoteId
      ? prisma.quote.findUnique({
          where: { id: commande.quoteId },
          select: { id: true, number: true, status: true },
        })
      : null,
    commande.createdById
      ? prisma.user.findUnique({
          where: { id: commande.createdById },
          select: {
            email: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        })
      : null,
    prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      take: 100,
      select: { id: true, code: true, label: true, factory: true },
    }),
    prisma.employee.findMany({
      where: { isActive: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 300,
      select: { id: true, matricule: true, firstName: true, lastName: true },
    }),
  ]);

  const quantiteCommandee = D.sum(commande.lines.map((ligne) => ligne.quantity));
  const quantiteProduite = D.sum(commande.lines.map((ligne) => ligne.quantityProduced));
  const quantiteLivree = D.sum(commande.lines.map((ligne) => ligne.quantityDelivered));
  const quantiteFacturee = D.sum(commande.lines.map((ligne) => ligne.quantityInvoiced));

  const lignesAvecOrdreAutomatique = commande.lines.filter(
    (ligne) => ligne.autoCreateWorkOrder,
  ).length;

  const peutEtreConfirmee = commande.status === "BROUILLON";
  const peutEtreAnnulee = commande.status !== "ANNULEE" && commande.status !== "CLOTUREE";

  const bonsDeLivraisonActifs = commande.deliveryNotes.filter(
    (livraison) => livraison.status !== "ANNULEE",
  );
  const facturesActives = commande.invoices.filter((facture) => facture.status !== "ANNULEE");
  const ordresActifs = commande.workOrders.filter(
    (ordre) => ordre.status !== "ANNULE" && ordre.status !== "CLOTURE",
  );

  return (
    <>
      <EnTetePage
        titre={`Commande client ${commande.number}`}
        description="Suivi quantite par quantite : production, livraison, facturation, ordres de fabrication et pieces rattachees."
        actions={
          <Link className="lien-nav text-sm" href="/ventes/commandes">
            Retour a la liste
          </Link>
        }
      />

      <Carte titre="Entete de la commande">
        <ListeDefinitions
          elements={[
            {
              terme: "Statut",
              valeur: (
                <EtiquetteStatut
                  code={commande.status}
                  libelle={libelle(LIBELLES_STATUT_COMMANDE_CLIENT, commande.status)}
                />
              ),
            },
            { terme: "Numero", valeur: commande.number },
            {
              terme: "Client",
              valeur: (
                <Link className="lien-nav" href={`/ventes/commandes?client=${commande.customer.id}`}>
                  {commande.customer.code} — {commande.customer.label1}
                </Link>
              ),
            },
            {
              terme: "Devis d'origine",
              valeur: devisOrigine ? (
                <Link className="lien-nav" href={`/ventes/devis/${devisOrigine.id}`}>
                  {devisOrigine.number} ({libelle(LIBELLES_STATUT_DEVIS, devisOrigine.status)})
                </Link>
              ) : (
                "Sans devis d'origine"
              ),
            },
            { terme: "Date de la commande", valeur: formatDate(commande.orderDate) },
            { terme: "Date de livraison prevue", valeur: formatDate(commande.expectedDate) },
            {
              terme: "Confirmee le",
              valeur: commande.confirmedAt ? formatDate(commande.confirmedAt) : "Non confirmee",
            },
            { terme: "Devise", valeur: commande.currency },
            { terme: "Conditions de reglement", valeur: `${commande.paymentTermsDays} jour(s)` },
            { terme: "Adresse de livraison", valeur: commande.deliveryAddress ?? "Non precisee" },
            { terme: "Reference du client", valeur: commande.customerRef ?? "Non renseignee" },
            {
              terme: "Etablie par",
              valeur: createur
                ? createur.employee
                  ? `${createur.employee.firstName} ${createur.employee.lastName}`
                  : createur.email
                : "Non renseigne",
            },
          ]}
        />
        {commande.notes && (
          <p className="mt-4 whitespace-pre-line text-sm">
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
          <Carte titre="Remises">
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

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Carte titre="Quantites produites">
            <p className="text-lg font-semibold tabular-nums">
              {formatQuantite(quantiteProduite)} / {formatQuantite(quantiteCommandee)} (
              {formatPourcentage(D.percent(quantiteProduite, quantiteCommandee), 0)})
            </p>
          </Carte>
          <Carte titre="Quantites livrees">
            <p className="text-lg font-semibold tabular-nums">
              {formatQuantite(quantiteLivree)} / {formatQuantite(quantiteCommandee)} (
              {formatPourcentage(D.percent(quantiteLivree, quantiteCommandee), 0)})
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--texte-doux)" }}>
              Reste a livrer : {formatQuantite(D.sub(quantiteCommandee, quantiteLivree))}
            </p>
          </Carte>
          <Carte titre="Quantites facturees">
            <p className="text-lg font-semibold tabular-nums">
              {formatQuantite(quantiteFacturee)} / {formatQuantite(quantiteCommandee)} (
              {formatPourcentage(D.percent(quantiteFacturee, quantiteCommandee), 0)})
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--texte-doux)" }}>
              Reste a facturer : {formatQuantite(D.sub(quantiteCommandee, quantiteFacturee))}
            </p>
          </Carte>
          <Carte titre="Documents rattaches">
            <p className="text-lg font-semibold">
              {commande.workOrders.length} ordre(s) de fabrication
            </p>
            <p className="text-lg font-semibold">
              {commande.deliveryNotes.length} bon(s) de livraison
            </p>
            <p className="text-lg font-semibold">{commande.invoices.length} facture(s)</p>
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
              { cle: "produite", libelle: "Produite", nombre: true },
              { cle: "livree", libelle: "Livree", nombre: true },
              { cle: "facturee", libelle: "Facturee", nombre: true },
              { cle: "prix", libelle: "Prix unitaire", nombre: true },
              { cle: "remise", libelle: "Remise", nombre: true },
              { cle: "tva", libelle: "TVA", nombre: true },
              { cle: "ttc", libelle: "TTC", nombre: true },
              { cle: "livraison", libelle: "Livraison prevue" },
              { cle: "ordre", libelle: "Ordre de fabrication" },
            ]}
            lignes={commande.lines.map((ligne) => ({
              cle: String(ligne.id),
              cellules: [
                String(ligne.lineNo),
                `${ligne.item.code} — ${ligne.item.label1}`,
                ligne.description ?? "-",
                `${formatQuantite(ligne.quantity)} ${ligne.unitCode ?? ""}`.trim(),
                formatQuantite(ligne.quantityProduced),
                formatQuantite(ligne.quantityDelivered),
                formatQuantite(ligne.quantityInvoiced),
                formatMontant(ligne.unitPrice, commande.currency),
                formatPourcentage(ligne.discountRate),
                `${formatPourcentage(ligne.vatRate)}${ligne.vatRateCode ? ` (${ligne.vatRateCode})` : ""}`,
                formatMontant(ligne.lineTTC, commande.currency),
                formatDate(ligne.deliveryDate),
                ligne.autoCreateWorkOrder
                  ? "A generer a la confirmation"
                  : "Aucun ordre automatique",
              ],
            }))}
            messageVide="Cette commande ne comporte aucune ligne."
          />
        </Carte>
      </Section>

      <Section titre="Ordres de fabrication generes">
        <Carte sansPadding>
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Numero" },
              { cle: "article", libelle: "Article" },
              { cle: "statut", libelle: "Statut" },
              { cle: "prevue", libelle: "Quantite prevue", nombre: true },
              { cle: "produite", libelle: "Quantite produite", nombre: true },
              { cle: "conforme", libelle: "Quantite conforme", nombre: true },
              { cle: "qualite", libelle: "Liberation qualite" },
              { cle: "echeance", libelle: "Echeance" },
              { cle: "responsable", libelle: "Responsable" },
            ]}
            lignes={commande.workOrders.map((ordre) => ({
              cle: String(ordre.id),
              cellules: [
                <Link key="numero" className="lien-nav" href={`/production/${ordre.id}`}>
                  {ordre.number}
                </Link>,
                `${ordre.item.code} — ${ordre.item.label1}`,
                <EtiquetteStatut
                  key="statut"
                  code={ordre.status}
                  libelle={libelle(LIBELLES_STATUT_ORDRE, ordre.status)}
                />,
                formatQuantite(ordre.quantityPlanned),
                formatQuantite(ordre.quantityProduced),
                formatQuantite(ordre.quantityConform),
                ordre.qualityReleasedAt ? (
                  <Etiquette key="qualite" ton="succes">
                    Libere le {formatDate(ordre.qualityReleasedAt)}
                  </Etiquette>
                ) : (
                  <Etiquette key="qualite" ton="alerte">
                    En attente de liberation
                  </Etiquette>
                ),
                formatDate(ordre.dueDate),
                ordre.responsible
                  ? `${ordre.responsible.firstName} ${ordre.responsible.lastName}`
                  : "Non designe",
              ],
            }))}
            messageVide="Aucun ordre de fabrication n'est rattache a cette commande."
          />
        </Carte>
      </Section>

      <Section titre="Bons de livraison rattaches">
        <Carte sansPadding>
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Numero" },
              { cle: "date", libelle: "Date de livraison" },
              { cle: "statut", libelle: "Statut" },
              { cle: "depot", libelle: "Depot" },
              { cle: "invoices", libelle: "Factures", nombre: true },
            ]}
            lignes={commande.deliveryNotes.map((livraison) => ({
              cle: String(livraison.id),
              cellules: [
                <Link key="numero" className="lien-nav" href={`/ventes/livraisons/${livraison.id}`}>
                  {livraison.number}
                </Link>,
                formatDate(livraison.deliveryDate),
                <EtiquetteStatut
                  key="statut"
                  code={livraison.status}
                  libelle={libelle(LIBELLES_STATUT_LIVRAISON, livraison.status)}
                />,
                `${livraison.warehouse.code} — ${livraison.warehouse.label}`,
                String(livraison._count.invoices),
              ],
            }))}
            messageVide="Aucun bon de livraison n'est rattache a cette commande."
          />
        </Carte>
      </Section>

      <Section titre="Factures rattachees">
        <Carte sansPadding>
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Numero" },
              { cle: "nature", libelle: "Nature" },
              { cle: "date", libelle: "Date" },
              { cle: "echeance", libelle: "Echeance" },
              { cle: "statut", libelle: "Statut" },
              { cle: "ttc", libelle: "Total TTC", nombre: true },
              { cle: "regle", libelle: "Regle", nombre: true },
              { cle: "solde", libelle: "Solde", nombre: true },
            ]}
            lignes={commande.invoices.map((facture) => ({
              cle: String(facture.id),
              cellules: [
                <Link key="numero" className="lien-nav" href={`/ventes/factures/${facture.id}`}>
                  {facture.number}
                </Link>,
                libelle(LIBELLES_NATURE_FACTURE, facture.nature),
                formatDate(facture.invoiceDate),
                formatDate(facture.dueDate),
                <EtiquetteStatut
                  key="statut"
                  code={facture.status}
                  libelle={libelle(LIBELLES_STATUT_FACTURE, facture.status)}
                />,
                formatMontant(facture.totalTTC, facture.currency),
                formatMontant(facture.paidAmount, facture.currency),
                formatMontant(
                  D.sub(D.of(facture.totalTTC), D.of(facture.paidAmount)),
                  facture.currency,
                ),
              ],
            }))}
            messageVide="Aucune facture n'est rattachee a cette commande."
          />
        </Carte>
      </Section>

      {(peutEtreConfirmee || peutEtreAnnulee) && (
        <Section titre="Actions sur la commande">
          <Carte>
            <div className="space-y-5">
              {peutEtreConfirmee && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Confirmer la commande</h3>
                  <Alerte ton="info" titre="Ce que fait la confirmation">
                    La confirmation enregistre l&apos;engagement client, puis genere un ordre de
                    fabrication pour chacune des {lignesAvecOrdreAutomatique} ligne(s) configuree(s)
                    a cet effet. Le compte rendu detaille les ordres crees et, ligne par ligne, les
                    echecs eventuels : aucun echec n&apos;est masque.
                  </Alerte>
                  <div className="mt-4">
                    <FormulaireAction
                      action={actionConfirmerCommandeClient}
                      libelleSoumettre="Confirmer la commande"
                      varianteSoumettre="primaire"
                    >
                      <input type="hidden" name="commandeId" value={commande.id} />
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <Champ
                          nom="depotSource"
                          libelle="Depot source des composants"
                          type="select"
                          aide="Utilise par les ordres de fabrication generes."
                          options={depots.map((depot) => ({
                            valeur: depot.id,
                            libelle: `${depot.code} — ${depot.label}`,
                          }))}
                        />
                        <Champ
                          nom="depotCible"
                          libelle="Depot cible des produits finis"
                          type="select"
                          options={depots.map((depot) => ({
                            valeur: depot.id,
                            libelle: `${depot.code} — ${depot.label}`,
                          }))}
                        />
                        <Champ
                          nom="responsableId"
                          libelle="Responsable de production"
                          type="select"
                          options={employes.map((employe) => ({
                            valeur: employe.id,
                            libelle: `${employe.matricule} — ${employe.firstName} ${employe.lastName}`,
                          }))}
                        />
                        <Champ
                          nom="motifException"
                          libelle="Commentaire de confirmation (facultatif)"
                          type="textarea"
                          maxLength={500}
                        />
                      </div>
                    </FormulaireAction>
                  </div>
                  {lignesAvecOrdreAutomatique === 0 && (
                    <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                      Aucune ligne de cette commande ne demande de generation automatique
                      d&apos;ordre de fabrication : la confirmation sera enregistree sans ordre.
                    </p>
                  )}
                </div>
              )}

              {peutEtreAnnulee && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Annuler la commande</h3>
                  {(bonsDeLivraisonActifs.length > 0 ||
                    facturesActives.length > 0 ||
                    ordresActifs.length > 0) && (
                    <div className="mb-3">
                      <Alerte ton="alerte" titre="Annulation probablement refusee par le service">
                        {bonsDeLivraisonActifs.length > 0 && (
                          <p>
                            Livraisons deja enregistrees :{" "}
                            {bonsDeLivraisonActifs.map((livraison) => livraison.number).join(", ")}.
                          </p>
                        )}
                        {facturesActives.length > 0 && (
                          <p>
                            Factures deja etablies :{" "}
                            {facturesActives.map((facture) => facture.number).join(", ")} — un avoir
                            est necessaire avant toute annulation.
                          </p>
                        )}
                        {ordresActifs.length > 0 && (
                          <p>
                            Ordres de fabrication actifs :{" "}
                            {ordresActifs.map((ordre) => ordre.number).join(", ")} — ils doivent
                            etre annules d&apos;abord.
                          </p>
                        )}
                        <p className="mt-1">
                          Le service revalide ces conditions et renverra son motif exact.
                        </p>
                      </Alerte>
                    </div>
                  )}
                  <FormulaireMotif
                    action={actionAnnulerCommandeClient}
                    libelleSoumettre="Annuler la commande"
                    varianteSoumettre="danger"
                    libelleMotif="Motif de l'annulation (obligatoire)"
                    motifMinimum={5}
                    placeholder="Motif de l'annulation, conserve dans les notes de la commande"
                    champsCaches={{ commandeId: commande.id }}
                  />
                </div>
              )}
            </div>
          </Carte>
        </Section>
      )}

      {!peutEtreConfirmee && !peutEtreAnnulee && (
        <Section titre="Actions sur la commande">
          <Carte>
            <Etiquette ton="neutre">
              Commande au statut {libelle(LIBELLES_STATUT_COMMANDE_CLIENT, commande.status)} :
              confirmee le {formatDate(commande.confirmedAt)}. Elle ne peut plus etre confirmee ni
              annulee.
            </Etiquette>
          </Carte>
        </Section>
      )}

    </>
  );
}
