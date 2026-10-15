import Link from "next/link";
import { prisma } from "@/lib/db";
import { aLaPermission, exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS, getPermissionLabel } from "@/lib/rbac/permissions";
import { actionCreerEmploye, actionCreerEmployeEtCompte } from "@/actions/rh";
import { Alerte, Carte, EnTetePage, Section } from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { AteliersEtDepots } from "@/components/ateliers-et-depots";
import { DEVISE_PAR_DEFAUT } from "@/lib/format";
import { LIBELLES_USINE, libelle } from "@/lib/libelles";

import { FormulaireInscriptionEmploye } from "@/components/inscription-employe";
import { peutCreerAccesEmploye } from "@/lib/rh/inscription";

export const metadata = { title: "Nouvel employe" };

/**
 * Creation d'une fiche employe.
 *
 * Le bloc salarial n'est rendu que si l'auteur detient `RH_SALAIRE_LIRE`. Sans
 * cette permission, les champs n'existent pas dans le formulaire et l'action
 * serveur ne les lit pas : aucune valeur salariale ne peut donc etre transmise
 * par un profil non autorise.
 */
export default async function PageNouvelEmploye() {
  const utilisateur = await exigerPermission(PERMISSIONS.RH_ECRIRE);
  const portee = usinesAutorisees(utilisateur);
  const accesAutomatique = peutCreerAccesEmploye(utilisateur);
  const usinesDeProduction = portee.filter((usine) => usine !== "COMMUN");
  const voitSalaires = aLaPermission(utilisateur, PERMISSIONS.RH_SALAIRE_LIRE);

  // Quand la division est IMPOSEE — une seule usine de production dans le
  // perimetre, le champ est alors masque — les ateliers et les depots proposes
  // doivent etre ceux de CETTE usine, et d'elle seule.
  //
  // Ils etaient tires de tout le perimetre : un proprietaire ADMEDCO se voyait
  // proposer des ateliers et des depots MOBILIX dans la liste deroulante, et ne
  // decouvrait le refus qu'a la soumission. Une liste qui propose ce qui sera
  // refuse n'est pas une liste.
  const usineImposee =
    accesAutomatique && usinesDeProduction.length === 1 ? usinesDeProduction : null;
  const perimetreListes = usineImposee ?? portee;

  const [ateliers, depots] = await Promise.all([
    prisma.workshop.findMany({
      where: { isActive: true, factory: { in: perimetreListes } },
      orderBy: [{ factory: "asc" }, { code: "asc" }],
      take: 200,
      select: { id: true, code: true, label: true, factory: true },
    }),
    prisma.warehouse.findMany({
      where: { isActive: true, factory: { in: perimetreListes } },
      orderBy: { code: "asc" },
      take: 200,
      select: { id: true, code: true, label: true, factory: true },
    }),
  ]);

  const champs = (
    <>
      {accesAutomatique && usinesDeProduction.length === 1 ? (
        <div className="mb-3"><input type="hidden" name="factory" value={usinesDeProduction[0]} /><p className="font-medium">Usine : {usinesDeProduction[0]}</p></div>
      ) : (
        <Champ
          nom="factory"
          libelle="Division"
          type="select"
          requis
          options={(accesAutomatique ? usinesDeProduction : portee).map((usine) => ({
            valeur: usine,
            libelle: libelle(LIBELLES_USINE, usine),
          }))}
        />
      )}
      <Section titre="Identite">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Champ nom="matricule" libelle={accesAutomatique ? "Matricule existant (facultatif)" : "Matricule"} requis={!accesAutomatique} maxLength={40} aide={accesAutomatique ? "Laissez vide pour generer un matricule unique." : undefined} />
          <Champ nom="lastName" libelle="Nom" requis maxLength={80} />
          <Champ nom="firstName" libelle="Prenom" requis maxLength={80} />
        </div>
      </Section>
      <details className="mt-4 rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">Informations complementaires (facultatif)</summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Champ nom="jobTitle" libelle="Poste occupe" maxLength={120} />
          <Champ
            nom="gender"
            libelle="Genre"
            type="select"
            options={[
              { valeur: "M", libelle: "Masculin" },
              { valeur: "F", libelle: "Feminin" },
            ]}
          />
          <Champ nom="birthDate" libelle="Date de naissance" type="date" />
          <Champ
            nom="socialSecurityNumber"
            libelle="Numero de securite sociale"
            maxLength={40}
          />
          <Champ nom="ccp" libelle="Compte CCP" maxLength={40} />
        </div>

        <Section titre="Coordonnees">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Champ nom="phone" libelle="Telephone" maxLength={30} />
            <Champ nom="phone2" libelle="Telephone secondaire" maxLength={30} />
            <Champ nom="email" libelle="Adresse electronique (facultatif)" type="email" aide="Si renseignee, elle servira aussi d'identifiant. Sinon, un identifiant sera genere." />
            <Champ nom="address" libelle="Adresse" maxLength={200} />
            <Champ nom="city" libelle="Commune / ville" maxLength={80} />
          </div>
        </Section>

        <Section titre="Contrat et affectation">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <AteliersEtDepots ateliers={ateliers} depots={depots} />
            <Champ nom="contractType" libelle="Type de contrat" maxLength={60} />
            <Champ nom="hireDate" libelle="Date d'embauche" type="date" />
            <Champ nom="endDate" libelle="Date de fin de contrat" type="date" />
          </div>
        </Section>

        {voitSalaires ? (
          <Section titre="Donnees salariales">
            <Alerte ton="alerte" titre="Donnees protegees">
              {`Ces montants ne sont consultables qu'avec la permission « ${getPermissionLabel(
                PERMISSIONS.RH_SALAIRE_LIRE,
              )} ». Ils ne sont jamais repris dans les listes d'employes.`}
            </Alerte>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Champ
                nom="baseSalary"
                libelle={`Salaire de base (${DEVISE_PAR_DEFAUT})`}
                type="number"
                pas="0.01"
                min="0"
              />
              <Champ
                nom="salaryPerDay"
                libelle={`Salaire journalier (${DEVISE_PAR_DEFAUT})`}
                type="number"
                pas="0.01"
                min="0"
              />
            </div>
          </Section>
        ) : (
          <Section titre="Donnees salariales">
            <Alerte ton="neutre" titre="Champs non disponibles">
              Votre profil ne detient pas la permission de consultation des
              salaires : ces champs ne sont ni affiches ni transmis.
            </Alerte>
          </Section>
        )}
      </details>
    </>
  );

  return (
    <>
      <EnTetePage
        titre="Nouvel employe"
        description="Ajoutez un employe de votre usine. Le matricule et les acces operateur peuvent etre generes automatiquement."
        actions={
          <Link className="lien-nav text-sm" href="/rh/employes">
            Retour a la liste
          </Link>
        }
      />

      <Alerte ton="info" titre={accesAutomatique ? "Creation en une etape" : "Fiche employe"}>
        {accesAutomatique
          ? "Renseignez le nom et le prenom. Le matricule, l'identifiant et le mot de passe temporaire seront generes. Le compte est limite au role operateur de l'usine choisie."
          : "La fiche est creee sans compte. La creation d'un acces reste reservee au proprietaire ou a l'administrateur."}
      </Alerte>

      <div className="mt-5">
        <Carte titre="Fiche employe">
          {accesAutomatique ? (
            <FormulaireInscriptionEmploye action={actionCreerEmployeEtCompte} libelleSoumettre="Creer l'employe et ses acces">
              {champs}
            </FormulaireInscriptionEmploye>
          ) : (
            <FormulaireAction action={actionCreerEmploye} libelleSoumettre="Creer la fiche employe">
              {champs}
            </FormulaireAction>
          )}
        </Carte>
      </div>
    </>
  );
}
