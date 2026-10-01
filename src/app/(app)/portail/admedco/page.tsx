import Link from "next/link";
import { prisma } from "@/lib/db";
import { exigerPermission, peutAccederUsine } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { EnTetePage, Carte, Etiquette, Tableau, Vide } from "@/components/ui";
import { ScannerQR } from "@/components/scanner-qr";
import { ProgrammeTaches } from "@/components/taches-programme";
import { programmeEmploye } from "@/lib/mes/postes";
import { formatDate, formatQuantite } from "@/lib/format";
import { jourCivilMetier } from "@/lib/mes/jour";
import { LIBELLES_USINE } from "@/lib/libelles";

export const metadata = { title: "Portail ADMEDCO" };

export default async function PagePortailAdmedco() {
  const utilisateur = await exigerPermission(PERMISSIONS.PORTAIL_EMPLOYE);

  if (!utilisateur.employeeId) {
    return (
      <>
        <EnTetePage titre="Portail ADMEDCO" />
        <Carte titre="Compte non rattache">
          <p>Votre compte n est pas rattache a une fiche employe ADMEDCO.</p>
        </Carte>
      </>
    );
  }

  const employeeId = utilisateur.employeeId;
  const employe = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { matricule: true, firstName: true, lastName: true, factory: true, jobTitle: true },
  });

  // Verify factory
  if (employe && employe.factory !== "ADMEDCO" && employe.factory !== "COMMUN") {
    return (
      <>
        <EnTetePage titre="Portail ADMEDCO" />
        <Carte titre="Mauvaise usine">
          <p>Ce portail est reserve aux employes ADMEDCO. Votre usine : {employe.factory}.</p>
        </Carte>
      </>
    );
  }

  const today = jourCivilMetier(new Date());
  const taches = await programmeEmploye(employeeId, {});

  // Count stats
  const operationsOuvertes = await prisma.workOrderOperation.count({
    where: {
      workOrder: { status: { notIn: ["CLOTURE", "ANNULE"] }, factory: "ADMEDCO" },
      OR: [
        { operatorId: employeeId },
        { assignments: { some: { employeeId, status: { in: ["PLANIFIEE", "EN_COURS", "EN_PAUSE"] } } } },
      ],
    },
  });

  return (
    <>
      <EnTetePage
        titre={`Portail ADMEDCO — Bonjour ${employe?.firstName ?? ""}`}
        description={`${employe?.matricule ?? ""} — ${employe?.jobTitle ?? ""} — ${LIBELLES_USINE.ADMEDCO}`}
        actions={
          <Link className="bouton secondaire" href="/portail/admedco/operations">
            Mes portails d operation
          </Link>
        }
      />

      {/* Scanner QR */}
      <Carte
        titre="Scanner mon poste"
        description="Pointez votre camera vers le QR affiche sur votre machine."
      >
        <ScannerQR />
      </Carte>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3 mt-4">
        <Carte titre="Operations ouvertes">
          <p className="text-3xl font-bold">{operationsOuvertes}</p>
        </Carte>
        <Carte titre="Taches du jour">
          <p className="text-3xl font-bold">{taches.length}</p>
        </Carte>
        <Carte titre="Date">
          <p className="text-lg font-bold">{formatDate(today)}</p>
        </Carte>
      </div>

      {/* Programme */}
      <div className="mt-4">
        <ProgrammeTaches
          taches={taches}
          titre="Mon programme ADMEDCO du jour"
          messageVide="Aucune tache ADMEDCO planifiee pour aujourd'hui."
        />
      </div>
    </>
  );
}
