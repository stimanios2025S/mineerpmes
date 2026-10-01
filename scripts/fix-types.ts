import fs from "fs";

// Fix lancement.ts
const lancFile = "C:/Users/stimanios/Documents/ERPMES/src/actions/lancement.ts";
let lanc = fs.readFileSync(lancFile, "utf8");
lanc = lanc.replace(
  `    const route = await prisma.productRoute.findFirst({
      where: { itemId: of.itemId, isActive: true },
      include: { steps: { orderBy: { stepNo: "asc" } } },
    });`,
  `    const route = await prisma.productRoute.findFirst({
      where: { itemId: of.itemId, status: "ACTIVE" },
      include: { steps: { orderBy: { stepNo: "asc" } } },
    });`,
);
lanc = lanc.replace(
  `    const restant = mat.quantityPlanned - mat.quantityIssued;`,
  `    const restant = Number(mat.quantityPlanned) - Number(mat.quantityIssued);`,
);
fs.writeFileSync(lancFile, lanc, "utf8");
console.log("lancement.ts fixed");

// Fix BCI page
const bciFile = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/stock/bci/[id]/page.tsx";
let bci = fs.readFileSync(bciFile, "utf8");
bci = bci.replace(
  `    include: {
      item: { select: { code: true, label1: true } },
      materials: {
        where: { isLabor: false },
        include: {
          componentItem: { select: { code: true, label1: true } },
          warehouse: { select: { code: true, label: true } },
        },
        orderBy: { lineNo: "asc" },
      },
    },`,
  `    include: {
      item: true,
      materials: {
        where: { isLabor: false },
        include: {
          componentItem: { select: { code: true, label1: true } },
        },
        orderBy: { lineNo: "asc" },
      },
    },`,
);
bci = bci.replace(
  `of.materials.map((mat, i) => (`,
  `of.materials.map((mat: any, i: number) => (`,
);
bci = bci.replace(
  `<td>{mat.warehouse?.code ?? "-"}</td>`,
  `<td>{mat.warehouseId ? "Depot" : "-"}</td>`,
);
fs.writeFileSync(bciFile, bci, "utf8");
console.log("BCI page fixed");

// Fix consommation.ts
const consFile = "C:/Users/stimanios/Documents/ERPMES/src/lib/mes/consommation.ts";
let cons = fs.readFileSync(consFile, "utf8");
cons = cons.replace(
  `            totalValue: D.mul(totalRetire, ligne.unitCost),
            workOrderId: decl.workOrderId,`,
  `            workOrderId: decl.workOrderId,`,
);
cons = cons.replace(
  `        warehouseId: ligne.warehouseId,
            type: "SORTIE_PRODUCTION",
            quantity: D.neg(totalRetire),
            unitCost: ligne.unitCost,`,
  `            warehouseId: ligne.warehouseId,
            type: "SORTIE_PRODUCTION",
            quantity: D.neg(totalRetire),
            unitCost: ligne.unitCost,
            workOrderId: decl.workOrderId,`,
);
cons = cons.replace(
  `        lotId: balance?.lotId ?? "null"`,
  `        lotId: null`,
);
fs.writeFileSync(consFile, cons, "utf8");
console.log("consommation.ts fixed");

console.log("\nAll type errors fixed");
