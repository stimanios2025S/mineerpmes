import fs from "fs";

const f = "C:/Users/stimanios/Documents/ERPMES/src/components/navigation.ts";
let c = fs.readFileSync(f, "utf8");

// 1. Add rolesVisibles to EntreeNavigation interface
c = c.replace(
  "  permissionsAlternatives?: string[];\n  description?: string;\n}",
  "  permissionsAlternatives?: string[];\n  description?: string;\n  rolesVisibles?: string[];\n}",
);

// 2. Add rolesVisibles to SectionNavigation interface
c = c.replace(
  "  entrees: EntreeNavigation[];\n}",
  "  entrees: EntreeNavigation[];\n  rolesVisibles?: string[];\n}",
);

// 3. Mark sections hidden from operators (rolesVisibles: [] = only admin+)
const sectionsToHide = [
  "referentiel",
  "nomenclature",
  "stock",
  "production",
  "qualite",
  "achats",
  "ventes",
  "finance",
  "rh",
  "administration",
];

for (const code of sectionsToHide) {
  const re = new RegExp(
    `(code: "${code}",\\s*titre: "[^"]*")`,
    "g",
  );
  c = c.replace(re, `$1,\n    rolesVisibles: []`);
}

// 4. Update navigationAutorisee to filter by rolesVisibles
c = c.replace(
  "export function navigationAutorisee(utilisateur: SessionUser): SectionNavigation[] {\n  return NAVIGATION.map((section) => ({",
  `export function navigationAutorisee(utilisateur: SessionUser): SectionNavigation[] {
  const roleCodes = utilisateur.roles.map((r: { code: string }) => r.code);
  const estOperateur = roleCodes.some(
    (r: string) => r === "OPERATEUR_ADMEDCO" || r === "OPERATEUR_MOBILIX",
  );
  return NAVIGATION.map((section) => ({`,
);

c = c.replace(
  '  })).filter((section) => section.entrees.length > 0);',
  `  })).filter((section) => {
    if (section.entrees.length === 0) return false;
    if (estOperateur && section.rolesVisibles && section.rolesVisibles.length === 0) return false;
    return true;
  });`,
);

fs.writeFileSync(f, c, "utf8");
console.log("Navigation updated successfully");
