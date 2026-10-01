import fs from "fs";
const navFile = "C:/Users/stimanios/Documents/ERPMES/src/components/navigation.ts";
let nav = fs.readFileSync(navFile, "utf8");

if (!nav.includes("/atelier/")) {
  // Add atelier section after pilotage
  nav = nav.replace(
    '  {\n    code: "portail",',
    `  {
    code: "ateliers",
    titre: "Mes ateliers",
    entrees: [
      {
        chemin: "/atelier/ADM-A01",
        libelle: "ADMEDCO A01 — Coupe avec centrage",
        permission: PERMISSIONS.TABLEAU_BORD_PRODUCTION,
      },
      {
        chemin: "/atelier/ADM-A02",
        libelle: "ADMEDCO A02 — Coupe sans centrage",
        permission: PERMISSIONS.TABLEAU_BORD_PRODUCTION,
      },
      {
        chemin: "/atelier/ADM-A03",
        libelle: "ADMEDCO A03 — Poudrage et emballage",
        permission: PERMISSIONS.TABLEAU_BORD_PRODUCTION,
      },
      {
        chemin: "/atelier/MBX-A01",
        libelle: "MOBILIX A01 — Decoupe bois",
        permission: PERMISSIONS.TABLEAU_BORD_PRODUCTION,
      },
      {
        chemin: "/atelier/MBX-A02",
        libelle: "MOBILIX A02 — Tapissage",
        permission: PERMISSIONS.TABLEAU_BORD_PRODUCTION,
      },
    ],
  },
  {
    code: "portail",`,
  );
}

fs.writeFileSync(navFile, nav, "utf8");
console.log("Navigation updated with atelier pages");
