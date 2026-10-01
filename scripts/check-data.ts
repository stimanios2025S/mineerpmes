import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const routes = await p.productRoute.findMany({ select: { id: true, code: true, label: true, itemId: true, factory: true, status: true }, take: 10 });
  console.log("Routes:", JSON.stringify(routes));
  const items = await p.item.findMany({ where: { isProducible: true }, select: { id: true, code: true, label1: true }, take: 5 });
  console.log("Producible:", JSON.stringify(items));
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
