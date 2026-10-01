import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import {
  actionAnnulerBonLivraison,
  actionExpedierBonLivraison,
  actionFacturerLivraison,
  actionLivrerBonLivraison,
  actionPreparerBonLivraison,
} from "@/actions/vente";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { identifiantOuNull } from "@/lib/liste";
import { lireParametreBooleen, lireParametreTexte, CLE_PARAMETRE } from "@/lib/settings";
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
import { BoutonAction, Champ, FormulaireAction, FormulaireMotif } from "@/components/interactif";
import {
  DEVISE_PAR_DEFAUT,
  formatDate,
  formatMontant,
  formatQuantite,
  toInputDate,
} from "@/lib/format";
import {
  LIBELLES_NATURE_FACTURE,
  LIBELLES_STATUT_FACTURE,
  LIBELLES_STATUT_LIVRAISON,
  LIBELLES_STATUT_STOCK,
  LIBELLES_TYPE_MOUVEMENT,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Bon de livraison" };

export default async function PageBonLivraison({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigerPermission(PERMISSIONS.VENTE_LIRE);

  const identifiant = identifiantOuNull((await params).id);
  if (identifiant === null) notFound();

  const livraison = await prisma.deliveryNote.findUnique({
    where: { id: identifiant },
    include: {
      customer: { select: { id: true, code: true, label1: true } },
      order: { select: { id: true, number: true, status: true, currency: true } },
      warehouse: { select: { id: true, code: true, label: true } },
      preparedBy: { select: { firstName: true, lastName: true } },
      lines: {
        orderBy: { lineNo: "asc" },
        include: {
          item: { select: { code: true, label1: true, isProducible: true } },
          orderLine: { select: { lineNo: true, quantity: true, quantityDelivered: true } },
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
  if (!livraison) notFound();

  // Les ordres de fabrication rattaches a la commande porteuse servent a
  // expliquer, ligne par ligne, pourquoi la liberation qualite autorise ou
  // interdit l'expedition : le service reste seul juge, l'interface ne fait que
  // rendre son motif lisible avant la tentative.
  const ordresDeLaCommande = livraison.orderId
    ? await prisma.workOrder.findMany({
        where: { salesOrderId: livraison.orderId, status: { not: "ANNULE" } },
        select: {
          id: true,
          number: true,
          itemId: true,
          salesOrderLineId: true,
          qualityReleasedAt: true,
          quantityConform: true,
        },
        take: 200,
      })
    : [];

  const [lots, emplacements, mouvements, liberationObligatoire, facturesActives, deviseParametre] =
    await Promise.all([
      prisma.stockLot.findMany({
        where: {
          id: {
            in: livraison.lines
              .map((ligne) => ligne.lotId)
              .filter((valeur): valeur is number => valeur !== null),
          },
        },
        select: { id: true, lotNumber: true, status: true, expirationDate: true },
      }),
      prisma.location.findMany({
        where: {
          id: {
            in: livraison.lines
              .map((ligne) => ligne.locationId)
              .filter((valeur): valeur is number => valeur !== null),
          },
        },
        select: { id: true, code: true, label: true },
      }),
      prisma.stockMovement.findMany({
        where: { documentType: "BON_LIVRAISON", documentId: String(livraison.id) },
        orderBy: { occurredAt: "desc" },
        take: 200,
        include: {
          item: { select: { code: true } },
          lot: { select: { lotNumber: true } },
          location: { select: { code: true } },
          warehouse: { select: { code: true } },
        },
      }),
      lireParametreBooleen(CLE_PARAMETRE.QUALITE_LIBERATION_OBLIGATOIRE, true),
      prisma.invoice.findMany({
        where: { deliveryId: livraison.id, status: { not: "ANNULEE" } },
        select: { id: true, number: true, status: true },
      }),
      lireParametreTexte(CLE_PARAMETRE.DEVISE, DEVISE_PAR_DEFAUT),
    ]);

  // Une livraison ne porte pas de devise propre : la devise de la commande fait
  // foi, a defaut celle de l'application.
  const devise = livraison.order?.currency ?? deviseParametre;

  const lotParId = new Map(lots.map((lot) => [lot.id, lot]));
  const emplacementParId = new Map(emplacements.map((lieu) => [lieu.id, lieu]));

  const lignes = livraison.lines.map((ligne) => {
    const ordres = ordresDeLaCommande.filter(
      (ordre) =>
        ordre.itemId === ligne.itemId &&
        (ligne.orderLineId === null || ordre.salesOrderLineId === ligne.orderLineId),
    );
    return {
      ligne,
      ordres,
      enAttenteDeLiberation: ordres.filter((ordre) => ordre.qualityReleasedAt === null),
    };
  });

  const totalCommande = D.sum(livraison.lines.map((ligne) => D.of(ligne.quantityOrdered)));
  const totalLivre = D.sum(livraison.lines.map((ligne) => D.of(ligne.quantityDelivered)));
  const montantHT = D.sum(
    livraison.lines.map((ligne) => D.mul(D.of(ligne.quantityDelivered), D.of(ligne.unitPrice))),
  );
  const quantiteSortie = D.sum(
    mouvements
      .filter((mouvement) => mouvement.type !== "RETOUR_CLIENT")
      .map((mouvement) => D.of(mouvement.quantity)),
  );
  const coutDeSortie = D.sum(mouvements.map((mouvement) => D.of(mouvement.totalCost)));

  const peutEtrePrepare = livraison.status === "BROUILLON";
  const peutEtreExpedie = livraison.status === "BROUILLON" || livraison.status === "PREPAREE";
  const peutEtreLivre = livraison.status === "EXPEDIEE";
  const peutEtreAnnule = livraison.status !== "ANNULEE" && facturesActives.length === 0;
  const peutEtreFacture =
    (livraison.status === "EXPEDIEE" || livraison.status === "LIVREE") &&
    facturesActives.length === 0;

  const lignesSansOrdre = lignes
    .filter((element) => element.ligne.item.isProducible && element.ordres.length === 0)
    .map((element) => element.ligne.lineNo);
  const ordresNonLiberes = lignes.flatMap((element) =>
    element.enAttenteDeLiberation.map((ordre) => ({ ...ordre, lineNo: element.ligne.lineNo })),
  );

  return (
    <>
      <EnTetePage
        titre={`Bon de livraison ${livraison.number}`}
        description="Preparation, expedition puis confirmation de livraison : la sortie de stock est realisee par le service, lot par lot, et chaque mouvement reste inscrit au grand livre."
        actions={
          <Link className="lien-nav text-sm" href="/ventes/livraisons">
            Retour a la liste
          </Link>
        }
      />

      <div className="space-y-6">
        <Carte titre="Entete du bon de livraison">
          <ListeDefinitions
            elements={[
              {
                terme: "Client",
                valeur: `${livraison.customer.code} — ${livraison.customer.label1}`,
              },
              {
                terme: "Statut",
                valeur: (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <EtiquetteStatut
                      code={livraison.status}
                      libelle={libelle(LIBELLES_STATUT_LIVRAISON, livraison.status)}
                    />
                    {livraison.qualityReleased && (
                      <Etiquette ton="succes">Libere qualite</Etiquette>
                    )}
                    {mouvements.length > 0 && <Etiquette ton="info">Stock mouvemente</Etiquette>}
                  </span>
                ),
              },
              {
                terme: "Commande rattachee",
                valeur: livraison.order ? (
                  <Link className="lien-nav" href={`/ventes/commandes/${livraison.order.id}`}>
                    {livraison.order.number}
                  </Link>
                ) : (
                  "Livraison sans commande rattachee"
                ),
              },
              {
                terme: "Depot de depart",
                valeur: `${livraison.warehouse.code} — ${livraison.warehouse.label}`,
              },
              { terme: "Date de livraison", valeur: formatDate(livraison.deliveryDate) },
              { terme: "Transporteur", valeur: livraison.carrier ?? "Non renseigne" },
              { terme: "Reference client", valeur: livraison.customerRef ?? "Non renseignee" },
              { terme: "Adresse de livraison", valeur: livraison.address ?? "Non renseignee" },
              {
                terme: "Prepare par",
                valeur: livraison.preparedBy
                  ? `${livraison.preparedBy.firstName} ${livraison.preparedBy.lastName}`
                  : "Non renseigne",
              },
            ]}
          />
          {livraison.notes && (
            <p className="mt-4 whitespace-pre-line text-sm" style={{ color: "var(--texte-doux)" }}>
              {livraison.notes}
            </p>
          )}
        </Carte>

        <Carte
          titre="Lignes livrees"
          description="Les quantites affichees sont celles reellement portees par le bon de livraison ; le montant HT est valorise au prix de vente de la ligne de commande."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "ligne", libelle: "Ligne", nombre: true },
              { cle: "article", libelle: "Article" },
              { cle: "commandee", libelle: "Commandee", nombre: true },
              { cle: "livree", libelle: "Livree", nombre: true },
              { cle: "unite", libelle: "Unite" },
              { cle: "prix", libelle: "Prix unitaire", nombre: true },
              { cle: "montant", libelle: "Montant HT", nombre: true },
              { cle: "lot", libelle: "Lot" },
              { cle: "emplacement", libelle: "Emplacement" },
              { cle: "qualite", libelle: "Liberation qualite" },
            ]}
            lignes={lignes.map((element) => {
              const lot =
                element.ligne.lotId !== null ? lotParId.get(element.ligne.lotId) : undefined;
              const emplacement =
                element.ligne.locationId !== null
                  ? emplacementParId.get(element.ligne.locationId)
                  : undefined;
              const quantite = D.of(element.ligne.quantityDelivered);
              const prix = D.of(element.ligne.unitPrice);

              let qualite: string;
              if (!element.ligne.item.isProducible) {
                qualite = "Sans objet : article non produit en interne.";
              } else if (element.ordres.length === 0) {
                qualite =
                  "Aucun ordre de fabrication rattache : l'expedition sera refusee si la liberation qualite est obligatoire.";
              } else if (element.enAttenteDeLiberation.length > 0) {
                qualite = `En attente : ${element.enAttenteDeLiberation
                  .map((ordre) => ordre.number)
                  .join(", ")}`;
              } else {
                qualite = `Liberee (${element.ordres.map((ordre) => ordre.number).join(", ")})`;
              }

              return {
                cle: String(element.ligne.id),
                cellules: [
                  String(element.ligne.lineNo),
                  `${element.ligne.item.code} — ${element.ligne.item.label1}`,
                  formatQuantite(element.ligne.quantityOrdered),
                  formatQuantite(quantite),
                  element.ligne.unitCode ?? "Unite de l'article",
                  formatMontant(prix, devise),
                  formatMontant(D.roundAmount(D.mul(quantite, prix)), devise),
                  lot
                    ? `${lot.lotNumber} (${libelle(LIBELLES_STATUT_STOCK, lot.status)})`
                    : "Non affecte",
                  emplacement ? `${emplacement.code} — ${emplacement.label}` : "Non affecte",
                  <span key="qualite" className="text-xs">
                    {qualite}
                  </span>,
                ],
              };
            })}
            messageVide="Ce bon de livraison ne comporte aucune ligne."
          />
        </Carte>

        <Carte titre="Totaux et valorisation">
          <ListeDefinitions
            elements={[
              { terme: "Quantite commandee", valeur: formatQuantite(totalCommande) },
              { terme: "Quantite livree", valeur: formatQuantite(totalLivre) },
              {
                terme: "Montant HT des lignes livrees",
                valeur: formatMontant(montantHT, devise),
              },
              { terme: "Quantite sortie du stock", valeur: formatQuantite(quantiteSortie) },
              {
                terme: "Cout de sortie valorise",
                valeur: formatMontant(coutDeSortie, devise),
              },
              { terme: "Mouvements enregistres", valeur: String(mouvements.length) },
            ]}
          />
          <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
            Le cout de sortie provient de la valorisation reelle des lots consommes par le service :
            les quantites et les couts affiches sont ceux du grand livre des mouvements, sans aucun
            recalcul d&apos;interface.
          </p>
        </Carte>

        <Carte
          titre="Mouvements de stock generes"
          description="Toute variation de stock passe par le grand livre : une annulation apres expedition ajoute un mouvement de retour client, jamais une suppression."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Numero" },
              { cle: "type", libelle: "Type" },
              { cle: "article", libelle: "Article" },
              { cle: "depot", libelle: "Depot" },
              { cle: "lot", libelle: "Lot" },
              { cle: "emplacement", libelle: "Emplacement" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "coutUnitaire", libelle: "Cout unitaire", nombre: true },
              { cle: "coutTotal", libelle: "Cout total", nombre: true },
              { cle: "statut", libelle: "Statut" },
              { cle: "date", libelle: "Date" },
              { cle: "commentaire", libelle: "Commentaire" },
            ]}
            lignes={mouvements.map((mouvement) => ({
              cle: String(mouvement.id),
              cellules: [
                mouvement.number,
                libelle(LIBELLES_TYPE_MOUVEMENT, mouvement.type),
                mouvement.item.code,
                mouvement.warehouse.code,
                mouvement.lot?.lotNumber ?? "Non affecte",
                mouvement.location?.code ?? "Non affecte",
                formatQuantite(mouvement.quantity),
                formatMontant(mouvement.unitCost, devise),
                formatMontant(mouvement.totalCost, devise),
                libelle(LIBELLES_STATUT_STOCK, mouvement.status),
                formatDate(mouvement.occurredAt),
                mouvement.comment ?? mouvement.reason ?? "",
              ],
            }))}
            messageVide="Aucun mouvement de stock : la marchandise n'est pas encore sortie du depot (bon en brouillon ou prepare)."
          />
        </Carte>

        <Carte titre="Factures rattachees" sansPadding>
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Numero" },
              { cle: "nature", libelle: "Nature" },
              { cle: "statut", libelle: "Statut" },
              { cle: "date", libelle: "Date" },
              { cle: "echeance", libelle: "Echeance" },
              { cle: "ttc", libelle: "Total TTC", nombre: true },
              { cle: "regle", libelle: "Regle", nombre: true },
              { cle: "solde", libelle: "Solde", nombre: true },
            ]}
            lignes={livraison.invoices.map((facture) => ({
              cle: String(facture.id),
              cellules: [
                <Link key="numero" className="lien-nav" href={`/ventes/factures/${facture.id}`}>
                  {facture.number}
                </Link>,
                libelle(LIBELLES_NATURE_FACTURE, facture.nature),
                <EtiquetteStatut
                  key="statut"
                  code={facture.status}
                  libelle={libelle(LIBELLES_STATUT_FACTURE, facture.status)}
                />,
                formatDate(facture.invoiceDate),
                formatDate(facture.dueDate),
                formatMontant(facture.totalTTC, facture.currency),
                formatMontant(facture.paidAmount, facture.currency),
                formatMontant(
                  D.sub(D.of(facture.totalTTC), D.of(facture.paidAmount)),
                  facture.currency,
                ),
              ],
            }))}
            messageVide="Aucune facture n'est rattachee a cette livraison."
          />
        </Carte>

        <Carte
          titre="Circuit du bon de livraison"
          description="Chaque etape est un acte distinct : la preparation n'ecrit rien en stock, seule l'expedition sort reellement la marchandise du depot."
        >
          {liberationObligatoire && (lignesSansOrdre.length > 0 || ordresNonLiberes.length > 0) && (
            <div className="mb-4">
              <Alerte
                ton="alerte"
                titre="Liberation qualite obligatoire : ces lignes bloqueront l'expedition"
              >
                <p>
                  Le parametre d&apos;application rend la liberation qualite obligatoire avant toute
                  expedition d&apos;un article produit en interne. Le service refusera
                  l&apos;expedition et son motif sera affiche tel quel.
                </p>
                {lignesSansOrdre.length > 0 && (
                  <p className="mt-1">
                    Ligne(s) sans ordre de fabrication rattache : {lignesSansOrdre.join(", ")}.
                  </p>
                )}
                {ordresNonLiberes.length > 0 && (
                  <p className="mt-1">
                    Ordre(s) en attente de liberation :{" "}
                    {ordresNonLiberes
                      .map((ordre) => `${ordre.number} (ligne ${ordre.lineNo})`)
                      .join(", ")}
                    .
                  </p>
                )}
              </Alerte>
            </div>
          )}

          {!liberationObligatoire && (
            <div className="mb-4">
              <Alerte ton="info" titre="Liberation qualite non exigee par la configuration">
                Le parametre d&apos;application ne rend pas la liberation qualite obligatoire :
                l&apos;expedition ne sera pas bloquee par ce controle. La marchandise sortira
                toutefois reellement du stock du depot choisi.
              </Alerte>
            </div>
          )}

          <Section titre="Etape 1 — Preparer le bon de livraison">
            {peutEtrePrepare ? (
              <>
                <p className="mb-3 text-sm" style={{ color: "var(--texte-doux)" }}>
                  La preparation marque le bon comme pret a partir. Aucune quantite n&apos;est encore
                  sortie du depot a ce stade.
                </p>
                <BoutonAction
                  action={actionPreparerBonLivraison}
                  libelle="Marquer comme prepare"
                  variante="primaire"
                  champsCaches={{ livraisonId: livraison.id }}
                />
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                Cette etape est deja franchie : le bon est au statut{" "}
                {libelle(LIBELLES_STATUT_LIVRAISON, livraison.status)}.
              </p>
            )}
          </Section>

          <Section titre="Etape 2 — Expedier (sortie de stock reelle)">
            {peutEtreExpedie ? (
              <>
                <p className="mb-3 text-sm" style={{ color: "var(--texte-doux)" }}>
                  L&apos;expedition sort la marchandise des lots du depot de depart, valorise la
                  sortie et met a jour l&apos;avancement de la commande. Le compte rendu affiche le
                  nombre de mouvements enregistres et le cout de sortie.
                </p>
                <BoutonAction
                  action={actionExpedierBonLivraison}
                  libelle="Expedier le bon de livraison"
                  variante="primaire"
                  confirmation="Confirmez-vous l'expedition ? La marchandise sera reellement sortie du stock, lot par lot."
                  champsCaches={
                    livraison.orderId !== null
                      ? { livraisonId: livraison.id, commandeId: livraison.orderId }
                      : { livraisonId: livraison.id }
                  }
                />
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                Statut actuel : {libelle(LIBELLES_STATUT_LIVRAISON, livraison.status)}. L&apos;expedition
                n&apos;est possible qu&apos;au statut brouillon ou prepare.
              </p>
            )}
          </Section>

          <Section titre="Etape 3 — Confirmer la livraison chez le client">
            {peutEtreLivre ? (
              <FormulaireAction
                action={actionLivrerBonLivraison}
                libelleSoumettre="Confirmer la livraison"
                varianteSoumettre="primaire"
              >
                <input type="hidden" name="livraisonId" value={livraison.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Champ
                    nom="dateLivraison"
                    libelle="Date de livraison effective"
                    type="date"
                    valeur={toInputDate(livraison.deliveryDate)}
                  />
                  <Champ
                    nom="commentaire"
                    libelle="Commentaire de livraison"
                    type="textarea"
                    maxLength={1000}
                    aide="Ce commentaire est ajoute aux notes du bon de livraison."
                  />
                </div>
              </FormulaireAction>
            ) : (
              <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                Statut actuel : {libelle(LIBELLES_STATUT_LIVRAISON, livraison.status)}. Le service
                exige une expedition prealable avant toute confirmation de livraison.
              </p>
            )}
          </Section>

          <Section titre="Etablir la facture client">
            {peutEtreFacture ? (
              <FormulaireAction
                action={actionFacturerLivraison}
                libelleSoumettre="Etablir la facture"
                varianteSoumettre="secondaire"
              >
                <input type="hidden" name="livraisonId" value={livraison.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Champ
                    nom="dateFacture"
                    libelle="Date de la facture"
                    type="date"
                    valeur={toInputDate(new Date())}
                  />
                  <Champ nom="notes" libelle="Notes de facture" type="textarea" maxLength={1000} />
                </div>
                <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
                  Le client est relu en base depuis la livraison par le service : il n&apos;est jamais
                  ressaisi dans le formulaire. La facture est creee au statut brouillon et devra etre
                  validee depuis sa fiche.
                </p>
              </FormulaireAction>
            ) : (
              <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                {facturesActives.length > 0
                  ? `Cette livraison est deja facturee (${facturesActives
                      .map((facture) => facture.number)
                      .join(", ")}).`
                  : "La facturation n'est possible qu'apres expedition du bon de livraison."}
              </p>
            )}
          </Section>

          <Section titre="Annuler le bon de livraison">
            {peutEtreAnnule ? (
              <>
                <div className="mb-3">
                  <Alerte ton="alerte" titre="Annulation engageante">
                    Si la marchandise est deja sortie, le service enregistre un mouvement de retour
                    client : la sortie d&apos;origine n&apos;est jamais effacee. Le motif ecrit est
                    conserve dans la trace d&apos;audit.
                  </Alerte>
                </div>
                <FormulaireMotif
                  action={actionAnnulerBonLivraison}
                  libelleSoumettre="Annuler le bon de livraison"
                  libelleMotif="Motif de l'annulation"
                  varianteSoumettre="danger"
                  motifMinimum={10}
                  champsCaches={{ livraisonId: livraison.id }}
                  placeholder="Motif obligatoire (au moins 10 caracteres), conserve dans la trace d'audit"
                />
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                {livraison.status === "ANNULEE"
                  ? "Ce bon de livraison est deja annule."
                  : `Annulation impossible : cette livraison est facturee (${facturesActives
                      .map((facture) => facture.number)
                      .join(", ")}). Etablissez un avoir avant toute annulation.`}
              </p>
            )}
          </Section>
        </Carte>
      </div>
    </>
  );
}
