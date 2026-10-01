import Link from "next/link";
import type { Factory } from "@prisma/client";
import { prisma } from "@/lib/db";
import { exigerPermission, peutAccederUsine, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Statistique,
  Vide,
} from "@/components/ui";
import { D } from "@/lib/decimal";
import {
  formatDate,
  formatDateTime,
  formatHeure,
  formatQuantite,
} from "@/lib/format";
import {
  LIBELLES_STATUT_AFFECTATION,
  LIBELLES_STATUT_OPERATION,
  LIBELLES_USINE,
  libelle,
} from "@/lib/libelles";
import { identitePortail, type UsinePortail } from "@/lib/portail-identite";

/**
 * Index des portails d'operation.
 *
 * L'usine est optionnelle : la version generale reste accessible, tandis que
 * les accueils ADMEDCO et MOBILIX passent une usine explicite pour separer
 * visuellement et operationnellement les deux divisions.
 */
export function PortailOperations({
  usine,
}: {
  usine?: UsinePortail;
}) {
  return <ContenuPortailOperations usine={usine} />;
}

async function ContenuPortailOperations({
  usine,
}: {
  usine?: UsinePortail;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.PORTAIL_EMPLOYE);
  const identite = usine ? identitePortail(usine) : null;

  if (usine && !peutAccederUsine(utilisateur, usine as Factory)) {
    return (
      <>
        <EnTetePage titre={`Portails ${identite?.libelle ?? usine}`} />
        <Alerte ton="danger" titre="Division hors de votre perimetre">
          Votre profil ne vous autorise pas a ouvrir les portails de l&apos;usine{" "}
          {identite?.libelle ?? usine}.
        </Alerte>
      </>
    );
  }

  if (!utilisateur.employeeId) {
    return (
      <>
        <EnTetePage
          titre={usine ? `Portails ${identite?.libelle ?? usine}` : "Mes portails d'operation"}
        />
        <Alerte ton="danger" titre="Compte non rattache a une fiche employe">
          Le portail d&apos;operation exige une fiche employe rattachee a votre
          compte. Contactez le service des ressources humaines pour regulariser
          votre situation.
        </Alerte>
      </>
    );
  }

  const employeeId = utilisateur.employeeId;
  const fabriques: Factory[] = usine
    ? [usine]
    : usinesAutorisees(utilisateur).filter(
        (valeur): valeur is Factory => valeur === "ADMEDCO" || valeur === "MOBILIX",
      );

  const operations = fabriques.length
    ? await prisma.workOrderOperation.findMany({
        where: {
          workOrder: {
            status: { notIn: ["CLOTURE", "ANNULE"] },
            factory: { in: fabriques },
          },
          OR: [
            { operatorId: employeeId },
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
        include: {
          operation: {
            select: {
              code: true,
              label: true,
              factory: true,
              requiresQualityCheck: true,
            },
          },
          workOrder: {
            select: {
              id: true,
              number: true,
              factory: true,
              status: true,
              priority: true,
              quantityPlanned: true,
              quantityConform: true,
              dueDate: true,
              item: { select: { code: true, label1: true, unitCode: true } },
            },
          },
          workCenter: {
            select: { code: true, label: true, location: true },
          },
          assignments: {
            where: {
              employeeId,
              status: { in: ["PLANIFIEE", "EN_COURS", "EN_PAUSE"] },
            },
            select: {
              id: true,
              status: true,
              plannedStart: true,
              plannedEnd: true,
              actualStart: true,
              actualEnd: true,
              plannedQuantity: true,
              sequenceOrder: true,
              workCenter: { select: { code: true, label: true } },
            },
            orderBy: { sequenceOrder: "asc" },
          },
        },
        orderBy: { stepNo: "asc" },
        take: 100,
      })
    : [];

  const totalReste = operations.reduce(
    (total, operation) =>
      D.add(
        total,
        D.max(
          D.sub(operation.quantityPlanned, operation.quantityConform),
          D.of(0),
        ),
      ),
    D.of(0),
  );
  const enCours = operations.filter(
    (operation) =>
      operation.status === "EN_COURS" ||
      operation.assignments.some((affectation) => affectation.status === "EN_COURS"),
  ).length;

  return (
    <div className={`portail-identite ${identite?.className ?? ""}`}>
      <EnTetePage
        titre={
          usine
            ? `Portails ${identite?.libelle ?? usine}`
            : "Mes portails d'operation"
        }
        description={
          usine
            ? `${identite?.description}. Chaque etape confiee possede son propre espace de travail : consignes, quantites, matieres, declarations et actions tracees.`
            : "Chaque etape qui vous est confiee possede son propre espace de travail : consignes, quantites, matieres, declarations et actions tracees."
        }
        actions={
          <>
            {usine ? (
              <Link
                className="bouton secondaire"
                href={usine === "ADMEDCO" ? "/portail/admedco" : "/portail/mobilix"}
              >
                Retour au portail {identite?.courte ?? usine}
              </Link>
            ) : (
              <Link className="bouton secondaire" href="/portail">
                Retour au portail employe
              </Link>
            )}
          </>
        }
      />

      {usine && (
        <div className="mb-5">
          <Etiquette ton="primaire">{identite?.description}</Etiquette>
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Statistique
          libelle="Operations ouvertes"
          valeur={operations.length}
          ton="primaire"
          detail="Etapes affectees ou confiees a vous"
        />
        <Statistique
          libelle="Operations en cours"
          valeur={enCours}
          ton="info"
          detail="Operation ou affectation active"
        />
        <Statistique
          libelle="Reste a produire"
          valeur={formatQuantite(totalReste)}
          ton={D.gt(totalReste, 0) ? "alerte" : "succes"}
          detail="Quantite conforme attendue sur ces etapes"
        />
      </div>

      {operations.length === 0 ? (
        <Carte>
          <Vide
            titre="Aucun portail d'operation ouvert"
            message="Vous n'avez aucune operation en cours sur cette division. Les portails apparaissent ici des qu'elles vous sont affectees par le responsable d'atelier."
            action={
              <Link
                className="lien-nav"
                href={usine ? (usine === "ADMEDCO" ? "/portail/admedco" : "/portail/mobilix") : "/portail"}
              >
                Retour a mon programme
              </Link>
            }
          />
        </Carte>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {operations.map((operation) => {
            const affectation = operation.assignments[0] ?? null;
            const reste = D.max(
              D.sub(operation.quantityPlanned, operation.quantityConform),
              D.of(0),
            );
            return (
              <Carte
                key={operation.id}
                titre={`${operation.operation.code} - ${operation.operation.label}`}
                description={`Ordre ${operation.workOrder.number} - etape ${operation.stepNo}${
                  operation.workCenter
                    ? ` - poste ${operation.workCenter.code}`
                    : ""
                }`}
                actions={
                  <Link
                    className="lien-nav text-sm font-semibold"
                    href={`/portail/operation/${operation.id}`}
                  >
                    Ouvrir le portail
                  </Link>
                }
              >
                <div className="flex flex-wrap gap-2">
                  <EtiquetteStatut
                    libelle={libelle(LIBELLES_STATUT_OPERATION, operation.status)}
                    code={operation.status}
                  />
                  <span className="etiquette">
                    {LIBELLES_USINE[operation.workOrder.factory] ??
                      operation.workOrder.factory}
                  </span>
                  {operation.operation.requiresQualityCheck && (
                    <span className="etiquette" style={{ borderColor: "var(--alerte)" }}>
                      Controle qualite
                    </span>
                  )}
                </div>

                <p className="mt-3 text-sm" style={{ color: "var(--texte-doux)" }}>
                  {operation.workOrder.item.code} - {operation.workOrder.item.label1}
                </p>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                  <div>
                    <dt style={{ color: "var(--texte-doux)" }}>Quantite prevue</dt>
                    <dd className="font-medium">
                      {formatQuantite(operation.quantityPlanned)}
                      {operation.workOrder.item.unitCode
                        ? ` ${operation.workOrder.item.unitCode}`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: "var(--texte-doux)" }}>Conforme declaree</dt>
                    <dd className="font-medium">
                      {formatQuantite(operation.quantityConform)}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: "var(--texte-doux)" }}>Reste a faire</dt>
                    <dd className="font-medium">{formatQuantite(reste)}</dd>
                  </div>
                  <div>
                    <dt style={{ color: "var(--texte-doux)" }}>Echeance</dt>
                    <dd className="font-medium">
                      {operation.workOrder.dueDate
                        ? formatDate(operation.workOrder.dueDate)
                        : "-"}
                    </dd>
                  </div>
                </dl>

                {affectation && (
                  <div className="mt-3 rounded-md border p-2 text-sm" style={{ borderColor: "var(--bordure)" }}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        Affectation : {affectation.workCenter?.code ?? "Poste non precise"}
                      </p>
                      <EtiquetteStatut
                        libelle={libelle(
                          LIBELLES_STATUT_AFFECTATION,
                          affectation.status,
                        )}
                        code={affectation.status}
                      />
                    </div>
                    <p className="mt-1" style={{ color: "var(--texte-doux)" }}>
                      {affectation.plannedStart || affectation.plannedEnd
                        ? `Creneau prevu : ${formatHeure(affectation.plannedStart)} - ${formatHeure(affectation.plannedEnd)}`
                        : "Creneau non planifie"}
                      {affectation.actualStart
                        ? ` - demarree a ${formatDateTime(affectation.actualStart)}`
                        : ""}
                    </p>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Link
                    className="bouton primaire"
                    href={`/portail/operation/${operation.id}`}
                  >
                    Travailler sur cette etape
                  </Link>
                  <Link
                    className="lien-nav text-sm"
                    href={usine ? (usine === "ADMEDCO" ? "/portail/admedco" : "/portail/mobilix") : "/portail"}
                  >
                    Voir mon programme
                  </Link>
                </div>
              </Carte>
            );
          })}
        </div>
      )}
    </div>
  );
}
