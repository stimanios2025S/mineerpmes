import fs from "fs";
const navFile = "C:/Users/stimanios/Documents/ERPMES/src/components/navigation.ts";
let nav = fs.readFileSync(navFile, "utf8");
if (!nav.includes("/administration/scans")) {
  nav = nav.replace(
    '      {\n        chemin: "/administration/qr-codes",',
    '      {\n        chemin: "/administration/scans",\n        libelle: "Historique des scans QR",\n        permission: PERMISSIONS.ADMINISTRER_SYSTEME,\n      },\n      {\n        chemin: "/administration/qr-codes",',
  );
  fs.writeFileSync(navFile, nav, "utf8");
  console.log("Navigation: scans added");
} else {
  console.log("Already exists");
}
