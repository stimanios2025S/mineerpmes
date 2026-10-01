import fs from "fs";
const f = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/portail/page.tsx";
let c = fs.readFileSync(f, "utf8");

// Remove the duplicate ProgrammeTaches
const dup = `<ProgrammeTaches
          taches={programmeDuJour}
          titre="Mon programme du jour, dans l'ordre de passage"
          messageVide="Aucune tache ne vous est planifiee pour aujourd'hui. Votre responsable d'atelier renseigne les affectations quotidiennes."
<ProgrammeTaches`;
const single = `<ProgrammeTaches`;
c = c.replace(dup, single);

fs.writeFileSync(f, c, "utf8");
console.log("Duplicate removed");
