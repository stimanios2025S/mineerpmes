/**
 * Connexion entre les declarations operateur et le stock reel.
 *
 * Quand un operateur declare :
 * 1. Il recoit des MP (magasinier les a sortis)
 * 2. Il consomme X dans l operation
 * 3. Il produit Y bonnes pieces + Z perdues
 * 4. Le systeme met a jour WorkOrderMaterial et StockBalance
 *
 * La declaration ne bouge PAS le stock imm�diatement :
 * elle passe par un circuit de validation du responsable.
 * Quand le responsable valide :
 * - Le stock reel est ajuste
 * - Les WorkOrderMaterial sont mis a jour
 * - Les pertes sont enregistrees dans l historique
 */

import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import type { Decimal } from "@prisma/client/runtime/library";

export interface DeclarationConsommation {
  workOrderId: number;
  workOrderOperationId: number;
  employeeId: number;
  operationCode: string;
  // Ce que l operateur recoit du depot
  matieresRecues: Array<{
    componentItemId: number;
    quantiteRecue: Decimal;
  }>;
  // Ce qu il consomme reellement
  matieresConsommees: Array<{
    componentItemId: number;
    quantiteConsommee: Decimal;
    quantitePerdue: Decimal;
  }>;
  // Ce qu il produit
  quantiteProduite: Decimal;
  quantiteConforme: Decimal;
  quantiteRebutee: Decimal;
  quantiteReprise: Decimal;
}

/**
 * Enregistre la declaration de consommation d un operateur.
 * Cette fonction est appelee par les actions serveur du portail.
 */
export async function enregistrerConsommation(
  decl: DeclarationConsommation,
): Promise<{ succes: boolean; message: string }> {
  // 1. Mettre a jour les lignes WorkOrderMaterial pour chaque matiere
  for (const matiere of decl.matieresConsommees) {
    const ligne = await prisma.workOrderMaterial.findFirst({
      where: {
        workOrderId: decl.workOrderId,
        componentItemId: matiere.componentItemId,
        isLabor: false,
      },
    });

    if (!ligne) {
      console.warn(`WorkOrderMaterial introuvable pour article ${matiere.componentItemId}`);
      continue;
    }

    // Ajouter la consommation declaree
    const nouvelleConsommee = D.add(ligne.quantityConsumed, matiere.quantiteConsommee);
    const nouvellePerdue = D.add(ligne.quantityLost, matiere.quantitePerdue);

    await prisma.workOrderMaterial.update({
      where: { id: ligne.id },
      data: {
        quantityConsumed: nouvelleConsommee,
        quantityLost: nouvellePerdue,
      },
    });

    // 2. Ajuster le stock reel
    if (ligne.warehouseId) {
      const balance = await prisma.stockBalance.findFirst({
        where: {
          itemId: matiere.componentItemId,
          warehouseId: ligne.warehouseId,
        },
      });

      if (balance) {
        // Retirer du stock physique la quantite consommee + perdue
        const totalRetire = D.add(matiere.quantiteConsommee, matiere.quantitePerdue);
        const nouveauPhysique = D.sub(balance.quantityPhysical, totalRetire);
        const nouvelleReserve = D.sub(balance.quantityReserved, totalRetire);

        await prisma.stockBalance.update({
          where: { id: balance.id },
          data: {
            quantityPhysical: D.max(nouveauPhysique, D.of(0)),
            quantityReserved: D.max(nouvelleReserve, D.of(0)),
          },
        });

        // 3. Enregistrer le mouvement de stock
        const smCount = await prisma.stockMovement.count();
        await prisma.stockMovement.create({
          data: {
            number: "SM-" + Date.now() + "-" + smCount,
            itemId: matiere.componentItemId,
                warehouseId: ligne.warehouseId,
            type: "SORTIE_PRODUCTION",
            quantity: D.neg(totalRetire),
            unitCost: ligne.unitCost,
            workOrderId: decl.workOrderId,
            documentType: `Consommation operation ${decl.operationCode}`,
          },
        });
      }
    }
  }

  // 4. Mettre a jour la quantite produite sur l operation
  const operation = await prisma.workOrderOperation.findUnique({
    where: { id: decl.workOrderOperationId },
  });

  if (operation) {
    await prisma.workOrderOperation.update({
      where: { id: decl.workOrderOperationId },
      data: {
        quantityProduced: D.add(operation.quantityProduced, decl.quantiteProduite),
        quantityConform: D.add(operation.quantityConform, decl.quantiteConforme),
        quantityScrapped: D.add(operation.quantityScrapped, decl.quantiteRebutee),
        quantityRework: D.add(operation.quantityRework, decl.quantiteReprise),
      },
    });
  }

  // 5. Mettre a jour l OF
  const of = await prisma.workOrder.findUnique({ where: { id: decl.workOrderId } });
  if (of) {
    const totalProduit = D.add(of.quantityProduced, decl.quantiteProduite);
    const totalConforme = D.add(of.quantityConform, decl.quantiteConforme);
    const totalRebut = D.add(of.quantityScrapped, decl.quantiteRebutee);
    const totalReprise = D.add(of.quantityRework, decl.quantiteReprise);
    const reste = D.sub(of.quantityPlanned, totalConforme);

    await prisma.workOrder.update({
      where: { id: decl.workOrderId },
      data: {
        quantityProduced: totalProduit,
        quantityConform: totalConforme,
        quantityScrapped: totalRebut,
        quantityRework: totalReprise,
        quantityRemaining: D.max(reste, D.of(0)),
      },
    });
  }

  // 6. Mettre a jour le sous-stock de l etape
  const sousStock = await prisma.operationSubStock.findFirst({
    where: {
      operationId: operation?.operationId ?? 0,
    },
  });

  if (sousStock) {
    // Ajouter la production conforme au sous-stock
    const balance = await prisma.stockBalance.findFirst({
      where: {
        itemId: operation ? (await prisma.workOrder.findUnique({ where: { id: decl.workOrderId }, select: { itemId: true } }))?.itemId ?? 0 : 0,
        warehouseId: sousStock.warehouseId,
        locationId: sousStock.locationId ?? null,
      },
    });

    if (balance) {
      await prisma.stockBalance.update({
        where: { id: balance.id },
        data: {
          quantityPhysical: D.add(balance.quantityPhysical, decl.quantiteConforme),
        },
      });
    } else {
      // Creer une nouvelle balance
      const item = await prisma.workOrder.findUnique({ where: { id: decl.workOrderId }, select: { itemId: true } });
      if (item) {
        const key = `${item.itemId}:${sousStock.warehouseId}:${sousStock.locationId ?? "null"}:LIBRE`;
        await prisma.stockBalance.create({
          data: {
            balanceKey: key,
            itemId: item.itemId,
            warehouseId: sousStock.warehouseId,
            locationId: sousStock.locationId,
            status: "LIBRE",
            quantityPhysical: decl.quantiteConforme,
          },
        });
      }
    }
  }

  return {
    succes: true,
    message: `Consommation enregistree : ${decl.matieresConsommees.length} matieres, ${decl.quantiteConforme} pieces conformes.`,
  };
}
