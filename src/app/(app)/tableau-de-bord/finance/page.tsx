import Link from "next/link";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { indicateursPilotageFinance } from "@/lib/tableau-bord/pilotage";
import { Alerte, Carte, EnTetePage, EtiquetteStatut, Statistique, Tableau } from "@/components/ui";
import { formatDate, formatEntier, formatMontant, formatPourcentage } from "@/lib/format";
import {
  LIBELLES_MODE_REGLEMENT,
  LIBELLES_SENS_FACTURE,
  LIBELLES_SENS_REGLEMENT,
  LIBELLES_STATUT_REGLEMENT,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Pilotage finance" };

export default async function PagePilotageFinance() {
  const utilisateur = await exigerPermission(PERMISSIONS.TABLEAU_BORD_FINANCE);
  const indicateurs = await indicateursPilotageFinance(utilisateur);

  const ecartMois = Number(indicateurs.chiffreAffairesMoisHT) -
    Number(indicateurs.chiffreAffairesMoisPrecedentHT);

  const evolution =
    Number(indicateurs.chiffreAffairesMoisPrecedentHT) === 0
      ? null
      : (ecartMois / Number(indicateurs.chiffreAffairesMoisPrecedentHT)) * 100;

  return (
    <>
      <EnTetePage
        titre="Pilotage finance"
        description={`Periode analysee : du ${formatDate(indicateurs.debutMois)} au ${formatDate(
          new Date(indicateurs.finMois.getTime() - 1),
        )}. Les montants proviennent des factures, reglements et ecritures reellement enregistres ; les ecritures en brouillon sont signalees mais jamais comptees comme definitives.`}
        actions={
          <Link className="lien-nav text-sm" href="/tableau-de-bord">
            Tableau de bord general
          </Link>
        }
      />

      <div className="space-y-8">
        <section>
          <h2 className="mb-3 text-lg font-semibold">Activite du mois</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Chiffre d'affaires HT"
              valeur={formatMontant(indicateurs.chiffreAffairesMoisHT)}
              detail={
                evolution === null
                  ? `Mois precedent : ${formatMontant(indicateurs.chiffreAffairesMoisPrecedentHT)}`
                  : `${evolution >= 0 ? "+" : ""}${formatPourcentage(evolution)} par rapport au mois precedent`
              }
              ton="primaire"
            />
            <Statistique
              libelle="Avoirs du mois"
              valeur={formatMontant(indicateurs.avoirsMoisHT)}
              detail="Corrections et retours clients"
              ton="alerte"
            />
            <Statistique
              libelle="Cout des ventes du mois"
              valeur={formatMontant(indicateurs.coutVentesMois)}
              detail="Valorisation des sorties de stock sur livraison"
            />
            <Statistique
              libelle="Marge brute du mois"
              valeur={formatMontant(indicateurs.margeBruteMois)}
              detail={
                indicateurs.tauxMargeMois === null
                  ? "Taux non calculable"
                  : `Taux de marge : ${formatPourcentage(indicateurs.tauxMargeMois)}`
              }
              ton={Number(indicateurs.margeBruteMois) < 0 ? "danger" : "succes"}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Tresorerie du mois</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Encaissements"
              valeur={formatMontant(indicateurs.encaisseMois)}
              href="/comptabilite/reglements"
              ton="succes"
            />
            <Statistique
              libelle="Decaissements"
              valeur={formatMontant(indicateurs.decaisseMois)}
              href="/comptabilite/reglements"
              ton="alerte"
            />
            <Statistique
              libelle="Solde du mois"
              valeur={formatMontant(indicateurs.soldeTresorerieMois)}
              ton={Number(indicateurs.soldeTresorerieMois) < 0 ? "danger" : "succes"}
            />
            <Statistique
              libelle="Reglements non affectes"
              valeur={formatEntier(indicateurs.reglementsNonAffectes.nombre)}
              detail={`Montant : ${formatMontant(indicateurs.reglementsNonAffectes.montant)}`}
              ton={indicateurs.reglementsNonAffectes.nombre > 0 ? "alerte" : "succes"}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Encours clients et fournisseurs</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Creances clients"
              valeur={formatMontant(indicateurs.creancesClients)}
              href="/ventes/factures"
              ton="info"
            />
            <Statistique
              libelle="Factures clients en retard"
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
              libelle="Factures fournisseur en retard"
              valeur={formatEntier(indicateurs.facturesFournisseurEnRetard.nombre)}
              detail={formatMontant(indicateurs.facturesFournisseurEnRetard.montant)}
              ton={indicateurs.facturesFournisseurEnRetard.nombre > 0 ? "danger" : "succes"}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Comptabilite</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Ecritures du mois"
              valeur={formatEntier(indicateurs.ecrituresMois)}
              detail={`Debit : ${formatMontant(indicateurs.totalDebitMois)} — Credit : ${formatMontant(
                indicateurs.totalCreditMois,
              )}`}
              href="/comptabilite/ecritures"
            />
            <Statistique
              libelle="Ecritures en brouillon"
              valeur={formatEntier(indicateurs.ecrituresBrouillon)}
              detail="Non postees : elles ne sont pas definitives"
              href="/comptabilite/ecritures"
              ton={indicateurs.ecrituresBrouillon > 0 ? "alerte" : "succes"}
            />
            <Statistique
              libelle="Ecritures desequilibrees"
              valeur={formatEntier(indicateurs.ecrituresDesequilibrees)}
              detail="Debit different du credit sur une ecriture non brouillon"
              href="/comptabilite/ecritures"
              ton={indicateurs.ecrituresDesequilibrees > 0 ? "danger" : "succes"}
            />
            <Statistique
              libelle="Exercice en cours"
              valeur={indicateurs.exerciceEnCours ?? "Aucun"}
              detail={`${formatEntier(indicateurs.periodesOuvertes)} periode(s) ouverte(s)`}
              href="/comptabilite/balance"
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Documents en attente de traitement</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Statistique
              libelle="Reglements en brouillon"
              valeur={formatEntier(indicateurs.reglementsBrouillon)}
              href="/comptabilite/reglements"
              ton={indicateurs.reglementsBrouillon > 0 ? "alerte" : "succes"}
            />
            <Statistique
              libelle="Factures clients en brouillon"
              valeur={formatEntier(indicateurs.facturesBrouillonClient)}
              href="/ventes/factures"
              ton={indicateurs.facturesBrouillonClient > 0 ? "alerte" : "succes"}
            />
            <Statistique
              libelle="Factures fournisseur en brouillon"
              valeur={formatEntier(indicateurs.facturesBrouillonFournisseur)}
              href="/achats/factures"
              ton={indicateurs.facturesBrouillonFournisseur > 0 ? "alerte" : "succes"}
            />
            <Statistique
              libelle="Factures en retard a relancer"
              valeur={formatEntier(indicateurs.facturesEnRetardListe.length)}
              detail="Affichees ci-dessous, echeance depassee"
              ton={indicateurs.facturesEnRetardListe.length > 0 ? "danger" : "succes"}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Suivi detaille</h2>
          <div className="grid gap-5 xl:grid-cols-2">
            <Carte
              titre="Principaux clients du mois"
              description="Montant hors taxes facture sur la periode, hors avoirs."
              sansPadding
            >
              {indicateurs.topClients.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="info">Aucune facture client enregistree sur la periode.</Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "client", libelle: "Client" },
                    { cle: "code", libelle: "Code" },
                    { cle: "montant", libelle: "Chiffre d'affaires HT", nombre: true },
                  ]}
                  lignes={indicateurs.topClients.map((client) => ({
                    cle: String(client.id),
                    cellules: [
                      <Link key="l" className="lien-nav" href={`/referentiel/tiers/${client.id}`}>
                        {client.libelle}
                      </Link>,
                      client.code,
                      formatMontant(client.montantHT),
                    ],
                  }))}
                />
              )}
            </Carte>

            <Carte
              titre="Reglements recents"
              description="Derniers encaissements et decaissements enregistres."
              sansPadding
            >
              {indicateurs.derniersReglements.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="info">Aucun reglement enregistre.</Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "numero", libelle: "Numero" },
                    { cle: "sens", libelle: "Sens" },
                    { cle: "tiers", libelle: "Tiers" },
                    { cle: "mode", libelle: "Mode" },
                    { cle: "date", libelle: "Date" },
                    { cle: "montant", libelle: "Montant", nombre: true },
                    { cle: "statut", libelle: "Statut" },
                  ]}
                  lignes={indicateurs.derniersReglements.map((reglement) => ({
                    cle: String(reglement.id),
                    cellules: [
                      <Link
                        key="l"
                        className="lien-nav"
                        href={`/comptabilite/reglements?sens=${reglement.direction}`}
                      >
                        {reglement.numero}
                      </Link>,
                      libelle(LIBELLES_SENS_REGLEMENT, reglement.direction),
                      reglement.tiers,
                      libelle(LIBELLES_MODE_REGLEMENT, reglement.mode),
                      formatDate(reglement.date),
                      formatMontant(reglement.montant),
                      <EtiquetteStatut
                        key="s"
                        libelle={libelle(LIBELLES_STATUT_REGLEMENT, reglement.statut)}
                        code={reglement.statut}
                      />,
                    ],
                  }))}
                />
              )}
            </Carte>

            <Carte
              titre="Factures en retard"
              description="Solde restant du, toutes directions confondues. Le nombre de jours de retard est calcule a partir de l'echeance enregistree."
              sansPadding
            >
              {indicateurs.facturesEnRetardListe.length === 0 ? (
                <div className="p-4">
                  <Alerte ton="succes">Aucune facture en retard.</Alerte>
                </div>
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "numero", libelle: "Facture" },
                    { cle: "tiers", libelle: "Tiers" },
                    { cle: "sens", libelle: "Sens" },
                    { cle: "echeance", libelle: "Echeance" },
                    { cle: "retard", libelle: "Jours de retard", nombre: true },
                    { cle: "solde", libelle: "Solde du", nombre: true },
                  ]}
                  lignes={indicateurs.facturesEnRetardListe.map((facture) => ({
                    cle: String(facture.id),
                    cellules: [
                      facture.direction === "CLIENT" ? (
                        <Link
                          key="l"
                          className="lien-nav"
                          href={`/ventes/factures/${facture.id}`}
                        >
                          {facture.numero}
                        </Link>
                      ) : (
                        <Link key="l" className="lien-nav" href={`/achats/factures/${facture.id}`}>
                          {facture.numero}
                        </Link>
                      ),
                      facture.tiers,
                      libelle(LIBELLES_SENS_FACTURE, facture.direction),
                      facture.echeance ? formatDate(facture.echeance) : "-",
                      formatEntier(facture.joursRetard),
                      formatMontant(facture.solde),
                    ],
                  }))}
                />
              )}
            </Carte>

            <Carte
              titre="Rappel des regles comptables"
              description="Aucune ecriture n'est supprimee ni modifiee apres postage : une correction passe par une contre-passation, un avoir, une annulation controlee ou une nouvelle ecriture, avec un motif obligatoire."
            >
              <ul className="list-disc pl-5 text-sm" style={{ color: "var(--texte-doux)" }}>
                <li>Les ecritures sont generees uniquement sur des evenements valides.</li>
                <li>
                  Les comptes utilises proviennent des regles d'ecriture configurables : une regle
                  manquante bloque la generation au lieu d'etre devinee.
                </li>
                <li>
                  Les factures annulees conservent leur historique et leur numero d'origine.
                </li>
                <li>
                  La contre-passation porte le suffixe prevu par la regle d'ecriture et reste liee a
                  l'ecriture d'origine.
                </li>
              </ul>
              <p className="mt-3 text-sm">
                <Link className="lien-nav" href="/comptabilite/regles">
                  Consulter et configurer les regles d'ecriture
                </Link>
              </p>
            </Carte>
          </div>
        </section>
      </div>
    </>
  );
}
