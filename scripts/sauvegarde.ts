/**
 * Sauvegarde et restauration de la base PostgreSQL de la plateforme.
 *
 * Pourquoi ce script existe
 * -------------------------
 * Toute la valeur de la plateforme vit dans PostgreSQL : les articles, les
 * tiers, les lots et les unites de stock importees. Les migrations et le
 * referentiel de base sont rejouables, mais l'import des donnees reelles ne
 * l'est pas en quelques minutes. Sans sauvegarde verifiee, une panne de disque
 * efface des semaines de reprise de donnees.
 *
 * Ce script produit une archive au format "custom" de pg_dump (compressee,
 * restaurable selectivement) et surtout il VERIFIE l'archive apres l'avoir
 * ecrite : une sauvegarde non testee n'est pas une sauvegarde.
 *
 * Utilisation
 * -----------
 *   npm run backup
 *       Cree une sauvegarde horodatee dans backups/ et verifie son integrite.
 *
 *   npm run backup -- --dossier=D:/sauvegardes
 *       Ecrit dans un autre dossier (disque externe, partage reseau). A
 *       preferer : une sauvegarde sur le meme disque ne protege pas d'une panne.
 *
 *   npm run backup -- --garder=30
 *       Ne conserve que les 30 sauvegardes les plus recentes (defaut : 30).
 *
 *   npm run restore -- --fichier=backups/erpmes-....dump
 *       Affiche ce que ferait la restauration, sans rien executer.
 *
 *   npm run restore -- --fichier=... --confirmer
 *       Restaure reellement (la base applicative est REMPLACEE).
 *
 *   npm run restore -- --fichier=... --base=erpmes_essai --confirmer
 *       Restaure dans une base separee : la maniere sure de tester une
 *       sauvegarde sans toucher aux donnees de production.
 *
 * Securite : ce script n'utilise que les outils PostgreSQL officiels et ne
 * supprime un fichier que dans le dossier de sauvegarde, pour la retention.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

// @prisma/client charge .env des l'import (comportement de Prisma) : on s'appuie
// sur lui pour que DATABASE_URL soit disponible sans ajouter de dependance.
// L'import est volontairement place avant toute lecture de process.env.
import "@prisma/client";

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

interface Connexion {
  utilisateur: string;
  motDePasse: string;
  hote: string;
  port: string;
  base: string;
}

/** Analyse DATABASE_URL. Aucune valeur n'est devinee : une URL illisible arrete. */
function analyserConnexion(): Connexion {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL est absent. Copiez .env.example vers .env avant de sauvegarder.",
    );
  }

  let analyse: URL;
  try {
    analyse = new URL(url);
  } catch {
    throw new Error(
      "DATABASE_URL est illisible. Format attendu : postgresql://utilisateur:motdepasse@hote:port/base",
    );
  }

  if (!/^postgres(ql)?:$/.test(analyse.protocol)) {
    throw new Error(
      `DATABASE_URL doit etre une connexion PostgreSQL (recu « ${analyse.protocol} »).`,
    );
  }

  const base = analyse.pathname.replace(/^\//, "").split("?")[0];
  if (!base) throw new Error("DATABASE_URL ne nomme aucune base de donnees.");

  return {
    utilisateur: decodeURIComponent(analyse.username),
    motDePasse: decodeURIComponent(analyse.password),
    hote: analyse.hostname,
    port: analyse.port || "5432",
    base,
  };
}

// -----------------------------------------------------------------------------
// Detection du mode : conteneur Docker ou PostgreSQL natif
// -----------------------------------------------------------------------------

interface Mode {
  type: "docker" | "natif";
  conteneur?: string;
  pgDump: string;
  pgRestore: string;
  psql: string;
}

/**
 * Cherche un conteneur Docker publiant le port de la base ET contenant la base.
 *
 * Le projet demarre PostgreSQL dans le conteneur « erpmes-postgres ». Utiliser
 * ses outils garantit un pg_dump de la meme version que le serveur : un pg_dump
 * plus ancien refuse de lire un serveur plus recent.
 */
function detecterDocker(connexion: Connexion): string | null {
  const liste = spawnSync(
    "docker",
    ["ps", "--filter", `publish=${connexion.port}`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  );
  if (liste.status !== 0) return null;

  const noms = (liste.stdout ?? "")
    .split(/\r?\n/)
    .map((ligne) => ligne.trim())
    .filter(Boolean);

  for (const nom of noms) {
    const test = spawnSync(
      "docker",
      ["exec", "-e", `PGPASSWORD=${connexion.motDePasse}`, nom,
       "psql", "-U", connexion.utilisateur, "-d", "postgres", "-tAc",
       `SELECT 1 FROM pg_database WHERE datname = '${connexion.base}'`],
      { encoding: "utf8" },
    );
    if (test.status === 0 && (test.stdout ?? "").trim() === "1") return nom;
  }
  return null;
}

function resoudreMode(connexion: Connexion): Mode {
  const conteneur = detecterDocker(connexion);
  if (conteneur) {
    return {
      type: "docker",
      conteneur,
      pgDump: "pg_dump",
      pgRestore: "pg_restore",
      psql: "psql",
    };
  }

  const racines = [
    "C:/Program Files/PostgreSQL/18/bin",
    "C:/Program Files/PostgreSQL/17/bin",
    "C:/Program Files/PostgreSQL/16/bin",
  ];
  const trouvee = racines.find((r) => existsSync(join(r, "pg_dump.exe")));
  if (!trouvee) {
    throw new Error(
      "PostgreSQL introuvable.\n" +
        "  - soit le conteneur n'est pas demarre :\n" +
        "      docker start erpmes-postgres\n" +
        "  - soit PostgreSQL doit etre installe localement.",
    );
  }
  return {
    type: "natif",
    pgDump: join(trouvee, "pg_dump.exe"),
    pgRestore: join(trouvee, "pg_restore.exe"),
    psql: join(trouvee, "psql.exe"),
  };
}

// -----------------------------------------------------------------------------
// Execution des outils, en local ou dans le conteneur
// -----------------------------------------------------------------------------

function executer(
  mode: Mode,
  connexion: Connexion,
  outil: "pg_dump" | "pg_restore" | "psql",
  arguments_: string[],
): { status: number; stdout: string; stderr: string } {
  const binaire =
    outil === "pg_dump" ? mode.pgDump : outil === "pg_restore" ? mode.pgRestore : mode.psql;

  const resultat =
    mode.type === "docker"
      ? spawnSync(
          "docker",
          ["exec", "-e", `PGPASSWORD=${connexion.motDePasse}`, mode.conteneur!, binaire, ...arguments_],
          { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
        )
      : spawnSync(binaire, arguments_, {
          encoding: "utf8",
          maxBuffer: 256 * 1024 * 1024,
          env: { ...process.env, PGPASSWORD: connexion.motDePasse },
        });

  return {
    status: resultat.status ?? 1,
    stdout: resultat.stdout ?? "",
    stderr: resultat.stderr ?? "",
  };
}

/** Chemin de l'archive a l'interieur du conteneur. */
const ARCHIVE_CONTENEUR = "/tmp/erpmes-sauvegarde.dump";

function commandeDocker(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("docker", args, { encoding: "utf8" });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// -----------------------------------------------------------------------------
// Options
// -----------------------------------------------------------------------------

function lireDrapeau(nom: string): string | null {
  const prefixe = `--${nom}=`;
  const trouve = process.argv.find((a) => a.startsWith(prefixe));
  return trouve ? trouve.slice(prefixe.length) : null;
}

function horodatage(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `T${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`
  );
}

function formatTaille(octets: number): string {
  if (octets >= 1024 * 1024) return `${(octets / 1024 / 1024).toFixed(1)} Mo`;
  if (octets >= 1024) return `${(octets / 1024).toFixed(1)} Ko`;
  return `${octets} octets`;
}

// -----------------------------------------------------------------------------
// Sauvegarde
// -----------------------------------------------------------------------------

function sauvegarder(): void {
  const connexion = analyserConnexion();
  const mode = resoudreMode(connexion);
  const dossier = resolve(lireDrapeau("dossier") ?? "backups");
  const garder = Number.parseInt(lireDrapeau("garder") ?? "30", 10);

  console.log("Sauvegarde de la base PostgreSQL");
  console.log(`  base    : ${connexion.base}`);
  console.log(`  serveur : ${connexion.hote}:${connexion.port}`);
  console.log(`  mode    : ${mode.type === "docker" ? `conteneur ${mode.conteneur}` : "PostgreSQL natif"}`);
  console.log(`  dossier : ${dossier}`);
  console.log("");

  if (!existsSync(dossier)) {
    mkdirSync(dossier, { recursive: true });
    console.log(`  Dossier cree : ${dossier}`);
  }

  const nomFichier = `erpmes-${horodatage()}.dump`;
  const fichierFinal = join(dossier, nomFichier);
  const cheminDump = mode.type === "docker" ? ARCHIVE_CONTENEUR : fichierFinal;

  // 1. Ecriture de l'archive (format custom : compressee, restaurable en partie).
  const dump = executer(mode, connexion, "pg_dump", [
    "-U", connexion.utilisateur,
    "-d", connexion.base,
    "-Fc",
    "--no-owner",
    "--no-acl",
    "-f", cheminDump,
  ]);
  if (dump.status !== 0) {
    throw new Error(`pg_dump a echoue :\n${dump.stderr || dump.stdout}`);
  }

  // 2. Verification AVANT de sortir du conteneur : une archive que pg_restore
  //    ne peut pas relire n'est pas une sauvegarde, on l'abandonne ici.
  const verification = executer(mode, connexion, "pg_restore", ["--list", cheminDump]);
  if (verification.status !== 0) {
    if (mode.type === "docker") {
      commandeDocker(["exec", mode.conteneur!, "rm", "-f", ARCHIVE_CONTENEUR]);
    } else if (existsSync(fichierFinal)) {
      unlinkSync(fichierFinal);
    }
    throw new Error(
      `L'archive produite est illisible (verification pg_restore) :\n${verification.stderr}\n` +
        "Sauvegarde abandonnee : aucun fichier n'a ete conserve.",
    );
  }

  const entreesToc = (verification.stdout.match(/^\d+;/gm) ?? []).length;

  // 3. Sortie du conteneur.
  if (mode.type === "docker") {
    const copie = commandeDocker(["cp", `${mode.conteneur}:${ARCHIVE_CONTENEUR}`, fichierFinal]);
    if (copie.status !== 0) {
      throw new Error(`docker cp a echoue :\n${copie.stderr}`);
    }
    commandeDocker(["exec", mode.conteneur!, "rm", "-f", ARCHIVE_CONTENEUR]);
  }

  const taille = statSync(fichierFinal).size;
  if (taille === 0) {
    unlinkSync(fichierFinal);
    throw new Error("L'archive produite est vide : sauvegarde abandonnee.");
  }

  console.log(`  Archive ecrite et verifiee : ${nomFichier}`);
  console.log(`    taille       : ${formatTaille(taille)}`);
  console.log(`    objets SQL   : ${entreesToc}`);

  // 4. Retention : seules les N plus recentes sont conservees.
  const archives = readdirSync(dossier)
    .filter((f) => f.startsWith("erpmes-") && f.endsWith(".dump"))
    .map((f) => ({ nom: f, temps: statSync(join(dossier, f)).mtimeMs }))
    .sort((a, b) => b.temps - a.temps);

  if (archives.length > garder) {
    const anciennes = archives.slice(garder);
    for (const archive of anciennes) unlinkSync(join(dossier, archive.nom));
    console.log(`  Retention : ${anciennes.length} ancienne(s) supprimee(s) (garde=${garder}).`);
  }

  console.log("");
  console.log(`  ${Math.min(archives.length, garder)} sauvegarde(s) dans ${dossier}`);
  console.log("");
  console.log("Pour TESTER cette sauvegarde sans toucher aux donnees :");
  console.log(`  npm run restore -- --fichier=${nomFichier} --base=erpmes_essai --confirmer`);
}

// -----------------------------------------------------------------------------
// Restauration
// -----------------------------------------------------------------------------

function restaurer(): void {
  const cheminFourni = lireDrapeau("fichier");
  if (!cheminFourni) {
    throw new Error(
      "Indiquez l'archive a restaurer :\n" +
        "  npm run restore -- --fichier=backups/erpmes-....dump",
    );
  }

  const fichierLocal = isAbsolute(cheminFourni) ? cheminFourni : resolve(cheminFourni);
  if (!existsSync(fichierLocal)) {
    throw new Error(`Archive introuvable : ${fichierLocal}`);
  }

  const connexion = analyserConnexion();
  const mode = resoudreMode(connexion);
  const baseCible = lireDrapeau("base") ?? connexion.base;
  const confirmer = process.argv.includes("--confirmer");
  const remplaceProduction = baseCible === connexion.base;

  console.log("Restauration d'une sauvegarde PostgreSQL");
  console.log(`  archive    : ${basename(fichierLocal)} (${formatTaille(statSync(fichierLocal).size)})`);
  console.log(`  base cible : ${baseCible}`);
  console.log(`  base appli : ${connexion.base}`);
  console.log("");

  if (remplaceProduction) {
    console.log("  ATTENTION : la base applicative sera RECREEE.");
    console.log("  Les donnees actuelles seront remplacees par celles de l'archive.");
  } else {
    console.log(`  Base separee : la base applicative « ${connexion.base} » n'est pas touchee.`);
  }
  console.log("");

  if (!confirmer) {
    console.log("Mode simulation : aucune commande n'a ete executee.");
    console.log("Relancez avec --confirmer pour executer.");
    return;
  }

  // En mode conteneur, l'archive locale est copiee dans le conteneur.
  const cheminArchive =
    mode.type === "docker"
      ? (() => {
          const copie = commandeDocker(["cp", fichierLocal, `${mode.conteneur}:${ARCHIVE_CONTENEUR}`]);
          if (copie.status !== 0) {
            throw new Error(`Copie de l'archive dans le conteneur impossible :\n${copie.stderr}`);
          }
          return ARCHIVE_CONTENEUR;
        })()
      : fichierLocal;

  // L'archive doit etre relisible AVANT toute modification de base.
  const liste = executer(mode, connexion, "pg_restore", ["--list", cheminArchive]);
  if (liste.status !== 0) {
    throw new Error(
      `L'archive est illisible ou corrompue :\n${liste.stderr || liste.stdout}\n` +
        "Aucune modification n'a ete effectuee.",
    );
  }

  // Recreer la base cible : fermer les connexions, supprimer, recreer.
  const preparer = executer(mode, connexion, "psql", [
    "-U", connexion.utilisateur,
    "-d", "postgres",
    "-v", "ON_ERROR_STOP=1",
    "-c",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${baseCible}' AND pid <> pg_backend_pid();`,
    "-c", `DROP DATABASE IF EXISTS "${baseCible}";`,
    "-c", `CREATE DATABASE "${baseCible}";`,
  ]);
  if (preparer.status !== 0) {
    throw new Error(`Preparation de la base impossible :\n${preparer.stderr || preparer.stdout}`);
  }
  console.log(`  Base « ${baseCible} » recreee.`);

  const restauration = executer(mode, connexion, "pg_restore", [
    "-U", connexion.utilisateur,
    "-d", baseCible,
    "--no-owner",
    "--no-acl",
    "--exit-on-error",
    cheminArchive,
  ]);
  if (restauration.status !== 0) {
    throw new Error(`Restauration interrompue :\n${restauration.stderr || restauration.stdout}`);
  }

  if (mode.type === "docker") {
    commandeDocker(["exec", mode.conteneur!, "rm", "-f", ARCHIVE_CONTENEUR]);
  }

  console.log(`  Donnees restaurees dans « ${baseCible} ».`);
  console.log("");
  console.log("Verification conseillee :");
  console.log("  npx prisma migrate status");
  if (remplaceProduction) {
    console.log("  pm2 restart erpmes   (ou relancez npm run dev)");
  } else {
    console.log(`  pour inspecter la base d'essai : npx prisma studio`);
  }
}

// -----------------------------------------------------------------------------
// Point d'entree
// -----------------------------------------------------------------------------

function principal(): void {
  const commande = process.argv[2] === "restore" ? "restore" : "backup";
  if (commande === "restore") restaurer();
  else sauvegarder();
}

try {
  principal();
} catch (erreur) {
  console.error("");
  console.error(erreur instanceof Error ? erreur.message : String(erreur));
  process.exitCode = 1;
}
