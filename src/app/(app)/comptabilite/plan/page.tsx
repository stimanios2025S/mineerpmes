import { actionCreerCompte } from "@/actions/comptabilite";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { listerComptes, listerJournaux } from "@/lib/comptabilite/service";
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
import { premiereValeur } from "@/lib/liste";
import { LIBELLES_TYPE_COMPTE, LIBELLES_TYPE_JOURNAL, libelle } from "@/lib/libelles";

export const metadata = { title: "Plan comptable" };

const CHEMIN = "/comptabilite/plan";

export default async function PagePlanComptable({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.COMPTABILITE_LIRE);

  const parametres = await searchParams;
  const typeFiltre = premiereValeur(parametres, "type");

  const [comptes, journaux] = await Promise.all([
    listerComptes({
      type: (typeFiltre as never) ?? undefined,
      actifsSeulement: false,
    }),
    listerJournaux(),
  ]);

  const tousComptes = typeFiltre ? await listerComptes({ actifsSeulement: false }) : comptes;
  const comptesAnalytiques = tousComptes.filter((compte) => compte.isAnalytic);
  const comptesInactifs = tousComptes.filter((compte) => !compte.isActive);

  const peutGererPlan = utilisateur.permissions.includes(PERMISSIONS.PLAN_COMPTABLE_GERER);

  const optionsTypes = Object.entries(LIBELLES_TYPE_COMPTE).map(([code, libelleType]) => ({
    valeur: code,
    libelle: libelleType,
  }));

  const optionsParents = tousComptes.map((compte) => ({
    valeur: compte.number,
    libelle: `${compte.number} — ${compte.label}`,
  }));

  return (
    <>
      <EnTetePage
        titre="Plan comptable"
        description="Comptes et journaux utilises par les regles d'ecriture. Un compte utilise par une ecriture comptabilisee ne peut pas etre supprime : il est desactive."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistique
          libelle="Comptes au plan"
          valeur={formatEntier(tousComptes.length)}
          detail={`${formatEntier(comptes.length)} affiches apres filtre`}
        />
        <Statistique
          libelle="Comptes analytiques"
          valeur={formatEntier(comptesAnalytiques.length)}
          detail="Comptes de reclassement analytique"
        />
        <Statistique
          libelle="Comptes inactifs"
          valeur={formatEntier(comptesInactifs.length)}
          ton={comptesInactifs.length > 0 ? "alerte" : "succes"}
          detail="Un compte inactif ne peut plus recevoir d'ecriture"
        />
        <Statistique
          libelle="Journaux actifs"
          valeur={formatEntier(journaux.length)}
          detail={`${formatEntier(
            journaux.reduce((total, journal) => total + journal._count.entries, 0),
          )} ecritures rattachees`}
        />
      </div>

      <Carte titre="Filtrer par type de compte">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Type de compte</span>
            <select className="champ" name="type" defaultValue={typeFiltre ?? ""}>
              <option value="">Tous les types</option>
              {optionsTypes.map((option) => (
                <option key={option.valeur} value={option.valeur}>
                  {option.libelle}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-3">
            <button
              type="submit"
              className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
              style={{ background: "var(--primaire)", color: "#ffffff", borderColor: "var(--primaire)" }}
            >
              Filtrer
            </button>
            <a className="lien-nav text-sm" href={CHEMIN}>
              Reinitialiser
            </a>
          </div>
        </form>
      </Carte>

      <div className="mt-5 space-y-5">
        <Carte titre="Comptes" sansPadding>
          {comptes.length === 0 ? (
            <Vide message="Aucun compte ne correspond au filtre selectionne." />
          ) : (
            <Tableau
              colonnes={[
                { cle: "numero", libelle: "Numero" },
                { cle: "libelle", libelle: "Libelle" },
                { cle: "type", libelle: "Type" },
                { cle: "parent", libelle: "Compte parent" },
                { cle: "analytique", libelle: "Analytique" },
                { cle: "etat", libelle: "Etat" },
              ]}
              lignes={comptes.map((compte) => ({
                cle: compte.number,
                cellules: [
                  compte.number,
                  compte.label,
                  <EtiquetteStatut
                    key="type"
                    libelle={libelle(LIBELLES_TYPE_COMPTE, compte.type)}
                    code={compte.type}
                  />,
                  compte.parentNumber ?? "-",
                  compte.isAnalytic ? <Etiquette key="an">Analytique</Etiquette> : "-",
                  <EtiquetteStatut
                    key="etat"
                    libelle={compte.isActive ? "Actif" : "Inactif"}
                    code={compte.isActive ? "ACTIF" : "INACTIF"}
                  />,
                ],
              }))}
            />
          )}
        </Carte>

        <Carte titre="Journaux" sansPadding>
          {journaux.length === 0 ? (
            <Vide message="Aucun journal actif n'est configure." />
          ) : (
            <Tableau
              colonnes={[
                { cle: "code", libelle: "Code" },
                { cle: "libelle", libelle: "Libelle" },
                { cle: "type", libelle: "Type" },
                { cle: "ecritures", libelle: "Ecritures", nombre: true },
              ]}
              lignes={journaux.map((journal) => ({
                cle: journal.code,
                cellules: [
                  journal.code,
                  journal.label,
                  libelle(LIBELLES_TYPE_JOURNAL, journal.type),
                  formatEntier(journal._count.entries),
                ],
              }))}
            />
          )}
        </Carte>

        {peutGererPlan ? (
          <Carte
            titre="Creer un compte"
            description="Un compte deja utilise par une ecriture comptabilisee ne peut pas etre supprime : le rendre inactif empeche seulement de nouvelles imputations."
          >
            <FormulaireAction action={actionCreerCompte} libelleSoumettre="Creer le compte" rafraichir>
              <div className="grid gap-4 sm:grid-cols-2">
                <Champ
                  nom="number"
                  libelle="Numero de compte"
                  requis
                  maxLength={20}
                  aide="Numero unique, conforme au plan comptable de l'entreprise. Exemple : 411."
                />
                <Champ
                  nom="label"
                  libelle="Libelle du compte"
                  requis
                  maxLength={120}
                  aide="Exemple : Clients."
                />
                <Champ
                  nom="type"
                  libelle="Type de compte"
                  type="select"
                  requis
                  options={optionsTypes}
                />
                <Champ
                  nom="parentNumber"
                  libelle="Compte parent (facultatif)"
                  type="select"
                  options={optionsParents}
                />
                <label className="flex items-center gap-3 text-sm">
                  <input type="checkbox" name="isAnalytic" className="h-5 w-5" />
                  <span>Compte analytique</span>
                </label>
              </div>
              <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
                Une fois un compte cree, les regles d'ecriture peuvent le referencer. Aucun compte
                n'est choisi automatiquement a votre place.
              </p>
            </FormulaireAction>
          </Carte>
        ) : (
          <Alerte ton="info">
            La creation de comptes exige la permission dediee au plan comptable. Vous pouvez
            consulter le plan mais pas le modifier.
          </Alerte>
        )}
      </div>
    </>
  );
}
