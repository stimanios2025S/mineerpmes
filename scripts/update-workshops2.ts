import { PrismaClient, Factory } from "@prisma/client";
const p = new PrismaClient();

(async () => {
  // ADMEDCO workshops
  const admWorkshops = [
    { code: "ADM-A01", label: "A01 - Coupe avec centrage", factory: "ADMEDCO" as Factory, sortOrder: 1 },
    { code: "ADM-A02", label: "A02 - Coupe sans centrage", factory: "ADMEDCO" as Factory, sortOrder: 2 },
    { code: "ADM-A03", label: "A03 - Poudrage et emballage", factory: "ADMEDCO" as Factory, sortOrder: 3 },
  ];

  // MOBILIX workshops
  const mbxWorkshops = [
    { code: "MBX-A01", label: "A01 - Decoupe bois", factory: "MOBILIX" as Factory, sortOrder: 1 },
    { code: "MBX-A02", label: "A02 - Tapissage", factory: "MOBILIX" as Factory, sortOrder: 2 },
  ];

  for (const ws of [...admWorkshops, ...mbxWorkshops]) {
    const existing = await p.workshop.findFirst({ where: { code: ws.code } });
    if (existing) {
      await p.workshop.update({ where: { id: existing.id }, data: { label: ws.label, factory: ws.factory, sortOrder: ws.sortOrder } });
      console.log(`Updated: ${ws.factory} ${ws.code}`);
    } else {
      await p.workshop.create({ data: ws });
      console.log(`Created: ${ws.factory} ${ws.code}`);
    }
  }

  // Assign work centers
  const admA01 = await p.workshop.findFirst({ where: { code: "ADM-A01" } });
  const admA02 = await p.workshop.findFirst({ where: { code: "ADM-A02" } });
  const admA03 = await p.workshop.findFirst({ where: { code: "ADM-A03" } });
  const mbxA01 = await p.workshop.findFirst({ where: { code: "MBX-A01" } });
  const mbxA02 = await p.workshop.findFirst({ where: { code: "MBX-A02" } });

  const wcMap: Record<string, any> = {
    "PT-COUPE": admA01,
    "PT-USINAGE": admA02,
    "PT-SOUDAGE": admA02,
    "PT-MEULAGE": admA03,
    "PT-VISSAGE": admA03,
    "PT-POUDRAGE": admA03,
    "PT-MBX-PREP-TEXTILE": mbxA02,
    "PT-MBX-COUPE-TISSU": mbxA02,
    "PT-MBX-COUTURE": mbxA02,
    "PT-MBX-PREP-BOIS": mbxA01,
    "PT-MBX-USINAGE-BOIS": mbxA01,
    "PT-MBX-INSERTS": mbxA01,
    "PT-MBX-CAPITONNAGE": mbxA02,
    "PT-MBX-ACCOUDOIRS": mbxA02,
    "PT-MBX-ASSEMBLAGE": mbxA02,
    "PT-MBX-CQ-FINAL": mbxA02,
    "PT-MBX-EMBALLAGE": mbxA02,
    "PT-MBX-EXPEDITION": mbxA02,
  };

  for (const [wcCode, workshop] of Object.entries(wcMap)) {
    const wc = await p.workCenter.findFirst({ where: { code: wcCode } });
    if (wc && workshop) {
      await p.workCenter.update({ where: { id: wc.id }, data: { workshopId: workshop.id } });
      console.log(`${wcCode} -> ${workshop.code}`);
    }
  }

  // Summary
  const workshops = await p.workshop.findMany({ orderBy: [{ factory: "asc" }, { sortOrder: "asc" }] });
  console.log("\n=== FINAL WORKSHOPS ===");
  for (const w of workshops) {
    const wcCount = await p.workCenter.count({ where: { workshopId: w.id } });
    console.log(`${w.factory} | ${w.code} | ${w.label} | ${wcCount} postes`);
  }

  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
