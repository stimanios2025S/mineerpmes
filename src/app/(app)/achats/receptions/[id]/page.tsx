import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { actionAnnulerReception, actionRetourFournisseur } from "@/actions/achat";
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
import { formatDate, formatDateTime, formatMontant, formatQuantite } from "@/lib/format";
import {
  LIBELLES_DECISION_QUALITE,
  LIBELLES_RESULTAT_CONTROLE,
  LIBELLES_STATUT_FACTURE,
  LIBELLES_STATUT_RECEPTION,
  LIBELLES_STATUT_STOCK,
  LIBELLES_TYPE_MOUVEMENT,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Reception fournisseur" };

export default async function PageReceptionFournisseur({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigerPermission(PERMISSIONS.ACHAT_LIRE);

  const identifiant = identifiantOuNull((await params).id);
  if (identifiant === null) notFound();

  const reception = await prisma.goodsReceipt.findUnique({
    where: { id: identifiant },
    include: {
      supplier: { select: { id: true, code: true, label1: true } },
      order: { select: { id: true, number: true } },
      warehouse: { select: { id: true, code: true, label: true } },
      receivedBy: { select: { firstName: true, lastName: true } },
      lines: {
        orderBy: { lineNo: "asc" },
        include: {
          item: { select: { id: true, code: true, label1: true, unitCode: true } },
          qualityChecks: {
            orderBy: { checkedAt: "desc" },
            take: 5,
            select: {
              id: true,
              number: true,
              quantityChecked: true,
              quantityConform: true,
              quantityRejected: true,
              result: true,
              decision: true,
              comment: true,
              checkedAt: true,
              checkedBy: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
      invoices: { orderBy: { invoiceDate: "desc" } },
    },
  });
  if (!reception) notFound();

  // Les lots reellement crees par la reception, retrouves par article et numero
  // de lot dans le depot de destination.
  const clesLots = reception.lines
    .filter((ligne) => ligne.lotNumber !== null)
    .map((ligne) => ({ itemId: ligne.itemId, lotNumber: ligne.lotNumber as string }));
  const lots = clesLots.length
    ? await prisma.stockLot.findMany({
        where: { warehouseId: reception.warehouseId, OR: clesLots },
        include: {
          location: { select: { code: true, label: true } },
          balances: { select: { status: true, quantityPhysical: true, unitCost: true } },
        },
      })
    : [];

  // Les mouvements de stock generes par la reception, y compris les mouvements
  // inverses d'une annulation : rien n'est efface du grand livre.
  const mouvements = await prisma.stockMovement.findMany({
    where: { documentType: "BON_RECEPTION", documentId: String(identifiant) },
    orderBy: { occurredAt: "desc" },
    take: 200,
    select: {
      id: true,
      number: true,
      type: true,
      quantity: true,
      status: true,
      unitCost: true,
      totalCost: true,
      occurredAt: true,
      reason: true,
      comment: true,
      isReversal: true,
      lotId: true,
      item: { select: { code: true, label1: true } },
      warehouse: { select: { code: true } },
    },
  });

  const createur = reception.createdById
    ? await prisma.user.findUnique({
        where: { id: reception.createdById },
        select: {
          email: true,
          employee: { select: { firstName: true, lastName: true } },
        },
      })
    : null;

  // Article de chaque lot : le libelle provient des lignes de la reception, la
  // relation directe lot -> article n'etant pas chargee par la requete ci-dessus.
  const articleParItemId = new Map(
    reception.lines.map((ligne) => [ligne.itemId, `${ligne.item.code} — ${ligne.item.label1}`]),
  );

  const quantiteRecue = D.sum(reception.lines.map((ligne) => ligne.quantityReceived));
  const quantiteQuarantaine = D.sum(reception.lines.map((ligne) => ligne.quantityQuarantined));
  const quantiteAcceptee = D.sum(reception.lines.map((ligne) => ligne.quantityAccepted));

  // Une reception deja facturee ne peut plus etre annulee : le service refuse et
  // son message est affiche tel quel.
  const facturesActives = reception.invoices.filter((facture) => facture.status !== "ANNULEE");
  const peutEtreAnnulee = reception.status !== "ANNULE";

  return (
    <>
      <EnTetePage
        titre={`Reception ${reception.number}`}
        description="Entree de marchandises, lots crees et mouvements de stock generes. Toute variation de stock est justifiee par une ligne du grand livre."
        actions={
          <Link className="lien-nav text-sm" href="/achats/receptions">
            Retour a la liste
          </Link>
        }
      />

      <Carte titre="Entete de la reception">
        <ListeDefinitions
          elements={[
            {
              terme: "Statut",
              valeur: (
                <EtiquetteStatut
                  code={reception.status}
                  libelle={libelle(LIBELLES_STATUT_RECEPTION, reception.status)}
                />
              ),
            },
            { terme: "Numero", valeur: reception.number },
            {
              terme: "Fournisseur",
              valeur: `${reception.supplier.code} — ${reception.supplier.label1}`,
            },
            {
              terme: "Bon de commande",
              valeur: reception.order ? (
                <Link className="lien-nav" href={`/achats/commandes/${reception.order.id}`}>
                  {reception.order.number}
                </Link>
              ) : (
                "Sans bon de commande"
              ),
            },
            {
              terme: "Depot de destination",
              valeur: `${reception.warehouse.code} — ${reception.warehouse.label}`,
            },
            { terme: "Date de reception", valeur: formatDate(reception.receiptDate) },
            {
              terme: "Bon de livraison fournisseur",
              valeur: reception.deliveryNoteNumber ?? "Non renseigne",
            },
            {
              terme: "Controle qualitatif requis",
              valeur: reception.qualityRequired ? (
                <Etiquette ton="alerte">Oui — marchandise en quarantaine</Etiquette>
              ) : (
                <Etiquette ton="succes">Non — marchandise disponible</Etiquette>
              ),
            },
            {
              terme: "Recu par",
              valeur: reception.receivedBy
                ? `${reception.receivedBy.firstName} ${reception.receivedBy.lastName}`
                : "Non renseigne",
            },
            {
              terme: "Saisi par",
              valeur: createur
                ? createur.employee
                  ? `${createur.employee.firstName} ${createur.employee.lastName}`
                  : createur.email
                : "Non renseigne",
            },
            { terme: "Saisi le", valeur: formatDateTime(reception.createdAt) },
          ]}
        />
        {reception.notes && (
          <p className="mt-4 text-sm">
            <span className="font-medium">Observations : </span>
            {reception.notes}
          </p>
        )}
      </Carte>

      <Section titre="Quantites recues">
        <div className="grid gap-4 sm:grid-cols-3">
          <Carte titre="Total recu">
            <p className="text-lg font-semibold tabular-nums">{formatQuantite(quantiteRecue)}</p>
          </Carte>
          <Carte titre="En quarantaine">
            <p className="text-lg font-semibold tabular-nums">{formatQuantite(quantiteQuarantaine)}</p>
          </Carte>
          <Carte titre="Accepte">
            <p className="text-lg font-semibold tabular-nums">{formatQuantite(quantiteAcceptee)}</p>
          </Carte>
        </div>
      </Section>

      <Section titre="Lignes receptionnees">
        <Carte sansPadding>
          <Tableau
            colonnes={[
              { cle: "ligne", libelle: "Ligne", nombre: true },
              { cle: "article", libelle: "Article" },
              { cle: "commandee", libelle: "Commandee", nombre: true },
              { cle: "recue", libelle: "Recue", nombre: true },
              { cle: "acceptee", libelle: "Acceptee", nombre: true },
              { cle: "rejetee", libelle: "Rejetee", nombre: true },
              { cle: "quarantaine", libelle: "Quarantaine", nombre: true },
              { cle: "prix", libelle: "Prix unitaire", nombre: true },
              { cle: "lot", libelle: "Lot" },
              { cle: "qualite", libelle: "Statut qualite" },
            ]}
            lignes={reception.lines.map((ligne) => ({
              cle: String(ligne.id),
              cellules: [
                String(ligne.lineNo),
                `${ligne.item.code} — ${ligne.item.label1}`,
                formatQuantite(ligne.quantityOrdered),
                `${formatQuantite(ligne.quantityReceived)} ${ligne.unitCode ?? ""}`.trim(),
                formatQuantite(ligne.quantityAccepted),
                formatQuantite(ligne.quantityRejected),
                formatQuantite(ligne.quantityQuarantined),
                formatMontant(ligne.unitPrice),
                ligne.lotNumber ?? "Sans lot",
                <span key="qualite" className="inline-flex flex-wrap items-center gap-1">
                  <EtiquetteStatut
                    code={ligne.qualityStatus}
                    libelle={libelle(LIBELLES_STATUT_STOCK, ligne.qualityStatus)}
                  />
                  {ligne.qualityDecision && (
                    <Etiquette ton="info">
                      {libelle(LIBELLES_DECISION_QUALITE, ligne.qualityDecision)}
                    </Etiquette>
                  )}
                </span>,
              ],
            }))}
            messageVide="Cette reception ne comporte aucune ligne."
          />
        </Carte>
      </Section>

      <Section titre="Lots crees">
        <Carte sansPadding>
          <Tableau
            colonnes={[
              { cle: "lot", libelle: "Numero de lot" },
              { cle: "article", libelle: "Article" },
              { cle: "emplacement", libelle: "Emplacement" },
              { cle: "statut", libelle: "Statut du lot" },
              { cle: "solde", libelle: "Soldes par statut" },
              { cle: "fabrication", libelle: "Fabrication" },
              { cle: "peremption", libelle: "Peremption" },
              { cle: "reception", libelle: "Entree en stock" },
            ]}
            lignes={lots.map((lot) => ({
              cle: String(lot.id),
              cellules: [
                lot.lotNumber,
                lot.itemId !== null
                  ? (articleParItemId.get(lot.itemId) ?? `Article ${lot.itemId}`)
                  : "Sans article",
                lot.location ? `${lot.location.code} — ${lot.location.label}` : "Sans emplacement",
                <EtiquetteStatut
                  key="statut"
                  code={lot.status}
                  libelle={libelle(LIBELLES_STATUT_STOCK, lot.status)}
                />,
                lot.balances.length === 0
                  ? "Aucun solde"
                  : lot.balances
                      .map(
                        (solde) =>
                          `${libelle(LIBELLES_STATUT_STOCK, solde.status)} : ${formatQuantite(
                            solde.quantityPhysical,
                          )}`,
                      )
                      .join(" | "),
                formatDate(lot.manufactureDate),
                formatDate(lot.expirationDate),
                formatDateTime(lot.receivedAt),
              ],
            }))}
            messageVide="Aucun lot n'a ete cree ou retrouve par cette reception."
          />
        </Carte>
      </Section>

      <Section titre="Mouvements de stock generes">
        <Carte sansPadding>
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Mouvement" },
              { cle: "date", libelle: "Date" },
              { cle: "type", libelle: "Type" },
              { cle: "article", libelle: "Article" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "statut", libelle: "Statut" },
              { cle: "valeur", libelle: "Valeur", nombre: true },
              { cle: "motif", libelle: "Motif" },
            ]}
            lignes={mouvements.map((mouvement) => ({
              cle: String(mouvement.id),
              cellules: [
                <span key="numero" className="inline-flex flex-wrap items-center gap-1">
                  {mouvement.number}
                  {mouvement.isReversal && <Etiquette ton="danger">Mouvement inverse</Etiquette>}
                </span>,
                formatDateTime(mouvement.occurredAt),
                libelle(LIBELLES_TYPE_MOUVEMENT, mouvement.type),
                `${mouvement.item.code} — ${mouvement.item.label1}`,
                `${formatQuantite(mouvement.quantity)} (${mouvement.warehouse.code})`,
                <EtiquetteStatut
                  key="statut"
                  code={mouvement.status}
                  libelle={libelle(LIBELLES_STATUT_STOCK, mouvement.status)}
                />,
                formatMontant(mouvement.totalCost),
                mouvement.reason ?? mouvement.comment ?? "-",
              ],
            }))}
            messageVide="Aucun mouvement de stock n'est rattache a cette reception."
          />
        </Carte>
      </Section>

      <Section titre="Controles qualite rattaches">
        <Carte sansPadding>
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Controle" },
              { cle: "date", libelle: "Date" },
              { cle: "article", libelle: "Article" },
              { cle: "controle", libelle: "Quantite controlee", nombre: true },
              { cle: "conforme", libelle: "Conforme", nombre: true },
              { cle: "rejete", libelle: "Rejetee", nombre: true },
              { cle: "resultat", libelle: "Resultat" },
              { cle: "decision", libelle: "Decision" },
              { cle: "operateur", libelle: "Controle par" },
              { cle: "commentaire", libelle: "Commentaire" },
            ]}
            lignes={reception.lines.flatMap((ligne) =>
              ligne.qualityChecks.map((controle) => ({
                cle: String(controle.id),
                cellules: [
                  controle.number,
                  formatDateTime(controle.checkedAt),
                  `${ligne.item.code} — ${ligne.item.label1}`,
                  formatQuantite(controle.quantityChecked),
                  formatQuantite(controle.quantityConform),
                  formatQuantite(controle.quantityRejected),
                  <EtiquetteStatut
                    key="resultat"
                    code={controle.result}
                    libelle={libelle(LIBELLES_RESULTAT_CONTROLE, controle.result)}
                  />,
                  <EtiquetteStatut
                    key="decision"
                    code={controle.decision}
                    libelle={libelle(LIBELLES_DECISION_QUALITE, controle.decision)}
                  />,
                  controle.checkedBy
                    ? `${controle.checkedBy.firstName} ${controle.checkedBy.lastName}`
                    : "-",
                  controle.comment ?? "-",
                ],
              })),
            )}
            messageVide="Aucun controle qualite n'a encore ete enregistre pour cette reception. La marchandise reste en quarantaine jusqu'a decision."
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
              { cle: "ttc", libelle: "Total TTC", nombre: true },
            ]}
            lignes={reception.invoices.map((facture) => ({
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
                formatMontant(facture.totalTTC, facture.currency),
              ],
            }))}
            messageVide="Aucune facture fournisseur n'est rattachee a cette reception."
          />
        </Carte>
      </Section>

      <Section titre="Actions sur la reception">
        <Carte>
          <div className="space-y-5">
            {peutEtreAnnulee ? (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Annuler la reception</h3>
                {facturesActives.length > 0 && (
                  <div className="mb-3">
                    <Alerte ton="alerte" titre="Reception facturee">
                      Une facture fournisseur est rattachee a cette reception (
                      {facturesActives.map((facture) => facture.number).join(", ")}). Le service
                      refusera l&apos;annulation et indiquera la contre-passation a effectuer.
                    </Alerte>
                  </div>
                )}
                <FormulaireMotif
                  action={actionAnnulerReception}
                  libelleSoumettre="Annuler la reception"
                  varianteSoumettre="danger"
                  libelleMotif="Motif de l'annulation (au moins 10 caracteres)"
                  motifMinimum={10}
                  champsCaches={{ receptionId: reception.id }}
                />
                <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                  L&apos;annulation genere un mouvement de stock inverse pour chaque ligne : aucune
                  quantite n&apos;est effacee du grand livre.
                </p>
              </div>
            ) : (
              <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                Cette reception est annulee : aucun retour fournisseur ne peut plus y etre rattache.
              </p>
            )}

            {peutEtreAnnulee && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Retour fournisseur</h3>
                <p className="mb-3 text-sm" style={{ color: "var(--texte-doux)" }}>
                  Sortie de stock d&apos;articles refuses, non conformes ou a remplacer. Saisissez
                  uniquement les quantites reellement retournees, ligne par ligne.
                </p>
                <FormulaireAction
                  action={actionRetourFournisseur}
                  libelleSoumettre="Enregistrer le retour fournisseur"
                  varianteSoumettre="danger"
                >
                  <input type="hidden" name="fournisseurId" value={reception.supplier.id} />
                  <input type="hidden" name="depotId" value={reception.warehouseId} />
                  <input type="hidden" name="receptionId" value={reception.id} />
                  <input type="hidden" name="documentOrigine" value={reception.number} />
                  <input type="hidden" name="nombreLignes" value={reception.lines.length} />

                  <div className="overflow-x-auto">
                    <table className="donnees">
                      <thead>
                        <tr>
                          <th>Article</th>
                          <th className="nombre">Recue</th>
                          <th className="nombre">Quarantaine</th>
                          <th className="nombre">Quantite a retourner</th>
                          <th style={{ minWidth: "9rem" }}>Lot</th>
                          <th style={{ minWidth: "10rem" }}>Statut a debiter</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reception.lines.map((ligne, index) => (
                          <tr key={ligne.id}>
                            <td>
                              <input
                                type="hidden"
                                name={`ligne_${index}_itemId`}
                                value={ligne.itemId}
                              />
                              <input
                                type="hidden"
                                name={`ligne_${index}_lot`}
                                value={ligne.lotNumber ?? ""}
                              />
                              <input
                                type="hidden"
                                name={`ligne_${index}_cout`}
                                value={ligne.unitPrice.toFixed(4)}
                              />
                              {ligne.item.code} — {ligne.item.label1}
                            </td>
                            <td className="nombre">{formatQuantite(ligne.quantityReceived)}</td>
                            <td className="nombre">{formatQuantite(ligne.quantityQuarantined)}</td>
                            <td className="nombre">
                              <input
                                className="champ"
                                type="number"
                                name={`ligne_${index}_quantite`}
                                step="0.001"
                                min="0"
                                inputMode="decimal"
                                defaultValue={0}
                              />
                            </td>
                            <td>{ligne.lotNumber ?? "Sans lot"}</td>
                            <td>
                              <select
                                className="champ"
                                name={`ligne_${index}_statut`}
                                defaultValue={ligne.qualityStatus === "EN_COURS_PRODUCTION" ? "QUARANTAINE" : ligne.qualityStatus}
                              >
                                <option value="QUARANTAINE">Quarantaine</option>
                                <option value="LIBRE">Libre</option>
                                <option value="BLOQUE">Bloque</option>
                                <option value="REBUT">Rebut</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4">
                    <Champ
                      nom="motif"
                      libelle="Motif du retour fournisseur (au moins 10 caracteres)"
                      type="textarea"
                      requis
                      maxLength={1000}
                      aide="Ce motif est journalise et rattache aux mouvements de sortie."
                    />
                  </div>
                </FormulaireAction>
              </div>
            )}
          </div>
        </Carte>
      </Section>
    </>
  );
}
