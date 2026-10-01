import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

(async () => {
  // Create chef d'atelier roles for each workshop
  const chefs = [
    { code: "CHEF_ADM_A01", label: "Chef Atelier ADMEDCO A01", factoryScope: "ADMEDCO", description: "Chef atelier A01 — Coupe avec centrage" },
    { code: "CHEF_ADM_A02", label: "Chef Atelier ADMEDCO A02", factoryScope: "ADMEDCO", description: "Chef atelier A02 — Coupe sans centrage" },
    { code: "CHEF_ADM_A03", label: "Chef Atelier ADMEDCO A03", factoryScope: "ADMEDCO", description: "Chef atelier A03 — Poudrage et emballage" },
    { code: "CHEF_MBX_A01", label: "Chef Atelier MOBILIX A01", factoryScope: "MOBILIX", description: "Chef atelier A01 — Decoupe bois" },
    { code: "CHEF_MBX_A02", label: "Chef Atelier MOBILIX A02", factoryScope: "MOBILIX", description: "Chef atelier A02 — Tapissage" },
  ];

  for (const chef of chefs) {
    const existing = await p.role.findFirst({ where: { code: chef.code } });
    if (existing) {
      console.log(`Role exists: ${chef.code}`);
    } else {
      await p.role.create({
        data: {
          code: chef.code,
          label: chef.label,
          description: chef.description,
          factoryScope: chef.factoryScope as any,
          isSystem: false,
          isActive: true,
          sortOrder: 50,
        },
      });
      console.log(`Created role: ${chef.code}`);
    }
  }

  // Create employees for chefs
  const chefEmployees = [
    { matricule: "ADM-A01-CHEF", firstName: "Ahmed", lastName: "Benaissa", factory: "ADMEDCO", jobTitle: "Chef atelier A01", workshopCode: "ADM-A01" },
    { matricule: "ADM-A02-CHEF", firstName: "Karim", lastName: "Haddad", factory: "ADMEDCO", jobTitle: "Chef atelier A02", workshopCode: "ADM-A02" },
    { matricule: "ADM-A03-CHEF", firstName: "Sofiane", lastName: "Mansouri", factory: "ADMEDCO", jobTitle: "Chef atelier A03", workshopCode: "ADM-A03" },
    { matricule: "MBX-A01-CHEF", firstName: "Yacine", lastName: "Boudjemaa", factory: "MOBILIX", jobTitle: "Chef atelier A01", workshopCode: "MBX-A01" },
    { matricule: "MBX-A02-CHEF", firstName: "Riad", lastName: "Cherif", factory: "MOBILIX", jobTitle: "Chef atelier A02", workshopCode: "MBX-A02" },
  ];

  for (const emp of chefEmployees) {
    const workshop = await p.workshop.findFirst({ where: { code: emp.workshopCode } });
    const existing = await p.employee.findFirst({ where: { matricule: emp.matricule } });
    if (existing) {
      console.log(`Employee exists: ${emp.matricule}`);
    } else {
      await p.employee.create({
        data: {
          matricule: emp.matricule,
          firstName: emp.firstName,
          lastName: emp.lastName,
          factory: emp.factory as any,
          jobTitle: emp.jobTitle,
          workshopId: workshop?.id ?? null,
          isActive: true,
        },
      });
      console.log(`Created employee: ${emp.matricule}`);
    }
  }

  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
