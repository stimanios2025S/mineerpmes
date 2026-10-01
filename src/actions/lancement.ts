"use server";

/**
 * Lancement d un OF avec reservation automatique du stock.
 *
 * 1. Valide que la formule existe
 * 2. Reserve le stock (WorkOrderMaterial + StockBalance.quantityReserved)
 * 3. Passe l OF en statut LANCE
 * 4. Retourne les lignes pour le magasinier
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { reserverStockPourOF } from "@/lib/mes/reservation";

export async function actionLancerOF(workOrderId: number) {
  const utilisateur = await exigerPermission(PERMISSIONS.PRODUCTION_DECLARER);

  // Verifier que l OF existe et est en BROUILLON ou PLANIFIE
  const of = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
  if (!of) throw new Error("Ordre de fabrication introuvable.");
  if (of.status !== "BROUILLON" && of.status !== "PLANIFIE") {
    throw new Error(`L OF est deja en statut ${of.status}.`);
  }

  // Reserver le stock
  const lignes = await reserverStockPourOF(workOrderId);

  // Passer l OF en statut LANCE
  await prisma.workOrder.update({
    where: { id: workOrderId },
    data: { status: "LANCE", quantityLaunched: of.quantityPlanned, actualStart: new Date() },
  });

  // Creer les operations si elles n existent pas encore
  const existingOps = await prisma.workOrderOperation.count({ where: { workOrderId } });
  if (existingOps === 0) {
    const route = await prisma.productRoute.findFirst({
      where: { itemId: of.itemId, status: "ACTIVE" },
      include: { steps: { orderBy: { stepNo: "asc" } } },
    });
    if (route) {
      for (const step of route.steps) {
        await prisma.workOrderOperation.create({
          data: {
            workOrderId,
            stepNo: step.stepNo,
            operationId: step.operationId,
            workCenterId: step.workCenterId ?? null,
            quantityPlanned: of.quantityPlanned,
            status: step.stepNo === 1 ? "EN_COURS" : "NON_DEMARREE",
          },
        });
      }
    }
  }

  revalidatePath("/production");
  revalidatePath(`/production/${workOrderId}`);

  return {
    succes: true,
    message: `OF ${of.number} lance. ${lignes.length} lignes de matieres reservees.`,
    lignes,
    bciUrl: `/stock/bci/${workOrderId}`,
  };
}

/**
 * Le magasinier / chef d atelier confirme la livraison des MP.
 */
export async function actionConfirmerLivraison(workOrderId: number) {
  const utilisateur = await exigerPermission(PERMISSIONS.STOCK_MOUVEMENT_CREER);

  const materials = await prisma.workOrderMaterial.findMany({
    where: { workOrderId, isLabor: false },
  });

  let totalLivree = 0;
  for (const mat of materials) {
    const restant = Number(mat.quantityPlanned) - Number(mat.quantityIssued);
    if (restant > 0) {
      await prisma.workOrderMaterial.update({
        where: { id: mat.id },
        data: { quantityIssued: mat.quantityPlanned },
      });
      totalLivree++;
    }
  }

  revalidatePath(`/stock/bci/${workOrderId}`);

  return {
    succes: true,
    message: `${totalLivree} lignes livrees. Les MP sont maintenant disponibles dans l atelier.`,
  };
}
