/**
 * Gestion des comptes nominatifs en ligne de commande.
 *
 * AUCUN mot de passe n'est code en dur dans ce depot : chaque mot de passe est
 * tire aleatoirement, affiche une seule fois, hache immediatement, et le compte
 * doit le changer a sa premiere connexion. Chaque personne doit disposer de son
 * propre compte : aucun compte partage n'est cree.
 *
 * Utilisation :
 *   npm run comptes -- --amorcer --domaine=admedco.dz
 *       CREE TOUT EN UNE FOIS : le premier administrateur, puis un compte par
 *       role du referentiel, et affiche le tableau des identifiants et des mots
 *       de passe temporaires. C'est la commande a lancer apres `npm run setup`.
 *
 *   npm run comptes -- --liste
 *       Affiche tous les comptes : identifiant, adresse, roles, fiche employe,
 *       etat, changement de mot de passe en attente.
 *
 *   npm run comptes -- --email=direction@admedco.dz --roles=DIRECTION
 *       Cree un compte nominatif et affiche son mot de passe temporaire.
 *
 *   npm run comptes -- --email=operateur1@admedco.dz --roles=OPERATEUR_ADMEDCO --employe=EMP-0007
 *       Cree le compte et le rattache a une fiche employe EXISTANTE (le portail
 *       employe exige cette liaison). La fiche n'est jamais inventee par ce
 *       script : elle doit avoir ete creee ou importee au prealable.
 *
 *   npm run comptes -- --tous --domaine=admedco.dz --prefixe=revue
 *       Cree un compte par role, sans creer d'administrateur.
 *
 *   npm run comptes -- --desactiver --domaine=admedco.dz
 *       Desactive tous les comptes d'un domaine (fin de revue). Le compte n'est
 *       jamais supprime : il est desactive et l'operation est journalisee.
 */

import { PrismaClient } from "@prisma/client";
import {
  genererMotDePasseTemporaire,
  hacherMotDePasse,
  verifierRobustesseMotDePasse,
} from "../src/lib/auth/password";
import { ACTIONS_AUDIT, MODULES_AUDIT } from "../src/lib/audit";
import { ROLE_DEFINITIONS } from "../src/lib/rbac/roles";

const prisma = new PrismaClient();

const DOMAINE_PAR_DEFAUT = "admedco.dz";
const ROLE_ADMIN = "ADMIN_SYSTEME";

interface Options {
  amorcer: boolean;
  liste: boolean;
  tous: boolean;
  desactiver: boolean;
  email: string;
  roles: string[];
  employe: string;
  domaine: string;
  prefixe: string;
}

interface CompteCree {
  userId: number;
  email: string;
  motDePasse: string;
  roles: string[];
  employe: string | null;
}

function lireOptions(): Options {
  const arguments_ = process.argv.slice(2);
  const valeur = (nom: string): string =>
    arguments_.find((argument) => argument.startsWith(`--${nom}=`))?.slice(nom.length + 3) ?? "";

  return {
    amorcer: arguments_.includes("--amorcer"),
    liste: arguments_.includes("--liste"),
    tous: arguments_.includes("--tous"),
    desactiver: arguments_.includes("--desactiver"),
    email: valeur("email").trim().toLowerCase(),
    roles: valeur("roles")
      .split(",")
      .map((role) => role.trim().toUpperCase())
      .filter((role) => role.length > 0),
    employe: valeur("employe").trim(),
    domaine: valeur("domaine").trim().toLowerCase().replace(/^@/, ""),
    prefixe: valeur("prefixe").trim().toLowerCase() || "revue",
  };
}

function titre(texte: string): void {
  console.log(`\n${texte}`);
  console.log("-".repeat(texte.length));
}

/** Genere un mot de passe temporaire conforme a la politique de la plateforme. */
function genererMotDePasseValide(): string {
  for (let essai = 0; essai < 100; essai += 1) {
    const candidat = genererMotDePasseTemporaire(16);
    if (verifierRobustesseMotDePasse(candidat).valide) return candidat;
  }
  throw new Error("Impossible de generer un mot de passe conforme a la politique.");
}

/** Adresse suggeree pour un role lors de la creation en lot. */
function adressePourRole(code: string, domaine: string, prefixe: string): string {
  return `${prefixe}.${code.toLowerCase()}@${domaine}`;
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

/** Cree un compte nominatif et renvoie le mot de passe temporaire (une seule fois). */
async function creerCompte(entree: {
  email: string;
  codesRoles: string[];
  matricule?: string | null;
  motDePasse?: string;
  ficheEmploye?: { matricule: string; prenom: string; nom: string; fonction: string } | null;
}): Promise<CompteCree> {
  const roles = await chargerRoles(entree.codesRoles);

  const existant = await prisma.user.findUnique({ where: { email: entree.email } });
  if (existant) {
    throw new Error(
      `L'adresse « ${entree.email} » est deja utilisee (compte n° ${existant.id}). Pour un nouveau mot de passe temporaire, utilisez Administration > Utilisateurs (ou --liste pour verifier).`,
    );
  }

  const motDePasse = entree.motDePasse ?? genererMotDePasseValide();
  if (entree.motDePasse) {
    const robustesse = verifierRobustesseMotDePasse(entree.motDePasse);
    if (!robustesse.valide) {
      throw new Error(
        `Le mot de passe fourni est refuse par la politique de securite : ${robustesse.erreurs.join(" ")}`,
      );
    }
  }
  const passwordHash = await hacherMotDePasse(motDePasse);

  let employeId: number | null = null;
  let matricule: string | null = null;

  if (entree.matricule) {
    const employe = await prisma.employee.findUnique({
      where: { matricule: entree.matricule },
      select: { id: true, matricule: true, firstName: true, lastName: true, userId: true },
    });
    if (!employe) {
      throw new Error(
        `Aucune fiche employe avec le matricule « ${entree.matricule} ». Creez la fiche (ou importez COM_ThirdParty) avant de creer le compte : le script n'invente aucune donnee RH.`,
      );
    }
    if (employe.userId) {
      throw new Error(
        `${employe.firstName} ${employe.lastName} (${employe.matricule}) possede deja un compte nominatif.`,
      );
    }
    employeId = employe.id;
    matricule = employe.matricule;
  }

  const compte = await prisma.$transaction(async (tx) => {
    const utilisateur = await tx.user.create({
      data: {
        email: entree.email,
        passwordHash,
        isActive: true,
        mustChangePassword: true,
      },
    });

    for (const role of roles) {
      await tx.userRole.create({ data: { userId: utilisateur.id, roleId: role.id } });
    }

    let matriculeEmploye: string | null = null;

    if (entree.ficheEmploye) {
      const employe = await tx.employee.create({
        data: {
          matricule: entree.ficheEmploye.matricule,
          firstName: entree.ficheEmploye.prenom,
          lastName: entree.ficheEmploye.nom,
          email: entree.email,
          jobTitle: entree.ficheEmploye.fonction,
          factory: "COMMUN",
          isActive: true,
          userId: utilisateur.id,
        },
      });
      matriculeEmploye = employe.matricule;
    } else if (employeId !== null) {
      await tx.employee.update({
        where: { id: employeId },
        data: { userId: utilisateur.id, email: entree.email },
      });
      matriculeEmploye = matricule;
    }

    await tx.auditLog.create({
      data: {
        action: ACTIONS_AUDIT.UTILISATEUR_CREE,
        module: MODULES_AUDIT.SYSTEME,
        entity: "User",
        entityId: String(utilisateur.id),
        userId: null,
        userEmail: entree.email,
        newValue: {
          origine: "script-comptes",
          roles: roles.map((role) => role.code),
          matricule: matriculeEmploye,
          motDePasseTemporaire: true,
        },
        comment:
          "Creation d'un compte nominatif en ligne de commande : mot de passe aleatoire affiche une seule fois, changement obligatoire a la premiere connexion.",
      },
    });

    return utilisateur;
  });

  return {
    userId: compte.id,
    email: compte.email,
    motDePasse,
    roles: roles.map((role) => role.code),
    employe: employeId !== null ? matricule : (entree.ficheEmploye?.matricule ?? null),
  };
}

function afficherCreations(creations: CompteCree[]): void {
  titre(`Comptes crees (${creations.length}) — mots de passe temporaires`);
  console.log("Copiez ce tableau maintenant : ces mots de passe ne seront plus jamais affiches.\n");

  for (const creation of creations) {
    const definition = ROLE_DEFINITIONS.find((role) => creation.roles.includes(role.code));
    const portee =
      definition?.factoryScope === "COMMUN"
        ? "les deux usines"
        : (definition?.factoryScope ?? "transversale");
    console.log(`  ${creation.email}`);
    console.log(`     Identifiant (n° compte) ... ${creation.userId}`);
    console.log(`     Role ...................... ${creation.roles.join(", ")}`);
    console.log(`     Libelle ................... ${definition?.label ?? "-"}`);
    console.log(`     Portee par defaut ......... ${portee}`);
    console.log(`     Fiche employe ............. ${creation.employe ?? "non liee"}`);
    console.log(`     MOT DE PASSE TEMPORAIRE ... ${creation.motDePasse}`);
    console.log("");
  }

  console.log(
    "Changement de mot de passe obligatoire a la premiere connexion. Aucun mot de passe n'est enregistre en clair.",
  );
}

function afficherPortes(): void {
  titre("Portes d'entree (http://localhost:3000)");
  console.log("  /connexion                 page de connexion");
  console.log("  /tableau-de-bord           tableaux de bord selon le role");
  console.log("  /portail                   portail employe (OPERATEUR_ADMEDCO, OPERATEUR_MOBILIX)");
  console.log("  /production/kanban         kanban ADMEDCO (6 colonnes) / MOBILIX (12 colonnes)");
  console.log("  /ventes  /achats  /stock  /qualite  /comptabilite  /rh  /nomenclature");
  console.log("  /administration/utilisateurs  /administration/roles  /administration/import");
  console.log("  /administration/parametres    /administration/audit");
  console.log(
    "\nUn role sans permission ouvre /aucun-acces : c'est le cloisonnement attendu, pas une erreur.",
  );
}

async function modeListe(): Promise<void> {
  const comptes = await prisma.user.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      email: true,
      isActive: true,
      mustChangePassword: true,
      lastLoginAt: true,
      employee: { select: { matricule: true, firstName: true, lastName: true } },
      roles: {
        select: { role: { select: { code: true, label: true } } },
        orderBy: { role: { sortOrder: "asc" } },
      },
    },
  });

  titre(`Comptes existants (${comptes.length})`);

  if (comptes.length === 0) {
    console.log("Aucun compte. Lancez : npm run comptes -- --amorcer --domaine=admedco.dz");
    return;
  }

  for (const compte of comptes) {
    const identite = compte.employee
      ? `${compte.employee.firstName} ${compte.employee.lastName} (${compte.employee.matricule})`
      : "aucune fiche employe liee";
    console.log(`\n  n° ${compte.id}  ${compte.email}`);
    console.log(`     Etat ................. ${compte.isActive ? "actif" : "desactive"}`);
    console.log(
      `     Mot de passe ......... ${compte.mustChangePassword ? "changement obligatoire a la prochaine connexion" : "defini par l'interesse"}`,
    );
    console.log(
      `     Derniere connexion ... ${compte.lastLoginAt ? compte.lastLoginAt.toISOString() : "jamais"}`,
    );
    console.log(
      `     Roles ................ ${compte.roles.map((lien) => lien.role.code).join(", ") || "aucun"}`,
    );
    console.log(`     Fiche employe ........ ${identite}`);
  }

  console.log(
    "\nAucun mot de passe n'est stocke en clair : cette liste ne peut pas les afficher.",
  );
}

async function modeDesactivation(domaine: string): Promise<void> {
  if (!domaine) throw new Error("Precisez le domaine : --desactiver --domaine=admedco.dz");

  const comptes = await prisma.user.findMany({
    where: { email: { endsWith: `@${domaine}` }, isActive: true },
    select: { id: true, email: true },
  });

  if (comptes.length === 0) {
    console.log(`Aucun compte actif sur le domaine @${domaine}.`);
    return;
  }

  titre(`Desactivation de ${comptes.length} compte(s) sur @${domaine}`);

  for (const compte of comptes) {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: compte.id },
        data: { isActive: false, disabledAt: new Date() },
      });
      // Les sessions ouvertes sont coupees immediatement (revocation, jamais de
      // suppression : la tracabilite de la connexion est conservee).
      await tx.session.updateMany({
        where: { userId: compte.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          action: ACTIONS_AUDIT.UTILISATEUR_DESACTIVE,
          module: MODULES_AUDIT.SYSTEME,
          entity: "User",
          entityId: String(compte.id),
          userId: null,
          userEmail: compte.email,
          newValue: { origine: "script-comptes", isActive: false },
          comment: "Desactivation d'un compte en ligne de commande (fin de revue d'acces).",
        },
      });
    });
    console.log(`  desactive : ${compte.email} (n° ${compte.id})`);
  }

  console.log("\nLes comptes sont desactives, jamais supprimes : le journal d'audit reste lisible.");
}

/**
 * Amorçage complet : premier administrateur puis un compte par role.
 * Le mot de passe de l'administrateur peut etre impose par
 * BOOTSTRAP_ADMIN_PASSWORD ; sinon il est genere aleatoirement.
 */
async function modeAmorcage(options: Options): Promise<void> {
  const domaine = options.domaine || DOMAINE_PAR_DEFAUT;
  const creations: CompteCree[] = [];

  const nbRoles = await prisma.role.count();
  if (nbRoles === 0) {
    throw new Error(
      "Le referentiel n'est pas charge (aucun role en base). Lancez d'abord : npm run setup",
    );
  }

  const roleAdmin = await prisma.role.findUnique({
    where: { code: ROLE_ADMIN },
    select: { id: true, code: true },
  });
  if (!roleAdmin) {
    throw new Error(`Le role ${ROLE_ADMIN} est absent : lancez d'abord : npm run setup`);
  }

  const adminsActifs = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { roleId: roleAdmin.id } } },
    select: { id: true, email: true },
    orderBy: { id: "asc" },
  });

  titre("Amorcage des comptes");

  if (adminsActifs.length > 0) {
    console.log(
      `  Administrateur deja en place : ${adminsActifs.map((compte) => `${compte.email} (n° ${compte.id})`).join(", ")}`,
    );
    console.log("  Aucun second administrateur n'est cree automatiquement : c'est volontaire.");
  } else {
    // Un mot de passe impose n'est accepte que s'il respecte la politique.
    const motDePasseImpose = (process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "").trim();
    if (motDePasseImpose) {
      const robustesse = verifierRobustesseMotDePasse(motDePasseImpose);
      if (!robustesse.valide) {
        throw new Error(
          `BOOTSTRAP_ADMIN_PASSWORD est refuse par la politique (${robustesse.erreurs.join(" ")}) ` +
            "Supprimez cette variable du .env : un mot de passe aleatoire conforme sera genere.",
        );
      }
    }

    const emailAdmin =
      options.email || (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").trim().toLowerCase() || `admin@${domaine}`;

    const admin = await creerCompte({
      email: emailAdmin,
      codesRoles: [ROLE_ADMIN],
      motDePasse: motDePasseImpose || undefined,
      ficheEmploye: {
        matricule: (process.env.BOOTSTRAP_ADMIN_MATRICULE ?? "").trim() || "ADM-0001",
        prenom: (process.env.BOOTSTRAP_ADMIN_PRENOM ?? "").trim() || "Administrateur",
        nom: (process.env.BOOTSTRAP_ADMIN_NOM ?? "").trim() || "Systeme",
        fonction: "Administrateur de la plateforme",
      },
    });
    creations.push(admin);
    console.log(`  Administrateur cree : ${admin.email} (n° ${admin.userId})`);
  }

  console.log(`\n  Un compte par role (${ROLE_DEFINITIONS.length} roles, prefixe « ${options.prefixe} ») sur @${domaine}`);

  for (const definition of ROLE_DEFINITIONS) {
    if (definition.code === ROLE_ADMIN) continue;

    const email = adressePourRole(definition.code, domaine, options.prefixe);
    const existant = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existant) {
      console.log(`  deja existant : ${email} (n° ${existant.id})`);
      continue;
    }

    const compte = await creerCompte({ email, codesRoles: [definition.code] });
    creations.push(compte);
    console.log(`  cree : ${email} (n° ${compte.userId}) — ${definition.label}`);
  }

  if (creations.length > 0) {
    afficherCreations(creations);
    console.log(
      "\nSi BOOTSTRAP_ADMIN_PASSWORD etait renseigne dans .env, retirez-le maintenant.",
    );
  } else {
    console.log("\nAucun compte a creer : tous existent deja.");
  }

  console.log(
    "\nLe portail employe (/portail) exige en plus une fiche employe liee : utilisez\n" +
      "  npm run comptes -- --email=operateur1@<domaine> --roles=OPERATEUR_ADMEDCO --employe=MATRICULE",
  );
}

async function modeCreation(options: Options): Promise<void> {
  const creations: CompteCree[] = [];

  if (options.tous) {
    if (!options.domaine) {
      throw new Error(
        "Precisez le domaine des adresses : npm run comptes -- --tous --domaine=admedco.dz",
      );
    }

    titre(`Creation d'un compte par role (${ROLE_DEFINITIONS.length} roles)`);
    for (const definition of ROLE_DEFINITIONS) {
      creations.push(
        await creerCompte({
          email: adressePourRole(definition.code, options.domaine, options.prefixe),
          codesRoles: [definition.code],
        }),
      );
    }
  } else {
    if (!options.email || options.roles.length === 0) {
      throw new Error(
        "Indiquez l'adresse et au moins un role : npm run comptes -- --email=nom@domaine --roles=DIRECTION,COMMERCIAL",
      );
    }
    creations.push(
      await creerCompte({
        email: options.email,
        codesRoles: options.roles,
        matricule: options.employe || null,
      }),
    );
  }

  afficherCreations(creations);
}

async function principal(): Promise<void> {
  const options = lireOptions();

  const aucunMode =
    !options.amorcer && !options.liste && !options.tous && !options.desactiver && !options.email;
  if (aucunMode) {
    console.log("Gestion des comptes nominatifs — aucun mot de passe n'est code en dur.\n");
    console.log("  npm run comptes -- --amorcer --domaine=admedco.dz   <-- tout creer en une fois");
    console.log("  npm run comptes -- --liste");
    console.log("  npm run comptes -- --email=nom@domaine --roles=DIRECTION");
    console.log(
      "  npm run comptes -- --email=operateur@domaine --roles=OPERATEUR_ADMEDCO --employe=EMP-0007",
    );
    console.log("  npm run comptes -- --tous --domaine=admedco.dz");
    console.log("  npm run comptes -- --desactiver --domaine=admedco.dz");
    afficherPortes();
    return;
  }

  if (options.amorcer) await modeAmorcage(options);
  if (options.liste) await modeListe();
  if (options.desactiver) await modeDesactivation(options.domaine);
  if (options.tous || (options.email && !options.amorcer)) await modeCreation(options);

  if (!options.liste) afficherPortes();
}

principal()
  .catch((erreur) => {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    console.error(`\nOperation refusee : ${message}`);
    if (message.includes("Can't reach database server")) {
      console.error(
        "\nLa base PostgreSQL n'est pas joignable sur localhost:5433.\n" +
          "  1. Demarrez Docker Desktop (application Windows), attendez « Engine running ».\n" +
          "  2. docker start erpmes-postgres\n" +
          "     (si le conteneur n'existe pas : voir la commande `docker run` du RAPPORT-FINAL.md)\n" +
          "  3. npm run setup   (migrations + referentiel)\n" +
          "  4. npm run comptes -- --amorcer --domaine=admedco.dz",
      );
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
