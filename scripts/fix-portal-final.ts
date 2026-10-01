import fs from "fs";
const f = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/portail/page.tsx";
let c = fs.readFileSync(f, "utf8");

// Replace the old text input scanner card with the camera scanner
const oldScanner = `      <div className="mt-5">
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
        </Carte>
      </div>`;

const newScanner = `      <div className="mt-5">
        <Carte
          titre="📷 Scanner mon poste"
          description="Appuyez sur le bouton ci-dessous, puis pointez votre camera vers le QR affiche sur votre machine."
        >
          <ScannerQR />
        </Carte>
      </div>`;

c = c.replace(oldScanner, newScanner);

// Also remove unused imports that might cause errors
// Remove FormulaireAction, Champ if no longer used in the file
const usesFormulaireAction = c.includes("FormulaireAction") && c.indexOf("FormulaireAction") !== c.lastIndexOf("FormulaireAction");
const usesChamp = c.match(/<Champ/g);
if (!usesFormulaireAction) {
  // Check if FormulaireAction is used elsewhere
  const formulaCount = (c.match(/FormulaireAction/g) || []).length;
  if (formulaCount <= 1) { // only in import
    console.log("FormulaireAction may be unused - keeping for safety");
  }
}

fs.writeFileSync(f, c, "utf8");
console.log("Camera scanner integrated, old text input removed");
