import { PrismaClient, Factory } from "@prisma/client";
const p = new PrismaClient();

(async () => {
  // ADMEDCO: 3 ateliers
  // A01: Coupe avec centrage
  // A02: Coupe sans centrage (en parallele avec A01)
  // A03: Poudrage et emballage (apres A01 et A02)

  const admWorkshops = [
    { code: "A01", label: "A01 — Coupe avec centrage", factory: "ADMEDCO" as Factory, sortOrder: 1 },
    { code: "A02", label: "A02 — Coupe sans centrage", factory: "ADMEDCO" as Factory, sortOrder: 2 },
    { code: "A03", label: "A03 — Poudrage et emballage", factory: "ADMEDCO" as Factory, sortOrder: 3 },
  ];

  // MOBILIX: 2 ateliers
  // A01: Decoupe bois
  // A02: Tapissage
  const mbxWorkshops = [
    { code: "A01", label: "A01 — Decoupe bois", factory: "MOBILIX" as Factory, sortOrder: 1 },
    { code: "A02", label: "A02 — Tapissage", factory: "MOBILIX" as Factory, sortOrder: 2 },
  ];

  // Delete old workshops (they'll be replaced)
  const oldWorkshops = await p.workshop.findMany();
  console.log("Old workshops:", oldWorkshops.map(w => `${w.code} (${w.factory})`).join(", "));

  // Create new ADMEDCO workshops
  for (const ws of admWorkshops) {
    const existing = await p.workshop.findFirst({ where: { code: ws.code, factory: ws.factory } });
    if (existing) {
      await p.workshop.update({ where: { id: existing.id }, data: { label: ws.label, sortOrder: ws.sortOrder } });
      console.log(`Updated: ${ws.factory} ${ws.code} — ${ws.label}`);
    } else {
      await p.workshop.create({ data: ws });
      console.log(`Created: ${ws.factory} ${ws.code} — ${ws.label}`);
    }
  }

  // Create new MOBILIX workshops
  for (const ws of mbxWorkshops) {
    const existing = await p.workshop.findFirst({ where: { code: ws.code, factory: ws.factory } });
    if (existing) {
      await p.workshop.update({ where: { id: existing.id }, data: { label: ws.label, sortOrder: ws.sortOrder } });
      console.log(`Updated: ${ws.factory} ${ws.code} — ${ws.label}`);
    } else {
      await p.workshop.create({ data: ws });
      console.log(`Created: ${ws.factory} ${ws.code} — ${ws.label}`);
    }
  }

  // Update work centers to reference the new workshops
  // ADMEDCO work centers
  const admWCs = await p.workCenter.findMany({ where: { factory: "ADMEDCO" } });
  const a01 = await p.workshop.findFirst({ where: { code: "A01", factory: "ADMEDCO" } });
  const a02 = await p.workshop.findFirst({ where: { code: "A02", factory: "ADMEDCO" } });
  const a03 = await p.workshop.findFirst({ where: { code: "A03", factory: "ADMEDCO" } });

  for (const wc of admWCs) {
    if (wc.code.includes("COUPE") || wc.code.includes("USINAGE") || wc.code.includes("SOUDAGE") || wc.code.includes("MEULAGE") || wc.code.includes("VISSAGE")) {
      // Coupe-related goes to A01 or A02
      if (wc.code === "PT-COUPE") {
        await p.workCenter.update({ where: { id: wc.id }, data: { workshopId: a01?.id ?? null } });
        console.log(`WC ${wc.code} -> A01 (Coupe avec centrage)`);
      } else if (wc.code === "PT-USINAGE") {
        await p.workCenter.update({ where: { id: wc.id }, data: { workshopId: a02?.id ?? null } });
        console.log(`WC ${wc.code} -> A02 (Coupe sans centrage)`);
      }
    } else if (wc.code === "PT-POUDRAGE") {
      await p.workCenter.update({ where: { id: wc.id }, data: { workshopId: a03?.id ?? null } });
      console.log(`WC ${wc.code} -> A03 (Poudrage et emballage)`);
    }
  }

  // MOBILIX work centers
  const mbxWCs = await p.workCenter.findMany({ where: { factory: "MOBILIX" } });
  const m01 = await p.workshop.findFirst({ where: { code: "A01", factory: "MOBILIX" } });
  const m02 = await p.workshop.findFirst({ where: { code: "A02", factory: "MOBILIX" } });

  for (const wc of mbxWCs) {
    if (wc.code.includes("PREP-BOIS") || wc.code.includes("USINAGE-BOIS") || wc.code.includes("INSERTS")) {
      await p.workCenter.update({ where: { id: wc.id }, data: { workshopId: m01?.id ?? null } });
      console.log(`WC ${wc.code} -> A01 (Decoupe bois)`);
    } else if (wc.code.includes("COUTURE") || wc.code.includes("CAPITONNAGE") || wc.code.includes("ACCOUDOIRS") || wc.code.includes("ASSEMBLAGE") || wc.code.includes("EMBALLAGE") || wc.code.includes("CQ-FINAL") || wc.code.includes("EXPEDITION") || wc.code.includes("PREP-TEXTILE") || wc.code.includes("COUPE-TISSU")) {
      await p.workCenter.update({ where: { id: wc.id }, data: { workshopId: m02?.id ?? null } });
      console.log(`WC ${wc.code} -> A02 (Tapissage)`);
    }
  }

  // List final workshops
  const finalWorkshops = await p.workshop.findMany({ orderBy: [{ factory: "asc" }, { sortOrder: "asc" }] });
  console.log("\n=== Final workshops ===");
  for (const w of finalWorkshops) {
    const wcCount = await p.workCenter.count({ where: { workshopId: w.id } });
    console.log(`${w.factory} ${w.code}: ${w.label} (${wcCount} postes)`);
  }

  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
