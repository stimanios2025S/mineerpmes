import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("refuse une suppression avant meme de se connecter a la base", () => {
  let erreur: (Error & { status?: number; stderr?: string }) | undefined;
  try {
    execFileSync(process.execPath, [
      resolve("node_modules/tsx/dist/cli.mjs"),
      resolve("scripts/purger-demo.ts"), "--executer",
    ], {
      env: { ...process.env, DATABASE_URL: "url-invalide-sans-base" },
      encoding: "utf8", stdio: "pipe", timeout: 10_000,
    });
  } catch (e) {
    erreur = e as typeof erreur;
  }
  expect(erreur?.status).toBe(1);
  expect(erreur?.stderr).toContain("Suppression desactivee");
  expect(erreur?.stderr).not.toContain("PrismaClient");
});
