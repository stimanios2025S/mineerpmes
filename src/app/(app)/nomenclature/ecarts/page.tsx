import Link from "next/link";
import type { FormulaVarianceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  actionAccepterEcart,
  actionPrendreEcartEnAnalyse,
  actionResoudreEcart,
} from "@/actions/nomenclature";
import {
  aLaPermission,
  exigerPermission,
  usinesAutorisees,
} from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fabricantLien,
  lireParametresListe,
  modeInsensible,
  pagination,
  premiereValeur,
} from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  EtiquetteStatut,
  Pagination,
  Statistique,
  Tableau,
} from "@/components/ui";
import { BoutonAction, Champ, FormulaireAction, FormulaireMotif } from "@/components/interactif";
import { formatDateTime, formatEntier } from "@/lib/format";
import { LIBELLES_STATUT_ECART_NOMENCLATURE, libelle } from "@/lib/libelles";

export const metadata = { title: "Ecarts de nomenclature" };

const STATUTS_ECART: FormulaVarianceStatus[] = [
  "OUVERT",
  "EN_ANALYSE",
  "RESOLU",
  "ACCEPTE",
];

/**
 * Arbitrage des contradictions de quantite.
 *
 * L'application ne choisit jamais une quantite a la place de l'administrateur :
 * les deux valeurs d'origine sont affichees telles qu'elles ont ete detectees, et
 * seule une decision explicite et motivee fait passer l'ecart a « resolu » ou
 * « accepte ». Les lignes de nomenclature ne sont jamais reecrites par cet
 * arbitrage : l'historique reste consultable.
 */
export default async function PageEcartsNomenclature({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_LIRE);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, ["statut"]);
  const statut = STATUTS_ECART.find((valeur) => valeur === parametres.filtres.statut);
  const recherche = parametres.recherche;

  const conditions: Prisma.FormulaVarianceWhereInput[] = [
    { formula: { item: { factory: { in: usinesAutorisees(utilisateur) } } } },
  ];
  if (statut) conditions.push({ status: statut });

  if (recherche) {
    // Le composant n'est pas une relation directe de l'ecart : les articles
    // correspondants sont resolus en base avant d'etre injectes dans le filtre.
    const articlesCorrespondants = await prisma.item.findMany({
      where: {
        OR: [
          { code: modeInsensible(recherche) },
          { label1: modeInsensible(recherche) },
        ],
      },
      select: { id: true },
      take: 500,
    });
    const identifiants = articlesCorrespondants.map((article) => article.id);

    const ou: Prisma.FormulaVarianceWhereInput[] = [
      { formula: { code: modeInsensible(recherche) } },
      { formula: { item: { code: modeInsensible(recherche) } } },
      { formula: { item: { label1: modeInsensible(recherche) } } },
      { sourceA: modeInsensible(recherche) },
      { sourceB: modeInsensible(recherche) },
    ];
    if (identifiants.length > 0) {
      ou.push({ componentItemId: { in: identifiants } });
      ou.push({ formulaLine: { componentItemId: { in: identifiants } } });
    }
    conditions.push({ OR: ou });
  }

  const where: Prisma.FormulaVarianceWhereInput = { AND: conditions };

  const [total, parStatut] = await Promise.all([
    prisma.formulaVariance.count({ where }),
    prisma.formulaVariance.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const bornes = pagination(total, parametres.page, parametres.taille);
  const ecarts = await prisma.formulaVariance.findMany({
    where,
    orderBy: [{ status: "asc" }, { detectedAt: "desc" }],
    skip: bornes.skip,
    take: bornes.take,
    include: {
      formula: {
        select: {
          id: true,
          code: true,
          version: true,
          status: true,
          item: { select: { id: true, code: true, label1: true } },
        },
      },
      formulaLine: {
        select: { id: true, lineNo: true, componentItemId: true, quantity: true },
      },
    },
  });

  // Composants cites par les ecarts : resolus en une seule requete.
  const identifiantsComposants = new Set<number>();
  for (const ecart of ecarts) {
    if (ecart.componentItemId !== null) identifiantsComposants.add(ecart.componentItemId);
    if (ecart.formulaLine) identifiantsComposants.add(ecart.formulaLine.componentItemId);
  }
  const composants =
    identifiantsComposants.size === 0
      ? []
      : await prisma.item.findMany({
          where: { id: { in: [...identifiantsComposants] } },
          select: { id: true, code: true, label1: true },
        });
  const composantsParId = new Map(
    composants.map((composant) => [composant.id, composant]),
  );

  const nombreParStatut = new Map<string, number>();
  for (const ligne of parStatut) {
    nombreParStatut.set(ligne.status, ligne._count._all);
  }

  const peutValider = aLaPermission(utilisateur, PERMISSIONS.NOMENCLATURE_VALIDER);

  const filtresCourants = {
    q: recherche,
    statut: premiereValeur(parametresBruts, "statut"),
    taille: parametres.taille,
  };

  return (
    <>
      <EnTetePage
        titre="Ecarts de quantite"
        description="Contradictions detectees entre plusieurs sources pour un meme composant. Aucune quantite n'est choisie automatiquement : chaque ecart est tranche explicitement, avec un motif, et les valeurs d'origine sont conservees."
        actions={
          <Link className="lien-nav text-sm" href="/nomenclature">
            Retour aux nomenclatures
          </Link>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Statistique
          libelle={libelle(LIBELLES_STATUT_ECART_NOMENCLATURE, "OUVERT")}
          valeur={formatEntier(nombreParStatut.get("OUVERT") ?? 0)}
          ton="alerte"
          detail="Aucun arbitrage engage"
        />
        <Statistique
          libelle={libelle(LIBELLES_STATUT_ECART_NOMENCLATURE, "EN_ANALYSE")}
          valeur={formatEntier(nombreParStatut.get("EN_ANALYSE") ?? 0)}
          ton="info"
          detail="Analyse en cours"
        />
        <Statistique
          libelle={libelle(LIBELLES_STATUT_ECART_NOMENCLATURE, "RESOLU")}
          valeur={formatEntier(nombreParStatut.get("RESOLU") ?? 0)}
          ton="succes"
          detail="Quantite retenue consignee"
        />
        <Statistique
          libelle={libelle(LIBELLES_STATUT_ECART_NOMENCLATURE, "ACCEPTE")}
          valeur={formatEntier(nombreParStatut.get("ACCEPTE") ?? 0)}
          detail="Ecart tolere, valeurs d'origine intactes"
        />
      </div>

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Filtres des ecarts"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Article ou composant</span>
          <input
            className="champ"
            type="search"
            name="q"
            defaultValue={recherche ?? ""}
            placeholder="Code article, designation, composant ou source"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Statut</span>
          <select className="champ" name="statut" defaultValue={filtresCourants.statut ?? ""}>
            <option value="">Tous les statuts</option>
            {STATUTS_ECART.map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_STATUT_ECART_NOMENCLATURE, valeur)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex min-h-[42px] items-center rounded-lg border px-4 text-sm font-semibold"
          style={{
            background: "var(--surface)",
            borderColor: "var(--bordure-forte)",
            color: "var(--texte)",
          }}
        >
          Filtrer
        </button>
        <Link className="lien-nav text-sm" href="/nomenclature/ecarts">
          Reinitialiser
        </Link>
      </form>

      <Carte
        titre="Ecarts detectes"
        description="Le numero de ligne et les valeurs proviennent de la detection d'origine ; elles ne sont jamais reecrites, meme apres arbitrage."
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "composant", libelle: "Composant" },
            { cle: "version", libelle: "Version concernee" },
            { cle: "sourceA", libelle: "Quantite source A" },
            { cle: "sourceB", libelle: "Quantite source B" },
            { cle: "delta", libelle: "Ecart constate", nombre: true },
            { cle: "statut", libelle: "Statut" },
            { cle: "detection", libelle: "Detecte le" },
            { cle: "actions", libelle: "Arbitrage" },
          ]}
          lignes={ecarts.map((ecart) => {
            const composantId = ecart.componentItemId ?? ecart.formulaLine?.componentItemId ?? null;
            const composant = composantId === null ? undefined : composantsParId.get(composantId);
            const arbitre = ecart.status === "RESOLU" || ecart.status === "ACCEPTE";

            const optionsSources: { valeur: string; libelle: string }[] = [];
            if (ecart.valueA) {
              optionsSources.push({
                valeur: ecart.valueA,
                libelle: `${ecart.sourceA} : ${ecart.valueA}`,
              });
            }
            if (ecart.valueB) {
              optionsSources.push({
                valeur: ecart.valueB,
                libelle: `${ecart.sourceB} : ${ecart.valueB}`,
              });
            }

            return {
              cle: String(ecart.id),
              cellules: [
                <div key="composant">
                  {composant ? (
                    <Link className="lien-nav" href={`/referentiel/articles/${composant.id}`}>
                      {composant.code}
                    </Link>
                  ) : (
                    <span>Article non identifie</span>
                  )}
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    {composant ? composant.label1 : "Le composant d'origine n'est plus rattache"}
                    {ecart.formulaLine ? ` — ligne ${ecart.formulaLine.lineNo}` : ""}
                  </span>
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    Article parent : {ecart.formula.item.code} — {ecart.formula.item.label1}
                  </span>
                </div>,
                <Link
                  key="version"
                  className="lien-nav"
                  href={`/nomenclature/${ecart.formula.id}`}
                >
                  {ecart.formula.code} v{ecart.formula.version}
                </Link>,
                <div key="a">
                  <span className="block text-sm">{ecart.valueA ?? "Valeur absente"}</span>
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    Source : {ecart.sourceA}
                  </span>
                </div>,
                <div key="b">
                  <span className="block text-sm">{ecart.valueB ?? "Valeur absente"}</span>
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    Source : {ecart.sourceB}
                  </span>
                </div>,
                <span key="delta" className="tabular-nums">
                  {ecart.delta ?? "Non calcule"}
                </span>,
                <EtiquetteStatut
                  key="statut"
                  libelle={libelle(LIBELLES_STATUT_ECART_NOMENCLATURE, ecart.status)}
                  code={ecart.status}
                />,
                <span key="detection">{formatDateTime(ecart.detectedAt)}</span>,
                <div key="actions">
                  {arbitre ? (
                    <div className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      <p>
                        Quantite retenue :{" "}
                        <strong>{ecart.resolvedValue ?? "aucune (ecart accepte)"}</strong>
                      </p>
                      <p>Arbitre le {formatDateTime(ecart.resolvedAt)}</p>
                      {ecart.resolutionNote && <p>Note : {ecart.resolutionNote}</p>}
                    </div>
                  ) : peutValider ? (
                    <details>
                      <summary className="lien-nav cursor-pointer text-sm">
                        Arbitrer cet ecart
                      </summary>
                      <div className="mt-3 flex flex-col gap-4" style={{ minWidth: "22rem" }}>
                        {ecart.status === "OUVERT" && (
                          <BoutonAction
                            action={actionPrendreEcartEnAnalyse}
                            libelle="Prendre en analyse"
                            champsCaches={{ varianceId: ecart.id }}
                          />
                        )}

                        <FormulaireAction
                          action={actionResoudreEcart}
                          libelleSoumettre="Resoudre avec la quantite retenue"
                          reinitialiser
                        >
                          <input type="hidden" name="varianceId" value={ecart.id} />
                          <div className="grid grid-cols-1 gap-3">
                            <Champ
                              nom="quantiteRetenueSource"
                              libelle="Quantite retenue (l'une des sources comparees)"
                              type="select"
                              options={optionsSources}
                              aide="Choix explicite : aucune quantite n'est deduite ni moyennee."
                            />
                            <Champ
                              nom="quantiteRetenueAutre"
                              libelle="Ou quantite arbitree (saisie manuelle)"
                              type="number"
                              pas="0.000001"
                              min="0"
                              aide="Si ce champ est renseigne, il prime sur la source selectionnee."
                            />
                            <label className="block text-sm">
                              <span className="mb-1 block font-medium">
                                Note d'ecart
                                <span style={{ color: "var(--danger)" }}> *</span>
                              </span>
                              <textarea
                                className="champ"
                                name="motif"
                                rows={3}
                                required
                                minLength={10}
                                placeholder="Note obligatoire (au moins 10 caracteres) : pourquoi cette quantite"
                              />
                            </label>
                          </div>
                          <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                            Les valeurs d'origine restent enregistrees telles quelles : la
                            resolution consigne la quantite retenue, le valideur, la date et
                            la note, sans reecrire l'historique.
                          </p>
                        </FormulaireAction>

                        <div className="border-t pt-3">
                          <p className="mb-2 text-sm font-medium">
                            Ou accepter l'ecart tel quel
                          </p>
                          <FormulaireMotif
                            action={actionAccepterEcart}
                            libelleSoumettre="Accepter l'ecart"
                            libelleMotif="Motif d'acceptation"
                            champsCaches={{ varianceId: ecart.id }}
                            placeholder="Motif obligatoire (au moins 10 caracteres) : pourquoi les deux valeurs sont acceptables"
                          />
                        </div>
                      </div>
                    </details>
                  ) : (
                    <span className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      Permission « validation des nomenclatures » requise pour trancher
                      cet ecart.
                    </span>
                  )}
                </div>,
              ],
            };
          })}
          messageVide="Aucun ecart de quantite ne correspond aux filtres selectionnes."
        />
        <Pagination
          page={parametres.page}
          pages={bornes.pages}
          total={total}
          construireLien={fabricantLien("/nomenclature/ecarts", filtresCourants)}
        />
      </Carte>

      <div className="mt-5">
        <Alerte
          ton="info"
          titre="Pourquoi l'application ne tranche jamais a votre place"
        >
          Deux sources peuvent decrire la meme nomenclature avec des quantites
          differentes (import d'un schema, fichier de reprise, ligne saisie
          manuellement). Choisir en silence produirait des consommations de matiere
          fausses et invisibles. L'ecart est donc conserve, qualifie par ses deux
          sources, et laisse a l'arbitrage : la decision est motivee, tracee, et
          l'historique d'origine reste consultable indefiniment.
        </Alerte>
      </div>
    </>
  );
}
