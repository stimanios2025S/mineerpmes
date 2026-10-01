import fs from "fs";
const f = "C:/Users/stimanios/Documents/ERPMES/src/lib/mes/consommation.ts";
let c = fs.readFileSync(f, "utf8");
// Remove duplicate workOrderId and fix reference
c = c.replace(
  /workOrderId: decl\.workOrderId,\n\s*workOrderId: decl\.workOrderId,\n\s*reference: /g,
  "workOrderId: decl.workOrderId,\n            documentType: ",
);
fs.writeFileSync(f, c, "utf8");
console.log("Fixed");
