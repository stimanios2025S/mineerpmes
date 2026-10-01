import fs from "fs";

// Fix consommation.ts
const consFile = "C:/Users/stimanios/Documents/ERPMES/src/lib/mes/consommation.ts";
let cons = fs.readFileSync(consFile, "utf8");

// Replace the StockMovement.create block in consommation.ts
cons = cons.replace(
  `        // 3. Enregistrer le mouvement de stock
        await prisma.stockMovement.create({
          data: {
            itemId: matiere.componentItemId,
            warehouseId: ligne.warehouseId,
            type: "SORTIE_PRODUCTION",
            quantity: D.neg(totalRetire),
            unitCost: ligne.unitCost,
            workOrderId: decl.workOrderId,
            reference: \`Consommation operation \${decl.operationCode}\`,
          },
        });`,
  `        // 3. Enregistrer le mouvement de stock
        const mouvementCount = await prisma.stockMovement.count();
        await prisma.stockMovement.create({
          data: {
            number: \`SM-\${Date.now()}-\${mouvementCount}\`,
            itemId: matiere.componentItemId,
            warehouseId: ligne.warehouseId,
            type: "SORTIE_PRODUCTION",
            quantity: D.neg(totalRetire),
            unitCost: ligne.unitCost,
            totalCost: D.mul(totalRetire, ligne.unitCost),
            workOrderId: decl.workOrderId,
            documentType: \`Consommation \${decl.operationCode}\`,
          },
        });`,
);

// Fix the balance create block - remove lotId reference
cons = cons.replace(
  `        const key = \`\${item.itemId}:\${sousStock.warehouseId}:\${sousStock.locationId ?? "null"}:\${balance?.lotId ?? "null"}:LIBRE\`;`,
  `        const key = \`\${item.itemId}:\${sousStock.warehouseId}:\${sousStock.locationId ?? "null"}:LIBRE\`;`,
);

fs.writeFileSync(consFile, cons, "utf8");
console.log("consommation.ts fixed");

// Fix reservation.ts
const resFile = "C:/Users/stimanios/Documents/ERPMES/src/lib/mes/reservation.ts";
let res = fs.readFileSync(resFile, "utf8");

// Remove warehouse from include in reservation.ts
res = res.replace(
  `    include: {
      componentItem: { select: { code: true, label1: true, unitCode: true } },
      warehouse: { select: { code: true, label: true } },
    },`,
  `    include: {
      componentItem: { select: { code: true, label1: true, unitCode: true } },
    },`,
);

// Fix StockMovement.create in reservation.ts
res = res.replace(
  `    // Enregistrer le mouvement
    await prisma.stockMovement.create({
      data: {
        itemId: ligne.componentItemId,
        warehouseId: ligne.warehouseId,
        type: "SORTIE_PRODUCTION",
        quantity: D.neg(quantiteSortie),
        unitCost: ligne.unitCost,
        totalValue: D.mul(quantiteSortie, ligne.unitCost),
        workOrderId: ligne.workOrderId,
        reference: \`OF sorti pour production\`,
      },
    });`,
  `    // Enregistrer le mouvement
    const smCount = await prisma.stockMovement.count();
    await prisma.stockMovement.create({
      data: {
        number: \`SM-\${Date.now()}-\${smCount}\`,
        itemId: ligne.componentItemId,
        warehouseId: ligne.warehouseId,
        type: "SORTIE_PRODUCTION",
        quantity: D.neg(quantiteSortie),
        unitCost: ligne.unitCost,
        totalCost: D.mul(quantiteSortie, ligne.unitCost),
        workOrderId: ligne.workOrderId,
        documentType: "Sortie pour production",
      },
    });`,
);

fs.writeFileSync(resFile, res, "utf8");
console.log("reservation.ts fixed");

console.log("\nDone");
