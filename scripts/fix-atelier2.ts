import fs from "fs";
const f = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/atelier/[code]/page.tsx";
let c = fs.readFileSync(f, "utf8");
// Remove the duplicate import at the bottom
c = c.replace(/\n\/\/ Need to import prisma\nimport \{ prisma as p \} from "@\/lib\/db";\n?$/, "\n");
fs.writeFileSync(f, c, "utf8");
console.log("Duplicate import removed");
