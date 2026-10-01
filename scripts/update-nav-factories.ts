import fs from "fs";

const navFile = "C:/Users/stimanios/Documents/ERPMES/src/components/navigation.ts";
let nav = fs.readFileSync(navFile, "utf8");

// Update ACCUEIL_PAR_ROLE to redirect operators to their factory portal
nav = nav.replace(
  'OPERATEUR_ADMEDCO: "/portail",',
  'OPERATEUR_ADMEDCO: "/portail/admedco",',
);
nav = nav.replace(
  'OPERATEUR_MOBILIX: "/portail",',
  'OPERATEUR_MOBILIX: "/portail/mobilix",',
);

// Add factory portals to the navigation menu
if (!nav.includes("/portail/admedco")) {
  nav = nav.replace(
    '        chemin: "/portail",\n        libelle: "Portail employe",',
    `        chemin: "/portail",
        libelle: "Mon espace",
        permissionsAlternatives: [PERMISSIONS.PORTAIL_EMPLOYE],`,
  );
}

fs.writeFileSync(navFile, nav, "utf8");
console.log("Navigation updated for factory portals");
