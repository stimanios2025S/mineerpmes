/** Cree les deux comptes proprietaires sans modifier les comptes existants. */
import { PrismaClient } from "@prisma/client";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROLE_DEFINITIONS } from "../src/lib/rbac/roles";
import { genererMotDePasseTemporaire, hacherMotDePasse, verifierRobustesseMotDePasse } from "../src/lib/auth/password";

const comptes = [
  { email: "proprietaire@admedco.dz", role: "PROPRIETAIRE_ADMEDCO" },
  { email: "proprietaire@mobilix.dz", role: "PROPRIETAIRE_MOBILIX" },
];

async function principal() {
  if (!process.argv.includes("--apply")) {
    console.log("Simulation : creation des deux comptes proprietaires et renommage de DIRECTION en Direction generale. Aucun autre compte n'est modifie.");
    return;
  }
  const argument = process.argv.find((a) => a.startsWith("--credentials="));
  if (!argument) throw new Error("--credentials=chemin est obligatoire pour recevoir les mots de passe generes.");
  const fichier = resolve(argument.slice("--credentials=".length));
  if (existsSync(fichier)) throw new Error("Le fichier d'identifiants existe deja : refus de l'ecraser.");
  // Reserve le fichier avant toute ecriture en base (permissions 600).
  writeFileSync(fichier, "[]", { flag: "wx", mode: 0o600 });
  const prisma = new PrismaClient();
  try {
    const acces: { email: string; password: string; role: string }[] = [];
    await prisma.$transaction(async (tx) => {
      for (const compte of comptes) {
        const definition = ROLE_DEFINITIONS.find((r) => r.code === compte.role)!;
        const permissions = await tx.permission.findMany({ where: { code: { in: definition.permissions } } });
        if (permissions.length !== new Set(definition.permissions).size) throw new Error("Permission proprietaire absente du referentiel.");
        const role = await tx.role.upsert({
          where: { code: definition.code },
          create: { code: definition.code, label: definition.label, description: definition.description, factoryScope: definition.factoryScope, isSystem: true, isActive: true, sortOrder: definition.sortOrder },
          update: { label: definition.label, description: definition.description, factoryScope: definition.factoryScope },
        });
        await tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { notIn: permissions.map((p) => p.id) } } });
        for (const permission of permissions) {
          await tx.rolePermission.upsert({
            where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
            create: { roleId: role.id, permissionId: permission.id }, update: {},
          });
        }
        const existant = await tx.user.findUnique({ where: { email: compte.email }, include: { roles: true } });
        if (existant) {
          if (existant.roles.length !== 1 || existant.roles[0].roleId !== role.id) throw new Error("Un compte proprietaire existant porte d'autres roles : intervention manuelle necessaire.");
          console.log(`${compte.email} : deja present, mot de passe preserve.`);
          continue;
        }
        let password = genererMotDePasseTemporaire(20);
        while (!verifierRobustesseMotDePasse(password).valide) password = genererMotDePasseTemporaire(20);
        await tx.user.create({ data: {
          email: compte.email, passwordHash: await hacherMotDePasse(password), isActive: true, mustChangePassword: true,
          roles: { create: { roleId: role.id } },
        } });
        acces.push({ email: compte.email, password, role: compte.role });
      }
      await tx.role.update({ where: { code: "DIRECTION" }, data: { label: "Direction generale" } });
      // Prepare les identifiants avant de valider la transaction.
      writeFileSync(fichier, JSON.stringify(acces, null, 2), { mode: 0o600 });
    }, { timeout: 30_000 });
    console.log(`${acces.length} compte(s) cree(s). Identifiants dans le fichier prive indique. Changement du mot de passe requis a la premiere connexion.`);
  } finally {
    await prisma.$disconnect();
  }
}
principal().catch((erreur: unknown) => {
  console.error(erreur instanceof Error ? erreur.message : String(erreur));
  process.exitCode = 1;
});
