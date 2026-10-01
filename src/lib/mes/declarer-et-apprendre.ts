/**
 * Wrapper qui enregistre la declaration ET alimente l agent d apprentissage.
 *
 * Apres chaque declaration de production, on compare :
 * - ce que la nomenclature prevoit
 * - ce que l operateur a reellement consomme
 *
 * L agent stocke cet ecart et l utilise pour les prochains OF.
 */

import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { enregistrerObservation } from "./apprentissage";

export async function declarerEtApprendre(params: {
  workOrderId: number;
  workOrderOperationId: number;
  employeeId: number;
  quantiteProduite: number;
  quantiteConforme: number;
  quantiteRebutee: number;
  quantiteReprise: number;
  matieresConsommees: Array<{
    componentItemId: number;
    quantiteConsommee: number;
    quantitePerdue: number;
  }>;
}) {
  // 1. Enregistrer la declaration (les actions existantes font deja ca)
  // Cette fonction est appelee EN SUPPLEMENT pour l apprentissage

  // 2. Lire la nomenclature pour comparer
  const of = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
    select: { itemId: true, quantityPlanned: true },
  });

  if (!of) return;

  const formule = await prisma.formula.findFirst({
    where: { itemId: of.itemId, status: "ACTIVE" },
    include: { lines: true },
    orderBy: { version: "desc" },
  });

  if (!formule) return;

  // 3. Pour chaque matiere consommee, enregistrer l observation
  for (const matiere of params.matieresConsommees) {
    const ligne = formule.lines.find(l => l.componentItemId === matiere.componentItemId);
    if (!ligne) continue;

    // Quantite planifiee pour cet OF
    const quantitePlanifiee = Number(ligne.quantity) * Number(of.quantityPlanned);

    // Quantite reelle consommee + perdue
    const quantiteReelle = matiere.quantiteConsommee + matiere.quantitePerdue;

    await enregistrerObservation({
      itemId: of.itemId,
      componentItemId: matiere.componentItemId,
      operationCode: "", // Sera remplace par l operation
      quantitePlanifiee,
      quantiteReelle,
      quantiteOF: Number(of.quantityPlanned),
      workOrderId: params.workOrderId,
      date: new Date(),
    });
  }
}
