/**
 * Reservation intelligente de matieres premieres.
 *
 * Quand le proprietaire cree un OF :
 * 1. Le systeme lit la nomenclature (Formula + FormulaLine)
 * 2. Il calcule la quantite requise = qty_BOM * qty_OF * (1 + lossRate)
 * 3. Il reserve la quantite dans le stock (quantityReserved += reserved)
 * 4. Il cree les lignes WorkOrderMaterial avec quantities planifiees
 * 5. Il genere un PDF "Bon de Commande Interne" pour le magasinier
 *
 * Quand l'operateur declare sa consommation :
 * 1. Le systeme retire du stock la quantite reellement utilisee
 * 2. Il met a jour la WorkOrderMaterial (quantityConsumed, quantityLost)
 * 3. Il libere la reservation pour la partie non utilisee
 */

import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";

export interface LigneReservation {
  articleId: number;
  articleCode: string;
  articleLabel: string;
  unite: string | null;
  quantiteRequise: Decimal;
  quantiteReservee: Decimal;
  quantiteDisponible: Decimal;
  depotCode: string;
  operationCode: string | null;
}

/**
 * Calcule les besoins en matieres pour un OF et reserve le stock.
 */
export async function reserverStockPourOF(
  workOrderId: number,
): Promise<LigneReservation[]> {
  const of = await prisma.workOrder.findUniqueOrThrow({
    where: { id: workOrderId },
    include: {
      item: { select: { id: true, code: true, label1: true } },
    },
  });

  // Trouver la formule active pour cet article
  const formule = await prisma.formula.findFirst({
    where: {
      itemId: of.itemId,
      status: "ACTIVE",
    },
    include: {
      lines: {
        include: {
          componentItem: { select: { id: true, code: true, label1: true, isMainOeuvre: true, type: true } },
          unit: { select: { code: true } },
        },
        orderBy: { lineNo: "asc" },
      },
    },
    orderBy: { version: "desc" },
  });

  if (!formule) {
    throw new Error(
      `Aucune formule active pour l'article ${of.item.code}. Creez ou validez une formule avant de lancer l'OF.`,
    );
  }

  const lignes: LigneReservation[] = [];
  const quantiteOF = D.of(of.quantityPlanned);

  for (const ligne of formule.lines) {
    // La classification metier fait foi : MDF est une matiere, pas de la main d'oeuvre.
    if (
      ligne.isLabor ||
      ligne.componentItem.isMainOeuvre ||
      ligne.componentItem.type === "MAIN_OEUVRE"
    ) {
      continue;
    }

    // Calculer la quantite requise avec marge de perte
    const qtyBase = D.mul(ligne.quantity, quantiteOF);
    const perte = D.mul(qtyBase, D.div(ligne.lossRate, D.of(100)));
    const quantiteRequise = D.add(qtyBase, perte);

    // Chercher le stock disponible pour cet article
    const depot = await prisma.warehouse.findFirst({
      where: { factory: of.factory },
      orderBy: { id: "asc" },
    });

    let quantiteDisponible = D.of(0);
    if (depot) {
      const balance = await prisma.stockBalance.findFirst({
        where: {
          itemId: ligne.componentItemId,
          warehouseId: depot.id,
        },
      });
      if (balance) {
        quantiteDisponible = D.sub(
          balance.quantityPhysical,
          balance.quantityReserved,
        );
      }
    }

    const quantiteReservee = D.min(quantiteRequise, quantiteDisponible);

    // Reserver dans le stock
    if (depot && D.gt(quantiteReservee, D.of(0))) {
      const existingBalance = await prisma.stockBalance.findFirst({
        where: {
          itemId: ligne.componentItemId,
          warehouseId: depot.id,
        },
      });

      if (existingBalance) {
        await prisma.stockBalance.update({
          where: { id: existingBalance.id },
          data: {
            quantityReserved: D.add(
              existingBalance.quantityReserved,
              quantiteReservee,
            ),
          },
        });
      }
    }

    // Creer la ligne WorkOrderMaterial
    await prisma.workOrderMaterial.create({
      data: {
        workOrderId: workOrderId,
        componentItemId: ligne.componentItemId,
        lineNo: ligne.lineNo,
        quantityPlanned: quantiteRequise,
        quantityIssued: D.of(0),
        quantityConsumed: D.of(0),
        quantityLost: D.of(0),
        quantityReturned: D.of(0),
        unitCode: ligne.unit?.code ?? null,
        lossRate: ligne.lossRate,
        warehouseId: depot?.id ?? null,
        isLabor: false,
      },
    });

    lignes.push({
      articleId: ligne.componentItemId,
      articleCode: ligne.componentItem.code,
      articleLabel: ligne.componentItem.label1,
      unite: ligne.unit?.code ?? "UN",
      quantiteRequise,
      quantiteReservee,
      quantiteDisponible,
      depotCode: depot?.code ?? "?",
      operationCode: ligne.operationCode,
    });
  }

  return lignes;
}

/**
 * Retourne les lignes de matieres d'un OF pour le magasinier.
 */
export async function lignesBCInterne(workOrderId: number) {
  return prisma.workOrderMaterial.findMany({
    where: {
      workOrderId,
      isLabor: false,
    },
    include: {
      componentItem: { select: { code: true, label1: true, unitCode: true } },
    },
    orderBy: { lineNo: "asc" },
  });
}

/**
 * Le magasinier confirme la sortie de stock.
 * quantityIssued = quantite physiquement sortie du depot.
 */
export async function validerSortieStock(
  workOrderMaterialId: number,
  quantiteSortie: Decimal,
) {
  const ligne = await prisma.workOrderMaterial.findUniqueOrThrow({
    where: { id: workOrderMaterialId },
  });

  // Creer un mouvement de stock (sortie pour production)
  if (ligne.warehouseId) {
    const balance = await prisma.stockBalance.findFirst({
      where: {
        itemId: ligne.componentItemId,
        warehouseId: ligne.warehouseId,
      },
    });

    if (balance) {
      await prisma.stockBalance.update({
        where: { id: balance.id },
        data: {
          quantityPhysical: D.sub(balance.quantityPhysical, quantiteSortie),
          quantityReserved: D.sub(balance.quantityReserved, quantiteSortie),
        },
      });
    }

    // Enregistrer le mouvement
    const smCount = await prisma.stockMovement.count();
    await prisma.stockMovement.create({
      data: {
        number: `SM-${Date.now()}-${smCount}`,
        itemId: ligne.componentItemId,
        warehouseId: ligne.warehouseId,
        type: "SORTIE_PRODUCTION",
        quantity: D.neg(quantiteSortie),
        unitCost: ligne.unitCost,
        totalCost: D.mul(quantiteSortie, ligne.unitCost),
        workOrderId: ligne.workOrderId,
        documentType: "Sortie pour production",
      },
    });
  }

  // Mettre a jour la ligne
  await prisma.workOrderMaterial.update({
    where: { id: workOrderMaterialId },
    data: { quantityIssued: quantiteSortie },
  });
}

/**
 * Libere les reservations non utilisees quand l'OF est termine.
 */
export async function libererReservations(workOrderId: number) {
  const materials = await prisma.workOrderMaterial.findMany({
    where: { workOrderId, isLabor: false },
  });

  for (const mat of materials) {
    if (!mat.warehouseId) continue;
    const nonUtilise = D.sub(mat.quantityIssued, D.add(mat.quantityConsumed, mat.quantityLost));
    if (D.lte(nonUtilise, D.of(0))) continue;

    const balance = await prisma.stockBalance.findFirst({
      where: { itemId: mat.componentItemId, warehouseId: mat.warehouseId },
    });
    if (balance) {
      await prisma.stockBalance.update({
        where: { id: balance.id },
        data: { quantityReserved: D.sub(balance.quantityReserved, nonUtilise) },
      });
    }
  }
}
