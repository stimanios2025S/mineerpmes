"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import { echec, succes, type ResultatAction } from "@/lib/actions/resultat";

/**
 * Ordre de passage des ordres de fabrication.
 *
 * Le chef d'atelier decide ce qui se fabrique d'abord. Le rang est porte par
 * l'ordre lui-meme (`sequenceOrder`), pas par l'affectation : un ordre non
 * encore affecte a deja sa place dans la file.
 *
 * A chaque deplacement, la file ouverte de la division est renumerotee de 0 a
 * n-1 : deux ordres ne peuvent donc pas garder le meme rang, et le resultat ne
 * depend pas de l'ordre d'arrivee en base.
 */
export async function actionDeplacerOrdreFabrication(
  donnees: FormData,
): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.PRODUCTION_PLANNING_GERER);

  const workOrderId = Number(donnees.get("workOrderId"));
  const direction = String(donnees.get("direction") ?? "");

  if (!Number.isInteger(workOrderId) || workOrderId <= 0) {
    return echec("Ordre invalide.");
  }
  if (direction !== "haut" && direction !== "bas") {
    return echec("Sens de deplacement inconnu.");
  }

  const ordre = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, number: true, factory: true },
  });
  if (!ordre) {
    return echec("Ordre introuvable.");
  }

  const file = await prisma.workOrder.findMany({
    where: {
      factory: ordre.factory,
      status: { notIn: ["CLOTURE", "ANNULE"] },
    },
    orderBy: [{ sequenceOrder: "asc" }, { dueDate: "asc" }, { id: "asc" }],
    select: { id: true },
  });

  const position = file.findIndex((ligne) => ligne.id === workOrderId);
  const cible = direction === "haut" ? position - 1 : position + 1;

  if (position < 0 || cible < 0 || cible >= file.length) {
    return succes(
      direction === "haut"
        ? "Cet ordre est deja le premier de la file."
        : "Cet ordre est deja le dernier de la file.",
    );
  }

  const ordreFinal = file.map((ligne) => ligne.id);
  [ordreFinal[position], ordreFinal[cible]] = [ordreFinal[cible], ordreFinal[position]];

  await prisma.$transaction(
    ordreFinal.map((id, rang) =>
      prisma.workOrder.update({ where: { id }, data: { sequenceOrder: rang } }),
    ),
  );

  await enregistrerAudit({
    action: ACTIONS_AUDIT.MODIFICATION,
    module: MODULES_AUDIT.PRODUCTION,
    entity: "WorkOrder",
    entityId: workOrderId,
    userId: utilisateur.id,
    userEmail: utilisateur.email,
    oldValue: { rang: position },
    newValue: { rang: cible },
  });

  revalidatePath("/production");
  revalidatePath("/atelier/[code]", "page");

  return succes(`L'ordre ${ordre.number} a ete deplace.`);
}
