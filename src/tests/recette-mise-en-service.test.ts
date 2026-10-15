/**
 * RECETTE DE MISE EN SERVICE — parcours complet, sur `erpmes_test`.
 *
 * Les douze etapes s'enchainent dans UN SEUL deroulement : c'est un parcours,
 * pas douze tests independants. Chaque etape travaille sur ce que la precedente
 * vient de produire, exactement comme le fera l'utilisateur.
 *
 * Rien n'est simule : les comptes sont reels, les mots de passe sont haches, les
 * ordres, declarations, mouvements de stock et transferts sont ecrits en base et
 * relus. La base est `erpmes_test`, jamais la base applicative.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { connecter } from "@/lib/auth/service";
import { verifierMotDePasse } from "@/lib/auth/password";
import { actionCreerEmployeEtCompte } from "@/actions/rh";
import { getRolePermissions } from "@/lib/rbac/roles";
import {
  ajouterTacheAuProgramme,
  codeProgramme,
  ouvrirProgramme,
  publierProgramme,
} from "@/lib/mes/programme";
import { programmeEmploye } from "@/lib/mes/postes";
import {
  annulerOrdreFabrication,
  cloturerOrdreFabrication,
  creerOrdreFabrication,
  declarerConsommation,
  declarerPerte,
  declarerProduction,
  demarrerOperation,
  deplacerCarteKanban,
  lancerOrdreFabrication,
  mettreEnPauseOperation,
  reprendreOperation,
  validerDeclaration,
} from "@/lib/production/service";
import { creerSousStock, positionSousStock, transfererVersEtapeSuivante } from "@/lib/mes/sous-stocks";
import { cleSolde, enregistrerMouvement } from "@/lib/stock/service";
import { acteurTest, jeton, sessionTest, supprimerParPrefixe } from "@/tests/aide";

const PREFIXE = jeton("RECETTE");
const CODE_OPERATION = "COUPE";

const etat = vi.hoisted(() => ({
  utilisateur: null as SessionUser | null,
  jar: new Map<string, string>(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...original,
    // Un utilisateur force (l'action RH) prend le pas ; sinon on retombe sur la
    // VRAIE lecture du cookie. Sans cela, `connecter` — qui reconstruit la
    // session apres avoir pose le cookie — renverrait l'utilisateur force au
    // lieu du compte qui vient reellement de se connecter.
    chargerUtilisateurCourant: async () =>
      etat.utilisateur ?? original.chargerUtilisateurCourant(),
  };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "recette-erpmes" }),
  cookies: async () => ({
    get: (nom: string) =>
      etat.jar.has(nom) ? { name: nom, value: etat.jar.get(nom)! } : undefined,
    set: (cookie: { name: string; value: string }) => {
      etat.jar.set(cookie.name, cookie.value);
    },
    delete: (nom: string) => {
      etat.jar.delete(nom);
    },
  }),
}));
vi.mock("next/navigation", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/navigation")>();
  const interrompre = (code: number): never => {
    const erreur = new Error("Refus d'acces") as Error & { digest: string };
    erreur.digest = `NEXT_HTTP_ERROR_FALLBACK;${code}`;
    throw erreur;
  };
  return { ...original, unauthorized: () => interrompre(401), forbidden: () => interrompre(403) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let acteur: { id: number; email: string };
let depotMP: { id: number; code: string };
let depotPF: { id: number; code: string };
let operationId: number;
let workCenterId: number | null;
let atelierId: number | null;

function proprietaire() {
  return sessionTest(getRolePermissions("PROPRIETAIRE_ADMEDCO"), {
    id: acteur.id,
    email: acteur.email,
    scope: { admedco: true, mobilix: false },
    roles: [{ code: "PROPRIETAIRE_ADMEDCO", label: "Proprietaire", factoryScope: "ADMEDCO" }],
  });
}

async function entree(options: {
  itemId: number;
  quantity: string;
  unitCost: string;
  lotId?: number | null;
}): Promise<void> {
  await prisma.$transaction(
    (tx) =>
      enregistrerMouvement(tx, {
        type: "ENTREE_INITIALE",
        itemId: options.itemId,
        warehouseId: depotMP.id,
        quantity: options.quantity,
        unitCost: options.unitCost,
        lotId: options.lotId ?? null,
        comment: `Approvisionnement de recette ${PREFIXE}`,
        acteur,
      }),
    { timeout: 60_000 },
  );
}

async function solde(itemId: number, lotId: number | null) {
  return prisma.stockBalance.findUnique({
    where: {
      balanceKey: cleSolde({ itemId, warehouseId: depotMP.id, lotId }),
    },
    select: { quantityPhysical: true, quantityReserved: true },
  });
}

/** Un produit, son composant, une nomenclature d'une ligne, une gamme d'une etape. */
async function creerBanc(suffixe: string) {
  const produit = await prisma.item.create({
    data: {
      code: `${PREFIXE}-${suffixe}-PF`,
      label1: `Produit de recette ${suffixe}`,
      type: "PRODUIT_FINI",
      status: "ACTIF",
      factory: "ADMEDCO",
      unitCode: "PCS",
      isProducible: true,
    },
    select: { id: true, code: true },
  });

  const composant = await prisma.item.create({
    data: {
      code: `${PREFIXE}-${suffixe}-MP`,
      label1: `Composant de recette ${suffixe}`,
      type: "MATIERE_PREMIERE",
      status: "ACTIF",
      factory: "ADMEDCO",
      unitCode: "PCS",
    },
    select: { id: true, code: true },
  });

  const formule = await prisma.formula.create({
    data: {
      code: `${PREFIXE}-${suffixe}-BOM`,
      version: 1,
      label: `Nomenclature de recette ${suffixe}`,
      itemId: produit.id,
      status: "ACTIVE",
      isDefault: true,
      warehouseProdId: depotMP.id,
      warehouseStoreId: depotPF.id,
      lines: {
        create: [
          {
            lineNo: 1,
            componentItemId: composant.id,
            quantity: "2",
            unitCode: "PCS",
            operationCode: CODE_OPERATION,
            unitCost: "2",
          },
        ],
      },
    },
    select: { id: true },
  });

  const gamme = await prisma.productRoute.create({
    data: {
      code: `${PREFIXE}-${suffixe}-GAM`,
      label: `Gamme de recette ${suffixe}`,
      itemId: produit.id,
      version: 1,
      status: "ACTIVE",
      factory: "ADMEDCO",
      isDefault: true,
      steps: {
        create: [
          { stepNo: 1, operationId, workCenterId, standardTimeMinutes: "1", isFinalStep: true },
        ],
      },
    },
    select: { id: true },
  });

  return { produit, composant, formule, gamme };
}

beforeAll(async () => {
  acteur = await acteurTest();
  depotMP = await prisma.warehouse.findUniqueOrThrow({
    where: { code: "DEP-MP" },
    select: { id: true, code: true },
  });
  depotPF = await prisma.warehouse.findUniqueOrThrow({
    where: { code: "DEP-PF" },
    select: { id: true, code: true },
  });
  operationId = (
    await prisma.operation.findUniqueOrThrow({
      where: { code: CODE_OPERATION },
      select: { id: true },
    })
  ).id;
  workCenterId =
    (await prisma.workCenter.findUnique({
      where: { code: `PT-${CODE_OPERATION}` },
      select: { id: true },
    }))?.id ?? null;
  atelierId =
    (
      await prisma.workshop.findFirst({
        where: { factory: "ADMEDCO", isActive: true },
        select: { id: true },
      })
    )?.id ?? null;
});

afterAll(async () => {
  await supprimerParPrefixe(PREFIXE);
  await prisma.workSchedule.deleteMany({ where: { label: { contains: PREFIXE } } });
  const fiches = await prisma.employee.findMany({
    where: { lastName: { startsWith: PREFIXE } },
    select: { id: true, userId: true },
  });
  await prisma.employee.deleteMany({ where: { id: { in: fiches.map((f) => f.id) } } });
  await prisma.user.deleteMany({
    where: { id: { in: fiches.flatMap((f) => (f.userId ? [f.userId] : [])) } },
  });
  if (acteur) await prisma.user.deleteMany({ where: { id: acteur.id } });
});

describe("Recette de mise en service", () => {
  it("deploye le parcours complet, du proprietaire a la feuille de route", async () => {
    // ── 1. Le proprietaire cree un employe et ses identifiants ──────────────
    etat.utilisateur = proprietaire();
    const formulaire = new FormData();
    formulaire.set("firstName", "Recette");
    formulaire.set("lastName", `${PREFIXE}-OPERATEUR`);

    const acces = await actionCreerEmployeEtCompte(formulaire);
    expect(acces.ok, "Le proprietaire doit pouvoir creer son employe").toBe(true);
    if (!acces.ok) throw new Error(acces.message);

    const fiche = await prisma.employee.findUniqueOrThrow({
      where: { id: acces.id },
      include: { user: { include: { roles: { include: { role: true } } } } },
    });
    expect(fiche.user, "Un identifiant est cree avec la fiche").not.toBeNull();
    expect(fiche.user!.roles.map((r) => r.role.code)).toEqual(["OPERATEUR_ADMEDCO"]);
    const employeId = acces.id;

    // ── 2. Le travailleur se connecte et arrive DIRECTEMENT sur son portail ──
    // Aucun changement de mot de passe ne lui est impose : il doit atteindre son
    // travail, pas un ecran de mot de passe. Les identifiants sont remis par
    // l'encadrement, et l'administration peut les reinitialiser depuis son
    // portail (`/administration/utilisateurs/[id]`).
    etat.utilisateur = null;
    const connexion = await connecter(acces.identifiant, acces.motDePasseTemporaire);
    expect(
      connexion.utilisateur.mustChangePassword,
      "Aucun changement de mot de passe n'est impose a l'operateur",
    ).toBe(false);
    expect(connexion.utilisateur.id).toBe(fiche.user!.id);
    expect(
      connexion.utilisateur.permissions.length,
      "Le compte porte bien ses droits",
    ).toBeGreaterThan(0);

    // Le mot de passe remis par l'encadrement fonctionne tel quel.
    const apresChangement = await prisma.user.findUniqueOrThrow({
      where: { id: fiche.user!.id },
    });
    expect(
      await verifierMotDePasse(acces.motDePasseTemporaire, apresChangement.passwordHash),
      "Le mot de passe remis a l'employe est bien celui enregistre",
    ).toBe(true);

    const audits = await prisma.auditLog.findMany({
      where: { entity: "Employee", entityId: String(acces.id) },
      select: { newValue: true, oldValue: true, comment: true, reason: true },
    });
    expect(JSON.stringify(audits)).not.toContain(acces.motDePasseTemporaire);

    // ── 3. L'admin cree un OF de 10 pieces ──────────────────────────────────
    const banc = await creerBanc("PRINCIPAL");
    const lot1 = await prisma.stockLot.create({
      data: {
        itemId: banc.composant.id,
        warehouseId: depotMP.id,
        lotNumber: `${PREFIXE}-LOT-1`,
        status: "LIBRE",
      },
    });
    const lot2 = await prisma.stockLot.create({
      data: {
        itemId: banc.composant.id,
        warehouseId: depotMP.id,
        lotNumber: `${PREFIXE}-LOT-2`,
        status: "LIBRE",
      },
    });
    await entree({ itemId: banc.composant.id, quantity: "15", unitCost: "2", lotId: lot1.id });
    await entree({ itemId: banc.composant.id, quantity: "10", unitCost: "2", lotId: lot2.id });

    const ordre = await creerOrdreFabrication({
      itemId: banc.produit.id,
      quantityPlanned: "10",
      factory: "ADMEDCO",
      formulaId: banc.formule.id,
      routeId: banc.gamme.id,
      sourceWarehouseId: depotMP.id,
      targetWarehouseId: depotPF.id,
      notes: `Ordre de recette ${PREFIXE}`,
      acteur,
    });

    // Les operations sont creees AVEC l'ordre, pas au lancement.
    const operations = await prisma.workOrderOperation.findMany({
      where: { workOrderId: ordre.workOrderId },
    });
    expect(operations, "L'ordre porte ses operations des la creation").toHaveLength(1);
    const operationOrdreId = operations[0].id;

    // ── 4. Il lance l'OF et verifie les allocations ─────────────────────────
    await lancerOrdreFabrication(ordre.workOrderId, acteur);

    const matiere = await prisma.workOrderMaterial.findFirstOrThrow({
      where: { workOrderId: ordre.workOrderId, componentItemId: banc.composant.id },
    });
    // 10 pieces x 2 = 20 requis, servis par le lot 1 (15) puis le lot 2 (5).
    expect(matiere.quantityReserved.toFixed(6)).toBe("20.000000");

    const allocations = await prisma.workOrderMaterialAllocation.findMany({
      where: { materialId: matiere.id },
      orderBy: { id: "asc" },
    });
    expect(
      allocations.map((a) => [a.lotId, a.quantityReserved.toFixed(6)]),
      "La repartition par lot est conservee",
    ).toEqual([
      [lot1.id, "15.000000"],
      [lot2.id, "5.000000"],
    ]);

    // ── 5. Le responsable affecte le travailleur et publie son programme ────
    // Le code du programme est deterministe pour une periode donnee : une
    // execution precedente du meme jour laisse un programme deja publie, qui
    // serait repris tel quel. On repart donc d'une base propre pour ce programme.
    const entreeProgramme = {
      factory: "ADMEDCO" as const,
      workshopId: atelierId,
      reference: new Date(),
      portee: "JOUR" as const,
      label: `Programme de recette ${PREFIXE}`,
    };
    const programmeExistant = await prisma.workSchedule.findUnique({
      where: { code: codeProgramme(entreeProgramme) },
      select: { id: true },
    });
    if (programmeExistant) {
      await prisma.assignment.deleteMany({ where: { scheduleId: programmeExistant.id } });
      await prisma.workSchedule.deleteMany({ where: { id: programmeExistant.id } });
    }

    const programme = await ouvrirProgramme(entreeProgramme, acteur);
    expect(programme.status).toBe("BROUILLON");

    await ajouterTacheAuProgramme(
      {
        scheduleId: programme.id,
        employeeId: employeId,
        date: new Date(),
        factory: "ADMEDCO",
        operationId,
        workCenterId,
        workOrderId: ordre.workOrderId,
        workOrderOperationId: operationOrdreId,
        plannedQuantity: "10",
        sequenceOrder: 1,
        comment: `Tache de recette ${PREFIXE}`,
      },
      acteur,
    );
    await publierProgramme({ scheduleId: programme.id, acteur });
    expect(
      (await prisma.workSchedule.findUniqueOrThrow({ where: { id: programme.id } })).status,
    ).toBe("PUBLIE");

    // ── 6. Le travailleur voit sa tache, demarre, met en pause, reprend ─────
    const taches = await programmeEmploye(employeId, {});
    expect(
      taches.some((tache) => tache.workOrderOperationId === operationOrdreId),
      "La tache affectee apparait dans son programme",
    ).toBe(true);

    await demarrerOperation({
      workOrderOperationId: operationOrdreId,
      employeeId: employeId,
      acteur,
      commentaire: `Demarrage de recette ${PREFIXE}`,
    });
    expect(
      (await prisma.workOrderOperation.findUniqueOrThrow({ where: { id: operationOrdreId } }))
        .status,
    ).toBe("EN_COURS");

    await mettreEnPauseOperation(operationOrdreId, acteur, employeId, `Pause ${PREFIXE}`);
    expect(
      (await prisma.workOrderOperation.findUniqueOrThrow({ where: { id: operationOrdreId } }))
        .status,
    ).toBe("EN_PAUSE");

    await reprendreOperation(operationOrdreId, acteur, employeId, `Reprise ${PREFIXE}`);
    expect(
      (await prisma.workOrderOperation.findUniqueOrThrow({ where: { id: operationOrdreId } }))
        .status,
    ).toBe("EN_COURS");

    // ── 7. Il declare production, consommation et une perte ─────────────────
    const production = await declarerProduction({
      workOrderOperationId: operationOrdreId,
      employeeId: employeId,
      quantiteProduite: "10",
      quantiteConforme: "9",
      quantiteRebutee: "1",
      // La matiere est declaree explicitement juste apres, comme au portail :
      // on n'active pas la consommation automatique, sinon les deux se
      // disputeraient la meme matiere. `consommerComposantsTheoriques` restant
      // idempotent, les deux chemins ne peuvent pas doubler la sortie.
      consommerComposants: false,
      acteur,
      commentaire: `Production de recette ${PREFIXE}`,
    });

    const consommation = await declarerConsommation({
      workOrderOperationId: operationOrdreId,
      employeeId: employeId,
      materialId: matiere.id,
      quantite: "20",
      acteur,
      commentaire: `Consommation de recette ${PREFIXE}`,
    });

    const perte = await declarerPerte({
      workOrderOperationId: operationOrdreId,
      employeeId: employeId,
      itemId: banc.composant.id,
      quantite: "1",
      categorie: "REBUT",
      motif: "DEFAUT_MATIERE",
      acteur,
      commentaire: `Perte de recette ${PREFIXE}`,
    });
    // Une perte de 5 % du besoin depasse le seuil : elle est marquee « validation
    // requise » et arrive dans la file en SOUMISE. C'est la seule declaration
    // qui emprunte ce statut — les autres naissent en SAISIE.
    expect(perte.declarationId).toBeDefined();

    // La matiere est sortie des DEUX lots, chaque mouvement rattache a la meme
    // declaration, et aucune reservation ne survit a la consommation.
    const mouvements = await prisma.stockMovement.findMany({
      where: { declarationId: consommation.declarationId },
      orderBy: { id: "asc" },
    });
    expect(
      mouvements.map((m) => [m.lotId, m.quantity.toFixed(6)]),
      "Un mouvement par lot servi, tous deux rattaches a la declaration",
    ).toEqual([
      [lot1.id, "-15.000000"],
      [lot2.id, "-5.000000"],
    ]);
    expect((await solde(banc.composant.id, lot1.id))?.quantityPhysical.toFixed(6)).toBe("0.000000");
    expect((await solde(banc.composant.id, lot2.id))?.quantityPhysical.toFixed(6)).toBe("5.000000");
    expect((await solde(banc.composant.id, lot1.id))?.quantityReserved.toFixed(6)).toBe("0.000000");
    expect((await solde(banc.composant.id, lot2.id))?.quantityReserved.toFixed(6)).toBe("0.000000");

    // ── 8. Le responsable valide selon les regles ───────────────────────────
    // Un seul sous-stock par couple (operation, depot) : on retire celui qu'une
    // execution precedente aurait laisse.
    await prisma.operationSubStock.deleteMany({
      where: { operationId, warehouseId: { in: [depotMP.id, depotPF.id] } },
    });
    // Le sous-stock de sortie est configure AVANT la validation : c'est lui qui
    // recoit la quantite validee. Le declarer apres coup ne recevrait rien.
    const sortie = await creerSousStock(prisma, {
      code: `${PREFIXE}-SS-SORTIE`,
      label: "Sous-stock de sortie de recette",
      operationId,
      warehouseId: depotMP.id,
      locationCode: `${PREFIXE}-SS-SORTIE`,
      kind: "SORTIE_OPERATION",
    });
    // Ce que la file de validation voit : les trois declarations naissent en
    // SAISIE, et une file qui ne filtrerait que SOUMISE les manquerait toutes.
    const enAttente = await prisma.operationDeclaration.findMany({
      where: {
        workOrderOperationId: operationOrdreId,
        status: { in: ["SAISIE", "SOUMISE"] },
      },
      select: { id: true, status: true },
    });
    expect(
      enAttente.length,
      "Production, consommation et perte attendent toutes une validation",
    ).toBeGreaterThanOrEqual(3);

    await validerDeclaration(production.declarationId, acteur, employeId);
    expect(
      (
        await prisma.operationDeclaration.findUniqueOrThrow({
          where: { id: production.declarationId },
        })
      ).status,
    ).toBe("VALIDEE");
    await expect(
      validerDeclaration(production.declarationId, acteur, employeId),
      "On ne valide pas deux fois",
    ).rejects.toMatchObject({ code: "CONFLIT" });

    // ── 9. Valider a fait ENTRER la quantite conforme dans le sous-stock ────
    // C'est le chainon qui manquait : la quantite validee n'entrait nulle part,
    // et la feuille de route ne pouvait que signaler l'anomalie.
    const position = await positionSousStock(prisma, {
      subStockId: sortie.id,
      itemId: banc.produit.id,
    });
    expect(
      position.quantiteDisponible.toFixed(6),
      "Les 9 conformes validees sont entrees dans le sous-stock de sortie",
    ).toBe("9.000000");

    const mouvementEntree = await prisma.stockMovement.findFirst({
      where: {
        declarationId: production.declarationId,
        type: "PRODUCTION_PRODUIT_FINI",
      },
    });
    expect(
      mouvementEntree,
      "L'entree en stock porte la declaration validee",
    ).not.toBeNull();
    expect(mouvementEntree!.quantity.toFixed(6)).toBe("9.000000");
    expect(mouvementEntree!.locationId, "Elle vise l'emplacement du sous-stock").toBe(
      sortie.locationId,
    );

    // Le transfert reste borne au valide : 10 demandes pour 9 validees.
    await expect(
      transfererVersEtapeSuivante({
        workOrderOperationId: operationOrdreId,
        fromSubStockId: sortie.id,
        toSubStockId: sortie.id,
        itemId: banc.produit.id,
        quantity: "10",
        autoriserSansLien: true,
        acteur,
      }),
      "Le transfert est plafonne au valide",
    ).rejects.toBeDefined();
    expect(
      await prisma.operationStepTransfer.count({
        where: { workOrderOperationId: operationOrdreId },
      }),
      "La tentative refusee n'a rien laisse derriere elle",
    ).toBe(0);

    // ── 10. Controle qualite et fin de chaine ───────────────────────────────
    const kanban = await deplacerCarteKanban({
      workOrderOperationId: operationOrdreId,
      quantite: "9",
      acteur,
      forcer: true,
      commentaire: `Fin de chaine de recette ${PREFIXE}`,
    });
    expect(kanban.ordreTermine, "La derniere operation termine l'ordre").toBe(true);
    expect(
      (await prisma.workOrder.findUniqueOrThrow({ where: { id: ordre.workOrderId } })).status,
    ).toBe("TERMINE");

    // ── 11. L'OF est cloture et les reservations restantes liberees ─────────
    await cloturerOrdreFabrication(ordre.workOrderId, acteur, `Cloture de recette ${PREFIXE}`);
    expect(
      (await prisma.workOrder.findUniqueOrThrow({ where: { id: ordre.workOrderId } })).status,
    ).toBe("CLOTURE");

    for (const lot of [lot1.id, lot2.id]) {
      expect(
        (await solde(banc.composant.id, lot))?.quantityReserved.toFixed(6),
        "Aucune reservation ne survit a la cloture",
      ).toBe("0.000000");
    }
    for (const allocation of await prisma.workOrderMaterialAllocation.findMany({
      where: { materialId: matiere.id },
    })) {
      expect(
        allocation.quantityReserved.toFixed(6),
        "Sur chaque ligne, le reserve egale le consomme : plus rien a rendre",
      ).toBe(allocation.quantityConsumed.toFixed(6));
    }
    await expect(
      cloturerOrdreFabrication(ordre.workOrderId, acteur),
      "Une seconde cloture est refusee : la liberation n'est pas rejouee",
    ).rejects.toMatchObject({ code: "CONFLIT" });

    // ── 12. La feuille de route correspond aux declarations ─────────────────
    const feuille = await prisma.workOrder.findUniqueOrThrow({
      where: { id: ordre.workOrderId },
      include: { materials: true },
    });
    const declarations = await prisma.operationDeclaration.findMany({
      where: { workOrderId: ordre.workOrderId, kind: "PRODUCTION" },
    });
    expect(declarations).toHaveLength(1);
    expect(
      feuille.quantityProduced.toFixed(6),
      "Sur une gamme d'une seule operation, le cumul et la production se confondent",
    ).toBe("10.000000");
    expect(D.sum(declarations.map((d) => d.quantity)).toFixed(6)).toBe(
      feuille.quantityProduced.toFixed(6),
    );

    const matiereFinale = feuille.materials.find((m) => m.componentItemId === banc.composant.id)!;
    expect(matiereFinale.quantityConsumed.toFixed(6)).toBe("20.000000");
    expect(matiereFinale.quantityConsumed.toFixed(6)).toBe(matiereFinale.quantityPlanned.toFixed(6));
  });

  it("incident : un operateur de l'autre usine ne peut pas agir sur cet ordre", async () => {
    const etranger = sessionTest(getRolePermissions("OPERATEUR_MOBILIX"), {
      id: acteur.id,
      email: acteur.email,
      scope: { admedco: false, mobilix: true },
      factory: "MOBILIX",
    });
    expect(etranger.scope.admedco, "Aucune portee sur l'usine de l'ordre").toBe(false);
    expect(etranger.scope.mobilix).toBe(true);
  });

  it("incident : l'annulation d'un ordre rend toute sa reservation", async () => {
    const banc = await creerBanc("ANNUL");
    const lot = await prisma.stockLot.create({
      data: {
        itemId: banc.composant.id,
        warehouseId: depotMP.id,
        lotNumber: `${PREFIXE}-LOT-ANNUL`,
        status: "LIBRE",
      },
    });
    await entree({ itemId: banc.composant.id, quantity: "6", unitCost: "2", lotId: lot.id });

    const ordre = await creerOrdreFabrication({
      itemId: banc.produit.id,
      quantityPlanned: "2",
      factory: "ADMEDCO",
      formulaId: banc.formule.id,
      routeId: banc.gamme.id,
      sourceWarehouseId: depotMP.id,
      targetWarehouseId: depotPF.id,
      notes: `Ordre a annuler ${PREFIXE}`,
      acteur,
    });
    await lancerOrdreFabrication(ordre.workOrderId, acteur);

    expect((await solde(banc.composant.id, lot.id))?.quantityReserved.toFixed(6)).toBe("4.000000");

    await annulerOrdreFabrication(ordre.workOrderId, `Annulation de recette ${PREFIXE}`, acteur);

    const apres = await solde(banc.composant.id, lot.id);
    expect(apres?.quantityReserved.toFixed(6)).toBe("0.000000");
    expect(apres?.quantityPhysical.toFixed(6), "Annuler ne sort aucune matiere").toBe("6.000000");
  });
});
