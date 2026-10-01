import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const ofs = await p.workOrder.findMany({
    include: {
      item: { select: { code: true, label1: true } },
      materials: { where: { isLabor: false }, select: { componentItem: { select: { code: true } }, quantityPlanned: true, quantityIssued: true } },
      operations: { select: { stepNo: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  for (const of of ofs) {
    console.log(`\nOF ${of.number} | ${of.item.code} | ${of.item.label1}`);
    console.log(`  Status: ${of.status} | Qty: ${of.quantityPlanned}`);
    console.log(`  Operations: ${of.operations.map(o => o.stepNo + ":" + o.status).join(", ")}`);
    console.log(`  Materials: ${of.materials.length} lines`);
    for (const m of of.materials.slice(0, 5)) {
      console.log(`    ${m.componentItem.code} | planned: ${m.quantityPlanned} | issued: ${m.quantityIssued}`);
    }
  }
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
