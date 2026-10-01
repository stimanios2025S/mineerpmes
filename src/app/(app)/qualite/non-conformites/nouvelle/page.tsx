import Link from "next/link";
import { prisma } from "@/lib/db";
import { actionCreerNonConformite } from "@/actions/qualite";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  Alerte,
  Carte,
  EnTetePage,
  ListeDefinitions,
  Section,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import {
  LIBELLES_SOURCE_NON_CONFORMITE,
  LIBELLES_STATUT_ORDRE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Nouvelle non-conformite" };

/**
 * Ouverture d'une fiche de non-conformite.
 *
 * La fiche est volontairement decrite par des faits : article, ordre de
 * fabrication, quantite reellement concernee, detecteur. Le cout estime reste
 * facultatif tant qu'il n'est pas chiffre : il n'est jamais suppose a zero
 * silencieusement par l'interface.
 */

const SOURCES = [
  "RECEPTION",
  "PRODUCTION",
  "CONTROLE_FINAL",
  "CLIENT",
  "INVENTAIRE",
] as const;

export default async function PageNouvelleNonConformite() {
  const utilisateur = await exigerPermission(PERMISSIONS.QUALITE_NONCONFORMITE_GERER);

  const [articles, ordres, tiers, employes] = await Promise.all([
    prisma.item.findMany({
      where: { status: "ACTIF" },
      orderBy: { code: "asc" },
      take: 300,
      select: { id: true, code: true, label1: true, unitCode: true },
    }),
    prisma.workOrder.findMany({
      where: { status: { notIn: ["ANNULE", "CLOTURE"] } },
      orderBy: { id: "desc" },
      take: 200,
      select: {
        id: true,
        number: true,
        status: true,
        item: { select: { code: true, label1: true } },
      },
    }),
    prisma.thirdParty.findMany({
      where: { OR: [{ isSupplier: true }, { isClient: true }] },
      orderBy: { code: "asc" },
      take: 300,
      select: { id: true, code: true, label1: true, isSupplier: true, isClient: true },
    }),
    prisma.employee.findMany({
      where: { isActive: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 300,
      select: { id: true, firstName: true, lastName: true, matricule: true },
    }),
  ]);

  return (
    <>
      <EnTetePage
        titre="Ouvrir une non-conformite"
        description="La fiche enregistre l'ecart constate. Son analyse, son action corrective et sa decision qualite se saisissent ensuite depuis la fiche elle-meme."
        actions={
          <Link className="lien-nav text-sm" href="/qualite/non-conformites">
            Retour au registre
          </Link>
        }
      />

      <div className="mb-5">
        <Alerte ton="info" titre="Ce qui est enregistre ici">
          Une non-conformite ouverte ne modifie aucun stock : elle constate un ecart. La mise au
          rebut ou la reprise d&apos;une quantite releve d&apos;une decision ulterieure, tracee dans
          la fiche puis dans le grand livre de stock.
        </Alerte>
      </div>

      <Carte
        titre="Fiche de non-conformite"
        description="Tous les champs marques d'une etoile sont obligatoires et verifies cote serveur."
      >
        <ListeDefinitions
          elements={[
            {
              terme: "Detecteur enregistre",
              valeur: utilisateur.employeeName ?? utilisateur.email,
            },
            {
              terme: "Rattachement employe",
              valeur:
                utilisateur.employeeId === null
                  ? "Aucun employe rattache a votre compte : le detecteur ne sera pas renseigne"
                  : `Employe n° ${utilisateur.employeeId}`,
            },
          ]}
        />

        <div className="mt-5">
          <FormulaireAction
            action={actionCreerNonConformite}
            libelleSoumettre="Ouvrir la non-conformite"
            varianteSoumettre="primaire"
            reinitialiser
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Champ
                nom="source"
                libelle="Origine de la non-conformite"
                type="select"
                requis
                valeur="RECEPTION"
                options={SOURCES.map((valeur) => ({
                  valeur,
                  libelle: libelle(LIBELLES_SOURCE_NON_CONFORMITE, valeur),
                }))}
              />
              <Champ
                nom="quantite"
                libelle="Quantite concernee"
                type="number"
                pas="0.001"
                min="0.001"
                requis
                aide="Quantite reellement touchee par l'ecart, jamais la quantite du lot entier."
              />
              <Champ
                nom="coutImpact"
                libelle="Cout estime"
                type="number"
                pas="0.0001"
                min="0"
                aide="Facultatif. Laissez vide si le cout n'est pas chiffre : aucun cout n'est suppose."
              />
              <Champ
                nom="itemId"
                libelle="Article concerne"
                type="select"
                options={articles.map((article) => ({
                  valeur: article.id,
                  libelle: `${article.code} — ${article.label1}`,
                }))}
              />
              <Champ
                nom="workOrderId"
                libelle="Ordre de fabrication"
                type="select"
                options={ordres.map((ordre) => ({
                  valeur: ordre.id,
                  libelle: `${ordre.number} — ${ordre.item.code} — ${libelle(
                    LIBELLES_STATUT_ORDRE,
                    ordre.status,
                  )}`,
                }))}
              />
              <Champ
                nom="thirdPartyId"
                libelle="Fournisseur ou client"
                type="select"
                options={tiers.map((tiers) => ({
                  valeur: tiers.id,
                  libelle: `${tiers.code} — ${tiers.label1}${
                    tiers.isSupplier ? " (fournisseur)" : ""
                  }${tiers.isClient ? " (client)" : ""}`,
                }))}
                aide="Obligatoire lorsque l'origine est un retour client."
              />
              <Champ
                nom="assignedToId"
                libelle="Responsable du traitement"
                type="select"
                options={employes.map((employe) => ({
                  valeur: employe.id,
                  libelle: `${employe.lastName} ${employe.firstName} (${employe.matricule})`,
                }))}
                aide="L'employe charge de l'analyse et de l'action corrective."
              />
            </div>

            <div className="mt-5">
              <Champ
                nom="description"
                libelle="Description de l'ecart constate"
                type="textarea"
                requis
                maxLength={2000}
                aide="Au moins 5 caracteres. Decrivez le fait constate, sans conclure sur sa cause : la cause racine se saisit lors de l'analyse."
              />
            </div>

            <Section titre="Rappel des regles appliquees par le serveur">
              <ul className="list-disc pl-5 text-sm" style={{ color: "var(--texte-doux)" }}>
                <li>La quantite concernee doit etre strictement positive.</li>
                <li>
                  Une origine « retour client » doit designer le client concerne : sans tiers, la
                  fiche ne serait rattachable a aucune reclamation.
                </li>
                <li>
                  Chaque changement de statut ulterieur (analyse, reprise, rejet, cloture) exigera
                  un commentaire ecrit.
                </li>
              </ul>
            </Section>
          </FormulaireAction>
        </div>
      </Carte>
    </>
  );
}
