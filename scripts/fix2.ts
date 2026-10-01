import fs from "fs";
const f = "C:/Users/stimanios/Documents/ERPMES/src/lib/mes/consommation.ts";
let c = fs.readFileSync(f, "utf8");
c = c.replace(
  /await prisma\.stockMovement\.create\(\{\s*data:\s*\{\s*itemId:/g,
  `const smCount = await prisma.stockMovement.count();\n        await prisma.stockMovement.create({\n          data: {\n            number: "SM-" + Date.now() + "-" + smCount,\n            itemId:`,
);
fs.writeFileSync(f, c, "utf8");
console.log("Fixed");
