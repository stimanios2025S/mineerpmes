import type { Factory, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import type { SessionUser } from "@/lib/auth/session";
import { usinesAutorisees } from "@/lib/rbac/guard";
import { bornesJour, bornesMois, ilYA } from "./service";


/**
 * Indicateurs des tableaux de bord de pilotage (production, finance, RH).
 *
 * Memes regles que le tableau de bord general : tout est calcule a partir des
 * donnees reellement enregistrees, borne a la portee de division de
 * l'utilisateur, et un taux qui ne peut pas etre calcule vaut `null` (affiche
 * « non calculable ») plutot qu'une valeur inventee.
 */

const STATUTS_FACTURE_ACTIVE: Prisma.InvoiceWhereInput["status"] = {
  in: ["VALIDEE", "POSTEE", "PARTIELLEMENT_REGLEE", "REGLEE", "EN_RETARD"],
};

const STATUTS_ORDRE_OUVERT: Prisma.WorkOrderWhereInput["status"] = {
  in: [
    "PLANIFIE",
    "LANCE",
    "EN_COURS",
    "SUSPENDU",
    "EN_CONTROLE_QUALITE",
    "PARTIELLEMENT_TERMINE",
  ],
};

// =============================================================================
// PILOTAGE PRODUCTION
// =============================================================================

export interface LigneOperationEnCours {
  id: number;
  ordre: string;
  operation: string;
  poste: string | null;
  operateur: string | null;
  quantitePrevue: string;
  quantiteProduite: string;
  quantiteRebut: string;
  demarreeLe: Date | null;
  statut: string;
  division: Factory;
}

export interface LigneDeclarationRecente {
  id: string;
  ordre: string;
  operation: string;
  type: string;
  employe: string | null;
  quantite: string;
  quantiteConforme: string;
  categoriePerte: string | null;
  motifPerte: string | null;
  statut: string;
  survenueLe: Date;
}

export interface IndicateursPilotageProduction {
  ordresParStatut: { statut: string; nombre: number }[];
  ordresOuverts: number;
  ordresEnRetard: number;
  ordresUrgents: number;
  ordresSansLancement: number;

  quantiteDeclaree30Jours: string;
  quantiteConforme30Jours: string;
  quantiteRebutee30Jours: string;
  quantiteReprise30Jours: string;
  quantiteRetournee30Jours: string;
  quantiteConsommee30Jours: string;
  tauxRebut30Jours: string | null;
  tauxConformite30Jours: string | null;

  operationsParStatut: { statut: string; nombre: number }[];
  operationsEnCours: number;
  operationsEnPause: number;
  operationsNonDemarrees: number;

  declarationsEnAttente: number;
  declarations30Jours: number;
  declarationsRejetees30Jours: number;

  deplacementsKanban7Jours: number;
  transfertsInterAteliers30Jours: number;
  quantiteTransferree30Jours: string;

  parDivision: {
    division: Factory;
    ordresOuverts: number;
    ordresEnRetard: number;
    quantiteDeclaree30Jours: string;
    rebut30Jours: string;
  }[];

  operationsEnCoursListe: LigneOperationEnCours[];
  ordresEnRetardListe: {
    id: number;
    numero: string;
    article: string;
    division: Factory;
    echeance: Date;
    reste: string;
    priorite: string;
  }[];
  dernieresDeclarations: LigneDeclarationRecente[];
  pertesParMotif30Jours: { motif: string; categorie: string; quantite: string }[];
}

export async function indicateursPilotageProduction(
  utilisateur: SessionUser,
): Promise<IndicateursPilotageProduction> {
  const usines = usinesAutorisees(utilisateur);
  const maintenant = new Date();
  const depuis30Jours = ilYA(30, maintenant);
  const depuis7Jours = ilYA(7, maintenant);

  const [
    ordresGroupeParStatut,
    ordresOuverts,
    ordresEnRetard,
    ordresUrgents,
    ordresSansLancement,
    declarationsProduction,
    declarationsPerte,
    declarationsConsommation,
    declarationsPeriode,
    operationsGroupeParStatut,
    kanban7,
    transferts30,
    mouvementsTransfert30,
    divisions,
  ] = await Promise.all([
    prisma.workOrder.groupBy({
      by: ["status"],
      where: { factory: { in: usines } },
      _count: { _all: true },
    }),
    prisma.workOrder.count({ where: { factory: { in: usines }, status: STATUTS_ORDRE_OUVERT } }),
    prisma.workOrder.count({
      where: {
        factory: { in: usines },
        status: STATUTS_ORDRE_OUVERT,
        dueDate: { lt: maintenant },
      },
    }),
    prisma.workOrder.count({
      where: {
        factory: { in: usines },
        status: STATUTS_ORDRE_OUVERT,
        priority: { in: ["HAUTE", "URGENTE"] },
      },
    }),
    prisma.workOrder.count({ where: { factory: { in: usines }, status: "BROUILLON" } }),
    prisma.operationDeclaration.aggregate({
      _sum: { quantity: true, quantityConform: true },
      where: {
        kind: "PRODUCTION",
        status: "VALIDEE",
        occurredAt: { gte: depuis30Jours },
        workOrder: { factory: { in: usines } },
      },
    }),
    prisma.operationDeclaration.groupBy({
      by: ["lossCategory"],
      _sum: { quantity: true },
      where: {
        kind: "PERTE",
        status: "VALIDEE",
        occurredAt: { gte: depuis30Jours },
        workOrder: { factory: { in: usines } },
      },
    }),
    prisma.operationDeclaration.aggregate({
      _sum: { quantity: true },
      where: {
        kind: "CONSOMMATION",
        status: "VALIDEE",
        occurredAt: { gte: depuis30Jours },
        workOrder: { factory: { in: usines } },
      },
    }),
    prisma.operationDeclaration.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { occurredAt: { gte: depuis30Jours }, workOrder: { factory: { in: usines } } },
    }),
    prisma.workOrderOperation.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { workOrder: { factory: { in: usines } } },
    }),
    prisma.kanbanTransition.count({
      where: { occurredAt: { gte: depuis7Jours }, workOrder: { factory: { in: usines } } },
    }),
    prisma.stockMovement.count({
      where: {
        type: "TRANSFERT_INTER_DEPOTS",
        occurredAt: { gte: depuis30Jours },
        isReversal: false,
        sourceWarehouse: { factory: { in: usines } },
      },
    }),
    prisma.stockMovement.aggregate({
      _sum: { quantity: true },
      where: {
        type: "TRANSFERT_INTER_DEPOTS",
        occurredAt: { gte: depuis30Jours },
        isReversal: false,
        sourceWarehouse: { factory: { in: usines } },
      },
    }),
    Promise.all(
      (["ADMEDCO", "MOBILIX"] as Factory[])
        .filter((division) => usines.includes(division))
        .map(async (division) => {
          const [ouverts, retard, produit, rebut] = await Promise.all([
            prisma.workOrder.count({ where: { factory: division, status: STATUTS_ORDRE_OUVERT } }),
            prisma.workOrder.count({
              where: {
                factory: division,
                status: STATUTS_ORDRE_OUVERT,
                dueDate: { lt: maintenant },
              },
            }),
            prisma.operationDeclaration.aggregate({
              _sum: { quantity: true },
              where: {
                kind: "PRODUCTION",
                status: "VALIDEE",
                occurredAt: { gte: depuis30Jours },
                workOrder: { factory: division },
              },
            }),
            prisma.operationDeclaration.aggregate({
              _sum: { quantity: true },
              where: {
                kind: "PERTE",
                status: "VALIDEE",
                lossCategory: "REBUT",
                occurredAt: { gte: depuis30Jours },
                workOrder: { factory: division },
              },
            }),
          ]);
          return {
            division,
            ordresOuverts: ouverts,
            ordresEnRetard: retard,
            quantiteDeclaree30Jours: D.roundQuantity(produit._sum.quantity).toFixed(3),
            rebut30Jours: D.roundQuantity(rebut._sum.quantity).toFixed(3),
          };
        }),
    ),
  ]);

  const [operationsEnCoursListe, ordresEnRetardListe, dernieresDeclarations, pertesParMotif30Jours] =
    await Promise.all([
      prisma.workOrderOperation.findMany({
        where: { status: { in: ["EN_COURS", "EN_PAUSE"] }, workOrder: { factory: { in: usines } } },
        orderBy: [{ actualStart: "asc" }],
        take: 15,
        select: {
          id: true,
          status: true,
          quantityPlanned: true,
          quantityProduced: true,
          quantityScrapped: true,
          actualStart: true,
          workOrder: { select: { number: true, factory: true } },
          operation: { select: { label: true } },
          workCenter: { select: { label: true } },
          operator: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.workOrder.findMany({
        where: {
          factory: { in: usines },
          status: STATUTS_ORDRE_OUVERT,
          dueDate: { lt: maintenant },
        },
        orderBy: [{ dueDate: "asc" }],
        take: 15,
        select: {
          id: true,
          number: true,
          factory: true,
          dueDate: true,
          priority: true,
          quantityRemaining: true,
          item: { select: { code: true, label1: true } },
        },
      }),
      prisma.operationDeclaration.findMany({
        where: { workOrder: { factory: { in: usines } } },
        orderBy: { occurredAt: "desc" },
        take: 15,
        select: {
          id: true,
          kind: true,
          status: true,
          quantity: true,
          quantityConform: true,
          lossCategory: true,
          lossReason: true,
          occurredAt: true,
          workOrder: { select: { number: true } },
          operation: { select: { label: true } },
          employee: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.operationDeclaration.groupBy({
        by: ["lossReason", "lossCategory"],
        _sum: { quantity: true },
        where: {
          kind: "PERTE",
          status: "VALIDEE",
          occurredAt: { gte: depuis30Jours },
          workOrder: { factory: { in: usines } },
        },
        orderBy: { _sum: { quantity: "desc" } },
        take: 10,
      }),
    ]);

  const quantiteDeclaree = D.of(declarationsProduction._sum.quantity);
  const quantiteConforme = D.of(declarationsProduction._sum.quantityConform);
  const quantiteRebutee = D.of(
    declarationsPerte.find((ligne) => ligne.lossCategory === "REBUT")?._sum.quantity,
  );
  const quantiteReprise = D.of(
    declarationsPerte.find((ligne) => ligne.lossCategory === "REPRISE")?._sum.quantity,
  );
  const quantiteRetournee = D.of(
    declarationsPerte.find((ligne) => ligne.lossCategory === "RETOUR_STOCK")?._sum.quantity,
  );
  const totalProduitEtRebute = D.add(quantiteDeclaree, quantiteRebutee);

  const statutDeclarations = new Map(
    declarationsPeriode.map((ligne) => [ligne.status, ligne._count._all]),
  );

  return {
    ordresParStatut: ordresGroupeParStatut
      .map((ligne) => ({ statut: ligne.status, nombre: ligne._count._all }))
      .sort((a, b) => b.nombre - a.nombre),
    ordresOuverts,
    ordresEnRetard,
    ordresUrgents,
    ordresSansLancement,

    quantiteDeclaree30Jours: D.roundQuantity(quantiteDeclaree).toFixed(3),
    quantiteConforme30Jours: D.roundQuantity(quantiteConforme).toFixed(3),
    quantiteRebutee30Jours: D.roundQuantity(quantiteRebutee).toFixed(3),
    quantiteReprise30Jours: D.roundQuantity(quantiteReprise).toFixed(3),
    quantiteRetournee30Jours: D.roundQuantity(quantiteRetournee).toFixed(3),
    quantiteConsommee30Jours: D.roundQuantity(declarationsConsommation._sum.quantity).toFixed(3),
    tauxRebut30Jours: totalProduitEtRebute.isZero()
      ? null
      : D.roundRate(D.percent(quantiteRebutee, totalProduitEtRebute)).toFixed(2),
    tauxConformite30Jours: quantiteDeclaree.isZero()
      ? null
      : D.roundRate(D.percent(quantiteConforme, quantiteDeclaree)).toFixed(2),

    operationsParStatut: operationsGroupeParStatut
      .map((ligne) => ({ statut: ligne.status, nombre: ligne._count._all }))
      .sort((a, b) => b.nombre - a.nombre),
    operationsEnCours: operationsGroupeParStatut.find((l) => l.status === "EN_COURS")?._count._all ?? 0,
    operationsEnPause: operationsGroupeParStatut.find((l) => l.status === "EN_PAUSE")?._count._all ?? 0,
    operationsNonDemarrees:
      operationsGroupeParStatut.find((l) => l.status === "NON_DEMARREE")?._count._all ?? 0,

    declarationsEnAttente: (statutDeclarations.get("SAISIE") ?? 0) + (statutDeclarations.get("SOUMISE") ?? 0),
    declarations30Jours: declarationsPeriode.reduce((total, ligne) => total + ligne._count._all, 0),
    declarationsRejetees30Jours: statutDeclarations.get("REJETEE") ?? 0,

    deplacementsKanban7Jours: kanban7,
    transfertsInterAteliers30Jours: transferts30,
    quantiteTransferree30Jours: D.roundQuantity(mouvementsTransfert30._sum.quantity).toFixed(3),

    parDivision: divisions,

    operationsEnCoursListe: operationsEnCoursListe.map((operation) => ({
      id: operation.id,
      ordre: operation.workOrder.number,
      operation: operation.operation.label,
      poste: operation.workCenter?.label ?? null,
      operateur: operation.operator
        ? `${operation.operator.firstName} ${operation.operator.lastName}`
        : null,
      quantitePrevue: operation.quantityPlanned.toFixed(3),
      quantiteProduite: operation.quantityProduced.toFixed(3),
      quantiteRebut: operation.quantityScrapped.toFixed(3),
      demarreeLe: operation.actualStart,
      statut: operation.status,
      division: operation.workOrder.factory,
    })),

    ordresEnRetardListe: ordresEnRetardListe.map((ordre) => ({
      id: ordre.id,
      numero: ordre.number,
      article: `${ordre.item.code} — ${ordre.item.label1}`,
      division: ordre.factory,
      echeance: ordre.dueDate as Date,
      reste: ordre.quantityRemaining.toFixed(3),
      priorite: ordre.priority,
    })),

    dernieresDeclarations: dernieresDeclarations.map((declaration) => ({
      id: String(declaration.id),
      ordre: declaration.workOrder.number,
      operation: declaration.operation.label,
      type: declaration.kind,
      employe: declaration.employee
        ? `${declaration.employee.firstName} ${declaration.employee.lastName}`
        : null,
      quantite: declaration.quantity.toFixed(3),
      quantiteConforme: declaration.quantityConform.toFixed(3),
      categoriePerte: declaration.lossCategory,
      motifPerte: declaration.lossReason,
      statut: declaration.status,
      survenueLe: declaration.occurredAt,
    })),

    pertesParMotif30Jours: pertesParMotif30Jours.map((ligne) => ({
      motif: ligne.lossReason ?? "AUTRE",
      categorie: ligne.lossCategory ?? "PERTE_NORMALE",
      quantite: D.roundQuantity(ligne._sum.quantity).toFixed(3),
    })),
  };
}

// =============================================================================
// PILOTAGE FINANCE
// =============================================================================

export interface IndicateursPilotageFinance {
  debutMois: Date;
  finMois: Date;

  chiffreAffairesMoisHT: string;
  chiffreAffairesMoisPrecedentHT: string;
  avoirsMoisHT: string;
  coutVentesMois: string;
  margeBruteMois: string;
  tauxMargeMois: string | null;

  encaisseMois: string;
  decaisseMois: string;
  soldeTresorerieMois: string;

  creancesClients: string;
  dettesFournisseurs: string;
  facturesClientEnRetard: { nombre: number; montant: string };
  facturesFournisseurEnRetard: { nombre: number; montant: string };

  reglementsBrouillon: number;
  reglementsNonAffectes: { nombre: number; montant: string };

  ecrituresBrouillon: number;
  ecrituresMois: number;
  totalDebitMois: string;
  totalCreditMois: string;
  ecrituresDesequilibrees: number;
  exerciceEnCours: string | null;
  periodesOuvertes: number;

  facturesBrouillonClient: number;
  facturesBrouillonFournisseur: number;

  topClients: { id: number; code: string; libelle: string; montantHT: string }[];
  facturesEnRetardListe: {
    id: number;
    numero: string;
    tiers: string;
    direction: string;
    echeance: Date | null;
    solde: string;
    joursRetard: number;
  }[];
  derniersReglements: {
    id: number;
    numero: string;
    direction: string;
    tiers: string;
    mode: string;
    date: Date;
    montant: string;
    statut: string;
  }[];
}

export async function indicateursPilotageFinance(
  utilisateur: SessionUser,
): Promise<IndicateursPilotageFinance> {
  const usines = usinesAutorisees(utilisateur);
  const maintenant = new Date();
  const mois = bornesMois(maintenant);

  const [
    caMois,
    caMoisPrecedent,
    avoirsMois,
    coutVentesMois,
    reglementsMois,
    creancesClients,
    dettesFournisseurs,
    facturesClientRetard,
    facturesFournisseurRetard,
    reglementsBrouillon,
    reglementsNonAffectes,
    ecrituresGroupeParStatut,
    ecrituresMois,
    ecrituresDesequilibrees,
    exercice,
    periodesOuvertes,
    facturesBrouillon,
    topClientsBruts,
  ] = await Promise.all([
    prisma.invoiceLine.aggregate({
      _sum: { lineHT: true },
      where: {
        invoice: {
          direction: "CLIENT",
          nature: "FACTURE",
          status: STATUTS_FACTURE_ACTIVE,
          invoiceDate: { gte: mois.debut, lt: mois.fin },
        },
      },
    }),
    prisma.invoiceLine.aggregate({
      _sum: { lineHT: true },
      where: {
        invoice: {
          direction: "CLIENT",
          nature: "FACTURE",
          status: STATUTS_FACTURE_ACTIVE,
          invoiceDate: { gte: mois.debutPrecedent, lt: mois.debut },
        },
      },
    }),
    prisma.invoiceLine.aggregate({
      _sum: { lineHT: true },
      where: {
        invoice: {
          direction: "CLIENT",
          nature: "AVOIR",
          status: STATUTS_FACTURE_ACTIVE,
          invoiceDate: { gte: mois.debut, lt: mois.fin },
        },
      },
    }),
    prisma.stockMovement.aggregate({
      _sum: { totalCost: true },
      where: {
        type: "LIVRAISON_CLIENT",
        isReversal: false,
        occurredAt: { gte: mois.debut, lt: mois.fin },
        warehouse: { factory: { in: usines } },
      },
    }),
    prisma.payment.groupBy({
      by: ["direction"],
      _sum: { amount: true },
      _count: { _all: true },
      where: {
        status: { in: ["VALIDE", "POSTE"] },
        paymentDate: { gte: mois.debut, lt: mois.fin },
      },
    }),
    prisma.invoice.aggregate({
      _sum: { balance: true },
      where: { direction: "CLIENT", status: STATUTS_FACTURE_ACTIVE },
    }),
    prisma.invoice.aggregate({
      _sum: { balance: true },
      where: { direction: "FOURNISSEUR", status: STATUTS_FACTURE_ACTIVE },
    }),
    prisma.invoice.findMany({
      where: {
        direction: "CLIENT",
        status: { in: ["VALIDEE", "POSTEE", "PARTIELLEMENT_REGLEE", "EN_RETARD"] },
        dueDate: { lt: maintenant },
        balance: { gt: 0 },
      },
      select: { balance: true },
    }),
    prisma.invoice.findMany({
      where: {
        direction: "FOURNISSEUR",
        status: { in: ["VALIDEE", "POSTEE", "PARTIELLEMENT_REGLEE", "EN_RETARD"] },
        dueDate: { lt: maintenant },
        balance: { gt: 0 },
      },
      select: { balance: true },
    }),
    prisma.payment.count({ where: { status: "BROUILLON" } }),
    prisma.payment.findMany({
      where: { status: { in: ["VALIDE", "POSTE"] } },
      select: { amount: true, allocatedAmount: true },
    }),
    prisma.accountingEntry.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.accountingEntry.aggregate({
      _count: { _all: true },
      _sum: { totalDebit: true, totalCredit: true },
      where: { entryDate: { gte: mois.debut, lt: mois.fin } },
    }),
    prisma.accountingEntry.count({
      where: {
        status: { not: "BROUILLON" },
        NOT: { totalDebit: { equals: prisma.accountingEntry.fields.totalCredit } },
      },
    }),
    prisma.fiscalYear.findFirst({
      where: { status: "OUVERT", startDate: { lte: maintenant }, endDate: { gte: maintenant } },
      select: { code: true, label: true },
    }),
    prisma.accountingPeriod.count({ where: { status: "OUVERT" } }),
    prisma.invoice.groupBy({
      by: ["direction"],
      _count: { _all: true },
      where: { status: "BROUILLON" },
    }),
    prisma.invoiceLine.groupBy({
      by: ["invoiceId"],
      _sum: { lineHT: true },
      where: {
        invoice: {
          direction: "CLIENT",
          nature: "FACTURE",
          status: STATUTS_FACTURE_ACTIVE,
          invoiceDate: { gte: mois.debut, lt: mois.fin },
        },
      },
      orderBy: { _sum: { lineHT: "desc" } },
      take: 5,
    }),
  ]);

  const [clientsTop, facturesEnRetardListe, derniersReglements] = await Promise.all([
    prisma.invoice.findMany({
      where: { id: { in: topClientsBruts.map((ligne) => ligne.invoiceId) } },
      select: { id: true, thirdParty: { select: { id: true, code: true, label1: true } } },
    }),
    prisma.invoice.findMany({
      where: {
        status: { in: ["VALIDEE", "POSTEE", "PARTIELLEMENT_REGLEE", "EN_RETARD"] },
        dueDate: { lt: maintenant },
        balance: { gt: 0 },
      },
      orderBy: { dueDate: "asc" },
      take: 15,
      select: {
        id: true,
        number: true,
        direction: true,
        dueDate: true,
        balance: true,
        thirdParty: { select: { label1: true } },
      },
    }),
    prisma.payment.findMany({
      orderBy: { paymentDate: "desc" },
      take: 12,
      select: {
        id: true,
        number: true,
        direction: true,
        method: true,
        paymentDate: true,
        amount: true,
        status: true,
        thirdParty: { select: { label1: true } },
      },
    }),
  ]);

  const ca = D.of(caMois._sum.lineHT);
  const avoirs = D.of(avoirsMois._sum.lineHT);
  const cout = D.abs(D.of(coutVentesMois._sum.totalCost));
  const marge = D.sub(D.sub(ca, avoirs), cout);

  const encaissements = reglementsMois.find((ligne) => ligne.direction === "ENCAISSEMENT");
  const decaissements = reglementsMois.find((ligne) => ligne.direction === "DECAISSEMENT");
  const encaisse = D.of(encaissements?._sum.amount);
  const decaisse = D.of(decaissements?._sum.amount);

  const nonAffectes = reglementsNonAffectes.reduce(
    (total, reglement) => D.add(total, D.sub(reglement.amount, reglement.allocatedAmount)),
    D.ZERO,
  );
  const nombreNonAffectes = reglementsNonAffectes.filter((reglement) =>
    D.gt(D.sub(reglement.amount, reglement.allocatedAmount), 0),
  ).length;

  const statutEcritures = new Map(
    ecrituresGroupeParStatut.map((ligne) => [ligne.status, ligne._count._all]),
  );

  const brouillonParDirection = new Map(
    facturesBrouillon.map((ligne) => [ligne.direction, ligne._count._all]),
  );

  return {
    debutMois: mois.debut,
    finMois: mois.fin,

    chiffreAffairesMoisHT: D.roundAmount(ca).toFixed(2),
    chiffreAffairesMoisPrecedentHT: D.roundAmount(caMoisPrecedent._sum.lineHT).toFixed(2),
    avoirsMoisHT: D.roundAmount(avoirs).toFixed(2),
    coutVentesMois: D.roundAmount(cout).toFixed(2),
    margeBruteMois: D.roundAmount(marge).toFixed(2),
    tauxMargeMois: ca.isZero() ? null : D.roundRate(D.percent(marge, ca)).toFixed(2),

    encaisseMois: D.roundAmount(encaisse).toFixed(2),
    decaisseMois: D.roundAmount(decaisse).toFixed(2),
    soldeTresorerieMois: D.roundAmount(D.sub(encaisse, decaisse)).toFixed(2),

    creancesClients: D.roundAmount(creancesClients._sum.balance).toFixed(2),
    dettesFournisseurs: D.roundAmount(dettesFournisseurs._sum.balance).toFixed(2),
    facturesClientEnRetard: {
      nombre: facturesClientRetard.length,
      montant: D.roundAmount(D.sum(facturesClientRetard.map((f) => f.balance))).toFixed(2),
    },
    facturesFournisseurEnRetard: {
      nombre: facturesFournisseurRetard.length,
      montant: D.roundAmount(D.sum(facturesFournisseurRetard.map((f) => f.balance))).toFixed(2),
    },

    reglementsBrouillon,
    reglementsNonAffectes: {
      nombre: nombreNonAffectes,
      montant: D.roundAmount(nonAffectes).toFixed(2),
    },

    ecrituresBrouillon: statutEcritures.get("BROUILLON") ?? 0,
    ecrituresMois: ecrituresMois._count._all,
    totalDebitMois: D.roundAmount(ecrituresMois._sum.totalDebit).toFixed(2),
    totalCreditMois: D.roundAmount(ecrituresMois._sum.totalCredit).toFixed(2),
    ecrituresDesequilibrees,
    exerciceEnCours: exercice ? `${exercice.code} — ${exercice.label}` : null,
    periodesOuvertes,

    facturesBrouillonClient: brouillonParDirection.get("CLIENT") ?? 0,
    facturesBrouillonFournisseur: brouillonParDirection.get("FOURNISSEUR") ?? 0,

    topClients: clientsTop
      .map((facture) => ({
        id: facture.thirdParty.id,
        code: facture.thirdParty.code,
        libelle: facture.thirdParty.label1,
        montantHT: D.roundAmount(
          topClientsBruts.find((ligne) => ligne.invoiceId === facture.id)?._sum.lineHT,
        ).toFixed(2),
      }))
      .sort((a, b) => Number(b.montantHT) - Number(a.montantHT)),

    facturesEnRetardListe: facturesEnRetardListe.map((facture) => ({
      id: facture.id,
      numero: facture.number,
      tiers: facture.thirdParty.label1,
      direction: facture.direction,
      echeance: facture.dueDate,
      solde: D.roundAmount(facture.balance).toFixed(2),
      joursRetard: facture.dueDate
        ? Math.max(0, Math.floor((maintenant.getTime() - facture.dueDate.getTime()) / 86400000))
        : 0,
    })),

    derniersReglements: derniersReglements.map((reglement) => ({
      id: reglement.id,
      numero: reglement.number,
      direction: reglement.direction,
      tiers: reglement.thirdParty.label1,
      mode: reglement.method,
      date: reglement.paymentDate,
      montant: D.roundAmount(reglement.amount).toFixed(2),
      statut: reglement.status,
    })),
  };
}

// =============================================================================
// PILOTAGE RESSOURCES HUMAINES
// =============================================================================

export interface IndicateursPilotageRh {
  effectifActif: number;
  effectifParDivision: { division: Factory; nombre: number }[];
  effectifParAtelier: { atelier: string; division: Factory; nombre: number }[];

  presentsJour: number;
  absentsJour: number;
  retardsJour: number;
  congesJour: number;
  employesSansPointage: number;
  heuresTravailleesJour: string;
  heuresSupplementairesJour: string;

  affectationsJour: number;
  affectationsEnCours: number;
  affectationsPlanifiees: number;
  affectationsTerminees: number;
  employesAffectesJour: number;
  employesSansAffectationJour: number;

  employesAvecCompetence: number;
  employesPolyvalents: number;
  operationsCouvertes: number;
  competencesParOperation: { operation: string; nombreEmployes: number; niveauMoyen: string }[];

  evaluationsNonValidees: number;
  evaluationsValidees: number;
  evaluations30Jours: number;
  noteGlobaleMoyenne: string | null;
  repartitionFiabilite: { niveau: string; nombre: number }[];

  declarationsParEmploye: {
    employe: string;
    matricule: string;
    quantite: string;
    nombreDeclarations: number;
  }[];

  employesSansAffectationListe: {
    id: number;
    matricule: string;
    nom: string;
    division: Factory;
    poste: string | null;
  }[];
  evaluationsNonValideesListe: {
    id: number;
    employe: string;
    periode: string;
    noteGlobale: string | null;
    fiabilite: string;
    debut: Date;
    fin: Date;
  }[];
  evaluationsInsuffisantesListe: {
    id: number;
    employe: string;
    periode: string;
    noteGlobale: string | null;
    debut: Date;
    fin: Date;
  }[];
}

export async function indicateursPilotageRh(
  utilisateur: SessionUser,
): Promise<IndicateursPilotageRh> {
  const usines = usinesAutorisees(utilisateur);
  const maintenant = new Date();
  const jour = bornesJour(maintenant);
  const depuis30Jours = ilYA(30, maintenant);

  const employesPortee = { factory: { in: usines } };

  const [
    effectifDivisions,
    employesParAtelier,
    pointagesJour,
    effectifTotal,
    affectationsJour,
    competencesParOperationBrutes,
    employesAvecCompetence,
    evaluationsGroupe,
    evaluationsFiabilite,
    evaluationsPeriode,
    declarationsParEmploye,
  ] = await Promise.all([
    prisma.employee.groupBy({
      by: ["factory"],
      _count: { _all: true },
      where: { ...employesPortee, isActive: true },
    }),
    prisma.employee.groupBy({
      by: ["workshopId", "factory"],
      _count: { _all: true },
      where: { ...employesPortee, isActive: true, workshopId: { not: null } },
    }),
    prisma.attendance.groupBy({
      by: ["status"],
      _sum: { workedHours: true, overtimeHours: true },
      _count: { _all: true },
      where: { date: { gte: jour.debut, lt: jour.fin }, employee: employesPortee },
    }),
    prisma.employee.count({ where: { ...employesPortee, isActive: true } }),
    prisma.assignment.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { date: { gte: jour.debut, lt: jour.fin }, factory: { in: usines } },
    }),
    prisma.employeeSkill.groupBy({
      by: ["skillId"],
      _count: { _all: true },
      _avg: { level: true },
      where: { employee: { ...employesPortee, isActive: true } },
    }),
    prisma.employeeSkill.groupBy({
      by: ["employeeId"],
      _count: { _all: true },
      where: { employee: { ...employesPortee, isActive: true } },
    }),
    prisma.performanceEvaluation.groupBy({
      by: ["isValidated"],
      _count: { _all: true },
      where: { employee: employesPortee },
    }),
    prisma.performanceEvaluation.groupBy({
      by: ["reliability"],
      _count: { _all: true },
      where: { employee: employesPortee },
    }),
    prisma.performanceEvaluation.findMany({
      where: { employee: employesPortee, periodEnd: { gte: depuis30Jours } },
      orderBy: { periodEnd: "desc" },
      take: 200,
      select: { globalScore: true, isValidated: true, reliability: true },
    }),
    prisma.operationDeclaration.groupBy({
      by: ["employeeId"],
      _sum: { quantity: true },
      _count: { _all: true },
      where: {
        kind: "PRODUCTION",
        status: "VALIDEE",
        occurredAt: { gte: depuis30Jours },
        employeeId: { not: null },
        workOrder: { factory: { in: usines } },
      },
      orderBy: { _sum: { quantity: "desc" } },
      take: 10,
    }),
  ]);

  const employesJour = await prisma.assignment.findMany({
    where: { date: { gte: jour.debut, lt: jour.fin }, factory: { in: usines } },
    select: { employeeId: true },
    distinct: ["employeeId"],
  });

  const pointagesParStatut = new Map(
    pointagesJour.map((ligne) => [ligne.status, ligne._count._all]),
  );
  const employesPointes = pointagesJour.reduce((total, ligne) => total + ligne._count._all, 0);

  const [employesSansAffectationListe, evaluationsOuvertesListe, ateliers] = await Promise.all([
    prisma.employee.findMany({
      where: {
        ...employesPortee,
        isActive: true,
        id: { notIn: employesJour.map((ligne) => ligne.employeeId) },
      },
      orderBy: [{ lastName: "asc" }],
      take: 50,
      select: {
        id: true,
        matricule: true,
        firstName: true,
        lastName: true,
        factory: true,
        jobTitle: true,
      },
    }),
    prisma.performanceEvaluation.findMany({
      where: { employee: employesPortee },
      orderBy: [{ isValidated: "asc" }, { periodEnd: "desc" }],
      take: 40,
      select: {
        id: true,
        periodType: true,
        periodStart: true,
        periodEnd: true,
        globalScore: true,
        reliability: true,
        isValidated: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.workshop.findMany({
      where: { factory: { in: usines } },
      select: { id: true, label: true, factory: true },
    }),
  ]);

  const libelleAtelier = new Map(ateliers.map((atelier) => [atelier.id, atelier]));

  const employesParCompetence = new Map(
    employesAvecCompetence.map((ligne) => [ligne.employeeId, ligne._count._all]),
  );

  const notes = evaluationsPeriode
    .map((evaluation) => evaluation.globalScore)
    .filter((note): note is NonNullable<typeof note> => note !== null);

  const operations = await prisma.skill.findMany({
    where: { id: { in: competencesParOperationBrutes.map((ligne) => ligne.skillId) } },
    select: { id: true, label: true, operation: { select: { label: true } } },
  });
  const libelleCompetence = new Map(
    operations.map((operation) => [operation.id, operation.operation?.label ?? operation.label]),
  );

  const employesDeclarants = await prisma.employee.findMany({
    where: { id: { in: declarationsParEmploye.map((ligne) => ligne.employeeId ?? 0) } },
    select: { id: true, matricule: true, firstName: true, lastName: true },
  });
  const employeParId = new Map(employesDeclarants.map((employe) => [employe.id, employe]));

  return {
    effectifActif: effectifTotal,
    effectifParDivision: effectifDivisions.map((ligne) => ({
      division: ligne.factory,
      nombre: ligne._count._all,
    })),
    effectifParAtelier: employesParAtelier
      .map((ligne) => ({
        atelier: ligne.workshopId ? (libelleAtelier.get(ligne.workshopId)?.label ?? "Atelier inconnu") : "Sans atelier",
        division: ligne.factory,
        nombre: ligne._count._all,
      }))
      .sort((a, b) => b.nombre - a.nombre),

    presentsJour: pointagesParStatut.get("PRESENT") ?? 0,
    absentsJour: pointagesParStatut.get("ABSENT") ?? 0,
    retardsJour: pointagesParStatut.get("RETARD") ?? 0,
    congesJour:
      (pointagesParStatut.get("CONGE") ?? 0) +
      (pointagesParStatut.get("MALADIE") ?? 0) +
      (pointagesParStatut.get("FORMATION") ?? 0),
    employesSansPointage: Math.max(0, effectifTotal - employesPointes),
    heuresTravailleesJour: D.roundQuantity(
      D.sum(pointagesJour.map((ligne) => ligne._sum.workedHours)),
    ).toFixed(2),
    heuresSupplementairesJour: D.roundQuantity(
      D.sum(pointagesJour.map((ligne) => ligne._sum.overtimeHours)),
    ).toFixed(2),

    affectationsJour: affectationsJour.reduce((total, ligne) => total + ligne._count._all, 0),
    affectationsEnCours:
      affectationsJour.find((ligne) => ligne.status === "EN_COURS")?._count._all ?? 0,
    affectationsPlanifiees:
      affectationsJour.find((ligne) => ligne.status === "PLANIFIEE")?._count._all ?? 0,
    affectationsTerminees:
      affectationsJour.find((ligne) => ligne.status === "TERMINEE")?._count._all ?? 0,
    employesAffectesJour: employesJour.length,
    employesSansAffectationJour: Math.max(0, effectifTotal - employesJour.length),

    employesAvecCompetence: employesAvecCompetence.length,
    employesPolyvalents: employesAvecCompetence.filter((ligne) => ligne._count._all >= 2).length,
    operationsCouvertes: competencesParOperationBrutes.length,
    competencesParOperation: competencesParOperationBrutes
      .map((ligne) => ({
        operation: libelleCompetence.get(ligne.skillId) ?? "Operation inconnue",
        nombreEmployes: ligne._count._all,
        niveauMoyen: D.round(D.of(ligne._avg.level), 2).toFixed(2),
      }))
      .sort((a, b) => b.nombreEmployes - a.nombreEmployes),

    evaluationsNonValidees:
      evaluationsGroupe.find((ligne) => !ligne.isValidated)?._count._all ?? 0,
    evaluationsValidees: evaluationsGroupe.find((ligne) => ligne.isValidated)?._count._all ?? 0,
    evaluations30Jours: evaluationsPeriode.length,
    noteGlobaleMoyenne: notes.length === 0 ? null : D.round(D.sum(notes).dividedBy(notes.length), 2).toFixed(2),
    repartitionFiabilite: evaluationsFiabilite.map((ligne) => ({
      niveau: ligne.reliability,
      nombre: ligne._count._all,
    })),

    declarationsParEmploye: declarationsParEmploye.map((ligne) => {
      const employe = ligne.employeeId ? employeParId.get(ligne.employeeId) : null;
      return {
        employe: employe ? `${employe.lastName} ${employe.firstName}` : "Employe inconnu",
        matricule: employe?.matricule ?? "-",
        quantite: D.roundQuantity(ligne._sum.quantity).toFixed(3),
        nombreDeclarations: ligne._count._all,
      };
    }),

    employesSansAffectationListe: employesSansAffectationListe.map((employe) => ({
      id: employe.id,
      matricule: employe.matricule,
      nom: `${employe.lastName} ${employe.firstName}`,
      division: employe.factory,
      poste: employe.jobTitle,
    })),

    evaluationsNonValideesListe: evaluationsOuvertesListe
      .filter((evaluation) => !evaluation.isValidated)
      .map((evaluation) => ({
        id: evaluation.id,
        employe: `${evaluation.employee.lastName} ${evaluation.employee.firstName}`,
        periode: evaluation.periodType,
        noteGlobale: evaluation.globalScore ? evaluation.globalScore.toFixed(2) : null,
        fiabilite: evaluation.reliability,
        debut: evaluation.periodStart,
        fin: evaluation.periodEnd,
      })),

    evaluationsInsuffisantesListe: evaluationsOuvertesListe
      .filter((evaluation) => evaluation.reliability === "INSUFFISANTE")
      .map((evaluation) => ({
        id: evaluation.id,
        employe: `${evaluation.employee.lastName} ${evaluation.employee.firstName}`,
        periode: evaluation.periodType,
        noteGlobale: evaluation.globalScore ? evaluation.globalScore.toFixed(2) : null,
        debut: evaluation.periodStart,
        fin: evaluation.periodEnd,
      })),
  };
}
