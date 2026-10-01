import fs from "fs";

// 1. Remove /portail/poste from navigation
const navFile = "C:/Users/stimanios/Documents/ERPMES/src/components/navigation.ts";
let nav = fs.readFileSync(navFile, "utf8");
const before = nav;
nav = nav.replace(
  /      \{\s*chemin: "\/portail\/poste",\s*libelle: "Mon poste de travail",\s*permission: PERMISSIONS\.PORTAIL_POSTE_SCANNER,\s*description: "[^"]*",\s*\},\n/,
  "",
);
if (nav !== before) {
  fs.writeFileSync(navFile, nav, "utf8");
  console.log("Removed /portail/poste from navigation");
} else {
  console.log("Pattern not found in navigation");
}

// 2. Add QR scanner directly into portal page
const portalFile = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/portail/page.tsx";
let portal = fs.readFileSync(portalFile, "utf8");

// Find the "Mon poste et mon programme" card and replace it with an inline QR scanner
const scannerReplacement = `
        {/* Scanner QR integre */}
        <Carte
          titre="Scanner mon poste"
          description="Entrez le code de votre poste ou scannez le QR affiche sur votre machine."
        >
          <FormulaireAction
            action={async (formData: FormData) => {
              "use server";
              const { actionScannerPosteParCode } = await import("@/actions/atelier");
              return actionScannerPosteParCode(formData);
            }}
            libelleSoumettre="Valider mon poste"
            varianteSoumettre="primaire"
          >
            <Champ
              name="codePoste"
              label="Code du poste (ex: PT-COUPE)"
              requis
            />
            <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
              Entrez le code affiche sur votre machine, ou scannez le QR avec votre appareil.
            </p>
          </FormulaireAction>
        </Carte>

        <Carte
          titre="Mon programme du jour, dans l'ordre de passage"
          description="Programme publie par votre responsable."
        >`;

// Replace the old "Mon poste et mon programme" card
portal = portal.replace(
  /        <Carte\s*titre="Mon poste et mon programme"[^}]*>[\s\S]*?<\/Carte>\s*\n\s*<Carte\s*titre="Mon programme du jour[^"]*"/,
  scannerReplacement,
);

fs.writeFileSync(portalFile, portal, "utf8");
console.log("Added QR scanner to portal page");
