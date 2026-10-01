import fs from "fs";
const f = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/portail/page.tsx";
let c = fs.readFileSync(f, "utf8");

// Replace the "Mon poste et mon programme" card with inline QR scanner
const oldCard = `      <div className="mt-5">
        <Carte
          titre="Mon poste et mon programme"
          description="Scannez le QR permanent de votre poste : le serveur verifie que ce poste vous est bien affecte aujourd'hui, puis affiche votre programme dans l'ordre publie par votre responsable."
          actions={
            <Link className="bouton secondaire" href="/portail/poste">
              Saisir le code du poste
            </Link>
          }
        >
          <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
            Journee metier en cours : {jourTexte} (Africa/Algiers). Les taches
            ci-dessous sont celles que le serveur vous reconnait pour cette
            journee, priorite et ordre compris. Aucune tache d&apos;un autre
            employe n&apos;apparait ici.
          </p>
        </Carte>
      </div>`;

const newCard = `      <div className="mt-5">
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
      </div>

      <div className="mt-5">
        <ProgrammeTaches
          taches={programmeDuJour}
          titre="Mon programme du jour, dans l'ordre de passage"
          messageVide="Aucune tache ne vous est planifiee pour aujourd'hui. Votre responsable d'atelier renseigne les affectations quotidiennes."`;

// Find and replace from the card to the ProgrammeTaches
const marker = '      <div className="mt-5">\n        <Carte\n          titre="Mon poste et mon programme"';
const idx = c.indexOf(marker);
if (idx === -1) { console.log("Marker not found"); process.exit(1); }

// Find the end of ProgrammeTaches
const progIdx = c.indexOf('<ProgrammeTaches', idx);
if (progIdx === -1) { console.log("ProgrammeTaches not found"); process.exit(1); }

// Replace from marker to just before ProgrammeTaches
const before = c.substring(0, idx);
const after = c.substring(progIdx);
c = before + newCard + "\n" + after;

fs.writeFileSync(f, c, "utf8");
console.log("Portal QR scanner integrated");
