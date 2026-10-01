/**
 * Tests du controle d'acces (RBAC) et du cloisonnement par division.
 *
 * Deux niveaux sont verifies :
 *   1. le catalogue (permissions, roles, portees) est coherent et aucun role
 *      operationnel ne transporte de permission sensible ;
 *   2. les controles serveur lisent reellement la base : un role desactive en
 *      base fait immediatement perdre ses droits, sans redemarrage ni cache.
 *
 * Le cloisonnement ADMEDCO / MOBILIX est teste de bout en bout : un operateur
 * ADMEDCO ne peut pas intervenir sur la division MOBILIX, et reciproquement.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  aAuMoinsUnePermission,
  aLaPermission,
  aToutesLesPermissions,
  exigerAccesUsine,
  exigerPermission,
  exigerPermissionEtUsine,
  exigerUtilisateur,
  filtreUsine,
  libellePermission,
  libelleUsine,
  peutAccederUsine,
  usinesAutorisees,
} from "@/lib/rbac/guard";
import {
  ALL_PERMISSION_CODES,
  PERMISSIONS,
  PERMISSION_DEFINITIONS,
  SCOPE_PERMISSIONS,
} from "@/lib/rbac/permissions";
import { ROLE_DEFINITIONS, getRolePermissions } from "@/lib/rbac/roles";
import { SESSION_COOKIE, creerSession, chargerUtilisateurCourant } from "@/lib/auth/session";
import { bocal, viderBocal } from "@/tests/bocal-cookies";
import { creerUtilisateurTest, jeton, sessionAdministrateur, sessionTest } from "@/tests/aide";

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

const PREFIXE = jeton("TRBC");
const utilisateursCrees: number[] = [];
let codeRole: string | null = null;

async function creerUtilisateur(roleCodes: string[]): Promise<number> {
  const utilisateur = await creerUtilisateurTest({
    suffixe: `${PREFIXE}${utilisateursCrees.length}`,
    roleCodes,
  });
  utilisateursCrees.push(utilisateur.id);
  return utilisateur.id;
}

async function ouvrirSession(userId: number): Promise<void> {
  const { token } = await creerSession(userId, { ip: "127.0.0.1", userAgent: "vitest" });
  bocal.set(SESSION_COOKIE, token);
}

beforeAll(async () => {
  viderBocal();
});

afterAll(async () => {
  viderBocal();

  if (codeRole) {
    const role = await prisma.role.findUnique({ where: { code: codeRole }, select: { id: true } });
    if (role) {
      await prisma.userRole.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.role.delete({ where: { id: role.id } });
    }
  }

  if (utilisateursCrees.length > 0) {
    // La suppression des sessions est assuree par la cascade de la relation.
    await prisma.user.deleteMany({ where: { id: { in: utilisateursCrees } } });
  }
});

// -----------------------------------------------------------------------------
// Catalogue
// -----------------------------------------------------------------------------

describe("Catalogue des permissions et des roles", () => {
  it("decrit chaque permission du catalogue, sans doublon", () => {
    const decrites = new Set(ALL_PERMISSION_CODES);

    for (const code of Object.values(PERMISSIONS)) {
      expect(decrites.has(code), `permission ${code} absente des definitions`).toBe(true);
    }

    expect(decrites.size).toBe(ALL_PERMISSION_CODES.length);
  });

  it("donne un libelle francais lisible a chaque permission", () => {
    for (const definition of PERMISSION_DEFINITIONS) {
      expect(definition.label.trim().length, definition.code).toBeGreaterThan(3);
      // Un libelle qui contient le code technique signale un oubli de traduction.
      expect(definition.label.includes(definition.code), definition.code).toBe(false);
    }
  });

  it("definit au moins dix-huit roles distincts", () => {
    const codes = ROLE_DEFINITIONS.map((role) => role.code);
    expect(codes.length).toBeGreaterThanOrEqual(18);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("ne reference que des permissions existantes et des portees connues", () => {
    const connues = new Set<string>([
      ...ALL_PERMISSION_CODES,
      ...Object.values(SCOPE_PERMISSIONS),
    ]);

    for (const role of ROLE_DEFINITIONS) {
      for (const permission of role.permissions) {
        expect(connues.has(permission), `${role.code} reference « ${permission} »`).toBe(true);
      }
    }
  });

  it("declare une portee explicite pour chaque role", () => {
    for (const role of ROLE_DEFINITIONS) {
      const portees = role.permissions.filter((permission) =>
        Object.values(SCOPE_PERMISSIONS).includes(
          permission as (typeof SCOPE_PERMISSIONS)[keyof typeof SCOPE_PERMISSIONS],
        ),
      );
      expect(portees.length, `${role.code} sans portee`).toBe(1);
    }
  });

  it("n'accorde aucune permission sensible aux profils d'atelier", () => {
    const sensibles = [
      PERMISSIONS.RH_SALAIRE_LIRE,
      PERMISSIONS.COMPTABILITE_POSTER,
      PERMISSIONS.COMPTABILITE_CONTREPASSER,
      PERMISSIONS.UTILISATEUR_GERER,
      PERMISSIONS.ROLE_GERER,
      PERMISSIONS.SYSTEME_ADMIN,
      PERMISSIONS.IMPORT_EXECUTER,
      PERMISSIONS.CONFIG_GERER,
    ];

    for (const code of ["OPERATEUR_ADMEDCO", "OPERATEUR_MOBILIX", "MAGASINIER", "LECTURE_SEULE"]) {
      const permissions = getRolePermissions(code);
      expect(permissions.length, `role ${code} inconnu`).toBeGreaterThan(0);

      for (const sensible of sensibles) {
        expect(permissions.includes(sensible), `${code} ne doit pas porter ${sensible}`).toBe(false);
      }
    }
  });

  it("donne a l'administrateur systeme l'integralite du catalogue", () => {
    const permissions = new Set(getRolePermissions("ADMIN_SYSTEME"));

    for (const code of ALL_PERMISSION_CODES) {
      expect(permissions.has(code), `permission manquante : ${code}`).toBe(true);
    }
    expect(permissions.has(SCOPE_PERMISSIONS.PORTEE_TOUTES_USINES)).toBe(true);
  });

  it("traduit les libelles de permission inconnus sans les masquer", () => {
    expect(libellePermission(PERMISSIONS.STOCK_TRANSFERT)).toContain("transfert");
    expect(libellePermission("PERMISSION_INEXISTANTE")).toBe("PERMISSION_INEXISTANTE");
  });
});

// -----------------------------------------------------------------------------
// Fonctions pures
// -----------------------------------------------------------------------------

describe("Verification des permissions en memoire", () => {
  it("reconnait une permission presente", () => {
    const utilisateur = sessionTest([PERMISSIONS.STOCK_LIRE]);
    expect(aLaPermission(utilisateur, PERMISSIONS.STOCK_LIRE)).toBe(true);
    expect(aLaPermission(utilisateur, PERMISSIONS.STOCK_TRANSFERT)).toBe(false);
  });

  it("exige la totalite ou au moins une des permissions demandees", () => {
    const utilisateur = sessionTest([PERMISSIONS.STOCK_LIRE, PERMISSIONS.STOCK_TRANSFERT]);

    expect(aToutesLesPermissions(utilisateur, [PERMISSIONS.STOCK_LIRE, PERMISSIONS.STOCK_TRANSFERT])).toBe(true);
    expect(aToutesLesPermissions(utilisateur, [PERMISSIONS.STOCK_LIRE, PERMISSIONS.STOCK_CORRECTION])).toBe(false);
    expect(aAuMoinsUnePermission(utilisateur, [PERMISSIONS.STOCK_CORRECTION, PERMISSIONS.STOCK_LIRE])).toBe(true);
    expect(aAuMoinsUnePermission(utilisateur, [PERMISSIONS.STOCK_CORRECTION])).toBe(false);
  });

  it("applique la portee des usines sans exception", () => {
    const operateurAdmedco = sessionTest([], { scope: { admedco: true } });
    const operateurMobilix = sessionTest([], { scope: { mobilix: true } });
    const direction = sessionAdministrateur();
    const sansPortee = sessionTest([]);

    expect(peutAccederUsine(operateurAdmedco, "ADMEDCO")).toBe(true);
    expect(peutAccederUsine(operateurAdmedco, "MOBILIX")).toBe(false);
    expect(peutAccederUsine(operateurAdmedco, "COMMUN")).toBe(true);

    expect(peutAccederUsine(operateurMobilix, "MOBILIX")).toBe(true);
    expect(peutAccederUsine(operateurMobilix, "ADMEDCO")).toBe(false);

    expect(peutAccederUsine(direction, "ADMEDCO")).toBe(true);
    expect(peutAccederUsine(direction, "MOBILIX")).toBe(true);

    expect(peutAccederUsine(sansPortee, "COMMUN")).toBe(true);
    expect(peutAccederUsine(sansPortee, "ADMEDCO")).toBe(false);
    expect(peutAccederUsine(sansPortee, "MOBILIX")).toBe(false);
  });

  it("borne les requetes a la portee reelle de l'utilisateur", () => {
    expect(usinesAutorisees(sessionTest([], { scope: { admedco: true } }))).toEqual([
      "COMMUN",
      "ADMEDCO",
    ]);
    expect(usinesAutorisees(sessionTest([], { scope: { admedco: true, mobilix: true } }))).toEqual([
      "COMMUN",
      "ADMEDCO",
      "MOBILIX",
    ]);
    expect(usinesAutorisees(sessionAdministrateur())).toEqual(["ADMEDCO", "MOBILIX", "COMMUN"]);

    expect(filtreUsine(sessionAdministrateur())).toEqual({});
    expect(filtreUsine(sessionTest([], { scope: { mobilix: true } }))).toEqual({
      factory: { in: ["COMMUN", "MOBILIX"] },
    });
  });

  it("nomme les divisions en francais", () => {
    expect(libelleUsine("ADMEDCO")).toContain("ADMEDCO");
    expect(libelleUsine("MOBILIX")).toContain("MOBILIX");
    expect(libelleUsine("COMMUN")).toBe("transversale");
  });
});

// -----------------------------------------------------------------------------
// Controles serveur adosses a la base
// -----------------------------------------------------------------------------

describe("Controles serveur et cloisonnement", () => {
  it("refuse toute action sans session ouverte", async () => {
    viderBocal();

    expect(await chargerUtilisateurCourant()).toBeNull();
    await expect(exigerUtilisateur()).rejects.toMatchObject({
      code: "NON_AUTHENTIFIE",
      httpStatus: 401,
    });
    await expect(exigerPermission(PERMISSIONS.STOCK_LIRE)).rejects.toMatchObject({
      code: "NON_AUTHENTIFIE",
    });
  });

  it("charge les permissions depuis le role reel de l'utilisateur", async () => {
    const userId = await creerUtilisateur(["OPERATEUR_ADMEDCO"]);
    await ouvrirSession(userId);

    const utilisateur = await exigerUtilisateur();

    expect(utilisateur.id).toBe(userId);
    expect(utilisateur.roles.map((role) => role.code)).toContain("OPERATEUR_ADMEDCO");
    expect(aLaPermission(utilisateur, PERMISSIONS.PRODUCTION_DECLARER)).toBe(true);
    expect(aLaPermission(utilisateur, PERMISSIONS.PORTAIL_EMPLOYE)).toBe(true);
    // Un operateur declare sa production mais ne transfere pas de stock.
    expect(aLaPermission(utilisateur, PERMISSIONS.STOCK_TRANSFERT)).toBe(false);
    expect(utilisateur.scope).toEqual({
      allFactories: false,
      admedco: true,
      mobilix: false,
    });
  });

  it("interdit a un operateur ADMEDCO d'agir sur MOBILIX", async () => {
    const userId = await creerUtilisateur(["OPERATEUR_ADMEDCO"]);
    await ouvrirSession(userId);

    const utilisateur = await exigerPermission(PERMISSIONS.PRODUCTION_DECLARER);
    expect(peutAccederUsine(utilisateur, "ADMEDCO")).toBe(true);

    await expect(exigerAccesUsine("MOBILIX")).rejects.toMatchObject({
      code: "ACCES_REFUSE",
      httpStatus: 403,
    });
    await expect(
      exigerPermissionEtUsine(PERMISSIONS.PRODUCTION_DECLARER, "MOBILIX"),
    ).rejects.toMatchObject({ code: "ACCES_REFUSE" });
    await expect(
      exigerPermissionEtUsine(PERMISSIONS.PRODUCTION_DECLARER, "ADMEDCO"),
    ).resolves.toMatchObject({ id: userId });
  });

  it("refuse une permission que le role ne porte pas, meme ouverte au portail", async () => {
    const userId = await creerUtilisateur(["OPERATEUR_MOBILIX"]);
    await ouvrirSession(userId);

    const utilisateur = await exigerUtilisateur();
    expect(aLaPermission(utilisateur, PERMISSIONS.RH_SALAIRE_LIRE)).toBe(false);
    expect(aLaPermission(utilisateur, PERMISSIONS.STOCK_CORRECTION)).toBe(false);

    await expect(exigerPermission(PERMISSIONS.RH_SALAIRE_LIRE)).rejects.toMatchObject({
      code: "ACCES_REFUSE",
      httpStatus: 403,
    });
    await expect(exigerPermission(PERMISSIONS.STOCK_CORRECTION)).rejects.toMatchObject({
      code: "ACCES_REFUSE",
    });
    await expect(exigerAccesUsine("ADMEDCO")).rejects.toMatchObject({ code: "ACCES_REFUSE" });
  });

  it("n'accorde rien a un compte sans role", async () => {
    const userId = await creerUtilisateur([]);
    await ouvrirSession(userId);

    const utilisateur = await exigerUtilisateur();
    expect(utilisateur.permissions).toEqual([]);
    expect(usinesAutorisees(utilisateur)).toEqual(["COMMUN"]);

    await expect(exigerPermission(PERMISSIONS.TABLEAU_BORD_LIRE)).rejects.toMatchObject({
      code: "ACCES_REFUSE",
    });
  });

  it("suit les changements de permission faits en base sans redemarrage", async () => {
    const userId = await creerUtilisateur([]);
    codeRole = `${PREFIXE}_ROLE`;

    const permission = await prisma.permission.findUnique({
      where: { code: PERMISSIONS.TABLEAU_BORD_PRODUCTION },
      select: { id: true },
    });
    if (!permission) throw new Error("Permission TABLEAU_BORD_PRODUCTION absente du referentiel.");

    const role = await prisma.role.create({
      data: {
        code: codeRole,
        label: "Role de test RBAC",
        description: "Role cree par les tests, supprime en fin d'execution.",
        factoryScope: "ADMEDCO",
        isActive: true,
        permissions: { create: [{ permissionId: permission.id }] },
      },
    });
    await prisma.userRole.create({ data: { userId, roleId: role.id } });

    await ouvrirSession(userId);
    expect(aLaPermission(await exigerUtilisateur(), PERMISSIONS.TABLEAU_BORD_PRODUCTION)).toBe(true);

    // Le role est desactive en base : le droit disparait immediatement.
    await prisma.role.update({ where: { id: role.id }, data: { isActive: false } });
    const apresDesactivation = await exigerUtilisateur();
    expect(apresDesactivation.roles).toEqual([]);
    expect(aLaPermission(apresDesactivation, PERMISSIONS.TABLEAU_BORD_PRODUCTION)).toBe(false);

    await prisma.role.update({ where: { id: role.id }, data: { isActive: true } });
  });

  it("invalide la session des qu'un compte est desactive", async () => {
    const userId = await creerUtilisateur(["OPERATEUR_ADMEDCO"]);
    await ouvrirSession(userId);
    expect(await chargerUtilisateurCourant()).not.toBeNull();

    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    expect(await chargerUtilisateurCourant()).toBeNull();

    await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
  });

  it("donne a l'administrateur systeme une portee complete en base", async () => {
    const userId = await creerUtilisateur(["ADMIN_SYSTEME"]);
    await ouvrirSession(userId);

    const utilisateur = await exigerUtilisateur();
    expect(utilisateur.scope.allFactories).toBe(true);
    expect(usinesAutorisees(utilisateur)).toEqual(["ADMEDCO", "MOBILIX", "COMMUN"]);
    expect(await exigerAccesUsine("MOBILIX")).toMatchObject({ id: userId });
  });
});
