import fs from "fs";
const f = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/portail/page.tsx";
let c = fs.readFileSync(f, "utf8");
// Remove actionScannerPosteParCode from rh imports
c = c.replace("  actionScannerPosteParCode,\n  actionPortailDeclarerConsommation,", "  actionPortailDeclarerConsommation,");
// Add new import for atelier actions
c = c.replace(
  'import { actionScannerPoste } from "@/actions/atelier";',
  'import { actionScannerPoste, actionScannerPosteParCode } from "@/actions/atelier";',
);
// If no atelier import exists, add it
if (!c.includes('actionScannerPosteParCode')) {
  c = c.replace(
    'import {',
    'import { actionScannerPosteParCode } from "@/actions/atelier";\nimport {',
  );
}
fs.writeFileSync(f, c, "utf8");
console.log("Import fixed");
