import fs from "fs";
const f = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/atelier/[code]/page.tsx";
let c = fs.readFileSync(f, "utf8");
// Move the import to the top
c = c.replace('import { prisma as p } from "@/lib/db";\n', '');
c = c.replace(
  'import { prisma } from "@/lib/db";',
  'import { prisma as p } from "@/lib/db";',
);
fs.writeFileSync(f, c, "utf8");
console.log("Import fixed");
