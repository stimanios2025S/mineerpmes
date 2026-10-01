import { actionDefinirRegleEcriture } from "@/actions/comptabilite";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { listerComptes, listerJournaux, listerReglesEcriture } from "@/lib/comptabilite/service";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Statistique,
  Tableau,
  Vide,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatEntier } from "@/lib/format";
import { LIBELLES_TYPE_JOURNAL, libelle } from "@/lib/libelles";

export const metadata = { title: "Regles d'ecriture" };

/**
 * Catalogue des evenements comptables emis par l'application.
 *
 * Aucun numero de compte n'est code en dur dans les services metier : chaque
 * evenement est traduit en ecriture par la regle active ci-dessous. Une regle
 * absente ou inactive bloque la generation : l'application ne devine jamais un
 * compte, elle signale l'evenement.
 */
const EVENEMENTS_COMPTABLES: { code: string; libelle: string; description: string }[] = [
  {
    code: "RECEPTION_FOURNISSEUR",
    libelle: "Reception fournisseur — entree en stock",
    description: "Entree en stock des articles receptionnes, valorisee au cout de la commande.",
  },
  {
    code: "FACTURE_FOURNISSEUR",
    libelle: "Facture fournisseur",
    description: "Enregistrement de la facture fournisseur et de la TVA deductible.",
  },
  {
    code: "FACTURE_CLIENT",
    libelle: "Facture client",
    description: "Vente de produits finis et TVA collectee.",
  },
  {
    code: "SORTIE_STOCK_LIVRAISON",
    libelle: "Sortie de stock pour livraison",
    description: "De stockage des produits finis livres, valorises a leur cout.",
  },
  {
    code: "REGLEMENT_CLIENT",
    libelle: "Reglement client (encaissement)",
    description: "Encaissement d'un reglement client et solde du compte du tiers.",
  },
  {
    code: "REGLEMENT_FOURNISSEUR",
    libelle: "Reglement fournisseur (decaissement)",
    description: "Decaissement d'un reglement fournisseur et solde du compte du tiers.",
  },
  {
    code: "PRODUCTION_PRODUIT_FINI",
    libelle: "Entree en stock de produits finis",
    description: "Valorisation des produits finis issus des ordres de fabrication clotures.",
  },
  {
    code: "CONSOMMATION_PRODUCTION",
    libelle: "Consommation de matieres en production",
    description: "Sortie de stock des matieres consommees par les ordres de fabrication.",
  },
];

export default async function PageReglesEcriture() {
  const utilisateur = await exigerPermission(PERMISSIONS.COMPTABILITE_LIRE);

  const [regles, comptes, journaux] = await Promise.all([
    listerReglesEcriture(),
    listerComptes(),
    listerJournaux(),
  ]);

  const codesDefinis = new Set(regles.map((regle) => regle.eventCode));
  const evenementsSansRegle = EVENEMENTS_COMPTABLES.filter(
    (evenement) => !codesDefinis.has(evenement.code),
  );
  const reglesInactives = regles.filter((regle) => !regle.isActive);

  const peutGerer = utilisateur.permissions.includes(PERMISSIONS.COMPTABILITE_REGLES_GERER);

  const optionsComptes = comptes.map((compte) => ({
    valeur: compte.number,
    libelle: `${compte.number} — ${compte.label}`,
  }));
  const optionsJournaux = journaux.map((journal) => ({
    valeur: journal.code,
    libelle: `${journal.code} — ${libelle(LIBELLES_TYPE_JOURNAL, journal.type)}`,
  }));

  return (
    <>
      <EnTetePage
        titre="Regles d'ecriture"
        description="Chaque evenement metier est traduit en ecriture par une regle configurable. Une regle absente ou inactive empeche la generation : l'evenement est signale, jamais devine."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistique libelle="Regles definies" valeur={formatEntier(regles.length)} />
        <Statistique
          libelle="Evenements sans regle"
          valeur={formatEntier(evenementsSansRegle.length)}
          ton={evenementsSansRegle.length > 0 ? "alerte" : "succes"}
          detail="La generation d'ecriture echouera pour ces evenements"
        />
        <Statistique
          libelle="Regles inactives"
          valeur={formatEntier(reglesInactives.length)}
          ton={reglesInactives.length > 0 ? "alerte" : "succes"}
          detail="Une regle inactive equivaut a une regle absente"
        />
        <Statistique
          libelle="Comptes disponibles"
          valeur={formatEntier(comptes.length)}
          detail={`${formatEntier(journaux.length)} journaux actifs`}
        />
      </div>

      {evenementsSansRegle.length > 0 && (
        <div className="mb-5">
          <Alerte ton="alerte" titre="Evenements comptables non couverts">
            <p>
              Les evenements suivants n'ont aucune regle : aucune ecriture ne sera generee tant
              qu'une regle ne sera pas definie.
            </p>
            <ul className="mt-2 list-disc pl-5">
              {evenementsSansRegle.map((evenement) => (
                <li key={evenement.code}>
                  {evenement.libelle} <span className="text-xs">({evenement.code})</span>
                </li>
              ))}
            </ul>
          </Alerte>
        </div>
      )}

      <div className="space-y-5">
        <Carte titre="Regles configurees" sansPadding>
          {regles.length === 0 ? (
            <Vide message="Aucune regle d'ecriture n'est definie : les evenements comptables ne peuvent pas etre traduits en ecritures." />
          ) : (
            <Tableau
              colonnes={[
                { cle: "evenement", libelle: "Evenement" },
                { cle: "libelle", libelle: "Libelle" },
                { cle: "journal", libelle: "Journal" },
                { cle: "debit", libelle: "Compte a debiter" },
                { cle: "credit", libelle: "Compte a crediter" },
                { cle: "tva", libelle: "Compte de TVA" },
                { cle: "etat", libelle: "Etat" },
              ]}
              lignes={regles.map((regle) => ({
                cle: String(regle.id),
                cellules: [
                  regle.eventCode,
                  regle.label,
                  regle.journalCode,
                  regle.debitAccountNumber,
                  regle.creditAccountNumber,
                  regle.vatAccountNumber ?? "-",
                  <EtiquetteStatut
                    key="etat"
                    libelle={regle.isActive ? "Active" : "Inactive"}
                    code={regle.isActive ? "ACTIF" : "INACTIF"}
                  />,
                ],
              }))}
            />
          )}
        </Carte>

        {evenementsSansRegle.length > 0 && (
          <Carte
            titre="Evenements attendus sans regle"
            description="Ces evenements sont emis par les modules achats, ventes, reglements, stock et production."
            sansPadding
          >
            <Tableau
              colonnes={[
                { cle: "code", libelle: "Code" },
                { cle: "libelle", libelle: "Evenement" },
                { cle: "description", libelle: "Description" },
              ]}
              lignes={evenementsSansRegle.map((evenement) => ({
                cle: evenement.code,
                cellules: [evenement.code, evenement.libelle, evenement.description],
              }))}
            />
          </Carte>
        )}

        {peutGerer ? (
          <Carte
            titre="Definir ou mettre a jour une regle"
            description="Un code d'evenement deja configure est mis a jour, un nouveau code cree une regle. Les ecritures deja comptabilisees ne sont jamais modifiees : leur correction passe par une contre-passation."
          >
            <FormulaireAction
              action={actionDefinirRegleEcriture}
              libelleSoumettre="Enregistrer la regle"
              rafraichir
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Champ
                  nom="eventCode"
                  libelle="Code d'evenement"
                  type="select"
                  requis
                  options={EVENEMENTS_COMPTABLES.map((evenement) => ({
                    valeur: evenement.code,
                    libelle: `${evenement.code} — ${evenement.libelle}`,
                  }))}
                  aide="Le code identifie l'evenement metier declencheur."
                />
                <Champ
                  nom="label"
                  libelle="Libelle de la regle"
                  requis
                  maxLength={120}
                  aide="Exemple : Facture client."
                />
                <Champ
                  nom="journalCode"
                  libelle="Journal"
                  type="select"
                  requis
                  options={optionsJournaux}
                />
                <Champ
                  nom="debitAccountNumber"
                  libelle="Compte a debiter"
                  type="select"
                  requis
                  options={optionsComptes}
                />
                <Champ
                  nom="creditAccountNumber"
                  libelle="Compte a crediter"
                  type="select"
                  requis
                  options={optionsComptes}
                />
                <Champ
                  nom="vatAccountNumber"
                  libelle="Compte de TVA (facultatif)"
                  type="select"
                  options={optionsComptes}
                  aide="Laisser vide si l'evenement ne porte pas de TVA."
                />
                <Champ
                  nom="vatRateCode"
                  libelle="Code de taux de TVA (facultatif)"
                  maxLength={20}
                  aide="Taux applique par defaut lors de la generation de l'ecriture."
                />
                <Champ nom="description" libelle="Description (facultatif)" maxLength={300} />
              </div>
            </FormulaireAction>
          </Carte>
        ) : (
          <Alerte ton="info">
            La modification des regles d'ecriture exige la permission dediee. Vous pouvez consulter
            la configuration mais pas la modifier.
          </Alerte>
        )}

        <Carte titre="Rappel sur les contre-passations">
          <p className="text-sm">
            Une ecriture extournee porte le code de la regle d'origine suffixe{" "}
            <Etiquette>_EXTOURNE</Etiquette>. Elle est produite par l'application au moment de
            l'annulation et n'a pas a etre configuree ici.
          </p>
        </Carte>
      </div>
    </>
  );
}
