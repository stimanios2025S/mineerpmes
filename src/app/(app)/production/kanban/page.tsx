import Link from "next/link";
import type { Factory } from "@prisma/client";
import { prisma } from "@/lib/db";
import { aLaPermission, exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { identifiantOuNull, premiereValeur } from "@/lib/liste";
import { cartesKanban, type CarteKanban } from "@/lib/production/service";
import { actionDeplacerCarteKanban } from "@/actions/production";
import { Alerte, Carte, EnTetePage, Etiquette, EtiquetteStatut } from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatDate, formatQuantite } from "@/lib/format";
import {
  LIBELLES_CATEGORIE_PERTE,
  LIBELLES_DECISION_QUALITE,
  LIBELLES_MOTIF_PERTE,
  LIBELLES_PRIORITE,
  LIBELLES_STATUT_OPERATION,
  LIBELLES_USINE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Kanban atelier" };

/**
 * Tableau Kanban de l'atelier.
 *
 * Les colonnes sont les operations reellement enregistrees en base
 * (`Operation.isKanbanVisible`, `boardOrder`, `factory`) : aucune colonne n'est
 * codee en dur. Les cartes proviennent de `cartesKanban` ; le deplacement d'une
 * carte est une operation metier controlee qui passe par le moteur de
 * production, jamais par une ecriture directe.
 */

const CODE_SORTIE_GAMME = "FIN_GAMME";

/** Seules les divisions de fabrication portent un atelier et un Kanban. */
type DivisionKanban = "ADMEDCO" | "MOBILIX";

function estDivisionKanban(usine: Factory): usine is DivisionKanban {
  return usine === "ADMEDCO" || usine === "MOBILIX";
}

export default async function PageKanban({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.PRODUCTION_LIRE);
  const parametres = await searchParams;

  const divisionsAccessibles = usinesAutorisees(utilisateur).filter(estDivisionKanban);

  const divisionDemandee = premiereValeur(parametres, "division");
  const division: DivisionKanban | null =
    divisionsAccessibles.find((usine) => usine === divisionDemandee) ??
    divisionsAccessibles[0] ??
    null;

  if (!division) {
    return (
      <>
        <EnTetePage titre="Kanban atelier" />
        <Alerte ton="danger" titre="Aucune division accessible">
          Votre profil ne donne acces a aucune division de fabrication : le tableau Kanban ne
          peut rien afficher.
        </Alerte>
      </>
    );
  }

  const atelierId = identifiantOuNull(premiereValeur(parametres, "atelier"));

  // Colonnes = operations reelles de la base, jamais une liste codee en dur.
  const [colonnes, ateliers, cartes, employes] = await Promise.all([
    prisma.operation.findMany({
      where: {
        isActive: true,
        isKanbanVisible: true,
        factory: division,
        ...(atelierId ? { workshopId: atelierId } : {}),
      },
      orderBy: [{ boardOrder: "asc" }, { code: "asc" }],
      include: { workshop: { select: { code: true, label: true } } },
    }),
    prisma.workshop.findMany({
      where: { isActive: true, factory: { in: [division, "COMMUN"] } },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, label: true },
    }),
    cartesKanban(division),
    prisma.employee.findMany({
      where: { isActive: true, factory: { in: [division, "COMMUN"] } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 500,
      select: { id: true, firstName: true, lastName: true, matricule: true },
    }),
  ]);

  const identifiantsOperations = cartes.map((carte) => carte.workOrderOperationId);

  // Rattachement de chaque carte a sa colonne, et donnees du formulaire de
  // deplacement (etape suivante de la gamme, composants, depot).
  const informations =
    identifiantsOperations.length === 0
      ? []
      : await prisma.workOrderOperation.findMany({
          where: { id: { in: identifiantsOperations } },
          select: {
            id: true,
            stepNo: true,
            operationId: true,
            workOrderId: true,
            workOrder: {
              select: {
                itemId: true,
                sourceWarehouseId: true,
                sourceWarehouse: { select: { code: true } },
              },
            },
            materials: {
              orderBy: { lineNo: "asc" },
              select: {
                id: true,
                quantityPlanned: true,
                quantityConsumed: true,
                unitCode: true,
                componentItem: { select: { code: true, label1: true } },
              },
            },
          },
        });

  const identifiantsOrdres = Array.from(
    new Set(informations.map((information) => information.workOrderId)),
  );

  const etapesOrdres =
    identifiantsOrdres.length === 0
      ? []
      : await prisma.workOrderOperation.findMany({
          where: { workOrderId: { in: identifiantsOrdres } },
          orderBy: [{ workOrderId: "asc" }, { stepNo: "asc" }],
          select: {
            workOrderId: true,
            stepNo: true,
            operation: { select: { code: true, label: true } },
          },
        });

  const etapesParOrdre = new Map<
    number,
    { stepNo: number; code: string; label: string }[]
  >();
  for (const etape of etapesOrdres) {
    const liste = etapesParOrdre.get(etape.workOrderId) ?? [];
    liste.push({
      stepNo: etape.stepNo,
      code: etape.operation.code,
      label: etape.operation.label,
    });
    etapesParOrdre.set(etape.workOrderId, liste);
  }

  const informationParCarte = new Map(
    informations.map((information) => [information.id, information]),
  );

  const identifiantsColonnes = new Set(colonnes.map((colonne) => colonne.id));

  const cartesParColonne = new Map<number, CarteKanban[]>();
  let cartesMasquees = 0;
  for (const carte of cartes) {
    const information = informationParCarte.get(carte.workOrderOperationId);
    if (!information || !identifiantsColonnes.has(information.operationId)) {
      cartesMasquees += 1;
      continue;
    }
    const liste = cartesParColonne.get(information.operationId) ?? [];
    liste.push(carte);
    cartesParColonne.set(information.operationId, liste);
  }

  const peutDeplacer = aLaPermission(utilisateur, PERMISSIONS.PRODUCTION_KANBAN_DEPLACER);
  const peutControler = aLaPermission(utilisateur, PERMISSIONS.QUALITE_CONTROLER);

  const optionsEmployes = employes.map((employe) => ({
    valeur: employe.id,
    libelle: `${employe.lastName} ${employe.firstName} (${employe.matricule})`,
  }));
  const optionsCategoriesPerte = Object.entries(LIBELLES_CATEGORIE_PERTE).map(
    ([valeur, texte]) => ({ valeur, libelle: texte }),
  );
  const optionsMotifsPerte = Object.entries(LIBELLES_MOTIF_PERTE).map(([valeur, texte]) => ({
    valeur,
    libelle: texte,
  }));

  const totalCartes = cartes.length - cartesMasquees;

  return (
    <>
      <EnTetePage
        titre="Kanban atelier"
        description={`Division ${libelle(LIBELLES_USINE, division)}. Les colonnes sont les operations declarees au Kanban dans la base ; les cartes proviennent des ordres en cours.`}
        actions={
          <Link className="lien-nav text-sm" href="/production">
            Ordres de fabrication
          </Link>
        }
      />

      <Carte titre="Filtres">
        <form method="get" className="grid gap-3 sm:grid-cols-3">
          <Champ
            nom="division"
            libelle="Division"
            type="select"
            valeur={division}
            options={divisionsAccessibles.map((usine) => ({
              valeur: usine,
              libelle: libelle(LIBELLES_USINE, usine),
            }))}
          />
          <Champ
            nom="atelier"
            libelle="Atelier"
            type="select"
            valeur={atelierId ?? ""}
            options={ateliers.map((atelier) => ({
              valeur: atelier.id,
              libelle: `${atelier.code} — ${atelier.label}`,
            }))}
            aide="Les ateliers listes sont ceux enregistres en base pour cette division."
          />
          <div className="flex items-end">
            <button
              type="submit"
              className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
            >
              Filtrer
            </button>
          </div>
        </form>
      </Carte>

      {cartesMasquees > 0 && (
        <div className="mt-4">
          <Alerte ton="alerte" titre={`${cartesMasquees} carte(s) non affichee(s)`}>
            Ces cartes portent sur des operations qui ne sont pas presentees au Kanban de cette
            division : operation masquee (`isKanbanVisible`) ou exclue par le filtre d'atelier.
          </Alerte>
        </div>
      )}

      {totalCartes === 0 && (
        <div className="mt-4">
          <Alerte ton="info" titre="Aucune carte en atelier">
            Aucun ordre de fabrication actif ne porte d'operation visible sur le Kanban de cette
            division.
          </Alerte>
        </div>
      )}

      <div className="mt-5 overflow-x-auto">
        <div className="flex min-w-max items-start gap-4 pb-2">
          {colonnes.map((colonne) => {
            const cartesColonne = cartesParColonne.get(colonne.id) ?? [];
            return (
              <section key={colonne.id} className="w-80 shrink-0">
                <header
                  className="rounded-t-lg border border-b-0 px-3 py-2"
                  style={{ background: "var(--surface-douce)", borderColor: "var(--bordure)" }}
                >
                  <p className="text-sm font-semibold">
                    {colonne.code} — {colonne.label}
                  </p>
                  <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                    {colonne.workshop
                      ? `${colonne.workshop.code} — ${colonne.workshop.label}`
                      : "Atelier non affecte"}{" "}
                    · {cartesColonne.length} carte{cartesColonne.length > 1 ? "s" : ""}
                  </p>
                </header>
                <div
                  className="space-y-3 rounded-b-lg border p-3"
                  style={{ borderColor: "var(--bordure)" }}
                >
                  {cartesColonne.length === 0 ? (
                    <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      Aucune carte a cette etape.
                    </p>
                  ) : (
                    cartesColonne.map((carte) => {
                      const information = informationParCarte.get(
                        carte.workOrderOperationId,
                      );
                      const etapes =
                        information === undefined
                          ? []
                          : (etapesParOrdre.get(information.workOrderId) ?? []);
                      const suivante =
                        information === undefined
                          ? undefined
                          : etapes.find((etape) => etape.stepNo > information.stepNo);
                      const destination = suivante
                        ? { valeur: suivante.code, libelle: suivante.label }
                        : {
                            valeur: CODE_SORTIE_GAMME,
                            libelle: "Derniere etape : sortie de gamme",
                          };
                      const matieres = information?.materials ?? [];
                      const depotSource =
                        information?.workOrder.sourceWarehouse?.code ?? null;
                      const depotSourceId =
                        information?.workOrder.sourceWarehouseId ?? null;

                      return (
                        <article
                          key={carte.workOrderOperationId}
                          className="carte p-3"
                          style={
                            carte.enRetard
                              ? { borderColor: "var(--danger)" }
                              : undefined
                          }
                        >
                          <div className="flex items-start justify-between gap-2">
                            <Link
                              className="lien-nav text-sm font-semibold"
                              href={`/production/${carte.workOrderId}`}
                            >
                              {carte.numeroOrdre}
                            </Link>
                            <EtiquetteStatut
                              libelle={libelle(LIBELLES_PRIORITE, carte.priorite)}
                              code={carte.priorite}
                            />
                          </div>

                          <p className="mt-1 text-sm">
                            {carte.articleCode} — {carte.articleLabel}
                          </p>
                          {carte.clientLabel && (
                            <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                              Client : {carte.clientLabel}
                            </p>
                          )}

                          <p className="mt-1 text-sm tabular-nums">
                            {formatQuantite(carte.quantiteConforme)} conforme(s) /{" "}
                            {formatQuantite(carte.quantitePlanifiee)} planifiee(s) —{" "}
                            {formatQuantite(carte.quantiteProduite)} produite(s)
                          </p>

                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {carte.enRetard && (
                              <Etiquette ton="danger" titre="Echeance depassee">
                                En retard — {formatDate(carte.datePrevue)}
                              </Etiquette>
                            )}
                            {carte.alertesMatiere > 0 && (
                              <Etiquette ton="alerte" titre="Composants non consommes">
                                {carte.alertesMatiere} matiere(s) non consommee(s)
                              </Etiquette>
                            )}
                            <Etiquette ton="neutre">
                              {libelle(LIBELLES_STATUT_OPERATION, carte.statut)}
                            </Etiquette>
                          </div>

                          <p className="mt-1 text-xs" style={{ color: "var(--texte-doux)" }}>
                            {carte.operateur ? `Operateur : ${carte.operateur}` : "Operateur non affecte"}
                            {carte.equipe ? ` · Equipe : ${carte.equipe}` : ""}
                            {carte.depot ? ` · Depot : ${carte.depot}` : ""}
                          </p>

                          {!peutDeplacer ? (
                            <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                              Deplacement reserve aux profils autorises.
                            </p>
                          ) : (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-sm font-semibold">
                                Deplacer la carte
                              </summary>
                              <FormulaireAction
                                action={actionDeplacerCarteKanban}
                                libelleSoumettre="Deplacer"
                                discret
                                reinitialiser
                              >
                                <Champ
                                  nom="workOrderOperationId"
                                  type="hidden"
                                  libelle=""
                                  valeur={carte.workOrderOperationId}
                                />
                                <Champ
                                  nom="etapeDestination"
                                  libelle="Etape de destination"
                                  type="select"
                                  requis
                                  valeur={destination.valeur}
                                  options={[destination]}
                                  aide="Le Kanban circule dans l'ordre de la gamme : seule l'etape suivante est proposee."
                                />
                                <Champ
                                  nom="quantite"
                                  libelle="Quantite deplacee"
                                  type="number"
                                  pas="0.001"
                                  min="0"
                                  aide={`Laisser vide pour reprendre la quantite conforme declaree (${formatQuantite(
                                    carte.quantiteConforme,
                                  )}).`}
                                />
                                <Champ
                                  nom="employeeId"
                                  libelle="Operateur"
                                  type="select"
                                  options={optionsEmployes}
                                />
                                <Champ nom="commentaire" libelle="Commentaire" />

                                <details className="mt-2">
                                  <summary className="cursor-pointer text-xs font-semibold">
                                    Consommation, perte et controle qualite
                                  </summary>

                                  {matieres.length > 0 && (
                                    <>
                                      <Champ
                                        nom="materialId"
                                        libelle="Composant consomme"
                                        type="select"
                                        options={matieres.map((matiere) => ({
                                          valeur: matiere.id,
                                          libelle: `${matiere.componentItem.code} — ${matiere.componentItem.label1} (reste ${formatQuantite(
                                            matiere.quantityPlanned.minus(
                                              matiere.quantityConsumed,
                                            ),
                                          )}${matiere.unitCode ? ` ${matiere.unitCode}` : ""})`,
                                        }))}
                                      />
                                      <Champ
                                        nom="consommationQuantite"
                                        libelle="Quantite consommee"
                                        type="number"
                                        pas="0.001"
                                        min="0"
                                      />
                                    </>
                                  )}

                                  <Champ
                                    nom="perteQuantite"
                                    libelle="Quantite perdue"
                                    type="number"
                                    pas="0.001"
                                    min="0"
                                  />
                                  <Champ
                                    nom="perteCategorie"
                                    libelle="Categorie de la perte"
                                    type="select"
                                    options={optionsCategoriesPerte}
                                    aide="Obligatoire des qu'une quantite perdue est saisie."
                                  />
                                  <Champ
                                    nom="perteMotif"
                                    libelle="Motif de la perte"
                                    type="select"
                                    options={optionsMotifsPerte}
                                  />
                                  <Champ
                                    nom="perteCommentaire"
                                    libelle="Commentaire de la perte"
                                  />
                                  {depotSourceId ? (
                                    <Champ
                                      nom="perteWarehouseId"
                                      type="hidden"
                                      libelle=""
                                      valeur={depotSourceId}
                                    />
                                  ) : null}
                                  <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                                    Depot mouvemente par la perte :{" "}
                                    {depotSource ?? "aucun depot source defini sur cet ordre"}.
                                  </p>

                                  {peutControler ? (
                                    <>
                                      <Champ
                                        nom="decisionQualite"
                                        libelle="Resultat du controle qualite"
                                        type="select"
                                        options={Object.entries(LIBELLES_DECISION_QUALITE).map(
                                          ([valeur, texte]) => ({ valeur, libelle: texte }),
                                        )}
                                        aide="Un controle est enregistre uniquement si une decision est choisie."
                                      />
                                      <Champ
                                        nom="quantiteControlee"
                                        libelle="Quantite controlee"
                                        type="number"
                                        pas="0.001"
                                        min="0"
                                      />
                                      <Champ
                                        nom="quantiteConforme"
                                        libelle="Dont conforme"
                                        type="number"
                                        pas="0.001"
                                        min="0"
                                      />
                                      <Champ
                                        nom="quantiteRejetee"
                                        libelle="Dont rejetee"
                                        type="number"
                                        pas="0.001"
                                        min="0"
                                      />
                                    </>
                                  ) : (
                                    <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                                      Le controle qualite n'est pas propose a votre profil
                                      (permission de controle absente).
                                    </p>
                                  )}
                                </details>

                                <label className="mt-2 flex items-center gap-2 text-xs">
                                  <input type="checkbox" name="forcer" />
                                  <span>
                                    Deplacer malgre une production incomplete (arbitrage
                                    responsable ; la raison doit etre indiquee en commentaire).
                                  </span>
                                </label>
                              </FormulaireAction>
                            </details>
                          )}
                        </article>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
