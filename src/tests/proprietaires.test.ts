import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Factory } from "@prisma/client";
import type { SessionUser } from "@/lib/auth/session";
import { ROLE_DEFINITIONS, getRolePermissions } from "@/lib/rbac/roles";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { navigationAutorisee, premierCheminAccessible } from "@/components/navigation";
import { peutAccederUsine, usinesAutorisees } from "@/lib/rbac/portee";
import { exigerPageUsine } from "@/lib/rbac/pages";
import PageAdmedco from "@/app/(app)/direction/admedco/page";
import PageMobilix from "@/app/(app)/direction/mobilix/page";
import PageAtelier from "@/app/(app)/atelier/[code]/page";
import PageBCI from "@/app/(app)/stock/bci/[id]/page";

const etat = vi.hoisted(() => ({
  utilisateur: null as SessionUser | null,
  ordres: vi.fn(), employes: vi.fn(), soldes: vi.fn(), scans: vi.fn(),
  atelier: vi.fn(), ordre: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  chargerUtilisateurCourant: async () => etat.utilisateur,
}));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  prisma: {
    workOrder: { findMany: etat.ordres, findFirst: etat.ordre },
    employee: { count: etat.employes },
    stockBalance: { findMany: etat.soldes },
    workCenterScan: { count: etat.scans },
    workshop: { findFirst: etat.atelier },
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("PAGE_404"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function compte(code: string): SessionUser {
  const role = ROLE_DEFINITIONS.find((r) => r.code === code)!;
  return {
    id: 1, email: "test@example.local", isActive: true, mustChangePassword: false,
    lastLoginAt: null, employeeId: null, employeeName: null, employeeMatricule: null,
    factory: null, warehouseId: null,
    roles: [{ code, label: role.label, factoryScope: role.factoryScope }],
    permissions: getRolePermissions(code),
    scope: {
      allFactories: code === "DIRECTION" || code === "ADMIN_SYSTEME",
      admedco: code === "PROPRIETAIRE_ADMEDCO",
      mobilix: code === "PROPRIETAIRE_MOBILIX",
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.clearAllMocks();
  etat.utilisateur = null;
  etat.ordres.mockResolvedValue([]); etat.employes.mockResolvedValue(0);
  etat.soldes.mockResolvedValue([]); etat.scans.mockResolvedValue(0);
  etat.atelier.mockResolvedValue(null); etat.ordre.mockResolvedValue(null);
});

describe("Proprietaires limites a leur usine", () => {
  it.each(["ADMEDCO", "MOBILIX"] as Factory[])("%s : un seul perimetre et une seule page d'accueil", (usine) => {
    const utilisateur = compte(`PROPRIETAIRE_${usine}`);
    expect(usinesAutorisees(utilisateur)).toEqual([usine]);
    expect(peutAccederUsine(utilisateur, usine === "ADMEDCO" ? "MOBILIX" : "ADMEDCO")).toBe(false);
    expect(peutAccederUsine(utilisateur, "COMMUN")).toBe(false);
    expect(premierCheminAccessible(utilisateur)).toBe(`/direction/${usine.toLowerCase()}`);
    const menus = navigationAutorisee(utilisateur).flatMap((s) => s.entrees.map((e) => e.chemin));
    expect(menus).toContain(`/direction/${usine.toLowerCase()}`);
    expect(menus).not.toContain(`/direction/${usine === "ADMEDCO" ? "mobilix" : "admedco"}`);
    expect(menus).not.toContain(`/magasinier/${usine === "ADMEDCO" ? "mobilix" : "admedco"}`);
    expect(utilisateur.permissions).not.toContain(PERMISSIONS.SYSTEME_ADMIN);
  });

  it("la Direction generale conserve les deux divisions", async () => {
    etat.utilisateur = compte("DIRECTION");
    expect(usinesAutorisees(etat.utilisateur)).toContain("ADMEDCO");
    expect(usinesAutorisees(etat.utilisateur)).toContain("MOBILIX");
    const menus = navigationAutorisee(etat.utilisateur).flatMap((s) => s.entrees.map((e) => e.chemin));
    expect(menus).toContain("/direction/admedco"); expect(menus).toContain("/direction/mobilix");
    await expect(exigerPageUsine(PERMISSIONS.TABLEAU_BORD_LIRE, "ADMEDCO")).resolves.toBe(etat.utilisateur);
    await expect(exigerPageUsine(PERMISSIONS.TABLEAU_BORD_LIRE, "MOBILIX")).resolves.toBe(etat.utilisateur);
  });

  it.each(["ADMEDCO", "MOBILIX"] as const)("%s : sa page est lisible et les requetes restent bornees", async (usine) => {
    etat.utilisateur = compte(`PROPRIETAIRE_${usine}`);
    await (usine === "ADMEDCO" ? PageAdmedco : PageMobilix)();
    expect(etat.ordres).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ factory: usine }) }));
    expect(etat.soldes).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ warehouse: { factory: usine } }) }));
  });

  it.each(["ADMEDCO", "MOBILIX"] as const)("%s : l'URL de l'autre usine est refusee avant les lectures metier", async (usine) => {
    etat.utilisateur = compte(`PROPRIETAIRE_${usine}`);
    await expect((usine === "ADMEDCO" ? PageMobilix : PageAdmedco)()).rejects.toThrow("PAGE_404");
    expect(etat.ordres).not.toHaveBeenCalled(); expect(etat.soldes).not.toHaveBeenCalled();
  });

  it("un visiteur est renvoye a la connexion", async () => {
    await expect(PageAdmedco()).rejects.toThrow("REDIRECT:/connexion");
    expect(etat.ordres).not.toHaveBeenCalled();
  });

  it("un compte sans permission ne peut pas ouvrir une direction", async () => {
    etat.utilisateur = { ...compte("PROPRIETAIRE_ADMEDCO"), permissions: [] };
    await expect(PageAdmedco()).rejects.toThrow("PAGE_404");
    expect(etat.ordres).not.toHaveBeenCalled();
  });

  it("un atelier de l'autre usine n'est jamais charge", async () => {
    etat.utilisateur = compte("PROPRIETAIRE_ADMEDCO");
    await expect(PageAtelier({ params: Promise.resolve({ code: "MBX-A01" }) })).rejects.toThrow("PAGE_404");
    expect(etat.atelier).toHaveBeenCalledWith(expect.objectContaining({ where: { code: "MBX-A01", factory: { in: ["ADMEDCO"] } } }));
    expect(etat.ordres).not.toHaveBeenCalled();
  });

  it("un BCI appele par identifiant reste borne a l'usine", async () => {
    etat.utilisateur = compte("PROPRIETAIRE_MOBILIX");
    await expect(PageBCI({ params: Promise.resolve({ id: "42" }) })).rejects.toThrow("PAGE_404");
    expect(etat.ordre).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 42, factory: { in: ["MOBILIX"] } } }));
  });
});
