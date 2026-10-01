import Link from "next/link";
import { notFound } from "next/navigation";
import type { QuoteStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  actionChangerStatutDevis,
  actionTransformerDevisEnCommande,
} from "@/actions/vente";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { identifiantOuNull } from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  EtiquetteStatut,
  ListeDefinitions,
  Section,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction, FormulaireMotif } from "@/components/interactif";
import { formatDate, formatMontant, formatPourcentage, formatQuantite, toInputDate } from "@/lib/format";
import { LIBELLES_STATUT_DEVIS, libelle } from "@/lib/libelles";

export const metadata = { title: "Devis client" };

/**
 * Transitions autorisees d'un devis.
 *
 * Cette table reproduit celle du service de vente, qui reste seul juge : elle
 * sert uniquement a ne proposer a l'operateur que des changements de statut
 * reellement admissibles. Toute transition interdite reste refusee par le
 * service, et son message est affiche tel quel.
 */
const TRANSITIONS_DEVIS: Record<QuoteStatus, QuoteStatus[]> = {
  BROUILLON: ["ENVOYE", "ANNULE"],
  ENVOYE: ["ACCEPTE", "REFUSE", "EXPIRE", "ANNULE"],
  ACCEPTE: ["CONVERTI", "ANNULE"],
  REFUSE: [],
  EXPIRE: ["ANNULE"],
  CONVERTI: [],
  ANNULE: [],
};

export default async function PageDevis({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigerPermission(PERMISSIONS.VENTE_LIRE);

  const identifiant = identifiantOuNull((await params).id);
  if (identifiant === null) notFound();

  const devis = await prisma.quote.findUnique({
    where: { id: identifiant },
    include: {
      customer: {
        select: {
          id: true,
          code: true,
          label1: true,
          address1: true,
          city: true,
          deadlineDays: true,
        },
      },
      lines: {
        orderBy: { lineNo: "asc" },
        include: { item: { select: { code: true, label1: true } } },
      },
    },
  });
  if (!devis) notFound();

  const [createur, commandeIssue] = await Promise.all([
    devis.createdById
      ? prisma.user.findUnique({
          where: { id: devis.createdById },
          select: {
            email: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        })
      : null,
    devis.convertedOrderId
      ? prisma.salesOrder.findUnique({
          where: { id: devis.convertedOrderId },
          select: { id: true, number: true, status: true },
        })
      : null,
  ]);

  const transitions = TRANSITIONS_DEVIS[devis.status];
  const transitionsSimples = transitions.filter(
    (statut) => statut !== "REFUSE" && statut !== "ANNULE" && statut !== "CONVERTI",
  );
  const peutEtreRefuse = transitions.includes("REFUSE");
  const peutEtreAnnule = transitions.includes("ANNULE");
  const peutEtreConverti = devis.status === "ACCEPTE";
  const expirePossible =
    devis.validUntil !== null && devis.validUntil.getTime() <= Date.now();

  const adresseClient = [devis.customer.address1, devis.customer.city]
    .filter((element): element is string => Boolean(element))
    .join(", ");

  return (
    <>
      <EnTetePage
        titre={`Devis ${devis.number}`}
        description="Proposition commerciale : lignes chiffrees, totaux calcules par le service, et suite du circuit (envoi, acceptation, transformation en commande)."
        actions={
          <Link className="lien-nav text-sm" href="/ventes/devis">
            Retour a la liste
          </Link>
        }
      />

      <Carte titre="Entete du devis">
        <ListeDefinitions
          elements={[
            {
              terme: "Statut",
              valeur: (
                <EtiquetteStatut
                  code={devis.status}
                  libelle={libelle(LIBELLES_STATUT_DEVIS, devis.status)}
                />
              ),
            },
            { terme: "Numero", valeur: devis.number },
            {
              terme: "Client",
              valeur: (
                <Link className="lien-nav" href={`/ventes/devis?client=${devis.customer.id}`}>
                  {devis.customer.code} — {devis.customer.label1}
                </Link>
              ),
            },
            { terme: "Adresse du client", valeur: adresseClient || "Non renseignee" },
            { terme: "Date d'emission", valeur: formatDate(devis.quoteDate) },
            {
              terme: "Validite",
              valeur: devis.validUntil ? formatDate(devis.validUntil) : "Sans echeance",
            },
            { terme: "Devise", valeur: devis.currency },
            {
              terme: "Remise globale",
              valeur: formatPourcentage(devis.discountRate),
            },
            {
              terme: "Conditions de reglement",
              valeur: `${devis.paymentTermsDays} jour(s)`,
            },
            {
              terme: "Commande issue du devis",
              valeur: commandeIssue ? (
                <Link className="lien-nav" href={`/ventes/commandes/${commandeIssue.id}`}>
                  {commandeIssue.number}
                </Link>
              ) : (
                "Aucune commande issue de ce devis"
              ),
            },
            {
              terme: "Etabli par",
              valeur: createur
                ? createur.employee
                  ? `${createur.employee.firstName} ${createur.employee.lastName}`
                  : createur.email
                : "Non renseigne",
            },
            { terme: "Cree le", valeur: formatDate(devis.createdAt) },
          ]}
        />
        {devis.notes && (
          <p className="mt-4 whitespace-pre-line text-sm">
            <span className="font-medium">Notes : </span>
            {devis.notes}
          </p>
        )}
      </Carte>

      <Section titre="Montants">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Carte titre="Total HT">
            <p className="text-xl font-semibold tabular-nums">
              {formatMontant(devis.subtotalHT, devis.currency)}
            </p>
          </Carte>
          <Carte titre="Remises">
            <p className="text-xl font-semibold tabular-nums">
              {formatMontant(devis.discountAmount, devis.currency)}
            </p>
          </Carte>
          <Carte titre="TVA">
            <p className="text-xl font-semibold tabular-nums">
              {formatMontant(devis.vatAmount, devis.currency)}
            </p>
          </Carte>
          <Carte titre="Total TTC">
            <p className="text-xl font-semibold tabular-nums">
              {formatMontant(devis.totalTTC, devis.currency)}
            </p>
          </Carte>
        </div>
      </Section>

      <Section titre="Lignes du devis">
        <Carte sansPadding>
          <Tableau
            colonnes={[
              { cle: "ligne", libelle: "Ligne", nombre: true },
              { cle: "article", libelle: "Article" },
              { cle: "description", libelle: "Description" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "prix", libelle: "Prix unitaire", nombre: true },
              { cle: "remise", libelle: "Remise", nombre: true },
              { cle: "tva", libelle: "TVA", nombre: true },
              { cle: "ht", libelle: "HT", nombre: true },
              { cle: "ttc", libelle: "TTC", nombre: true },
            ]}
            lignes={devis.lines.map((ligne) => ({
              cle: String(ligne.id),
              cellules: [
                String(ligne.lineNo),
                `${ligne.item.code} — ${ligne.item.label1}`,
                ligne.description ?? "-",
                `${formatQuantite(ligne.quantity)} ${ligne.unitCode ?? ""}`.trim(),
                formatMontant(ligne.unitPrice, devis.currency),
                formatPourcentage(ligne.discountRate),
                `${formatPourcentage(ligne.vatRate)}${ligne.vatRateCode ? ` (${ligne.vatRateCode})` : ""}`,
                formatMontant(ligne.lineHT, devis.currency),
                formatMontant(ligne.lineTTC, devis.currency),
              ],
            }))}
            messageVide="Ce devis ne comporte aucune ligne."
          />
        </Carte>
      </Section>

      {(transitionsSimples.length > 0 || peutEtreRefuse || peutEtreAnnule) && (
        <Section titre="Changement de statut">
          <Carte>
            <div className="space-y-5">
              {transitionsSimples.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Faire avancer le devis</h3>
                  <FormulaireAction
                    action={actionChangerStatutDevis}
                    libelleSoumettre="Appliquer le nouveau statut"
                    varianteSoumettre="primaire"
                  >
                    <Champ nom="devisId" type="hidden" valeur={devis.id} libelle="Devis" />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Champ
                        nom="statut"
                        libelle="Nouveau statut"
                        type="select"
                        requis
                        options={transitionsSimples.map((statut) => ({
                          valeur: statut,
                          libelle: libelle(LIBELLES_STATUT_DEVIS, statut),
                        }))}
                      />
                      <Champ
                        nom="motif"
                        libelle="Commentaire (facultatif)"
                        type="textarea"
                        maxLength={500}
                      />
                    </div>
                  </FormulaireAction>
                  <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                    Seules les transitions autorisees depuis le statut «{" "}
                    {libelle(LIBELLES_STATUT_DEVIS, devis.status)} » sont proposees. Le service
                    revalide chacune d&apos;elles et refuse les autres.
                  </p>
                  {transitionsSimples.includes("EXPIRE") && !expirePossible && (
                    <div className="mt-3">
                      <Alerte ton="alerte" titre="Marquage comme expire impossible">
                        Ce devis est valable jusqu&apos;au {formatDate(devis.validUntil)} : le
                        service refusera de le marquer comme expire avant cette date.
                      </Alerte>
                    </div>
                  )}
                </div>
              )}

              {peutEtreRefuse && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Refuser le devis</h3>
                  <FormulaireMotif
                    action={actionChangerStatutDevis}
                    libelleSoumettre="Refuser le devis"
                    varianteSoumettre="danger"
                    libelleMotif="Motif du refus (obligatoire)"
                    motifMinimum={5}
                    placeholder="Motif du refus, transmis au suivi commercial"
                    champsCaches={{ devisId: devis.id, statut: "REFUSE" }}
                  />
                </div>
              )}

              {peutEtreAnnule && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Annuler le devis</h3>
                  <FormulaireMotif
                    action={actionChangerStatutDevis}
                    libelleSoumettre="Annuler le devis"
                    varianteSoumettre="danger"
                    libelleMotif="Motif de l'annulation (obligatoire)"
                    motifMinimum={5}
                    champsCaches={{ devisId: devis.id, statut: "ANNULE" }}
                  />
                </div>
              )}
            </div>
          </Carte>
        </Section>
      )}

      <Section titre="Transformation en commande client">
        <Carte>
          {peutEtreConverti ? (
            <>
              <Alerte ton="info" titre="Le devis est accepte">
                La transformation recopie les lignes du devis telles quelles. Le devis n&apos;est
                jamais modifie : il passe au statut « converti » et reste la reference
                contractuelle d&apos;origine.
              </Alerte>
              <div className="mt-4">
                <FormulaireAction
                  action={actionTransformerDevisEnCommande}
                  libelleSoumettre="Transformer en commande client"
                  varianteSoumettre="primaire"
                >
                  <input type="hidden" name="devisId" value={devis.id} />
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Champ
                      nom="dateCommande"
                      libelle="Date de la commande"
                      type="date"
                      valeur={toInputDate(new Date())}
                    />
                    <Champ nom="datePrevue" libelle="Date de livraison prevue" type="date" />
                    <Champ nom="referenceClient" libelle="Reference du client" />
                    <Champ
                      nom="adresseLivraison"
                      libelle="Adresse de livraison"
                      valeur={adresseClient}
                    />
                    <Champ nom="notes" libelle="Notes de la commande" type="textarea" maxLength={1000} />
                  </div>
                </FormulaireAction>
              </div>
            </>
          ) : devis.status === "CONVERTI" ? (
            <Alerte ton="succes" titre="Devis deja converti">
              Ce devis a deja donne lieu a la commande client{" "}
              {commandeIssue ? (
                <Link className="lien-nav" href={`/ventes/commandes/${commandeIssue.id}`}>
                  {commandeIssue.number}
                </Link>
              ) : (
                "enregistree"
              )}
              . Un devis converti ne peut plus etre modifie.
            </Alerte>
          ) : (
            <Alerte ton="alerte" titre="Transformation impossible dans cet etat">
              Seul un devis au statut « accepte » peut etre transforme en commande client (statut
              actuel : {libelle(LIBELLES_STATUT_DEVIS, devis.status)}). Le service refuse toute
              autre situation.
            </Alerte>
          )}
        </Carte>
      </Section>
    </>
  );
}
