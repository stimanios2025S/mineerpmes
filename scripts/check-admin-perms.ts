import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const role = await p.role.findFirst({ where: { code: "ADMIN_SYSTEME" }, include: { permissions: { include: { permission: true } } } });
  const perms = role?.permissions.map(rp => rp.permission.code) ?? [];
  console.log("ADMIN_SYSTEME has PRODUCTION_ORDRE_CREER:", perms.includes("PRODUCTION_ORDRE_CREER"));
  console.log("ADMIN_SYSTEME has PRODUCTION_LANCER:", perms.includes("PRODUCTION_LANCER"));
  console.log("Total permissions:", perms.length);
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
