import fs from "fs";

const navFile = "C:/Users/stimanios/Documents/ERPMES/src/components/navigation.ts";
let nav = fs.readFileSync(navFile, "utf8");

// Add direction portals to navigation
if (!nav.includes("/direction/admedco")) {
  nav = nav.replace(
    '      {\n        chemin: "/tableau-de-bord/production",',
    `      {
        chemin: "/direction/admedco",
        libelle: "Direction ADMEDCO",
        permission: PERMISSIONS.TABLEAU_BORD_LIRE,
      },
      {
        chemin: "/direction/mobilix",
        libelle: "Direction MOBILIX",
        permission: PERMISSIONS.TABLEAU_BORD_LIRE,
      },
      {
        chemin: "/tableau-de-bord/production",`,
  );
}

fs.writeFileSync(navFile, nav, "utf8");
console.log("Navigation updated with direction portals");
