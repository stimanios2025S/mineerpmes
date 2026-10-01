import Link from "next/link";
import { actionActualiserFacturesEnRetard, actionAnnulerReglement } from "@/actions/comptabilite";
import { exigerPermission, utilisateurCourant } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { listerReglements } from "@/lib/comptabilite/reglement";
import {
  Carte,
  EnTetePage,
  EtiquetteStatut,
  Pagination,
  Statistique,
  Tableau,
  Vide,
} from "@/components/ui";
import { BoutonAction, FormulaireMotif } from "@/components/interactif";
import { fabricantLien, lireParametresListe, premiereValeur } from "@/lib/liste";
import { formatDate, formatEntier, formatMontant } from "@/lib/format";
import { D } from "@/lib/decimal";
import {
  LIBELLES_MODE_REGLEMENT,
  LIBELLES_SENS_REGLEMENT,
  LIBELLES_STATUT_REGLEMENT,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Reglements" };

const CHEMIN = "/comptabilite/reglements";

function dateParametre(valeur: string | null): Date | null {
  if (!valeur) return null;
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default async function PageReglements({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.FINANCE_LIRE);
  const parametres = await searchParams;
  const liste = lireParametresListe(parametres, ["sens", "du", "au"]);

  const resultat = await listerReglements({
    direction: (liste.filtres.sens as never) ?? undefined,
    dateDebut: dateParametre(liste.filtres.du) ?? undefined,
    dateFin: dateParametre(liste.filtres.au) ?? undefined,
    page: liste.page,
    taille: liste.taille,
  });

  const total = D.sum(resultat.lignes.map((reglement) => reglement.amount));
  const nonAffecte = D.sum(
    resultat.lignes.map((reglement) =>
      D.sub(reglement.amount, reglement.allocatedAmount),
    ),
  );

  const peutValider = utilisateur.permissions.includes(PERMISSIONS.REGLEMENT_VALIDER);
  const peutSaisir = utilisateur.permissions.includes(PERMISSIONS.REGLEMENT_SAISIR);

  return (
    <>
      <EnTetePage
        titre="Reglements"
        description="Encaissements clients et decaissements fournisseurs. Un reglement valide n'est jamais supprime : son annulation genere une contre-passation conservee et motivee."
        actions={
          peutSaisir ? (
            <Link className="lien-nav text-sm" href={`${CHEMIN}/nouveau`}>
              Enregistrer un reglement
            </Link>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistique libelle="Reglements affiches" valeur={formatEntier(resultat.lignes.length)} />
        <Statistique libelle="Montant total (page)" valeur={formatMontant(total)} />
        <Statistique
          libelle="Non affecte (page)"
          valeur={formatMontant(nonAffecte)}
          ton={D.gt(nonAffecte, 0) ? "alerte" : "succes"}
          detail="Montant encaisse non encore impute a une facture"
        />
        <div className="flex items-center">
          <BoutonAction
            action={actionActualiserFacturesEnRetard}
            libelle="Actualiser les factures en retard"
            confirmation="Marquer comme « en retard » toutes les factures echues non reglees ?"
          />
        </div>
      </div>

      <Carte titre="Filtrer">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Sens</span>
            <select className="champ" name="sens" defaultValue={liste.filtres.sens ?? ""}>
              <option value="">Tous les sens</option>
              {Object.entries(LIBELLES_SENS_REGLEMENT).map(([code, libelleSens]) => (
                <option key={code} value={code}>
                  {libelleSens}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Du</span>
            <input className="champ" type="date" name="du" defaultValue={premiereValeur(parametres, "du") ?? ""} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Au</span>
            <input className="champ" type="date" name="au" defaultValue={premiereValeur(parametres, "au") ?? ""} />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="min-h-[42px] w-full rounded-lg border px-4 text-sm font-semibold"
              style={{ background: "var(--primaire)", color: "#ffffff", borderColor: "var(--primaire)" }}
            >
              Filtrer
            </button>
          </div>
        </form>
      </Carte>

      <div className="mt-5">
        <Carte titre="Reglements enregistres" sansPadding>
          {resultat.lignes.length === 0 ? (
            <Vide message="Aucun reglement ne correspond aux filtres selectionnes." />
          ) : (
            <>
              <Tableau
                colonnes={[
                  { cle: "numero", libelle: "Numero" },
                  { cle: "date", libelle: "Date" },
                  { cle: "sens", libelle: "Sens" },
                  { cle: "tiers", libelle: "Tiers" },
                  { cle: "mode", libelle: "Mode" },
                  { cle: "montant", libelle: "Montant", nombre: true },
                  { cle: "affecte", libelle: "Affecte", nombre: true },
                  { cle: "statut", libelle: "Statut" },
                ]}
                lignes={resultat.lignes.map((reglement) => ({
                  cle: String(reglement.id),
                  cellules: [
                    reglement.number,
                    formatDate(reglement.paymentDate),
                    libelle(LIBELLES_SENS_REGLEMENT, reglement.direction),
                    `${reglement.thirdParty.code} — ${reglement.thirdParty.label1}`,
                    libelle(LIBELLES_MODE_REGLEMENT, reglement.method),
                    formatMontant(reglement.amount),
                    formatMontant(reglement.allocatedAmount),
                    <EtiquetteStatut
                      key="statut"
                      libelle={libelle(LIBELLES_STATUT_REGLEMENT, reglement.status)}
                      code={reglement.status}
                    />,
                  ],
                }))}
              />
              <Pagination
                page={resultat.page}
                pages={resultat.pages}
                total={resultat.total}
                construireLien={fabricantLien(CHEMIN, {
                  sens: liste.filtres.sens,
                  du: liste.filtres.du,
                  au: liste.filtres.au,
                  taille: liste.taille,
                })}
              />
            </>
          )}
        </Carte>
      </div>

      {peutValider && resultat.lignes.some((reglement) => reglement.status !== "ANNULE") && (
        <div className="mt-5">
          <Carte
            titre="Annuler un reglement"
            description="L'annulation produit une contre-passation comptable. L'ecriture d'origine reste consultable."
          >
            <div className="space-y-4">
              {resultat.lignes
                .filter((reglement) => reglement.status !== "ANNULE")
                .slice(0, 10)
                .map((reglement) => (
                  <div
                    key={reglement.id}
                    className="rounded-lg border p-3"
                    style={{ borderColor: "var(--bordure)" }}
                  >
                    <p className="mb-2 text-sm font-medium">
                      {reglement.number} — {reglement.thirdParty.label1} —{" "}
                      {formatMontant(reglement.amount)} ({formatDate(reglement.paymentDate)})
                    </p>
                    <FormulaireMotif
                      action={actionAnnulerReglement}
                      champsCaches={{ paymentId: reglement.id }}
                      libelleSoumettre="Annuler ce reglement"
                      libelleMotif="Motif de l'annulation"
                      varianteSoumettre="danger"
                      placeholder="Motif explicite (au moins 10 caracteres)"
                    />
                  </div>
                ))}
            </div>
          </Carte>
        </div>
      )}
    </>
  );
}
