import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import {
  actionActiverNomenclature,
  actionAjouterComposant,
  actionArchiverNomenclature,
  actionCreerVersionNomenclature,
  actionModifierComposant,
  actionRetirerComposant,
  actionSoumettreNomenclature,
  actionValiderNomenclature,
} from "@/actions/nomenclature";
import {
  aLaPermission,
  exigerPermission,
  peutAccederUsine,
} from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { identifiantOuNull } from "@/lib/liste";
import { CLE_PARAMETRE, lireParametreTexte } from "@/lib/settings";
import {
  Alerte,
  Carte,
  EnTetePage,
  EtiquetteStatut,
  ListeDefinitions,
  Section,
  Tableau,
  Vide,
} from "@/components/ui";
import { BoutonAction, Champ, FormulaireAction } from "@/components/interactif";
import {
  DEVISE_PAR_DEFAUT,
  formatDate,
  formatDateTime,
  formatEntier,
  formatMontant,
  formatPourcentage,
  formatQuantite,
} from "@/lib/format";
import {
  LIBELLES_STATUT_NOMENCLATURE,
  LIBELLES_STATUT_ORDRE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Fiche nomenclature" };

/** Statuts pour lesquels la formulation est figee : aucune ligne n'est modifiable. */
const STATUTS_FIGES: readonly string[] = [
  "EN_VALIDATION",
  "VALIDEE",
  "ACTIVE",
  "REMPLACEE",
  "ARCHIVEE",
];

export default async function PageNomenclature({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_LIRE);

  const { id: identifiantBrut } = await params;
  const identifiant = identifiantOuNull(identifiantBrut);
  if (!identifiant) notFound();

  const formule = await prisma.formula.findUnique({
    where: { id: identifiant },
    include: {
      item: {
        select: {
          id: true,
          code: true,
          label1: true,
          designation: true,
          factory: true,
          vwap: true,
          family: { select: { code: true, label: true } },
        },
      },
      approvedBy: { select: { email: true } },
      previousVersion: { select: { id: true, version: true, status: true } },
      warehouseStore: { select: { code: true, label: true } },
      warehouseProd: { select: { code: true, label: true } },
      lines: {
        orderBy: { lineNo: "asc" },
        include: {
          componentItem: {
            select: {
              id: true,
              code: true,
              label1: true,
              unitCode: true,
              vwap: true,
              factory: true,
            },
          },
          unit: { select: { code: true, label: true } },
          consumptionWarehouse: { select: { code: true, label: true } },
        },
      },
    },
  });

  if (!formule) notFound();
  // La portee de division est verifiee cote serveur : aucun acces par URL directe.
  if (!peutAccederUsine(utilisateur, formule.item.factory)) notFound();

  const [
    operations,
    depots,
    unites,
    articles,
    ordres,
    ecartsOuverts,
    devise,
  ] = await Promise.all([
    prisma.operation.findMany({
      orderBy: [{ boardOrder: "asc" }, { code: "asc" }],
      take: 1000,
      select: { code: true, label: true, isActive: true, factory: true },
    }),
    prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      take: 300,
      select: { id: true, code: true, label: true },
    }),
    prisma.unitOfMeasure.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      take: 200,
      select: { code: true, label: true },
    }),
    prisma.item.findMany({
      where: { status: { not: "ARCHIVE" } },
      orderBy: { code: "asc" },
      take: 1000,
      select: { id: true, code: true, label1: true, unitCode: true },
    }),
    prisma.workOrder.findMany({
      where: { formulaId: formule.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        number: true,
        status: true,
        quantityPlanned: true,
        createdAt: true,
      },
    }),
    prisma.formulaVariance.count({
      where: {
        formulaId: formule.id,
        status: { in: ["OUVERT", "EN_ANALYSE"] },
      },
    }),
    lireParametreTexte(CLE_PARAMETRE.DEVISE, DEVISE_PAR_DEFAUT),
  ]);

  const operationsParCode = new Map(
    operations.map((operation) => [operation.code, operation]),
  );

  const modifiable = formule.status === "BROUILLON";
  const peutEcrire = aLaPermission(utilisateur, PERMISSIONS.NOMENCLATURE_ECRIRE);
  const peutValider = aLaPermission(utilisateur, PERMISSIONS.NOMENCLATURE_VALIDER);

  /**
   * Cout matiere theorique d'une ligne : quantite augmentee du taux de perte
   * prevu, valorisee au cout moyen reel (VWAP) du composant. Le cout n'est pas
   * fige dans la ligne : il est recalcule ici, a partir de la base, pour ne
   * jamais afficher une valeur perimee.
   */
  const coutTheorique = (ligne: (typeof formule.lines)[number]) =>
    D.roundAmount(
      D.mul(
        D.applyLossRate(ligne.quantity, ligne.lossRate),
        D.of(ligne.componentItem.vwap),
      ),
    );

  const coutTotal = D.sum(formule.lines.map((ligne) => coutTheorique(ligne)));

  // Un composant sans cout moyen reel n'est pas valorise : l'information est
  // affichee explicitement plutot que de laisser croire a un cout nul.
  const composantsNonValorises = formule.lines.filter((ligne) =>
    D.isZero(ligne.componentItem.vwap),
  ).length;

  const optionsOperations = operations
    .filter((operation) => operation.isActive)
    .map((operation) => ({
      valeur: operation.code,
      libelle: `${operation.code} — ${operation.label}`,
    }));

  const statutFige = STATUTS_FIGES.includes(formule.status);

  return (
    <>
      <EnTetePage
        titre={`${formule.item.code} — ${formule.code} v${formule.version}`}
        description={
          <>
            {formule.label} · {formule.item.label1}
            {formule.item.family ? ` · famille ${formule.item.family.label}` : ""}
          </>
        }
        actions={
          <>
            <Link className="lien-nav text-sm" href="/nomenclature">
              Retour a la liste
            </Link>
            <Link
              className="lien-nav text-sm"
              href={`/referentiel/articles/${formule.item.id}`}
            >
              Fiche article
            </Link>
          </>
        }
      />

      {ecartsOuverts > 0 && (
        <div className="mb-5">
          <Alerte
            ton="alerte"
            titre={`${formatEntier(ecartsOuverts)} ecart(s) de quantite non arbitre(s) sur cette version`}
          >
            Les sources comparees ne s'accordent pas sur une quantite. Aucune valeur
            n'est retenue automatiquement : l'arbitrage se fait explicitement depuis{" "}
            <Link className="lien-nav" href="/nomenclature/ecarts">
              Nomenclatures &gt; Ecarts
            </Link>
            . L'historique d'origine reste inchange.
          </Alerte>
        </div>
      )}

      <Carte titre="En-tete de la version" description="Identite et cycle de vie de la version.">
        <ListeDefinitions
          elements={[
            {
              terme: "Article parent",
              valeur: (
                <Link className="lien-nav" href={`/referentiel/articles/${formule.item.id}`}>
                  {formule.item.code} — {formule.item.label1}
                </Link>
              ),
            },
            {
              terme: "Statut",
              valeur: (
                <EtiquetteStatut
                  libelle={libelle(LIBELLES_STATUT_NOMENCLATURE, formule.status)}
                  code={formule.status}
                />
              ),
            },
            { terme: "Code de version", valeur: formule.code },
            {
              terme: "Version",
              valeur: (
                <span className="tabular-nums">
                  v{formule.version}
                  {formule.previousVersion && (
                    <>
                      {" "}
                      <Link
                        className="lien-nav text-xs"
                        href={`/nomenclature/${formule.previousVersion.id}`}
                      >
                        (remplace la v{formule.previousVersion.version})
                      </Link>
                    </>
                  )}
                </span>
              ),
            },
            { terme: "Date d'effet", valeur: formatDate(formule.effectiveFrom) },
            { terme: "Date de fin", valeur: formatDate(formule.effectiveTo) },
            {
              terme: "Valideur",
              valeur: formule.approvedBy ? (
                <>
                  {formule.approvedBy.email}
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    le {formatDateTime(formule.approvedAt)}
                  </span>
                </>
              ) : (
                "Aucune validation enregistree"
              ),
            },
            {
              terme: "Depot de consommation",
              valeur: formule.warehouseStore
                ? `${formule.warehouseStore.code} — ${formule.warehouseStore.label}`
                : "Non renseigne",
            },
            {
              terme: "Depot de production",
              valeur: formule.warehouseProd
                ? `${formule.warehouseProd.code} — ${formule.warehouseProd.label}`
                : "Non renseigne",
            },
            {
              terme: "Composants",
              valeur: `${formatEntier(formule.lines.length)} ligne(s)`,
            },
            {
              terme: "Cout matiere theorique",
              valeur: (
                <span title="Quantites majorees des taux de perte, valorisees au cout moyen reel (VWAP) des composants">
                  {formule.lines.length === 0
                    ? "Aucun composant"
                    : formatMontant(coutTotal, devise)}
                  {composantsNonValorises > 0 && (
                    <span className="block text-xs" style={{ color: "var(--danger)" }}>
                      Cout partiel : {formatEntier(composantsNonValorises)} composant(s)
                      sans cout moyen renseigne (VWAP nul).
                    </span>
                  )}
                </span>
              ),
            },
            {
              terme: "Notes",
              valeur: formule.notes ?? "Aucune note",
            },
          ]}
        />

        {formule.changeReason && (
          <p className="mt-4 text-sm" style={{ color: "var(--texte-doux)" }}>
            Motif enregistre lors de la creation de cette version : « {formule.changeReason} »
          </p>
        )}
      </Carte>

      <Section titre="Cycle de vie de la version">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Carte
            titre="Actions disponibles"
            description="Chaque etape est controlee cote serveur : le bouton n'est qu'une indication."
          >
            {statutFige && (
              <div className="mb-4">
                <Alerte
                  ton="alerte"
                  titre={`Cette version est au statut « ${libelle(LIBELLES_STATUT_NOMENCLATURE, formule.status)} »`}
                >
                  Ses composants ne sont plus modifiables et le serveur refuse toute
                  tentative de modification. Pour faire evoluer la formulation, creez une
                  nouvelle version : elle repartira en brouillon avec une copie des
                  composants, et les ordres de fabrication deja lances conserveront cette
                  version-ci.
                </Alerte>
              </div>
            )}

            <div className="space-y-5">
              {modifiable && (
                <div>
                  <p className="mb-2 text-sm font-medium">
                    Soumettre la version a validation
                  </p>
                  {peutValider ? (
                    <FormulaireAction
                      action={actionSoumettreNomenclature}
                      libelleSoumettre="Soumettre a validation"
                    >
                      <input type="hidden" name="formulaId" value={formule.id} />
                      <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                        La version doit comporter au moins un composant. Une fois soumise,
                        elle n'est plus modifiable.
                      </p>
                    </FormulaireAction>
                  ) : (
                    <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      Permission « validation des nomenclatures » requise.
                    </p>
                  )}
                </div>
              )}

              {formule.status === "EN_VALIDATION" && (
                <div>
                  <p className="mb-2 text-sm font-medium">
                    Valider la version (decision du valideur)
                  </p>
                  {peutValider ? (
                    <FormulaireAction
                      action={actionValiderNomenclature}
                      libelleSoumettre="Valider la version"
                    >
                      <input type="hidden" name="formulaId" value={formule.id} />
                      <Champ
                        nom="motif"
                        libelle="Observation du valideur (facultative)"
                        type="textarea"
                        maxLength={1000}
                      />
                    </FormulaireAction>
                  ) : (
                    <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      Permission « validation des nomenclatures » requise.
                    </p>
                  )}
                </div>
              )}

              {formule.status === "VALIDEE" && (
                <div>
                  <p className="mb-2 text-sm font-medium">Activer la version</p>
                  {peutValider ? (
                    <FormulaireAction
                      action={actionActiverNomenclature}
                      libelleSoumettre="Activer la version"
                    >
                      <input type="hidden" name="formulaId" value={formule.id} />
                      <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                        L'activation archive les autres versions actives ou remplacees du
                        meme article : la version precedente termine ainsi son cycle
                        (remplacee, puis archivee). Les ordres de fabrication en cours
                        gardent leur version figee.
                      </p>
                    </FormulaireAction>
                  ) : (
                    <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      Permission « validation des nomenclatures » requise.
                    </p>
                  )}
                </div>
              )}

              {!modifiable && (
                <div>
                  <p className="mb-2 text-sm font-medium">
                    Creer une nouvelle version (seul moyen de modifier la formulation)
                  </p>
                  {peutEcrire ? (
                    <FormulaireAction
                      action={actionCreerVersionNomenclature}
                      libelleSoumettre="Creer la nouvelle version"
                      reinitialiser
                    >
                      <input type="hidden" name="formulaId" value={formule.id} />
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Champ
                          nom="dateEffet"
                          libelle="Date d'effet de la nouvelle version"
                          type="date"
                        />
                        <Champ
                          nom="dateFin"
                          libelle="Date de fin de la nouvelle version"
                          type="date"
                        />
                      </div>
                      <label className="mt-4 block text-sm">
                        <span className="mb-1 block font-medium">
                          Motif de la nouvelle version
                          <span style={{ color: "var(--danger)" }}> *</span>
                        </span>
                        <textarea
                          className="champ"
                          name="motif"
                          rows={3}
                          required
                          minLength={10}
                          placeholder="Motif obligatoire (au moins 10 caracteres) : ce qui change et pourquoi"
                        />
                      </label>
                      <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                        Les {formatEntier(formule.lines.length)} composant(s) sont copies a
                        l'identique ; la nouvelle version repart en brouillon avec un numero
                        incremente. Cette version passera au statut «{" "}
                        {libelle(LIBELLES_STATUT_NOMENCLATURE, "REMPLACEE")} ».
                      </p>
                    </FormulaireAction>
                  ) : (
                    <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      Permission « ecriture des nomenclatures » requise.
                    </p>
                  )}
                </div>
              )}

              {formule.status !== "ARCHIVEE" && formule.status !== "EN_VALIDATION" && (
                <div>
                  <p className="mb-2 text-sm font-medium">Archiver la version</p>
                  {peutValider ? (
                    <FormulaireAction
                      action={actionArchiverNomenclature}
                      libelleSoumettre="Archiver la version"
                      varianteSoumettre="danger"
                      reinitialiser
                    >
                      <input type="hidden" name="formulaId" value={formule.id} />
                      <label className="block text-sm">
                        <span className="mb-1 block font-medium">
                          Motif d'archivage
                          <span style={{ color: "var(--danger)" }}> *</span>
                        </span>
                        <textarea
                          className="champ"
                          name="motif"
                          rows={3}
                          required
                          minLength={10}
                          placeholder="Motif obligatoire (au moins 10 caracteres)"
                        />
                      </label>
                      <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                        Aucune donnee n'est supprimee : la version reste consultable et
                        demeure rattachee aux ordres de fabrication qui l'ont consommee.
                      </p>
                    </FormulaireAction>
                  ) : (
                    <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      Permission « validation des nomenclatures » requise.
                    </p>
                  )}
                </div>
              )}
            </div>
          </Carte>

          <Carte
            titre="Ordres de fabrication rattaches"
            description="Ces ordres ont ete lances avec cette version : elle est figee pour eux et le restera, quelle que soit l'evolution de la nomenclature."
          >
            {ordres.length === 0 ? (
              <Vide
                titre="Aucun ordre de fabrication"
                message="Aucun ordre de fabrication n'utilise cette version. Elle est donc encore librement remplacable depuis la fiche."
              />
            ) : (
              <Tableau
                colonnes={[
                  { cle: "numero", libelle: "Ordre" },
                  { cle: "statut", libelle: "Statut" },
                  { cle: "quantite", libelle: "Quantite planifiee", nombre: true },
                  { cle: "creation", libelle: "Cree le" },
                ]}
                lignes={ordres.map((ordre) => ({
                  cle: String(ordre.id),
                  cellules: [
                    <Link key="n" className="lien-nav" href={`/production/${ordre.id}`}>
                      {ordre.number}
                    </Link>,
                    <EtiquetteStatut
                      key="s"
                      libelle={libelle(LIBELLES_STATUT_ORDRE, ordre.status)}
                      code={ordre.status}
                    />,
                    <span key="q" className="tabular-nums">
                      {formatQuantite(ordre.quantityPlanned, 6)}
                    </span>,
                    <span key="c">{formatDate(ordre.createdAt)}</span>,
                  ],
                }))}
              />
            )}
            {ordres.length > 0 && (
              <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
                Les 25 ordres les plus recents sont affiches. La version consommee est
                enregistree dans chaque ordre et n'est jamais reecrite par la suite.
              </p>
            )}
          </Carte>
        </div>
      </Section>

      <Section titre="Composants de la formulation">
        <Carte
          titre={`${formatEntier(formule.lines.length)} composant(s)`}
          description="Le cout matiere theorique est recalcule a l'affichage a partir du cout moyen reel (VWAP) de chaque article : aucune valeur de cout n'est figee dans la ligne."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "ordre", libelle: "Ordre", nombre: true },
              { cle: "article", libelle: "Article" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "unite", libelle: "Unite" },
              { cle: "perte", libelle: "Perte prevue", nombre: true },
              { cle: "rebut", libelle: "Rebut", nombre: true },
              { cle: "operation", libelle: "Operation de consommation" },
              { cle: "depot", libelle: "Depot de consommation" },
              { cle: "cout", libelle: "Cout matiere theorique", nombre: true },
              { cle: "actions", libelle: "Actions" },
            ]}
            lignes={formule.lines.map((ligne) => {
              const operation = ligne.operationCode
                ? operationsParCode.get(ligne.operationCode)
                : undefined;

              return {
                cle: String(ligne.id),
                cellules: [
                  <span key="ordre" className="tabular-nums">
                    {ligne.lineNo}
                  </span>,
                  <div key="article">
                    <Link
                      className="lien-nav"
                      href={`/referentiel/articles/${ligne.componentItem.id}`}
                    >
                      {ligne.componentItem.code}
                    </Link>
                    <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                      {ligne.componentItem.label1}
                    </span>
                    {ligne.notes && (
                      <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                        {ligne.notes}
                      </span>
                    )}
                  </div>,
                  <span key="quantite" className="tabular-nums">
                    {formatQuantite(ligne.quantity, 6)}
                  </span>,
                  <span key="unite">
                    {ligne.unit
                      ? `${ligne.unit.code} — ${ligne.unit.label}`
                      : "Non renseignee"}
                  </span>,
                  <span key="perte" className="tabular-nums">
                    {formatPourcentage(ligne.lossRate, 4)}
                  </span>,
                  <span key="rebut" className="tabular-nums">
                    {formatPourcentage(ligne.scrapRate, 4)}
                  </span>,
                  <span key="operation">
                    {ligne.operationCode
                      ? operation
                        ? `${operation.code} — ${operation.label}`
                        : `${ligne.operationCode} (operation introuvable au referentiel)`
                      : "Aucune operation"}
                  </span>,
                  <span key="depot">
                    {ligne.consumptionWarehouse
                      ? `${ligne.consumptionWarehouse.code} — ${ligne.consumptionWarehouse.label}`
                      : formule.warehouseStore
                        ? `Depot de la version : ${formule.warehouseStore.code}`
                        : "Non renseigne"}
                  </span>,
                  <span key="cout" className="tabular-nums">
                    {D.isZero(ligne.componentItem.vwap) ? (
                      <span
                        style={{ color: "var(--danger)" }}
                        title="Aucun cout moyen reel (VWAP) n'est encore valorise pour cet article : la valorisation matiere de cette ligne n'est pas calculable."
                      >
                        Cout moyen non renseigne
                      </span>
                    ) : (
                      formatMontant(coutTheorique(ligne), devise)
                    )}
                  </span>,
                  <div key="actions">
                    {modifiable && peutEcrire ? (
                      <details>
                        <summary className="lien-nav cursor-pointer text-sm">
                          Modifier / retirer
                        </summary>
                        <div className="mt-3 flex flex-col gap-4" style={{ minWidth: "20rem" }}>
                          <FormulaireAction
                            action={actionModifierComposant}
                            libelleSoumettre="Enregistrer"
                            discret
                          >
                            <input type="hidden" name="ligneId" value={ligne.id} />
                            <div className="grid grid-cols-1 gap-3">
                              <Champ
                                nom="composantId"
                                libelle="Article composant"
                                type="select"
                                requis
                                valeur={ligne.componentItemId}
                                options={articles.map((article) => ({
                                  valeur: article.id,
                                  libelle: `${article.code} — ${article.label1}`,
                                }))}
                              />
                              <Champ
                                nom="quantite"
                                libelle="Quantite"
                                type="number"
                                pas="0.000001"
                                min="0"
                                requis
                                valeur={D.toFixed(ligne.quantity, 6)}
                              />
                              <Champ
                                nom="unite"
                                libelle="Unite"
                                type="select"
                                valeur={ligne.unitCode ?? ""}
                                options={unites.map((unite) => ({
                                  valeur: unite.code,
                                  libelle: `${unite.code} — ${unite.label}`,
                                }))}
                                aide="Laisser vide pour reprendre l'unite de l'article."
                              />
                              <Champ
                                nom="tauxPerte"
                                libelle="Taux de perte prevu (%)"
                                type="number"
                                pas="0.0001"
                                min="0"
                                valeur={D.toFixed(ligne.lossRate, 4)}
                              />
                              <Champ
                                nom="tauxRebut"
                                libelle="Taux de rebut (%)"
                                type="number"
                                pas="0.0001"
                                min="0"
                                valeur={D.toFixed(ligne.scrapRate, 4)}
                              />
                              <Champ
                                nom="operation"
                                libelle="Operation de consommation"
                                type="select"
                                valeur={ligne.operationCode ?? ""}
                                options={optionsOperations}
                              />
                              <Champ
                                nom="depotConsommation"
                                libelle="Depot de consommation"
                                type="select"
                                valeur={ligne.consumptionWarehouseId ?? ""}
                                options={depots.map((depot) => ({
                                  valeur: depot.id,
                                  libelle: `${depot.code} — ${depot.label}`,
                                }))}
                              />
                              <Champ
                                nom="lineNo"
                                libelle="Ordre d'affichage"
                                type="number"
                                min={1}
                                valeur={ligne.lineNo}
                              />
                              <Champ
                                nom="notes"
                                libelle="Notes"
                                type="textarea"
                                maxLength={500}
                                valeur={ligne.notes ?? ""}
                              />
                            </div>
                          </FormulaireAction>

                          <BoutonAction
                            action={actionRetirerComposant}
                            libelle="Retirer ce composant"
                            variante="danger"
                            champsCaches={{ ligneId: ligne.id }}
                            confirmation={`Retirer definitivement le composant ${ligne.componentItem.code} de ce brouillon ?`}
                          />
                        </div>
                      </details>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--texte-doux)" }}>
                        {modifiable
                          ? "Permission d'ecriture requise"
                          : "Version figee"}
                      </span>
                    )}
                  </div>,
                ],
              };
            })}
            messageVide="Aucun composant n'est encore rattache a cette version."
          />
        </Carte>

        {modifiable && (
          <div className="mt-5">
            <Carte
              titre="Ajouter un composant"
              description="Ajout possible uniquement tant que la version est en brouillon."
            >
              {peutEcrire ? (
                <FormulaireAction
                  action={actionAjouterComposant}
                  libelleSoumettre="Ajouter le composant"
                  reinitialiser
                >
                  <input type="hidden" name="formulaId" value={formule.id} />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Champ
                      nom="composantId"
                      libelle="Article composant"
                      type="select"
                      requis
                      options={articles.map((article) => ({
                        valeur: article.id,
                        libelle: `${article.code} — ${article.label1}`,
                      }))}
                    />
                    <Champ
                      nom="quantite"
                      libelle="Quantite"
                      type="number"
                      pas="0.000001"
                      min="0"
                      requis
                      aide="Quantite pour une unite de produit fini."
                    />
                    <Champ
                      nom="unite"
                      libelle="Unite"
                      type="select"
                      options={unites.map((unite) => ({
                        valeur: unite.code,
                        libelle: `${unite.code} — ${unite.label}`,
                      }))}
                      aide="Laisser vide pour reprendre l'unite de l'article."
                    />
                    <Champ
                      nom="tauxPerte"
                      libelle="Taux de perte prevu (%)"
                      type="number"
                      pas="0.0001"
                      min="0"
                      valeur={0}
                      aide="Majoration appliquee a la consommation planifiee."
                    />
                    <Champ
                      nom="tauxRebut"
                      libelle="Taux de rebut (%)"
                      type="number"
                      pas="0.0001"
                      min="0"
                      valeur={0}
                    />
                    <Champ
                      nom="operation"
                      libelle="Operation de consommation"
                      type="select"
                      options={optionsOperations}
                      aide="Operation d'atelier pendant laquelle le composant est consomme."
                    />
                    <Champ
                      nom="depotConsommation"
                      libelle="Depot de consommation"
                      type="select"
                      options={depots.map((depot) => ({
                        valeur: depot.id,
                        libelle: `${depot.code} — ${depot.label}`,
                      }))}
                      aide="Laisser vide pour reprendre le depot de la version."
                    />
                    <Champ
                      nom="lineNo"
                      libelle="Ordre d'affichage"
                      type="number"
                      min={1}
                      aide="Laisser vide pour ajouter en fin de liste."
                    />
                    <Champ nom="notes" libelle="Notes" type="textarea" maxLength={500} />
                  </div>
                </FormulaireAction>
              ) : (
                <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                  Permission « ecriture des nomenclatures » requise pour ajouter un
                  composant.
                </p>
              )}
            </Carte>
          </div>
        )}

        {!modifiable && (
          <div className="mt-5">
            <Alerte
              ton="info"
              titre={`Formulation figee — statut « ${libelle(LIBELLES_STATUT_NOMENCLATURE, formule.status)} »`}
            >
              Les composants de cette version ne sont plus modifiables, ni depuis cette
              page, ni par un appel direct au serveur. Toute evolution passe par une
              nouvelle version : l'historique de production reste ainsi verifiable.
            </Alerte>
          </div>
        )}
      </Section>
    </>
  );
}
