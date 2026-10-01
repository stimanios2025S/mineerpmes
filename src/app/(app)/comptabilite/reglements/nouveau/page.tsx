import Link from "next/link";
import { actionEnregistrerReglement } from "@/actions/comptabilite";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { etatReglementsTiers } from "@/lib/comptabilite/reglement";
import { prisma } from "@/lib/db";
import {
  Alerte,
  Carte,
  EnTetePage,
  EtiquetteStatut,
  Statistique,
  Tableau,
  Vide,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatDate, formatMontant } from "@/lib/format";
import { premiereValeur } from "@/lib/liste";
import { D } from "@/lib/decimal";
import {
  LIBELLES_MODE_REGLEMENT,
  LIBELLES_SENS_REGLEMENT,
  LIBELLES_STATUT_FACTURE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Nouveau reglement" };

const CHEMIN = "/comptabilite/reglements/nouveau";

/**
 * Saisie d'un reglement en deux temps.
 *
 * 1. Choix du sens (encaissement client / decaissement fournisseur) et du tiers.
 * 2. Affichage des factures ouvertes du tiers, avec le montant a affecter sur
 *    chacune. Aucune affectation n'est decidee a la place de l'utilisateur :
 *    les montants sont saisis, le service controle le total et refuse tout
 *    depassement.
 */
export default async function PageNouveauReglement({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.REGLEMENT_SAISIR);

  const parametres = await searchParams;
  const sensSaisi = premiereValeur(parametres, "sens");
  const sens = sensSaisi === "DECAISSEMENT" ? "DECAISSEMENT" : "ENCAISSEMENT";
  const tiersIdBrut = premiereValeur(parametres, "tiers");
  const tiersId = tiersIdBrut ? Number.parseInt(tiersIdBrut, 10) : Number.NaN;
  const tiersSelectionne = Number.isFinite(tiersId) && tiersId > 0 ? tiersId : null;

  const tiers = await prisma.thirdParty.findMany({
    where:
      sens === "ENCAISSEMENT"
        ? { isClient: true, isActive: true }
        : { isSupplier: true, isActive: true },
    orderBy: { label1: "asc" },
    take: 500,
    select: { id: true, code: true, label1: true },
  });

  const etat = tiersSelectionne ? await etatReglementsTiers(tiersSelectionne) : null;

  const facturesOuvertes = etat
    ? etat.factures.filter(
        (facture) =>
          D.gt(D.of(facture.balance), 0) &&
          (sens === "ENCAISSEMENT"
            ? facture.direction === "CLIENT"
            : facture.direction === "FOURNISSEUR"),
      )
    : [];

  const optionsTiers = tiers.map((tiersLigne) => ({
    valeur: tiersLigne.id,
    libelle: `${tiersLigne.code} — ${tiersLigne.label1}`,
  }));

  const optionsModes = Object.entries(LIBELLES_MODE_REGLEMENT).map(([code, libelleMode]) => ({
    valeur: code,
    libelle: libelleMode,
  }));

  return (
    <>
      <EnTetePage
        titre="Enregistrer un reglement"
        description="Un reglement est affecte aux factures ouvertes du tiers, puis comptabilise par la regle d'ecriture de l'evenement correspondant. Un reglement valide n'est jamais supprime."
        actions={
          <Link className="lien-nav text-sm" href="/comptabilite/reglements">
            Retour aux reglements
          </Link>
        }
      />

      <div className="space-y-5">
        <Carte
          titre="Etape 1 — Sens et tiers"
          description="Le sens determine la nature du reglement et les factures proposees."
        >
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Sens du reglement</span>
              <select className="champ" name="sens" defaultValue={sens}>
                <option value="ENCAISSEMENT">
                  {libelle(LIBELLES_SENS_REGLEMENT, "ENCAISSEMENT")}
                </option>
                <option value="DECAISSEMENT">
                  {libelle(LIBELLES_SENS_REGLEMENT, "DECAISSEMENT")}
                </option>
              </select>
            </label>
            <label className="block text-sm lg:col-span-2">
              <span className="mb-1 block font-medium">Tiers</span>
              <select className="champ" name="tiers" defaultValue={tiersSelectionne ?? ""}>
                <option value="">— Selectionner un tiers —</option>
                {optionsTiers.map((option) => (
                  <option key={option.valeur} value={option.valeur}>
                    {option.libelle}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                className="min-h-[42px] w-full rounded-lg border px-4 text-sm font-semibold"
                style={{ background: "var(--primaire)", color: "#ffffff", borderColor: "var(--primaire)" }}
              >
                Afficher les factures
              </button>
            </div>
          </form>
          {tiers.length === 0 && (
            <p className="mt-3 text-sm" style={{ color: "var(--texte-doux)" }}>
              Aucun tiers actif ne correspond a ce sens de reglement. Les tiers se creent dans le
              referentiel : ils ne sont pas crees automatiquement ici.
            </p>
          )}
        </Carte>

        {etat && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Statistique
                libelle="Tiers"
                valeur={`${etat.tiers.code} — ${etat.tiers.label1}`}
                detail={
                  etat.tiers.isClient && etat.tiers.isSupplier
                    ? "Client et fournisseur"
                    : etat.tiers.isClient
                      ? "Client"
                      : "Fournisseur"
                }
              />
              <Statistique libelle="Solde du tiers" valeur={formatMontant(etat.tiers.balance)} />
              <Statistique libelle="Total ouvert" valeur={formatMontant(etat.totalOuvert)} />
              <Statistique
                libelle="Factures en retard"
                valeur={String(etat.facturesEnRetard.length)}
                ton={etat.facturesEnRetard.length > 0 ? "alerte" : "succes"}
                detail="Echeance depassee et solde restant du"
              />
            </div>

            <Carte
              titre="Factures ouvertes du tiers"
              description="Toutes les factures ne sont pas reglables dans ce sens de reglement : seules celles de la nature correspondante sont proposees ci-dessous."
              sansPadding
            >
              {facturesOuvertes.length === 0 ? (
                <Vide message="Aucune facture ouverte ne correspond a ce sens de reglement pour ce tiers." />
              ) : (
                <Tableau
                  colonnes={[
                    { cle: "numero", libelle: "Facture" },
                    { cle: "date", libelle: "Date" },
                    { cle: "echeance", libelle: "Echeance" },
                    { cle: "total", libelle: "Total TTC", nombre: true },
                    { cle: "regle", libelle: "Deja regle", nombre: true },
                    { cle: "solde", libelle: "Solde du", nombre: true },
                    { cle: "statut", libelle: "Statut" },
                  ]}
                  lignes={facturesOuvertes.map((facture) => ({
                    cle: String(facture.id),
                    cellules: [
                      facture.number,
                      formatDate(facture.invoiceDate),
                      facture.dueDate ? formatDate(facture.dueDate) : "-",
                      formatMontant(facture.totalTTC),
                      formatMontant(facture.paidAmount),
                      formatMontant(facture.balance),
                      <EtiquetteStatut
                        key="statut"
                        libelle={libelle(LIBELLES_STATUT_FACTURE, facture.status)}
                        code={facture.status}
                      />,
                    ],
                  }))}
                />
              )}
            </Carte>

            <Carte
              titre="Etape 2 — Reglement et affectation"
              description="Le montant du reglement est saisi librement. Le montant affecte a chaque facture ne peut pas depasser son solde du : le service refuse l'enregistrement dans ce cas."
            >
              <FormulaireAction
                action={actionEnregistrerReglement}
                libelleSoumettre="Enregistrer le reglement"
                rafraichir
              >
                <input type="hidden" name="direction" value={sens} />
                <input type="hidden" name="thirdPartyId" value={etat.tiers.id} />

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Champ
                    nom="amount"
                    libelle="Montant du reglement"
                    type="number"
                    requis
                    pas="0.01"
                    min="0.01"
                    aide="Montant total recu ou verse."
                  />
                  <Champ
                    nom="method"
                    libelle="Mode de reglement"
                    type="select"
                    requis
                    valeur={etat.tiers.paymentMethod ?? undefined}
                    options={optionsModes}
                  />
                  <Champ
                    nom="paymentDate"
                    libelle="Date du reglement"
                    type="date"
                    valeur={new Date().toISOString().slice(0, 10)}
                  />
                  <Champ
                    nom="reference"
                    libelle="Reference (facultatif)"
                    maxLength={60}
                    aide="Numero de cheque, de virement ou de traite."
                  />
                  <Champ nom="bankAccount" libelle="Compte bancaire (facultatif)" maxLength={60} />
                  <Champ
                    nom="notes"
                    libelle="Notes (facultatif)"
                    type="textarea"
                    maxLength={300}
                  />
                </div>

                {facturesOuvertes.length > 0 && (
                  <div className="mt-5">
                    <p className="mb-3 text-sm font-medium">
                      Affectation aux factures (facultatif — laisser vide pour affecter du plus
                      ancien au plus recent)
                    </p>
                    <div className="space-y-3">
                      {facturesOuvertes.map((facture) => (
                        <div
                          key={facture.id}
                          className="grid items-end gap-3 rounded-lg border p-3 sm:grid-cols-[2fr_1fr]"
                          style={{ borderColor: "var(--bordure)" }}
                        >
                          <input type="hidden" name="invoiceId" value={facture.id} />
                          <div className="text-sm">
                            <p className="font-medium">
                              {facture.number} — solde du {formatMontant(facture.balance)}
                            </p>
                            <p style={{ color: "var(--texte-doux)" }}>
                              Emise le {formatDate(facture.invoiceDate)}
                              {facture.dueDate ? ` · echeance ${formatDate(facture.dueDate)}` : ""}
                            </p>
                          </div>
                          <Champ
                            nom="invoiceAmount"
                            libelle="Montant a affecter"
                            type="number"
                            pas="0.01"
                            min="0"
                            max={D.toFixed(facture.balance, 2)}
                            aide="Vide : le service affecte le reste du dans la limite du disponible."
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </FormulaireAction>
            </Carte>
          </>
        )}

        {!etat && (
          <Alerte ton="info">
            Selectionnez un sens et un tiers pour afficher ses factures ouvertes et saisir le
            reglement. Aucun tiers n'est choisi automatiquement.
          </Alerte>
        )}
      </div>
    </>
  );
}
