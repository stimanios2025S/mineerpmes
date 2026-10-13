import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/session";
import { getRolePermissions } from "@/lib/rbac/roles";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { peutCreerAccesEmploye, verifierCreationAcces } from "@/lib/rh/inscription";

function compte(role: string): SessionUser {
  return {
    id: 1, email: "test@example.local", isActive: true, mustChangePassword: false,
    employeeId: null, employeeName: null, employeeMatricule: null, factory: null,
    warehouseId: null, lastLoginAt: null, roles: [{ code: role, label: role, factoryScope: null }],
    permissions: getRolePermissions(role), scope: {
      allFactories: role === "ADMIN_SYSTEME", admedco: role === "PROPRIETAIRE_ADMEDCO",
      mobilix: role === "PROPRIETAIRE_MOBILIX",
    },
  };
}

describe("Creation des acces operateur par les proprietaires", () => {
  it.each(["ADMEDCO", "MOBILIX"] as const)("%s : autorise sa propre usine et refuse l'autre", (usine) => {
    const utilisateur = compte("PROPRIETAIRE_" + usine);
    expect(peutCreerAccesEmploye(utilisateur)).toBe(true);
    expect(() => verifierCreationAcces(utilisateur, usine)).not.toThrow();
    expect(() => verifierCreationAcces(utilisateur, usine === "ADMEDCO" ? "MOBILIX" : "ADMEDCO")).toThrow(/profil/);
    expect(() => verifierCreationAcces(utilisateur, "COMMUN")).toThrow();
  });
  it("RH_ECRIRE seul ne donne pas le droit de creer un compte", () => {
    const utilisateur = compte("RESPONSABLE_RH");
    utilisateur.permissions = [PERMISSIONS.RH_ECRIRE];
    utilisateur.scope.allFactories = true;
    expect(peutCreerAccesEmploye(utilisateur)).toBe(false);
    expect(() => verifierCreationAcces(utilisateur, "ADMEDCO")).toThrow(/profil/);
  });
  it("un operateur ne peut pas creer ses propres collegues", () => {
    expect(peutCreerAccesEmploye(compte("OPERATEUR_ADMEDCO"))).toBe(false);
  });
  it("un proprietaire dont RH_ECRIRE est retire est refuse", () => {
    const utilisateur = compte("PROPRIETAIRE_ADMEDCO"); utilisateur.permissions = [];
    expect(() => verifierCreationAcces(utilisateur, "ADMEDCO")).toThrow(/profil/);
  });
  it("un administrateur peut ouvrir des acces pour les deux usines", () => {
    const utilisateur = compte("ADMIN_SYSTEME");
    expect(() => verifierCreationAcces(utilisateur, "ADMEDCO")).not.toThrow();
    expect(() => verifierCreationAcces(utilisateur, "MOBILIX")).not.toThrow();
    expect(() => verifierCreationAcces(utilisateur, "COMMUN")).toThrow(/Selectionnez/);
  });
});
