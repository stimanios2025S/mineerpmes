import Link from "next/link";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { listerEcritures, listerJournaux } from "@/lib/comptabilite/service";
import { Carte, EnTetePage, EtiquetteStatut, Pagination, Statistique, Tableau, Vide } from "@/components/ui";
import { fabricantLien, lireParametresListe, premiereValeur } from "@/lib/liste";
import { formatDate, formatEntier, formatMontant } from "@/lib/format";
import { LIBELLES_STATUT_ECRITURE, LIBELLES_TYPE_JOURNAL, libelle } from "@/lib/libelles";
import { D } from "@/lib/decimal";

export const metadata = { title: "Ecritures comptables" };

const CHEMIN = "/comptabilite/ecritures";

function dateParametre(valeur: string | null): Date | null {
  if (!valeur) return null;
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default async function PageEcritures({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.COMPTABILITE_LIRE);

  const parametres = await searchParams;
  const liste = lireParametresListe(parametres, ["statut", "journal", "du", "au"]);
  const journaux = await listerJournaux();

  const dateDebut = dateParametre(liste.filtres.du);
  const dateFin = dateParametre(liste.filtres.au);

  const resultat = await listerEcritures({
    statut: (liste.filtres.statut as never) ?? undefined,
    journalCode: liste.filtres.journal ?? undefined,
    dateDebut: dateDebut ?? undefined,
    dateFin: dateFin ?? undefined,
    page: liste.page,
    taille: liste.taille,
  });

  const totalDebit = D.sum(resultat.lignes.map((ecriture) => ecriture.totalDebit));
  const totalCredit = D.sum(resultat.lignes.map((ecriture) => ecriture.totalCredit));

  return (
    <>
      <EnTetePage
        titre="Ecritures comptables"
        description="Journal general des ecritures. Une ecriture postee n'est jamais supprimee : toute correction passe par une contre-passation motivee, et l'originale reste consultable."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistique libelle="Ecritures affichees" valeur={formatEntier(resultat.lignes.length)} />
        <Statistique libelle="Total debit (page)" valeur={formatMontant(totalDebit)} />
        <Statistique libelle="Total credit (page)" valeur={formatMontant(totalCredit)} />
        <Statistique
          libelle="Equilibre de la page"
          valeur={totalDebit.equals(totalCredit) ? "Equilibree" : "Desequilibree"}
          ton={totalDebit.equals(totalCredit) ? "succes" : "danger"}
          detail="Une page desequilibree signale une anomalie a examiner"
        />
      </div>

      <Carte titre="Filtrer" description="Journal, statut et periode.">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Journal</span>
            <select className="champ" name="journal" defaultValue={liste.filtres.journal ?? ""}>
              <option value="">Tous les journaux</option>
              {journaux.map((journal) => (
                <option key={journal.code} value={journal.code}>
                  {journal.code} — {libelle(LIBELLES_TYPE_JOURNAL, journal.type)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Statut</span>
            <select className="champ" name="statut" defaultValue={liste.filtres.statut ?? ""}>
              <option value="">Tous les statuts</option>
              {Object.entries(LIBELLES_STATUT_ECRITURE).map(([code, libelleStatut]) => (
                <option key={code} value={code}>
                  {libelleStatut}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Du</span>
            <input
              className="champ"
              type="date"
              name="du"
              defaultValue={premiereValeur(parametres, "du") ?? ""}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Au</span>
            <input
              className="champ"
              type="date"
              name="au"
              defaultValue={premiereValeur(parametres, "au") ?? ""}
            />
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
        <Carte titre="Ecritures" sansPadding>
          {resultat.lignes.length === 0 ? (
            <Vide message="Aucune ecriture ne correspond aux filtres selectionnes." />
          ) : (
            <>
              <Tableau
                colonnes={[
                  { cle: "numero", libelle: "Numero" },
                  { cle: "date", libelle: "Date" },
                  { cle: "journal", libelle: "Journal" },
                  { cle: "libelle", libelle: "Libelle" },
                  { cle: "document", libelle: "Document" },
                  { cle: "debit", libelle: "Debit", nombre: true },
                  { cle: "credit", libelle: "Credit", nombre: true },
                  { cle: "statut", libelle: "Statut" },
                ]}
                lignes={resultat.lignes.map((ecriture) => ({
                  cle: String(ecriture.id),
                  cellules: [
                    <Link
                      key="lien"
                      className="lien-nav"
                      href={`${CHEMIN}/${ecriture.id}`}
                    >
                      {ecriture.number}
                    </Link>,
                    formatDate(ecriture.entryDate),
                    ecriture.journal.code,
                    ecriture.label,
                    ecriture.reference ?? ecriture.documentType ?? "-",
                    formatMontant(ecriture.totalDebit),
                    formatMontant(ecriture.totalCredit),
                    <EtiquetteStatut
                      key="statut"
                      libelle={libelle(LIBELLES_STATUT_ECRITURE, ecriture.status)}
                      code={ecriture.status}
                    />,
                  ],
                }))}
              />
              <Pagination
                page={resultat.page}
                pages={resultat.pages}
                total={resultat.total}
                construireLien={fabricantLien(CHEMIN, {
                  statut: liste.filtres.statut,
                  journal: liste.filtres.journal,
                  du: liste.filtres.du,
                  au: liste.filtres.au,
                  taille: liste.taille,
                })}
              />
            </>
          )}
        </Carte>
      </div>
    </>
  );
}
