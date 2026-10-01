import fs from "fs";

// Update the QR scan page to redirect to factory-specific portal
const scanFile = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/portail/poste/[token]/page.tsx";
let scan = fs.readFileSync(scanFile, "utf8");

// After confirming scan, redirect to factory portal
scan = scan.replace(
  'window.location.href = `/portail/poste/${encodeURIComponent(token)}`;',
  'const factory = document.cookie.includes("OPERATEUR_MOBILIX") ? "mobilix" : "admedco";\n              window.location.href = `/portail/${factory}`;',
);

fs.writeFileSync(scanFile, scan, "utf8");
console.log("Scanner redirect updated");
