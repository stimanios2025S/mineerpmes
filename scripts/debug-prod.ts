import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const items = await p.item.findMany({ where: { isProducible: true }, select: { id: true, code: true, label1: true, status: true }, take: 10 });
  console.log("Producible items:", JSON.stringify(items, null, 2));
  const routes = await p.productRoute.findMany({ select: { id: true, code: true, itemId: true, status: true } });
  console.log("Routes:", JSON.stringify(routes, null, 2));
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
