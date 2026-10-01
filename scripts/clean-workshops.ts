import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

(async () => {
  // Remove old/duplicate workshops that have no work centers
  const oldCodes = ["A01", "A02", "A03", "ATL-ADM", "ATL-MBX-PREP", "ATL-MBX-COUT", "ATL-MBX-CAP", "ATL-MBX-ASS"];
  for (const code of oldCodes) {
    const ws = await p.workshop.findFirst({ where: { code } });
    if (ws) {
      const wcCount = await p.workCenter.count({ where: { workshopId: ws.id } });
      if (wcCount === 0) {
        await p.workshop.delete({ where: { id: ws.id } });
        console.log(`Deleted: ${code}`);
      } else {
        console.log(`Kept: ${code} (${wcCount} work centers)`);
      }
    }
  }

  // Final list
  const workshops = await p.workshop.findMany({ orderBy: [{ factory: "asc" }, { sortOrder: "asc" }] });
  console.log("\n=== FINAL WORKSHOPS ===");
  for (const w of workshops) {
    const wcCount = await p.workCenter.count({ where: { workshopId: w.id } });
    console.log(`${w.factory} | ${w.code} | ${w.label} | ${wcCount} postes`);
  }

  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
