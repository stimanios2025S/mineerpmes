/**
 * Outils partages par les tests.
 *
 * Les tests ecrivent de vraies donnees : les codes crees portent un jeton
 * unique pour ne jamais entrer en collision avec le referentiel importe ou avec
 * une autre execution.
 */

import type { Factory } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hacherMotDePasse } from "@/lib/auth/password";
import type { SessionUser } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/rbac/permissions";

let compteur = 0;

/** Jeton court et unique pour les codes crees par les tests. */
export function jeton(prefixe = "T"): string {
  compteur += 1;
  return `${prefixe}${Date.now().toString(36)}${compteur}`.toUpperCase();
}

export const MOT_DE_PASSE_TEST = "MotDePasse-Test-2026!";

/** Cree un compte utilisateur reel : le journal d'audit reference un vrai identifiant. */
export async function creerUtilisateurTest(
  options: { suffixe?: string; roleCodes?: string[] } = {},
): Promise<{ id: number; email: string }> {
  const suffixe = options.suffixe ?? jeton("U");
  const email = `test.${suffixe.toLowerCase()}@admedco.local`;
  const utilisateur = await prisma.user.create({
    data: {
      email,
      passwordHash: await hacherMotDePasse(MOT_DE_PASSE_TEST),
      isActive: true,
      mustChangePassword: false,
    },
  });

  if (options.roleCodes && options.roleCodes.length > 0) {
    const roles = await prisma.role.findMany({
      where: { code: { in: options.roleCodes } },
      select: { id: true },
    });
    for (const role of roles) {
      await prisma.userRole.create({ data: { userId: utilisateur.id, roleId: role.id } });
    }
  }

  return { id: utilisateur.id, email };
}

/** Acteur attendu par les services metier (journal d'audit). */
export type ActeurTest = { id: number; email: string };

export async function acteurTest(): Promise<ActeurTest> {
  return creerUtilisateurTest();
}

/**
 * Construit un utilisateur de session en memoire, pour verifier le cloisonnement
 * et les calculs de portee sans passer par le cookie de session.
 */
export function sessionTest(
  permissions: string[],
  options: {
    id?: number;
    email?: string;
    scope?: Partial<SessionUser["scope"]>;
    employeeId?: number | null;
    factory?: Factory | null;
    roles?: SessionUser["roles"];
  } = {},
): SessionUser {
  const scope = {
    allFactories: false,
    admedco: false,
    mobilix: false,
    ...options.scope,
  };

  return {
    id: options.id ?? 1,
    email: options.email ?? "session.test@admedco.local",
    isActive: true,
    mustChangePassword: false,
    lastLoginAt: null,
    employeeId: options.employeeId ?? null,
    employeeName: null,
    employeeMatricule: null,
    factory: options.factory ?? null,
    warehouseId: null,
    roles: options.roles ?? [],
    permissions,
    scope,
  };
}

/** Session disposant de toutes les permissions du catalogue (profil administrateur). */
export function sessionAdministrateur(): SessionUser {
  return sessionTest(Object.values(PERMISSIONS), {
    scope: { allFactories: true, admedco: true, mobilix: true },
  });
}

/** Supprime des lignes de test dans l'ordre impose par les cles etrangeres. */
export async function supprimerParPrefixe(prefixe: string): Promise<void> {
  const articles = await prisma.item.findMany({
    where: { code: { startsWith: prefixe } },
    select: { id: true },
  });
  const itemIds = articles.map((article) => article.id);

  if (itemIds.length > 0) {
    const ordres = await prisma.workOrder.findMany({
      where: { itemId: { in: itemIds } },
      select: { id: true },
    });
    const ordreIds = ordres.map((ordre) => ordre.id);

    if (ordreIds.length > 0) {
      await prisma.operationDeclaration.deleteMany({ where: { workOrderId: { in: ordreIds } } });
      await prisma.kanbanTransition.deleteMany({ where: { workOrderId: { in: ordreIds } } });
      await prisma.workOrderOperation.deleteMany({ where: { workOrderId: { in: ordreIds } } });
      await prisma.workOrderMaterial.deleteMany({ where: { workOrderId: { in: ordreIds } } });
      await prisma.stockMovement.deleteMany({ where: { workOrderId: { in: ordreIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: ordreIds } } });
    }

    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockBalance.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.formulaLine.deleteMany({ where: { componentItemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
}
