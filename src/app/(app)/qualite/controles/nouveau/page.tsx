import Link from "next/link";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { actionControlerProduction, actionControlerReception } from "@/actions/qualite";
import { aLaPermission, exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { identifiantOuNull, premiereValeur } from "@/lib/liste";
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
import { formatDate, formatDateTime, formatQuantite } from "@/lib/format";
import {
  LIBELLES_DECISION_QUALITE,
  LIBELLES_STATUT_ORDRE,
  LIBELLES_STATUT_STOCK,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Nouveau controle qualite" };

/**
 * Saisie d'un controle qualite.
 *
 * Deux situations reelles, deux formulaires distincts :
 *  - le controle de reception fournisseur, qui porte sur une ligne de bon de
 *    reception et deplace lui-meme les quantites acceptees ou rejetees ;
 *  - le controle en production, qui porte sur une operation d'un ordre de
 *    fabrication et fixe le statut qualite de l'operation et de l'ordre.
 *
 * Les points de controle proposes proviennent du plan rattache a l'article ou a
 * l'operation. Aucun seuil n'est code en dur : les tolerances affichees sont
 * celles declarees au plan, et le service evalue la mesure par rapport a elles.
 */

const DECISIONS = [
  "ACCEPTE",
  "ACCEPTE_SOUS_RESERVE",
  "QUARANTAINE",
  "REJETE",
] as const;

/** Quantite par defaut proposee pour un controle : la marchandise en attente. */
function quantiteParDefaut(enAttente: unknown, recue: unknown): string {
  return D.gt(D.of(enAttente as never), 0)
    ? D.toFixed(D.of(enAttente as never), 3)
    : D.toFixed(D.of(recue as never), 3);
}

export default async function PageNouveauControle({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.QUALITE_CONTROLER);
  const peutDecider = aLaPermission(utilisateur, PERMISSIONS.QUALITE_DECIDER);

  const parametres = await searchParams;
  const ligneId = identifiantOuNull(premiereValeur(parametres, "ligne"));
  const operationId = identifiantOuNull(premiereValeur(parametres, "operation"));

  const [lignesReception, operations] = await Promise.all([
    prisma.goodsReceiptLine.findMany({
      where: {
        OR: [
          { receipt: { status: "EN_CONTROLE_QUALITE" } },
          { qualityStatus: { in: ["QUARANTAINE", "BLOQUE"] } },
        ],
      },
      orderBy: { id: "desc" },
      take: 200,
      include: {
        item: { select: { id: true, code: true, label1: true, unitCode: true } },
        receipt: {
          select: {
            id: true,
            number: true,
            receiptDate: true,
            warehouse: { select: { code: true, label: true } },
            supplier: { select: { code: true, label1: true } },
          },
        },
        qualityChecks: {
          orderBy: { checkedAt: "desc" },
          take: 1,
          select: { number: true, decision: true, checkedAt: true },
        },
      },
    }),
    prisma.workOrderOperation.findMany({
      where: { workOrder: { status: { notIn: ["ANNULE", "CLOTURE", "BROUILLON"] } } },
      orderBy: { id: "desc" },
      take: 200,
      include: {
        operation: { select: { code: true, label: true, requiresQualityCheck: true } },
        workOrder: {
          select: {
            id: true,
            number: true,
            status: true,
            item: { select: { code: true, label1: true } },
          },
        },
        qualityChecks: {
          orderBy: { checkedAt: "desc" },
          take: 1,
          select: { number: true, decision: true, checkedAt: true },
        },
      },
    }),
  ]);

  const ligneChoisie = lignesReception.find((ligne) => ligne.id === ligneId) ?? null;
  const operationChoisie = operations.find((element) => element.id === operationId) ?? null;

  // Plan de controle applicable : celui de l'article (ou de l'operation), sinon
  // le plan generique. Un plan sans point de controle n'apporte rien : le
  // controle est alors enregistre sans mesure detaillee.
  const planReception = ligneChoisie
    ? ((await prisma.qualityPlan.findFirst({
        where: { isActive: true, itemId: ligneChoisie.itemId },
        orderBy: { id: "asc" },
        include: { checkpoints: { orderBy: { sequence: "asc" } } },
      })) ??
      (await prisma.qualityPlan.findFirst({
        where: { isActive: true, itemId: null },
        orderBy: { id: "asc" },
        include: { checkpoints: { orderBy: { sequence: "asc" } } },
      })))
    : null;

  const planProduction = operationChoisie
    ? await prisma.qualityPlan.findFirst({
        where: { isActive: true, operationId: operationChoisie.operationId },
        orderBy: { id: "asc" },
        include: { checkpoints: { orderBy: { sequence: "asc" } } },
      })
    : null;

  const optionsDecisions = DECISIONS.map((valeur) => ({
    valeur,
    libelle: libelle(LIBELLES_DECISION_QUALITE, valeur),
  }));

  return (
    <>
      <EnTetePage
        titre="Nouveau controle qualite"
        description="Le controle enregistre ce qui a ete reellement examine et la decision prise. Une marchandise non acceptee reste indisponible pour la production ou la vente."
        actions={
          <Link className="lien-nav text-sm" href="/qualite">
            Retour au registre
          </Link>
        }
      />

      {!peutDecider && (
        <div className="mb-5">
          <Alerte ton="alerte" titre="Droit de decision qualite absent">
            Vous pouvez saisir un controle, mais toute decision autre qu&apos;une acceptation
            simple sera refusee par le serveur : la permission « decision qualite » est requise pour
            mettre en quarantaine ou rejeter une marchandise.
          </Alerte>
        </div>
      )}

      <Section titre="Controle de reception fournisseur">
        <Carte
          titre="1. Ligne de bon de reception a controler"
          description="Seules les lignes reellement en attente de decision sont proposees : receptions en controle qualitatif et marchandises en quarantaine ou bloquees."
        >
          <form method="get" className="flex flex-wrap items-end gap-3">
            {operationId !== null && (
              <input type="hidden" name="operation" value={operationId} />
            )}
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Ligne de reception</span>
              <select
                className="champ"
                name="ligne"
                defaultValue={ligneId === null ? "" : String(ligneId)}
                style={{ minWidth: "28rem" }}
              >
                <option value="">— Selectionner une ligne a controler —</option>
                {lignesReception.map((ligne) => (
                  <option key={ligne.id} value={ligne.id}>
                    {ligne.receipt.number} — ligne {ligne.lineNo} — {ligne.item.code} —{" "}
                    {formatQuantite(ligne.quantityQuarantined)} en quarantaine
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
            >
              Charger la ligne
            </button>
          </form>

          <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
            {lignesReception.length} ligne(s) en attente de decision dans votre perimetre.
          </p>

          <div className="mt-4">
            <Tableau
              colonnes={[
                { cle: "reception", libelle: "Reception" },
                { cle: "fournisseur", libelle: "Fournisseur" },
                { cle: "article", libelle: "Article" },
                { cle: "recue", libelle: "Recue", nombre: true },
                { cle: "quarantaine", libelle: "Quarantaine", nombre: true },
                { cle: "statut", libelle: "Statut marchandise" },
                { cle: "dernier", libelle: "Dernier controle" },
                { cle: "action", libelle: "Action" },
              ]}
              lignes={lignesReception.slice(0, 50).map((ligne) => {
                const dernier = ligne.qualityChecks[0] ?? null;
                return {
                  cle: String(ligne.id),
                  cellules: [
                    `${ligne.receipt.number} (${formatDate(ligne.receipt.receiptDate)})`,
                    `${ligne.receipt.supplier.code} — ${ligne.receipt.supplier.label1}`,
                    `${ligne.item.code} — ${ligne.item.label1}`,
                    formatQuantite(ligne.quantityReceived),
                    formatQuantite(ligne.quantityQuarantined),
                    <EtiquetteStatut
                      key="statut"
                      code={ligne.qualityStatus}
                      libelle={libelle(LIBELLES_STATUT_STOCK, ligne.qualityStatus)}
                    />,
                    dernier
                      ? `${dernier.number} — ${libelle(
                          LIBELLES_DECISION_QUALITE,
                          dernier.decision,
                        )} (${formatDateTime(dernier.checkedAt)})`
                      : "Aucun controle enregistre",
                    <Link
                      key="action"
                      className="lien-nav"
                      href={`/qualite/controles/nouveau?ligne=${ligne.id}`}
                    >
                      Controler cette ligne
                    </Link>,
                  ],
                };
              })}
              messageVide="Aucune ligne de reception n'attend de decision qualite."
            />
            {lignesReception.length > 50 && (
              <p className="px-4 py-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                Seules les 50 premieres lignes sont listees ; utilisez la liste deroulante pour
                atteindre une ligne plus ancienne.
              </p>
            )}
          </div>
        </Carte>

        {ligneChoisie && (
          <div className="mt-5">
            <Carte
              titre="2. Verdict du controle"
              description="La quantite acceptee passe en stock libre, la quantite rejetee part au rebut, le reste demeure en quarantaine."
            >
              <ListeDefinitions
                elements={[
                  { terme: "Reception", valeur: ligneChoisie.receipt.number },
                  {
                    terme: "Fournisseur",
                    valeur: `${ligneChoisie.receipt.supplier.code} — ${ligneChoisie.receipt.supplier.label1}`,
                  },
                  {
                    terme: "Depot de destination",
                    valeur: `${ligneChoisie.receipt.warehouse.code} — ${ligneChoisie.receipt.warehouse.label}`,
                  },
                  {
                    terme: "Article",
                    valeur: `${ligneChoisie.item.code} — ${ligneChoisie.item.label1}`,
                  },
                  {
                    terme: "Quantite recue",
                    valeur: `${formatQuantite(ligneChoisie.quantityReceived)} ${
                      ligneChoisie.unitCode ?? ligneChoisie.item.unitCode ?? ""
                    }`.trim(),
                  },
                  {
                    terme: "Quantite en quarantaine",
                    valeur: formatQuantite(ligneChoisie.quantityQuarantined),
                  },
                  { terme: "Lot", valeur: ligneChoisie.lotNumber ?? "Sans numero de lot" },
                  {
                    terme: "Peremption",
                    valeur: formatDate(ligneChoisie.expirationDate),
                  },
                ]}
              />

              <div className="mt-5">
                <FormulaireAction
                  action={actionControlerReception}
                  libelleSoumettre="Enregistrer le controle de reception"
                  varianteSoumettre="primaire"
                  reinitialiser
                >
                  <input type="hidden" name="ligneReceptionId" value={ligneChoisie.id} />

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Champ
                      nom="quantiteControlee"
                      libelle="Quantite controlee"
                      type="number"
                      pas="0.001"
                      min="0"
                      requis
                      valeur={quantiteParDefaut(
                        ligneChoisie.quantityQuarantined,
                        ligneChoisie.quantityReceived,
                      )}
                    />
                    <Champ
                      nom="quantiteConforme"
                      libelle="Quantite conforme (stock libre)"
                      type="number"
                      pas="0.001"
                      min="0"
                      requis
                      valeur={quantiteParDefaut(
                        ligneChoisie.quantityQuarantined,
                        ligneChoisie.quantityReceived,
                      )}
                    />
                    <Champ
                      nom="quantiteRejetee"
                      libelle="Quantite rejetee (rebut)"
                      type="number"
                      pas="0.001"
                      min="0"
                      valeur="0"
                    />
                    <Champ
                      nom="decision"
                      libelle="Decision qualite"
                      type="select"
                      requis
                      valeur="ACCEPTE"
                      options={optionsDecisions}
                    />
                  </div>

                  {planReception && planReception.checkpoints.length > 0 && (
                    <div className="mt-5">
                      <h3 className="mb-2 text-sm font-semibold">
                        Points de controle du plan {planReception.code}
                      </h3>
                      <p className="mb-3 text-xs" style={{ color: "var(--texte-doux)" }}>
                        Le resultat de chaque point est determine par le service a partir de la
                        valeur mesuree et des tolerances declarees au plan. Un point laisse vide
                        n&apos;est pas enregistre.
                      </p>
                      <div className="overflow-x-auto">
                        <table className="donnees">
                          <thead>
                            <tr>
                              <th>Point</th>
                              <th>Type</th>
                              <th>Cible</th>
                              <th className="nombre">Tolerance mini</th>
                              <th className="nombre">Tolerance maxi</th>
                              <th>Unite</th>
                              <th className="nombre">Valeur mesuree</th>
                              <th style={{ minWidth: "14rem" }}>Observation</th>
                            </tr>
                          </thead>
                          <tbody>
                            {planReception.checkpoints.map((point) => (
                              <tr key={point.id}>
                                <td>
                                  {point.code} — {point.label}
                                  {point.isMandatory && (
                                    <span className="ml-2">
                                      <Etiquette ton="alerte">Obligatoire</Etiquette>
                                    </span>
                                  )}
                                </td>
                                <td>{point.checkType}</td>
                                <td>{point.expectedValue ?? "-"}</td>
                                <td className="nombre">
                                  {point.toleranceMin === null
                                    ? "-"
                                    : formatQuantite(point.toleranceMin, 6)}
                                </td>
                                <td className="nombre">
                                  {point.toleranceMax === null
                                    ? "-"
                                    : formatQuantite(point.toleranceMax, 6)}
                                </td>
                                <td>{point.unitCode ?? "-"}</td>
                                <td className="nombre">
                                  <input
                                    className="champ"
                                    type="number"
                                    step="0.000001"
                                    inputMode="decimal"
                                    name={`mesure_${point.id}_valeur`}
                                  />
                                </td>
                                <td>
                                  <input
                                    className="champ"
                                    type="text"
                                    name={`mesure_${point.id}_commentaire`}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {planReception && planReception.checkpoints.length === 0 && (
                    <div className="mt-4">
                      <Alerte ton="info" titre={`Plan ${planReception.code} sans point de controle`}>
                        Ce plan ne declare aucun point : le controle est enregistre avec les seules
                        quantites et la decision.
                      </Alerte>
                    </div>
                  )}

                  <div className="mt-5">
                    <Champ
                      nom="commentaire"
                      libelle="Commentaire du controle"
                      type="textarea"
                      maxLength={1000}
                      aide="Obligatoire (au moins 10 caracteres) des que la decision n'est pas une acceptation simple."
                    />
                  </div>
                </FormulaireAction>
              </div>
            </Carte>
          </div>
        )}

        {ligneId !== null && !ligneChoisie && (
          <div className="mt-4">
            <Alerte ton="alerte" titre="Ligne introuvable">
              La ligne de reception demandee n&apos;existe pas ou n&apos;est plus en attente de
              decision qualite.
            </Alerte>
          </div>
        )}
      </Section>

      <Section titre="Controle en production">
        <Carte
          titre="1. Operation de fabrication a controler"
          description="Operations des ordres en cours, lances ou termines. Le controle fixe le statut qualite de l'operation et de son ordre."
        >
          <form method="get" className="flex flex-wrap items-end gap-3">
            {ligneId !== null && <input type="hidden" name="ligne" value={ligneId} />}
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Operation de fabrication</span>
              <select
                className="champ"
                name="operation"
                defaultValue={operationId === null ? "" : String(operationId)}
                style={{ minWidth: "28rem" }}
              >
                <option value="">— Selectionner une operation a controler —</option>
                {operations.map((element) => (
                  <option key={element.id} value={element.id}>
                    {element.workOrder.number} — etape {element.stepNo} — {element.operation.code} —
                    {" "}
                    {formatQuantite(element.quantityProduced)} produite(s)
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
            >
              Charger l&apos;operation
            </button>
          </form>

          <div className="mt-4">
            <Tableau
              colonnes={[
                { cle: "ordre", libelle: "Ordre" },
                { cle: "article", libelle: "Article fabrique" },
                { cle: "etape", libelle: "Etape", nombre: true },
                { cle: "operation", libelle: "Operation" },
                { cle: "produite", libelle: "Produite", nombre: true },
                { cle: "conforme", libelle: "Conforme", nombre: true },
                { cle: "statutOrdre", libelle: "Statut de l'ordre" },
                { cle: "dernier", libelle: "Dernier controle" },
                { cle: "action", libelle: "Action" },
              ]}
              lignes={operations.slice(0, 50).map((element) => {
                const dernier = element.qualityChecks[0] ?? null;
                return {
                  cle: String(element.id),
                  cellules: [
                    <Link
                      key="ordre"
                      className="lien-nav"
                      href={`/production/${element.workOrder.id}`}
                    >
                      {element.workOrder.number}
                    </Link>,
                    `${element.workOrder.item.code} — ${element.workOrder.item.label1}`,
                    String(element.stepNo),
                    `${element.operation.code} — ${element.operation.label}`,
                    formatQuantite(element.quantityProduced),
                    formatQuantite(element.quantityConform),
                    <EtiquetteStatut
                      key="statutOrdre"
                      code={element.workOrder.status}
                      libelle={libelle(LIBELLES_STATUT_ORDRE, element.workOrder.status)}
                    />,
                    dernier
                      ? `${dernier.number} — ${libelle(
                          LIBELLES_DECISION_QUALITE,
                          dernier.decision,
                        )} (${formatDateTime(dernier.checkedAt)})`
                      : element.operation.requiresQualityCheck
                        ? "Controle requis par la gamme, aucun controle enregistre"
                        : "Aucun controle enregistre",
                    <Link
                      key="action"
                      className="lien-nav"
                      href={`/qualite/controles/nouveau?operation=${element.id}`}
                    >
                      Controler cette operation
                    </Link>,
                  ],
                };
              })}
              messageVide="Aucune operation de fabrication n'est disponible pour un controle."
            />
          </div>
        </Carte>

        {operationChoisie && (
          <div className="mt-5">
            <Carte
              titre="2. Verdict du controle"
              description="Une decision de quarantaine ou de rejet place l'ordre en controle qualite et ouvre une non-conformite."
            >
              <ListeDefinitions
                elements={[
                  { terme: "Ordre de fabrication", valeur: operationChoisie.workOrder.number },
                  {
                    terme: "Article fabrique",
                    valeur: `${operationChoisie.workOrder.item.code} — ${operationChoisie.workOrder.item.label1}`,
                  },
                  { terme: "Etape", valeur: String(operationChoisie.stepNo) },
                  {
                    terme: "Operation",
                    valeur: `${operationChoisie.operation.code} — ${operationChoisie.operation.label}`,
                  },
                  { terme: "Quantite produite", valeur: formatQuantite(operationChoisie.quantityProduced) },
                  {
                    terme: "Controle requis par la gamme",
                    valeur: operationChoisie.operation.requiresQualityCheck ? "Oui" : "Non",
                  },
                  {
                    terme: "Operateur",
                    valeur: operationChoisie.operatorId === null ? "Non renseigne" : "Renseigne",
                  },
                ]}
              />

              <div className="mt-5">
                <FormulaireAction
                  action={actionControlerProduction}
                  libelleSoumettre="Enregistrer le controle de production"
                  varianteSoumettre="primaire"
                  reinitialiser
                >
                  <input
                    type="hidden"
                    name="operationFabricationId"
                    value={operationChoisie.id}
                  />

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Champ
                      nom="quantiteControlee"
                      libelle="Quantite controlee"
                      type="number"
                      pas="0.001"
                      min="0"
                      requis
                      valeur={D.toFixed(operationChoisie.quantityProduced, 3)}
                    />
                    <Champ
                      nom="quantiteConforme"
                      libelle="Quantite conforme"
                      type="number"
                      pas="0.001"
                      min="0"
                      requis
                      valeur={D.toFixed(operationChoisie.quantityProduced, 3)}
                    />
                    <Champ
                      nom="quantiteRejetee"
                      libelle="Quantite rejetee"
                      type="number"
                      pas="0.001"
                      min="0"
                      valeur="0"
                    />
                    <Champ
                      nom="decision"
                      libelle="Decision qualite"
                      type="select"
                      requis
                      valeur="ACCEPTE"
                      options={optionsDecisions}
                    />
                  </div>

                  {planProduction && planProduction.checkpoints.length > 0 && (
                    <div className="mt-5">
                      <h3 className="mb-2 text-sm font-semibold">
                        Points de controle du plan {planProduction.code}
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="donnees">
                          <thead>
                            <tr>
                              <th>Point</th>
                              <th>Type</th>
                              <th>Cible</th>
                              <th className="nombre">Tolerance mini</th>
                              <th className="nombre">Tolerance maxi</th>
                              <th>Unite</th>
                              <th className="nombre">Valeur mesuree</th>
                              <th style={{ minWidth: "14rem" }}>Observation</th>
                            </tr>
                          </thead>
                          <tbody>
                            {planProduction.checkpoints.map((point) => (
                              <tr key={point.id}>
                                <td>
                                  {point.code} — {point.label}
                                  {point.isMandatory && (
                                    <span className="ml-2">
                                      <Etiquette ton="alerte">Obligatoire</Etiquette>
                                    </span>
                                  )}
                                </td>
                                <td>{point.checkType}</td>
                                <td>{point.expectedValue ?? "-"}</td>
                                <td className="nombre">
                                  {point.toleranceMin === null
                                    ? "-"
                                    : formatQuantite(point.toleranceMin, 6)}
                                </td>
                                <td className="nombre">
                                  {point.toleranceMax === null
                                    ? "-"
                                    : formatQuantite(point.toleranceMax, 6)}
                                </td>
                                <td>{point.unitCode ?? "-"}</td>
                                <td className="nombre">
                                  <input
                                    className="champ"
                                    type="number"
                                    step="0.000001"
                                    inputMode="decimal"
                                    name={`mesure_${point.id}_valeur`}
                                  />
                                </td>
                                <td>
                                  <input
                                    className="champ"
                                    type="text"
                                    name={`mesure_${point.id}_commentaire`}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {!planProduction && (
                    <div className="mt-4">
                      <Alerte ton="info" titre="Aucun plan de controle pour cette operation">
                        Aucun plan actif n&apos;est rattache a cette operation : le controle est
                        enregistre avec les seules quantites et la decision. Creez le plan depuis la
                        page des plans de controle pour suivre des caracteristiques mesurees.
                      </Alerte>
                    </div>
                  )}

                  <div className="mt-5">
                    <Champ
                      nom="commentaire"
                      libelle="Commentaire du controle"
                      type="textarea"
                      maxLength={1000}
                      aide="Obligatoire (au moins 10 caracteres) des que la decision n'est pas une acceptation simple."
                    />
                  </div>
                </FormulaireAction>
              </div>
            </Carte>
          </div>
        )}

        {operationId !== null && !operationChoisie && (
          <div className="mt-4">
            <Alerte ton="alerte" titre="Operation introuvable">
              L&apos;operation demandee n&apos;existe pas ou son ordre de fabrication est clos.
            </Alerte>
          </div>
        )}
      </Section>
    </>
  );
}
