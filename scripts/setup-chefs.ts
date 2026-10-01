import { PrismaClient } from "@prisma/client";
import { randomBytes, scrypt as scryptCb } from "crypto";
import { promisify } from "util";
const scrypt = promisify(scryptCb);
const p = new PrismaClient();

const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_KEYLEN = 64, SCRYPT_MAXMEM = 64 * 1024 * 1024;

async function hacher(mp: string): Promise<string> {
  const salt = randomBytes(16);
  const cle = await scrypt(mp.normalize("NFKC"), salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM });
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64"), cle.toString("base64")].join("$");
}

(async () => {
  const password = "ChefAtelier2026!";
  const pwdHash = await hacher(password);

  // 1. Link existing chef employees to their workshops
  const workshopMap: Record<string, string> = {
    "ADM-A01-CHEF": "ADM-A01",
    "ADM-A02-CHEF": "ADM-A02",
    "ADM-A03-CHEF": "ADM-A03",
    "MBX-A01-CHEF": "MBX-A01",
    "MBX-A02-CHEF": "MBX-A02",
  };

  const roleMap: Record<string, string> = {
    "ADM-A01-CHEF": "CHEF_ADM_A01",
    "ADM-A02-CHEF": "CHEF_ADM_A02",
    "ADM-A03-CHEF": "CHEF_ADM_A03",
    "MBX-A01-CHEF": "CHEF_MBX_A01",
    "MBX-A02-CHEF": "CHEF_MBX_A02",
  };

  const emailMap: Record<string, string> = {
    "ADM-A01-CHEF": "chef.a01@admedco.dz",
    "ADM-A02-CHEF": "chef.a02@admedco.dz",
    "ADM-A03-CHEF": "chef.a03@admedco.dz",
    "MBX-A01-CHEF": "chef.mbx01@admedco.dz",
    "MBX-A02-CHEF": "chef.mbx02@admedco.dz",
  };

  for (const [matricule, workshopCode] of Object.entries(workshopMap)) {
    const workshop = await p.workshop.findFirst({ where: { code: workshopCode } });
    const employee = await p.employee.findFirst({ where: { matricule } });

    if (employee && workshop) {
      await p.employee.update({ where: { id: employee.id }, data: { workshopId: workshop.id } });
      console.log(`Linked ${matricule} -> ${workshopCode}`);
    }

    // Create user account
    const email = emailMap[matricule];
    const existingUser = await p.user.findFirst({ where: { email } });
    if (!existingUser) {
      const user = await p.user.create({ data: { email, passwordHash: pwdHash, isActive: true } });
      if (employee) {
        await p.employee.update({ where: { id: employee.id }, data: { userId: user.id } });
      }
      console.log(`Created account: ${email}`);
    } else {
      console.log(`Account exists: ${email}`);
    }

    // Assign role
    const role = await p.role.findFirst({ where: { code: roleMap[matricule] } });
    const user = await p.user.findFirst({ where: { email } });
    if (role && user) {
      const existingUserRole = await p.userRole.findFirst({ where: { userId: user.id, roleId: role.id } });
      if (!existingUserRole) {
        await p.userRole.create({ data: { userId: user.id, roleId: role.id } });
        console.log(`Assigned role: ${roleMap[matricule]}`);
      }
    }
  }

  // 2. Assign existing operators to correct workshops
  const operatorWorkshops: Record<string, string> = {
    "ADM-0010": "ADM-A01",  // Karim -> Coupe avec centrage
    "MBX-0010": "MBX-A02",  // Sofiane -> Tapissage
    "ACC-0001": "ADM-A01",  // Old test ADMEDCO -> A01
    "ACC-0002": "MBX-A02",  // Old test MOBILIX -> A02
  };

  for (const [matricule, workshopCode] of Object.entries(operatorWorkshops)) {
    const workshop = await p.workshop.findFirst({ where: { code: workshopCode } });
    const employee = await p.employee.findFirst({ where: { matricule } });
    if (employee && workshop) {
      await p.employee.update({ where: { id: employee.id }, data: { workshopId: workshop.id } });
      console.log(`Assigned ${matricule} -> ${workshopCode}`);
    }
  }

  // Summary
  console.log("\n=== SUMMARY ===");
  const employees = await p.employee.findMany({
    include: { workshop: { select: { code: true, label: true } }, user: { select: { email: true } } },
    orderBy: [{ factory: "asc" }, { matricule: "asc" }],
  });
  for (const emp of employees) {
    console.log(`${emp.factory} | ${emp.matricule} | ${emp.firstName} ${emp.lastName} | ${emp.workshop?.code ?? "No workshop"} | ${emp.user?.email ?? "No account"}`);
  }

  console.log(`\nPassword for all chef accounts: ${password}`);
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
