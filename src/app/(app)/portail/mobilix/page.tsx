import Link from "next/link";
import { prisma } from "@/lib/db";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { EnTetePage, Carte } from "@/components/ui";
import { ScannerQR } from "@/components/scanner-qr";
import { ProgrammeTaches } from "@/components/taches-programme";
import { programmeEmploye } from "@/lib/mes/postes";
import { formatDate } from "@/lib/format";
import { jourCivilMetier } from "@/lib/mes/jour";
import { LIBELLES_USINE } from "@/lib/libelles";

export const metadata = { title: "Portail MOBILIX" };

export default async function PagePortailMobilix() {
  const utilisateur = await exigerPermission(PERMISSIONS.PORTAIL_EMPLOYE);

  if (!utilisateur.employeeId) {
    return (
      <>
        <EnTetePage titre="Portail MOBILIX" />
        <Carte titre="Compte non rattache">
          <p>Votre compte n est pas rattache a une fiche employe MOBILIX.</p>
        </Carte>
      </>
    );
  }

  const employeeId = utilisateur.employeeId;
  const employe = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { matricule: true, firstName: true, lastName: true, factory: true, jobTitle: true },
  });

  if (employe && employe.factory !== "MOBILIX" && employe.factory !== "COMMUN") {
    return (
      <>
        <EnTetePage titre="Portail MOBILIX" />
        <Carte titre="Mauvaise usine">
          <p>Ce portail est reserve aux employes MOBILIX. Votre usine : {employe.factory}.</p>
        </Carte>
      </>
    );
  }

  const today = jourCivilMetier(new Date());
  const taches = await programmeEmploye(employeeId, {});

  const operationsOuvertes = await prisma.workOrderOperation.count({
    where: {
      workOrder: { status: { notIn: ["CLOTURE", "ANNULE"] }, factory: "MOBILIX" },
      OR: [
        { operatorId: employeeId },
        { assignments: { some: { employeeId, status: { in: ["PLANIFIEE", "EN_COURS", "EN_PAUSE"] } } } },
      ],
    },
  });

  return (
    <>
      <EnTetePage
        titre={`Portail MOBILIX — Bonjour ${employe?.firstName ?? ""}`}
        description={`${employe?.matricule ?? ""} — ${employe?.jobTitle ?? ""} — ${LIBELLES_USINE.MOBILIX}`}
        actions={
          <Link className="bouton secondaire" href="/portail/mobilix/operations">
            Mes portails d operation
          </Link>
        }
      />

      <Carte
        titre="Scanner mon poste"
        description="Pointez votre camera vers le QR affiche sur votre machine."
      >
        <ScannerQR />
      </Carte>

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

      <div className="mt-4">
        <ProgrammeTaches
          taches={taches}
          titre="Mon programme MOBILIX du jour"
          messageVide="Aucune tache MOBILIX planifiee pour aujourd hui."
        />
      </div>
    </>
  );
}
