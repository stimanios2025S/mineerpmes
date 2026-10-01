/**
 * Creation securisee du premier administrateur.
 *
 * AUCUN mot de passe n'est code en dur dans le depot. Le script lit les
 * informations depuis les variables d'environnement, verifie la robustesse du
 * mot de passe, refuse de creer un second administrateur actif, et journalise
 * l'operation.
 *
 * Utilisation :
 *   1. Renseigner dans .env :
 *        BOOTSTRAP_ADMIN_EMAIL=...
 *        BOOTSTRAP_ADMIN_PASSWORD=...   (au moins 12 caracteres)
 *        BOOTSTRAP_ADMIN_PRENOM=...
 *        BOOTSTRAP_ADMIN_NOM=...
 *        BOOTSTRAP_ADMIN_MATRICULE=...  (facultatif, defaut ADM-0001)
 *   2. Executer : npm run bootstrap:admin
 *   3. Retirer immediatement BOOTSTRAP_ADMIN_PASSWORD du fichier .env
 *
 * Le compte cree doit changer son mot de passe a la premiere connexion.
 */

import { PrismaClient } from "@prisma/client";
import {
  hacherMotDePasse,
  verifierRobustesseMotDePasse,
} from "../src/lib/auth/password";
import { ACTIONS_AUDIT, MODULES_AUDIT } from "../src/lib/audit";

const prisma = new PrismaClient();

function lire(nom: string): string {
  return (process.env[nom] ?? "").trim();
}

function masquer(valeur: string): string {
  if (valeur.length <= 4) return "****";
  return `${valeur.slice(0, 2)}${"*".repeat(Math.max(4, valeur.length - 4))}${valeur.slice(-2)}`;
}

async function principal() {
  console.log("Creation securisee du premier administrateur\n");

  const email = lire("BOOTSTRAP_ADMIN_EMAIL").toLowerCase();
  const motDePasse = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  const prenom = lire("BOOTSTRAP_ADMIN_PRENOM") || "Administrateur";
  const nom = lire("BOOTSTRAP_ADMIN_NOM") || "Systeme";
  const matricule = lire("BOOTSTRAP_ADMIN_MATRICULE") || "ADM-0001";

  const erreurs: string[] = [];
  if (!email) erreurs.push("BOOTSTRAP_ADMIN_EMAIL est vide.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    erreurs.push("BOOTSTRAP_ADMIN_EMAIL n'est pas une adresse electronique valide.");
  }
  if (!motDePasse) {
    erreurs.push(
      "BOOTSTRAP_ADMIN_PASSWORD est vide. Definissez un mot de passe d'au moins 12 caracteres.",
    );
  } else {
    const robustesse = verifierRobustesseMotDePasse(motDePasse);
    if (!robustesse.valide) {
      erreurs.push(...robustesse.erreurs);
    }
  }

  if (erreurs.length > 0) {
    console.error("Creation refusee :");
    for (const erreur of erreurs) console.error(`  - ${erreur}`);
    console.error(
      "\nAucun mot de passe par defaut n'est fourni par l'application : c'est volontaire.",
    );
    process.exitCode = 1;
    return;
  }

  const roleAdmin = await prisma.role.findUnique({
    where: { code: "ADMIN_SYSTEME" },
  });
  if (!roleAdmin) {
    console.error(
      "Le role ADMIN_SYSTEME est introuvable. Executez d'abord : npm run db:seed",
    );
    process.exitCode = 1;
    return;
  }

  // Refus si un administrateur actif existe deja : evite l'ecrasement silencieux.
  const liensExistants = await prisma.userRole.findMany({
    where: { roleId: roleAdmin.id },
    include: { user: { select: { id: true, email: true, isActive: true } } },
  });

  const actifs = liensExistants.filter((lien) => lien.user.isActive);
  if (actifs.length > 0) {
    console.error(
      `Un administrateur actif existe deja : ${actifs.map((l) => l.user.email).join(", ")}.`,
    );
    console.error(
      "Pour ajouter un administrateur supplementaire, utilisez l'ecran d'administration des utilisateurs de l'application.",
    );
    process.exitCode = 1;
    return;
  }

  const hash = await hacherMotDePasse(motDePasse);

  const resultat = await prisma.$transaction(async (tx) => {
    const compteExistant = await tx.user.findUnique({ where: { email } });

    const compte = compteExistant
      ? await tx.user.update({
          where: { id: compteExistant.id },
          data: {
            passwordHash: hash,
            isActive: true,
            mustChangePassword: true,
            failedAttempts: 0,
            lockedUntil: null,
            disabledAt: null,
          },
        })
      : await tx.user.create({
          data: {
            email,
            passwordHash: hash,
            isActive: true,
            mustChangePassword: true,
          },
        });

    // La fiche employe porte l'identite reelle : chaque action importante est
    // rattachee a une personne, jamais a un compte generique.
    const employeExistant = await tx.employee.findUnique({ where: { userId: compte.id } });
    const employe =
      employeExistant ??
      (await tx.employee.create({
        data: {
          matricule,
          firstName: prenom,
          lastName: nom,
          email,
          jobTitle: "Administrateur de la plateforme",
          factory: "COMMUN",
          isActive: true,
          userId: compte.id,
        },
      }));

    await tx.userRole.upsert({
      where: { userId_roleId: { userId: compte.id, roleId: roleAdmin.id } },
      create: { userId: compte.id, roleId: roleAdmin.id },
      update: {},
    });

    await tx.auditLog.create({
      data: {
        action: ACTIONS_AUDIT.UTILISATEUR_CREE,
        module: MODULES_AUDIT.SYSTEME,
        entity: "User",
        entityId: String(compte.id),
        userId: compte.id,
        userEmail: compte.email,
        newValue: {
          origine: "bootstrap-admin",
          matricule: employe.matricule,
          roles: ["ADMIN_SYSTEME"],
          motDePasseTemporaire: true,
        },
        comment:
          "Creation du premier administrateur via la procedure securisee de demarrage.",
      },
    });

    return { compte, employe };
  });

  console.log("Administrateur cree :");
  console.log(`  Adresse electronique .... ${resultat.compte.email}`);
  console.log(`  Identite ................ ${prenom} ${nom}`);
  console.log(`  Matricule ............... ${resultat.employe.matricule}`);
  console.log(`  Mot de passe ............ ${masquer(motDePasse)}`);
  console.log("  Role .................... ADMIN_SYSTEME (acces aux deux usines)");
  console.log("  Changement de mot de passe obligatoire : oui");
  console.log("\nAction immediate : supprimez BOOTSTRAP_ADMIN_PASSWORD du fichier .env.");
}

principal()
  .catch((erreur) => {
    console.error("\nEchec de la creation de l'administrateur :");
    console.error(erreur);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
