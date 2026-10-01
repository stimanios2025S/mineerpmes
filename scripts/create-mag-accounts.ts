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
  const password = "Magasinier2026!";
  const pwdHash = await hacher(password);

  // Create magasinier roles
  const roles = [
    { code: "MAGASINIER_ADMEDCO", label: "Magasinier ADMEDCO", factoryScope: "ADMEDCO", description: "Magasinier ADMEDCO — stocks uniquement" },
    { code: "MAGASINIER_MOBILIX", label: "Magasinier MOBILIX", factoryScope: "MOBILIX", description: "Magasinier MOBILIX — stocks uniquement" },
  ];

  for (const role of roles) {
    const existing = await p.role.findFirst({ where: { code: role.code } });
    if (existing) {
      console.log(`Role exists: ${role.code}`);
    } else {
      await p.role.create({ data: { ...role, isSystem: false, isActive: true, sortOrder: 55 } });
      console.log(`Created role: ${role.code}`);
    }
  }

  // Create employees
  const employees = [
    { matricule: "ADM-MAG-001", firstName: "Bilal", lastName: "Kaci", factory: "ADMEDCO", jobTitle: "Magasinier ADMEDCO" },
    { matricule: "MBX-MAG-001", firstName: "Reda", lastName: "Slimani", factory: "MOBILIX", jobTitle: "Magasinier MOBILIX" },
  ];

  for (const emp of employees) {
    const existing = await p.employee.findFirst({ where: { matricule: emp.matricule } });
    if (existing) {
      console.log(`Employee exists: ${emp.matricule}`);
    } else {
      await p.employee.create({ data: { ...emp, isActive: true } });
      console.log(`Created employee: ${emp.matricule}`);
    }
  }

  // Create accounts and assign roles
  const accountMap = [
    { matricule: "ADM-MAG-001", email: "magasinier.admedco@admedco.dz", roleCode: "MAGASINIER_ADMEDCO" },
    { matricule: "MBX-MAG-001", email: "magasinier.mobilix@admedco.dz", roleCode: "MAGASINIER_MOBILIX" },
  ];

  for (const acct of accountMap) {
    const employee = await p.employee.findFirst({ where: { matricule: acct.matricule } });
    const role = await p.role.findFirst({ where: { code: acct.roleCode } });

    let user = await p.user.findFirst({ where: { email: acct.email } });
    if (!user) {
      user = await p.user.create({ data: { email: acct.email, passwordHash: pwdHash, isActive: true } });
      console.log(`Created account: ${acct.email}`);
    }

    if (employee && user) {
      await p.employee.update({ where: { id: employee.id }, data: { userId: user.id } });
    }

    if (role && user) {
      const existing = await p.userRole.findFirst({ where: { userId: user.id, roleId: role.id } });
      if (!existing) {
        await p.userRole.create({ data: { userId: user.id, roleId: role.id } });
        console.log(`Assigned role: ${acct.roleCode}`);
      }
    }
  }

  console.log(`\nPassword: ${password}`);
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
