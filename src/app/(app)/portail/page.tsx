import Link from "next/link";
import { prisma } from "@/lib/db";
import { aLaPermission, exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  actionPortailCloturerOrdre,
  actionPortailDeclarerConsommation,
  actionPortailDeclarerPerte,
  actionPortailDeclarerProduction,
  actionPortailDemarrerOperation,
  actionPortailMettreEnPause,
  actionPortailReprendreOperation,
  actionPortailSignalerProbleme,
  actionPortailTerminerOperation,
} from "@/actions/rh";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Statistique,
  Tableau,
  Vide,
} from "@/components/ui";
import { BoutonAction, Champ, FormulaireAction } from "@/components/interactif";
import { ProgrammeTaches } from "@/components/taches-programme";
import { ScannerQR } from "@/components/scanner-qr";
import { programmeEmploye } from "@/lib/mes/postes";
import { positionSousStock, sousStockDeSortie } from "@/lib/mes/sous-stocks";
import { bornesJour, jourCivilMetier, jourMetier } from "@/lib/mes/jour";
import { D } from "@/lib/decimal";
import {
  formatDate,
  formatDateTime,
  formatHeure,
  formatQuantite,
} from "@/lib/format";
import {
  LIBELLES_CATEGORIE_PERTE,
  LIBELLES_FIABILITE,
  LIBELLES_MOTIF_PERTE,
  LIBELLES_PERIODE_EVALUATION,
  LIBELLES_PRESENCE,
  LIBELLES_STATUT_AFFECTATION,
  LIBELLES_STATUT_OPERATION,
  LIBELLES_TYPE_DECLARATION,
  LIBELLES_USINE,
  libelle,
  type TonEtiquette,
} from "@/lib/libelles";

export const metadata = { title: "Portail employe" };

/**
 * Portail employe — utilise au poste, dans l'atelier.
 *
 * Trois principes tenus par cette page :
 *
 *  1. Cloisonnement : toutes les requetes sont bornees sur
 *     `utilisateur.employeeId`. Aucun identifiant d'employe n'est lu dans un
 *     formulaire, et les actions serveur refusent toute operation qui n'est pas
 *     reellement affectee a l'employe connecte.
 *  2. Aucune donnee salariale : les colonnes de remuneration ne sont meme pas
 *     selectionnees, quelle que soit la permission du compte.
 *  3. Aucune modification libre du stock : la declaration de perte est
 *     enregistree sans sortie de stock, et aucune nomenclature, aucun cout ni
 *     aucune donnee d'un autre atelier n'est accessible ici.
 *
 * Un compte par employe : le portail n'affiche jamais les donnees d'un autre.
 */

/**
 * Bornes du mois en dates civiles du fuseau metier.
 *
 * `Attendance.date` est une colonne `@db.Date` : on lui donne des dates, pas
 * des instants, et la borne de fin est exclue pour ne dependre d'aucun fuseau
 * de session PostgreSQL.
 */
function bornesMois(jourTexte: string): { debut: Date; fin: Date } {
  const [annee, mois] = jourTexte.split("-").map(Number);
  return {
    debut: new Date(Date.UTC(annee, mois - 1, 1)),
    fin: new Date(Date.UTC(annee, mois, 1)),
  };
}

/** Duree reelle d'une intervention, pauses deduites, en heures et minutes. */
function dureeReelle(
  debut: Date | null,
  fin: Date | null,
  pauseMs: bigint,
): string | null {
  if (!debut) return null;
  const borneFin = fin ?? new Date();
  const totalMs = borneFin.getTime() - debut.getTime() - Number(pauseMs);
  if (totalMs <= 0) return "0 min";
  const minutes = Math.floor(totalMs / 60000);
  const heures = Math.floor(minutes / 60);
  return `${heures} h ${String(minutes % 60).padStart(2, "0")}`;
}

export default async function PagePortail() {
  const utilisateur = await exigerPermission(PERMISSIONS.PORTAIL_EMPLOYE);

  if (!utilisateur.employeeId) {
    return (
      <>
        <EnTetePage titre="Portail employe" />
        <Alerte ton="danger" titre="Compte non rattache a une fiche employe">
          Votre compte utilisateur n'est rattache a aucune fiche employe. Le
          portail ne peut donc afficher aucune donnee personnelle. Contactez le
          service des ressources humaines pour regulariser votre situation : un
          compte nominatif doit correspondre a un seul employe, jamais a
          plusieurs.
        </Alerte>
      </>
    );
  }

  const employeeId = utilisateur.employeeId;
  // La journee de travail est celle d'Africa/Algiers : elle n'est jamais deduite
  // du fuseau du serveur ni de celui du navigateur de l'operateur.
  const jourTexte = jourMetier();
  const jour = jourCivilMetier();
  const { debut, fin } = bornesMois(jourTexte);

  // Aucune colonne de remuneration n'est selectionnee ici, volontairement.
  const employe = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      matricule: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      factory: true,
      workshop: { select: { code: true, label: true } },
    },
  });

  const [affectationsJour, operations, declarations, tempsMois, evaluations, pointageJour] =
    await Promise.all([
      prisma.assignment.findMany({
        where: {
          employeeId,
          date: jour,
          status: { notIn: ["ANNULEE"] },
        },
        orderBy: { plannedStart: "asc" },
        select: {
          id: true,
          status: true,
          plannedStart: true,
          plannedEnd: true,
          actualStart: true,
          actualEnd: true,
          breakMinutes: true,
          comment: true,
          operation: { select: { code: true, label: true } },
          workOrder: { select: { number: true } },
          workCenter: { select: { code: true } },
          workshop: { select: { code: true } },
        },
      }),
      prisma.workOrderOperation.findMany({
        where: {
          workOrder: { status: { notIn: ["CLOTURE", "ANNULE"] } },
          OR: [
            {
              operatorId: employeeId,
            },
            {
              assignments: {
                some: {
                  employeeId,
                  status: { in: ["PLANIFIEE", "EN_COURS", "EN_PAUSE"] },
                },
              },
            },
          ],
        },
        orderBy: [{ workOrderId: "asc" }, { stepNo: "asc" }],
        take: 20,
        select: {
          id: true,
          stepNo: true,
          status: true,
          quantityPlanned: true,
          quantityProduced: true,
          quantityConform: true,
          quantityScrapped: true,
          quantityRework: true,
          actualStart: true,
          actualEnd: true,
          pausedAt: true,
          totalPausedMs: true,
          qualityStatus: true,
          operation: { select: { id: true, code: true, label: true } },
          workCenter: { select: { code: true, label: true } },
          workOrder: {
            select: { id: true, number: true, factory: true, itemId: true, item: { select: { code: true, label1: true } } },
          },
          assignments: {
            where: { employeeId, status: { in: ["PLANIFIEE", "EN_COURS", "EN_PAUSE"] } },
            select: { id: true, status: true },
          },
        },
      }),
      prisma.operationDeclaration.findMany({
        where: { employeeId, kind: { not: "PROBLEME" } },
        orderBy: { occurredAt: "desc" },
        take: 10,
        select: {
          id: true,
          kind: true,
          quantity: true,
          quantityConform: true,
          occurredAt: true,
          lossCategory: true,
          lossReason: true,
          comment: true,
          operation: { select: { code: true } },
        },
      }),
      prisma.attendance.aggregate({
        where: { employeeId, date: { gte: debut, lte: fin } },
        _sum: { workedHours: true, overtimeHours: true, lateMinutes: true },
        _count: { _all: true },
      }),
      prisma.performanceEvaluation.findMany({
        where: { employeeId },
        orderBy: { periodStart: "desc" },
        take: 5,
        select: {
          id: true,
          periodType: true,
          periodStart: true,
          periodEnd: true,
          globalScore: true,
          reliability: true,
          isValidated: true,
          productivityScore: true,
          qualityScore: true,
        },
      }),
      prisma.attendance.findUnique({
        where: { employeeId_date: { employeeId, date: jour } },
        select: { status: true, checkIn: true, checkOut: true, workedHours: true },
      }),
    ]);

  const operationIds = operations.map((operation) => operation.id);

  // Etat de validation reel : ce qui est declare conforme, ce qui est encore en
  // attente et ce qui a ete valide. Une quantite declaree ne compte jamais comme
  // arrivee tant qu'elle n'est pas validee puis transferee.
  const declarationsParStatut = operationIds.length
    ? await prisma.operationDeclaration.groupBy({
        by: ["workOrderOperationId", "status"],
        where: {
          workOrderOperationId: { in: operationIds },
          kind: "PRODUCTION",
        },
        _sum: { quantityConform: true },
      })
    : [];

  const validationParOperation = new Map<
    number,
    { enAttente: ReturnType<typeof D.of>; validee: ReturnType<typeof D.of> }
  >();
  for (const ligne of declarationsParStatut) {
    const cle = ligne.workOrderOperationId;
    const cumul =
      validationParOperation.get(cle) ??
      { enAttente: D.of(0), validee: D.of(0) };
    const quantite = D.of(ligne._sum.quantityConform);
    if (ligne.status === "VALIDEE") {
      cumul.validee = D.add(cumul.validee, quantite);
    } else if (ligne.status === "SAISIE" || ligne.status === "SOUMISE") {
      cumul.enAttente = D.add(cumul.enAttente, quantite);
    }
    validationParOperation.set(cle, cumul);
  }

  // Sous-stock de sortie de chaque etape : ou se depose la production conforme,
  // et ce qui est disponible pour la suite. Lu depuis le grand livre.
  const sousStocksParOperation = new Map<
    number,
    {
      code: string;
      label: string;
      disponible: ReturnType<typeof D.of>;
      enAttenteValidation: ReturnType<typeof D.of>;
      dejaTransfere: ReturnType<typeof D.of>;
    }
  >();

  if (operationIds.length > 0) {
    const sorties = await prisma.operationSubStock.findMany({
      where: {
        operationId: { in: operations.map((operation) => operation.operation.id) },
        isActive: true,
        kind: { in: ["SORTIE_OPERATION", "ENTREE_OPERATION"] },
      },
      select: { id: true, code: true, label: true, operationId: true },
      orderBy: { sequenceOrder: "asc" },
    });

    await Promise.all(
      operations.map(async (operation) => {
        const sortie = sorties.find(
          (candidat) => candidat.operationId === operation.operation.id,
        );
        if (!sortie) return;

        const position = await positionSousStock(prisma, {
          subStockId: sortie.id,
          itemId: operation.workOrder.itemId,
        });
        const transferts = await prisma.operationStepTransfer.aggregate({
          where: { workOrderOperationId: operation.id },
          _sum: { quantity: true },
        });

        sousStocksParOperation.set(operation.id, {
          code: sortie.code,
          label: sortie.label,
          disponible: position.quantiteDisponible,
          enAttenteValidation: position.quantiteEnAttenteValidation,
          dejaTransfere: D.of(transferts._sum.quantity),
        });
      }),
    );
  }

  const programmeDuJour = await programmeEmploye(employeeId, {});
  const materiaux = operationIds.length
    ? await prisma.workOrderMaterial.findMany({
        where: {
          workOrderOperationId: { in: operationIds },
          isLabor: false,
        },
        orderBy: [{ lineNo: "asc" }],
        take: 500,
        select: {
          id: true,
          workOrderOperationId: true,
          componentItemId: true,
          quantityPlanned: true,
          quantityIssued: true,
          quantityConsumed: true,
          unitCode: true,
          componentItem: {
            select: { code: true, label1: true, unitCode: true },
          },
        },
      })
    : [];

  const materiauxParOperation = new Map<
    number,
    {
      id: number;
      itemId: number;
      code: string;
      label: string;
      unite: string;
      planifiee: ReturnType<typeof D.of>;
      sortie: ReturnType<typeof D.of>;
      consommee: ReturnType<typeof D.of>;
      manque: ReturnType<typeof D.of>;
    }[]
  >();
  for (const ligne of materiaux) {
    if (ligne.workOrderOperationId === null) continue;
    const existant = materiauxParOperation.get(ligne.workOrderOperationId) ?? [];
    if (existant.some((item) => item.id === ligne.id)) continue;

    const planifiee = D.of(ligne.quantityPlanned);
    const sortie = D.of(ligne.quantityIssued);
    existant.push({
      id: ligne.id,
      itemId: ligne.componentItemId,
      code: ligne.componentItem.code,
      label: ligne.componentItem.label1,
      unite: ligne.unitCode ?? ligne.componentItem.unitCode ?? "",
      planifiee,
      sortie,
      consommee: D.of(ligne.quantityConsumed),
      manque: D.max(D.sub(planifiee, sortie), D.of(0)),
    });
    materiauxParOperation.set(ligne.workOrderOperationId, existant);
  }

  const peutCloturerOrdre = aLaPermission(utilisateur, PERMISSIONS.PRODUCTION_CLOTURER);
  const nomComplet = employe
    ? `${employe.firstName} ${employe.lastName}`.trim()
    : "Employe";

  return (
    <>
      <EnTetePage
        titre={`Bonjour ${nomComplet}`}
        description={
          employe
            ? `${employe.matricule}${employe.jobTitle ? ` — ${employe.jobTitle}` : ""}${
                employe.workshop ? ` — atelier ${employe.workshop.code}` : ""
              }${employe.factory ? ` — ${libelle(LIBELLES_USINE, employe.factory)}` : ""}`
            : undefined
        }
        actions={
          <a className="lien-nav text-sm" href="#operations">
            Mes operations du jour
          </a>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Statistique
          libelle="Operations ouvertes"
          valeur={operations.length}
          ton="primaire"
          detail="Affectees ou confiees a vous"
        />
        <Statistique
          libelle="Heures ce mois"
          valeur={formatQuantite(tempsMois._sum.workedHours ?? 0)}
          detail={`${tempsMois._count._all} pointage(s)`}
        />
        <Statistique
          libelle="Heures supplementaires ce mois"
          valeur={formatQuantite(tempsMois._sum.overtimeHours ?? 0)}
          ton="alerte"
        />
        <Statistique
          libelle="Mon pointage du jour"
          valeur={
            pointageJour
              ? libelle(LIBELLES_PRESENCE, pointageJour.status)
              : "Non pointe"
          }
          detail={
            pointageJour
              ? `${formatHeure(pointageJour.checkIn)} → ${formatHeure(pointageJour.checkOut)}`
              : "Adressez-vous au responsable d'atelier"
          }
          ton="neutre"
        />
      </div>


      <div className="mt-5">
        <Carte
          titre="📷 Scanner mon poste"
          description="Pointez votre camera vers le QR affiche sur votre machine."
        >
          <ScannerQR />
        </Carte>
      </div>

      <div className="mt-5">
        <ProgrammeTaches
          taches={programmeDuJour}
          titre="Mon programme du jour, dans l'ordre de passage"
          messageVide="Aucune tache ne vous est planifiee pour aujourd'hui. Votre responsable d'atelier renseigne les affectations quotidiennes."
        />
      </div>

      <div className="mt-5">
        <Carte
          titre="Mes affectations du jour"
          description={`Journee du ${formatDate(jour)}. La polyvalence est la regle : vous pouvez etre affecte a plusieurs operations dans la meme journee.`}
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "operation", libelle: "Operation" },
              { cle: "ordre", libelle: "Ordre de fabrication" },
              { cle: "poste", libelle: "Poste de travail" },
              { cle: "atelier", libelle: "Atelier" },
              { cle: "statut", libelle: "Statut" },
              { cle: "prevu", libelle: "Creneau prevu" },
              { cle: "reel", libelle: "Creneau reel" },
            ]}
            lignes={affectationsJour.map((affectation) => ({
              cle: String(affectation.id),
              cellules: [
                `${affectation.operation.code} — ${affectation.operation.label}`,
                affectation.workOrder?.number ?? "Hors ordre",
                affectation.workCenter?.code ?? "-",
                affectation.workshop?.code ?? employe?.workshop?.code ?? "-",
                <EtiquetteStatut
                  key="s"
                  libelle={libelle(
                    LIBELLES_STATUT_AFFECTATION,
                    affectation.status,
                  )}
                  code={affectation.status}
                />,
                affectation.plannedStart || affectation.plannedEnd
                  ? `${formatHeure(affectation.plannedStart)} → ${formatHeure(affectation.plannedEnd)}`
                  : "Non planifie",
                affectation.actualStart
                  ? `${formatHeure(affectation.actualStart)} → ${formatHeure(affectation.actualEnd)}`
                  : "Non demarree",
              ],
            }))}
            messageVide="Aucune affectation ne vous est confiee aujourd'hui."
          />
        </Carte>
      </div>

      <div className="mt-5" id="operations">
        <h2 className="mb-3 text-lg font-semibold">Mes operations en cours</h2>
        {operations.length === 0 ? (
          <Carte>
            <Vide
              titre="Aucune operation ouverte"
              message="Vous n'avez aucune operation en cours. Les operations apparaissent ici des qu'elles vous sont affectees par le responsable d'atelier."
            />
          </Carte>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {operations.map((operation) => {
              const matieres = materiauxParOperation.get(operation.id) ?? [];
              const validation = validationParOperation.get(operation.id);
              const sousStock = sousStocksParOperation.get(operation.id);
              const enAttente = validation?.enAttente ?? D.of(0);
              const validee = validation?.validee ?? D.of(0);
              const termine = operation.status === "TERMINEE";
              // Un etat termine n'est jamais presente comme un stock disponible :
              // tant que la quantite n'est pas validee, elle est en attente.
              const libelleEtat = termine
                ? D.gt(enAttente, 0)
                  ? "Termine — en attente de validation"
                  : "Termine — quantite validee"
                : libelle(LIBELLES_STATUT_OPERATION, operation.status);
              const tonEtat: TonEtiquette | undefined = termine
                ? D.gt(enAttente, 0)
                  ? "alerte"
                  : "succes"
                : undefined;
              const temps = dureeReelle(
                operation.actualStart,
                operation.actualEnd,
                operation.totalPausedMs,
              );

              return (
                <Carte
                  key={operation.id}
                  titre={`${operation.operation.code} — ${operation.operation.label}`}
                  description={`Ordre ${operation.workOrder.number} — etape ${operation.stepNo}${
                    operation.workCenter ? ` — poste ${operation.workCenter.code}` : ""
                  }`}
                  actions={
                    <>
                      {tonEtat ? (
                        <Etiquette ton={tonEtat}>{libelleEtat}</Etiquette>
                      ) : (
                        <EtiquetteStatut
                          libelle={libelleEtat}
                          code={operation.status}
                        />
                      )}
                      <Link
                        className="lien-nav text-sm font-semibold"
                        href={`/portail/operation/${operation.id}`}
                      >
                        Ouvrir le portail
                      </Link>
                    </>
                  }
                >
                  <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                    {`${operation.workOrder.item.code} — ${operation.workOrder.item.label1}`}
                  </p>

                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <p>
                      <span className="font-semibold">Quantite prevue : </span>
                      {formatQuantite(operation.quantityPlanned)}
                    </p>
                    <p>
                      <span className="font-semibold">Deja produite : </span>
                      {formatQuantite(operation.quantityProduced)}
                    </p>
                    <p>
                      <span className="font-semibold">Conforme declaree : </span>
                      {formatQuantite(operation.quantityConform)}
                    </p>
                    <p>
                      <span className="font-semibold">Rebut : </span>
                      {formatQuantite(operation.quantityScrapped)}
                    </p>
                    <p>
                      <span className="font-semibold">A reprendre : </span>
                      {formatQuantite(operation.quantityRework)}
                    </p>
                    <p>
                      <span className="font-semibold">Temps reel : </span>
                      {temps ?? "Non demarree"}
                      {operation.pausedAt ? " (en pause)" : ""}
                    </p>
                  </div>

                  <div className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
                    <p>
                      <span className="font-semibold">
                        Conforme validee par un responsable :{" "}
                      </span>
                      {formatQuantite(validee)}
                    </p>
                    <p>
                      <span className="font-semibold">
                        Declaree conforme, en attente de validation :{" "}
                      </span>
                      {D.isZero(enAttente) ? "Aucune" : formatQuantite(enAttente)}
                    </p>
                  </div>

                  {sousStock && (
                    <div className="mt-2 rounded border p-2 text-sm">
                      <p className="font-medium">
                        Sous-stock d&apos;etape : {sousStock.code} — {sousStock.label}
                      </p>
                      <p style={{ color: "var(--texte-doux)" }}>
                        {formatQuantite(sousStock.disponible)} disponible ·{" "}
                        {formatQuantite(sousStock.dejaTransfere)} deja transmis a
                        l&apos;etape suivante
                      </p>
                      <p style={{ color: "var(--texte-doux)" }}>
                        Ce qui est disponible ici n&apos;est pas encore arrive a
                        l&apos;etape suivante : le passage se fait par un transfert
                        trace, apres validation.
                      </p>
                    </div>
                  )}

                  {!sousStock && (
                    <p className="mt-2 text-sm" style={{ color: "var(--texte-doux)" }}>
                      Aucun sous-stock d&apos;etape n&apos;est declare pour cette
                      operation : la production conforme reste a l&apos;emplacement
                      du magasin.
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <BoutonAction
                      action={actionPortailDemarrerOperation}
                      libelle="Demarrer"
                      variante="primaire"
                      champsCaches={{ workOrderOperationId: operation.id }}
                    />
                    <BoutonAction
                      action={actionPortailMettreEnPause}
                      libelle="Mettre en pause"
                      champsCaches={{ workOrderOperationId: operation.id }}
                    />
                    <BoutonAction
                      action={actionPortailReprendreOperation}
                      libelle="Reprendre"
                      champsCaches={{ workOrderOperationId: operation.id }}
                    />
                    <BoutonAction
                      action={actionPortailTerminerOperation}
                      libelle="Terminer mon intervention"
                      champsCaches={{ workOrderOperationId: operation.id }}
                      confirmation="Terminer votre intervention ? Vos heures reelles seront figees et serviront de base a votre evaluation."
                    />
                  </div>

                  <div className="mt-4 grid gap-3">
                    <details>
                      <summary className="cursor-pointer text-sm font-semibold">
                        Matieres de cette operation ({matieres.length})
                      </summary>
                      <p className="mt-1 text-xs" style={{ color: "var(--texte-doux)" }}>
                        « Sortie » est ce qui est deja sorti du magasin pour cette
                        operation, « consomme » ce qui a ete reellement consomme.
                        La matiere n&apos;est jamais modifiee ici : chaque prise est
                        une sortie de stock tracee, avec son auteur.
                      </p>
                      {matieres.length === 0 ? (
                        <Alerte ton="neutre" titre="Aucune matiere rattachee">
                          Aucun composant n&apos;est rattache a cette operation.
                          Adressez-vous au magasin.
                        </Alerte>
                      ) : (
                        <ul className="mt-2 grid gap-3">
                          {matieres.map((matiere) => (
                            <li key={matiere.id} className="rounded border p-3 text-sm">
                              <p className="font-medium">
                                {matiere.code} — {matiere.label}
                              </p>
                              <p style={{ color: "var(--texte-doux)" }}>
                                Prevu {formatQuantite(matiere.planifiee)}{" "}
                                {matiere.unite} · sorti{" "}
                                {formatQuantite(matiere.sortie)} · consomme{" "}
                                {formatQuantite(matiere.consommee)}
                                {D.gt(matiere.manque, 0)
                                  ? ` · manque ${formatQuantite(matiere.manque)}`
                                  : ""}
                              </p>
                              <div className="mt-2">
                                <FormulaireAction
                                  action={actionPortailDeclarerConsommation}
                                  libelleSoumettre="Declarer la matiere prise"
                                  varianteSoumettre="secondaire"
                                  reinitialiser
                                >
                                  <input
                                    type="hidden"
                                    name="workOrderOperationId"
                                    value={operation.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="materialId"
                                    value={matiere.id}
                                  />
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <Champ
                                      nom="quantite"
                                      libelle={`Quantite prise (${matiere.unite || "unite"})`}
                                      type="number"
                                      requis
                                      pas="0.0001"
                                      min="0"
                                    />
                                    <Champ
                                      nom="commentaire"
                                      libelle="Commentaire"
                                      maxLength={200}
                                    />
                                  </div>
                                </FormulaireAction>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>

                    <details>
                      <summary className="cursor-pointer text-sm font-semibold">
                        Declarer une quantite produite
                      </summary>
                      <p className="mt-1 text-xs" style={{ color: "var(--texte-doux)" }}>
                        Ces quantites alimentent votre evaluation et la tracabilite
                        de l'ordre. Elles sont enregistrees telles que declarees.
                      </p>
                      <FormulaireAction
                        action={actionPortailDeclarerProduction}
                        libelleSoumettre="Declarer la production"
                        reinitialiser
                      >
                        <input
                          type="hidden"
                          name="workOrderOperationId"
                          value={operation.id}
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Champ
                            nom="quantiteProduite"
                            libelle="Quantite produite"
                            type="number"
                            requis
                            pas="0.0001"
                            min="0"
                          />
                          <Champ
                            nom="quantiteConforme"
                            libelle="Dont conforme"
                            type="number"
                            pas="0.0001"
                            min="0"
                          />
                          <Champ
                            nom="quantiteRebutee"
                            libelle="Dont rebut"
                            type="number"
                            pas="0.0001"
                            min="0"
                          />
                          <Champ
                            nom="quantiteReprise"
                            libelle="Dont a reprendre"
                            type="number"
                            pas="0.0001"
                            min="0"
                          />
                        </div>
                        <Champ nom="commentaire" libelle="Commentaire" type="textarea" />
                      </FormulaireAction>
                    </details>

                    <details>
                      <summary className="cursor-pointer text-sm font-semibold">
                        Declarer une perte
                      </summary>
                      <p className="mt-1 text-xs" style={{ color: "var(--texte-doux)" }}>
                        Le motif est obligatoire. Le portail enregistre la perte mais
                        ne sort aucun article du stock : la sortie reste traitee par
                        le magasin.
                      </p>
                      {matieres.length === 0 ? (
                        <Alerte ton="neutre" titre="Aucun article rattache">
                          Aucun composant n'est rattache a cette operation. Adressez
                          la declaration de perte au magasin.
                        </Alerte>
                      ) : (
                        <FormulaireAction
                          action={actionPortailDeclarerPerte}
                          libelleSoumettre="Declarer la perte"
                          varianteSoumettre="danger"
                          reinitialiser
                        >
                          <input
                            type="hidden"
                            name="workOrderOperationId"
                            value={operation.id}
                          />
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Champ
                              nom="itemId"
                              libelle="Article concerne"
                              type="select"
                              requis
                              options={matieres.map((matiere) => ({
                                valeur: matiere.itemId,
                                libelle: `${matiere.code} — ${matiere.label}`,
                              }))}
                            />
                            <Champ
                              nom="quantite"
                              libelle="Quantite perdue"
                              type="number"
                              requis
                              pas="0.0001"
                              min="0"
                            />
                            <Champ
                              nom="categorie"
                              libelle="Categorie de perte"
                              type="select"
                              requis
                              options={Object.entries(LIBELLES_CATEGORIE_PERTE).map(
                                ([valeur, texte]) => ({ valeur, libelle: texte }),
                              )}
                            />
                            <Champ
                              nom="motif"
                              libelle="Motif de perte"
                              type="select"
                              requis
                              options={Object.entries(LIBELLES_MOTIF_PERTE).map(
                                ([valeur, texte]) => ({ valeur, libelle: texte }),
                              )}
                            />
                          </div>
                          <label className="mt-2 block text-sm">
                            <span className="mb-1 block font-medium">
                              Precisions sur la perte
                            </span>
                            <textarea
                              className="champ"
                              name="commentaire"
                              rows={2}
                              placeholder="Decrivez ce qui s'est passe"
                            />
                          </label>
                        </FormulaireAction>
                      )}
                    </details>

                    <details>
                      <summary className="cursor-pointer text-sm font-semibold">
                        Signaler un probleme
                      </summary>
                      <p className="mt-1 text-xs" style={{ color: "var(--texte-doux)" }}>
                        Le signalement ouvre une non-conformite reelle que le service
                        qualite examinera. La description est obligatoire.
                      </p>
                      <FormulaireAction
                        action={actionPortailSignalerProbleme}
                        libelleSoumettre="Envoyer le signalement"
                        varianteSoumettre="danger"
                        reinitialiser
                      >
                        <input
                          type="hidden"
                          name="workOrderOperationId"
                          value={operation.id}
                        />
                        <label className="block text-sm">
                          <span className="mb-1 block font-medium">
                            Description du probleme
                          </span>
                          <textarea
                            className="champ"
                            name="description"
                            rows={3}
                            required
                            minLength={5}
                            placeholder="Que s'est-il passe ? (au moins 5 caracteres)"
                          />
                        </label>
                        <Champ
                          nom="quantite"
                          libelle="Quantite impactee (facultatif)"
                          type="number"
                          pas="0.0001"
                          min="0"
                        />
                      </FormulaireAction>
                    </details>

                    {peutCloturerOrdre && (
                      <div>
                        <BoutonAction
                          action={actionPortailCloturerOrdre}
                          libelle="Cloturer l'ordre de fabrication"
                          variante="danger"
                          champsCaches={{ workOrderOperationId: operation.id }}
                          confirmation="Cloturer l'ordre de fabrication ? Cette action est definitive et n'est possible que si vous detenez le droit de cloture."
                          titre="Action reservee aux profils detenant la permission de cloture"
                        />
                      </div>
                    )}
                  </div>
                </Carte>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-5">
        <Carte
          titre="Mes dernieres declarations"
          description="Vos declarations de production, de consommation, de rebut, de reprise et de temps. Aucune declaration d'un autre employe n'apparait ici."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "quand", libelle: "Date" },
              { cle: "operation", libelle: "Operation" },
              { cle: "type", libelle: "Type" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "conforme", libelle: "Conforme", nombre: true },
              { cle: "perte", libelle: "Categorie et motif" },
              { cle: "commentaire", libelle: "Commentaire" },
            ]}
            lignes={declarations.map((declaration) => ({
              cle: String(declaration.id),
              cellules: [
                formatDateTime(declaration.occurredAt),
                declaration.operation.code,
                libelle(LIBELLES_TYPE_DECLARATION, declaration.kind),
                formatQuantite(declaration.quantity),
                formatQuantite(declaration.quantityConform),
                declaration.lossCategory
                  ? `${libelle(LIBELLES_CATEGORIE_PERTE, declaration.lossCategory)} — ${libelle(LIBELLES_MOTIF_PERTE, declaration.lossReason ?? "")}`
                  : "-",
                declaration.comment ?? "-",
              ],
            }))}
            messageVide="Vous n'avez encore enregistre aucune declaration."
          />
        </Carte>
      </div>

      <div className="mt-5">
        <Carte
          titre="Mes dernieres evaluations"
          description="Vous ne voyez ici que vos propres resultats. Une evaluation dont la fiabilite est insuffisante ne donne aucun score exploitable."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "periode", libelle: "Periode" },
              { cle: "bornes", libelle: "Bornes" },
              { cle: "productivite", libelle: "Productivite", nombre: true },
              { cle: "qualite", libelle: "Qualite", nombre: true },
              { cle: "global", libelle: "Score global", nombre: true },
              { cle: "fiabilite", libelle: "Fiabilite" },
              { cle: "validation", libelle: "Validation" },
            ]}
            lignes={evaluations.map((evaluation) => ({
              cle: String(evaluation.id),
              cellules: [
                libelle(LIBELLES_PERIODE_EVALUATION, evaluation.periodType),
                `${formatDate(evaluation.periodStart)} au ${formatDate(evaluation.periodEnd)}`,
                evaluation.productivityScore
                  ? formatQuantite(evaluation.productivityScore, 2)
                  : "Donnees insuffisantes",
                evaluation.qualityScore
                  ? formatQuantite(evaluation.qualityScore, 2)
                  : "Donnees insuffisantes",
                evaluation.globalScore
                  ? formatQuantite(evaluation.globalScore, 2)
                  : "Donnees insuffisantes",
                libelle(LIBELLES_FIABILITE, evaluation.reliability),
                evaluation.isValidated ? "Validee" : "En attente de validation",
              ],
            }))}
            messageVide="Aucune evaluation n'a encore ete etablie pour vous."
          />
        </Carte>
      </div>

      <div className="mt-5">
        <Alerte ton="neutre" titre="Ce que le portail ne permet pas">
          Le portail employe ne permet jamais de modifier un stock, de modifier une
          nomenclature, de modifier un cout, de consulter le salaire d'un autre
          employe ni de consulter les donnees d'un autre atelier. Toute tentative
          d'acces hors de votre perimetre est refusee par le serveur.
        </Alerte>
      </div>
    </>
  );
}
