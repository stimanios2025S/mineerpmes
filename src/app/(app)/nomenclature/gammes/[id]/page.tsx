import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import {
  actionActiverGamme,
  actionAjouterEtape,
  actionDeplacerEtape,
  actionModifierEtape,
  actionSupprimerEtape,
} from "@/actions/nomenclature";
import {
  aLaPermission,
  exigerPermission,
  peutAccederUsine,
} from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { identifiantOuNull } from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  ListeDefinitions,
  Section,
  Tableau,
  Vide,
} from "@/components/ui";
import { BoutonAction, Champ, FormulaireAction } from "@/components/interactif";
import {
  formatDateTime,
  formatDuree,
  formatEntier,
  formatQuantite,
} from "@/lib/format";
import {
  LIBELLES_STATUT_GAMME,
  LIBELLES_STATUT_ORDRE,
  LIBELLES_USINE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Fiche gamme" };

export default async function PageGamme({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.GAMME_LIRE);

  const { id: identifiantBrut } = await params;
  const identifiant = identifiantOuNull(identifiantBrut);
  if (!identifiant) notFound();

  const gamme = await prisma.productRoute.findUnique({
    where: { id: identifiant },
    include: {
      item: {
        select: { id: true, code: true, label1: true, designation: true, factory: true },
      },
      workshop: { select: { code: true, label: true } },
      steps: {
        orderBy: { stepNo: "asc" },
        include: {
          operation: {
            select: {
              id: true,
              code: true,
              label: true,
              workshop: { select: { code: true, label: true } },
            },
          },
          workCenter: {
            select: {
              id: true,
              code: true,
              label: true,
              workshop: { select: { code: true, label: true } },
            },
          },
        },
      },
    },
  });

  if (!gamme) notFound();
  if (!peutAccederUsine(utilisateur, gamme.item.factory)) notFound();

  // La relation « valideur » n'est pas declaree sur ProductRoute : le compte est
  // resolu explicitement a partir de l'identifiant enregistre a l'activation.
  const valideur = gamme.approvedById
    ? await prisma.user.findUnique({
        where: { id: gamme.approvedById },
        select: { email: true },
      })
    : null;

  const [operations, postes, ordres] = await Promise.all([
    prisma.operation.findMany({
      where: { isActive: true },
      orderBy: [{ boardOrder: "asc" }, { code: "asc" }],
      take: 500,
      select: {
        id: true,
        code: true,
        label: true,
        factory: true,
        requiresQualityCheck: true,
      },
    }),
    prisma.workCenter.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      take: 500,
      select: {
        id: true,
        code: true,
        label: true,
        operationId: true,
        workshop: { select: { code: true, label: true } },
      },
    }),
    prisma.workOrder.findMany({
      where: { routeId: gamme.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, number: true, status: true, quantityPlanned: true },
    }),
  ]);

  const brouillon = gamme.status === "BROUILLON";
  const peutGerer = aLaPermission(utilisateur, PERMISSIONS.GAMME_GERER);

  const optionsOperations = operations.map((operation) => ({
    valeur: operation.id,
    libelle: `${operation.code} — ${operation.label} (${operation.factory})`,
  }));

  const optionsPostes = postes.map((poste) => ({
    valeur: poste.id,
    libelle:
      `${poste.code} — ${poste.label}` +
      (poste.workshop ? ` · ${poste.workshop.label}` : ""),
  }));

  return (
    <>
      <EnTetePage
        titre={`${gamme.item.code} — ${gamme.label}`}
        description={`Gamme ${gamme.code} version ${gamme.version} · ${libelle(LIBELLES_USINE, gamme.factory)}`}
        actions={
          <>
            <Link className="lien-nav text-sm" href="/nomenclature/gammes">
              Retour aux gammes
            </Link>
            <Link className="lien-nav text-sm" href={`/referentiel/articles/${gamme.item.id}`}>
              Fiche article
            </Link>
          </>
        }
      />

      <div className="mb-5">
        <Alerte ton="info" titre="La gamme est configurable produit par produit">
          Deux produits differents n'ont pas le meme enchainement d'operations : les
          produits CANADA et G21, par exemple, suivent des gammes distinctes. Une gamme
          est donc toujours rattachee a un produit precis et ne se partage pas
          implicitement entre articles.
        </Alerte>
      </div>

      <Carte titre="En-tete de la gamme">
        <ListeDefinitions
          elements={[
            {
              terme: "Produit",
              valeur: (
                <Link className="lien-nav" href={`/referentiel/articles/${gamme.item.id}`}>
                  {gamme.item.code} — {gamme.item.label1}
                </Link>
              ),
            },
            {
              terme: "Statut",
              valeur: (
                <EtiquetteStatut
                  libelle={libelle(LIBELLES_STATUT_GAMME, gamme.status)}
                  code={gamme.status}
                />
              ),
            },
            { terme: "Code", valeur: gamme.code },
            {
              terme: "Version",
              valeur: <span className="tabular-nums">v{gamme.version}</span>,
            },
            { terme: "Division", valeur: libelle(LIBELLES_USINE, gamme.factory) },
            {
              terme: "Atelier",
              valeur: gamme.workshop
                ? `${gamme.workshop.code} — ${gamme.workshop.label}`
                : "Non renseigne",
            },
            {
              terme: "Gamme par defaut",
              valeur: gamme.isDefault ? (
                <Etiquette ton="primaire">Gamme par defaut du produit</Etiquette>
              ) : (
                "Non"
              ),
            },
            { terme: "Etapes", valeur: `${formatEntier(gamme.steps.length)} etape(s)` },
            {
              terme: "Valideur",
              valeur: valideur ? (
                <>
                  {valideur.email}
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    le {formatDateTime(gamme.approvedAt)}
                  </span>
                </>
              ) : (
                "Aucune activation enregistree"
              ),
            },
            { terme: "Notes", valeur: gamme.notes ?? "Aucune note" },
          ]}
        />
      </Carte>

      <Section titre="Etapes ordonnees">
        <Carte
          titre={`${formatEntier(gamme.steps.length)} etape(s) d'operation`}
          description="Les etapes sont numerotees dans l'ordre d'execution. Le reordonnancement renumerote la gamme de 1 a n."
          sansPadding
        >
          <div className="px-4 pt-4">
            <Alerte
              ton="alerte"
              titre="Deux informations demandees ne sont pas portees par le schema de production"
            >
              La « quantite minimale de lancement » et le caractere « obligatoire » d'une
              etape ne disposent d'aucun champ dans le schema de donnees actuellement
              deploye. Aucune valeur n'est inventee, deduite d'un autre champ ou saisie
              puis ignoree : les colonnes correspondantes affichent explicitement
              l'absence de donnee. Les informations reellement porteuses sont le temps
              prevu, le temps de reglage, le point de controle qualite et le caractere
              final de l'etape.
            </Alerte>
          </div>
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "N°", nombre: true },
              { cle: "operation", libelle: "Operation" },
              { cle: "poste", libelle: "Poste de travail" },
              { cle: "atelier", libelle: "Atelier" },
              { cle: "temps", libelle: "Temps prevu" },
              { cle: "reglage", libelle: "Temps de reglage" },
              { cle: "qteMini", libelle: "Quantite minimale de lancement" },
              { cle: "obligatoire", libelle: "Obligatoire" },
              { cle: "qualite", libelle: "Point de controle qualite" },
              { cle: "actions", libelle: "Actions" },
            ]}
            lignes={gamme.steps.map((etape) => ({
              cle: String(etape.id),
              cellules: [
                <span key="n" className="tabular-nums">
                  {etape.stepNo}
                </span>,
                <div key="op">
                  <span className="block">
                    {etape.operation.code} — {etape.operation.label}
                  </span>
                  {etape.isFinalStep && (
                    <Etiquette ton="info" titre="Derniere etape de la gamme">
                      Etape finale
                    </Etiquette>
                  )}
                  {etape.description && (
                    <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                      {etape.description}
                    </span>
                  )}
                </div>,
                <span key="poste">
                  {etape.workCenter
                    ? `${etape.workCenter.code} — ${etape.workCenter.label}`
                    : "Non affecte"}
                </span>,
                <span key="atelier">
                  {etape.workCenter?.workshop?.label ??
                    etape.operation.workshop?.label ??
                    gamme.workshop?.label ??
                    "Non renseigne"}
                </span>,
                <span key="temps" className="tabular-nums">
                  {formatDuree(etape.standardTimeMinutes)}
                </span>,
                <span key="reglage" className="tabular-nums">
                  {formatDuree(etape.setupTimeMinutes)}
                </span>,
                <span
                  key="qteMini"
                  title="Aucun champ « quantite minimale de lancement » n'existe dans le schema deploye."
                >
                  Non disponible
                </span>,
                <span
                  key="obligatoire"
                  title="Aucun champ « etape obligatoire » n'existe dans le schema deploye."
                >
                  Non disponible
                </span>,
                <span key="qualite">
                  {etape.isQualityGate ? (
                    <Etiquette ton="succes">Controle qualite requis</Etiquette>
                  ) : (
                    "Aucun controle"
                  )}
                </span>,
                <div key="actions">
                  {brouillon && peutGerer ? (
                    <details>
                      <summary className="lien-nav cursor-pointer text-sm">
                        Modifier / deplacer / supprimer
                      </summary>
                      <div className="mt-3 flex flex-col gap-4" style={{ minWidth: "20rem" }}>
                        <FormulaireAction
                          action={actionModifierEtape}
                          libelleSoumettre="Enregistrer"
                          discret
                        >
                          <input type="hidden" name="etapeId" value={etape.id} />
                          <div className="grid grid-cols-1 gap-3">
                            <Champ
                              nom="operationId"
                              libelle="Operation"
                              type="select"
                              requis
                              valeur={etape.operationId}
                              options={optionsOperations}
                            />
                            <Champ
                              nom="workCenterId"
                              libelle="Poste de travail"
                              type="select"
                              valeur={etape.workCenterId ?? ""}
                              options={optionsPostes}
                              aide="Le poste doit dependre de l'operation choisie."
                            />
                            <Champ
                              nom="tempsPrevu"
                              libelle="Temps prevu (minutes)"
                              type="number"
                              pas="0.0001"
                              min="0"
                              valeur={D.toFixed(etape.standardTimeMinutes, 4)}
                            />
                            <Champ
                              nom="tempsReglage"
                              libelle="Temps de reglage (minutes)"
                              type="number"
                              pas="0.0001"
                              min="0"
                              valeur={D.toFixed(etape.setupTimeMinutes, 4)}
                            />
                            <Champ
                              nom="description"
                              libelle="Description"
                              type="textarea"
                              maxLength={1000}
                              valeur={etape.description ?? ""}
                            />
                            <Champ
                              nom="instructions"
                              libelle="Consignes d'execution"
                              type="textarea"
                              maxLength={2000}
                              valeur={etape.instructions ?? ""}
                            />
                          </div>
                          <div className="mt-3 flex flex-col gap-2">
                            <label className="flex items-start gap-2 text-sm">
                              <input
                                type="checkbox"
                                name="controleQualite"
                                defaultChecked={etape.isQualityGate}
                                className="mt-1"
                              />
                              <span className="font-medium">
                                Point de controle qualite
                              </span>
                            </label>
                            <label className="flex items-start gap-2 text-sm">
                              <input
                                type="checkbox"
                                name="etapeFinale"
                                defaultChecked={etape.isFinalStep}
                                className="mt-1"
                              />
                              <span className="font-medium">Etape finale</span>
                            </label>
                            <label className="flex items-start gap-2 text-sm">
                              <input
                                type="checkbox"
                                name="consommeSemiFini"
                                defaultChecked={etape.consumesSemiFinished}
                                className="mt-1"
                              />
                              <span className="font-medium">Consomme un semi-fini</span>
                            </label>
                            <label className="flex items-start gap-2 text-sm">
                              <input
                                type="checkbox"
                                name="produitSemiFini"
                                defaultChecked={etape.producesSemiFinished}
                                className="mt-1"
                              />
                              <span className="font-medium">Produit un semi-fini</span>
                            </label>
                          </div>
                        </FormulaireAction>

                        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                          <BoutonAction
                            action={actionDeplacerEtape}
                            libelle="Monter"
                            champsCaches={{ etapeId: etape.id, sens: "HAUT" }}
                            titre="Remonter cette etape d'un rang"
                          />
                          <BoutonAction
                            action={actionDeplacerEtape}
                            libelle="Descendre"
                            champsCaches={{ etapeId: etape.id, sens: "BAS" }}
                            titre="Descendre cette etape d'un rang"
                          />
                          <BoutonAction
                            action={actionSupprimerEtape}
                            libelle="Supprimer l'etape"
                            variante="danger"
                            champsCaches={{ etapeId: etape.id }}
                            confirmation={`Supprimer l'etape ${etape.stepNo} (${etape.operation.label}) ? Les etapes suivantes seront renumerotees.`}
                          />
                        </div>
                      </div>
                    </details>
                  ) : (
                    <span className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      {brouillon ? "Permission de gestion requise" : "Gamme figee"}
                    </span>
                  )}
                </div>,
              ],
            }))}
            messageVide="Cette gamme ne comporte encore aucune etape."
          />
        </Carte>

        {brouillon && (
          <div className="mt-5">
            <Carte
              titre="Ajouter une etape"
              description="Ajout possible uniquement tant que la gamme est en brouillon."
            >
              {peutGerer ? (
                <FormulaireAction
                  action={actionAjouterEtape}
                  libelleSoumettre="Ajouter l'etape"
                  reinitialiser
                >
                  <input type="hidden" name="routeId" value={gamme.id} />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Champ
                      nom="operationId"
                      libelle="Operation"
                      type="select"
                      requis
                      options={optionsOperations}
                    />
                    <Champ
                      nom="workCenterId"
                      libelle="Poste de travail"
                      type="select"
                      options={optionsPostes}
                      aide="Le poste doit dependre de l'operation choisie."
                    />
                    <Champ
                      nom="stepNo"
                      libelle="Numero d'etape"
                      type="number"
                      min={1}
                      aide="Laisser vide pour ajouter en fin d'enchainement."
                    />
                    <Champ
                      nom="tempsPrevu"
                      libelle="Temps prevu (minutes)"
                      type="number"
                      pas="0.0001"
                      min="0"
                      valeur={0}
                    />
                    <Champ
                      nom="tempsReglage"
                      libelle="Temps de reglage (minutes)"
                      type="number"
                      pas="0.0001"
                      min="0"
                      valeur={0}
                    />
                    <Champ
                      nom="description"
                      libelle="Description"
                      type="textarea"
                      maxLength={1000}
                    />
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="controleQualite" className="mt-1" />
                      <span className="font-medium">Point de controle qualite</span>
                    </label>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="etapeFinale" className="mt-1" />
                      <span className="font-medium">Etape finale</span>
                    </label>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="consommeSemiFini" className="mt-1" />
                      <span className="font-medium">Consomme un semi-fini</span>
                    </label>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="produitSemiFini" className="mt-1" />
                      <span className="font-medium">Produit un semi-fini</span>
                    </label>
                  </div>
                </FormulaireAction>
              ) : (
                <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                  La permission « gestion des gammes de fabrication » est requise pour
                  ajouter une etape.
                </p>
              )}
            </Carte>
          </div>
        )}
      </Section>

      <Section titre="Cycle de vie">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Carte titre="Activation de la gamme">
            {brouillon ? (
              peutGerer ? (
                <FormulaireAction
                  action={actionActiverGamme}
                  libelleSoumettre="Activer la gamme"
                >
                  <input type="hidden" name="routeId" value={gamme.id} />
                  <div className="mb-3">
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="parDefaut"
                        defaultChecked={gamme.isDefault}
                        className="mt-1"
                      />
                      <span>
                        <span className="block font-medium">
                          Definir comme gamme par defaut du produit
                        </span>
                        <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                          Les autres gammes du meme produit cesseront d'etre la gamme par
                          defaut.
                        </span>
                      </span>
                    </label>
                  </div>
                  <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                    L'activation archive les autres gammes actives du produit. Les ordres
                    de fabrication en cours gardent la gamme qui leur a ete affectee.
                  </p>
                </FormulaireAction>
              ) : (
                <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                  La permission « gestion des gammes de fabrication » est requise.
                </p>
              )
            ) : (
              <Alerte
                ton="info"
                titre={`Gamme au statut « ${libelle(LIBELLES_STATUT_GAMME, gamme.status)} »`}
              >
                Une gamme activee n'est plus modifiable. Ses etapes restent consultables et
                les ordres de fabrication qui l'utilisent conservent leur enchainement.
              </Alerte>
            )}
          </Carte>

          <Carte
            titre="Ordres de fabrication rattaches"
            description="Ces ordres ont ete lances avec cette gamme."
          >
            {ordres.length === 0 ? (
              <Vide
                titre="Aucun ordre de fabrication"
                message="Aucun ordre de fabrication n'utilise cette gamme."
              />
            ) : (
              <Tableau
                colonnes={[
                  { cle: "numero", libelle: "Ordre" },
                  { cle: "statut", libelle: "Statut" },
                  { cle: "quantite", libelle: "Quantite planifiee", nombre: true },
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
                  ],
                }))}
              />
            )}
          </Carte>
        </div>
      </Section>
    </>
  );
}
