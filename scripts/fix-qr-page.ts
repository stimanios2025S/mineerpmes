import fs from "fs";

// Fix print button in QR codes page
const qrPage = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/administration/qr-codes/page.tsx";
let qr = fs.readFileSync(qrPage, "utf8");
qr = qr.replace(
  'import { urlScanPoste } from "@/lib/mes/qr";',
  'import { urlScanPoste } from "@/lib/mes/qr";\nimport { BoutonImprimer } from "@/components/bouton-imprimer";',
);
qr = qr.replace(
  /<button onClick=\{\(\) => window\.print\(\)\}[^>]*>[\s\S]*?<\/button>/,
  "<BoutonImprimer />",
);
fs.writeFileSync(qrPage, qr, "utf8");
console.log("QR page print button fixed");

// Add QR codes to navigation
const navFile = "C:/Users/stimanios/Documents/ERPMES/src/components/navigation.ts";
let nav = fs.readFileSync(navFile, "utf8");
if (!nav.includes("/administration/qr-codes")) {
  nav = nav.replace(
    '      {\n        chemin: "/administration/import",',
    '      {\n        chemin: "/administration/qr-codes",\n        libelle: "QR Codes des postes",\n        permission: PERMISSIONS.ADMINISTRER_SYSTEME,\n      },\n      {\n        chemin: "/administration/import",',
  );
  fs.writeFileSync(navFile, nav, "utf8");
  console.log("Navigation: QR codes added");
} else {
  console.log("Navigation: already has QR codes");
}
