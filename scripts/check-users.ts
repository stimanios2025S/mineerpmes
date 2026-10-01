import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const users = await p.user.findMany({ include: { roles: { include: { role: true } }, employee: { select: { matricule: true, factory: true } } } });
  for (const u of users) {
    const roleCodes = u.roles.map(r => r.role.code).join(", ");
    const emp = u.employee ? ` (${u.employee.matricule} / ${u.employee.factory})` : " (no employee)";
    console.log(`${u.email} -> ${roleCodes}${emp}`);
  }
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
