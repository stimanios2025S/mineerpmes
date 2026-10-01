import Link from "next/link";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  ACTIONS_AUDIT,
  MODULES_AUDIT,
  consulterJournalAudit,
  type FiltresAudit,
} from "@/lib/audit";
import {
  Carte,
  EnTetePage,
  Etiquette,
  Pagination,
  Statistique,
  Tableau,
  Vide,
} from "@/components/ui";
import { fabricantLien, lireParametresListe, premiereValeur } from "@/lib/liste";
import { formatDateTime, formatEntier } from "@/lib/format";

export const metadata = { title: "Journal d'audit" };

const CHEMIN = "/administration/audit";

const LIBELLES_ACTIONS: Record<string, string> = {
  [ACTIONS_AUDIT.CONNEXION]: "Connexion",
  [ACTIONS_AUDIT.CONNEXION_ECHOUEE]: "Connexion refusee",
  [ACTIONS_AUDIT.DECONNEXION]: "Deconnexion",
  [ACTIONS_AUDIT.COMPTE_VERROUILLE]: "Compte verrouille",
  [ACTIONS_AUDIT.MOT_DE_PASSE_CHANGE]: "Mot de passe change",
  [ACTIONS_AUDIT.MOT_DE_PASSE_REINITIALISE]: "Mot de passe reinitialise",
  [ACTIONS_AUDIT.CREATION]: "Creation",
  [ACTIONS_AUDIT.MODIFICATION]: "Modification",
  [ACTIONS_AUDIT.VALIDATION]: "Validation",
  [ACTIONS_AUDIT.APPROBATION]: "Approbation",
  [ACTIONS_AUDIT.ANNULATION]: "Annulation",
  [ACTIONS_AUDIT.SUPPRESSION_LOGIQUE]: "Suppression logique",
  [ACTIONS_AUDIT.MOUVEMENT_STOCK]: "Mouvement de stock",
  [ACTIONS_AUDIT.MOUVEMENT_ANNULE]: "Mouvement annule",
  [ACTIONS_AUDIT.CONSOMMATION]: "Consommation",
  [ACTIONS_AUDIT.PERTE]: "Perte",
  [ACTIONS_AUDIT.REBUT]: "Rebut",
  [ACTIONS_AUDIT.REPRISE]: "Reprise",
  [ACTIONS_AUDIT.PRODUCTION]: "Production",
  [ACTIONS_AUDIT.TRANSFERT_DIVISION]: "Transfert inter-ateliers",
  [ACTIONS_AUDIT.CHANGEMENT_NOMENCLATURE]: "Changement de nomenclature",
  [ACTIONS_AUDIT.CHANGEMENT_PERMISSION]: "Changement de permission",
  [ACTIONS_AUDIT.CHANGEMENT_AFFECTATION]: "Changement d'affectation",
  [ACTIONS_AUDIT.IMPORT]: "Import",
  [ACTIONS_AUDIT.EXPORT]: "Export",
  [ACTIONS_AUDIT.FACTURATION]: "Facturation",
  [ACTIONS_AUDIT.REGLEMENT]: "Reglement",
  [ACTIONS_AUDIT.ECRITURE_COMPTABLE]: "Ecriture comptable",
  [ACTIONS_AUDIT.CONTREPASSATION]: "Contre-passation",
  [ACTIONS_AUDIT.CORRECTION]: "Correction",
  [ACTIONS_AUDIT.QUALITE]: "Qualite",
  [ACTIONS_AUDIT.QUANTITE_MODIFIEE]: "Quantite modifiee",
  [ACTIONS_AUDIT.UTILISATEUR_CREE]: "Utilisateur cree",
  [ACTIONS_AUDIT.UTILISATEUR_DESACTIVE]: "Utilisateur desactive",
};

function dateParametre(valeur: string | null): Date | null {
  if (!valeur) return null;
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : date;
}

function texteJson(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return "-";
  try {
    return JSON.stringify(valeur, null, 2);
  } catch {
    return String(valeur);
  }
}

export default async function PageAudit({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.AUDIT_LIRE);

  const parametres = await searchParams;
  const liste = lireParametresListe(parametres, ["recherche", "module", "action", "entite", "du", "au"]);

  const filtres: FiltresAudit = {
    recherche: liste.filtres.recherche?.trim() || undefined,
    module: liste.filtres.module || undefined,
    action: liste.filtres.action || undefined,
    entity: liste.filtres.entite || undefined,
    du: dateParametre(liste.filtres.du) ?? undefined,
    au: dateParametre(liste.filtres.au) ?? undefined,
    page: liste.page,
    taille: liste.taille,
  };

  const journal = await consulterJournalAudit(filtres);

  const actions = Object.values(ACTIONS_AUDIT);
  const modules = Object.values(MODULES_AUDIT);

  return (
    <>
      <EnTetePage
        titre="Journal d'audit"
        description="Tracabilite des operations sensibles : connexions, creations, modifications, validations, annulations, mouvements de stock, consommations, pertes, rebuts, reprises, changements de nomenclature et de permissions, facturation, reglements, imports, exports, affectations et controles qualite. Le journal n'est jamais modifiable depuis l'application."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistique libelle="Entrees correspondantes" valeur={formatEntier(journal.total)} />
        <Statistique libelle="Page" valeur={`${formatEntier(journal.page)} / ${formatEntier(journal.pages)}`} />
        <Statistique
          libelle="Actions repertoriees"
          valeur={formatEntier(actions.length)}
          detail="Chaque action du catalogue est libellee en francais"
        />
        <Statistique libelle="Modules suivis" valeur={formatEntier(modules.length)} />
      </div>

      <Carte titre="Filtrer" description="Recherche sur le compte, l'objet ou le commentaire.">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Recherche</span>
            <input
              className="champ"
              type="search"
              name="recherche"
              defaultValue={liste.filtres.recherche ?? ""}
              placeholder="Compte, objet ou commentaire"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Module</span>
            <select className="champ" name="module" defaultValue={liste.filtres.module ?? ""}>
              <option value="">Tous les modules</option>
              {modules.map((module) => (
                <option key={module} value={module}>
                  {module}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Action</span>
            <select className="champ" name="action" defaultValue={liste.filtres.action ?? ""}>
              <option value="">Toutes les actions</option>
              {actions.map((action) => (
                <option key={action} value={action}>
                  {LIBELLES_ACTIONS[action] ?? action}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Objet</span>
            <input
              className="champ"
              type="text"
              name="entite"
              defaultValue={liste.filtres.entite ?? ""}
              placeholder="Exemple : Item, Invoice, WorkOrder"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Du</span>
            <input className="champ" type="date" name="du" defaultValue={premiereValeur(parametres, "du") ?? ""} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Au</span>
            <input className="champ" type="date" name="au" defaultValue={premiereValeur(parametres, "au") ?? ""} />
          </label>
          <div className="flex items-end gap-3 lg:col-span-2">
            <button
              type="submit"
              className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
              style={{ background: "var(--primaire)", color: "#ffffff", borderColor: "var(--primaire)" }}
            >
              Filtrer
            </button>
            <Link className="lien-nav text-sm" href={CHEMIN}>
              Reinitialiser
            </Link>
          </div>
        </form>
      </Carte>

      <div className="mt-5">
        <Carte titre="Entrees du journal" sansPadding>
          {journal.lignes.length === 0 ? (
            <Vide message="Aucune entree ne correspond aux filtres selectionnes." />
          ) : (
            <>
              <Tableau
                colonnes={[
                  { cle: "date", libelle: "Date et heure" },
                  { cle: "compte", libelle: "Compte" },
                  { cle: "action", libelle: "Action" },
                  { cle: "module", libelle: "Module" },
                  { cle: "objet", libelle: "Objet" },
                  { cle: "motif", libelle: "Motif ou commentaire" },
                  { cle: "detail", libelle: "Valeurs" },
                ]}
                lignes={journal.lignes.map((entree) => ({
                  cle: String(entree.id),
                  cellules: [
                    formatDateTime(entree.createdAt),
                    entree.user?.email ?? entree.userEmail ?? "Systeme",
                    <Etiquette key="action">{LIBELLES_ACTIONS[entree.action] ?? entree.action}</Etiquette>,
                    entree.module,
                    `${entree.entity}${entree.entityId ? ` #${entree.entityId}` : ""}`,
                    entree.reason ?? entree.comment ?? "-",
                    entree.oldValue || entree.newValue ? (
                      <details key="detail">
                        <summary className="cursor-pointer text-xs">Voir</summary>
                        <div className="mt-2 space-y-2 text-xs">
                          {entree.oldValue ? (
                            <div>
                              <p className="font-semibold">Valeur precedente</p>
                              <pre className="whitespace-pre-wrap">{texteJson(entree.oldValue)}</pre>
                            </div>
                          ) : null}
                          {entree.newValue ? (
                            <div>
                              <p className="font-semibold">Nouvelle valeur</p>
                              <pre className="whitespace-pre-wrap">{texteJson(entree.newValue)}</pre>
                            </div>
                          ) : null}
                          {entree.ip ? <p>Adresse IP : {entree.ip}</p> : null}
                        </div>
                      </details>
                    ) : (
                      "-"
                    ),
                  ],
                }))}
              />
              <Pagination
                page={journal.page}
                pages={journal.pages}
                total={journal.total}
                construireLien={fabricantLien(CHEMIN, {
                  recherche: liste.filtres.recherche,
                  module: liste.filtres.module,
                  action: liste.filtres.action,
                  entite: liste.filtres.entite,
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
