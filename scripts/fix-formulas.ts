import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const formulas = await p.formula.findMany({ select: { id: true, code: true, status: true, itemId: true, item: { select: { code: true } } } });
  console.log("Formulas:", JSON.stringify(formulas, null, 2));

  // Activate formulas for CHCANADA, CHG021, CHG020
  for (const code of ["CHCANADA", "CHG 021", "000027"]) {
    const f = await p.formula.findFirst({ where: { code } });
    if (f && f.status !== "ACTIVE") {
      await p.formula.update({ where: { id: f.id }, data: { status: "ACTIVE", isDefault: true } });
      console.log(`Activated formula ${code} (was ${f.status})`);
    }
  }

  // Also try by item code
  for (const itemCode of ["CHCANADA", "CHG 021", "CHG020"]) {
    const item = await p.item.findFirst({ where: { code: itemCode } });
    if (!item) continue;
    const f = await p.formula.findFirst({ where: { itemId: item.id } });
    if (f && f.status !== "ACTIVE") {
      await p.formula.update({ where: { id: f.id }, data: { status: "ACTIVE", isDefault: true } });
      console.log(`Activated formula for ${itemCode} (was ${f.status})`);
    }
  }

  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
