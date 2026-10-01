import fs from "fs";
const f = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/stock/bci/[id]/page.tsx";
let c = fs.readFileSync(f, "utf8");

// Add import for BoutonImprimer
c = c.replace(
  'import { actionConfirmerLivraison } from "@/actions/lancement";',
  'import { actionConfirmerLivraison } from "@/actions/lancement";\nimport { BoutonImprimer } from "@/components/bouton-imprimer";',
);

// Replace the inline button with BoutonImprimer
c = c.replace(
  /<button onClick=\{\(\) => window\.print\(\)\}[^>]*>[\s\S]*?<\/button>/,
  "<BoutonImprimer />",
);

fs.writeFileSync(f, c, "utf8");
console.log("BCI page fixed");
