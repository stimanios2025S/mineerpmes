import Link from "next/link";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { indicateursPilotageProduction, type LigneDeclarationRecente } from "@/lib/tableau-bord/pilotage";
import { Alerte, Carte, EnTetePage, EtiquetteStatut, Statistique, Tableau } from "@/components/ui";
import { formatDate, formatDateTime, formatEntier, formatPourcentage } from "@/lib/format";
import {
  LIBELLES_CATEGORIE_PERTE,
  LIBELLES_MOTIF_PERTE,
  LIBELLES_STATUT_OPERATION,
  LIBELLES_STATUT_ORDRE,
  LIBELLES_PRIORITE,
  LIBELLES_TYPE_DECLARATION,
  LIBELLES_STATUT_DECLARATION,
  LIBELLES_USINE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Pilotage production" };

const LIBELLES_TYPE: Record<string, string> = {
  PRODUCTION: "Production",
  CONSOMMATION: "Consommation",
  PERTE: "Perte",
  REPRISE: "Reprise",
  REBUT: "Rebut",
};

export default async function PagePilotageProduction() {
  const utilisateur = await exigerPermission(PERMISSIONS.TABLEAU_BORD_PRODUCTION);
  const indicateurs = await indicateursPilotageProduction(utilisateur);

  return (
    <>
      <EnTetePage
        titre="Pilotage production"
        description="Avancement des ordres de fabrication, charge des postes, declarations d'atelier, pertes et transferts inter-ateliers. Toutes les quantites proviennent des declarations enregistrees, sur les 30 derniers jours lorsque la periode est precisee."
        actions={
          <Link className="lien-nav text-sm" href="/tableau-de-bord">
            Tableau de bord general
          </Link>
        }
      />

      <div className="space-y-8">
        <section>
          <h2 className="mb-3 text-lg font-semibold">Ordres de fabrication</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Ordres ouverts"
              valeur={formatEntier(indicateurs.ordresOuverts)}
              href="/production"
              ton="primaire"
            />
            <Statistique
              libelle="Ordres en retard"
              valeur={formatEntier(indicateurs.ordresEnRetard)}
              detail="Echeance depassee et ordre encore ouvert"
              href="/production"
              ton={indicateurs.ordresEnRetard > 0 ? "danger" : "succes"}
            />
            <Statistique
              libelle="Ordres prioritaires"
              valeur={formatEntier(indicateurs.ordresUrgents)}
              detail="Priorite haute ou urgente, encore ouverts"
              ton={indicateurs.ordresUrgents > 0 ? "alerte" : "neutre"}
            />
            <Statistique
              libelle="Ordres non lances"
              valeur={formatEntier(indicateurs.ordresSansLancement)}
              detail="Encore au stade brouillon"
              href="/production"
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Quantites declarees (30 jours)</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Quantite declaree produite"
              valeur={indicateurs.quantiteDeclaree30Jours}
              detail="Declarations de production validees"
            />
            <Statistique
              libelle="Quantite conforme"
              valeur={indicateurs.quantiteConforme30Jours}
              ton="succes"
            />
            <Statistique
              libelle="Quantite mise au rebut"
              valeur={indicateurs.quantiteRebutee30Jours}
              ton={Number(indicateurs.quantiteRebutee30Jours) > 0 ? "danger" : "succes"}
            />
            <Statistique
              libelle="Quantite en reprise"
              valeur={indicateurs.quantiteReprise30Jours}
              ton={Number(indicateurs.quantiteReprise30Jours) > 0 ? "alerte" : "neutre"}
            />
            <Statistique
              libelle="Taux de rebut"
              valeur={
                indicateurs.tauxRebut30Jours === null
                  ? "Non calculable"
                  : formatPourcentage(indicateurs.tauxRebut30Jours)
              }
              detail={
                indicateurs.tauxRebut30Jours === null
                  ? "Aucune production declaree sur la periode"
                  : "Rebut rapporte a la production declaree"
              }
            />
            <Statistique
              libelle="Taux de conformite"
              valeur={
                indicateurs.tauxConformite30Jours === null
                  ? "Non calculable"
                  : formatPourcentage(indicateurs.tauxConformite30Jours)
              }
              detail="Quantite conforme rapporte a la quantite declaree"
            />
            <Statistique
              libelle="Quantite consommee"
              valeur={indicateurs.quantiteConsommee30Jours}
              detail="Matiere et composants consommes"
            />
            <Statistique
              libelle="Retour au stock"
              valeur={indicateurs.quantiteRetournee30Jours}
              detail="Reliquats remis en stock"
              ton="info"
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Operations et postes</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Operations en cours"
              valeur={formatEntier(indicateurs.operationsEnCours)}
              href="/production/kanban"
              ton="primaire"
            />
            <Statistique
              libelle="Operations en pause"
              valeur={formatEntier(indicateurs.operationsEnPause)}
              ton={indicateurs.operationsEnPause > 0 ? "alerte" : "succes"}
            />
            <Statistique
              libelle="Operations non demarrees"
              valeur={formatEntier(indicateurs.operationsNonDemarrees)}
              detail="File d'attente des postes de travail"
            />
            <Statistique
              libelle="Deplacements Kanban (7 jours)"
              valeur={formatEntier(indicateurs.deplacementsKanban7Jours)}
              detail="Chaque deplacement est un evenement trace"
              href="/production/kanban"
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Declarations d'atelier</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Declarations en attente"
              valeur={formatEntier(indicateurs.declarationsEnAttente)}
              detail="Saisies ou soumises, non encore validees"
              href="/production/declarations"
              ton={indicateurs.declarationsEnAttente > 0 ? "alerte" : "succes"}
            />
            <Statistique
              libelle="Declarations (30 jours)"
              valeur={formatEntier(indicateurs.declarations30Jours)}
            />
            <Statistique
              libelle="Declarations rejetees (30 jours)"
              valeur={formatEntier(indicateurs.declarationsRejetees30Jours)}
              ton={indicateurs.declarationsRejetees30Jours > 0 ? "danger" : "succes"}
            />
            <Statistique
              libelle="Transferts inter-ateliers (30 jours)"
              valeur={formatEntier(indicateurs.transfertsInterAteliers30Jours)}
              detail={`Quantite transferee : ${indicateurs.quantiteTransferree30Jours}`}
              href="/stock/transferts"
            />
          </div>
        </section>

        {indicateurs.parDivision.length > 0 && (
          <section>
            <h2 className="mb-3 text-lg font-semibold">Comparaison des divisions</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {indicateurs.parDivision.map((division) => (
                <Statistique
                  key={division.division}
                  libelle={libelle(LIBELLES_USINE, division.division)}
                  valeur={`${formatEntier(division.ordresOuverts)} ordres ouverts`}
                  detail={`${formatEntier(division.ordresEnRetard)} en retard — ${division.quantiteDeclaree30Jours} declaree — ${division.rebut30Jours} rebut`}
                  ton={division.ordresEnRetard > 0 ? "alerte" : "neutre"}
                />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-lg font-semibold">Suivi detaille</h2>
          <div className="grid gap-5 xl:grid-cols-2">
            <Carte
              titre="Ordres de fabrication en retard"
              description="Echeance depassee, ordre encore ouvert. La quantite restante est celle restant a produire."
              sansPadding
            >
              {indicateurs.ordresEnRetardListe.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="succes">Aucun ordre en retard.</Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "numero", libelle: "Ordre" },
                    { cle: "article", libelle: "Article" },
                    { cle: "division", libelle: "Division" },
                    { cle: "priorite", libelle: "Priorite" },
                    { cle: "echeance", libelle: "Echeance" },
                    { cle: "reste", libelle: "Reste", nombre: true },
                  ]}
                  lignes={indicateurs.ordresEnRetardListe.map((ordre) => ({
                    cle: String(ordre.id),
                    cellules: [
                      <Link key="l" className="lien-nav" href={`/production/${ordre.id}`}>
                        {ordre.numero}
                      </Link>,
                      ordre.article,
                      libelle(LIBELLES_USINE, ordre.division),
                      libelle(LIBELLES_PRIORITE, ordre.priorite),
                      formatDate(ordre.echeance),
                      ordre.reste,
                    ],
                  }))}
                />
              )}
            </Carte>

            <Carte
              titre="Operations en cours"
              description="Postes de travail actuellement occupes et operateur affecte."
              sansPadding
            >
              {indicateurs.operationsEnCoursListe.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="info">Aucune operation en cours.</Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "ordre", libelle: "Ordre" },
                    { cle: "operation", libelle: "Operation" },
                    { cle: "poste", libelle: "Poste" },
                    { cle: "operateur", libelle: "Operateur" },
                    { cle: "avancement", libelle: "Produit / prevu" },
                    { cle: "statut", libelle: "Statut" },
                  ]}
                  lignes={indicateurs.operationsEnCoursListe.map((operation) => ({
                    cle: String(operation.id),
                    cellules: [
                      <Link key="l" className="lien-nav" href={`/production/${operation.id}`}>
                        {operation.ordre}
                      </Link>,
                      operation.operation,
                      operation.poste ?? "-",
                      operation.operateur ?? "Non affecte",
                      `${operation.quantiteProduite} / ${operation.quantitePrevue}`,
                      <EtiquetteStatut
                        key="s"
                        libelle={libelle(LIBELLES_STATUT_OPERATION, operation.statut)}
                        code={operation.statut}
                      />,
                    ],
                  }))}
                />
              )}
            </Carte>

            <Carte
              titre="Dernieres declarations"
              description="Les 15 dernieres declarations enregistrees, tous statuts confondus."
              sansPadding
            >
              {indicateurs.dernieresDeclarations.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="info">Aucune declaration enregistree.</Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "date", libelle: "Date" },
                    { cle: "ordre", libelle: "Ordre" },
                    { cle: "operation", libelle: "Operation" },
                    { cle: "type", libelle: "Type" },
                    { cle: "employe", libelle: "Employe" },
                    { cle: "quantite", libelle: "Quantite", nombre: true },
                    { cle: "statut", libelle: "Statut" },
                  ]}
                  lignes={indicateurs.dernieresDeclarations.map((declaration: LigneDeclarationRecente) => ({
                    cle: declaration.id,
                    cellules: [
                      formatDateTime(declaration.survenueLe),
                      declaration.ordre,
                      declaration.operation,
                      LIBELLES_TYPE[declaration.type] ??
                        libelle(LIBELLES_TYPE_DECLARATION, declaration.type),
                      declaration.employe ?? "-",
                      declaration.quantite,
                      <EtiquetteStatut
                        key="s"
                        libelle={libelle(LIBELLES_STATUT_DECLARATION, declaration.statut)}
                        code={declaration.statut}
                      />,
                    ],
                  }))}
                />
              )}
            </Carte>

            <Carte
              titre="Pertes par motif (30 jours)"
              description="Les pertes sont declarees separement de la consommation normale : elles ne sont jamais noyees dans les sorties de matiere."
              sansPadding
            >
              {indicateurs.pertesParMotif30Jours.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="succes">Aucune perte declaree sur la periode.</Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "motif", libelle: "Motif" },
                    { cle: "categorie", libelle: "Categorie" },
                    { cle: "quantite", libelle: "Quantite", nombre: true },
                  ]}
                  lignes={indicateurs.pertesParMotif30Jours.map((perte) => ({
                    cle: `${perte.categorie}-${perte.motif}`,
                    cellules: [
                      libelle(LIBELLES_MOTIF_PERTE, perte.motif),
                      libelle(LIBELLES_CATEGORIE_PERTE, perte.categorie),
                      perte.quantite,
                    ],
                  }))}
                />
              )}
            </Carte>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Repartition des ordres par statut</h2>
          <Carte sansPadding>
            <Tableau
              colonnes={[
                { cle: "statut", libelle: "Statut" },
                { cle: "nombre", libelle: "Nombre d'ordres", nombre: true },
              ]}
              lignes={indicateurs.ordresParStatut.map((ligne) => ({
                cle: ligne.statut,
                cellules: [
                  <EtiquetteStatut
                    key="s"
                    libelle={libelle(LIBELLES_STATUT_ORDRE, ligne.statut)}
                    code={ligne.statut}
                  />,
                  formatEntier(ligne.nombre),
                ],
              }))}
            />
          </Carte>
        </section>
      </div>
    </>
  );
}
