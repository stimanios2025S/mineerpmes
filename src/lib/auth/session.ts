import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { Factory } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SCOPE_PERMISSIONS } from "@/lib/rbac/permissions";

/**
 * Sessions opaques stockees en base.
 * Le jeton n'est jamais conserve en clair : seul son empreinte SHA-256 est
 * enregistree, ce qui permet la revocation immediate (deconnexion, desactivation
 * de compte, reinitialisation de mot de passe).
 */

export const SESSION_COOKIE = "erpmes_session";

const TTL_PAR_DEFAUT_HEURES = 12;
const TTL_MAX_HEURES = 24 * 30;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function ttlHeures(): number {
  const brut = Number.parseInt(process.env.SESSION_TTL_HOURS ?? "", 10);
  if (!Number.isFinite(brut) || brut <= 0) return TTL_PAR_DEFAUT_HEURES;
  return Math.min(brut, TTL_MAX_HEURES);
}

export interface SessionCreationResult {
  token: string;
  expiresAt: Date;
}

export async function creerSession(
  userId: number,
  metadonnees: { ip?: string | null; userAgent?: string | null } = {},
): Promise<SessionCreationResult> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHeures() * 3600 * 1000);

  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      ip: metadonnees.ip ?? null,
      userAgent: metadonnees.userAgent ?? null,
    },
  });

  return { token, expiresAt };
}

export interface SessionUser {
  id: number;
  email: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  employeeId: number | null;
  employeeName: string | null;
  employeeMatricule: string | null;
  factory: Factory | null;
  warehouseId: number | null;
  roles: { code: string; label: string; factoryScope: Factory | null }[];
  permissions: string[];
  scope: {
    allFactories: boolean;
    admedco: boolean;
    mobilix: boolean;
  };
}

/** Charge l'utilisateur courant depuis le cookie de session. */
export async function chargerUtilisateurCourant(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          roles: {
            include: {
              role: {
                include: {
                  permissions: { include: { permission: true } },
                },
              },
            },
          },
          employee: true,
        },
      },
    },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (!session.user.isActive) return null;

  const { user } = session;

  const roles = user.roles
    .filter((userRole) => userRole.role.isActive)
    .map((userRole) => ({
      code: userRole.role.code,
      label: userRole.role.label,
      factoryScope: userRole.role.factoryScope,
    }));

  const permissionsSet = new Set<string>();
  for (const userRole of user.roles) {
    if (!userRole.role.isActive) continue;
    for (const rolePermission of userRole.role.permissions) {
      permissionsSet.add(rolePermission.permission.code);
    }
  }

  const scope = {
    allFactories: permissionsSet.has(SCOPE_PERMISSIONS.PORTEE_TOUTES_USINES),
    admedco: permissionsSet.has(SCOPE_PERMISSIONS.PORTEE_ADMEDCO),
    mobilix: permissionsSet.has(SCOPE_PERMISSIONS.PORTEE_MOBILIX),
  };

  // Un administrateur systeme dispose implicitement de la portee complete.
  if (permissionsSet.has("SYSTEME_ADMIN")) {
    scope.allFactories = true;
  }

  const permissions = Array.from(permissionsSet).sort();

  return {
    id: user.id,
    email: user.email,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    employeeId: user.employee?.id ?? null,
    employeeName: user.employee
      ? `${user.employee.firstName} ${user.employee.lastName}`.trim()
      : null,
    employeeMatricule: user.employee?.matricule ?? null,
    factory: user.employee?.factory ?? null,
    warehouseId: user.employee?.defaultWarehouseId ?? null,
    roles,
    permissions,
    scope,
  };
}

export async function revoquerSession(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revoquerToutesLesSessions(userId: number): Promise<number> {
  const resultat = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return resultat.count;
}

export async function revoquerSessionDeLaRequete(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

/** Options du cookie de session. */
export function optionsCookieSession(expiresAt: Date) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

/** Purge des sessions expirees (tache d'entretien). */
export async function purgerSessionsExpirees(): Promise<number> {
  const resultat = await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }],
    },
  });
  return resultat.count;
}
