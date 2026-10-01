/**
 * Preparation de l'environnement de test.
 *
 * Les tests d'integration s'executent sur une base dediee (`erpmes_test`) afin
 * de ne jamais toucher la base de developpement : les mouvements de stock, les
 * ecritures comptables et le journal d'audit y sont ecrits pour de vrai, et une
 * base separee garantit qu'aucune donnee reelle n'est alteree.
 *
 * La base est creee si elle n'existe pas, puis les migrations et le referentiel
 * initial sont appliques. Une base deja initialisee n'est pas retraitee : la
 * preparation reste donc rapide et sure meme lorsque plusieurs executions se
 * chevauchent.
 */

import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const URL_DEV =
  process.env.DATABASE_URL ??
  "postgresql://erpmes:erpmes_dev_pwd@localhost:5433/erpmes?schema=public";

const NOM_BASE_TEST = process.env.TEST_DATABASE_NAME ?? "erpmes_test";

function remplacerBase(url: string, nomBase: string): string {
  const index = url.lastIndexOf("/");
  if (index === -1) throw new Error("DATABASE_URL invalide : nom de base introuvable.");
  const prefixe = url.slice(0, index);
  const reste = url.slice(index + 1);
  const parametres = reste.includes("?") ? reste.slice(reste.indexOf("?")) : "";
  return `${prefixe}/${nomBase}${parametres}`;
}

const URL_TEST = remplacerBase(URL_DEV, NOM_BASE_TEST);
const URL_ADMIN = remplacerBase(URL_DEV, "postgres");

const environnement = process.env as Record<string, string | undefined>;

environnement.DATABASE_URL = URL_TEST;
environnement.NODE_ENV = environnement.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "secret-de-test-uniquement-non-utilise-en-production";

declare global {
  // eslint-disable-next-line no-var
  var __erpmesTestsPrets: boolean | undefined;
}

/** Vrai lorsque la base de test porte deja le referentiel initial. */
async function referentielCharge(): Promise<boolean> {
  const client = new PrismaClient({ datasources: { db: { url: URL_TEST } } });
  try {
    const parametres = await client.appSetting.count();
    const roles = await client.role.count();
    return parametres > 0 && roles > 0;
  } catch {
    return false;
  } finally {
    await client.$disconnect();
  }
}

async function creerBaseSiAbsente(): Promise<void> {
  const admin = new PrismaClient({ datasources: { db: { url: URL_ADMIN } } });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${NOM_BASE_TEST}"`);
  } catch {
    // La base existe deja : cas nominal des executions suivantes.
  } finally {
    await admin.$disconnect();
  }
}

const options = {
  env: { ...process.env, DATABASE_URL: URL_TEST },
  stdio: "pipe" as const,
  encoding: "utf8" as const,
};

/**
 * Execute un outil du projet en appelant directement son point d'entree Node.
 * Passer par `npx` echoue sur Windows : npx y est un script shell, et le
 * lancement direct d'un fichier .cmd par un processus Node n'est plus permis.
 */
function executerOutil(outil: "prisma" | "tsx", arguments_: string[]): void {
  const pointsEntree = {
    prisma: "node_modules/prisma/build/index.js",
    tsx: "node_modules/tsx/dist/cli.mjs",
  } as const;

  execFileSync(process.execPath, [pointsEntree[outil], ...arguments_], options);
}

function attendre(ms: number): Promise<void> {
  return new Promise((resoudre) => setTimeout(resoudre, ms));
}

/**
 * Prepare la base de test. Deux executions simultanees (plusieurs fichiers de
 * test lances en parallele) peuvent tenter la preparation en meme temps : les
 * migrations sont idempotentes, le referentiel est seme par la premiere qui y
 * arrive, et les autres attendent simplement qu'il soit charge.
 */
async function preparerBase(): Promise<void> {
  await creerBaseSiAbsente();

  if (await referentielCharge()) return;

  try {
    executerOutil("prisma", ["migrate", "deploy"]);
  } catch (erreur) {
    throw new Error(
      `Migrations impossibles sur la base de test : ${(erreur as Error).message}`,
    );
  }

  try {
    executerOutil("tsx", ["prisma/seed.ts"]);
  } catch {
    // Une execution concurrente a peut-etre deja seme le referentiel : on le
    // verifie juste apres, plutot que d'echouer sur une contrainte d'unicite.
  }

  for (let essai = 0; essai < 30; essai += 1) {
    if (await referentielCharge()) return;
    await attendre(2_000);
  }

  throw new Error(
    "Le referentiel de test n'a pas pu etre charge : verifiez que PostgreSQL est demarre et que les migrations passent.",
  );
}

if (!globalThis.__erpmesTestsPrets) {
  await preparerBase();
  globalThis.__erpmesTestsPrets = true;
}

export { URL_TEST };
