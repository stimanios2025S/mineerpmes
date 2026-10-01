import { PrismaClient, Factory } from "@prisma/client";
const p = new PrismaClient();

(async () => {
  // 1. Create routes for producible items
  const items = await p.item.findMany({ where: { isProducible: true }, select: { id: true, code: true } });
  const ops = await p.operation.findMany({ select: { id: true, code: true, factory: true } });

  const routeMap: Record<string, string[]> = {
    CHCANADA: ["COUPE", "USINAGE", "SOUDAGE", "MEULAGE", "VISSAGE", "POUDRAGE"],
    CHG021: ["COUPE", "USINAGE", "SOUDAGE", "MEULAGE", "VISSAGE", "POUDRAGE"],
    CHG020: ["COUPE", "USINAGE", "SOUDAGE", "MEULAGE", "VISSAGE", "POUDRAGE"],
  };

  for (const item of items) {
    const opCodes = routeMap[item.code];
    if (!opCodes) continue;

    const existing = await p.productRoute.findFirst({ where: { itemId: item.id, status: "ACTIVE" } });
    if (existing) { console.log(`Route exists for ${item.code}`); continue; }

    const route = await p.productRoute.create({
      data: {
        code: `ROUTE-${item.code}`,
        label: `Route de production ${item.code}`,
        itemId: item.id,
        factory: "ADMEDCO" as Factory,
        status: "ACTIVE",
      },
    });

    for (let i = 0; i < opCodes.length; i++) {
      const op = ops.find(o => o.code === opCodes[i] && o.factory === "ADMEDCO");
      if (!op) { console.log(`  Op ${opCodes[i]} not found`); continue; }
      const wc = await p.workCenter.findFirst({ where: { operationId: op.id } });
      await p.routeStep.create({
        data: {
          routeId: route.id,
          stepNo: i + 1,
          operationId: op.id,
          workCenterId: wc?.id ?? null,
          description: opCodes[i],
        },
      });
    }
    console.log(`Route created for ${item.code}: ${opCodes.join(" -> ")}`);
  }

  // 2. Ensure OF-2026-001 has materials (if not, create them)
  const of1 = await p.workOrder.findFirst({ where: { number: "OF-2026-001" } });
  if (of1) {
    const matCount = await p.workOrderMaterial.count({ where: { workOrderId: of1.id } });
    if (matCount === 0) {
      console.log("Creating materials for OF-2026-001...");
      const { reserverStockPourOF } = await import("../src/lib/mes/reservation");
      const lignes = await reserverStockPourOF(of1.id);
      console.log(`  ${lignes.length} materials reserved`);
    } else {
      console.log(`OF-2026-001 already has ${matCount} materials`);
    }
  }

  await p.$disconnect();
  console.log("\nDone!");
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
