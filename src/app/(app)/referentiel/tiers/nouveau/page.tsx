import Link from "next/link";
import { actionCreerTiers } from "@/actions/referentiel";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { Alerte, Carte, EnTetePage } from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { LIBELLES_MODE_REGLEMENT, LIBELLES_TYPE_TIERS, libelle } from "@/lib/libelles";

export const metadata = { title: "Nouveau tiers" };

const NATURES_TIERS = ["CLIENT", "FOURNISSEUR", "EMPLOYE", "AUTRE"] as const;

const MODES_REGLEMENT = [
  "ESPECES",
  "CHEQUE",
  "VIREMENT",
  "TRAITE",
  "CARTE",
  "COMPENSATION",
  "AUTRE",
] as const;

function CaseACocher({
  nom,
  libelle: intitule,
  aide,
  coche = false,
}: {
  nom: string;
  libelle: string;
  aide?: string;
  coche?: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={nom} defaultChecked={coche} className="mt-1" />
      <span>
        <span className="block font-medium">{intitule}</span>
        {aide && (
          <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
            {aide}
          </span>
        )}
      </span>
    </label>
  );
}

export default async function PageNouveauTiers() {
  await exigerPermission(PERMISSIONS.TIERS_ECRIRE);

  return (
    <>
      <EnTetePage
        titre="Nouveau tiers"
        description="Creation d'une fiche client, fournisseur, employe ou autre partenaire. Le solde de la fiche demarre a zero : il ne se saisit jamais, il provient des factures et des reglements."
        actions={
          <Link className="lien-nav text-sm" href="/referentiel/tiers">
            Retour a la liste
          </Link>
        }
      />

      <FormulaireAction
        action={actionCreerTiers}
        libelleSoumettre="Enregistrer le tiers"
        varianteSoumettre="primaire"
        reinitialiser
      >
        <div className="space-y-6">
          <Carte titre="Identification">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Champ
                nom="code"
                libelle="Code tiers"
                requis
                maxLength={40}
                aide="Code unique repris par tous les documents commerciaux."
              />
              <Champ
                nom="naturePrincipale"
                libelle="Nature principale"
                type="select"
                requis
                valeur="CLIENT"
                options={NATURES_TIERS.map((valeur) => ({
                  valeur,
                  libelle: libelle(LIBELLES_TYPE_TIERS, valeur),
                }))}
                aide="Nature affichee par defaut ; les natures ci-dessous determinent les usages reels."
              />
              <Champ nom="libelle1" libelle="Libelle principal" requis maxLength={200} />
              <Champ nom="libelle2" libelle="Libelle secondaire" maxLength={200} />
              <Champ nom="designation" libelle="Designation longue" maxLength={300} />
              <Champ nom="nom" libelle="Nom" maxLength={100} />
              <Champ nom="prenom" libelle="Prenom" maxLength={100} />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <CaseACocher nom="natureClient" libelle="Client" />
              <CaseACocher nom="natureFournisseur" libelle="Fournisseur" />
              <CaseACocher nom="natureEmploye" libelle="Employe" />
              <CaseACocher nom="natureAutre" libelle="Autre tiers" />
            </div>

            <div className="mt-4">
              <Alerte ton="info" titre="Au moins une nature est obligatoire">
                Un tiers sans nature n&apos;apparaitrait ni dans les ventes, ni dans les achats,
                ni dans les listes filtrees : le serveur refuse une fiche sans nature.
              </Alerte>
            </div>
          </Carte>

          <Carte titre="Coordonnees">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Champ nom="adresse1" libelle="Adresse" maxLength={200} />
              <Champ nom="adresse2" libelle="Complement d'adresse" maxLength={200} />
              <Champ nom="ville" libelle="Ville" maxLength={100} />
              <Champ nom="codePostal" libelle="Code postal" maxLength={20} />
              <Champ nom="commune" libelle="Commune" maxLength={100} />
              <Champ nom="wilaya" libelle="Wilaya / departement" maxLength={100} />
              <Champ nom="pays" libelle="Pays" valeur="Algerie" maxLength={100} />
              <Champ nom="telephone1" libelle="Telephone principal" maxLength={40} />
              <Champ nom="telephone2" libelle="Telephone secondaire" maxLength={40} />
              <Champ nom="mobile" libelle="Mobile" maxLength={40} />
              <Champ nom="fax" libelle="Fax" maxLength={40} />
              <Champ nom="email" libelle="Adresse electronique" type="email" maxLength={150} />
              <Champ nom="siteWeb" libelle="Site web" maxLength={200} />
            </div>
          </Carte>

          <Carte
            titre="Identifiants fiscaux et comptables"
            description="Ces identifiants sont repris sur les factures et les declarations. Laissez vide ce qui n'est pas connu : aucune valeur n'est inventee."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Champ nom="identifiantFiscal" libelle="Identifiant fiscal" maxLength={50} />
              <Champ nom="nif" libelle="NIF" maxLength={50} />
              <Champ nom="nis" libelle="NIS" maxLength={50} />
              <Champ nom="rc" libelle="Registre de commerce (RC)" maxLength={50} />
              <Champ nom="ai" libelle="Article d'imposition (AI)" maxLength={50} />
              <Champ nom="ccp" libelle="Compte CCP" maxLength={50} />
              <Champ nom="formeJuridique" libelle="Forme juridique" maxLength={100} />
              <Champ nom="activite" libelle="Activite" maxLength={200} />
              <Champ nom="compteComptable" libelle="Compte comptable" maxLength={30} />
            </div>
          </Carte>

          <Carte
            titre="Conditions de reglement"
            description="Ces conditions sont proposees par defaut sur les documents du tiers ; elles ne modifient aucun document deja etabli."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Champ
                nom="modeReglement"
                libelle="Mode de reglement"
                type="select"
                options={MODES_REGLEMENT.map((valeur) => ({
                  valeur,
                  libelle: libelle(LIBELLES_MODE_REGLEMENT, valeur),
                }))}
              />
              <Champ
                nom="delaiReglement"
                libelle="Delai de reglement (jours)"
                type="number"
                min={0}
                pas="1"
                valeur={0}
              />
              <Champ
                nom="remise"
                libelle="Remise (%)"
                type="number"
                min={0}
                max={100}
                pas="0.01"
                valeur={0}
              />
              <Champ
                nom="majoration"
                libelle="Majoration (%)"
                type="number"
                min={0}
                max={100}
                pas="0.01"
                valeur={0}
              />
              <Champ
                nom="plafondEncours"
                libelle="Plafond d'encours"
                type="number"
                min={0}
                pas="0.01"
                valeur={0}
                aide="0 signifie qu'aucun plafond n'est applique."
              />
              <CaseACocher
                nom="exonereTva"
                libelle="Exonere de TVA"
                aide="Le tiers ne supporte pas la TVA sur ses documents."
              />
            </div>
          </Carte>

          <Carte
            titre="Etat et blocage"
            description="Un tiers bloque reste consultable : il ne peut simplement plus etre utilise sur un nouveau document."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <CaseACocher nom="actif" libelle="Tiers actif" coche />
              <CaseACocher
                nom="bloque"
                libelle="Tiers bloque"
                aide="Le motif est obligatoire cote serveur."
              />
              <Champ
                nom="motifBlocage"
                libelle="Motif du blocage"
                type="textarea"
                maxLength={500}
                aide="Obligatoire des que le blocage est coche (au moins 5 caracteres)."
              />
              <Champ nom="remarque" libelle="Remarque interne" type="textarea" maxLength={1000} />
            </div>
          </Carte>
        </div>
      </FormulaireAction>
    </>
  );
}
