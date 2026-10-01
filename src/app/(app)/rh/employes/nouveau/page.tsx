import Link from "next/link";
import { prisma } from "@/lib/db";
import { aLaPermission, exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS, getPermissionLabel } from "@/lib/rbac/permissions";
import { actionCreerEmploye } from "@/actions/rh";
import { Alerte, Carte, EnTetePage, Section } from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { DEVISE_PAR_DEFAUT } from "@/lib/format";
import { LIBELLES_USINE, libelle } from "@/lib/libelles";

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
  const voitSalaires = aLaPermission(utilisateur, PERMISSIONS.RH_SALAIRE_LIRE);

  const [ateliers, depots] = await Promise.all([
    prisma.workshop.findMany({
      where: { isActive: true, factory: { in: portee } },
      orderBy: [{ factory: "asc" }, { code: "asc" }],
      take: 200,
      select: { id: true, code: true, label: true },
    }),
    prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      take: 200,
      select: { id: true, code: true, label: true },
    }),
  ]);

  return (
    <>
      <EnTetePage
        titre="Nouvel employe"
        description="Une fiche employe n'entraine aucune suppression : la desactivation conserve tout l'historique des affectations, presences et evaluations."
        actions={
          <Link className="lien-nav text-sm" href="/rh/employes">
            Retour a la liste
          </Link>
        }
      />

      <Alerte ton="info" titre="Compte utilisateur">
        La creation de la fiche ne cree aucun compte. Le compte nominatif de
        l'employe s'ouvre ensuite depuis sa fiche : un compte par personne, jamais
        de compte partage.
      </Alerte>

      <div className="mt-5">
        <Carte titre="Fiche employe">
          <FormulaireAction
            action={actionCreerEmploye}
            libelleSoumettre="Creer la fiche employe"
          >
            <Section titre="Identite">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Champ nom="matricule" libelle="Matricule" requis maxLength={40} />
                <Champ nom="lastName" libelle="Nom" requis maxLength={80} />
                <Champ nom="firstName" libelle="Prenom" requis maxLength={80} />
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
            </Section>

            <Section titre="Coordonnees">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Champ nom="phone" libelle="Telephone" maxLength={30} />
                <Champ nom="phone2" libelle="Telephone secondaire" maxLength={30} />
                <Champ nom="email" libelle="Adresse electronique" type="email" />
                <Champ nom="address" libelle="Adresse" maxLength={200} />
                <Champ nom="city" libelle="Commune / ville" maxLength={80} />
              </div>
            </Section>

            <Section titre="Contrat et affectation">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Champ
                  nom="factory"
                  libelle="Division"
                  type="select"
                  requis
                  options={portee.map((usine) => ({
                    valeur: usine,
                    libelle: libelle(LIBELLES_USINE, usine),
                  }))}
                />
                <Champ
                  nom="workshopId"
                  libelle="Atelier de rattachement"
                  type="select"
                  options={ateliers.map((atelier) => ({
                    valeur: atelier.id,
                    libelle: `${atelier.code} — ${atelier.label}`,
                  }))}
                />
                <Champ
                  nom="defaultWarehouseId"
                  libelle="Depot par defaut"
                  type="select"
                  options={depots.map((depot) => ({
                    valeur: depot.id,
                    libelle: `${depot.code} — ${depot.label}`,
                  }))}
                  aide="Depot propose par defaut lors des declarations de l'employe."
                />
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
          </FormulaireAction>
        </Carte>
      </div>
    </>
  );
}
