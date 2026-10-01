import Link from "next/link";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  balanceGenerale,
  balanceTiers,
  grandLivre,
  listerComptes,
  verifierIntegrite,
} from "@/lib/comptabilite/service";
import {
  Alerte,
  Carte,
  EnTetePage,
  EtiquetteStatut,
  Statistique,
  Tableau,
  Vide,
} from "@/components/ui";
import { formatDate, formatEntier, formatMontant } from "@/lib/format";
import { premiereValeur } from "@/lib/liste";
import { LIBELLES_TYPE_COMPTE, libelle } from "@/lib/libelles";

export const metadata = { title: "Balance et grand livre" };

function dateParametre(valeur: string | null, defaut: Date): Date {
  if (!valeur) return defaut;
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? defaut : date;
}

function debutExercice(): Date {
  const maintenant = new Date();
  return new Date(maintenant.getFullYear(), 0, 1);
}

export default async function PageBalance({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.COMPTABILITE_LIRE);

  const parametres = await searchParams;
  const dateDebut = dateParametre(premiereValeur(parametres, "du"), debutExercice());
  const dateFin = dateParametre(premiereValeur(parametres, "au"), new Date());
  const compteSelectionne = premiereValeur(parametres, "compte");

  const [balance, comptes, integrite] = await Promise.all([
    balanceGenerale({ dateDebut, dateFin }),
    listerComptes(),
    verifierIntegrite(),
  ]);

  const grand = compteSelectionne
    ? await grandLivre({ accountNumber: compteSelectionne, dateDebut, dateFin })
    : null;

  const tiers = await balanceTiers({ dateFin });

  return (
    <>
      <EnTetePage
        titre="Balance et grand livre"
        description={`Periode du ${formatDate(dateDebut)} au ${formatDate(dateFin)}. Les montants proviennent des ecritures validees et comptabilisees.`}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistique libelle="Total debit" valeur={formatMontant(balance.totalDebit)} />
        <Statistique libelle="Total credit" valeur={formatMontant(balance.totalCredit)} />
        <Statistique
          libelle="Equilibre general"
          valeur={balance.equilibree ? "Equilibree" : "Desequilibree"}
          ton={balance.equilibree ? "succes" : "danger"}
          detail={
            balance.equilibree
              ? "Total debit egal au total credit"
              : "Ecart detecte : aucune ecriture n'a ete modifiee, l'anomalie est signalee"
          }
        />
        <Statistique
          libelle="Comptes mouvements"
          valeur={formatEntier(balance.mouvements.length)}
          detail={`${formatEntier(tiers.length)} tiers avec lignes non lettrees`}
        />
      </div>

      {(!integrite.equilibreGlobal ||
        integrite.ecrituresDesequilibrees.length > 0 ||
        integrite.totauxIncoherents.length > 0) && (
        <div className="mb-5">
          <Alerte ton="danger" titre="Anomalie comptable detectee">
            <p>
              {integrite.ecrituresDesequilibrees.length} ecriture(s) desequilibree(s) et{" "}
              {integrite.totauxIncoherents.length} ecriture(s) dont les totaux enregistres ne
              correspondent plus aux lignes.
            </p>
            {integrite.ecrituresDesequilibrees.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {integrite.ecrituresDesequilibrees.slice(0, 10).map((ecriture) => (
                  <li key={ecriture.id}>
                    <Link className="lien-nav" href={`/comptabilite/ecritures/${ecriture.id}`}>
                      {ecriture.number}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2">
              Aucune donnee n'a ete corrigee automatiquement : ces ecritures doivent etre
              examinees puis contre-passees si necessaire.
            </p>
          </Alerte>
        </div>
      )}

      <Carte titre="Periode" description="La balance et le grand livre portent sur cette periode.">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Du</span>
            <input className="champ" type="date" name="du" defaultValue={toDateInput(dateDebut)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Au</span>
            <input className="champ" type="date" name="au" defaultValue={toDateInput(dateFin)} />
          </label>
          <label className="block text-sm lg:col-span-1">
            <span className="mb-1 block font-medium">Compte pour le grand livre</span>
            <select className="champ" name="compte" defaultValue={compteSelectionne ?? ""}>
              <option value="">Aucun</option>
              {comptes.map((compte) => (
                <option key={compte.number} value={compte.number}>
                  {compte.number} — {compte.label}
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
              Afficher
            </button>
          </div>
        </form>
      </Carte>

      <div className="mt-5 space-y-5">
        <Carte titre="Balance generale par compte" sansPadding>
          {balance.mouvements.length === 0 ? (
            <Vide message="Aucun mouvement comptable sur la periode." />
          ) : (
            <Tableau
              colonnes={[
                { cle: "compte", libelle: "Compte" },
                { cle: "type", libelle: "Type" },
                { cle: "debit", libelle: "Debit", nombre: true },
                { cle: "credit", libelle: "Credit", nombre: true },
                { cle: "solde", libelle: "Solde", nombre: true },
              ]}
              lignes={balance.mouvements.map((mouvement) => ({
                cle: mouvement.accountNumber,
                cellules: [
                  <Link
                    key="lien"
                    className="lien-nav"
                    href={`/comptabilite/balance?compte=${encodeURIComponent(
                      mouvement.accountNumber,
                    )}&du=${toDateInput(dateDebut)}&au=${toDateInput(dateFin)}`}
                  >
                    {mouvement.accountNumber} — {mouvement.accountLabel}
                  </Link>,
                  libelle(LIBELLES_TYPE_COMPTE, mouvement.accountType),
                  formatMontant(mouvement.debit),
                  formatMontant(mouvement.credit),
                  formatMontant(mouvement.solde),
                ],
              }))}
            />
          )}
        </Carte>

        {grand && (
          <Carte
            titre={`Grand livre — ${grand.compte.number} ${grand.compte.label}`}
            description={`Solde initial : ${formatMontant(grand.soldeInitial)} · Mouvements : ${formatEntier(
              grand.lignes.length,
            )} · Solde final : ${formatMontant(grand.soldeFinal)}`}
            sansPadding
          >
            {grand.lignes.length === 0 ? (
              <Vide message="Aucun mouvement sur ce compte pour la periode." />
            ) : (
              <Tableau
                colonnes={[
                  { cle: "date", libelle: "Date" },
                  { cle: "piece", libelle: "Piece" },
                  { cle: "libelle", libelle: "Libelle" },
                  { cle: "tiers", libelle: "Tiers" },
                  { cle: "debit", libelle: "Debit", nombre: true },
                  { cle: "credit", libelle: "Credit", nombre: true },
                  { cle: "solde", libelle: "Solde progressif", nombre: true },
                ]}
                lignes={grand.lignes.map((ligne) => ({
                  cle: String(ligne.id),
                  cellules: [
                    formatDate(ligne.entry.entryDate),
                    <Link
                      key="lien"
                      className="lien-nav"
                      href={`/comptabilite/ecritures/${ligne.entry.id}`}
                    >
                      {ligne.entry.number}
                    </Link>,
                    ligne.label ?? ligne.entry.label,
                    ligne.thirdParty?.label1 ?? "-",
                    ligne.debit.isZero() ? "-" : formatMontant(ligne.debit),
                    ligne.credit.isZero() ? "-" : formatMontant(ligne.credit),
                    formatMontant(ligne.soldeProgressif),
                  ],
                }))}
              />
            )}
          </Carte>
        )}

        <Carte
          titre="Balance des tiers (lignes non lettrees)"
          description="Factures non reglees et avances restant a rapprocher."
          sansPadding
        >
          {tiers.length === 0 ? (
            <Vide message="Aucune ligne de tiers en attente de lettrage." />
          ) : (
            <Tableau
              colonnes={[
                { cle: "tiers", libelle: "Tiers" },
                { cle: "nature", libelle: "Nature" },
                { cle: "lignes", libelle: "Lignes a lettrer", nombre: true },
                { cle: "debit", libelle: "Debit", nombre: true },
                { cle: "credit", libelle: "Credit", nombre: true },
                { cle: "solde", libelle: "Solde", nombre: true },
              ]}
              lignes={tiers.map((ligne) => ({
                cle: String(ligne.tiersId),
                cellules: [
                  <Link key="lien" className="lien-nav" href={`/referentiel/tiers/${ligne.tiersId}`}>
                    {ligne.code} — {ligne.nom}
                  </Link>,
                  ligne.solde.greaterThanOrEqualTo(0) ? "Debiteur" : "Crediteur",
                  formatEntier(ligne.lignesNonLettrees),
                  formatMontant(ligne.debit),
                  formatMontant(ligne.credit),
                  formatMontant(ligne.solde),
                ],
              }))}
            />
          )}
        </Carte>

        <Carte titre="Comptes du plan comptable">
          <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {comptes.map((compte) => (
              <li key={compte.number} className="flex items-center justify-between gap-2">
                <span>
                  {compte.number} — {compte.label}
                </span>
                <EtiquetteStatut
                  libelle={libelle(LIBELLES_TYPE_COMPTE, compte.type)}
                  code={compte.type}
                />
              </li>
            ))}
          </ul>
        </Carte>
      </div>
    </>
  );
}

function toDateInput(date: Date): string {
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mois}-${jour}`;
}
