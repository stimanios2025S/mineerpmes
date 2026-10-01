import fs from "fs";
const f = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/portail/page.tsx";
let c = fs.readFileSync(f, "utf8");

// Find the scanner card and move it right after the EnTetePage + statistics
// First, remove the scanner card from its current position
const scannerBlock = `      <div className="mt-5">
        <Carte
          titre="📷 Scanner mon poste"
          description="Appuyez sur le bouton ci-dessous, puis pointez votre camera vers le QR affiche sur votre machine."
        >
          <ScannerQR />
        </Carte>
      </div>`;

// Remove from current position
c = c.replace(scannerBlock + "\n", "");

// Insert right after the statistics grid (after the closing </div> of the grid)
const statsEnd = `          ton="neutre"
          />
        </div>

      <div className="mt-5">`;

const insertPoint = `          ton="neutre"
          />
        </div>

      <div className="mt-5">
        <Carte
          titre="📷 Scanner mon poste"
          description="Pointez votre camera vers le QR affiche sur votre machine."
        >
          <ScannerQR />
        </Carte>
      </div>

      <div className="mt-5">`;

c = c.replace(statsEnd, insertPoint);

fs.writeFileSync(f, c, "utf8");
console.log("Scanner moved to first position");
