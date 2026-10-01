/**
 * Agent d apprentissage pour les DEUX usines.
 *
 * ADMEDCO apprend de ses propres OF et MOBILIX apprend des siens.
 * Le systeme applique la meme logique aux deux divisions.
 */

import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";

export async function enregistrerObservation(
  obs: {
    itemId: number;
    componentItemId: number;
    operationCode: string;
    quantitePlanifiee: number;
    quantiteReelle: number;
    quantiteOF: number;
    workOrderId: number;
    date: Date;
    factory: string;
  },
): Promise<void> {
  if (obs.quantitePlanifiee === 0) return;
  const ratio = obs.quantiteReelle / obs.quantitePlanifiee;

  await prisma.formulaVariance.create({
    data: {
      formulaId: 0,
      formulaLineId: null,
      componentItemId: obs.componentItemId,
      lineNo: null,
      sourceA: `NOMENCLATURE_${obs.factory}`,
      valueA: String(obs.quantitePlanifiee),
      sourceB: `REALITE_${obs.factory}`,
      valueB: String(obs.quantiteReelle),
      delta: String(ratio),
      status: "RESOLU",
      resolutionNote: `OF ${obs.workOrderId} - ${obs.operationCode} - ${obs.factory} - ${obs.date.toISOString()}`,
    },
  });
}

export async function quantiteProposee(
  itemId: number,
  componentItemId: number,
  operationCode: string | null,
  quantiteOF: number,
  factory: string,
): Promise<{
  quantiteNomenclature: number;
  quantiteProposee: number;
  ratioAppris: number;
  nombreObservations: number;
  confiance: string;
}> {
  const formule = await prisma.formula.findFirst({
    where: { itemId, status: "ACTIVE" },
    include: { lines: { where: { componentItemId } } },
  });

  const ligne = formule?.lines[0];
  const quantiteNomenclature = ligne ? Number(ligne.quantity) * quantiteOF : 0;

  // Chercher les observations pour CETTE usine
  const observations = await prisma.formulaVariance.findMany({
    where: {
      componentItemId,
      sourceB: `REALITE_${factory}`,
    },
  });

  if (observations.length === 0) {
    return {
      quantiteNomenclature,
      quantiteProposee: quantiteNomenclature,
      ratioAppris: 1.0,
      nombreObservations: 0,
      confiance: "aucune",
    };
  }

  const ratios = observations.map(o => {
    const a = parseFloat(o.valueA || "0");
    const b = parseFloat(o.valueB || "0");
    return a > 0 ? b / a : 1.0;
  });

  const ratioMoyen = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const ratioLimite = Math.max(0.8, Math.min(1.2, ratioMoyen));
  const quantiteProposee = quantiteNomenclature * ratioLimite;

  let confiance = "faible";
  if (observations.length >= 10) confiance = "forte";
  else if (observations.length >= 3) confiance = "moyenne";

  return {
    quantiteNomenclature,
    quantiteProposee,
    ratioAppris: ratioLimite,
    nombreObservations: observations.length,
    confiance,
  };
}

export async function calculerBesoinsIntelligents(
  itemId: number,
  quantiteOF: number,
  factory: string,
): Promise<Array<{
  articleId: number;
  articleCode: string;
  articleLabel: string;
  unite: string | null;
  quantiteNomenclature: number;
  quantiteProposee: number;
  quantiteStockDisponible: number;
  quantiteAReserver: number;
  ratioAppris: number;
  confiance: string;
  operationCode: string | null;
}>> {
  const formule = await prisma.formula.findFirst({
    where: { itemId, status: "ACTIVE" },
    include: {
      lines: {
        include: { componentItem: { select: { id: true, code: true, label1: true } } },
        orderBy: { lineNo: "asc" },
      },
    },
    orderBy: { version: "desc" },
  });

  if (!formule) return [];

  const depot = await prisma.warehouse.findFirst({
    where: { factory: factory as any },
    orderBy: { id: "asc" },
  });

  const resultats = [];

  for (const ligne of formule.lines) {
    const code = ligne.componentItem.code;
    if (code.startsWith("MD") || code.includes("MAIN D'OEUVRE")) continue;

    const apprentissage = await quantiteProposee(
      itemId,
      ligne.componentItemId,
      ligne.operationCode,
      quantiteOF,
      factory,
    );

    let stockDisponible = 0;
    if (depot) {
      const balance = await prisma.stockBalance.findFirst({
        where: { itemId: ligne.componentItemId, warehouseId: depot.id },
      });
      if (balance) {
        stockDisponible = Number(D.sub(balance.quantityPhysical, balance.quantityReserved));
      }
    }

    const quantiteAReserver = Math.min(apprentissage.quantiteProposee, stockDisponible);

    resultats.push({
      articleId: ligne.componentItemId,
      articleCode: code,
      articleLabel: ligne.componentItem.label1,
      unite: ligne.unitCode ?? "UN",
      quantiteNomenclature: apprentissage.quantiteNomenclature,
      quantiteProposee: apprentissage.quantiteProposee,
      quantiteStockDisponible: stockDisponible,
      quantiteAReserver,
      ratioAppris: apprentissage.ratioAppris,
      confiance: apprentissage.confiance,
      operationCode: ligne.operationCode,
    });
  }

  return resultats;
}
