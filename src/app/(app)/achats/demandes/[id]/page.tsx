import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { identifiantOuNull } from "@/lib/liste";
import { lireParametreTexte, CLE_PARAMETRE } from "@/lib/settings";
import { actionApprouverDemande, actionRefuserDemande, actionSoumettreDemande } from "@/actions/achat";
import {
  Alerte,
  Carte,
  EnTetePage,
  EtiquetteStatut,
  ListeDefinitions,
  Section,
  Tableau,
} from "@/components/ui";
import { BoutonAction, Champ, FormulaireAction, FormulaireMotif } from "@/components/interactif";
import { DEVISE_PAR_DEFAUT, formatDate, formatDateTime, formatMontant, formatQuantite } from "@/lib/format";
import { LIBELLES_STATUT_DEMANDE_ACHAT, libelle } from "@/lib/libelles";

export const metadata = { title: "Demande d'achat" };

/** Libelles francais des operations journalisees, pour l'historique du circuit. */
const LIBELLES_ACTION_AUDIT: Record<string, string> = {
  CREATION: "Creation",
  MODIFICATION: "Modification",
  APPROBATION: "Approbation",
  VALIDATION: "Validation",
  ANNULATION: "Annulation",
  FACTURATION: "Facturation",
};

/** Extrait un statut d'une valeur journalisee, sans jamais interpreter le reste. */
function statutJournalise(valeur: unknown): string | null {
  if (valeur === null || typeof valeur !== "object" || Array.isArray(valeur)) return null;
  const statut = (valeur as { statut?: unknown }).statut;
  return typeof statut === "string" ? statut : null;
}

export default async function PageDemandeAchat({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigerPermission(PERMISSIONS.ACHAT_LIRE);

  const identifiant = identifiantOuNull((await params).id);
  if (identifiant === null) notFound();

  const demande = await prisma.purchaseRequest.findUnique({
    where: { id: identifiant },
    include: {
      supplier: { select: { id: true, code: true, label1: true } },
      lines: {
        orderBy: { lineNo: "asc" },
        include: {
          item: { select: { code: true, label1: true, unitCode: true } },
        },
      },
      orders: { select: { id: true, number: true, status: true } },
    },
  });
  if (!demande) notFound();

  // Les identites ne sont pas portees par des relations : elles sont resolues
  // explicitement pour ne jamais afficher un identifiant technique.
  const identifiants = [demande.requesterId, demande.approvedById].filter(
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

  // Historique d'approbation : le journal d'audit porte les transitions reelles.
  const historique = await prisma.auditLog.findMany({
    where: { entity: "PurchaseRequest", entityId: String(identifiant) },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      action: true,
      createdAt: true,
      userEmail: true,
      comment: true,
      oldValue: true,
      newValue: true,
    },
  });

  const devise = await lireParametreTexte(CLE_PARAMETRE.DEVISE, DEVISE_PAR_DEFAUT);
  const montantEstime = D.sum(
    demande.lines.map((ligne) => D.mul(D.of(ligne.quantity), D.of(ligne.estimatedPrice))),
  );

  const statutTermine =
    demande.status === "APPROUVEE" ||
    demande.status === "REFUSEE" ||
    demande.status === "ANNULEE" ||
    demande.status === "CONVERTIE";

  return (
    <>
      <EnTetePage
        titre={`Demande d'achat ${demande.number}`}
        description="Circuit de validation : soumission, approbation ou refus motive. L'approbation du demandeur par lui-meme est refusee par le service."
        actions={
          <Link className="lien-nav text-sm" href="/achats/demandes">
            Retour a la liste
          </Link>
        }
      />

      <Carte titre="Entete de la demande">
        <ListeDefinitions
          elements={[
            {
              terme: "Statut",
              valeur: (
                <EtiquetteStatut
                  code={demande.status}
                  libelle={libelle(LIBELLES_STATUT_DEMANDE_ACHAT, demande.status)}
                />
              ),
            },
            { terme: "Numero", valeur: demande.number },
            {
              terme: "Demandeur",
              valeur:
                demande.requesterId === null
                  ? "Non renseigne"
                  : (nomUtilisateur.get(demande.requesterId) ?? "Utilisateur inconnu"),
            },
            { terme: "Demandee le", valeur: formatDate(demande.requestedAt) },
            { terme: "Besoin le", valeur: formatDate(demande.neededBy) },
            {
              terme: "Fournisseur propose",
              valeur: demande.supplier
                ? `${demande.supplier.code} — ${demande.supplier.label1}`
                : "Aucun fournisseur propose",
            },
            { terme: "Montant estime", valeur: formatMontant(montantEstime, devise) },
            {
              terme: "Approuvee par",
              valeur: demande.approvedById
                ? (nomUtilisateur.get(demande.approvedById) ?? "Utilisateur inconnu")
                : "En attente",
            },
            { terme: "Approuvee le", valeur: formatDate(demande.approvedAt) },
            {
              terme: "Bon de commande issu",
              valeur:
                demande.orders.length === 0
                  ? "Aucun"
                  : demande.orders.map((commande) => (
                      <Link
                        key={commande.id}
                        className="lien-nav"
                        href={`/achats/commandes/${commande.id}`}
                      >
                        {commande.number}
                      </Link>
                    )),
            },
          ]}
        />
      </Carte>

      <Section titre="Justification et observations">
        <Carte>
          <div className="space-y-3 text-sm">
            <p>
              <span className="font-medium">Justification de la demande : </span>
              {demande.justification ?? "Aucune justification enregistree."}
            </p>
            <p>
              <span className="font-medium">Motif de refus / observations : </span>
              {demande.notes ?? "Aucune observation enregistree."}
            </p>
          </div>
        </Carte>
      </Section>

      <Section titre="Lignes demandees">
        <Carte sansPadding>
          <Tableau
            colonnes={[
              { cle: "ligne", libelle: "Ligne", nombre: true },
              { cle: "article", libelle: "Article" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "unite", libelle: "Unite" },
              { cle: "besoin", libelle: "Besoin le" },
              { cle: "prix", libelle: "Prix estime", nombre: true },
              { cle: "total", libelle: "Montant estime", nombre: true },
              { cle: "note", libelle: "Observation" },
            ]}
            lignes={demande.lines.map((ligne) => ({
              cle: String(ligne.id),
              cellules: [
                String(ligne.lineNo),
                `${ligne.item.code} — ${ligne.item.label1}`,
                formatQuantite(ligne.quantity),
                ligne.unitCode ?? "-",
                formatDate(ligne.neededBy),
                formatMontant(ligne.estimatedPrice, devise),
                formatMontant(D.mul(D.of(ligne.quantity), D.of(ligne.estimatedPrice)), devise),
                ligne.notes ?? "-",
              ],
            }))}
            messageVide="Cette demande ne comporte aucune ligne."
          />
        </Carte>
      </Section>

      <Section titre="Circuit d'approbation">
        <Carte>
          <div className="space-y-5">
            <Alerte ton="info" titre="Regle appliquee par le service">
              La separation des taches est verifiee cote serveur : le demandeur ne peut pas approuver
              sa propre demande. Si tel est le cas, le message renvoye par le serveur s&apos;affichera
              ci-dessous, tel quel.
            </Alerte>

            {demande.status === "BROUILLON" && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Soumettre pour approbation</h3>
                <BoutonAction
                  action={actionSoumettreDemande}
                  libelle="Soumettre la demande"
                  variante="primaire"
                  champsCaches={{ demandeId: demande.id }}
                  confirmation="Soumettre cette demande d'achat pour approbation ?"
                />
              </div>
            )}

            {!statutTermine && (
              <>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Approuver la demande</h3>
                  <FormulaireAction
                    action={actionApprouverDemande}
                    libelleSoumettre="Approuver la demande"
                    varianteSoumettre="primaire"
                  >
                    <Champ nom="demandeId" type="hidden" valeur={demande.id} libelle="Demande" />
                    <Champ
                      nom="commentaire"
                      libelle="Commentaire d'approbation (facultatif)"
                      type="textarea"
                      maxLength={500}
                    />
                  </FormulaireAction>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold">Refuser la demande</h3>
                  <FormulaireMotif
                    action={actionRefuserDemande}
                    libelleSoumettre="Refuser la demande"
                    varianteSoumettre="danger"
                    libelleMotif="Motif du refus (obligatoire)"
                    motifMinimum={5}
                    champsCaches={{ demandeId: demande.id }}
                  />
                </div>
              </>
            )}

            {statutTermine && (
              <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                Cette demande est au statut {libelle(LIBELLES_STATUT_DEMANDE_ACHAT, demande.status)} :
                le circuit d&apos;approbation est clos.
              </p>
            )}
          </div>
        </Carte>
      </Section>

      <Section titre="Historique du circuit">
        <Carte sansPadding>
          <Tableau
            colonnes={[
              { cle: "date", libelle: "Date" },
              { cle: "action", libelle: "Operation" },
              { cle: "utilisateur", libelle: "Utilisateur" },
              { cle: "avant", libelle: "Statut avant" },
              { cle: "apres", libelle: "Statut apres" },
              { cle: "commentaire", libelle: "Motif / commentaire" },
            ]}
            lignes={historique.map((entree) => {
              const avant = statutJournalise(entree.oldValue);
              const apres = statutJournalise(entree.newValue);
              return {
                cle: String(entree.id),
                cellules: [
                  formatDateTime(entree.createdAt),
                  LIBELLES_ACTION_AUDIT[entree.action] ?? entree.action,
                  entree.userEmail ?? "Systeme",
                  avant ? libelle(LIBELLES_STATUT_DEMANDE_ACHAT, avant) : "-",
                  apres ? libelle(LIBELLES_STATUT_DEMANDE_ACHAT, apres) : "-",
                  entree.comment ?? "-",
                ],
              };
            })}
            messageVide="Aucune operation journalisee pour cette demande."
          />
        </Carte>
      </Section>
    </>
  );
}
