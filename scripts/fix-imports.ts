import fs from "fs";
const f = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/portail/page.tsx";
let c = fs.readFileSync(f, "utf8");
// Remove unused Link import
c = c.replace('import Link from "next/link";\n', "");
// Add actionScannerPosteParCode to imports
c = c.replace(
  "import {\n  actionPortailCloturerOrdre,",
  "import {\n  actionPortailCloturerOrdre,\n  actionScannerPosteParCode,",
);
fs.writeFileSync(f, c, "utf8");
console.log("Imports fixed");
