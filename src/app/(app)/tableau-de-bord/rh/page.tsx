import Link from "next/link";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { indicateursPilotageRh } from "@/lib/tableau-bord/pilotage";
import { Alerte, Carte, EnTetePage, EtiquetteStatut, Statistique, Tableau } from "@/components/ui";
import { formatDate, formatEntier } from "@/lib/format";
import {
  LIBELLES_FIABILITE,
  LIBELLES_PERIODE_EVALUATION,
  LIBELLES_USINE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Pilotage ressources humaines" };

/**
 * Tableau de bord RH.
 *
 * Aucune donnee salariale n'est affichee ici : la consultation des salaires
 * exige la permission dediee RH_SALAIRE_LIRE et se fait sur la fiche employe.
 * Les evaluations affichees rappellent systematiquement leur niveau de
 * fiabilite : une note calculee sur trop peu de donnees est presentee comme
 * insuffisante et jamais comme un jugement.
 */
export default async function PagePilotageRh() {
  const utilisateur = await exigerPermission(PERMISSIONS.TABLEAU_BORD_RH);
  const indicateurs = await indicateursPilotageRh(utilisateur);

  const peutVoirSalaires = utilisateur.permissions.includes(PERMISSIONS.RH_SALAIRE_LIRE);

  return (
    <>
      <EnTetePage
        titre="Pilotage ressources humaines"
        description="Effectif, presence du jour, affectations quotidiennes, polyvalence et evaluations. Un employe polyvalent peut couvrir plusieurs operations le meme jour : il est evalue sur les operations qu'il a reellement effectuees, jamais sur la norme d'une operation qu'il n'a pas faite."
        actions={
          <Link className="lien-nav text-sm" href="/tableau-de-bord">
            Tableau de bord general
          </Link>
        }
      />

      <div className="space-y-8">
        <section>
          <h2 className="mb-3 text-lg font-semibold">Effectif</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Employes actifs"
              valeur={formatEntier(indicateurs.effectifActif)}
              href="/rh/employes"
              ton="primaire"
            />
            {indicateurs.effectifParDivision.map((division) => (
              <Statistique
                key={division.division}
                libelle={libelle(LIBELLES_USINE, division.division)}
                valeur={formatEntier(division.nombre)}
                detail="Employes actifs"
              />
            ))}
            <Statistique
              libelle="Affectes aujourd'hui"
              valeur={formatEntier(indicateurs.employesAffectesJour)}
              detail={`Sur ${formatEntier(indicateurs.effectifActif)} employes actifs`}
              ton={indicateurs.employesSansAffectationJour > 0 ? "alerte" : "succes"}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Presence du jour</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Presents"
              valeur={formatEntier(indicateurs.presentsJour)}
              ton="succes"
            />
            <Statistique
              libelle="Absents"
              valeur={formatEntier(indicateurs.absentsJour)}
              ton={indicateurs.absentsJour > 0 ? "alerte" : "succes"}
            />
            <Statistique
              libelle="Retards"
              valeur={formatEntier(indicateurs.retardsJour)}
              href="/rh/presences"
              ton={indicateurs.retardsJour > 0 ? "alerte" : "succes"}
            />
            <Statistique
              libelle="Conges, maladie et formation"
              valeur={formatEntier(indicateurs.congesJour)}
              href="/rh/presences"
            />
            <Statistique
              libelle="Heures travaillees"
              valeur={indicateurs.heuresTravailleesJour}
              detail="Pointages du jour"
            />
            <Statistique
              libelle="Heures supplementaires"
              valeur={indicateurs.heuresSupplementairesJour}
              ton={Number(indicateurs.heuresSupplementairesJour) > 0 ? "alerte" : "neutre"}
            />
            <Statistique
              libelle="Sans pointage"
              valeur={formatEntier(indicateurs.employesSansPointage)}
              detail="Employes actifs sans pointage enregistre aujourd'hui"
              ton={indicateurs.employesSansPointage > 0 ? "alerte" : "succes"}
            />
            <Statistique
              libelle="Sans affectation"
              valeur={formatEntier(indicateurs.employesSansAffectationJour)}
              detail="Aucune affectation planifiee aujourd'hui"
              ton={indicateurs.employesSansAffectationJour > 0 ? "alerte" : "succes"}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Affectations du jour</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Affectations enregistrees"
              valeur={formatEntier(indicateurs.affectationsJour)}
              href="/rh/affectations"
              ton="primaire"
            />
            <Statistique
              libelle="Planifiees"
              valeur={formatEntier(indicateurs.affectationsPlanifiees)}
            />
            <Statistique
              libelle="En cours"
              valeur={formatEntier(indicateurs.affectationsEnCours)}
              ton={indicateurs.affectationsEnCours > 0 ? "info" : "neutre"}
            />
            <Statistique
              libelle="Terminees"
              valeur={formatEntier(indicateurs.affectationsTerminees)}
              ton="succes"
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Polyvalence et competences</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Employes avec competence declaree"
              valeur={formatEntier(indicateurs.employesAvecCompetence)}
              href="/rh/competences"
            />
            <Statistique
              libelle="Employes polyvalents"
              valeur={formatEntier(indicateurs.employesPolyvalents)}
              detail="Au moins deux competences declarees"
              ton="info"
            />
            <Statistique
              libelle="Operations couvertes"
              valeur={formatEntier(indicateurs.operationsCouvertes)}
              detail="Operations disposant d'au moins un employe competent"
              ton={
                indicateurs.operationsCouvertes === 0 ? "alerte" : "succes"
              }
            />
            <Statistique
              libelle="Declarations validees (30 jours)"
              valeur={formatEntier(indicateurs.declarationsParEmploye.length)}
              detail="Employes ayant declare une production"
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Evaluations</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Evaluations a valider"
              valeur={formatEntier(indicateurs.evaluationsNonValidees)}
              href="/rh/evaluations"
              ton={indicateurs.evaluationsNonValidees > 0 ? "alerte" : "succes"}
            />
            <Statistique
              libelle="Evaluations validees"
              valeur={formatEntier(indicateurs.evaluationsValidees)}
              ton="succes"
            />
            <Statistique
              libelle="Note globale moyenne (30 jours)"
              valeur={
                indicateurs.noteGlobaleMoyenne === null
                  ? "Non calculable"
                  : indicateurs.noteGlobaleMoyenne
              }
              detail={
                indicateurs.noteGlobaleMoyenne === null
                  ? "Aucune evaluation sur la periode"
                  : "Sur les evaluations dont la periode s'acheve dans les 30 derniers jours"
              }
            />
            <Statistique
              libelle="Fiabilite insuffisante"
              valeur={formatEntier(
                indicateurs.repartitionFiabilite.find((ligne) => ligne.niveau === "INSUFFISANTE")
                  ?.nombre ?? 0,
              )}
              detail="Donnees trop peu nombreuses pour conclure"
              ton="alerte"
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {indicateurs.repartitionFiabilite.map((ligne) => (
              <Statistique
                key={ligne.niveau}
                libelle={`Fiabilite : ${libelle(LIBELLES_FIABILITE, ligne.niveau)}`}
                valeur={formatEntier(ligne.nombre)}
                detail="Evaluations enregistrees"
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Suivi detaille</h2>
          <div className="grid gap-5 xl:grid-cols-2">
            <Carte
              titre="Employes sans affectation aujourd'hui"
              description="Employes actifs pour lesquels aucune affectation n'est enregistree a la date du jour."
              sansPadding
            >
              {indicateurs.employesSansAffectationListe.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="succes">
                    Tous les employes actifs ont une affectation enregistree aujourd'hui.
                  </Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "matricule", libelle: "Matricule" },
                    { cle: "nom", libelle: "Nom" },
                    { cle: "poste", libelle: "Poste" },
                    { cle: "division", libelle: "Division" },
                  ]}
                  lignes={indicateurs.employesSansAffectationListe.map((employe) => ({
                    cle: String(employe.id),
                    cellules: [
                      <Link key="l" className="lien-nav" href={`/rh/employes/${employe.id}`}>
                        {employe.matricule}
                      </Link>,
                      employe.nom,
                      employe.poste ?? "-",
                      libelle(LIBELLES_USINE, employe.division),
                    ],
                  }))}
                />
              )}
            </Carte>

            <Carte
              titre="Evaluations en attente de validation"
              description="Une evaluation non validee reste un projet : elle ne doit pas servir de reference avant validation par le responsable."
              sansPadding
            >
              {indicateurs.evaluationsNonValideesListe.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="succes">Aucune evaluation en attente de validation.</Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "employe", libelle: "Employe" },
                    { cle: "periode", libelle: "Periode" },
                    { cle: "debut", libelle: "Du" },
                    { cle: "fin", libelle: "Au" },
                    { cle: "note", libelle: "Note globale", nombre: true },
                    { cle: "fiabilite", libelle: "Fiabilite" },
                  ]}
                  lignes={indicateurs.evaluationsNonValideesListe.map((evaluation) => ({
                    cle: String(evaluation.id),
                    cellules: [
                      evaluation.employe,
                      libelle(LIBELLES_PERIODE_EVALUATION, evaluation.periode),
                      formatDate(evaluation.debut),
                      formatDate(evaluation.fin),
                      evaluation.noteGlobale ?? "Non calculable",
                      <EtiquetteStatut
                        key="f"
                        libelle={libelle(LIBELLES_FIABILITE, evaluation.fiabilite)}
                        code={evaluation.fiabilite}
                      />,
                    ],
                  }))}
                />
              )}
            </Carte>

            <Carte
              titre="Evaluations a fiabilite insuffisante"
              description="Ces evaluations reposent sur trop peu de donnees pour etre concluantes : elles sont presentees comme telles et ne doivent pas servir a une decision individuelle."
              sansPadding
            >
              {indicateurs.evaluationsInsuffisantesListe.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="succes">
                    Aucune evaluation a fiabilite insuffisante enregistree.
                  </Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "employe", libelle: "Employe" },
                    { cle: "periode", libelle: "Periode" },
                    { cle: "debut", libelle: "Du" },
                    { cle: "fin", libelle: "Au" },
                    { cle: "note", libelle: "Note globale", nombre: true },
                  ]}
                  lignes={indicateurs.evaluationsInsuffisantesListe.map((evaluation) => ({
                    cle: String(evaluation.id),
                    cellules: [
                      evaluation.employe,
                      libelle(LIBELLES_PERIODE_EVALUATION, evaluation.periode),
                      formatDate(evaluation.debut),
                      formatDate(evaluation.fin),
                      evaluation.noteGlobale ?? "Non calculable",
                    ],
                  }))}
                />
              )}
            </Carte>

            <Carte
              titre="Production declaree par employe (30 jours)"
              description="Quantites issues des declarations de production validees. Le classement sert au suivi d'activite, pas a une comparaison entre employes affectes a des operations differentes."
              sansPadding
            >
              {indicateurs.declarationsParEmploye.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="info">
                    Aucune declaration de production validee sur les 30 derniers jours.
                  </Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "matricule", libelle: "Matricule" },
                    { cle: "employe", libelle: "Employe" },
                    { cle: "declarations", libelle: "Declarations", nombre: true },
                    { cle: "quantite", libelle: "Quantite declaree", nombre: true },
                  ]}
                  lignes={indicateurs.declarationsParEmploye.map((ligne) => ({
                    cle: ligne.matricule,
                    cellules: [
                      ligne.matricule,
                      ligne.employe,
                      formatEntier(ligne.nombreDeclarations),
                      ligne.quantite,
                    ],
                  }))}
                />
              )}
            </Carte>

            <Carte
              titre="Competences par operation"
              description="Nombre d'employes competents declares par operation, avec le niveau moyen declare. Une operation sans aucun employe competent est un risque de rupture d'atelier."
              sansPadding
            >
              {indicateurs.competencesParOperation.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="alerte">
                    Aucune competence declaree : la polyvalence reelle de l'atelier n'est pas
                    mesurable en l'etat.
                  </Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "operation", libelle: "Operation" },
                    { cle: "employes", libelle: "Employes competents", nombre: true },
                    { cle: "niveau", libelle: "Niveau moyen", nombre: true },
                  ]}
                  lignes={indicateurs.competencesParOperation.map((ligne) => ({
                    cle: ligne.operation,
                    cellules: [
                      ligne.operation,
                      formatEntier(ligne.nombreEmployes),
                      ligne.niveauMoyen,
                    ],
                  }))}
                />
              )}
            </Carte>

            <Carte
              titre="Effectif par atelier"
              description="Repartition des employes actifs par atelier et par division."
              sansPadding
            >
              {indicateurs.effectifParAtelier.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="info">Aucun employe affecte a un atelier.</Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "atelier", libelle: "Atelier" },
                    { cle: "division", libelle: "Division" },
                    { cle: "nombre", libelle: "Employes", nombre: true },
                  ]}
                  lignes={indicateurs.effectifParAtelier.map((ligne) => ({
                    cle: `${ligne.division}-${ligne.atelier}`,
                    cellules: [
                      ligne.atelier,
                      libelle(LIBELLES_USINE, ligne.division),
                      formatEntier(ligne.nombre),
                    ],
                  }))}
                />
              )}
            </Carte>
          </div>
        </section>

        <Carte titre="Donnees salariales">
          <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
            {peutVoirSalaires
              ? "Vous disposez de la permission de consultation des salaires. Ces donnees ne sont volontairement pas affichees dans un tableau de bord collectif : elles se consultent sur la fiche individuelle de l'employe."
              : "Les donnees salariales sont protegees. Elles ne sont ni affichees ni transmises ici : leur consultation exige la permission dediee."}
          </p>
          <p className="mt-2 text-sm">
            <Link className="lien-nav" href="/rh/employes">
              Consulter la liste des employes
            </Link>
          </p>
        </Carte>
      </div>
    </>
  );
}
