import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import type { SessionUser } from "@/lib/auth/session";
import { usinesAutorisees } from "@/lib/rbac/guard";

/**
 * Indicateurs du tableau de bord.
 *
 * Tous les chiffres sont calcules a partir des donnees reellement enregistrees
 * en base (factures, mouvements de stock, controles, pointages). Aucun
 * indicateur n'est estime ni simule. Lorsqu'une donnee est insuffisante pour
 * calculer un taux, la fonction renvoie `null` : l'interface affiche alors
 * explicitement « non calculable » plutot qu'une valeur trompeuse.
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

const STATUTS_COMMANDE_CLIENT_OUVERTE: Prisma.SalesOrderWhereInput["status"] = {
  in: ["CONFIRMEE", "PARTIELLEMENT_PRODUITE", "PRODUITE", "PARTIELLEMENT_LIVREE"],
};

export interface BornesMois {
  debut: Date;
  fin: Date;
  debutPrecedent: Date;
}

export function bornesMois(reference: Date = new Date()): BornesMois {
  return {
    debut: new Date(reference.getFullYear(), reference.getMonth(), 1),
    fin: new Date(reference.getFullYear(), reference.getMonth() + 1, 1),
    debutPrecedent: new Date(reference.getFullYear(), reference.getMonth() - 1, 1),
  };
}

export function bornesJour(reference: Date = new Date()): { debut: Date; fin: Date } {
  const debut = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const fin = new Date(debut.getTime() + 24 * 3600 * 1000);
  return { debut, fin };
}

export function ilYA(jours: number, reference: Date = new Date()): Date {
  return new Date(reference.getTime() - jours * 24 * 3600 * 1000);
}

export interface IndicateursSynthese {
  // Activite commerciale
  chiffreAffairesMoisHT: Prisma.Decimal;
  chiffreAffairesMoisPrecedentHT: Prisma.Decimal;
  avoirsMoisHT: Prisma.Decimal;
  coutVentesMois: Prisma.Decimal;
  margeBruteMois: Prisma.Decimal;
  facturesClientDuMois: number;

  // Encours et tresorerie
  creancesClients: Prisma.Decimal;
  facturesClientEnRetard: { nombre: number; montant: Prisma.Decimal };
  dettesFournisseurs: Prisma.Decimal;
  facturesFournisseurEnRetard: { nombre: number; montant: Prisma.Decimal };

  // Commandes
  commandesClientOuvertes: { nombre: number; montant: Prisma.Decimal };
  commandesClientEnRetardLivraison: number;
  commandesFournisseurEnCours: number;

  // Production
  ordresOuverts: number;
  ordresEnRetard: number;
  ordresEnControleQualite: number;
  quantiteProduite30Jours: Prisma.Decimal;
  quantiteRebutee30Jours: Prisma.Decimal;
  tauxRebut30Jours: Prisma.Decimal | null;
  transfertsInterAteliers30Jours: number;

  // Qualite
  tauxConformite30Jours: Prisma.Decimal | null;
  quantiteControlee30Jours: Prisma.Decimal;
  nonConformitesOuvertes: number;
  lotsEnQuarantaine: number;
  quantiteEnQuarantaine: Prisma.Decimal;

  // Stocks
  valeurStock: Prisma.Decimal;
  articlesSousMinimum: number;
  articlesSuivis: number;

  // Achats
  receptionsEnAttenteQualite: number;
  demandesAchatAApprouver: number;
  facturesFournisseurEnEcart: number;

  // Ressources humaines
  effectifActif: number;
  presentsAujourdHui: number;
  absentsAujourdHui: number;
  retardsAujourdHui: number;
  declarationsAValider: number;

  // Alertes detaillees
  articlesSousMinimumListe: {
    id: number;
    code: string;
    libelle: string;
    disponible: Prisma.Decimal;
    minimum: Prisma.Decimal;
    unite: string | null;
  }[];
  ordresEnRetardListe: {
    id: number;
    numero: string;
    article: string;
    division: string;
    echeance: Date;
    quantiteRestante: Prisma.Decimal;
  }[];
  lotsEnQuarantaineListe: {
    id: number;
    numeroLot: string;
    article: string;
    depot: string;
    quantite: Prisma.Decimal;
    depuis: Date | null;
  }[];
  nonConformitesOuvertesListe: {
    id: number;
    numero: string;
    source: string;
    statut: string;
    description: string;
    quantite: Prisma.Decimal;
    article: string | null;
  }[];
  livraisonsAExpedier: {
    id: number;
    numero: string;
    client: string;
    statut: string;
    dateLivraison: Date;
  }[];
}

/**
 * Calcul complet des indicateurs pour l'utilisateur connecte.
 * Toutes les requetes sont bornees a la portee de l'utilisateur (division).
 */
export async function indicateursTableauDeBord(
  utilisateur: SessionUser,
): Promise<IndicateursSynthese> {
  const usines = usinesAutorisees(utilisateur);
  const scopeUsine: Prisma.WorkOrderWhereInput = { factory: { in: usines } };
  const scopeItem: Prisma.ItemWhereInput = { factory: { in: usines } };
  const scopeDepot: Prisma.StockBalanceWhereInput = { warehouse: { factory: { in: usines } } };

  const maintenant = new Date();
  const mois = bornesMois(maintenant);
  const jour = bornesJour(maintenant);
  const depuis30Jours = ilYA(30, maintenant);

  const [
    caMois,
    caMoisPrecedent,
    avoirsMois,
    coutVentesMoisBrut,
    facturesClientMois,
    creancesClients,
    facturesClientRetard,
    dettesFournisseurs,
    facturesFournisseurRetard,
    commandesClientOuvertes,
    commandesClientRetard,
    commandesFournisseurEnCours,
    ordresOuverts,
    ordresEnRetard,
    ordresEnControle,
    production30,
    rebut30,
    transferts30,
    controles30,
    nonConformitesOuvertes,
    lotsQuarantaine,
    soldesQuarantaine,
    valeurStock,
    receptionsAttenteQualite,
    demandesAApprouver,
    facturesEnEcart,
    effectifActif,
    pointagesJour,
    declarationsAValider,
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
    prisma.invoice.count({
      where: {
        direction: "CLIENT",
        nature: "FACTURE",
        status: STATUTS_FACTURE_ACTIVE,
        invoiceDate: { gte: mois.debut, lt: mois.fin },
      },
    }),
    prisma.invoice.aggregate({
      _sum: { balance: true },
      where: { direction: "CLIENT", status: STATUTS_FACTURE_ACTIVE },
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
    prisma.invoice.aggregate({
      _sum: { balance: true },
      where: { direction: "FOURNISSEUR", status: STATUTS_FACTURE_ACTIVE },
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
    prisma.salesOrder.aggregate({
      _count: { _all: true },
      _sum: { totalTTC: true },
      where: { status: STATUTS_COMMANDE_CLIENT_OUVERTE },
    }),
    prisma.salesOrder.count({
      where: {
        status: STATUTS_COMMANDE_CLIENT_OUVERTE,
        expectedDate: { lt: maintenant },
      },
    }),
    prisma.purchaseOrder.count({
      where: { status: { in: ["SOUMIS", "APPROUVE", "PARTIELLEMENT_RECU"] } },
    }),
    prisma.workOrder.count({ where: { ...scopeUsine, status: STATUTS_ORDRE_OUVERT } }),
    prisma.workOrder.count({
      where: {
        ...scopeUsine,
        status: STATUTS_ORDRE_OUVERT,
        dueDate: { lt: maintenant },
      },
    }),
    prisma.workOrder.count({
      where: { ...scopeUsine, status: "EN_CONTROLE_QUALITE" },
    }),
    prisma.stockMovement.aggregate({
      _sum: { quantity: true },
      where: {
        type: { in: ["PRODUCTION_PRODUIT_FINI", "PRODUCTION_SEMI_FINI"] },
        occurredAt: { gte: depuis30Jours },
        warehouse: { factory: { in: usines } },
      },
    }),
    prisma.stockMovement.aggregate({
      _sum: { quantity: true },
      where: {
        type: "REBUT",
        occurredAt: { gte: depuis30Jours },
        warehouse: { factory: { in: usines } },
      },
    }),
    prisma.stockMovement.count({
      where: {
        type: "TRANSFERT_INTER_DEPOTS",
        occurredAt: { gte: depuis30Jours },
        isReversal: false,
        sourceWarehouse: { factory: { in: usines } },
      },
    }),
    prisma.qualityCheck.aggregate({
      _sum: { quantityChecked: true, quantityConform: true },
      where: {
        checkedAt: { gte: depuis30Jours },
        OR: [{ workOrder: { factory: { in: usines } } }, { workOrderId: null }],
      },
    }),
    prisma.nonConformity.count({
      where: { status: { in: ["OUVERTE", "EN_ANALYSE", "EN_REPRISE"] } },
    }),
    prisma.stockLot.count({
      where: { status: "QUARANTAINE", warehouse: { factory: { in: usines } } },
    }),
    prisma.stockBalance.aggregate({
      _sum: { quantityQuarantine: true },
      where: { ...scopeDepot, status: "QUARANTAINE" },
    }),
    prisma.stockBalance.aggregate({
      _sum: { totalValue: true },
      where: scopeDepot,
    }),
    prisma.goodsReceipt.count({ where: { status: "EN_CONTROLE_QUALITE" } }),
    prisma.purchaseRequest.count({ where: { status: "SOUMISE" } }),
    prisma.supplierInvoice.count({
      where: { threeWayMatched: false, status: { in: ["BROUILLON", "VALIDEE"] } },
    }),
    prisma.employee.count({ where: { isActive: true, factory: { in: usines } } }),
    prisma.attendance.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { date: { gte: jour.debut, lt: jour.fin } },
    }),
    prisma.operationDeclaration.count({ where: { status: "SOUMISE" } }),
  ]);

  const chiffreAffairesMoisHT = D.of(caMois._sum.lineHT);
  const chiffreAffairesMoisPrecedentHT = D.of(caMoisPrecedent._sum.lineHT);
  const coutVentesMois = D.abs(coutVentesMoisBrut._sum.totalCost);

  const quantiteProduite = D.of(production30._sum.quantity);
  const quantiteRebutee = D.abs(rebut30._sum.quantity);
  const totalProduitEtRebute = D.add(quantiteProduite, quantiteRebutee);

  const quantiteControlee = D.of(controles30._sum.quantityChecked);
  const quantiteConforme = D.of(controles30._sum.quantityConform);

  const pointagesParStatut = new Map(
    pointagesJour.map((ligne) => [ligne.status, ligne._count._all]),
  );

  const { articlesSousMinimum, articlesSuivis, articlesSousMinimumListe } =
    await calculerArticlesSousMinimum(usines);

  const [
    ordresEnRetardListe,
    lotsEnQuarantaineListe,
    nonConformitesListe,
    livraisonsListe,
  ] = await Promise.all([
    prisma.workOrder.findMany({
      where: {
        ...scopeUsine,
        status: STATUTS_ORDRE_OUVERT,
        dueDate: { lt: maintenant },
      },
      select: {
        id: true,
        number: true,
        factory: true,
        dueDate: true,
        quantityRemaining: true,
        item: { select: { code: true, label1: true } },
      },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    prisma.stockLot.findMany({
      where: { status: "QUARANTAINE", warehouse: { factory: { in: usines } } },
      select: {
        id: true,
        lotNumber: true,
        receivedAt: true,
        createdAt: true,
        item: { select: { code: true, label1: true } },
        warehouse: { select: { code: true } },
        balances: { select: { quantityPhysical: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.nonConformity.findMany({
      where: { status: { in: ["OUVERTE", "EN_ANALYSE", "EN_REPRISE"] } },
      select: {
        id: true,
        number: true,
        source: true,
        status: true,
        description: true,
        quantity: true,
        item: { select: { code: true } },
      },
      orderBy: { detectedAt: "desc" },
      take: 10,
    }),
    prisma.deliveryNote.findMany({
      where: { status: { in: ["BROUILLON", "PREPAREE"] } },
      select: {
        id: true,
        number: true,
        status: true,
        deliveryDate: true,
        customer: { select: { label1: true } },
      },
      orderBy: { deliveryDate: "asc" },
      take: 10,
    }),
  ]);

  return {
    chiffreAffairesMoisHT: D.roundAmount(chiffreAffairesMoisHT),
    chiffreAffairesMoisPrecedentHT: D.roundAmount(chiffreAffairesMoisPrecedentHT),
    avoirsMoisHT: D.roundAmount(avoirsMois._sum.lineHT),
    coutVentesMois: D.roundAmount(coutVentesMois),
    margeBruteMois: D.roundAmount(D.sub(chiffreAffairesMoisHT, coutVentesMois)),
    facturesClientDuMois: facturesClientMois,

    creancesClients: D.roundAmount(creancesClients._sum.balance),
    facturesClientEnRetard: {
      nombre: facturesClientRetard.length,
      montant: D.roundAmount(D.sum(facturesClientRetard.map((f) => f.balance))),
    },
    dettesFournisseurs: D.roundAmount(dettesFournisseurs._sum.balance),
    facturesFournisseurEnRetard: {
      nombre: facturesFournisseurRetard.length,
      montant: D.roundAmount(D.sum(facturesFournisseurRetard.map((f) => f.balance))),
    },

    commandesClientOuvertes: {
      nombre: commandesClientOuvertes._count._all,
      montant: D.roundAmount(commandesClientOuvertes._sum.totalTTC),
    },
    commandesClientEnRetardLivraison: commandesClientRetard,
    commandesFournisseurEnCours,

    ordresOuverts,
    ordresEnRetard,
    ordresEnControleQualite: ordresEnControle,
    quantiteProduite30Jours: D.roundQuantity(quantiteProduite),
    quantiteRebutee30Jours: D.roundQuantity(quantiteRebutee),
    tauxRebut30Jours: totalProduitEtRebute.isZero()
      ? null
      : D.roundRate(D.percent(quantiteRebutee, totalProduitEtRebute)),
    transfertsInterAteliers30Jours: transferts30,

    tauxConformite30Jours: quantiteControlee.isZero()
      ? null
      : D.roundRate(D.percent(quantiteConforme, quantiteControlee)),
    quantiteControlee30Jours: D.roundQuantity(quantiteControlee),
    nonConformitesOuvertes,
    lotsEnQuarantaine: lotsQuarantaine,
    quantiteEnQuarantaine: D.roundQuantity(soldesQuarantaine._sum.quantityQuarantine),

    valeurStock: D.roundAmount(valeurStock._sum.totalValue),
    articlesSousMinimum,
    articlesSuivis,

    receptionsEnAttenteQualite: receptionsAttenteQualite,
    demandesAchatAApprouver: demandesAApprouver,
    facturesFournisseurEnEcart: facturesEnEcart,

    effectifActif,
    presentsAujourdHui: pointagesParStatut.get("PRESENT") ?? 0,
    absentsAujourdHui: pointagesParStatut.get("ABSENT") ?? 0,
    retardsAujourdHui: pointagesParStatut.get("RETARD") ?? 0,
    declarationsAValider,

    articlesSousMinimumListe,
    ordresEnRetardListe: ordresEnRetardListe.map((ordre) => ({
      id: ordre.id,
      numero: ordre.number,
      article: `${ordre.item.code} — ${ordre.item.label1}`,
      division: ordre.factory,
      echeance: ordre.dueDate as Date,
      quantiteRestante: ordre.quantityRemaining,
    })),
    lotsEnQuarantaineListe: lotsEnQuarantaineListe.map((lot) => ({
      id: lot.id,
      numeroLot: lot.lotNumber,
      article: `${lot.item.code} — ${lot.item.label1}`,
      depot: lot.warehouse.code,
      quantite: D.roundQuantity(
        D.sum(lot.balances.map((solde) => solde.quantityPhysical)),
      ),
      depuis: lot.receivedAt ?? lot.createdAt,
    })),
    nonConformitesOuvertesListe: nonConformitesListe.map((nc) => ({
      id: nc.id,
      numero: nc.number,
      source: nc.source,
      statut: nc.status,
      description: nc.description,
      quantite: nc.quantity,
      article: nc.item?.code ?? null,
    })),
    livraisonsAExpedier: livraisonsListe.map((bl) => ({
      id: bl.id,
      numero: bl.number,
      client: bl.customer.label1,
      statut: bl.status,
      dateLivraison: bl.deliveryDate,
    })),
  };
}

/**
 * Articles dont la quantite physique disponible est inferieure au minimum
 * configure sur la fiche article. Le calcul s'appuie sur le solde reel, jamais
 * sur une valeur saisie a la main.
 */
async function calculerArticlesSousMinimum(
  usines: ReturnType<typeof usinesAutorisees>,
): Promise<{
  articlesSousMinimum: number;
  articlesSuivis: number;
  articlesSousMinimumListe: IndicateursSynthese["articlesSousMinimumListe"];
}> {
  const articles = await prisma.item.findMany({
    where: {
      factory: { in: usines },
      status: { in: ["ACTIF", "NON_COMMERCIALISABLE", "NON_PRODUCTIBLE"] },
      quantityMin: { gt: 0 },
    },
    select: {
      id: true,
      code: true,
      label1: true,
      quantityMin: true,
      unitCode: true,
    },
    orderBy: { code: "asc" },
    take: 3000,
  });

  if (articles.length === 0) {
    return { articlesSousMinimum: 0, articlesSuivis: 0, articlesSousMinimumListe: [] };
  }

  const soldes = await prisma.stockBalance.groupBy({
    by: ["itemId"],
    where: {
      itemId: { in: articles.map((article) => article.id) },
      warehouse: { factory: { in: usines } },
    },
    _sum: { quantityPhysical: true, quantityReserved: true },
  });

  const disponibleParArticle = new Map<number, Prisma.Decimal>();
  for (const solde of soldes) {
    disponibleParArticle.set(
      solde.itemId,
      D.sub(D.of(solde._sum.quantityPhysical), D.of(solde._sum.quantityReserved)),
    );
  }

  const sousMinimum = articles
    .map((article) => ({
      id: article.id,
      code: article.code,
      libelle: article.label1,
      disponible: D.roundQuantity(disponibleParArticle.get(article.id) ?? D.ZERO),
      minimum: article.quantityMin,
      unite: article.unitCode,
    }))
    .filter((article) => D.lt(article.disponible, article.minimum));

  return {
    articlesSousMinimum: sousMinimum.length,
    articlesSuivis: articles.length,
    articlesSousMinimumListe: sousMinimum.slice(0, 15),
  };
}
