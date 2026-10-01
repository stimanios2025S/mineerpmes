import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { consulterJournalAudit } from "@/lib/audit";
import {
  actionCloturerNonConformite,
  actionMettreEnAnalyse,
  actionMettreEnReprise,
  actionRejeterNonConformite,
  actionStatuerNonConformite,
} from "@/actions/qualite";
import { aLaPermission, exigerPermission } from "@/lib/rbac/guard";
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
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatDate, formatDateTime, formatMontant, formatQuantite } from "@/lib/format";
import {
  LIBELLES_DECISION_QUALITE,
  LIBELLES_SOURCE_NON_CONFORMITE,
  LIBELLES_STATUT_NON_CONFORMITE,
  LIBELLES_STATUT_STOCK,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Fiche de non-conformite" };

/**
 * Fiche complete d'une non-conformite : constat, analyse, decision et
 * historique.
 *
 * L'historique affiche provient du journal d'audit, jamais d'un texte libre :
 * aucune etape de traitement ne peut donc etre effacee ou reecrite.
 * Toutes les actions proposees renvoient aux actions serveur du module, qui
 * revalident les droits et exigent un commentaire ecrit.
 */

const DECISIONS = ["ACCEPTE", "ACCEPTE_SOUS_RESERVE", "QUARANTAINE", "REJETE"] as const;

/** Resume compact d'une valeur du journal d'audit, sans trahir son contenu. */
function resumeJson(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return "-";
  const texte = JSON.stringify(valeur);
  if (texte === undefined) return "-";
  return texte.length > 220 ? `${texte.slice(0, 220)}...` : texte;
}

export default async function PageNonConformite({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.QUALITE_LIRE);
  const peutGerer = aLaPermission(utilisateur, PERMISSIONS.QUALITE_NONCONFORMITE_GERER);

  const identifiant = identifiantOuNull((await params).id);
  if (identifiant === null) notFound();

  const nonConformite = await prisma.nonConformity.findUnique({
    where: { id: identifiant },
    include: {
      item: { select: { code: true, label1: true } },
      workOrder: { select: { id: true, number: true, status: true } },
      thirdParty: { select: { code: true, label1: true } },
      detectedBy: { select: { firstName: true, lastName: true, matricule: true } },
      assignedTo: { select: { firstName: true, lastName: true, matricule: true } },
    },
  });
  if (!nonConformite) notFound();

  const [historique, employes, controles, lots] = await Promise.all([
    consulterJournalAudit({
      entity: "NonConformity",
      entityId: String(nonConformite.id),
      page: 1,
      taille: 50,
    }),
    peutGerer
      ? prisma.employee.findMany({
          where: { isActive: true },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          take: 300,
          select: { id: true, firstName: true, lastName: true, matricule: true },
        })
      : Promise.resolve([]),
    prisma.qualityCheck.findMany({
      where: {
        OR: [
          { workOrderId: nonConformite.workOrderId ?? -1 },
          { itemId: nonConformite.itemId ?? -1 },
        ],
      },
      orderBy: { checkedAt: "desc" },
      take: 20,
      select: {
        id: true,
        number: true,
        checkedAt: true,
        result: true,
        decision: true,
        quantityChecked: true,
        quantityRejected: true,
      },
    }),
    prisma.stockLot.findMany({
      where: {
        OR: [
          { workOrderId: nonConformite.workOrderId ?? -1 },
          { itemId: nonConformite.itemId ?? -1 },
        ],
        status: { in: ["QUARANTAINE", "BLOQUE"] },
      },
      orderBy: { id: "desc" },
      take: 20,
      select: {
        id: true,
        lotNumber: true,
        status: true,
        item: { select: { code: true, label1: true } },
        warehouse: { select: { code: true, label: true } },
      },
    }),
  ]);

  const statut = nonConformite.status;
  const estClose = statut === "CLOTUREE";
  const estRejetee = statut === "REJETEE";
  const quantiteCourante = D.toFixed(nonConformite.quantity, 3);

  return (
    <>
      <EnTetePage
        titre={`Non-conformite ${nonConformite.number}`}
        description={nonConformite.description}
        actions={
          <span className="flex flex-wrap items-center gap-3">
            <EtiquetteStatut
              code={statut}
              libelle={libelle(LIBELLES_STATUT_NON_CONFORMITE, statut)}
            />
            <Link className="lien-nav text-sm" href="/qualite/non-conformites">
              Retour au registre
            </Link>
          </span>
        }
      />

      {estClose && (
        <div className="mb-5">
          <Alerte ton="succes" titre="Fiche cloturee">
            Cette non-conformite est cloturee le {formatDate(nonConformite.closedAt)} : elle reste
            consultable mais ne peut plus etre modifiee.
          </Alerte>
        </div>
      )}

      {estRejetee && (
        <div className="mb-5">
          <Alerte ton="alerte" titre="Fiche rejetee">
            Cette non-conformite a ete rejetee : elle ne peut plus recevoir de decision qualite.
            Seule la cloture reste possible.
          </Alerte>
        </div>
      )}

      <Carte titre="Constat">
        <ListeDefinitions
          elements={[
            { terme: "Numero", valeur: nonConformite.number },
            {
              terme: "Statut",
              valeur: (
                <EtiquetteStatut
                  code={statut}
                  libelle={libelle(LIBELLES_STATUT_NON_CONFORMITE, statut)}
                />
              ),
            },
            {
              terme: "Origine",
              valeur: libelle(LIBELLES_SOURCE_NON_CONFORMITE, nonConformite.source),
            },
            {
              terme: "Article",
              valeur: nonConformite.item
                ? `${nonConformite.item.code} — ${nonConformite.item.label1}`
                : "Article non renseigne",
            },
            {
              terme: "Ordre de fabrication",
              valeur: nonConformite.workOrder ? (
                <Link className="lien-nav" href={`/production/${nonConformite.workOrder.id}`}>
                  {nonConformite.workOrder.number}
                </Link>
              ) : (
                "Aucun ordre rattache"
              ),
            },
            {
              terme: "Fournisseur ou client",
              valeur: nonConformite.thirdParty
                ? `${nonConformite.thirdParty.code} — ${nonConformite.thirdParty.label1}`
                : "Aucun tiers rattache",
            },
            {
              terme: "Quantite concernee enregistree",
              valeur: formatQuantite(nonConformite.quantity),
            },
            { terme: "Cout estime", valeur: formatMontant(nonConformite.costImpact) },
            {
              terme: "Detectee par",
              valeur: nonConformite.detectedBy
                ? `${nonConformite.detectedBy.firstName} ${nonConformite.detectedBy.lastName} (${nonConformite.detectedBy.matricule})`
                : "Detecteur non renseigne",
            },
            {
              terme: "Responsable du traitement",
              valeur: nonConformite.assignedTo
                ? `${nonConformite.assignedTo.firstName} ${nonConformite.assignedTo.lastName} (${nonConformite.assignedTo.matricule})`
                : "Non assignee",
            },
            { terme: "Detectee le", valeur: formatDateTime(nonConformite.detectedAt) },
            {
              terme: "Resolue le",
              valeur: nonConformite.resolvedAt ? formatDateTime(nonConformite.resolvedAt) : "-",
            },
            {
              terme: "Cloturee le",
              valeur: nonConformite.closedAt ? formatDateTime(nonConformite.closedAt) : "-",
            },
          ]}
        />
      </Carte>

      <Section titre="Analyse et decision">
        <Carte>
          <ListeDefinitions
            elements={[
            {
              terme: "Cause racine",
              valeur: nonConformite.rootCause ?? "Non renseignee",
            },
            {
              terme: "Action corrective",
              valeur: nonConformite.correctiveAction ?? "Non renseignee",
            },
            {
              terme: "Decision qualite",
              valeur: nonConformite.decision ? (
                libelle(LIBELLES_DECISION_QUALITE, nonConformite.decision)
              ) : (
                <span style={{ color: "var(--texte-doux)" }}>Aucune decision enregistree</span>
              ),
            },
            ]}
          />
          {nonConformite.decision === null && (
            <p className="mt-4 text-xs" style={{ color: "var(--texte-doux)" }}>
              Aucune decision qualite n&apos;est enregistree : le service ne la deduit jamais d une
              quantite ou d un statut. Elle doit etre saisie explicitement.
            </p>
          )}
        </Carte>
      </Section>

      {controles.length > 0 && (
        <Section titre="Controles qualite rattaches a l'article ou a l'ordre">
          <Carte sansPadding>
            <Tableau
              colonnes={[
                { cle: "numero", libelle: "Controle" },
                { cle: "date", libelle: "Date" },
                { cle: "controlee", libelle: "Controlee", nombre: true },
                { cle: "rejetee", libelle: "Rejetee", nombre: true },
                { cle: "decision", libelle: "Decision" },
              ]}
              lignes={controles.map((controle) => ({
                cle: String(controle.id),
                cellules: [
                  controle.number,
                  formatDateTime(controle.checkedAt),
                  formatQuantite(controle.quantityChecked),
                  formatQuantite(controle.quantityRejected),
                  libelle(LIBELLES_DECISION_QUALITE, controle.decision),
                ],
              }))}
              messageVide="Aucun controle rattache."
            />
          </Carte>
        </Section>
      )}

      {lots.length > 0 && (
        <Section titre="Lots en quarantaine pour cet article">
          <Carte sansPadding>
            <Tableau
              colonnes={[
                { cle: "lot", libelle: "Lot" },
                { cle: "statut", libelle: "Statut du lot" },
                { cle: "article", libelle: "Article" },
                { cle: "depot", libelle: "Depot" },
              ]}
              lignes={lots.map((lot) => ({
                cle: String(lot.id),
                cellules: [
                  lot.lotNumber,
                  libelle(LIBELLES_STATUT_STOCK, lot.status),
                  lot.item ? `${lot.item.code} — ${lot.item.label1}` : "Article non renseigne",
                  lot.warehouse
                    ? `${lot.warehouse.code} — ${lot.warehouse.label}`
                    : "Depot non renseigne",
                ],
              }))}
              messageVide="Aucun lot en quarantaine."
            />
          </Carte>
          <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
            La decision de liberer ou de rebuter ces quantites se prend sur la page des articles a
            liberer, qui enregistre le mouvement de stock correspondant.
          </p>
        </Section>
      )}

      <Section titre="Historique de la fiche">
        <Carte
          description="Chaque etape enregistree dans le journal d'audit, la plus recente en premier."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "date", libelle: "Date" },
              { cle: "action", libelle: "Action" },
              { cle: "utilisateur", libelle: "Utilisateur" },
              { cle: "commentaire", libelle: "Commentaire" },
              { cle: "avant", libelle: "Valeur precedente" },
              { cle: "apres", libelle: "Nouvelle valeur" },
            ]}
            lignes={historique.lignes.map((entree) => ({
              cle: String(entree.id),
              cellules: [
                formatDateTime(entree.createdAt),
                `${entree.action} (${entree.module})`,
                entree.user?.email ?? entree.userEmail ?? "Non renseigne",
                entree.comment ?? "-",
                resumeJson(entree.oldValue),
                resumeJson(entree.newValue),
              ],
            }))}
            messageVide="Aucune trace d'audit pour cette fiche."
          />
        </Carte>
      </Section>

      <Section titre="Actions de traitement">
        {!peutGerer && (
          <Alerte ton="alerte" titre="Droit de gestion des non-conformites absent">
            Vous consultez cette fiche sans pouvoir la modifier : la permission « gestion des
            non-conformites » est requise, et le serveur la revalide de toute facon a chaque envoi.
          </Alerte>
        )}

        {peutGerer && estClose && (
          <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
            Fiche cloturee : aucune action supplementaire n&apos;est possible. Le service refuse
            toute modification d&apos;une non-conformite cloturee.
          </p>
        )}

        {peutGerer && !estClose && (
          <div className="space-y-5">
            {!estRejetee && statut !== "EN_ANALYSE" && (
              <Carte
                titre="Mettre en analyse"
                description="Ouvre l'analyse de l'ecart et designe le responsable du traitement. Aucune quantite de stock n'est touchee."
              >
                <FormulaireAction
                  action={actionMettreEnAnalyse}
                  libelleSoumettre="Mettre en analyse"
                  varianteSoumettre="secondaire"
                  reinitialiser
                >
                  <input type="hidden" name="nonConformiteId" value={nonConformite.id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Champ
                      nom="assignedToId"
                      libelle="Responsable du traitement"
                      type="select"
                      valeur={nonConformite.assignedToId ?? ""}
                      options={employes.map((employe) => ({
                        valeur: employe.id,
                        libelle: `${employe.lastName} ${employe.firstName} (${employe.matricule})`,
                      }))}
                    />
                  </div>
                  <div className="mt-4">
                    <Champ
                      nom="commentaire"
                      libelle="Commentaire de mise en analyse"
                      type="textarea"
                      requis
                      maxLength={1000}
                      aide="Obligatoire, au moins 10 caracteres : il est conserve dans l'historique."
                    />
                  </div>
                </FormulaireAction>
              </Carte>
            )}

            {!estRejetee && (
              <Carte
                titre="Statuer : cause racine, action corrective et decision qualite"
                description="Le service qualite enregistre la decision et l'analyse. La decision porte sur la marchandise concernee : acceptee, acceptee sous reserve, mise en quarantaine ou rejetee."
              >
                <FormulaireAction
                  action={actionStatuerNonConformite}
                  libelleSoumettre="Enregistrer la decision"
                  varianteSoumettre="primaire"
                  reinitialiser
                >
                  <input type="hidden" name="nonConformiteId" value={nonConformite.id} />
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Champ
                      nom="decision"
                      libelle="Decision qualite"
                      type="select"
                      requis
                      valeur={nonConformite.decision ?? ""}
                      options={DECISIONS.map((valeur) => ({
                        valeur,
                        libelle: libelle(LIBELLES_DECISION_QUALITE, valeur),
                      }))}
                    />
                    <Champ
                      nom="coutImpact"
                      libelle="Cout estime"
                      type="number"
                      pas="0.0001"
                      min="0"
                      valeur={D.toFixed(nonConformite.costImpact, 4)}
                    />
                    <Champ
                      nom="assignedToId"
                      libelle="Responsable du traitement"
                      type="select"
                      valeur={nonConformite.assignedToId ?? ""}
                      options={employes.map((employe) => ({
                        valeur: employe.id,
                        libelle: `${employe.lastName} ${employe.firstName} (${employe.matricule})`,
                      }))}
                    />
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Champ
                      nom="rootCause"
                      libelle="Cause racine"
                      type="textarea"
                      requis
                      maxLength={1000}
                      valeur={nonConformite.rootCause ?? ""}
                      aide="Obligatoire, au moins 10 caracteres."
                    />
                    <Champ
                      nom="correctiveAction"
                      libelle="Action corrective"
                      type="textarea"
                      requis
                      maxLength={1000}
                      valeur={nonConformite.correctiveAction ?? ""}
                      aide="Obligatoire, au moins 10 caracteres."
                    />
                  </div>
                  <div className="mt-4">
                    <Champ
                      nom="commentaire"
                      libelle="Commentaire de decision"
                      type="textarea"
                      requis
                      maxLength={1000}
                      aide="Obligatoire, au moins 10 caracteres."
                    />
                  </div>
                </FormulaireAction>
              </Carte>
            )}

            {!estRejetee && (
              <Carte
                titre="Mettre en reprise"
                description="La quantite declaree est celle engagee dans la reprise : elle fait foi pour la suite du traitement."
              >
                <FormulaireAction
                  action={actionMettreEnReprise}
                  libelleSoumettre="Mettre en reprise"
                  varianteSoumettre="secondaire"
                  reinitialiser
                >
                  <input type="hidden" name="nonConformiteId" value={nonConformite.id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Champ
                      nom="quantiteConcernee"
                      libelle="Quantite mise en reprise"
                      type="number"
                      pas="0.001"
                      min="0.001"
                      requis
                      valeur={quantiteCourante}
                    />
                  </div>
                  <div className="mt-4">
                    <Champ
                      nom="commentaire"
                      libelle="Commentaire de mise en reprise"
                      type="textarea"
                      requis
                      maxLength={1000}
                      aide="Obligatoire, au moins 10 caracteres."
                    />
                  </div>
                </FormulaireAction>
              </Carte>
            )}

            {!estRejetee && (
              <Carte
                titre="Rejeter la non-conformite"
                description="Le cas est clos sans suite : la quantite declaree est celle concernee par le rejet, et le motif est conserve."
              >
                <FormulaireAction
                  action={actionRejeterNonConformite}
                  libelleSoumettre="Rejeter la fiche"
                  varianteSoumettre="danger"
                  reinitialiser
                >
                  <input type="hidden" name="nonConformiteId" value={nonConformite.id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Champ
                      nom="quantiteConcernee"
                      libelle="Quantite concernee par le rejet"
                      type="number"
                      pas="0.001"
                      min="0.001"
                      requis
                      valeur={quantiteCourante}
                    />
                  </div>
                  <div className="mt-4">
                    <Champ
                      nom="commentaire"
                      libelle="Motif du rejet"
                      type="textarea"
                      requis
                      maxLength={1000}
                      aide="Obligatoire, au moins 10 caracteres."
                    />
                  </div>
                </FormulaireAction>
              </Carte>
            )}

            <Carte
              titre="Cloturer la non-conformite"
              description="La cloture est definitive : la fiche reste consultable mais ne peut plus etre modifiee."
            >
              <FormulaireAction
                action={actionCloturerNonConformite}
                libelleSoumettre="Cloturer la fiche"
                varianteSoumettre="danger"
                reinitialiser
              >
                <input type="hidden" name="nonConformiteId" value={nonConformite.id} />
                <Champ
                  nom="commentaire"
                  libelle="Commentaire de cloture"
                  type="textarea"
                  requis
                  maxLength={1000}
                  aide="Obligatoire, au moins 10 caracteres : il est conserve dans l'historique."
                />
              </FormulaireAction>
            </Carte>
          </div>
        )}
      </Section>
    </>
  );
}
