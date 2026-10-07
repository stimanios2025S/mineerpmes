import Link from "next/link";
import { redirect } from "next/navigation";
import { estProprietaireUsine } from "@/lib/rbac/portee";
import { identiteUtilisateur } from "@/lib/portail-identite";
import { aLaPermission, exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { indicateursTableauDeBord, bornesMois } from "@/lib/tableau-bord/service";
import { Alerte, Carte, EnTetePage, Statistique, Tableau } from "@/components/ui";
import { formatDate, formatEntier, formatMontant, formatPourcentage, formatQuantite } from "@/lib/format";
import {
  LIBELLES_SOURCE_NON_CONFORMITE,
  LIBELLES_STATUT_LIVRAISON,
  LIBELLES_STATUT_NON_CONFORMITE,
  LIBELLES_USINE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Tableau de bord" };

export default async function PageTableauDeBord() {
  const utilisateur = await exigerPermission(PERMISSIONS.TABLEAU_BORD_LIRE);
  const identite = identiteUtilisateur(utilisateur);
  if (estProprietaireUsine(utilisateur) && identite) {
    redirect(`/direction/${identite.code.toLowerCase()}`);
  }
  const indicateurs = await indicateursTableauDeBord(utilisateur);
  const mois = bornesMois();

  // Chaque bloc n'est rendu que pour qui a le droit de le lire. Un bloc
  // simplement masque resterait present dans le HTML : le cloisonnement serait
  // contourne en inspectant la page.
  const vues = {
    commercial: aLaPermission(utilisateur, PERMISSIONS.VENTE_LIRE),
    tresorerie: aLaPermission(utilisateur, PERMISSIONS.FINANCE_LIRE),
    production: aLaPermission(utilisateur, PERMISSIONS.PRODUCTION_LIRE),
    qualite: aLaPermission(utilisateur, PERMISSIONS.QUALITE_LIRE),
    stock: aLaPermission(utilisateur, PERMISSIONS.STOCK_LIRE),
    achats: aLaPermission(utilisateur, PERMISSIONS.ACHAT_LIRE),
    rh: aLaPermission(utilisateur, PERMISSIONS.RH_PRESENCE_LIRE),
  };
  const alertesVisibles =
    vues.stock || vues.production || vues.qualite || vues.commercial;

  const portee = utilisateur.scope.allFactories
    ? "ADMEDCO et MOBILIX"
    : [
        utilisateur.scope.admedco ? "ADMEDCO" : null,
        utilisateur.scope.mobilix ? "MOBILIX" : null,
      ]
        .filter(Boolean)
        .join(" et ");

  const evolutionCA =
    indicateurs.chiffreAffairesMoisPrecedentHT.isZero()
      ? null
      : Number(
          indicateurs.chiffreAffairesMoisHT
            .minus(indicateurs.chiffreAffairesMoisPrecedentHT)
            .dividedBy(indicateurs.chiffreAffairesMoisPrecedentHT)
            .times(100)
            .toFixed(2),
        );

  return (
    <>
      <EnTetePage
        titre="Tableau de bord"
        description={`Perimetre : ${portee || "aucune division"}. Mois en cours : du ${formatDate(
          mois.debut,
        )} au ${formatDate(new Date(mois.fin.getTime() - 1))}. Tous les indicateurs proviennent des donnees enregistrees en base.`}
        actions={
          aLaPermission(utilisateur, PERMISSIONS.TABLEAU_BORD_PRODUCTION) ? (
            <Link className="lien-nav text-sm" href="/tableau-de-bord/production">
              Pilotage production
            </Link>
          ) : null
        }
      />

      <div className="space-y-8">
        {vues.commercial && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Activite commerciale du mois</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Chiffre d'affaires HT"
              valeur={formatMontant(indicateurs.chiffreAffairesMoisHT)}
              detail={
                evolutionCA === null
                  ? `Mois precedent : ${formatMontant(indicateurs.chiffreAffairesMoisPrecedentHT)}`
                  : `${evolutionCA >= 0 ? "+" : ""}${formatPourcentage(evolutionCA)} par rapport au mois precedent`
              }
              ton="primaire"
            />
            <Statistique
              libelle="Marge brute constatee"
              valeur={formatMontant(indicateurs.margeBruteMois)}
              detail={`Cout des ventes livre : ${formatMontant(indicateurs.coutVentesMois)}`}
              ton={indicateurs.margeBruteMois.isNegative() ? "danger" : "succes"}
            />
            <Statistique
              libelle="Factures clients du mois"
              valeur={formatEntier(indicateurs.facturesClientDuMois)}
              detail={`Avoirs du mois : ${formatMontant(indicateurs.avoirsMoisHT)}`}
            />
            <Statistique
              libelle="Commandes clients ouvertes"
              valeur={formatEntier(indicateurs.commandesClientOuvertes.nombre)}
              detail={`Montant : ${formatMontant(indicateurs.commandesClientOuvertes.montant)}`}
              href="/ventes/commandes"
              ton={indicateurs.commandesClientEnRetardLivraison > 0 ? "alerte" : "neutre"}
            />
          </div>
        </section>
        )}

        {vues.tresorerie && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Encours et tresorerie</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Creances clients"
              valeur={formatMontant(indicateurs.creancesClients)}
              href="/ventes/factures"
              ton="info"
            />
            <Statistique
              libelle="Dont factures en retard"
              valeur={formatEntier(indicateurs.facturesClientEnRetard.nombre)}
              detail={formatMontant(indicateurs.facturesClientEnRetard.montant)}
              ton={indicateurs.facturesClientEnRetard.nombre > 0 ? "danger" : "succes"}
            />
            <Statistique
              libelle="Dettes fournisseurs"
              valeur={formatMontant(indicateurs.dettesFournisseurs)}
              href="/achats/factures"
              ton="info"
            />
            <Statistique
              libelle="Dont factures en retard"
              valeur={formatEntier(indicateurs.facturesFournisseurEnRetard.nombre)}
              detail={formatMontant(indicateurs.facturesFournisseurEnRetard.montant)}
              ton={indicateurs.facturesFournisseurEnRetard.nombre > 0 ? "danger" : "succes"}
            />
          </div>
        </section>
        )}

        {vues.production && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Production</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Ordres de fabrication ouverts"
              valeur={formatEntier(indicateurs.ordresOuverts)}
              href="/production"
              ton="primaire"
            />
            <Statistique
              libelle="Ordres en retard"
              valeur={formatEntier(indicateurs.ordresEnRetard)}
              detail="Echeance depassee"
              href="/production"
              ton={indicateurs.ordresEnRetard > 0 ? "danger" : "succes"}
            />
            <Statistique
              libelle="En controle qualite"
              valeur={formatEntier(indicateurs.ordresEnControleQualite)}
              href="/qualite"
              ton="alerte"
            />
            <Statistique
              libelle="Declarations a valider"
              valeur={formatEntier(indicateurs.declarationsAValider)}
              href="/production/declarations"
              ton={indicateurs.declarationsAValider > 0 ? "alerte" : "neutre"}
            />
            <Statistique
              libelle="Quantite produite (30 jours)"
              valeur={formatQuantite(indicateurs.quantiteProduite30Jours)}
              detail="Produits finis et semi-finis entres en stock"
            />
            <Statistique
              libelle="Quantite mise au rebut (30 jours)"
              valeur={formatQuantite(indicateurs.quantiteRebutee30Jours)}
              ton={indicateurs.quantiteRebutee30Jours.isZero() ? "succes" : "danger"}
            />
            <Statistique
              libelle="Taux de rebut (30 jours)"
              valeur={
                indicateurs.tauxRebut30Jours === null
                  ? "Non calculable"
                  : formatPourcentage(indicateurs.tauxRebut30Jours)
              }
              detail={
                indicateurs.tauxRebut30Jours === null
                  ? "Aucune production enregistree sur la periode"
                  : "Rebut rapporte a la production totale"
              }
            />
            <Statistique
              libelle="Transferts inter-ateliers (30 jours)"
              valeur={formatEntier(indicateurs.transfertsInterAteliers30Jours)}
              detail="Dont chassis peints ADMEDCO vers MOBILIX"
              href="/stock/transferts"
            />
          </div>
        </section>
        )}

        {vues.qualite && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Qualite</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Taux de conformite (30 jours)"
              valeur={
                indicateurs.tauxConformite30Jours === null
                  ? "Non calculable"
                  : formatPourcentage(indicateurs.tauxConformite30Jours)
              }
              detail={`Quantite controlee : ${formatQuantite(indicateurs.quantiteControlee30Jours)}`}
              ton={
                indicateurs.tauxConformite30Jours === null
                  ? "neutre"
                  : Number(indicateurs.tauxConformite30Jours.toFixed(2)) >= 95
                    ? "succes"
                    : "alerte"
              }
            />
            <Statistique
              libelle="Non-conformites ouvertes"
              valeur={formatEntier(indicateurs.nonConformitesOuvertes)}
              href="/qualite/non-conformites"
              ton={indicateurs.nonConformitesOuvertes > 0 ? "danger" : "succes"}
            />
            <Statistique
              libelle="Lots en quarantaine"
              valeur={formatEntier(indicateurs.lotsEnQuarantaine)}
              detail={`Quantite bloquee : ${formatQuantite(indicateurs.quantiteEnQuarantaine)}`}
              href="/qualite/a-liberer"
              ton={indicateurs.lotsEnQuarantaine > 0 ? "alerte" : "succes"}
            />
            <Statistique
              libelle="Receptions en attente de controle"
              valeur={formatEntier(indicateurs.receptionsEnAttenteQualite)}
              href="/achats/receptions"
              ton={indicateurs.receptionsEnAttenteQualite > 0 ? "alerte" : "succes"}
            />
          </div>
        </section>
        )}

        {(vues.stock || vues.achats) && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Stocks et achats</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Valeur du stock"
              valeur={formatMontant(indicateurs.valeurStock)}
              detail="Valorisation au cout moyen pondere"
              href="/stock"
            />
            <Statistique
              libelle="Articles sous le minimum"
              valeur={formatEntier(indicateurs.articlesSousMinimum)}
              detail={`Sur ${formatEntier(indicateurs.articlesSuivis)} articles avec minimum configure`}
              href="/stock"
              ton={indicateurs.articlesSousMinimum > 0 ? "danger" : "succes"}
            />
            <Statistique
              libelle="Demandes d'achat a approuver"
              valeur={formatEntier(indicateurs.demandesAchatAApprouver)}
              href="/achats/demandes"
              ton={indicateurs.demandesAchatAApprouver > 0 ? "alerte" : "succes"}
            />
            <Statistique
              libelle="Factures fournisseur en ecart"
              valeur={formatEntier(indicateurs.facturesFournisseurEnEcart)}
              detail="Rapprochement commande / reception / facture non conforme"
              href="/achats/factures"
              ton={indicateurs.facturesFournisseurEnEcart > 0 ? "danger" : "succes"}
            />
          </div>
        </section>
        )}

        {vues.rh && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Ressources humaines</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Effectif actif"
              valeur={formatEntier(indicateurs.effectifActif)}
              href="/rh/employes"
            />
            <Statistique
              libelle="Presents aujourd'hui"
              valeur={formatEntier(indicateurs.presentsAujourdHui)}
              ton="succes"
            />
            <Statistique
              libelle="Absents aujourd'hui"
              valeur={formatEntier(indicateurs.absentsAujourdHui)}
              ton={indicateurs.absentsAujourdHui > 0 ? "alerte" : "succes"}
            />
            <Statistique
              libelle="Retards aujourd'hui"
              valeur={formatEntier(indicateurs.retardsAujourdHui)}
              href="/rh/presences"
              ton={indicateurs.retardsAujourdHui > 0 ? "alerte" : "succes"}
            />
          </div>
        </section>
        )}

        {alertesVisibles && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Alertes et actions attendues</h2>

          <div className="grid gap-5 xl:grid-cols-2">
            {vues.stock && (
            <Carte
              titre="Articles sous le minimum"
              description="Quantite physique disponible inferieure au minimum defini sur la fiche article."
              sansPadding
            >
              {indicateurs.articlesSousMinimumListe.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="succes">Aucun article sous le minimum configure.</Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "article", libelle: "Article" },
                    { cle: "disponible", libelle: "Disponible", nombre: true },
                    { cle: "minimum", libelle: "Minimum", nombre: true },
                  ]}
                  lignes={indicateurs.articlesSousMinimumListe.map((article) => ({
                    cle: String(article.id),
                    cellules: [
                      `${article.code} — ${article.libelle}`,
                      `${formatQuantite(article.disponible)} ${article.unite ?? ""}`.trim(),
                      `${formatQuantite(article.minimum)} ${article.unite ?? ""}`.trim(),
                    ],
                  }))}
                />
              )}
            </Carte>
            )}

            {vues.production && (
            <Carte
              titre="Ordres de fabrication en retard"
              description="Echeance depassee et ordre encore ouvert."
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
                      formatDate(ordre.echeance),
                      formatQuantite(ordre.quantiteRestante),
                    ],
                  }))}
                />
              )}
            </Carte>
            )}

            {vues.qualite && (
            <Carte
              titre="Lots en quarantaine"
              description="Marchandise non disponible tant que la qualite n'a pas statue."
              sansPadding
            >
              {indicateurs.lotsEnQuarantaineListe.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="succes">Aucun lot en quarantaine.</Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "lot", libelle: "Lot" },
                    { cle: "article", libelle: "Article" },
                    { cle: "depot", libelle: "Depot" },
                    { cle: "quantite", libelle: "Quantite", nombre: true },
                    { cle: "depuis", libelle: "Depuis" },
                  ]}
                  lignes={indicateurs.lotsEnQuarantaineListe.map((lot) => ({
                    cle: String(lot.id),
                    cellules: [
                      lot.numeroLot,
                      lot.article,
                      lot.depot,
                      formatQuantite(lot.quantite),
                      formatDate(lot.depuis),
                    ],
                  }))}
                />
              )}
            </Carte>
            )}

            {vues.qualite && (
            <Carte
              titre="Non-conformites ouvertes"
              description="Fiches non encore resolues ni cloturees."
              sansPadding
            >
              {indicateurs.nonConformitesOuvertesListe.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="succes">Aucune non-conformite ouverte.</Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "numero", libelle: "Fiche" },
                    { cle: "source", libelle: "Origine" },
                    { cle: "statut", libelle: "Statut" },
                    { cle: "quantite", libelle: "Quantite", nombre: true },
                  ]}
                  lignes={indicateurs.nonConformitesOuvertesListe.map((nc) => ({
                    cle: String(nc.id),
                    cellules: [
                      <Link key="l" className="lien-nav" href={`/qualite/non-conformites/${nc.id}`}>
                        {nc.numero}
                      </Link>,
                      libelle(LIBELLES_SOURCE_NON_CONFORMITE, nc.source),
                      libelle(LIBELLES_STATUT_NON_CONFORMITE, nc.statut),
                      formatQuantite(nc.quantite),
                    ],
                  }))}
                />
              )}
            </Carte>
            )}

            {vues.commercial && (
            <Carte
              titre="Livraisons a preparer ou expedier"
              description="Bons de livraison non encore remis au client."
              sansPadding
            >
              {indicateurs.livraisonsAExpedier.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="succes">Aucune livraison en attente.</Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "numero", libelle: "Bon" },
                    { cle: "client", libelle: "Client" },
                    { cle: "statut", libelle: "Statut" },
                    { cle: "date", libelle: "Date" },
                  ]}
                  lignes={indicateurs.livraisonsAExpedier.map((bl) => ({
                    cle: String(bl.id),
                    cellules: [
                      <Link key="l" className="lien-nav" href={`/ventes/livraisons/${bl.id}`}>
                        {bl.numero}
                      </Link>,
                      bl.client,
                      libelle(LIBELLES_STATUT_LIVRAISON, bl.statut),
                      formatDate(bl.dateLivraison),
                    ],
                  }))}
                />
              )}
            </Carte>
            )}
          </div>
        </section>
        )}
      </div>
    </>
  );
}
