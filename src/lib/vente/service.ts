import type {
  Prisma,
  QuoteStatus,
  SalesOrderStatus,
  DeliveryStatus,
} from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D, type Decimal } from "@/lib/decimal";
import { conflit, etatInvalide, nonTrouve, validation } from "@/lib/errors";
import { prochainNumero, SEQUENCES } from "@/lib/numbering";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import { CLE_PARAMETRE, lireParametreBooleen } from "@/lib/settings";
import {
  disponibleArticle,
  enregistrerMouvement,
  quantiteDisponible,
  type ActeurStock,
} from "@/lib/stock/service";
import { calculerLigne, resoudreTauxTva } from "@/lib/commercial/taxe";
import {
  genererEcriture,
  genererEcritureSiRegle,
  posterEcriture,
  validerEcriture,
} from "@/lib/comptabilite/service";
import {
  creerAvoir,
  enregistrerReglement,
  majSoldeTiers,
} from "@/lib/comptabilite/reglement";
import { creerOrdreFabrication } from "@/lib/production/service";

/**
 * Cycle de vente complet :
 *   Client -> Devis -> Commande client -> Ordre de fabrication -> Production ->
 *   Bon de livraison -> Facture client -> Reglement client.
 *
 * Points de rigueur :
 *  - la marchandise sort du stock par un mouvement reel, jamais par une simple
 *    modification de quantite, et lot par lot (tracabilite FIFO) ;
 *  - un produit fini non libere par la qualite ne peut pas etre livre des lors
 *    que la liberation est obligatoire ;
 *  - une commande confirmee peut engendrer automatiquement un ordre de
 *    fabrication par ligne, selon la configuration de l'article ;
 *  - les ecritures comptables proviennent de regles configurees, jamais de
 *    numeros de comptes codes en dur.
 */

export interface ActeurVente extends ActeurStock {}

// -----------------------------------------------------------------------------
// Utilitaires internes
// -----------------------------------------------------------------------------

async function verifierArticle(entree: {
  tx: Db;
  itemId: number;
  ligne: number;
  exigerSellable?: boolean;
}) {
  const article = await entree.tx.item.findUnique({
    where: { id: entree.itemId },
    select: {
      id: true,
      code: true,
      label1: true,
      unitCode: true,
      status: true,
      isSellable: true,
      isProducible: true,
      factory: true,
      taxRateCode: true,
    },
  });
  if (!article) throw nonTrouve(`L'article de la ligne ${entree.ligne}`);
  if (article.status !== "ACTIF") {
    throw etatInvalide(
      `L'article « ${article.code} » est au statut ${article.status} : il ne peut pas figurer sur ce document.`,
    );
  }
  if (entree.exigerSellable && !article.isSellable) {
    throw etatInvalide(
      `L'article « ${article.code} » n'est pas marque comme vendable. Activez cette propriete sur sa fiche si la vente est legitime.`,
    );
  }
  return article;
}

/**
 * Sortie de stock FIFO, lot par lot.
 *
 * Chaque lot consomme donne lieu a un mouvement distinct : la tracabilite
 * remonte donc jusqu'au lot reellement livre, et aucun stock n'est decremente
 * globalement « en aveugle ».
 */
async function sortirStockFifo(
  tx: Db,
  entree: {
    itemId: number;
    warehouseId: number;
    quantity: Decimal;
    documentType: string;
    documentId: string;
    documentNumber: string;
    thirdPartyId: number | null;
    occurredAt: Date;
    comment: string;
    acteur: ActeurVente;
  },
): Promise<{
  mouvements: bigint[];
  coutTotal: Decimal;
  allocations: { lotId: number | null; lotNumber: string | null; quantity: Decimal }[];
}> {
  const soldes = await tx.stockBalance.findMany({
    where: {
      itemId: entree.itemId,
      warehouseId: entree.warehouseId,
      status: "LIBRE",
      quantityPhysical: { gt: 0 },
    },
    include: {
      lot: { select: { id: true, lotNumber: true, receivedAt: true, expirationDate: true } },
    },
  });

  // Ordre FIFO : lot le plus ancien d'abord, puis les lignes sans lot.
  const ordonnes = [...soldes].sort((a, b) => {
    const dateA = a.lot?.receivedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const dateB = b.lot?.receivedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (dateA !== dateB) return dateA - dateB;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });

  const totalDisponible = ordonnes.reduce(
    (total, solde) => D.add(total, quantiteDisponible(solde)),
    D.ZERO,
  );
  if (D.lt(totalDisponible, entree.quantity)) {
    throw etatInvalide(
      `Stock disponible insuffisant pour l'article ${entree.itemId} dans ce depot : disponible ${D.toFixed(totalDisponible, 3)}, demande ${D.toFixed(entree.quantity, 3)}.`,
    );
  }

  let reste = D.roundQuantity(entree.quantity);
  const mouvements: bigint[] = [];
  const allocations: { lotId: number | null; lotNumber: string | null; quantity: Decimal }[] = [];
  let coutTotal = D.ZERO;

  for (const solde of ordonnes) {
    if (D.lte(reste, 0)) break;

    const disponible = quantiteDisponible(solde);
    if (D.lte(disponible, 0)) continue;

    const prelevement = D.min(reste, disponible);
    const mouvement = await enregistrerMouvement(tx, {
      type: "LIVRAISON_CLIENT",
      itemId: entree.itemId,
      warehouseId: entree.warehouseId,
      locationId: solde.locationId,
      lotId: solde.lotId,
      status: "LIBRE",
      quantity: D.neg(prelevement),
      documentType: entree.documentType,
      documentId: entree.documentId,
      documentNumber: entree.documentNumber,
      thirdPartyId: entree.thirdPartyId,
      occurredAt: entree.occurredAt,
      comment: entree.comment,
      reason: "Livraison client",
      acteur: entree.acteur,
    });

    mouvements.push(mouvement.mouvementId);
    allocations.push({
      lotId: solde.lotId,
      lotNumber: solde.lot?.lotNumber ?? null,
      quantity: prelevement,
    });
    coutTotal = D.add(coutTotal, D.mul(prelevement, D.of(solde.unitCost)));
    reste = D.roundQuantity(D.sub(reste, prelevement));
  }

  if (D.gt(reste, 0)) {
    throw etatInvalide(
      `La sortie de stock n'a pas pu etre servie integralement : ${D.toFixed(reste, 3)} manquant(s).`,
    );
  }

  return { mouvements, coutTotal: D.roundAmount(coutTotal), allocations };
}

/** Recalcule le statut d'une commande client d'apres les quantites reelles. */
export async function recalculerStatutCommandeClient(tx: Db, orderId: number): Promise<void> {
  const commande = await tx.salesOrder.findUnique({
    where: { id: orderId },
    include: {
      lines: {
        select: {
          quantity: true,
          quantityProduced: true,
          quantityDelivered: true,
          quantityInvoiced: true,
        },
      },
    },
  });
  if (!commande) return;
  if (commande.status === "ANNULEE" || commande.status === "CLOTUREE") return;

  const total = commande.lines.reduce((acc, ligne) => D.add(acc, ligne.quantity), D.ZERO);
  if (D.lte(total, 0)) return;

  const produit = commande.lines.reduce((acc, ligne) => D.add(acc, ligne.quantityProduced), D.ZERO);
  const livre = commande.lines.reduce((acc, ligne) => D.add(acc, ligne.quantityDelivered), D.ZERO);
  const facture = commande.lines.reduce((acc, ligne) => D.add(acc, ligne.quantityInvoiced), D.ZERO);

  let statut: SalesOrderStatus = commande.status;
  if (D.gte(facture, total)) statut = "FACTUREE";
  else if (D.gte(livre, total)) statut = "LIVREE";
  else if (D.gt(livre, 0)) statut = "PARTIELLEMENT_LIVREE";
  else if (D.gte(produit, total)) statut = "PRODUITE";
  else if (D.gt(produit, 0)) statut = "PARTIELLEMENT_PRODUITE";

  if (statut !== commande.status) {
    await tx.salesOrder.update({ where: { id: orderId }, data: { status: statut } });
  }
}

// -----------------------------------------------------------------------------
// 1. Devis
// -----------------------------------------------------------------------------

export interface LigneDevisInput {
  itemId: number;
  description?: string | null;
  quantity: Prisma.Decimal | string | number;
  unitCode?: string | null;
  unitPrice: Prisma.Decimal | string | number;
  discountRate?: Prisma.Decimal | string | number;
  vatRateCode?: string | null;
}

export interface DevisInput {
  customerId: number;
  lines: LigneDevisInput[];
  quoteDate?: Date;
  validUntil?: Date | null;
  discountRate?: Prisma.Decimal | string | number;
  paymentTermsDays?: number;
  currency?: string;
  notes?: string | null;
}

export async function creerDevis(
  entree: DevisInput,
  acteur: ActeurVente,
): Promise<{ quoteId: number; numero: string; totalTTC: Decimal }> {
  if (entree.lines.length === 0) {
    throw validation("Un devis doit comporter au moins une ligne.");
  }

  return prisma.$transaction(
    async (tx) => {
      const client = await tx.thirdParty.findUnique({
        where: { id: entree.customerId },
        select: { id: true, code: true, label1: true, isClient: true, deadlineDays: true },
      });
      if (!client) throw nonTrouve("Le client");
      if (!client.isClient) {
        throw validation(`Le tiers « ${client.label1} » n'est pas enregistre comme client.`);
      }

      const tauxRemiseGlobal = D.round(D.of(entree.discountRate ?? 0), 4);
      if (D.gte(tauxRemiseGlobal, D.CENT)) {
        throw validation("Le taux de remise global doit etre inferieur a 100 %.");
      }

      const numero = await prochainNumero(SEQUENCES.DEVIS, tx);
      const dateDevis = entree.quoteDate ?? new Date();

      if (entree.validUntil && entree.validUntil.getTime() < dateDevis.getTime()) {
        throw validation("La date de validite du devis ne peut pas preceder sa date d'emission.");
      }

      const devis = await tx.quote.create({
        data: {
          number: numero,
          status: "BROUILLON",
          customerId: entree.customerId,
          quoteDate: dateDevis,
          validUntil: entree.validUntil ?? null,
          currency: entree.currency ?? "DZD",
          discountRate: tauxRemiseGlobal,
          paymentTermsDays: entree.paymentTermsDays ?? client.deadlineDays ?? 0,
          notes: entree.notes ?? null,
          createdById: acteur.id,
        },
      });

      let index = 1;
      let brut = D.ZERO;
      let remises = D.ZERO;
      let tva = D.ZERO;

      for (const ligne of entree.lines) {
        const quantite = D.roundQuantity(ligne.quantity);
        if (D.lte(quantite, 0)) {
          throw validation(`Ligne ${index} : la quantite doit etre strictement positive.`);
        }
        const prixUnitaire = D.roundAmount(ligne.unitPrice);
        if (D.lt(prixUnitaire, 0)) {
          throw validation(`Ligne ${index} : le prix unitaire ne peut pas etre negatif.`);
        }

        const article = await verifierArticle({
          tx,
          itemId: ligne.itemId,
          ligne: index,
          exigerSellable: true,
        });

        const tauxTva = await resoudreTauxTva(tx, {
          vatRateCode: ligne.vatRateCode ?? article.taxRateCode,
          itemId: ligne.itemId,
        });
        const calcul = calculerLigne(
          quantite,
          prixUnitaire,
          D.round(D.of(ligne.discountRate ?? 0), 4),
          tauxTva.taux,
        );

        await tx.quoteLine.create({
          data: {
            quoteId: devis.id,
            lineNo: index,
            itemId: ligne.itemId,
            description: ligne.description ?? null,
            quantity: quantite,
            unitCode: ligne.unitCode ?? article.unitCode ?? null,
            unitPrice: prixUnitaire,
            discountRate: D.round(D.of(ligne.discountRate ?? 0), 4),
            vatRateCode: tauxTva.code,
            vatRate: D.round(tauxTva.taux, 4),
            lineHT: calcul.ht,
            lineVAT: calcul.tva,
            lineTTC: calcul.ttc,
          },
        });

        brut = D.add(brut, calcul.brut);
        remises = D.add(remises, calcul.remise);
        tva = D.add(tva, calcul.tva);
        index += 1;
      }

      const brutArrondi = D.roundAmount(brut);
      const remiseGlobale = D.roundAmount(
        D.mul(D.sub(brutArrondi, remises), D.div(tauxRemiseGlobal, D.CENT)),
      );
      const totalHT = D.roundAmount(D.sub(D.sub(brutArrondi, remises), remiseGlobale));
      const totalTVA = D.roundAmount(D.sub(tva, D.mul(tva, D.div(tauxRemiseGlobal, D.CENT))));
      const totalTTC = D.roundAmount(D.add(totalHT, totalTVA));

      await tx.quote.update({
        where: { id: devis.id },
        data: {
          subtotalHT: totalHT,
          discountAmount: D.roundAmount(D.add(remises, remiseGlobale)),
          vatAmount: totalTVA,
          totalTTC,
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.VENTE,
          entity: "Quote",
          entityId: devis.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: {
            numero,
            client: client.label1,
            lignes: entree.lines.length,
            totalHT: D.toFixed(totalHT, 2),
            totalTTC: D.toFixed(totalTTC, 2),
          },
        },
        tx,
      );

      return { quoteId: devis.id, numero, totalTTC };
    },
    { timeout: 60_000 },
  );
}

const TRANSITIONS_DEVIS: Record<QuoteStatus, QuoteStatus[]> = {
  BROUILLON: ["ENVOYE", "ANNULE"],
  ENVOYE: ["ACCEPTE", "REFUSE", "EXPIRE", "ANNULE"],
  ACCEPTE: ["CONVERTI", "ANNULE"],
  REFUSE: [],
  EXPIRE: ["ANNULE"],
  CONVERTI: [],
  ANNULE: [],
};

export async function changerStatutDevis(
  entree: { quoteId: number; statut: QuoteStatus; motif?: string | null },
  acteur: ActeurVente,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const devis = await tx.quote.findUnique({
        where: { id: entree.quoteId },
        include: { customer: { select: { label1: true } } },
      });
      if (!devis) throw nonTrouve("Le devis");

      const autorisees = TRANSITIONS_DEVIS[devis.status];
      if (!autorisees.includes(entree.statut)) {
        throw conflit(
          `Un devis au statut ${devis.status} ne peut pas passer au statut ${entree.statut}.`,
        );
      }
      if ((entree.statut === "REFUSE" || entree.statut === "ANNULE") && !entree.motif?.trim()) {
        throw validation("Un motif est obligatoire pour refuser ou annuler un devis.");
      }
      if (entree.statut === "EXPIRE" && devis.validUntil && devis.validUntil.getTime() > Date.now()) {
        throw etatInvalide(
          `Ce devis est valable jusqu'au ${devis.validUntil.toLocaleDateString("fr-FR")} : il ne peut pas encore etre marque comme expire.`,
        );
      }

      await tx.quote.update({
        where: { id: devis.id },
        data: {
          status: entree.statut,
          notes: entree.motif ? `${devis.notes ?? ""}\n${entree.statut} : ${entree.motif}`.trim() : devis.notes,
        },
      });

      await enregistrerAudit(
        {
          action: entree.statut === "ANNULE" || entree.statut === "REFUSE"
            ? ACTIONS_AUDIT.ANNULATION
            : ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.VENTE,
          entity: "Quote",
          entityId: devis.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: devis.status },
          newValue: { statut: entree.statut, client: devis.customer.label1 },
          comment: entree.motif ?? null,
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

/**
 * Transforme un devis accepte en commande client.
 * Les lignes du devis sont recopiees telles quelles : le devis reste la
 * reference contractuelle et n'est jamais modifie apres conversion.
 */
export async function transformerDevisEnCommande(
  entree: {
    quoteId: number;
    orderDate?: Date;
    expectedDate?: Date | null;
    deliveryAddress?: string | null;
    customerRef?: string | null;
    notes?: string | null;
  },
  acteur: ActeurVente,
): Promise<{ orderId: number; numero: string; totalTTC: Decimal }> {
  return prisma.$transaction(
    async (tx) => {
      const devis = await tx.quote.findUnique({
        where: { id: entree.quoteId },
        include: { lines: { orderBy: { lineNo: "asc" } }, customer: { select: { label1: true } } },
      });
      if (!devis) throw nonTrouve("Le devis");
      if (devis.status !== "ACCEPTE") {
        throw etatInvalide(
          `Seul un devis accepte peut etre converti en commande (statut actuel : ${devis.status}).`,
        );
      }
      if (devis.lines.length === 0) {
        throw etatInvalide("Ce devis ne comporte aucune ligne.");
      }

      const numero = await prochainNumero(SEQUENCES.COMMANDE_CLIENT, tx);
      const dateCommande = entree.orderDate ?? new Date();

      const commande = await tx.salesOrder.create({
        data: {
          number: numero,
          status: "BROUILLON",
          customerId: devis.customerId,
          orderDate: dateCommande,
          expectedDate: entree.expectedDate ?? null,
          quoteId: devis.id,
          currency: devis.currency,
          discountRate: devis.discountRate,
          subtotalHT: devis.subtotalHT,
          discountAmount: devis.discountAmount,
          vatAmount: devis.vatAmount,
          totalTTC: devis.totalTTC,
          paymentTermsDays: devis.paymentTermsDays,
          deliveryAddress: entree.deliveryAddress ?? null,
          customerRef: entree.customerRef ?? null,
          notes: entree.notes ?? devis.notes,
          createdById: acteur.id,
        },
      });

      const autoProduction = await lireParametreBooleen(CLE_PARAMETRE.CATALOGUE_AUTO_PRODUCTION, false);

      for (const ligne of devis.lines) {
        const article = await tx.item.findUnique({
          where: { id: ligne.itemId },
          select: { isProducible: true },
        });

        await tx.salesOrderLine.create({
          data: {
            orderId: commande.id,
            lineNo: ligne.lineNo,
            itemId: ligne.itemId,
            description: ligne.description,
            quantity: ligne.quantity,
            unitCode: ligne.unitCode,
            unitPrice: ligne.unitPrice,
            discountRate: ligne.discountRate,
            vatRateCode: ligne.vatRateCode,
            vatRate: ligne.vatRate,
            lineHT: ligne.lineHT,
            lineVAT: ligne.lineVAT,
            lineTTC: ligne.lineTTC,
            autoCreateWorkOrder: autoProduction && (article?.isProducible ?? false),
          },
        });
      }

      await tx.quote.update({
        where: { id: devis.id },
        data: { status: "CONVERTI", convertedOrderId: commande.id },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.VENTE,
          entity: "SalesOrder",
          entityId: commande.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: {
            numero,
            client: devis.customer.label1,
            devisOrigine: devis.number,
            lignes: devis.lines.length,
            totalTTC: D.toFixed(D.of(devis.totalTTC), 2),
          },
        },
        tx,
      );

      return { orderId: commande.id, numero, totalTTC: D.of(devis.totalTTC) };
    },
    { timeout: 60_000 },
  );
}

// -----------------------------------------------------------------------------
// 2. Commande client
// -----------------------------------------------------------------------------

export interface LigneCommandeClientInput {
  itemId: number;
  description?: string | null;
  quantity: Prisma.Decimal | string | number;
  unitCode?: string | null;
  unitPrice: Prisma.Decimal | string | number;
  discountRate?: Prisma.Decimal | string | number;
  vatRateCode?: string | null;
  deliveryDate?: Date | null;
  autoCreateWorkOrder?: boolean;
}

export interface CommandeClientInput {
  customerId: number;
  lines: LigneCommandeClientInput[];
  orderDate?: Date;
  expectedDate?: Date | null;
  quoteId?: number | null;
  discountRate?: Prisma.Decimal | string | number;
  paymentTermsDays?: number;
  deliveryAddress?: string | null;
  customerRef?: string | null;
  currency?: string;
  notes?: string | null;
}

export async function creerCommandeClient(
  entree: CommandeClientInput,
  acteur: ActeurVente,
): Promise<{ orderId: number; numero: string; totalTTC: Decimal }> {
  if (entree.lines.length === 0) {
    throw validation("Une commande client doit comporter au moins une ligne.");
  }

  return prisma.$transaction(
    async (tx) => {
      const client = await tx.thirdParty.findUnique({
        where: { id: entree.customerId },
        select: { id: true, code: true, label1: true, isClient: true, deadlineDays: true },
      });
      if (!client) throw nonTrouve("Le client");
      if (!client.isClient) {
        throw validation(`Le tiers « ${client.label1} » n'est pas enregistre comme client.`);
      }

      const tauxRemiseGlobal = D.round(D.of(entree.discountRate ?? 0), 4);
      if (D.gte(tauxRemiseGlobal, D.CENT)) {
        throw validation("Le taux de remise global doit etre inferieur a 100 %.");
      }

      const numero = await prochainNumero(SEQUENCES.COMMANDE_CLIENT, tx);
      const dateCommande = entree.orderDate ?? new Date();
      const autoProduction = await lireParametreBooleen(CLE_PARAMETRE.CATALOGUE_AUTO_PRODUCTION, false);

      const commande = await tx.salesOrder.create({
        data: {
          number: numero,
          status: "BROUILLON",
          customerId: entree.customerId,
          orderDate: dateCommande,
          expectedDate: entree.expectedDate ?? null,
          quoteId: entree.quoteId ?? null,
          currency: entree.currency ?? "DZD",
          discountRate: tauxRemiseGlobal,
          paymentTermsDays: entree.paymentTermsDays ?? client.deadlineDays ?? 0,
          deliveryAddress: entree.deliveryAddress ?? null,
          customerRef: entree.customerRef ?? null,
          notes: entree.notes ?? null,
          createdById: acteur.id,
        },
      });

      let index = 1;
      let brut = D.ZERO;
      let remises = D.ZERO;
      let tva = D.ZERO;

      for (const ligne of entree.lines) {
        const quantite = D.roundQuantity(ligne.quantity);
        if (D.lte(quantite, 0)) {
          throw validation(`Ligne ${index} : la quantite doit etre strictement positive.`);
        }
        const prixUnitaire = D.roundAmount(ligne.unitPrice);
        if (D.lt(prixUnitaire, 0)) {
          throw validation(`Ligne ${index} : le prix unitaire ne peut pas etre negatif.`);
        }

        const article = await verifierArticle({
          tx,
          itemId: ligne.itemId,
          ligne: index,
          exigerSellable: true,
        });

        const tauxTva = await resoudreTauxTva(tx, {
          vatRateCode: ligne.vatRateCode ?? article.taxRateCode,
          itemId: ligne.itemId,
        });
        const calcul = calculerLigne(
          quantite,
          prixUnitaire,
          D.round(D.of(ligne.discountRate ?? 0), 4),
          tauxTva.taux,
        );

        await tx.salesOrderLine.create({
          data: {
            orderId: commande.id,
            lineNo: index,
            itemId: ligne.itemId,
            description: ligne.description ?? null,
            quantity: quantite,
            unitCode: ligne.unitCode ?? article.unitCode ?? null,
            unitPrice: prixUnitaire,
            discountRate: D.round(D.of(ligne.discountRate ?? 0), 4),
            vatRateCode: tauxTva.code,
            vatRate: D.round(tauxTva.taux, 4),
            lineHT: calcul.ht,
            lineVAT: calcul.tva,
            lineTTC: calcul.ttc,
            deliveryDate: ligne.deliveryDate ?? entree.expectedDate ?? null,
            autoCreateWorkOrder:
              ligne.autoCreateWorkOrder ?? (autoProduction && article.isProducible),
          },
        });

        brut = D.add(brut, calcul.brut);
        remises = D.add(remises, calcul.remise);
        tva = D.add(tva, calcul.tva);
        index += 1;
      }

      const brutArrondi = D.roundAmount(brut);
      const remiseGlobale = D.roundAmount(
        D.mul(D.sub(brutArrondi, remises), D.div(tauxRemiseGlobal, D.CENT)),
      );
      const totalHT = D.roundAmount(D.sub(D.sub(brutArrondi, remises), remiseGlobale));
      const totalTVA = D.roundAmount(D.sub(tva, D.mul(tva, D.div(tauxRemiseGlobal, D.CENT))));
      const totalTTC = D.roundAmount(D.add(totalHT, totalTVA));

      await tx.salesOrder.update({
        where: { id: commande.id },
        data: {
          subtotalHT: totalHT,
          discountAmount: D.roundAmount(D.add(remises, remiseGlobale)),
          vatAmount: totalTVA,
          totalTTC,
        },
      });

      if (entree.quoteId) {
        const devis = await tx.quote.findUnique({
          where: { id: entree.quoteId },
          select: { status: true, number: true },
        });
        if (devis && devis.status === "ACCEPTE") {
          await tx.quote.update({
            where: { id: entree.quoteId },
            data: { status: "CONVERTI", convertedOrderId: commande.id },
          });
        }
      }

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.VENTE,
          entity: "SalesOrder",
          entityId: commande.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: {
            numero,
            client: client.label1,
            lignes: entree.lines.length,
            totalHT: D.toFixed(totalHT, 2),
            totalTTC: D.toFixed(totalTTC, 2),
          },
        },
        tx,
      );

      return { orderId: commande.id, numero, totalTTC };
    },
    { timeout: 60_000 },
  );
}

export interface ResultatConfirmation {
  orderId: number;
  numero: string;
  ordresCrees: { salesOrderLineId: number; itemId: number; workOrderId: number; numero: string }[];
  lignesEnEchec: { salesOrderLineId: number; itemId: number; motif: string }[];
}

/**
 * Confirme une commande client puis genere, pour chaque ligne configuree, un
 * ordre de fabrication.
 *
 * La confirmation est l'acte metier principal : elle est enregistree meme si la
 * generation d'un ordre echoue. Les echecs sont retournes ligne par ligne afin
 * qu'ils soient traites explicitement, jamais masques.
 */
export async function confirmerCommandeClient(
  entree: {
    orderId: number;
    sourceWarehouseId?: number | null;
    targetWarehouseId?: number | null;
    responsableId?: number | null;
    motifException?: string | null;
  },
  acteur: ActeurVente,
): Promise<ResultatConfirmation> {
  const commande = await prisma.salesOrder.findUnique({
    where: { id: entree.orderId },
    include: {
      lines: { orderBy: { lineNo: "asc" } },
      customer: { select: { label1: true } },
      workOrders: { select: { id: true, salesOrderLineId: true } },
    },
  });
  if (!commande) throw nonTrouve("La commande client");
  if (commande.status === "ANNULEE") {
    throw etatInvalide("Cette commande est annulee : elle ne peut plus etre confirmee.");
  }
  if (commande.status !== "BROUILLON") {
    throw conflit(`Cette commande est deja au statut ${commande.status}.`);
  }
  if (commande.lines.length === 0) {
    throw etatInvalide("Une commande sans ligne ne peut pas etre confirmee.");
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.salesOrder.update({
        where: { id: commande.id },
        data: { status: "CONFIRMEE", confirmedAt: new Date() },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.VALIDATION,
          module: MODULES_AUDIT.VENTE,
          entity: "SalesOrder",
          entityId: commande.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: "BROUILLON" },
          newValue: {
            statut: "CONFIRMEE",
            numero: commande.number,
            client: commande.customer.label1,
            totalTTC: D.of(commande.totalTTC).toFixed(2),
          },
          comment: entree.motifException ?? null,
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );

  const ordresCrees: ResultatConfirmation["ordresCrees"] = [];
  const lignesEnEchec: ResultatConfirmation["lignesEnEchec"] = [];

  for (const ligne of commande.lines) {
    if (!ligne.autoCreateWorkOrder) continue;
    if (commande.workOrders.some((ordre) => ordre.salesOrderLineId === ligne.id)) continue;

    try {
      const article = await prisma.item.findUnique({
        where: { id: ligne.itemId },
        select: { factory: true, isProducible: true, code: true },
      });
      if (!article) throw nonTrouve("L'article");
      if (!article.isProducible) {
        throw etatInvalide(`L'article ${article.code} n'est pas productible.`);
      }

      const ordre = await creerOrdreFabrication({
        itemId: ligne.itemId,
        quantityPlanned: ligne.quantity,
        factory: article.factory,
        salesOrderId: commande.id,
        salesOrderLineId: ligne.id,
        sourceWarehouseId: entree.sourceWarehouseId ?? null,
        targetWarehouseId: entree.targetWarehouseId ?? null,
        dueDate: ligne.deliveryDate ?? commande.expectedDate ?? null,
        responsibleId: entree.responsableId ?? null,
        notes: `Genere depuis la commande client ${commande.number}`,
        acteur,
      });

      ordresCrees.push({
        salesOrderLineId: ligne.id,
        itemId: ligne.itemId,
        workOrderId: ordre.workOrderId,
        numero: ordre.number,
      });
    } catch (erreur) {
      lignesEnEchec.push({
        salesOrderLineId: ligne.id,
        itemId: ligne.itemId,
        motif: erreur instanceof Error ? erreur.message : "Erreur inconnue",
      });
    }
  }

  if (ordresCrees.length > 0 || lignesEnEchec.length > 0) {
    await enregistrerAudit({
      action: ACTIONS_AUDIT.PRODUCTION,
      module: MODULES_AUDIT.VENTE,
      entity: "SalesOrder",
      entityId: commande.id,
      userId: acteur.id,
      userEmail: acteur.email,
      newValue: {
        numero: commande.number,
        ordresGeneres: ordresCrees.map((ordre) => ordre.numero),
        lignesEnEchec: lignesEnEchec.map((echec) => `ligne ${echec.salesOrderLineId} : ${echec.motif}`),
      },
      comment: "Generation automatique des ordres de fabrication",
    });
  }

  return { orderId: commande.id, numero: commande.number, ordresCrees, lignesEnEchec };
}

export async function annulerCommandeClient(
  entree: { orderId: number; motif: string },
  acteur: ActeurVente,
): Promise<void> {
  if (!entree.motif || entree.motif.trim().length < 5) {
    throw validation("Le motif d'annulation est obligatoire.");
  }

  await prisma.$transaction(
    async (tx) => {
      const commande = await tx.salesOrder.findUnique({
        where: { id: entree.orderId },
        include: {
          deliveryNotes: { where: { status: { not: "ANNULEE" } }, select: { number: true } },
          invoices: { where: { status: { not: "ANNULEE" } }, select: { number: true } },
          workOrders: { select: { number: true, status: true } },
        },
      });
      if (!commande) throw nonTrouve("La commande client");
      if (commande.status === "ANNULEE") throw conflit("Cette commande est deja annulee.");

      if (commande.deliveryNotes.length > 0) {
        throw etatInvalide(
          `Cette commande a deja fait l'objet de livraisons (${commande.deliveryNotes.map((d) => d.number).join(", ")}) : elle ne peut plus etre annulee.`,
        );
      }
      if (commande.invoices.length > 0) {
        throw etatInvalide(
          `Cette commande est facturee (${commande.invoices.map((i) => i.number).join(", ")}) : etablissez un avoir avant toute annulation.`,
        );
      }

      const ordresEnCours = commande.workOrders.filter(
        (ordre) => ordre.status !== "ANNULE" && ordre.status !== "CLOTURE",
      );
      if (ordresEnCours.length > 0) {
        throw etatInvalide(
          `Cette commande compte ${ordresEnCours.length} ordre(s) de fabrication actifs (${ordresEnCours.map((o) => o.number).join(", ")}). Annulez-les d'abord.`,
        );
      }

      await tx.salesOrder.update({
        where: { id: commande.id },
        data: {
          status: "ANNULEE",
          notes: `${commande.notes ?? ""}\nAnnulation : ${entree.motif}`.trim(),
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.ANNULATION,
          module: MODULES_AUDIT.VENTE,
          entity: "SalesOrder",
          entityId: commande.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: commande.status, numero: commande.number },
          newValue: { statut: "ANNULEE" },
          comment: entree.motif,
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

// -----------------------------------------------------------------------------
// 3. Bon de livraison
// -----------------------------------------------------------------------------

export interface LigneBonLivraisonInput {
  orderLineId?: number | null;
  itemId: number;
  quantity: Prisma.Decimal | string | number;
  unitPrice?: Prisma.Decimal | string | number;
  unitCode?: string | null;
  notes?: string | null;
}

export interface BonLivraisonInput {
  customerId: number;
  warehouseId: number;
  orderId?: number | null;
  deliveryDate?: Date;
  address?: string | null;
  carrier?: string | null;
  customerRef?: string | null;
  notes?: string | null;
  lines: LigneBonLivraisonInput[];
}

export async function creerBonLivraison(
  entree: BonLivraisonInput,
  acteur: ActeurVente,
): Promise<{ deliveryId: number; numero: string; statut: DeliveryStatus }> {
  if (entree.lines.length === 0) {
    throw validation("Un bon de livraison doit comporter au moins une ligne.");
  }

  return prisma.$transaction(
    async (tx) => {
      const client = await tx.thirdParty.findUnique({
        where: { id: entree.customerId },
        select: { label1: true, isClient: true },
      });
      if (!client) throw nonTrouve("Le client");
      if (!client.isClient) throw validation("Le tiers indique n'est pas un client.");

      const depot = await tx.warehouse.findUnique({
        where: { id: entree.warehouseId },
        select: { id: true, code: true, isActive: true },
      });
      if (!depot) throw nonTrouve("Le depot de depart");
      if (!depot.isActive) throw etatInvalide(`Le depot « ${depot.code} » est inactif.`);

      let commande: { id: number; number: string; status: SalesOrderStatus } | null = null;
      if (entree.orderId) {
        const trouvee = await tx.salesOrder.findUnique({
          where: { id: entree.orderId },
          select: { id: true, number: true, status: true },
        });
        if (!trouvee) throw nonTrouve("La commande client");
        if (trouvee.status === "ANNULEE" || trouvee.status === "BROUILLON") {
          throw etatInvalide(
            `La commande ${trouvee.number} est au statut ${trouvee.status} : confirmez-la avant de preparer une livraison.`,
          );
        }
        commande = trouvee;
      }

      const numero = await prochainNumero(SEQUENCES.BON_LIVRAISON, tx);
      const dateLivraison = entree.deliveryDate ?? new Date();

      const livraison = await tx.deliveryNote.create({
        data: {
          number: numero,
          status: "BROUILLON",
          customerId: entree.customerId,
          orderId: commande?.id ?? null,
          deliveryDate: dateLivraison,
          warehouseId: entree.warehouseId,
          address: entree.address ?? null,
          carrier: entree.carrier ?? null,
          customerRef: entree.customerRef ?? null,
          notes: entree.notes ?? null,
          createdById: acteur.id,
        },
      });

      let index = 1;
      for (const ligne of entree.lines) {
        const quantite = D.roundQuantity(ligne.quantity);
        if (D.lte(quantite, 0)) {
          throw validation(`Ligne ${index} : la quantite livree doit etre strictement positive.`);
        }

        const article = await verifierArticle({
          tx,
          itemId: ligne.itemId,
          ligne: index,
          exigerSellable: true,
        });

        let ligneCommande: {
          id: number;
          itemId: number;
          quantity: Decimal;
          quantityDelivered: Decimal;
          unitPrice: Decimal;
          unitCode: string | null;
        } | null = null;

        if (ligne.orderLineId) {
          const trouvee = await tx.salesOrderLine.findUnique({
            where: { id: ligne.orderLineId },
            select: {
              id: true,
              orderId: true,
              itemId: true,
              quantity: true,
              quantityDelivered: true,
              unitPrice: true,
              unitCode: true,
            },
          });
          if (!trouvee) throw nonTrouve(`La ligne de commande ${ligne.orderLineId}`);
          if (commande && trouvee.orderId !== commande.id) {
            throw validation(
              `La ligne ${ligne.orderLineId} n'appartient pas a la commande ${commande.number}.`,
            );
          }
          if (trouvee.itemId !== ligne.itemId) {
            throw validation(
              `Ligne ${index} : l'article ne correspond pas a celui de la ligne de commande.`,
            );
          }
          if (D.gt(D.add(trouvee.quantityDelivered, quantite), trouvee.quantity)) {
            throw validation(
              `Ligne ${index} : la livraison porterait le total livre a ${D.toFixed(D.add(trouvee.quantityDelivered, quantite), 3)} pour une quantite commandee de ${D.toFixed(trouvee.quantity, 3)}.`,
            );
          }
          ligneCommande = {
            id: trouvee.id,
            itemId: trouvee.itemId,
            quantity: D.of(trouvee.quantity),
            quantityDelivered: D.of(trouvee.quantityDelivered),
            unitPrice: D.of(trouvee.unitPrice),
            unitCode: trouvee.unitCode,
          };
        }

        const disponible = await disponibleArticle(ligne.itemId, entree.warehouseId, tx);

        await tx.deliveryNoteLine.create({
          data: {
            deliveryId: livraison.id,
            lineNo: index,
            orderLineId: ligneCommande?.id ?? null,
            itemId: ligne.itemId,
            quantityOrdered: ligneCommande?.quantity ?? 0,
            quantityDelivered: quantite,
            unitCode: ligne.unitCode ?? ligneCommande?.unitCode ?? article.unitCode ?? null,
            unitPrice: D.roundAmount(ligne.unitPrice ?? ligneCommande?.unitPrice ?? 0),
            notes: ligne.notes ?? null,
          },
        });

        if (D.lt(disponible, quantite)) {
          // La preparation est possible, mais l'expedition sera refusee : on le
          // signale des la saisie pour eviter une promesse de livraison fausse.
          await tx.deliveryNote.update({
            where: { id: livraison.id },
            data: {
              notes: `${entree.notes ?? ""}\nLigne ${index} : disponible ${D.toFixed(disponible, 3)} pour ${D.toFixed(quantite, 3)} demande(s).`.trim(),
            },
          });
        }

        index += 1;
      }

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.CREATION,
          module: MODULES_AUDIT.VENTE,
          entity: "DeliveryNote",
          entityId: livraison.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: {
            numero,
            client: client.label1,
            commande: commande?.number ?? null,
            depot: depot.code,
            lignes: entree.lines.length,
          },
        },
        tx,
      );

      return { deliveryId: livraison.id, numero, statut: "BROUILLON" };
    },
    { timeout: 60_000 },
  );
}

export async function preparerBonLivraison(
  deliveryId: number,
  acteur: ActeurVente,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const livraison = await tx.deliveryNote.findUnique({
        where: { id: deliveryId },
        include: { _count: { select: { lines: true } } },
      });
      if (!livraison) throw nonTrouve("Le bon de livraison");
      if (livraison.status !== "BROUILLON") {
        throw conflit(`Ce bon de livraison est au statut ${livraison.status}.`);
      }
      if (livraison._count.lines === 0) {
        throw etatInvalide("Un bon de livraison sans ligne ne peut pas etre prepare.");
      }

      await tx.deliveryNote.update({
        where: { id: deliveryId },
        data: { status: "PREPAREE" },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.MODIFICATION,
          module: MODULES_AUDIT.VENTE,
          entity: "DeliveryNote",
          entityId: deliveryId,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: "BROUILLON" },
          newValue: { statut: "PREPAREE", numero: livraison.number },
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

/**
 * Expede un bon de livraison : c'est ici que le stock sort reellement.
 *
 * Controle qualite : lorsque la liberation est obligatoire, chaque ligne
 * portant un article productible doit correspondre a des ordres de fabrication
 * dont la quantite conforme a ete liberee. Un produit fini non libere ne part
 * donc jamais chez le client.
 */
export async function expedierBonLivraison(
  deliveryId: number,
  acteur: ActeurVente,
): Promise<{ numero: string; mouvements: number; coutTotal: Decimal }> {
  const liberationObligatoire = await lireParametreBooleen(
    CLE_PARAMETRE.QUALITE_LIBERATION_OBLIGATOIRE,
    true,
  );

  const resultat = await prisma.$transaction(
    async (tx) => {
      const livraison = await tx.deliveryNote.findUnique({
        where: { id: deliveryId },
        include: {
          lines: { orderBy: { lineNo: "asc" } },
          customer: { select: { label1: true } },
          order: { select: { id: true, number: true } },
        },
      });
      if (!livraison) throw nonTrouve("Le bon de livraison");
      if (livraison.status === "EXPEDIEE" || livraison.status === "LIVREE") {
        throw conflit(`Ce bon de livraison est deja au statut ${livraison.status}.`);
      }
      if (livraison.status === "ANNULEE") {
        throw etatInvalide("Ce bon de livraison est annule.");
      }
      if (livraison.lines.length === 0) {
        throw etatInvalide("Un bon de livraison sans ligne ne peut pas etre expedie.");
      }

      if (liberationObligatoire && livraison.orderId) {
        for (const ligne of livraison.lines) {
          const article = await tx.item.findUnique({
            where: { id: ligne.itemId },
            select: { code: true, isProducible: true },
          });
          if (!article?.isProducible) continue;

          const ordres = await tx.workOrder.findMany({
            where: {
              salesOrderLineId: ligne.orderLineId ?? undefined,
              salesOrderId: livraison.orderId,
              itemId: ligne.itemId,
              status: { not: "ANNULE" },
            },
            select: { number: true, quantityConform: true, qualityReleasedAt: true, qualityStatus: true },
          });

          if (ordres.length === 0) {
            throw etatInvalide(
              `Ligne ${ligne.lineNo} : l'article ${article.code} est produit en interne mais aucun ordre de fabrication n'est rattache a cette commande. La tracabilite de la liberation qualite ne peut pas etre etablie.`,
            );
          }

          const nonLiberes = ordres.filter((ordre) => ordre.qualityReleasedAt === null);
          if (nonLiberes.length > 0) {
            throw etatInvalide(
              `Ligne ${ligne.lineNo} : la marchandise ne peut pas etre livree avant liberation qualite. Ordre(s) en attente : ${nonLiberes.map((ordre) => ordre.number).join(", ")}.`,
            );
          }
        }
      }

      let coutTotal = D.ZERO;
      let nombreMouvements = 0;

      for (const ligne of livraison.lines) {
        const sortie = await sortirStockFifo(tx, {
          itemId: ligne.itemId,
          warehouseId: livraison.warehouseId,
          quantity: D.of(ligne.quantityDelivered),
          documentType: "BON_LIVRAISON",
          documentId: String(livraison.id),
          documentNumber: livraison.number,
          thirdPartyId: livraison.customerId,
          occurredAt: livraison.deliveryDate,
          comment: `Livraison ${livraison.number} - ${livraison.customer.label1}`,
          acteur,
        });

        coutTotal = D.add(coutTotal, sortie.coutTotal);
        nombreMouvements += sortie.mouvements.length;

        await tx.deliveryNoteLine.update({
          where: { id: ligne.id },
          data: {
            movementId: sortie.mouvements[0] ?? null,
            lotId: sortie.allocations[0]?.lotId ?? null,
          },
        });

        if (ligne.orderLineId) {
          const ligneCommande = await tx.salesOrderLine.findUnique({
            where: { id: ligne.orderLineId },
            select: { quantityDelivered: true },
          });
          if (ligneCommande) {
            await tx.salesOrderLine.update({
              where: { id: ligne.orderLineId },
              data: {
                quantityDelivered: D.roundQuantity(
                  D.add(ligneCommande.quantityDelivered, ligne.quantityDelivered),
                ),
              },
            });
          }
        }
      }

      await tx.deliveryNote.update({
        where: { id: livraison.id },
        data: { status: "EXPEDIEE", qualityReleased: true },
      });

      if (livraison.orderId) {
        await recalculerStatutCommandeClient(tx, livraison.orderId);
      }

      // Valorisation de la sortie de stock : ecriture generee uniquement si la
      // regle correspondante est configuree par le comptable.
      const ecriture = await genererEcritureSiRegle(tx, {
        eventCode: "SORTIE_STOCK_LIVRAISON",
        entryDate: livraison.deliveryDate,
        label: `Sortie de stock - livraison ${livraison.number}`,
        reference: livraison.number,
        documentType: "BON_LIVRAISON",
        documentId: String(livraison.id),
        montantHT: D.roundAmount(coutTotal),
        montantTVA: 0,
        montantTTC: D.roundAmount(coutTotal),
        thirdPartyId: null,
        acteur,
      });
      // La validation puis le postage de l'ecriture de valorisation sont realises
      // apres l'expedition : ils ouvrent leur propre transaction et l'ecriture
      // encore non validee ne leur serait pas visible depuis celle-ci.

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.EXPORT,
          module: MODULES_AUDIT.VENTE,
          entity: "DeliveryNote",
          entityId: livraison.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: livraison.status },
          newValue: {
            statut: "EXPEDIEE",
            numero: livraison.number,
            client: livraison.customer.label1,
            commande: livraison.order?.number ?? null,
            mouvements: nombreMouvements,
            coutSortie: D.toFixed(D.roundAmount(coutTotal), 2),
            ecriture: ecriture?.numero ?? null,
            regleComptableAbsente: ecriture === null,
          },
          comment:
            ecriture === null
              ? "Aucune regle d'ecriture active pour SORTIE_STOCK_LIVRAISON : la valorisation n'a pas ete comptabilisee."
              : null,
        },
        tx,
      );

      return {
        numero: livraison.number,
        mouvements: nombreMouvements,
        coutTotal: D.roundAmount(coutTotal),
        entryId: ecriture?.entryId ?? null,
      };
    },
    { timeout: 120_000 },
  );

  if (resultat.entryId !== null) {
    await validerEcriture(resultat.entryId, acteur);
    await posterEcriture(resultat.entryId, acteur);
  }

  return {
    numero: resultat.numero,
    mouvements: resultat.mouvements,
    coutTotal: resultat.coutTotal,
  };
}

export async function livrerBonLivraison(
  entree: { deliveryId: number; dateLivraison?: Date; commentaire?: string | null },
  acteur: ActeurVente,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const livraison = await tx.deliveryNote.findUnique({ where: { id: entree.deliveryId } });
      if (!livraison) throw nonTrouve("Le bon de livraison");
      if (livraison.status === "LIVREE") throw conflit("Ce bon de livraison est deja livre.");
      if (livraison.status !== "EXPEDIEE") {
        throw etatInvalide(
          `Un bon de livraison doit d'abord etre expedie avant d'etre confirme comme livre (statut actuel : ${livraison.status}).`,
        );
      }

      await tx.deliveryNote.update({
        where: { id: livraison.id },
        data: {
          status: "LIVREE",
          deliveryDate: entree.dateLivraison ?? livraison.deliveryDate,
          notes: entree.commentaire
            ? `${livraison.notes ?? ""}\n${entree.commentaire}`.trim()
            : livraison.notes,
        },
      });

      if (livraison.orderId) {
        await recalculerStatutCommandeClient(tx, livraison.orderId);
      }

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.VALIDATION,
          module: MODULES_AUDIT.VENTE,
          entity: "DeliveryNote",
          entityId: livraison.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: "EXPEDIEE" },
          newValue: { statut: "LIVREE", numero: livraison.number },
          comment: entree.commentaire ?? null,
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
}

/**
 * Annulation d'un bon de livraison.
 *
 * Si la marchandise est deja sortie du stock, un mouvement inverse est cree :
 * aucune sortie validee n'est effacee.
 */
export async function annulerBonLivraison(
  entree: { deliveryId: number; motif: string },
  acteur: ActeurVente,
): Promise<void> {
  if (!entree.motif || entree.motif.trim().length < 10) {
    throw validation("Le motif d'annulation est obligatoire (au moins 10 caracteres).");
  }

  await prisma.$transaction(
    async (tx) => {
      const livraison = await tx.deliveryNote.findUnique({
        where: { id: entree.deliveryId },
        include: {
          lines: { orderBy: { lineNo: "asc" } },
          invoices: { where: { status: { not: "ANNULEE" } }, select: { number: true } },
        },
      });
      if (!livraison) throw nonTrouve("Le bon de livraison");
      if (livraison.status === "ANNULEE") throw conflit("Ce bon de livraison est deja annule.");
      if (livraison.invoices.length > 0) {
        throw etatInvalide(
          `Cette livraison est facturee (${livraison.invoices.map((i) => i.number).join(", ")}) : etablissez un avoir avant de l'annuler.`,
        );
      }

      const dejaSorti = livraison.status === "EXPEDIEE" || livraison.status === "LIVREE";

      if (dejaSorti) {
        for (const ligne of livraison.lines) {
          // La marchandise revient en stock par un mouvement de retour client :
          // la sortie d'origine reste au grand livre, rien n'est efface.
          await enregistrerMouvement(tx, {
            type: "RETOUR_CLIENT",
            itemId: ligne.itemId,
            warehouseId: livraison.warehouseId,
            lotId: ligne.lotId ?? null,
            status: "LIBRE",
            quantity: D.of(ligne.quantityDelivered),
            documentType: "BON_LIVRAISON",
            documentId: String(livraison.id),
            documentNumber: `${livraison.number}-RET`,
            thirdPartyId: livraison.customerId,
            comment: `Retour du client - annulation de la livraison ${livraison.number}`,
            reason: entree.motif,
            justification: entree.motif,
            acteur,
          });

          if (ligne.orderLineId) {
            const ligneCommande = await tx.salesOrderLine.findUnique({
              where: { id: ligne.orderLineId },
              select: { quantityDelivered: true },
            });
            if (ligneCommande) {
              await tx.salesOrderLine.update({
                where: { id: ligne.orderLineId },
                data: {
                  quantityDelivered: D.roundQuantity(
                    D.max(D.ZERO, D.sub(ligneCommande.quantityDelivered, ligne.quantityDelivered)),
                  ),
                },
              });
            }
          }
        }
      }

      await tx.deliveryNote.update({
        where: { id: livraison.id },
        data: {
          status: "ANNULEE",
          notes: `${livraison.notes ?? ""}\nAnnulation : ${entree.motif}`.trim(),
        },
      });

      if (livraison.orderId) {
        await recalculerStatutCommandeClient(tx, livraison.orderId);
      }

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.ANNULATION,
          module: MODULES_AUDIT.VENTE,
          entity: "DeliveryNote",
          entityId: livraison.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: livraison.status, numero: livraison.number },
          newValue: { statut: "ANNULEE", marchandiseRemise: dejaSorti },
          comment: entree.motif,
        },
        tx,
      );
    },
    { timeout: 120_000 },
  );
}

// -----------------------------------------------------------------------------
// 4. Facture client et reglement
// -----------------------------------------------------------------------------

export interface FactureClientInput {
  customerId: number;
  orderId?: number | null;
  deliveryId?: number | null;
  invoiceDate?: Date;
  dueDate?: Date | null;
  paymentTermsDays?: number;
  currency?: string;
  reference?: string | null;
  notes?: string | null;
  /** Lignes explicites. Sinon, elles sont reprises de la livraison rattachee. */
  lines?: {
    itemId?: number | null;
    orderLineId?: number | null;
    deliveryLineId?: number | null;
    description?: string | null;
    quantity: Prisma.Decimal | string | number;
    unitPrice: Prisma.Decimal | string | number;
    discountRate?: Prisma.Decimal | string | number;
    vatRateCode?: string | null;
  }[];
}

/**
 * Etablit une facture client, soit a partir d'un bon de livraison, soit sur des
 * lignes explicites (facturation a l'avancement). La piece comptable creee est
 * unique : aucun doublon n'est possible pour une meme livraison.
 */
export async function creerFactureClient(
  entree: FactureClientInput,
  acteur: ActeurVente,
): Promise<{ invoiceId: number; numero: string; totalTTC: Decimal }> {
  return prisma.$transaction(
    async (tx) => {
      const client = await tx.thirdParty.findUnique({
        where: { id: entree.customerId },
        select: { id: true, label1: true, isClient: true, deadlineDays: true },
      });
      if (!client) throw nonTrouve("Le client");
      if (!client.isClient) throw validation("Le tiers indique n'est pas un client.");

      let livraison: {
        id: number;
        number: string;
        orderId: number | null;
        lines: {
          id: number;
          orderLineId: number | null;
          itemId: number;
          quantityDelivered: Decimal;
          unitPrice: Decimal;
          unitCode: string | null;
          lineNo: number;
        }[];
      } | null = null;

      if (entree.deliveryId) {
        const trouvee = await tx.deliveryNote.findUnique({
          where: { id: entree.deliveryId },
          include: { lines: { orderBy: { lineNo: "asc" } } },
        });
        if (!trouvee) throw nonTrouve("Le bon de livraison");
        if (trouvee.customerId !== entree.customerId) {
          throw validation("Le bon de livraison n'appartient pas a ce client.");
        }
        if (trouvee.status === "ANNULEE") {
          throw etatInvalide(`Le bon de livraison ${trouvee.number} est annule.`);
        }
        if (trouvee.status !== "EXPEDIEE" && trouvee.status !== "LIVREE") {
          throw etatInvalide(
            `Le bon de livraison ${trouvee.number} n'est pas encore expedie : il ne peut pas etre facture.`,
          );
        }

        const dejaFacturee = await tx.invoice.findFirst({
          where: { deliveryId: trouvee.id, status: { not: "ANNULEE" } },
          select: { number: true },
        });
        if (dejaFacturee) {
          throw conflit(
            `Le bon de livraison ${trouvee.number} est deja facture (${dejaFacturee.number}). Etablissez un avoir pour toute correction.`,
          );
        }

        livraison = {
          id: trouvee.id,
          number: trouvee.number,
          orderId: trouvee.orderId,
          lines: trouvee.lines.map((ligne) => ({
            id: ligne.id,
            orderLineId: ligne.orderLineId,
            itemId: ligne.itemId,
            quantityDelivered: D.of(ligne.quantityDelivered),
            unitPrice: D.of(ligne.unitPrice),
            unitCode: ligne.unitCode,
            lineNo: ligne.lineNo,
          })),
        };
      }

      let commandeId = entree.orderId ?? livraison?.orderId ?? null;
      let delaiPaiement = entree.paymentTermsDays ?? client.deadlineDays ?? 0;

      if (commandeId && !entree.paymentTermsDays) {
        const commande = await tx.salesOrder.findUnique({
          where: { id: commandeId },
          select: { paymentTermsDays: true, customerId: true, number: true },
        });
        if (!commande) throw nonTrouve("La commande client");
        if (commande.customerId !== entree.customerId) {
          throw validation("La commande n'appartient pas a ce client.");
        }
        delaiPaiement = commande.paymentTermsDays;
      }

      const lignes = entree.lines?.length
        ? entree.lines
        : livraison?.lines.map((ligne) => ({
            itemId: ligne.itemId,
            orderLineId: ligne.orderLineId,
            deliveryLineId: ligne.id,
            description: null,
            quantity: ligne.quantityDelivered,
            unitPrice: ligne.unitPrice,
            discountRate: 0,
            vatRateCode: null,
          })) ?? [];

      if (lignes.length === 0) {
        throw validation(
          "Aucune ligne a facturer : precisez un bon de livraison ou les lignes de la facture.",
        );
      }

      const numero = await prochainNumero(SEQUENCES.FACTURE_CLIENT, tx);
      const dateFacture = entree.invoiceDate ?? new Date();
      const dateEcheance =
        entree.dueDate ??
        (delaiPaiement > 0 ? new Date(dateFacture.getTime() + delaiPaiement * 86_400_000) : null);

      const facture = await tx.invoice.create({
        data: {
          number: numero,
          direction: "CLIENT",
          nature: "FACTURE",
          status: "BROUILLON",
          thirdPartyId: entree.customerId,
          orderId: commandeId,
          deliveryId: livraison?.id ?? null,
          invoiceDate: dateFacture,
          dueDate: dateEcheance,
          currency: entree.currency ?? "DZD",
          paymentTermsDays: delaiPaiement,
          reference: entree.reference ?? livraison?.number ?? null,
          notes: entree.notes ?? null,
          createdById: acteur.id,
        },
      });

      let index = 1;
      let brut = D.ZERO;
      let remises = D.ZERO;
      let tva = D.ZERO;

      for (const ligne of lignes) {
        const quantite = D.roundQuantity(ligne.quantity);
        if (D.lte(quantite, 0)) {
          throw validation(`Ligne ${index} : la quantite facturee doit etre strictement positive.`);
        }
        const prixUnitaire = D.roundAmount(ligne.unitPrice);

        const tauxTva = await resoudreTauxTva(tx, {
          vatRateCode: ligne.vatRateCode ?? null,
          itemId: ligne.itemId ?? null,
        });
        const calcul = calculerLigne(
          quantite,
          prixUnitaire,
          D.round(D.of(ligne.discountRate ?? 0), 4),
          tauxTva.taux,
        );

        await tx.invoiceLine.create({
          data: {
            invoiceId: facture.id,
            lineNo: index,
            itemId: ligne.itemId ?? null,
            description: ligne.description ?? null,
            quantity: quantite,
            unitPrice: prixUnitaire,
            discountRate: D.round(D.of(ligne.discountRate ?? 0), 4),
            vatRateCode: tauxTva.code,
            vatRate: D.round(tauxTva.taux, 4),
            lineHT: calcul.ht,
            lineVAT: calcul.tva,
            lineTTC: calcul.ttc,
            orderLineId: ligne.orderLineId ?? null,
            deliveryLineId: ligne.deliveryLineId ?? null,
          },
        });

        brut = D.add(brut, calcul.brut);
        remises = D.add(remises, calcul.remise);
        tva = D.add(tva, calcul.tva);
        index += 1;
      }

      const totalHT = D.roundAmount(D.sub(brut, remises));
      const totalTVA = D.roundAmount(tva);
      const totalTTC = D.roundAmount(D.add(totalHT, totalTVA));

      await tx.invoice.update({
        where: { id: facture.id },
        data: {
          subtotalHT: totalHT,
          discountAmount: D.roundAmount(remises),
          vatAmount: totalTVA,
          totalTTC,
          balance: totalTTC,
        },
      });

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.FACTURATION,
          module: MODULES_AUDIT.VENTE,
          entity: "Invoice",
          entityId: facture.id,
          userId: acteur.id,
          userEmail: acteur.email,
          newValue: {
            numero,
            client: client.label1,
            livraison: livraison?.number ?? null,
            totalHT: D.toFixed(totalHT, 2),
            totalTVA: D.toFixed(totalTVA, 2),
            totalTTC: D.toFixed(totalTTC, 2),
          },
        },
        tx,
      );

      return { invoiceId: facture.id, numero, totalTTC };
    },
    { timeout: 60_000 },
  );
}

export async function validerFactureClient(
  entree: { invoiceId: number; entryDate?: Date },
  acteur: ActeurVente,
): Promise<{ numero: string; numeroEcriture: string }> {
  const resultat = await prisma.$transaction(
    async (tx) => {
      const facture = await tx.invoice.findUnique({
        where: { id: entree.invoiceId },
        include: { lines: true, thirdParty: { select: { label1: true, isClient: true } } },
      });
      if (!facture) throw nonTrouve("La facture client");
      if (facture.direction !== "CLIENT") {
        throw validation("Cette piece n'est pas une facture client.");
      }
      if (facture.nature !== "FACTURE") {
        throw validation("Un avoir ne se valide pas par cette operation.");
      }
      if (facture.status !== "BROUILLON") {
        throw conflit(`Cette facture est au statut ${facture.status} : elle a deja ete validee.`);
      }
      if (facture.lines.length === 0) {
        throw etatInvalide("Une facture sans ligne ne peut pas etre validee.");
      }

      const ecriture = await genererEcriture(tx, {
        eventCode: "FACTURE_CLIENT",
        entryDate: entree.entryDate ?? facture.invoiceDate,
        label: `Facture client ${facture.number} - ${facture.thirdParty.label1}`,
        reference: facture.reference ?? facture.number,
        documentType: "FACTURE_CLIENT",
        documentId: String(facture.id),
        montantHT: D.of(facture.subtotalHT),
        montantTVA: D.of(facture.vatAmount),
        montantTTC: D.of(facture.totalTTC),
        thirdPartyId: facture.thirdPartyId,
        invoiceId: facture.id,
        acteur,
      });

      // La validation puis le postage de l'ecriture sont realises apres la
      // transaction de la facture : ils ouvrent leur propre transaction et
      // l'ecriture encore non validee ne leur serait pas visible depuis celle-ci.

      await tx.invoice.update({
        where: { id: facture.id },
        data: {
          status: "POSTEE",
          postedAt: new Date(),
          postedById: acteur.id,
          balance: D.of(facture.totalTTC),
        },
      });

      for (const ligne of facture.lines) {
        if (ligne.orderLineId) {
          const ligneCommande = await tx.salesOrderLine.findUnique({
            where: { id: ligne.orderLineId },
            select: { quantityInvoiced: true },
          });
          if (ligneCommande) {
            await tx.salesOrderLine.update({
              where: { id: ligne.orderLineId },
              data: {
                quantityInvoiced: D.roundQuantity(
                  D.add(ligneCommande.quantityInvoiced, ligne.quantity),
                ),
              },
            });
          }
        }
      }

      if (facture.orderId) {
        await recalculerStatutCommandeClient(tx, facture.orderId);
      }

      await majSoldeTiers(tx, facture.thirdPartyId);

      await enregistrerAudit(
        {
          action: ACTIONS_AUDIT.VALIDATION,
          module: MODULES_AUDIT.VENTE,
          entity: "Invoice",
          entityId: facture.id,
          userId: acteur.id,
          userEmail: acteur.email,
          oldValue: { statut: "BROUILLON" },
          newValue: {
            statut: "POSTEE",
            numero: facture.number,
            totalTTC: D.of(facture.totalTTC).toFixed(2),
            ecriture: ecriture.numero,
          },
        },
        tx,
      );

      return {
        numero: facture.number,
        numeroEcriture: ecriture.numero,
        entryId: ecriture.entryId,
      };
    },
    { timeout: 60_000 },
  );

  await validerEcriture(resultat.entryId, acteur);
  await posterEcriture(resultat.entryId, acteur);

  return { numero: resultat.numero, numeroEcriture: resultat.numeroEcriture };
}

export async function reglerFactureClient(
  entree: {
    invoiceId: number;
    method: Parameters<typeof enregistrerReglement>[0]["method"];
    amount?: Prisma.Decimal | string | number;
    paymentDate?: Date;
    reference?: string | null;
    bankAccount?: string | null;
  },
  acteur: ActeurVente,
) {
  const facture = await prisma.invoice.findUnique({
    where: { id: entree.invoiceId },
    select: {
      id: true,
      number: true,
      thirdPartyId: true,
      direction: true,
      nature: true,
      status: true,
      totalTTC: true,
      paidAmount: true,
      balance: true,
    },
  });
  if (!facture) throw nonTrouve("La facture client");
  if (facture.direction !== "CLIENT") throw validation("Cette piece n'est pas une facture client.");
  if (facture.nature === "AVOIR") {
    throw etatInvalide("Un avoir ne se regle pas : il vient en deduction du solde du client.");
  }
  if (facture.status === "BROUILLON" || facture.status === "VALIDEE") {
    throw etatInvalide(
      "Cette facture n'est pas encore comptabilisee : validez-la avant d'enregistrer un encaissement.",
    );
  }
  if (facture.status === "ANNULEE") throw etatInvalide("Cette facture est annulee.");

  const reste = D.sub(D.of(facture.totalTTC), D.of(facture.paidAmount));
  if (D.lte(reste, 0)) throw conflit("Cette facture est deja integralement reglee.");

  const montant = D.roundAmount(entree.amount ?? reste);
  if (D.gt(montant, reste)) {
    throw validation(
      `Le montant de l'encaissement (${D.toFixed(montant, 2)}) depasse le reste du de la facture (${D.toFixed(reste, 2)}).`,
    );
  }

  return enregistrerReglement({
    direction: "ENCAISSEMENT",
    thirdPartyId: facture.thirdPartyId,
    method: entree.method,
    amount: montant,
    paymentDate: entree.paymentDate,
    reference: entree.reference ?? facture.number,
    bankAccount: entree.bankAccount ?? null,
    notes: `Encaissement de la facture client ${facture.number}`,
    allocations: [{ invoiceId: facture.id, amount: montant }],
    acteur,
  });
}

export async function creerAvoirClient(
  entree: {
    invoiceId: number;
    montantHT: Prisma.Decimal | string | number;
    montantTVA?: Prisma.Decimal | string | number;
    motif: string;
    invoiceDate?: Date;
  },
  acteur: ActeurVente,
) {
  const facture = await prisma.invoice.findUnique({
    where: { id: entree.invoiceId },
    select: { id: true, direction: true, status: true },
  });
  if (!facture) throw nonTrouve("La facture client");
  if (facture.direction !== "CLIENT") throw validation("Cette piece n'est pas une facture client.");
  if (facture.status === "BROUILLON") {
    throw etatInvalide(
      "Validez la facture avant d'etablir un avoir : un avoir ne peut pas preceder sa facture d'origine.",
    );
  }

  return creerAvoir({
    invoiceId: entree.invoiceId,
    montantHT: entree.montantHT,
    montantTVA: entree.montantTVA,
    motif: entree.motif,
    invoiceDate: entree.invoiceDate,
    acteur,
  });
}

// -----------------------------------------------------------------------------
// 5. Consultations et indicateurs
// -----------------------------------------------------------------------------

export async function listerDevis(filtres: {
  statut?: QuoteStatus;
  customerId?: number;
  page?: number;
  taille?: number;
}) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(200, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.QuoteWhereInput = {};
  if (filtres.statut) where.status = filtres.statut;
  if (filtres.customerId) where.customerId = filtres.customerId;

  const [total, lignes] = await Promise.all([
    prisma.quote.count({ where }),
    prisma.quote.findMany({
      where,
      orderBy: { quoteDate: "desc" },
      skip: (page - 1) * taille,
      take: taille,
      include: {
        customer: { select: { code: true, label1: true } },
        lines: { orderBy: { lineNo: "asc" }, include: { item: { select: { code: true, label1: true } } } },
      },
    }),
  ]);

  return { lignes, total, page, taille, pages: Math.max(1, Math.ceil(total / taille)) };
}

export async function listerCommandesClient(filtres: {
  statut?: SalesOrderStatus;
  customerId?: number;
  page?: number;
  taille?: number;
}) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(200, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.SalesOrderWhereInput = {};
  if (filtres.statut) where.status = filtres.statut;
  if (filtres.customerId) where.customerId = filtres.customerId;

  const [total, lignes] = await Promise.all([
    prisma.salesOrder.count({ where }),
    prisma.salesOrder.findMany({
      where,
      orderBy: { orderDate: "desc" },
      skip: (page - 1) * taille,
      take: taille,
      include: {
        customer: { select: { code: true, label1: true } },
        lines: {
          orderBy: { lineNo: "asc" },
          include: { item: { select: { code: true, label1: true } } },
        },
        workOrders: { select: { number: true, status: true, quantityPlanned: true } },
        _count: { select: { deliveryNotes: true, invoices: true } },
      },
    }),
  ]);

  return { lignes, total, page, taille, pages: Math.max(1, Math.ceil(total / taille)) };
}

export async function listerBonsLivraison(filtres: {
  statut?: DeliveryStatus;
  customerId?: number;
  page?: number;
  taille?: number;
}) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(200, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.DeliveryNoteWhereInput = {};
  if (filtres.statut) where.status = filtres.statut;
  if (filtres.customerId) where.customerId = filtres.customerId;

  const [total, lignes] = await Promise.all([
    prisma.deliveryNote.count({ where }),
    prisma.deliveryNote.findMany({
      where,
      orderBy: { deliveryDate: "desc" },
      skip: (page - 1) * taille,
      take: taille,
      include: {
        customer: { select: { code: true, label1: true } },
        order: { select: { number: true } },
        warehouse: { select: { code: true, label: true } },
        lines: {
          orderBy: { lineNo: "asc" },
          include: { item: { select: { code: true, label1: true } } },
        },
        _count: { select: { invoices: true } },
      },
    }),
  ]);

  return { lignes, total, page, taille, pages: Math.max(1, Math.ceil(total / taille)) };
}

export async function listerFacturesClient(filtres: {
  statut?: "BROUILLON" | "VALIDEE" | "POSTEE" | "PARTIELLEMENT_REGLEE" | "REGLEE" | "EN_RETARD" | "ANNULEE";
  customerId?: number;
  page?: number;
  taille?: number;
}) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(200, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.InvoiceWhereInput = { direction: "CLIENT" };
  if (filtres.statut) where.status = filtres.statut;
  if (filtres.customerId) where.thirdPartyId = filtres.customerId;

  const [total, lignes] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: { invoiceDate: "desc" },
      skip: (page - 1) * taille,
      take: taille,
      include: {
        thirdParty: { select: { code: true, label1: true } },
        order: { select: { number: true } },
        delivery: { select: { number: true } },
        lines: { orderBy: { lineNo: "asc" } },
        allocations: { select: { amount: true, payment: { select: { number: true, method: true } } } },
      },
    }),
  ]);

  return { lignes, total, page, taille, pages: Math.max(1, Math.ceil(total / taille)) };
}

/** Commandes confirmees dont la production ou la livraison reste a faire. */
export async function commandesARelivrer(db: Db = prisma) {
  return db.salesOrder.findMany({
    where: {
      status: {
        in: ["CONFIRMEE", "PARTIELLEMENT_PRODUITE", "PRODUITE", "PARTIELLEMENT_LIVREE"],
      },
    },
    orderBy: [{ expectedDate: "asc" }, { orderDate: "asc" }],
    take: 100,
    include: {
      customer: { select: { code: true, label1: true } },
      lines: {
        orderBy: { lineNo: "asc" },
        include: { item: { select: { code: true, label1: true } } },
      },
      workOrders: { select: { number: true, status: true, quantityProduced: true, quantityPlanned: true } },
    },
  });
}

/** Bon de livraison dont la marchandise n'est pas entierement disponible. */
export async function livraisonsEnAttenteDeStock(db: Db = prisma) {
  const livraisons = await db.deliveryNote.findMany({
    where: { status: { in: ["BROUILLON", "PREPAREE"] } },
    orderBy: { deliveryDate: "asc" },
    take: 100,
    include: {
      customer: { select: { code: true, label1: true } },
      warehouse: { select: { code: true } },
      lines: { orderBy: { lineNo: "asc" }, include: { item: { select: { code: true, label1: true } } } },
    },
  });

  const resultats: {
    livraisonId: number;
    numero: string;
    client: string;
    lignes: { itemCode: string; demande: Decimal; disponible: Decimal; manquant: Decimal }[];
  }[] = [];

  for (const livraison of livraisons) {
    const lignes: { itemCode: string; demande: Decimal; disponible: Decimal; manquant: Decimal }[] = [];

    for (const ligne of livraison.lines) {
      const disponible = await disponibleArticle(ligne.itemId, livraison.warehouseId, db);
      const manquant = D.sub(D.of(ligne.quantityDelivered), disponible);
      if (D.gt(manquant, 0)) {
        lignes.push({
          itemCode: ligne.item.code,
          demande: D.of(ligne.quantityDelivered),
          disponible,
          manquant,
        });
      }
    }

    if (lignes.length > 0) {
      resultats.push({
        livraisonId: livraison.id,
        numero: livraison.number,
        client: livraison.customer.label1,
        lignes,
      });
    }
  }

  return resultats;
}

/** Indicateurs de vente destines au tableau de bord. */
export async function indicateursVentes(
  entrees: { dateDebut: Date; dateFin: Date },
  db: Db = prisma,
) {
  const [commandes, devis, livraisons, factures] = await Promise.all([
    db.salesOrder.findMany({
      where: { orderDate: { gte: entrees.dateDebut, lte: entrees.dateFin } },
      select: { status: true, totalTTC: true, expectedDate: true },
    }),
    db.quote.findMany({
      where: { quoteDate: { gte: entrees.dateDebut, lte: entrees.dateFin } },
      select: { status: true, totalTTC: true },
    }),
    db.deliveryNote.count({
      where: {
        deliveryDate: { gte: entrees.dateDebut, lte: entrees.dateFin },
        status: { not: "ANNULEE" },
      },
    }),
    db.invoice.findMany({
      where: {
        direction: "CLIENT",
        invoiceDate: { gte: entrees.dateDebut, lte: entrees.dateFin },
        status: { not: "ANNULEE" },
      },
      select: { totalTTC: true, paidAmount: true, nature: true, dueDate: true },
    }),
  ]);

  const maintenant = Date.now();
  const facturesVente = factures.filter((facture) => facture.nature === "FACTURE");
  const totalFacture = facturesVente.reduce((total, facture) => D.add(total, facture.totalTTC), D.ZERO);
  const totalEncaisse = facturesVente.reduce((total, facture) => D.add(total, facture.paidAmount), D.ZERO);

  const devisAcceptes = devis.filter((devis) => devis.status === "ACCEPTE" || devis.status === "CONVERTI");
  const devisPerdus = devis.filter((devis) => devis.status === "REFUSE" || devis.status === "EXPIRE");

  return {
    nombreDevis: devis.length,
    montantDevis: D.roundAmount(devis.reduce((total, d) => D.add(total, d.totalTTC), D.ZERO)),
    devisAcceptes: devisAcceptes.length,
    devisPerdus: devisPerdus.length,
    tauxConversionDevis: D.round(
      D.percent(devisAcceptes.length, devisAcceptes.length + devisPerdus.length),
      2,
    ),
    nombreCommandes: commandes.length,
    montantCommandes: D.roundAmount(
      commandes.reduce((total, commande) => D.add(total, commande.totalTTC), D.ZERO),
    ),
    commandesEnRetard: commandes.filter(
      (commande) =>
        commande.expectedDate !== null &&
        commande.expectedDate.getTime() < maintenant &&
        !["LIVREE", "FACTUREE", "CLOTUREE", "ANNULEE"].includes(commande.status),
    ).length,
    nombreLivraisons: livraisons,
    nombreFactures: facturesVente.length,
    montantFacture: D.roundAmount(totalFacture),
    montantEncaisse: D.roundAmount(totalEncaisse),
    resteAEncaisser: D.roundAmount(D.sub(totalFacture, totalEncaisse)),
    facturesEchues: facturesVente.filter(
      (facture) =>
        facture.dueDate !== null &&
        facture.dueDate.getTime() < maintenant &&
        D.gt(D.sub(D.of(facture.totalTTC), D.of(facture.paidAmount)), 0),
    ).length,
  };
}
