import { actionAdopterArticleChassisPeint, actionEcrireParametre } from "@/actions/administration";
import { aLaPermission, exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { ponderationsEvaluation, listerParametres, type ParametreAffiche } from "@/lib/settings";
import { analyserArticleChassisPeint } from "@/lib/production/chassis-peint";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Statistique,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatDateTime, formatEntier } from "@/lib/format";

export const metadata = { title: "Parametres" };

const CATEGORIES: { code: string; libelle: string; description: string }[] = [
  {
    code: "GENERAL",
    libelle: "Identite et general",
    description:
      "Raison sociale, devise, TVA par defaut et formats utilises sur tous les documents.",
  },
  {
    code: "COMMERCIAL",
    libelle: "Commercial",
    description: "Regles de creation automatique des ordres de fabrication.",
  },
  {
    code: "STOCK",
    libelle: "Stocks",
    description: "Tolerances d'inventaire et autorisation de stock negatif.",
  },
  {
    code: "QUALITE",
    libelle: "Qualite",
    description: "Obligations de controle et de liberation avant commercialisation.",
  },
  {
    code: "PRODUCTION",
    libelle: "Production",
    description: "Regles de fin de gamme, semi-finis et transferts inter-ateliers.",
  },
  {
    code: "EVALUATION",
    libelle: "Evaluation des employes",
    description:
      "Ponderations et seuils de fiabilite. Ces valeurs ne sont jamais codees en dur : elles pilotent le calcul des evaluations.",
  },
  {
    code: "IMPORT",
    libelle: "Import de donnees",
    description: "Dossier des fichiers sources et politique de mise a jour des fiches importees.",
  },
];

function ChampParametre({ parametre }: { parametre: ParametreAffiche }) {
  const valeur = parametre.value;

  if (typeof valeur === "boolean") {
    return (
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="value"
          defaultChecked={valeur}
          className="mt-1 h-5 w-5"
        />
        <span>{parametre.description}</span>
      </label>
    );
  }

  if (typeof valeur === "number") {
    return (
      <Champ
        nom="value"
        libelle="Valeur"
        type="number"
        valeur={valeur}
        pas="0.01"
        aide={parametre.description}
      />
    );
  }

  return (
    <Champ
      nom="value"
      libelle="Valeur"
      valeur={typeof valeur === "string" ? valeur : JSON.stringify(valeur)}
      maxLength={200}
      aide={parametre.description}
    />
  );
}

export default async function PageParametres() {
  const utilisateur = await exigerPermission(PERMISSIONS.CONFIG_LIRE);
  const peutGerer = aLaPermission(utilisateur, PERMISSIONS.CONFIG_GERER);

  const [parametres, ponderations, chassis] = await Promise.all([
    listerParametres(),
    ponderationsEvaluation(),
    peutGerer ? analyserArticleChassisPeint() : Promise.resolve(null),
  ]);

  const parCategorie = new Map<string, ParametreAffiche[]>();
  for (const parametre of parametres) {
    const liste = parCategorie.get(parametre.category) ?? [];
    liste.push(parametre);
    parCategorie.set(parametre.category, liste);
  }

  const personnalises = parametres.filter((parametre) => parametre.updatedAt !== null).length;
  const ponderationCoherente = ponderations.total.equals(100);

  return (
    <>
      <EnTetePage
        titre="Parametres"
        description="Reglages applicatifs : devise, TVA, tolerances de stock, obligations qualite, regles de production et ponderations d'evaluation. Chaque modification est journalisee dans le registre d'audit."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistique libelle="Parametres disponibles" valeur={formatEntier(parametres.length)} />
        <Statistique
          libelle="Valeurs personnalisees"
          valeur={formatEntier(personnalises)}
          detail="Parametres deja modifies par un administrateur"
        />
        <Statistique
          libelle="Ponderation d'evaluation"
          valeur={`${ponderations.total.toString()} %`}
          ton={ponderationCoherente ? "succes" : "alerte"}
          detail={
            ponderationCoherente
              ? "La somme des ponderations vaut 100 %"
              : "La somme des ponderations ne vaut pas 100 %"
          }
        />
        <Statistique
          libelle="Categories"
          valeur={formatEntier(CATEGORIES.length)}
          detail="Regroupement des parametres par domaine"
        />
      </div>

      {!ponderationCoherente && (
        <div className="mb-5">
          <Alerte ton="alerte" titre="Ponderation d'evaluation incoherente">
            <p>
              La somme des cinq ponderations vaut {ponderations.total.toString()} % au lieu de
              100 %. Les evaluations resteront calculees avec ces ponderations telles quelles :
              aucune valeur n'est corrigee automatiquement.
            </p>
          </Alerte>
        </div>
      )}

      {chassis && (
        <div className="mb-5">
          <Carte
            titre="Article semi-fini du transfert inter-divisions"
            description="Le chassis peint produit a la fin du poudrage ADMEDCO est transfere vers le depot MOBILIX DEP-MP-MBX. La plateforme recherche d'abord un article equivalent deja importe avant d'en creer un : aucun doublon n'est cree, et un article deja utilise par le transfert n'est jamais remplace en silence."
          >
            <div className="space-y-4">
              <div
                className="rounded-lg border p-4"
                style={{ borderColor: "var(--bordure)" }}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Article utilise par le transfert</p>
                  {chassis.article ? (
                    <Etiquette>{chassis.article.code}</Etiquette>
                  ) : (
                    <EtiquetteStatut libelle="Aucun article determine" code="INACTIF" />
                  )}
                </div>

                {chassis.article ? (
                  <p className="text-sm">{chassis.article.label1}</p>
                ) : (
                  <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                    Aucun article ne correspond encore au code logique configure. L'article de
                    reference sera cree lors de la prochaine initialisation du referentiel.
                  </p>
                )}

                <dl className="mt-3 space-y-1 text-xs" style={{ color: "var(--texte-doux)" }}>
                  <div className="flex flex-wrap gap-2">
                    <dt>Code logique configure (CODE_SEMI_FINI_CHASSIS) :</dt>
                    <dd className="font-mono">{chassis.codeConfigure}</dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <dt>Regle de transfert appliquee :</dt>
                    <dd>
                      {chassis.regle
                        ? `${chassis.regle.code} (declenchement : fin du poudrage)`
                        : "aucune regle active a ce jour"}
                    </dd>
                  </div>
                </dl>
              </div>

              {chassis.messages.map((message) => (
                <Alerte key={message} ton="alerte" titre="Correspondance a confirmer">
                  <p>{message}</p>
                </Alerte>
              ))}

              {chassis.candidats.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">
                    Articles importes pouvant tenir le role de chassis peint
                  </p>
                  <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                    Aucun choix n&apos;est effectue automatiquement. La confirmation ci-dessous
                    reaffecte la regle de transfert et est journalisee dans le registre d&apos;audit ;
                    l&apos;article actuellement utilise n&apos;est ni supprime ni modifie.
                  </p>

                  {chassis.candidats.map((candidat) => (
                    <div
                      key={candidat.id}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"
                      style={{ borderColor: "var(--bordure)" }}
                    >
                      <div>
                        <p className="text-sm font-medium">
                          <span className="font-mono">{candidat.code}</span> — {candidat.label1}
                        </p>
                        <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                          Article importe
                          {candidat.sourceSystem ? ` (${candidat.sourceSystem})` : ""}
                          {chassis.article?.id === candidat.id ? " — deja utilise" : ""}
                        </p>
                      </div>

                      {peutGerer && chassis.article?.id !== candidat.id && (
                        <FormulaireAction
                          action={actionAdopterArticleChassisPeint}
                          libelleSoumettre="Utiliser cet article"
                          varianteSoumettre="secondaire"
                          discret
                        >
                          <input type="hidden" name="itemId" value={candidat.id} />
                        </FormulaireAction>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                  Aucun article importe ne correspond a la fois a « chassis » et a « peint » :
                  aucun doublon n&apos;est a craindre pour ce semi-fini.
                </p>
              )}
            </div>
          </Carte>
        </div>
      )}

      <div className="space-y-5">
        {CATEGORIES.map((categorie) => {
          const liste = parCategorie.get(categorie.code) ?? [];
          if (liste.length === 0) return null;

          return (
            <Carte
              key={categorie.code}
              titre={categorie.libelle}
              description={categorie.description}
            >
              <div className="space-y-4">
                {liste.map((parametre) => (
                  <div
                    key={parametre.key}
                    className="rounded-lg border p-4"
                    style={{ borderColor: "var(--bordure)" }}
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{parametre.label}</p>
                      <div className="flex items-center gap-2">
                        <Etiquette>{parametre.key}</Etiquette>
                        <EtiquetteStatut
                          libelle={parametre.updatedAt ? "Personnalise" : "Valeur par defaut"}
                          code={parametre.updatedAt ? "ACTIF" : "INACTIF"}
                        />
                      </div>
                    </div>

                    <FormulaireAction
                      action={actionEcrireParametre}
                      libelleSoumettre="Enregistrer"
                      rafraichir
                    >
                      <input type="hidden" name="key" value={parametre.key} />
                      <ChampParametre parametre={parametre} />
                    </FormulaireAction>

                    {parametre.updatedAt && (
                      <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                        Derniere modification le {formatDateTime(parametre.updatedAt)}
                        {parametre.updatedBy ? ` par ${parametre.updatedBy}` : ""}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Carte>
          );
        })}
      </div>
    </>
  );
}
