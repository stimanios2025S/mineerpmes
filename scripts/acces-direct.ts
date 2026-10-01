/**
 * Acces direct de developpement : fixer un mot de passe CONNU sur un compte, et
 * l'ecrire en clair dans .env pour les boutons de portail de la page /connexion.
 *
 * Pourquoi ce script existe
 * -------------------------
 * La plateforme n'accepte aucun mot de passe faible et n'enregistre rien en
 * clair : `npm run comptes -- --amorcer` tire des mots de passe aleatoires,
 * affiches une seule fois. Qui les a perdus ne peut plus se connecter, et
 * `--liste` ne peut pas les lui rendre (seul un hachage scrypt est stocke).
 *
 * Ce script repond a ce seul cas : choisir soi-meme un mot de passe conforme et
 * le poser sur un compte, en laissant une trace d'audit. Il ne remplace ni la
 * connexion nominative, ni le changement de mot de passe par l'utilisateur.
 *
 * Utilisation
 * -----------
 *   npm run acces -- --liste
 *       Affiche les comptes existants : identifiant, adresse, roles, fiche
 *       employe, etat, verrouillage. Aucun mot de passe ne peut y apparaitre.
 *
 *   npm run acces -- --email=admin@admedco.dz --generer
 *       Pose un mot de passe aleatoire CONFORME sur ce compte et l'affiche une
 *       fois. C'est la commande a preferer : rien a inventer, rien a retenir de
 *       traverse.
 *
 *   npm run acces -- --email=admin@admedco.dz --motdepasse=Plateforme-M3s!2026
 *       Pose un mot de passe choisi. Il doit passer la politique de securite :
 *       12 caracteres minimum, minuscule, majuscule, chiffre, caractere special,
 *       et AUCUN des mots « admin », « admedco », « mobilix », « erpmes »,
 *       « password », « motdepasse », « azerty », « qwerty », « 123456 ».
 *       Exemple conforme : Plateforme-M3s!2026
 *
 *   ... --roles=DIRECTION --matricule=EMP-0007
 *       Si le compte n'existe pas encore, il est cree avec ces elements.
 *       --matricule rattache le compte a une fiche employe EXISTANTE (obligatoire
 *       pour ouvrir /portail) ; la fiche n'est jamais inventee. Sans --matricule,
 *       aucun rattachement n'est fait : les comptes de bureau n'en ont pas besoin,
 *       et cela garde le module RH propre pour l'import des vrais employes.
 *       --creer-fiche cree une fiche technique (matricule ACC-xxxx, unique) pour
 *       les cas ou un rattachement est vraiment souhaite.
 *       Sans --roles, un nouveau compte recoit ADMIN_SYSTEME.
 *
 * Le script termine en affichant la ligne AUTH_ACCES_RAPIDE_COMPTES a coller
 * dans .env, puis il indique de redemarrer `npm run dev`.
 *
 * AVERTISSEMENT : a n'utiliser que sur une base de developpement. Le mot de
 * passe pose ici est volontairement dispense du changement a la premiere
 * connexion (sinon le bouton de portail renverrait vers l'ecran de changement de
 * mot de passe). En production, la reinitialisation passe par
 * Administration > Utilisateurs, qui impose ce changement.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  genererMotDePasseTemporaire,
  hacherMotDePasse,
  verifierRobustesseMotDePasse,
  REGLES_MOT_DE_PASSE,
} from "../src/lib/auth/password";
import { ACTIONS_AUDIT, MODULES_AUDIT } from "../src/lib/audit";
import { ROLE_DEFINITIONS } from "../src/lib/rbac/roles";

const prisma = new PrismaClient();

const ROLE_PAR_DEFAUT = "ADMIN_SYSTEME";
/** Prefixe des fiches techniques creees par ce script (jamais celui des vrais employes). */
const PREFIXE_MATRICULE = "ACC-";

interface Options {
  liste: boolean;
  email: string;
  motDePasse: string;
  generer: boolean;
  roles: string[];
  matricule: string;
  creerFiche: boolean;
  prenom: string;
  nom: string;
}

function lireOptions(): Options {
  const arguments_ = process.argv.slice(2);
  const valeur = (nom: string): string =>
    arguments_.find((argument) => argument.startsWith(`--${nom}=`))?.slice(nom.length + 3) ?? "";

  return {
    liste: arguments_.includes("--liste"),
    email: valeur("email").trim().toLowerCase(),
    motDePasse: valeur("motdepasse"),
    generer: arguments_.includes("--generer"),
    roles: valeur("roles")
      .split(",")
      .map((role) => role.trim().toUpperCase())
      .filter((role) => role.length > 0),
    matricule: valeur("matricule").trim(),
    creerFiche: arguments_.includes("--creer-fiche"),
    prenom: valeur("prenom").trim(),
    nom: valeur("nom").trim(),
  };
}

function titre(texte: string): void {
  console.log(`\n${texte}`);
  console.log("-".repeat(texte.length));
}

/**
 * Le mot de passe doit survivre a la lecture du fichier .env.
 *
 * Next.js developpe les variables a l'interieur des valeurs de .env : un « $ »
 * dans un mot de passe serait interprete comme un nom de variable et le mot de
 * passe enregistre ne serait plus le bon. Les autres caracteres exclus cassent
 * l'un ou l'autre des formats de fichier (separateurs, guillemets, echappement).
 *
 * Mot de passe illisible dans .env = « identifiants incorrects » inexplicable :
 * on refuse donc la valeur avant d'ecrire quoi que ce soit.
 */
const CARACTERES_INTERDITS_ENV = /[$;|"\\'`\r\n\t]/;

function motifRefusEnv(motDePasse: string): string | null {
  const trouve = motDePasse.match(CARACTERES_INTERDITS_ENV);
  if (!trouve) return null;

  const raisons: Record<string, string> = {
    $: "Next.js l'interprete comme un nom de variable et corrompt la valeur enregistree",
    ";": "c'est le separateur des entrees de AUTH_ACCES_RAPIDE_COMPTES",
    "|": "c'est le separateur des champs libelle/adresse/mot de passe",
    '"': "cela fermerait la valeur entre guillemets",
    "\\": "cela introduirait une sequence d'echappement",
    "'": "cela introduirait une sequence d'echappement",
    "`": "cela introduirait une sequence d'echappement",
  };

  const caractere = trouve[0];
  const affichage = caractere === "\r" || caractere === "\n" || caractere === "\t"
    ? "un retour a la ligne ou une tabulation"
    : `« ${caractere} »`;

  return `Le mot de passe contient ${affichage} : ${raisons[caractere] ?? "caractere refuse dans .env"}.`;
}

/** Mot de passe aleatoire conforme, et lisible sans ambiguite dans .env. */
function genererMotDePasseConforme(): string {
  for (let essai = 0; essai < 500; essai += 1) {
    const candidat = genererMotDePasseTemporaire(16);
    if (motifRefusEnv(candidat) !== null) continue;
    if (verifierRobustesseMotDePasse(candidat).valide) return candidat;
  }
  throw new Error(
    "Impossible de generer un mot de passe conforme. Verifiez la politique dans src/lib/auth/password.ts.",
  );
}

/** Refuse un mot de passe non conforme, en expliquant precisement pourquoi. */
function exigerMotDePasseConforme(motDePasse: string): void {
  const robustesse = verifierRobustesseMotDePasse(motDePasse);
  if (robustesse.valide) return;

  console.error("\nMot de passe refuse par la politique de securite :");
  for (const erreur of robustesse.erreurs) console.error(`  - ${erreur}`);
  console.error(`\nRegles : ${REGLES_MOT_DE_PASSE}`);
  console.error("\nExemple conforme : Plateforme-M3s!2026");
  console.error("Ou laissez le script en choisir un : --generer\n");
  process.exitCode = 1;
  throw new Error("Mot de passe non conforme.");
}

/**
 * Refuse un mot de passe que .env ne peut pas restituer a l'identique.
 * Verifie AVANT toute ecriture en base : un mot de passe pose puis illisible
 * dans .env produirait un « identifiants incorrects » impossible a diagnostiquer.
 */
function exigerMotDePasseLisibleEnEnv(motDePasse: string): void {
  const motif = motifRefusEnv(motDePasse);
  if (motif === null) return;

  console.error(`\n${motif}`);
  console.error(
    "Choisissez un mot de passe sans ces caracteres, ou laissez le script en\n" +
      "choisir un avec --generer : la generation ecarte deja ces caracteres.\n",
  );
  process.exitCode = 1;
  throw new Error("Mot de passe non transposable dans .env.");
}

async function chargerRoles(codes: string[]) {
  const roles = await prisma.role.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, label: true, isActive: true },
  });

  const inconnus = codes.filter((code) => !roles.some((role) => role.code === code));
  if (inconnus.length > 0) {
    throw new Error(
      `Roles inconnus : ${inconnus.join(", ")}. Roles disponibles : ${ROLE_DEFINITIONS.map((r) => r.code).join(", ")}.`,
    );
  }

  const inactifs = roles.filter((role) => !role.isActive);
  if (inactifs.length > 0) {
    throw new Error(
      `Roles desactives : ${inactifs.map((role) => role.code).join(", ")}. Reactivez-les depuis Administration > Roles.`,
    );
  }

  return roles;
}

async function modeListe(): Promise<void> {
  const comptes = await prisma.user.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      email: true,
      isActive: true,
      mustChangePassword: true,
      failedAttempts: true,
      lockedUntil: true,
      employee: { select: { matricule: true, firstName: true, lastName: true } },
      roles: { select: { role: { select: { code: true } } } },
    },
  });

  titre(`Comptes existants (${comptes.length})`);

  if (comptes.length === 0) {
    console.log("  Aucun compte en base.");
    console.log("\n  Creez-en un et connectez-vous tout de suite :");
    console.log("    npm run acces -- --email=admin@admedco.dz --generer");
    return;
  }

  for (const compte of comptes) {
    const identite = compte.employee
      ? `${compte.employee.firstName} ${compte.employee.lastName} (${compte.employee.matricule})`
      : "aucune fiche employe liee";
    console.log(`\n  n° ${compte.id}  ${compte.email}   [${compte.isActive ? "actif" : "desactive"}]`);
    console.log(`     Roles ................ ${compte.roles.map((l) => l.role.code).join(", ") || "aucun"}`);
    console.log(`     Fiche employe ........ ${identite}`);
    console.log(
      `     Mot de passe ......... ${compte.mustChangePassword ? "a changer a la prochaine connexion" : "defini par l'interesse"}`,
    );
    if (compte.lockedUntil && compte.lockedUntil > new Date()) {
      console.log(
        `     VERROUILLE ............ jusqu'a ${compte.lockedUntil.toISOString()} (${compte.failedAttempts} echecs)`,
      );
    }
  }

  console.log(
    "\n  Aucun mot de passe n'est stocke en clair : cette liste ne peut pas les afficher.",
  );
  console.log("  Pour repartir d'un mot de passe connu :");
  console.log("    npm run acces -- --email=<adresse> --generer");
}

/**
 * Matricule libre de la forme ACC-0001.
 * `Employee.matricule` est unique : deux fiches creees par ce script ne peuvent
 * donc pas partager le meme numero.
 */
async function prochainMatricule(): Promise<string> {
  const existants = await prisma.employee.findMany({
    where: { matricule: { startsWith: PREFIXE_MATRICULE } },
    select: { matricule: true },
  });

  const numeros = existants
    .map((fiche) => Number.parseInt(fiche.matricule.slice(PREFIXE_MATRICULE.length), 10))
    .filter((numero) => Number.isFinite(numero));

  const suivant = (numeros.length > 0 ? Math.max(...numeros) : 0) + 1;
  return `${PREFIXE_MATRICULE}${String(suivant).padStart(4, "0")}`;
}

/**
 * Determine la fiche employe a rattacher, sans jamais en inventer une.
 * Renvoie null quand aucun rattachement n'est demande : c'est le cas normal des
 * comptes de bureau, que la plateforme gere explicitement (le portail affiche
 * alors « compte non rattache a une fiche employe »).
 */
async function resoudreFiche(
  options: Options,
): Promise<{ id: number; matricule: string } | { creation: { matricule: string; prenom: string; nom: string } } | null> {
  if (options.matricule) {
    const fiche = await prisma.employee.findUnique({
      where: { matricule: options.matricule },
      select: { id: true, matricule: true, firstName: true, lastName: true, userId: true },
    });

    if (!fiche) {
      throw new Error(
        `Aucune fiche employe avec le matricule « ${options.matricule} ». ` +
          "Creez la fiche (RH > Employes, ou import CSV) avant de creer le compte : " +
          "ce script n'invente aucune donnee RH.",
      );
    }

    if (fiche.userId) {
      throw new Error(
        `${fiche.firstName} ${fiche.lastName} (${fiche.matricule}) possede deja un compte nominatif.`,
      );
    }

    return { id: fiche.id, matricule: fiche.matricule };
  }

  if (!options.creerFiche) return null;

  return {
    creation: {
      matricule: await prochainMatricule(),
      prenom: options.prenom || "Compte",
      nom: options.nom || "Developpement",
    },
  };
}

/** Cree le compte manquant et journalise l'operation. */
async function creerCompte(
  email: string,
  motDePasse: string,
  options: Options,
): Promise<number> {
  const codes = options.roles.length > 0 ? options.roles : [ROLE_PAR_DEFAUT];
  const roles = await chargerRoles(codes);
  const passwordHash = await hacherMotDePasse(motDePasse);
  const fiche = await resoudreFiche(options);

  const utilisateur = await prisma.$transaction(async (tx) => {
    const cree = await tx.user.create({
      data: { email, passwordHash, isActive: true, mustChangePassword: false },
    });

    for (const role of roles) {
      await tx.userRole.create({ data: { userId: cree.id, roleId: role.id } });
    }

    if (fiche && "id" in fiche) {
      // Rattachement a une fiche existante : elle n'est jamais dupliquee.
      await tx.employee.update({
        where: { id: fiche.id },
        data: { userId: cree.id, email },
      });
    } else if (fiche && "creation" in fiche) {
      await tx.employee.create({
        data: {
          matricule: fiche.creation.matricule,
          firstName: fiche.creation.prenom,
          lastName: fiche.creation.nom,
          email,
          jobTitle: "Compte d'acces direct (developpement)",
          factory: "COMMUN",
          isActive: true,
          userId: cree.id,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        action: ACTIONS_AUDIT.UTILISATEUR_CREE,
        module: MODULES_AUDIT.SYSTEME,
        entity: "User",
        entityId: String(cree.id),
        userId: null,
        userEmail: email,
        newValue: {
          origine: "script-acces-direct",
          roles: roles.map((role) => role.code),
          motDePasseChoisi: true,
          matricule: fiche && "id" in fiche ? fiche.matricule : (fiche?.creation.matricule ?? null),
        },
        comment:
          "Creation d'un compte d'acces direct en ligne de commande, pour le developpement local.",
        reason: "Acces direct au poste de developpement",
      },
    });

    return cree;
  });

  const rattachement =
    fiche && "id" in fiche
      ? `${fiche.matricule} (fiche existante rattachee)`
      : fiche && "creation" in fiche
        ? `${fiche.creation.matricule} (fiche technique creee)`
        : "aucune — compte de bureau, sans fiche employe";

  console.log(`\n  Compte cree : ${email} (n° ${utilisateur.id})`);
  console.log(`  Roles ....... ${roles.map((role) => role.code).join(", ")}`);
  console.log(`  Fiche ....... ${rattachement}`);

  return utilisateur.id;
}

/** Repose un mot de passe connu sur un compte existant, et coupe ses sessions. */
async function reinitialiserCompte(
  utilisateur: { id: number; email: string; isActive: boolean },
  motDePasse: string,
): Promise<void> {
  const passwordHash = await hacherMotDePasse(motDePasse);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: utilisateur.id },
      data: {
        passwordHash,
        // Volontairement false : le bouton de portail doit ouvrir la plateforme
        // directement, pas l'ecran de changement de mot de passe.
        mustChangePassword: false,
        isActive: true,
        failedAttempts: 0,
        lockedUntil: null,
        disabledAt: null,
      },
    });

    // Un mot de passe change doit invalider toutes les sessions ouvertes.
    await tx.session.updateMany({
      where: { userId: utilisateur.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        action: ACTIONS_AUDIT.MOT_DE_PASSE_REINITIALISE,
        module: MODULES_AUDIT.AUTHENTIFICATION,
        entity: "User",
        entityId: String(utilisateur.id),
        userId: null,
        userEmail: utilisateur.email,
        reason: "Acces direct au poste de developpement",
        comment:
          "Mot de passe repose en ligne de commande (script-acces-direct). Sessions ouvertes revoquees.",
      },
    });
  });

  console.log(`\n  Mot de passe repose sur ${utilisateur.email} (n° ${utilisateur.id})`);
  console.log("  Compte reactive et deverrouille, sessions ouvertes revoquees.");
}

interface EntreeAcces {
  libelle: string;
  email: string;
  motDePasse: string;
}

/** Relit la liste d'acces rapide deja presente dans .env. */
function lireEntreesEnv(contenu: string): EntreeAcces[] {
  const brut = contenu.match(/^AUTH_ACCES_RAPIDE_COMPTES=(.*)$/m)?.[1] ?? "";

  return brut
    .trim()
    .replace(/^"(.*)"$/s, "$1")
    .split(/[;\r\n]+/)
    .map((ligne) => {
      const champs = ligne.trim().split("|");
      return {
        libelle: (champs.shift() ?? "").trim(),
        email: (champs.shift() ?? "").trim(),
        motDePasse: champs.join("|").trim(),
      };
    })
    .filter(
      (entree) =>
        entree.libelle.length > 0 &&
        entree.email.includes("@") &&
        entree.motDePasse.length > 0,
    );
}

/**
 * Inscrit le compte dans .env, en CONSERVANT les autres entrees.
 *
 * Le but est d'ajouter un portail en une commande, sans recopier a la main une
 * liste qui ne cesse de s'allonger. Une entree de meme adresse est remplacee :
 * relancer la commande ne cree jamais de doublon.
 */
function mettreAJourEnv(libelle: string, email: string, motDePasse: string): void {
  const chemin = path.join(process.cwd(), ".env");
  const libelleSur = libelle.replace(/\|/g, "/");

  if (!existsSync(chemin)) {
    titre("A coller dans .env (fichier absent de ce dossier)");
    console.log(`  AUTH_ACCES_RAPIDE="true"`);
    console.log(`  AUTH_ACCES_RAPIDE_COMPTES="${libelleSur}|${email}|${motDePasse}"`);
    console.log("\n  Puis redemarrez : npm run dev");
    return;
  }

  const contenu = readFileSync(chemin, "utf8");
  const toutes = [
    ...lireEntreesEnv(contenu).filter((entree) => entree.email !== email),
    { libelle: libelleSur, email, motDePasse },
  ];
  const valeur = `"${toutes.map((e) => `${e.libelle}|${e.email}|${e.motDePasse}`).join(";")}"`;

  let misAJour = /^AUTH_ACCES_RAPIDE=/m.test(contenu)
    ? contenu.replace(/^AUTH_ACCES_RAPIDE=.*$/m, 'AUTH_ACCES_RAPIDE="true"')
    : `${contenu.trimEnd()}\nAUTH_ACCES_RAPIDE="true"\n`;

  misAJour = /^AUTH_ACCES_RAPIDE_COMPTES=/m.test(misAJour)
    ? misAJour.replace(/^AUTH_ACCES_RAPIDE_COMPTES=.*$/m, `AUTH_ACCES_RAPIDE_COMPTES=${valeur}`)
    : `${misAJour.trimEnd()}\nAUTH_ACCES_RAPIDE_COMPTES=${valeur}\n`;

  writeFileSync(chemin, misAJour, "utf8");

  titre(`Fichier .env mis a jour — ${toutes.length} portail(aux) au total`);
  for (const entree of toutes) {
    console.log(`   - ${entree.libelle} <${entree.email}>`);
  }
  console.log("\n  Redemarrez pour que la page de connexion les affiche : npm run dev");
}

async function principal(): Promise<void> {
  const options = lireOptions();

  if (options.liste || (!options.email && !options.generer)) {
    if (!options.email && !options.generer && !options.liste) {
      console.log("Acces direct de developpement — fixer un mot de passe connu.\n");
      console.log("  npm run acces -- --liste");
      console.log("  npm run acces -- --email=<adresse> --generer");
      console.log("  npm run acces -- --email=<adresse> --motdepasse=Plateforme-M3s!2026");
      console.log("  npm run acces -- --email=<adresse> --generer --roles=DIRECTION --matricule=EMP-0007");
      console.log("\n  Regles de mot de passe : " + REGLES_MOT_DE_PASSE);
    }
    if (options.liste) await modeListe();
    return;
  }

  if (!options.email) throw new Error("Precisez l'adresse : --email=admin@admedco.dz");

  const motDePasse = options.generer ? genererMotDePasseConforme() : options.motDePasse;
  if (!motDePasse) {
    throw new Error(
      "Precisez le mot de passe (--motdepasse=...) ou laissez le script en choisir un (--generer).",
    );
  }

  if (!options.generer) {
    exigerMotDePasseConforme(motDePasse);
    exigerMotDePasseLisibleEnEnv(motDePasse);
  }

  const existant = await prisma.user.findUnique({
    where: { email: options.email },
    select: { id: true, email: true, isActive: true },
  });

  if (existant) {
    await reinitialiserCompte(existant, motDePasse);
  } else {
    await creerCompte(options.email, motDePasse, options);
  }

  const role = options.roles[0] ?? ROLE_PAR_DEFAUT;
  const definition = ROLE_DEFINITIONS.find((r) => r.code === role);
  mettreAJourEnv(definition?.label ?? role, options.email, motDePasse);

  titre("Mot de passe");
  console.log(`  ${motDePasse}`);
  console.log("\n  Notez-le maintenant : aucun mot de passe n'est lisible en base (hachage scrypt).");
}

principal()
  .catch((erreur) => {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    console.error(`\nOperation interrompue : ${message}`);
    if (message.includes("Can't reach database server") || message.includes("ECONNREFUSED")) {
      console.error(
        "\nLa base PostgreSQL n'est pas joignable sur localhost:5433.\n" +
          "  1. Demarrez Docker Desktop et attendez « Engine running ».\n" +
          "  2. docker start erpmes-postgres\n" +
          "  3. Relancez cette commande.",
      );
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
