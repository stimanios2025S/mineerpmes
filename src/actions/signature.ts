"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export async function actionSignerMagasinier(
  workOrderId: number,
  signature: string,
) {
  const utilisateur = await exigerPermission(PERMISSIONS.STOCK_MOUVEMENT_CREER);

  await prisma.workOrder.update({
    where: { id: workOrderId },
    data: {
      signatureMagasinier: signature,
      signatureMagasinierAt: new Date(),
      signatureMagasinierBy: utilisateur.userId,
    },
  });

  revalidatePath(`/stock/bci/${workOrderId}`);
  return { succes: true, message: "Signature du magasinier enregistree." };
}

export async function actionSignerChefAtelier(
  workOrderId: number,
  signature: string,
) {
  const utilisateur = await exigerPermission(PERMISSIONS.PRODUCTION_DECLARER);

  await prisma.workOrder.update({
    where: { id: workOrderId },
    data: {
      signatureChefAtelier: signature,
      signatureChefAtelierAt: new Date(),
      signatureChefAtelierBy: utilisateur.userId,
    },
  });

  revalidatePath(`/stock/bci/${workOrderId}`);
  return { succes: true, message: "Signature du chef d atelier enregistree." };
}
