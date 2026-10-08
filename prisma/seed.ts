/**
 * Initialisation du referentiel de la plateforme ERP + MES ADMEDCO / MOBILIX.
 *
 * Ce script ne cree AUCUNE donnee de demonstration : pas de fausse facture,
 * pas de faux employe, pas de stock fictif. Il installe uniquement :
 *   - les permissions et les roles (referentiel de securite) ;
 *   - les unites, taux de TVA, depots, ateliers et operations reelles ;
 *   - les parametres applicatifs (devise, TVA, ponderation d'evaluation...) ;
 *   - les sequences documentaires ;
 *   - les journaux, comptes et regles d'ecriture configurables ;
 *   - la regle de transfert automatique du chassis peint ADMEDCO -> MOBILIX ;
 *   - le catalogue produit cite par le cahier des charges.
 *
 * Le script est idempotent : il peut etre relance sans creer de doublon et
 * sans ecraser les donnees saisies dans l'application.
 */

import { PrismaClient, type Factory } from "@prisma/client";
import {
  PERMISSION_DEFINITIONS,
  SCOPE_PERMISSIONS,
  getPermissionLabel,
  getPermissionModule,
} from "../src/lib/rbac/permissions";
import { EVENEMENTS_COMPTABLES } from "../src/lib/comptabilite/evenements";
import { ROLE_DEFINITIONS } from "../src/lib/rbac/roles";
import { initialiserParametres, CLE_PARAMETRE } from "../src/lib/settings";
import { initialiserSequences } from "../src/lib/numbering";
import { assurerChassisPeint } from "../src/lib/production/chassis-peint";

const prisma = new PrismaClient();

// -----------------------------------------------------------------------------
// 1. Permissions et roles
// -----------------------------------------------------------------------------

async function semerPermissions(): Promise<number> {
  let crees = 0;

  for (const definition of PERMISSION_DEFINITIONS) {
    const existante = await prisma.permission.findUnique({
      where: { code: definition.code },
    });
    if (!existante) {
      await prisma.permission.create({
        data: {
          code: definition.code,
          label: definition.label,
          module: definition.module,
          description: definition.description ?? null,
        },
      });
      crees += 1;
    }
  }

  // Portees d'usine : ce sont aussi des permissions techniques verifiables.
  for (const code of Object.values(SCOPE_PERMISSIONS)) {
    const existante = await prisma.permission.findUnique({ where: { code } });
    if (!existante) {
      await prisma.permission.create({
        data: {
          code,
          label: getPermissionLabel(code),
          module: getPermissionModule(code),
          description: "Portee d'acces usine verifiee cote serveur.",
        },
      });
      crees += 1;
    }
  }

  return crees;
}

async function semerRoles(): Promise<{ crees: number; liens: number; retires: number }> {
  let crees = 0;
  let liens = 0;
  let retires = 0;

  for (const [index, definition] of ROLE_DEFINITIONS.entries()) {
    const role = await prisma.role.upsert({
      where: { code: definition.code },
      create: {
        code: definition.code,
        label: definition.label,
        description: definition.description,
        factoryScope: definition.factoryScope as Factory,
        isSystem: true,
        isActive: true,
        sortOrder: index + 1,
      },
      update: {
        label: definition.label,
        description: definition.description,
        factoryScope: definition.factoryScope as Factory,
        sortOrder: index + 1,
      },
    });
    if (!role.createdAt || role.createdAt >= role.updatedAt) crees += 1;

    const permissions = await prisma.permission.findMany({
      where: { code: { in: definition.permissions } },
      select: { id: true, code: true },
    });

    const manquantes = definition.permissions.filter(
      (code) => !permissions.some((permission) => permission.code === code),
    );
    if (manquantes.length > 0) {
      console.warn(
        `  ! Role ${definition.code} : permissions inconnues ignorees -> ${manquantes.join(", ")}`,
      );
    }

    const existants = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permissionId: true },
    });
    const dejaLa = new Set(existants.map((lien) => lien.permissionId));

    for (const permission of permissions) {
      if (dejaLa.has(permission.id)) continue;
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
      liens += 1;
    }

    // Les roles systeme sont definis par le code : une permission retiree de
    // roles.ts doit disparaitre de la base. Sans cette purge, resserrer un role
    // ne changerait rien en production — le cloisonnement resterait ouvert, et
    // un role se verrait attribuer des droits que le code lui refuse.
    const voulues = new Set(permissions.map((permission) => permission.id));
    const obsoletes = [...dejaLa].filter((permissionId) => !voulues.has(permissionId));
    if (obsoletes.length > 0) {
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { in: obsoletes } },
      });
      retires += obsoletes.length;
    }
  }

  return { crees, liens, retires };
}

// -----------------------------------------------------------------------------
// 2. Unites de mesure et TVA
// -----------------------------------------------------------------------------

const UNITES = [
  { code: "PCS", label: "Piece", decimals: 0 },
  { code: "KG", label: "Kilogramme", decimals: 3 },
  { code: "G", label: "Gramme", decimals: 2 },
  { code: "T", label: "Tonne", decimals: 3 },
  { code: "M", label: "Metre", decimals: 3 },
  { code: "ML", label: "Metre lineaire", decimals: 3 },
  { code: "M2", label: "Metre carre", decimals: 3 },
  { code: "M3", label: "Metre cube", decimals: 3 },
  { code: "L", label: "Litre", decimals: 3 },
  { code: "H", label: "Heure", decimals: 2 },
  { code: "J", label: "Jour", decimals: 2 },
  { code: "LOT", label: "Lot", decimals: 0 },
  { code: "ENS", label: "Ensemble", decimals: 0 },
  { code: "ROULEAU", label: "Rouleau", decimals: 2 },
  { code: "FEUILLE", label: "Feuille", decimals: 2 },
  { code: "BARRE", label: "Barre", decimals: 2 },
];

async function semerUnites(): Promise<number> {
  let crees = 0;
  for (const unite of UNITES) {
    const existante = await prisma.unitOfMeasure.findUnique({
      where: { code: unite.code },
    });
    if (!existante) {
      await prisma.unitOfMeasure.create({ data: { ...unite, isActive: true } });
      crees += 1;
    }
  }
  return crees;
}

const TAUX_TVA = [
  {
    code: "TVA19",
    label: "TVA 19 % (taux normal)",
    rate: "19",
    isDefault: true,
  },
  { code: "TVA9", label: "TVA 9 % (taux reduit)", rate: "9", isDefault: false },
  { code: "TVA0", label: "Exonere de TVA", rate: "0", isDefault: false },
];

async function semerTauxTva(): Promise<number> {
  let crees = 0;
  for (const taux of TAUX_TVA) {
    const existant = await prisma.taxRate.findUnique({ where: { code: taux.code } });
    if (!existant) {
      await prisma.taxRate.create({
        data: {
          code: taux.code,
          label: taux.label,
          rate: taux.rate,
          isDefault: taux.isDefault,
          isActive: true,
        },
      });
      crees += 1;
    }
  }
  return crees;
}

// -----------------------------------------------------------------------------
// 3. Depots et emplacements
// -----------------------------------------------------------------------------

const DEPOTS = [
  {
    code: "DEP-MP",
    label: "Depot matieres premieres ADMEDCO",
    type: "MATIERES_PREMIERES" as const,
    factory: "ADMEDCO" as const,
    isDefault: true,
  },
  {
    code: "DEP-MP-MBX",
    label: "Depot matieres premieres MOBILIX",
    type: "MATIERES_PREMIERES" as const,
    factory: "MOBILIX" as const,
    isDefault: true,
  },
  {
    code: "DEP-ENC",
    label: "Depot en-cours de production ADMEDCO",
    type: "EN_COURS" as const,
    factory: "ADMEDCO" as const,
    isDefault: false,
  },
  {
    code: "DEP-ENC-MBX",
    label: "Depot en-cours de production MOBILIX",
    type: "EN_COURS" as const,
    factory: "MOBILIX" as const,
    isDefault: false,
  },
  {
    code: "DEP-PF",
    label: "Depot produits finis ADMEDCO",
    type: "PRODUITS_FINIS" as const,
    factory: "ADMEDCO" as const,
    isDefault: false,
  },
  {
    code: "DEP-PF-MBX",
    label: "Depot produits finis MOBILIX",
    type: "PRODUITS_FINIS" as const,
    factory: "MOBILIX" as const,
    isDefault: false,
  },
  {
    code: "DEP-QUAR",
    label: "Depot quarantaine",
    type: "QUARANTAINE" as const,
    factory: "COMMUN" as const,
    isDefault: false,
  },
  {
    code: "DEP-REBUT",
    label: "Depot rebuts et non-conformes",
    type: "REBUT" as const,
    factory: "COMMUN" as const,
    isDefault: false,
  },
  {
    code: "DEP-CONS",
    label: "Depot consommables et emballages",
    type: "CONSOMMABLES" as const,
    factory: "COMMUN" as const,
    isDefault: false,
  },
];

async function semerDepots(): Promise<Map<string, number>> {
  const ids = new Map<string, number>();

  for (const depot of DEPOTS) {
    const existant = await prisma.warehouse.findUnique({
      where: { code: depot.code },
    });
    const enregistrement =
      existant ??
      (await prisma.warehouse.create({
        data: {
          code: depot.code,
          label: depot.label,
          type: depot.type,
          factory: depot.factory,
          isDefault: depot.isDefault,
          isQuarantineWarehouse: depot.type === "QUARANTAINE",
          isActive: true,
        },
      }));

    ids.set(depot.code, enregistrement.id);

    // Emplacements de base : zones A a D.
    for (const zone of ["A", "B", "C", "D"]) {
      const codeEmplacement = `${zone}01`;
      const emplacementExistant = await prisma.location.findFirst({
        where: { warehouseId: enregistrement.id, code: codeEmplacement },
      });
      if (!emplacementExistant) {
        await prisma.location.create({
          data: {
            code: codeEmplacement,
            label: `Zone ${zone} - allee 01`,
            warehouseId: enregistrement.id,
            aisle: zone,
            rack: "01",
            isActive: true,
          },
        });
      }
    }
  }

  return ids;
}

// -----------------------------------------------------------------------------
// 4. Ateliers et operations
// -----------------------------------------------------------------------------

const ATELIERS = [
  { code: "ATL-ADM", label: "Atelier metallurgie ADMEDCO", factory: "ADMEDCO", sortOrder: 1 },
  { code: "ATL-MBX-PREP", label: "Preparation textile et mousse MOBILIX", factory: "MOBILIX", sortOrder: 2 },
  { code: "ATL-MBX-COUT", label: "Couture MOBILIX", factory: "MOBILIX", sortOrder: 3 },
  { code: "ATL-MBX-CAP", label: "Capitonnage MOBILIX", factory: "MOBILIX", sortOrder: 4 },
  { code: "ATL-MBX-ASS", label: "Assemblage final et conditionnement MOBILIX", factory: "MOBILIX", sortOrder: 5 },
];

const OPERATIONS = [
  // Chaine ADMEDCO (chassis metallique)
  {
    code: "COUPE",
    label: "Coupe",
    factory: "ADMEDCO" as const,
    atelier: "ATL-ADM",
    boardOrder: 1,
    standardTimeMinutes: "8",
    consumesSemiFinished: false,
    producesSemiFinished: false,
    requiresQualityCheck: false,
    colorCode: "#2563eb",
  },
  {
    code: "USINAGE",
    label: "Usinage",
    factory: "ADMEDCO" as const,
    atelier: "ATL-ADM",
    boardOrder: 2,
    standardTimeMinutes: "12",
    consumesSemiFinished: true,
    producesSemiFinished: false,
    requiresQualityCheck: false,
    colorCode: "#0891b2",
  },
  {
    code: "SOUDAGE",
    label: "Soudage",
    factory: "ADMEDCO" as const,
    atelier: "ATL-ADM",
    boardOrder: 3,
    standardTimeMinutes: "20",
    consumesSemiFinished: true,
    producesSemiFinished: false,
    requiresQualityCheck: true,
    colorCode: "#7c3aed",
  },
  {
    code: "MEULAGE",
    label: "Meulage",
    factory: "ADMEDCO" as const,
    atelier: "ATL-ADM",
    boardOrder: 4,
    standardTimeMinutes: "10",
    consumesSemiFinished: true,
    producesSemiFinished: false,
    requiresQualityCheck: false,
    colorCode: "#d97706",
  },
  {
    code: "VISSAGE",
    label: "Vissage",
    factory: "ADMEDCO" as const,
    atelier: "ATL-ADM",
    boardOrder: 5,
    standardTimeMinutes: "6",
    consumesSemiFinished: true,
    producesSemiFinished: false,
    requiresQualityCheck: false,
    colorCode: "#65a30d",
  },
  {
    code: "POUDRAGE",
    label: "Poudrage",
    factory: "ADMEDCO" as const,
    atelier: "ATL-ADM",
    boardOrder: 6,
    standardTimeMinutes: "25",
    consumesSemiFinished: true,
    producesSemiFinished: true,
    requiresQualityCheck: true,
    colorCode: "#dc2626",
  },

  // Chaine MOBILIX (bois, textile, capitonnage)
  {
    code: "MBX-PREP-TEXTILE",
    label: "Preparation textile et mousse",
    factory: "MOBILIX" as const,
    atelier: "ATL-MBX-PREP",
    boardOrder: 11,
    standardTimeMinutes: "10",
    requiresQualityCheck: false,
    colorCode: "#0ea5e9",
  },
  {
    code: "MBX-COUPE-TISSU",
    label: "Coupe tissu",
    factory: "MOBILIX" as const,
    atelier: "ATL-MBX-PREP",
    boardOrder: 12,
    standardTimeMinutes: "14",
    requiresQualityCheck: false,
    colorCode: "#06b6d4",
  },
  {
    code: "MBX-COUTURE",
    label: "Couture",
    factory: "MOBILIX" as const,
    atelier: "ATL-MBX-COUT",
    boardOrder: 13,
    standardTimeMinutes: "22",
    requiresQualityCheck: true,
    colorCode: "#8b5cf6",
  },
  {
    code: "MBX-PREP-BOIS",
    label: "Preparation bois",
    factory: "MOBILIX" as const,
    atelier: "ATL-MBX-PREP",
    boardOrder: 14,
    standardTimeMinutes: "12",
    requiresQualityCheck: false,
    colorCode: "#f59e0b",
  },
  {
    code: "MBX-USINAGE-BOIS",
    label: "Usinage bois",
    factory: "MOBILIX" as const,
    atelier: "ATL-MBX-PREP",
    boardOrder: 15,
    standardTimeMinutes: "16",
    requiresQualityCheck: false,
    colorCode: "#f97316",
  },
  {
    code: "MBX-INSERTS",
    label: "Montage des inserts",
    factory: "MOBILIX" as const,
    atelier: "ATL-MBX-PREP",
    boardOrder: 16,
    standardTimeMinutes: "8",
    requiresQualityCheck: false,
    colorCode: "#a3a30d",
  },
  {
    code: "MBX-CAPITONNAGE",
    label: "Capitonnage",
    factory: "MOBILIX" as const,
    atelier: "ATL-MBX-CAP",
    boardOrder: 17,
    standardTimeMinutes: "30",
    consumesSemiFinished: true,
    requiresQualityCheck: true,
    colorCode: "#db2777",
  },
  {
    code: "MBX-ACCOUDOIRS",
    label: "Pose des accoudoirs",
    factory: "MOBILIX" as const,
    atelier: "ATL-MBX-CAP",
    boardOrder: 18,
    standardTimeMinutes: "9",
    consumesSemiFinished: true,
    requiresQualityCheck: false,
    colorCode: "#e11d48",
  },
  {
    code: "MBX-ASSEMBLAGE",
    label: "Assemblage final",
    factory: "MOBILIX" as const,
    atelier: "ATL-MBX-ASS",
    boardOrder: 19,
    standardTimeMinutes: "18",
    consumesSemiFinished: true,
    requiresQualityCheck: true,
    colorCode: "#16a34a",
  },
  {
    code: "MBX-CQ-FINAL",
    label: "Controle qualite final",
    factory: "MOBILIX" as const,
    atelier: "ATL-MBX-ASS",
    boardOrder: 20,
    standardTimeMinutes: "6",
    requiresQualityCheck: true,
    colorCode: "#0d9488",
  },
  {
    code: "MBX-EMBALLAGE",
    label: "Emballage",
    factory: "MOBILIX" as const,
    atelier: "ATL-MBX-ASS",
    boardOrder: 21,
    standardTimeMinutes: "7",
    requiresQualityCheck: false,
    colorCode: "#64748b",
  },
  {
    code: "MBX-EXPEDITION",
    label: "Expedition",
    factory: "MOBILIX" as const,
    atelier: "ATL-MBX-ASS",
    boardOrder: 22,
    standardTimeMinutes: "5",
    requiresQualityCheck: false,
    colorCode: "#475569",
  },
];

async function semerAteliersEtOperations(): Promise<{
  ateliers: number;
  operations: number;
}> {
  const idsAteliers = new Map<string, number>();
  let ateliers = 0;
  let operations = 0;

  for (const atelier of ATELIERS) {
    const existant = await prisma.workshop.findUnique({ where: { code: atelier.code } });
    const enregistrement =
      existant ??
      (await prisma.workshop.create({
        data: {
          code: atelier.code,
          label: atelier.label,
          factory: atelier.factory as Factory,
          sortOrder: atelier.sortOrder,
          isActive: true,
        },
      }));
    if (!existant) ateliers += 1;
    idsAteliers.set(atelier.code, enregistrement.id);
  }

  for (const operation of OPERATIONS) {
    const existante = await prisma.operation.findUnique({
      where: { code: operation.code },
    });
    const donnees = {
      label: operation.label,
      factory: operation.factory as Factory,
      workshopId: idsAteliers.get(operation.atelier) ?? null,
      boardOrder: operation.boardOrder,
      standardTimeMinutes: operation.standardTimeMinutes ?? "0",
      requiresQualityCheck: operation.requiresQualityCheck ?? false,
      consumesSemiFinished: operation.consumesSemiFinished ?? false,
      producesSemiFinished: operation.producesSemiFinished ?? false,
      isKanbanVisible: true,
      colorCode: operation.colorCode ?? null,
      isActive: true,
    };

    if (existante) {
      await prisma.operation.update({
        where: { id: existante.id },
        data: {
          workshopId: donnees.workshopId,
          boardOrder: donnees.boardOrder,
          isKanbanVisible: true,
        },
      });
    } else {
      await prisma.operation.create({ data: { code: operation.code, ...donnees } });
      operations += 1;
    }
  }

  return { ateliers, operations };
}

async function semerPostesDeTravail(): Promise<number> {
  const operations = await prisma.operation.findMany({
    select: { id: true, code: true, label: true, factory: true, workshopId: true },
  });

  let crees = 0;
  for (const operation of operations) {
    const code = `PT-${operation.code}`;
    const existant = await prisma.workCenter.findUnique({ where: { code } });
    if (!existant) {
      await prisma.workCenter.create({
        data: {
          code,
          label: `Poste ${operation.label}`,
          factory: operation.factory,
          workshopId: operation.workshopId,
          operationId: operation.id,
          operatorsRequired: 1,
          capacityPerHour: "0",
          costPerHour: "0",
          isActive: true,
        },
      });
      crees += 1;
    }
  }
  return crees;
}

// -----------------------------------------------------------------------------
// 5. Familles d'articles et catalogue produit
// -----------------------------------------------------------------------------

const FAMILLES = [
  { code: "FAM-MP-ACIER", label: "Acier et profiles metalliques" },
  { code: "FAM-MP-TUBE", label: "Tubes et tubes carres" },
  { code: "FAM-MP-BOIS", label: "Bois et panneaux" },
  { code: "FAM-MP-TISSU", label: "Tissus et revetements" },
  { code: "FAM-MP-MOUSSE", label: "Mousses et rembourrages" },
  { code: "FAM-MP-QUINCAILLERIE", label: "Quincaillerie et fixations" },
  { code: "FAM-MP-PEINTURE", label: "Poudres et peintures" },
  { code: "FAM-SF", label: "Semi-finis de fabrication" },
  { code: "FAM-PF", label: "Produits finis" },
  { code: "FAM-KIT", label: "Kits et ensembles" },
  { code: "FAM-EMB", label: "Emballages et consommables" },
];

const ARTICLES_CATALOGUE = [
  {
    code: "CHCANADA",
    label: "Chassis CANADA",
    type: "SEMI_FINI" as const,
    factory: "ADMEDCO" as const,
    famille: "FAM-SF",
    isProducible: true,
    isSemiFinished: true,
  },
  {
    code: "CHG021",
    label: "Chassis G21",
    type: "SEMI_FINI" as const,
    factory: "ADMEDCO" as const,
    famille: "FAM-SF",
    isProducible: true,
    isSemiFinished: true,
  },
  {
    code: "CHG020",
    label: "Chassis G20",
    type: "SEMI_FINI" as const,
    factory: "ADMEDCO" as const,
    famille: "FAM-SF",
    isProducible: true,
    isSemiFinished: true,
  },
  {
    code: "SCLCND",
    label: "Structure SCL CANADA",
    type: "SEMI_FINI" as const,
    factory: "ADMEDCO" as const,
    famille: "FAM-SF",
    isProducible: true,
    isSemiFinished: true,
  },
  {
    code: "SCLG021",
    label: "Structure SCL G21",
    type: "SEMI_FINI" as const,
    factory: "ADMEDCO" as const,
    famille: "FAM-SF",
    isProducible: true,
    isSemiFinished: true,
  },
  {
    code: "SCLG020",
    label: "Structure SCL G20",
    type: "SEMI_FINI" as const,
    factory: "ADMEDCO" as const,
    famille: "FAM-SF",
    isProducible: true,
    isSemiFinished: true,
  },
  {
    code: "DCANADA",
    label: "Dossier CANADA",
    type: "SEMI_FINI" as const,
    factory: "MOBILIX" as const,
    famille: "FAM-SF",
    isProducible: true,
    isSemiFinished: true,
  },
  {
    code: "TRIP-CANADA",
    label: "Tripode CANADA",
    type: "SEMI_FINI" as const,
    factory: "ADMEDCO" as const,
    famille: "FAM-SF",
    isProducible: true,
    isSemiFinished: true,
  },
  {
    code: "CHCANADA-PF",
    label: "Chaise CANADA",
    type: "PRODUIT_FINI" as const,
    factory: "MOBILIX" as const,
    famille: "FAM-PF",
    isProducible: true,
    isSellable: true,
  },
  {
    code: "CHG021-PF",
    label: "Chaise G21",
    type: "PRODUIT_FINI" as const,
    factory: "MOBILIX" as const,
    famille: "FAM-PF",
    isProducible: true,
    isSellable: true,
  },
  {
    code: "CHG020-PF",
    label: "Chaise G20",
    type: "PRODUIT_FINI" as const,
    factory: "MOBILIX" as const,
    famille: "FAM-PF",
    isProducible: true,
    isSellable: true,
  },
  {
    code: "KIT-CHCNDG21G20",
    label: "Kit chaises CANADA / G21 / G20",
    type: "PRODUIT_FINI" as const,
    factory: "MOBILIX" as const,
    famille: "FAM-KIT",
    isKit: true,
    isSellable: true,
  },
];

async function semerFamillesEtArticles(): Promise<{
  familles: number;
  articles: number;
  chassisPeintId: number;
}> {
  const idsFamilles = new Map<string, number>();
  let familles = 0;

  for (const famille of FAMILLES) {
    const existante = await prisma.itemFamily.findUnique({ where: { code: famille.code } });
    const enregistrement =
      existante ??
      (await prisma.itemFamily.create({
        data: { code: famille.code, label: famille.label, isActive: true },
      }));
    if (!existante) familles += 1;
    idsFamilles.set(famille.code, enregistrement.id);
  }

  let articles = 0;

  for (const article of ARTICLES_CATALOGUE) {
    const existant = await prisma.item.findUnique({ where: { code: article.code } });
    if (!existant) {
      await prisma.item.create({
        data: {
          code: article.code,
          label1: article.label,
          type: article.type,
          factory: article.factory as Factory,
          familyId: idsFamilles.get(article.famille) ?? null,
          unitCode: "PCS",
          isProducible: article.isProducible ?? false,
          isSellable: article.isSellable ?? false,
          isSemiFinished: article.isSemiFinished ?? false,
          isKit: article.isKit ?? false,
          status: "ACTIF",
        },
      });
      articles += 1;
    }
  }

  // Semi-fini « chassis peint » produit par la fin du poudrage.
  // La resolution recherche d'abord un article equivalent deja importe
  // (donnees sources COM_Item.csv) : aucun doublon n'est cree, et l'article
  // deja designe par la regle de transfert n'est jamais remplace en silence.
  const chassisPeint = await assurerChassisPeint(prisma);
  if (chassisPeint.origine === "CREE") {
    articles += 1;
  }

  return { familles, articles, chassisPeintId: chassisPeint.itemId };
}

// -----------------------------------------------------------------------------
// 6. Regle de transfert automatique inter-divisions
// -----------------------------------------------------------------------------

async function semerRegleTransfert(
  depots: Map<string, number>,
  chassisPeintId: number,
): Promise<boolean> {
  const code = "TRF-POUDRAGE-CHASSIS";
  const existante = await prisma.divisionTransferRule.findUnique({ where: { code } });
  if (existante) {
    await prisma.divisionTransferRule.update({
      where: { code },
      data: { producedItemId: chassisPeintId },
    });
    return false;
  }

  const sourceId = depots.get("DEP-MP");
  const cibleId = depots.get("DEP-MP-MBX");
  if (!sourceId || !cibleId) {
    throw new Error(
      "Depots DEP-MP et DEP-MP-MBX introuvables : impossible de creer la regle de transfert.",
    );
  }

  await prisma.divisionTransferRule.create({
    data: {
      code,
      label: "Transfert automatique du chassis peint apres poudrage",
      triggerOperationCode: "POUDRAGE",
      producedItemId: chassisPeintId,
      sourceWarehouseId: sourceId,
      targetWarehouseId: cibleId,
      factorySource: "ADMEDCO",
      factoryTarget: "MOBILIX",
      isActive: true,
      comment:
        "A la fin du poudrage, la quantite produite reelle est validee, les consommations reelles sont enregistrees, le chassis peint entre en stock DEP-MP puis est transfere vers DEP-MP-MBX pour etre disponible a MOBILIX.",
    },
  });

  return true;
}

// -----------------------------------------------------------------------------
// 7. Comptabilite : journaux, comptes et regles d'ecriture configurables
// -----------------------------------------------------------------------------

const JOURNAUX = [
  { code: "VE", label: "Journal des ventes", type: "VENTE" as const },
  { code: "AC", label: "Journal des achats", type: "ACHAT" as const },
  { code: "BQ", label: "Journal de banque", type: "BANQUE" as const },
  { code: "CA", label: "Journal de caisse", type: "CAISSE" as const },
  { code: "ST", label: "Journal des stocks", type: "STOCK" as const },
  { code: "PR", label: "Journal de production", type: "PRODUCTION" as const },
  { code: "OD", label: "Operations diverses", type: "OPERATIONS_DIVERSES" as const },
];

/**
 * Plan de comptes generique et PROVISOIRE.
 * Les numeros de comptes doivent etre ajustes par le comptable de l'entreprise
 * selon son plan comptable : aucune regle fiscale n'est prescrite ici.
 */
const COMPTES = [
  { number: "401", label: "Fournisseurs", type: "PASSIF" as const },
  { number: "411", label: "Clients", type: "ACTIF" as const },
  { number: "4456", label: "TVA deductible", type: "ACTIF" as const },
  { number: "4457", label: "TVA collectee", type: "PASSIF" as const },
  { number: "512", label: "Banque", type: "ACTIF" as const },
  { number: "530", label: "Caisse", type: "ACTIF" as const },
  { number: "601", label: "Achats de matieres premieres", type: "CHARGE" as const },
  { number: "701", label: "Ventes de produits finis", type: "PRODUIT" as const },
  { number: "31", label: "Stocks de matieres premieres", type: "ACTIF" as const },
  { number: "35", label: "Stocks de produits finis", type: "ACTIF" as const },
  { number: "33", label: "Stocks d'en-cours de production", type: "ACTIF" as const },
  { number: "603", label: "Variations des stocks", type: "CHARGE" as const },
  { number: "71", label: "Production stockee", type: "PRODUIT" as const },
  { number: "602", label: "Achats consommes de matieres", type: "CHARGE" as const },
];

const REGLES_ECRITURE = [
  {
    eventCode: EVENEMENTS_COMPTABLES.RECEPTION_FOURNISSEUR,
    label: "Reception fournisseur - entree en stock",
    journalCode: "ST",
    debitAccountNumber: "31",
    creditAccountNumber: "603",
    description:
      "Entree en stock des matieres receptionnees. Comptes a ajuster selon le plan comptable de l'entreprise.",
  },
  {
    eventCode: EVENEMENTS_COMPTABLES.FACTURE_FOURNISSEUR,
    label: "Facture fournisseur",
    journalCode: "AC",
    debitAccountNumber: "601",
    creditAccountNumber: "401",
    vatAccountNumber: "4456",
    description: "Enregistrement de la facture fournisseur avec TVA deductible.",
  },
  {
    eventCode: EVENEMENTS_COMPTABLES.FACTURE_CLIENT,
    label: "Facture client",
    journalCode: "VE",
    debitAccountNumber: "411",
    creditAccountNumber: "701",
    vatAccountNumber: "4457",
    description: "Vente de produits finis avec TVA collectee.",
  },
  {
    eventCode: EVENEMENTS_COMPTABLES.SORTIE_STOCK_LIVRAISON,
    label: "Sortie de stock pour livraison",
    journalCode: "ST",
    debitAccountNumber: "603",
    creditAccountNumber: "35",
    description: "Sortie de stock des produits finis livres.",
  },
  {
    eventCode: EVENEMENTS_COMPTABLES.REGLEMENT_CLIENT,
    label: "Reglement client",
    journalCode: "BQ",
    debitAccountNumber: "512",
    creditAccountNumber: "411",
    description: "Encaissement d'un reglement client.",
  },
  {
    eventCode: EVENEMENTS_COMPTABLES.REGLEMENT_FOURNISSEUR,
    label: "Reglement fournisseur",
    journalCode: "BQ",
    debitAccountNumber: "401",
    creditAccountNumber: "512",
    description: "Decaissement d'un reglement fournisseur.",
  },
  {
    eventCode: EVENEMENTS_COMPTABLES.PRODUCTION_PRODUIT_FINI,
    label: "Entree en stock de produits finis",
    journalCode: "ST",
    debitAccountNumber: "35",
    creditAccountNumber: "71",
    description: "Valorisation des produits finis issus de la production.",
  },
  {
    eventCode: EVENEMENTS_COMPTABLES.CONSOMMATION_PRODUCTION,
    label: "Consommation de matieres en production",
    journalCode: "ST",
    debitAccountNumber: "602",
    creditAccountNumber: "31",
    description: "Sortie de stock des matieres consommees en production.",
  },
];

async function semerComptabilite(): Promise<{
  journaux: number;
  comptes: number;
  regles: number;
}> {
  let journaux = 0;
  let comptes = 0;
  let regles = 0;

  for (const journal of JOURNAUX) {
    const existant = await prisma.journal.findUnique({ where: { code: journal.code } });
    if (!existant) {
      await prisma.journal.create({
        data: { code: journal.code, label: journal.label, type: journal.type, isActive: true },
      });
      journaux += 1;
    }
  }

  for (const compte of COMPTES) {
    const existant = await prisma.account.findUnique({
      where: { number: compte.number },
    });
    if (!existant) {
      await prisma.account.create({
        data: {
          number: compte.number,
          label: compte.label,
          type: compte.type,
          isActive: true,
          currency: "DZD",
        },
      });
      comptes += 1;
    }
  }

  for (const regle of REGLES_ECRITURE) {
    const existante = await prisma.accountingRule.findUnique({
      where: { eventCode: regle.eventCode },
    });
    if (!existante) {
      await prisma.accountingRule.create({
        data: {
          eventCode: regle.eventCode,
          label: regle.label,
          journalCode: regle.journalCode,
          debitAccountNumber: regle.debitAccountNumber,
          creditAccountNumber: regle.creditAccountNumber,
          vatAccountNumber: regle.vatAccountNumber ?? null,
          vatRateCode: regle.vatAccountNumber ? "TVA19" : null,
          isActive: true,
          description: regle.description,
        },
      });
      regles += 1;
    }
  }

  return { journaux, comptes, regles };
}

// -----------------------------------------------------------------------------
// 8. Exercice comptable courant
// -----------------------------------------------------------------------------

async function semerExercice(date = new Date()): Promise<boolean> {
  const annee = date.getFullYear();
  const code = String(annee);
  const existant = await prisma.fiscalYear.findUnique({ where: { code } });
  if (existant) return false;

  const anneeCreee = await prisma.fiscalYear.create({
    data: {
      code,
      label: `Exercice ${annee}`,
      startDate: new Date(Date.UTC(annee, 0, 1)),
      endDate: new Date(Date.UTC(annee, 11, 31, 23, 59, 59)),
      status: "OUVERT",
    },
  });

  for (let mois = 0; mois < 12; mois += 1) {
    const debut = new Date(Date.UTC(annee, mois, 1));
    const fin = new Date(Date.UTC(annee, mois + 1, 0, 23, 59, 59));
    await prisma.accountingPeriod.create({
      data: {
        fiscalYearId: anneeCreee.id,
        code: `${annee}-${String(mois + 1).padStart(2, "0")}`,
        label: debut.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
        startDate: debut,
        endDate: fin,
        status: "OUVERT",
      },
    });
  }

  return true;
}

// -----------------------------------------------------------------------------
// 9. Parametres de valorisation des evaluations
// -----------------------------------------------------------------------------

const PONDERATIONS_EVALUATION = [
  {
    code: "PRODUCTIVITE",
    label: "Productivite",
    weight: "30",
    description:
      "Rapport entre la production conforme reelle et le temps standard de l'operation effectuee, jamais de l'operation theorique.",
  },
  {
    code: "QUALITE",
    label: "Qualite",
    weight: "25",
    description:
      "Taux de conformite, rebuts et reprises rattaches aux operations reellement realisees par l'employe.",
  },
  {
    code: "EFFICACITE_MATIERE",
    label: "Efficacite matiere",
    weight: "20",
    description:
      "Ecart entre la consommation theorique de la nomenclature et la consommation reelle declaree.",
  },
  {
    code: "PRESENCE",
    label: "Presence",
    weight: "15",
    description: "Presence, retards et heures effectivement travaillees sur la periode.",
  },
  {
    code: "POLYVALENCE",
    label: "Polyvalence",
    weight: "10",
    description:
      "Diversite des operations maitrisees et effectivement realisees, mesuree sur les competences validees.",
  },
];

async function semerPonderationsEvaluation(): Promise<number> {
  let crees = 0;
  for (const ponderation of PONDERATIONS_EVALUATION) {
    const existante = await prisma.evaluationWeight.findUnique({
      where: { code: ponderation.code },
    });
    if (!existante) {
      await prisma.evaluationWeight.create({
        data: {
          code: ponderation.code,
          label: ponderation.label,
          weight: ponderation.weight,
          description: ponderation.description,
          isActive: true,
        },
      });
      crees += 1;
    }
  }
  return crees;
}

// -----------------------------------------------------------------------------
// Orchestration
// -----------------------------------------------------------------------------

async function principal() {
  console.log("Initialisation du referentiel ERP + MES ADMEDCO / MOBILIX");
  console.log("Aucune donnee de demonstration n'est creee.\n");

  const permissions = await semerPermissions();
  console.log(`Permissions ................. ${permissions} creee(s)`);

  const roles = await semerRoles();
  console.log(
    `Roles ....................... ${ROLE_DEFINITIONS.length} verifie(s), ${roles.liens} liaison(s) ajoutee(s), ${roles.retires} obsolete(s) retiree(s)`,
  );

  const unites = await semerUnites();
  console.log(`Unites de mesure ............ ${unites} creee(s)`);

  const tva = await semerTauxTva();
  console.log(`Taux de TVA ................. ${tva} cree(s)`);

  const depots = await semerDepots();
  console.log(`Depots ...................... ${depots.size} verifie(s)`);

  const ateliers = await semerAteliersEtOperations();
  console.log(
    `Ateliers / operations ....... ${ATELIERS.length} atelier(s), ${OPERATIONS.length} operation(s), ${ateliers.operations} creee(s)`,
  );

  const postes = await semerPostesDeTravail();
  console.log(`Postes de travail ........... ${postes} cree(s)`);

  const familles = await semerFamillesEtArticles();
  console.log(
    `Familles / articles ......... ${FAMILLES.length} famille(s), ${familles.articles} article(s) cree(s)`,
  );

  const regleCreee = await semerRegleTransfert(depots, familles.chassisPeintId);
  console.log(
    `Regle transfert chassis ..... ${regleCreee ? "creee" : "deja presente"}`,
  );

  const comptabilite = await semerComptabilite();
  console.log(
    `Comptabilite ................ ${comptabilite.journaux} journal(aux), ${comptabilite.comptes} compte(s), ${comptabilite.regles} regle(s)`,
  );

  const exercice = await semerExercice();
  console.log(`Exercice comptable .......... ${exercice ? "cree" : "deja present"}`);

  const ponderations = await semerPonderationsEvaluation();
  console.log(`Grille d'evaluation ......... ${ponderations} creee(s)`);

  const parametres = await initialiserParametres(prisma);
  console.log(`Parametres applicatifs ...... ${parametres} cree(s)`);

  const sequences = await initialiserSequences(prisma);
  console.log(`Sequences documentaires ..... ${sequences} creee(s)`);

  console.log("\nReferentiel initialise.");
  console.log(
    "Aucun compte utilisateur n'a ete cree. Utilisez la procedure securisee :",
  );
  console.log("  npm run bootstrap:admin");
}

principal()
  .catch((erreur) => {
    console.error("\nEchec de l'initialisation du referentiel :");
    console.error(erreur);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
