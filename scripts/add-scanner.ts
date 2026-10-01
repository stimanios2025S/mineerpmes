import fs from "fs";
const f = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/portail/page.tsx";
let c = fs.readFileSync(f, "utf8");

// Insert scanner card right before ProgrammeTaches
const target = `      <div className="mt-5">
        <ProgrammeTaches`;

const replacement = `      <div className="mt-5">
        <Carte
          titre="📷 Scanner mon poste"
          description="Pointez votre camera vers le QR affiche sur votre machine."
        >
          <ScannerQR />
        </Carte>
      </div>

      <div className="mt-5">
        <ProgrammeTaches`;

c = c.replace(target, replacement);

fs.writeFileSync(f, c, "utf8");
console.log("Scanner card inserted");
