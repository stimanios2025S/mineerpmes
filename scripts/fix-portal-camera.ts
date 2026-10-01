import fs from "fs";
const f = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/portail/page.tsx";
let c = fs.readFileSync(f, "utf8");

// 1. Add import for ScannerQR
c = c.replace(
  'import { ProgrammeTaches } from "@/components/taches-programme";',
  'import { ProgrammeTaches } from "@/components/taches-programme";\nimport { ScannerQR } from "@/components/scanner-qr";',
);

// 2. Replace the text input card with camera scanner
const oldCard = `        {/* Scanner QR integre */}
        <Carte
          titre="Scanner mon poste"
          description="Entrez le code affiche sur votre machine, ou scannez le QR avec votre appareil."
        >
          <FormulaireAction
            action={actionScannerPosteParCode}
            libelleSoumettre="Valider mon poste"
            varianteSoumettre="primaire"
          >
            <Champ
              name="codePoste"
              label="Code du poste (ex: PT-COUPE)"
              requis
            />
          </FormulaireAction>
        </Carte>`;

const newCard = `        {/* Scanner QR integre - camera telephone */}
        <Carte
          titre="Scanner mon poste"
          description="Pointez votre camera vers le QR affiche sur votre machine pour acceder a votre programme."
        >
          <ScannerQR />
        </Carte>`;

c = c.replace(oldCard, newCard);

fs.writeFileSync(f, c, "utf8");
console.log("Camera scanner integrated into portal");
