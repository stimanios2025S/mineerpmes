/**
 * Tests de l'authentification.
 *
 * Le service est execute pour de vrai contre PostgreSQL : hachage scrypt,
 * verrouillage apres tentatives infructueuses, revocation de session et journal
 * d'audit sont verifies en base, pas en memoire. Seul l'acces au cookie de
 * requete (`next/headers`) est remplace par un bocal en memoire, car il n'existe
 * pas de requete Next.js pendant les tests.
 *
 * Les points de securite verifies ici :
 *   - le jeton de session n'est jamais stocke en clair ;
 *   - un echec de connexion ne revele jamais si le compte existe ;
 *   - un compte verrouille ou desactive refuse meme le bon mot de passe ;
 *   - un changement de mot de passe revoque toutes les sessions ouvertes ;
 *   - aucun compte ne porte un mot de passe par defaut connu.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  LONGUEUR_MINIMALE_MOT_DE_PASSE,
  genererMotDePasseTemporaire,
  hacherMotDePasse,
  hashDoitEtreMisAJour,
  verifierMotDePasse,
  verifierRobustesseMotDePasse,
} from "@/lib/auth/password";
import {
  SESSION_COOKIE,
  chargerUtilisateurCourant,
  creerSession,
  hashToken,
  optionsCookieSession,
  purgerSessionsExpirees,
} from "@/lib/auth/session";
import {
  changerMotDePasse,
  connecter,
  deconnecter,
  reinitialiserMotDePasse,
} from "@/lib/auth/service";
import { bocal, viderBocal } from "@/tests/bocal-cookies";
import { MOT_DE_PASSE_TEST, creerUtilisateurTest, jeton } from "@/tests/aide";

vi.mock("next/headers", async () => {
  const { bocal: bocalCookies } = await import("./bocal-cookies");

  return {
    cookies: async () => ({
      get: (nom: string) => {
        const valeur = bocalCookies.get(nom);
        return valeur === undefined ? undefined : { name: nom, value: valeur };
      },
      set: (cible: string | { name: string; value: string }, valeur?: string) => {
        if (typeof cible === "string") bocalCookies.set(cible, valeur ?? "");
        else bocalCookies.set(cible.name, cible.value);
      },
      delete: (cible: string | { name: string }) => {
        bocalCookies.delete(typeof cible === "string" ? cible : cible.name);
      },
    }),
    headers: async () =>
      new Headers({ "user-agent": "vitest", "x-forwarded-for": "127.0.0.1" }),
  };
});

const PREFIXE = jeton("TAUT");
const utilisateursCrees: number[] = [];

async function creerCompte(
  options: { motDePasse?: string; isActive?: boolean } = {},
): Promise<{ id: number; email: string }> {
  const utilisateur = await creerUtilisateurTest({ suffixe: `${PREFIXE}${utilisateursCrees.length}` });
  utilisateursCrees.push(utilisateur.id);

  if (options.motDePasse || options.isActive === false) {
    await prisma.user.update({
      where: { id: utilisateur.id },
      data: {
        ...(options.motDePasse
          ? { passwordHash: await hacherMotDePasse(options.motDePasse) }
          : {}),
        ...(options.isActive === false ? { isActive: false } : {}),
      },
    });
  }

  return utilisateur;
}

beforeAll(() => {
  viderBocal();
});

afterAll(async () => {
  viderBocal();
  if (utilisateursCrees.length > 0) {
    // Les sessions partent en cascade ; le journal d'audit est conserve, son
    // lien vers l'utilisateur est simplement detache.
    await prisma.user.deleteMany({ where: { id: { in: utilisateursCrees } } });
  }
});

// -----------------------------------------------------------------------------
// Hachage et politique de mot de passe
// -----------------------------------------------------------------------------

describe("Hachage et politique de mot de passe", () => {
  it("hache le mot de passe avec scrypt et un sel unique", async () => {
    const premier = await hacherMotDePasse(MOT_DE_PASSE_TEST);
    const second = await hacherMotDePasse(MOT_DE_PASSE_TEST);

    expect(premier.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(premier).not.toContain(MOT_DE_PASSE_TEST);
    expect(premier).not.toBe(second);
    expect(premier.split("$")).toHaveLength(6);
  });

  it("verifie un mot de passe correct et refuse les autres", async () => {
    const hash = await hacherMotDePasse(MOT_DE_PASSE_TEST);

    expect(await verifierMotDePasse(MOT_DE_PASSE_TEST, hash)).toBe(true);
    expect(await verifierMotDePasse("MotDePasse-Test-2027!", hash)).toBe(false);
    expect(await verifierMotDePasse("", hash)).toBe(false);
  });

  it("ne leve jamais d'exception sur un hash corrompu", async () => {
    for (const corrompu of ["", "pas-un-hash", "scrypt$16384$8$1$sel", "bcrypt$10$abc"]) {
      expect(await verifierMotDePasse(MOT_DE_PASSE_TEST, corrompu)).toBe(false);
    }
  });

  it("exige douze caracteres, quatre familles et aucun mot courant", () => {
    expect(LONGUEUR_MINIMALE_MOT_DE_PASSE).toBe(12);

    expect(verifierRobustesseMotDePasse("Court1!").valide).toBe(false);
    expect(verifierRobustesseMotDePasse("motdepasseuniquement").valide).toBe(false);
    expect(verifierRobustesseMotDePasse("MotDePasse1!aaaa").valide).toBe(false);
    expect(verifierRobustesseMotDePasse("Admedco-Algerie-2026!").valide).toBe(false);
    expect(verifierRobustesseMotDePasse("Mobilix-Usine-2026!").valide).toBe(false);
    expect(verifierRobustesseMotDePasse("Chaine-Atelier-2026!").valide).toBe(true);
  });

  it("genere des mots de passe temporaires conformes a la politique", () => {
    for (let essai = 0; essai < 20; essai += 1) {
      const motDePasse = genererMotDePasseTemporaire();
      expect(verifierRobustesseMotDePasse(motDePasse).valide, motDePasse).toBe(true);
    }
  });

  it("detecte un hash produit avec des parametres obsoletes", async () => {
    expect(hashDoitEtreMisAJour(await hacherMotDePasse(MOT_DE_PASSE_TEST))).toBe(false);
    expect(hashDoitEtreMisAJour("scrypt$1024$8$1$c2Vs$c2Vs")).toBe(true);
    expect(hashDoitEtreMisAJour("hash-invalide")).toBe(true);
  });

  it("ne laisse aucun compte avec un mot de passe par defaut connu", async () => {
    const utilisateurs = await prisma.user.findMany({
      take: 10,
      select: { email: true, passwordHash: true },
    });
    const defauts = ["admin", "admin123", "erpmes", "admedco", "password"];

    for (const utilisateur of utilisateurs) {
      for (const defaut of defauts) {
        expect(
          await verifierMotDePasse(defaut, utilisateur.passwordHash),
          `${utilisateur.email} utilise un mot de passe par defaut`,
        ).toBe(false);
      }
    }
  });
});

// -----------------------------------------------------------------------------
// Connexion
// -----------------------------------------------------------------------------

describe("Connexion", () => {
  it("refuse un compte inconnu sans reveler qu'il n'existe pas", async () => {
    const erreur = await connecter(`${PREFIXE.toLowerCase()}.inconnu@admedco.local`, "MotDePasse-2026!").catch(
      (e) => e,
    );

    expect(erreur).toMatchObject({ code: "ACCES_REFUSE", httpStatus: 403 });
    expect(erreur.message).toBe("Adresse electronique ou mot de passe incorrect.");
    expect(bocal.has(SESSION_COOKIE)).toBe(false);

    const trace = await prisma.auditLog.findFirst({
      where: { action: "CONNEXION_ECHOUEE", userEmail: `${PREFIXE.toLowerCase()}.inconnu@admedco.local` },
    });
    expect(trace?.reason).toBe("Compte inconnu");
  });

  it("refuse un mot de passe invalide et incremente le compteur d'echecs", async () => {
    const compte = await creerCompte();

    await expect(connecter(compte.email, "Mauvais-Mot-De-Passe-2026!")).rejects.toMatchObject({
      code: "ACCES_REFUSE",
    });

    const apres = await prisma.user.findUnique({ where: { id: compte.id } });
    expect(apres?.failedAttempts).toBe(1);
    expect(apres?.lockedUntil).toBeNull();
  });

  it("verrouille le compte apres cinq tentatives infructueuses", async () => {
    const compte = await creerCompte();

    for (let tentative = 1; tentative <= 4; tentative += 1) {
      await expect(connecter(compte.email, "Mauvais-Mot-De-Passe-2026!")).rejects.toMatchObject({
        code: "ACCES_REFUSE",
      });
    }

    await expect(connecter(compte.email, "Mauvais-Mot-De-Passe-2026!")).rejects.toThrow(
      /verrouille pendant/i,
    );

    const verrouille = await prisma.user.findUnique({ where: { id: compte.id } });
    expect(verrouille?.lockedUntil).not.toBeNull();
    expect(verrouille!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    const trace = await prisma.auditLog.findFirst({
      where: { action: "COMPTE_VERROUILLE", userId: compte.id },
    });
    expect(trace).not.toBeNull();

    // Meme le bon mot de passe est refuse pendant le verrouillage.
    await expect(connecter(compte.email, MOT_DE_PASSE_TEST)).rejects.toThrow(/verrouille/i);
    expect(bocal.has(SESSION_COOKIE)).toBe(false);
  });

  it("refuse un compte desactive", async () => {
    const compte = await creerCompte({ isActive: false });

    await expect(connecter(compte.email, MOT_DE_PASSE_TEST)).rejects.toThrow(/desactive/i);

    const trace = await prisma.auditLog.findFirst({
      where: { action: "CONNEXION_ECHOUEE", userId: compte.id },
      orderBy: { id: "desc" },
    });
    expect(trace?.reason).toBe("Compte desactive");
  });

  it("ouvre une session sans jamais stocker le jeton en clair", async () => {
    const compte = await creerCompte();
    const { utilisateur, expiresAt } = await connecter(compte.email, MOT_DE_PASSE_TEST);

    expect(utilisateur.id).toBe(compte.id);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const token = bocal.get(SESSION_COOKIE);
    expect(token).toBeTruthy();
    expect(token).not.toBe(utilisateur.id.toString());

    // Le jeton brut est introuvable en base : seul son empreinte SHA-256 y est.
    expect(await prisma.session.findFirst({ where: { tokenHash: token! } })).toBeNull();
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token!) } });
    expect(session).not.toBeNull();
    expect(session?.revokedAt).toBeNull();

    const apres = await prisma.user.findUnique({ where: { id: compte.id } });
    expect(apres?.failedAttempts).toBe(0);
    expect(apres?.lockedUntil).toBeNull();
    expect(apres?.lastLoginAt).not.toBeNull();
    expect(apres?.lastLoginIp).toBe("127.0.0.1");

    const trace = await prisma.auditLog.findFirst({
      where: { action: "CONNEXION", userId: compte.id },
    });
    expect(trace?.ip).toBe("127.0.0.1");
  });

  it("deconnecte et revoque la session", async () => {
    const compte = await creerCompte();
    await connecter(compte.email, MOT_DE_PASSE_TEST);
    const token = bocal.get(SESSION_COOKIE)!;

    await deconnecter();

    expect(bocal.has(SESSION_COOKIE)).toBe(false);
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    expect(session?.revokedAt).not.toBeNull();

    const trace = await prisma.auditLog.findFirst({
      where: { action: "DECONNEXION", userId: compte.id },
    });
    expect(trace).not.toBeNull();

    // Une session revoquee ne rend plus l'utilisateur courant.
    bocal.set(SESSION_COOKIE, token);
    expect(await chargerUtilisateurCourant()).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Sessions
// -----------------------------------------------------------------------------

describe("Sessions", () => {
  it("ignore une session expiree", async () => {
    const compte = await creerCompte();
    const { token } = await creerSession(compte.id);
    bocal.set(SESSION_COOKIE, token);

    expect(await chargerUtilisateurCourant()).not.toBeNull();

    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    expect(await chargerUtilisateurCourant()).toBeNull();
  });

  it("purge les sessions expirees ou revoquees", async () => {
    const compte = await creerCompte();
    const { token } = await creerSession(compte.id);
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await purgerSessionsExpirees();

    expect(await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } })).toBeNull();
  });

  it("protege le cookie de session", () => {
    const options = optionsCookieSession(new Date(Date.now() + 3_600_000));

    expect(options).toMatchObject({
      name: SESSION_COOKIE,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    // En production le cookie est aussi marque « secure ».
    expect(options.secure).toBe(process.env.NODE_ENV === "production");
  });
});

// -----------------------------------------------------------------------------
// Changement et reinitialisation de mot de passe
// -----------------------------------------------------------------------------

describe("Changement de mot de passe", () => {
  it("refuse un mot de passe actuel incorrect", async () => {
    const compte = await creerCompte();

    await expect(
      changerMotDePasse(compte.id, "Mauvais-Actuel-2026!", "Nouveau-Secret-2026!", "Nouveau-Secret-2026!"),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const inchange = await prisma.user.findUnique({ where: { id: compte.id } });
    expect(await verifierMotDePasse(MOT_DE_PASSE_TEST, inchange!.passwordHash)).toBe(true);
  });

  it("refuse une confirmation differente et un mot de passe faible", async () => {
    const compte = await creerCompte();

    await expect(
      changerMotDePasse(compte.id, MOT_DE_PASSE_TEST, "Nouveau-Secret-2026!", "Autre-Secret-2026!"),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await expect(
      changerMotDePasse(compte.id, MOT_DE_PASSE_TEST, "faible", "faible"),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuse de reutiliser le mot de passe en cours", async () => {
    const compte = await creerCompte();

    await expect(
      changerMotDePasse(compte.id, MOT_DE_PASSE_TEST, MOT_DE_PASSE_TEST, MOT_DE_PASSE_TEST),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("enregistre le nouveau mot de passe et revoque les autres sessions", async () => {
    const compte = await creerCompte();
    await prisma.user.update({ where: { id: compte.id }, data: { mustChangePassword: true } });

    const premiere = await creerSession(compte.id);
    const seconde = await creerSession(compte.id);

    const nouveau = "Chaine-Atelier-2026!";
    await expect(
      changerMotDePasse(compte.id, MOT_DE_PASSE_TEST, nouveau, nouveau),
    ).resolves.toEqual({ ok: true });

    const apres = await prisma.user.findUnique({ where: { id: compte.id } });
    expect(await verifierMotDePasse(nouveau, apres!.passwordHash)).toBe(true);
    expect(await verifierMotDePasse(MOT_DE_PASSE_TEST, apres!.passwordHash)).toBe(false);
    expect(apres?.mustChangePassword).toBe(false);

    for (const session of [premiere, seconde]) {
      const enregistrement = await prisma.session.findUnique({
        where: { tokenHash: hashToken(session.token) },
      });
      expect(enregistrement?.revokedAt).not.toBeNull();
    }

    const trace = await prisma.auditLog.findFirst({
      where: { action: "MOT_DE_PASSE_CHANGE", userId: compte.id },
    });
    expect(trace).not.toBeNull();
  });

  it("reinitialise un mot de passe et force son changement", async () => {
    const compte = await creerCompte();
    const administrateur = await creerCompte();
    const session = await creerSession(compte.id);

    const temporaire = genererMotDePasseTemporaire();
    await reinitialiserMotDePasse(compte.id, temporaire, administrateur.id);

    const apres = await prisma.user.findUnique({ where: { id: compte.id } });
    expect(apres?.mustChangePassword).toBe(true);
    expect(apres?.failedAttempts).toBe(0);
    expect(apres?.lockedUntil).toBeNull();
    expect(await verifierMotDePasse(temporaire, apres!.passwordHash)).toBe(true);

    const ancienne = await prisma.session.findUnique({
      where: { tokenHash: hashToken(session.token) },
    });
    expect(ancienne?.revokedAt).not.toBeNull();

    // La trace designe l'administrateur a l'origine de l'operation.
    const trace = await prisma.auditLog.findFirst({
      where: { action: "MOT_DE_PASSE_REINITIALISE", userId: administrateur.id, entityId: String(compte.id) },
    });
    expect(trace).not.toBeNull();
  });
});
