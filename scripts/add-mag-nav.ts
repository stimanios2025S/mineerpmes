import fs from "fs";
const navFile = "C:/Users/stimanios/Documents/ERPMES/src/components/navigation.ts";
let nav = fs.readFileSync(navFile, "utf8");

if (!nav.includes("/magasinier/admedco")) {
  nav = nav.replace(
    '        chemin: "/magasinier",',
    `        chemin: "/magasinier/admedco",
        libelle: "Magasinier ADMEDCO",
        permission: PERMISSIONS.STOCK_LIRE,
      },
      {
        chemin: "/magasinier/mobilix",
        libelle: "Magasinier MOBILIX",
        permission: PERMISSIONS.STOCK_LIRE,
      },
      {
        chemin: "/magasinier",`,
  );
}

fs.writeFileSync(navFile, nav, "utf8");
console.log("Navigation updated");
