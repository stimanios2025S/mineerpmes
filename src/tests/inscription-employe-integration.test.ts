/** Recette de creation atomique d'un employe et de ses identifiants, sur erpmes_test. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { creerEmployeAvecAcces } from "@/lib/rh/inscription";
import { actionCreerEmployeEtCompte } from "@/actions/rh";
import { getRolePermissions } from "@/lib/rbac/roles";
import { acteurTest, jeton, sessionTest } from "@/tests/aide";
import { verifierMotDePasse, verifierRobustesseMotDePasse } from "@/lib/auth/password";

const etat = vi.hoisted(() => ({ utilisateur: null as SessionUser | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/session")>(),
  chargerUtilisateurCourant: async () => etat.utilisateur,
}));
vi.mock("next/navigation", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/navigation")>();
  const interrompre = (code: number): never => {
    const erreur = new Error("Refus d'acces") as Error & { digest: string };
    erreur.digest = "NEXT_HTTP_ERROR_FALLBACK;" + code;
    throw erreur;
  };
  return { ...original, unauthorized: () => interrompre(401), forbidden: () => interrompre(403) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const prefixe = jeton("INSCR");
const employes = new Set<number>();
let acteur: { id: number; email: string };

function proprietaire(usine: "ADMEDCO" | "MOBILIX") {
  return sessionTest(getRolePermissions("PROPRIETAIRE_" + usine), {
    ...acteur, scope: { admedco: usine === "ADMEDCO", mobilix: usine === "MOBILIX" },
    roles: [{ code: "PROPRIETAIRE_" + usine, label: "Proprietaire", factoryScope: usine }],
  });
}
beforeAll(async () => { acteur = await acteurTest(); });
afterAll(async () => {
  // Nettoyage exclusivement des identifiants crees par ce fichier de test.
  const fiches = await prisma.employee.findMany({ where: { OR: [{ id: { in: [...employes] } }, { lastName: { startsWith: prefixe } }] }, select: { id: true, userId: true } });
  await prisma.employee.deleteMany({ where: { id: { in: fiches.map((e) => e.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: fiches.flatMap((e) => e.userId ? [e.userId] : []) } } });
  if (acteur) await prisma.user.delete({ where: { id: acteur.id } });
});

describe("Inscription en une etape", () => {
  it.each(["ADMEDCO", "MOBILIX"] as const)("%s : le proprietaire cree un compte operateur avec un mot de passe unique", async (factory) => {
    etat.utilisateur = proprietaire(factory);
    const formulaire = new FormData();
    formulaire.set("firstName", "Employe"); formulaire.set("lastName", prefixe + factory);
    // Usine deduite de la session ; un role forge ne doit avoir aucun effet.
    formulaire.set("roleCodes", "ADMIN_SYSTEME");
    const acces = await actionCreerEmployeEtCompte(formulaire);
    expect(acces.ok).toBe(true);
    if (!acces.ok) throw new Error(acces.message);
    employes.add(acces.id);
    expect(acces.matricule).toMatch(factory === "ADMEDCO" ? /^ADM-\d+$/ : /^MBX-\d+$/);
    const fiche = await prisma.employee.findUniqueOrThrow({ where: { id: acces.id }, include: { user: { include: { roles: { include: { role: true } } } } } });
    expect(fiche.factory).toBe(factory);
    expect(fiche.user!.roles.map((r) => r.role.code)).toEqual(["OPERATEUR_" + factory]);
    // L'operateur n'est PAS force de changer son mot de passe : il doit
    // atteindre son portail directement. Les identifiants sont remis par
    // l'encadrement et geres depuis le portail d'administration.
    expect(fiche.user!.mustChangePassword).toBe(false);
    expect(verifierRobustesseMotDePasse(acces.motDePasseTemporaire).valide).toBe(true);
    expect(await verifierMotDePasse(acces.motDePasseTemporaire, fiche.user!.passwordHash)).toBe(true);
    const audits = await prisma.auditLog.findMany({ where: { entity: "Employee", entityId: String(acces.id) }, select: { newValue: true, oldValue: true, comment: true, reason: true } });
    expect(JSON.stringify(audits)).not.toContain(acces.motDePasseTemporaire);
  });
  it("genere des matricules et identifiants distincts en cas de creations simultanees", async () => {
    const acces = await Promise.all(Array.from({ length: 3 }, (_, index) => creerEmployeAvecAcces({ firstName: "Concurrent", lastName: prefixe + index, factory: "ADMEDCO" }, proprietaire("ADMEDCO"))));
    acces.forEach((e) => employes.add(e.id));
    expect(new Set(acces.map((e) => e.matricule)).size).toBe(3);
    expect(new Set(acces.map((e) => e.identifiant)).size).toBe(3);
  });
  it("conserve un matricule existant et annule toute creation si l'identifiant est deja utilise", async () => {
    const matricule = prefixe + "MANUEL";
    const premier = await creerEmployeAvecAcces({ matricule, firstName: "Test", lastName: prefixe + "Manuel", factory: "ADMEDCO" }, proprietaire("ADMEDCO"));
    employes.add(premier.id); expect(premier.matricule).toBe(matricule);
    const nom = prefixe + "Rollback";
    await expect(creerEmployeAvecAcces({ firstName: "Test", lastName: nom, factory: "ADMEDCO", email: premier.identifiant }, proprietaire("ADMEDCO"))).rejects.toMatchObject({ code: "CONFLIT" });
    expect(await prisma.employee.count({ where: { lastName: nom } })).toBe(0);
    await expect(creerEmployeAvecAcces({ matricule, firstName: "Test", lastName: prefixe + "Doublon", factory: "ADMEDCO" }, proprietaire("ADMEDCO"))).rejects.toMatchObject({ code: "CONFLIT" });
  });
  it("refuse les donnees invalides et les changements d'usine sans creer de fiche", async () => {
    await expect(creerEmployeAvecAcces({ firstName: "", lastName: prefixe + "Invalide", factory: "ADMEDCO" }, proprietaire("ADMEDCO"))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(creerEmployeAvecAcces({ firstName: "Test", lastName: prefixe + "Interdit", factory: "MOBILIX" }, proprietaire("ADMEDCO"))).rejects.toMatchObject({ code: "ACCES_REFUSE" });
    expect(await prisma.employee.count({ where: { lastName: prefixe + "Interdit" } })).toBe(0);
  });
  it("refuse un atelier ou depot de l'autre usine", async () => {
    const atelier = await prisma.workshop.findFirstOrThrow({ where: { factory: "MOBILIX", isActive: true } });
    const depot = await prisma.warehouse.findFirstOrThrow({ where: { factory: "MOBILIX", isActive: true } });
    for (const affectation of [{ workshopId: atelier.id }, { defaultWarehouseId: depot.id }]) {
      await expect(creerEmployeAvecAcces({ firstName: "Test", lastName: prefixe + "Affectation", factory: "ADMEDCO", ...affectation }, proprietaire("ADMEDCO"))).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect(await prisma.employee.count({ where: { lastName: prefixe + "Affectation" } })).toBe(0);
  });
  it("l'action refuse une usine forgee et un operateur sans droit RH", async () => {
    etat.utilisateur = proprietaire("ADMEDCO");
    const formulaire = new FormData(); formulaire.set("factory", "MOBILIX");
    formulaire.set("firstName", "Test"); formulaire.set("lastName", prefixe + "Forge");
    await expect(actionCreerEmployeEtCompte(formulaire)).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;403" });
    etat.utilisateur = sessionTest(getRolePermissions("OPERATEUR_ADMEDCO"), { ...acteur, scope: { admedco: true } });
    formulaire.set("factory", "ADMEDCO");
    await expect(actionCreerEmployeEtCompte(formulaire)).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;403" });
    expect(await prisma.employee.count({ where: { lastName: prefixe + "Forge" } })).toBe(0);
  });
  it("un visiteur ne peut pas appeler la creation", async () => {
    etat.utilisateur = null;
    await expect(actionCreerEmployeEtCompte(new FormData())).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;401" });
  });
});
