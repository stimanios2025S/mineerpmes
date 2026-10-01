/**
 * Tests d'integration du domaine Ventes.
 *
 * Ils s'executent contre la vraie base PostgreSQL de test : aucun service n'est
 * simule et chaque appel ecrit reellement les documents commerciaux, les
 * mouvements de stock, les ecritures comptables et le journal d'audit.
 *
 * Toutes les donnees creees portent le jeton PREFIXE et sont supprimees en fin
 * d'execution. Le referentiel du seed (depots, unites, taux de TVA, operations,
 * regles d'ecriture) est uniquement lu : il n'est jamais modifie.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { DomainError } from "@/lib/errors";
import {
  LIBELLES_MODE_REGLEMENT,
  LIBELLES_STATUT_COMMANDE_CLIENT,
  LIBELLES_STATUT_DEVIS,
  LIBELLES_STATUT_FACTURE,
  LIBELLES_STATUT_LIVRAISON,
  libelle,
} from "@/lib/libelles";
import {
  annulerOrdreFabrication,
  declarerProduction,
  demarrerOperation,
  lancerOrdreFabrication,
} from "@/lib/production/service";
import { libererProduitFini } from "@/lib/qualite/service";
import { disponibleArticle, enregistrerMouvement } from "@/lib/stock/service";
import { acteurTest, jeton, supprimerParPrefixe, type ActeurTest } from "@/tests/aide";
import {
  annulerBonLivraison,
  annulerCommandeClient,
  changerStatutDevis,
  confirmerCommandeClient,
  creerAvoirClient,
  creerBonLivraison,
  creerCommandeClient,
  creerDevis,
  creerFactureClient,
  expedierBonLivraison,
  livrerBonLivraison,
  livraisonsEnAttenteDeStock,
  preparerBonLivraison,
  reglerFactureClient,
  transformerDevisEnCommande,
  validerFactureClient,
} from "@/lib/vente/service";

/** Prefixe unique du fichier : toutes les donnees creees commencent par lui. */
const PREFIXE = jeton("TV");

let vendeur: ActeurTest;
let clientId = 0;
let depotVente = 0;
let depotProduitFini = 0;
let compteurArticle = 0;

const utilisateursCrees: number[] = [];

/** Renvoie la premiere ligne d'une liste, en echouant clairement si elle est vide. */
function premier<T>(valeurs: T[]): T {
  const valeur = valeurs[0];
  if (valeurs.length === 0 || valeur === undefined) {
    throw new Error("Aucune ligne trouvee : le test attend au moins un element.");
  }
  return valeur;
}

/** Attend une erreur metier et renvoie son code ; echoue si rien n'est leve. */
async function erreurAttendue(action: () => Promise<unknown>): Promise<DomainError> {
  try {
    await action();
  } catch (erreur) {
    if (erreur instanceof DomainError) return erreur;
    throw erreur;
  }
  throw new Error("Aucune erreur levee : le controle attendu n'a pas eu lieu.");
}

async function codeErreur(action: () => Promise<unknown>): Promise<string> {
  return (await erreurAttendue(action)).code;
}

/** Cree un article vendable de test, avec un code unique. */
async function creerArticle() {
  compteurArticle += 1;
  return prisma.item.create({
    data: {
      code: `${PREFIXE}-ART-${compteurArticle}`,
      label1: `Article vendu de test ${compteurArticle}`,
      type: "COMPOSANT",
      status: "ACTIF",
      unitCode: "PCS",
      taxRateCode: "TVA19",
      isPurchasable: true,
      isSellable: true,
    },
  });
}

/**
 * Cree un produit fini vendable et productible. La nomenclature active porte
 * l'operation COUPE du referentiel : l'ordre de fabrication est donc reellement
 * constructible par le service de production.
 */
async function creerProduitFini(
  options: {
    avecNomenclature?: boolean;
    avecGamme?: boolean;
    operations?: string[];
    factory?: "COMMUN" | "ADMEDCO";
  } = {},
) {
  compteurArticle += 1;
  const rang = compteurArticle;
  const composant = await creerArticle();

  const produit = await prisma.item.create({
    data: {
      code: `${PREFIXE}-PF-${rang}`,
      label1: `Produit fini de test ${rang}`,
      type: "PRODUIT_FINI",
      status: "ACTIF",
      unitCode: "PCS",
      taxRateCode: "TVA19",
      factory: options.factory ?? "COMMUN",
      isPurchasable: false,
      isSellable: true,
      isProducible: true,
    },
  });

  let formuleId: number | null = null;

  if (options.avecNomenclature ?? true) {
    const formule = await prisma.formula.create({
      data: {
        code: `${PREFIXE}-NOM-${rang}`,
        label: `Nomenclature de test ${rang}`,
        itemId: produit.id,
        version: 1,
        status: "ACTIVE",
        isDefault: true,
        warehouseProdId: depotVente,
        warehouseStoreId: depotProduitFini,
      },
    });
    await prisma.formulaLine.create({
      data: {
        formulaId: formule.id,
        lineNo: 1,
        componentItemId: composant.id,
        quantity: 2,
        unitCode: "PCS",
        operationCode: "COUPE",
      },
    });
    formuleId = formule.id;
  }

  if (options.avecGamme ?? (options.avecNomenclature ?? true)) {
    await creerGamme(produit.id, rang, options.operations ?? ["COUPE"]);
  }

  return { produit, composant, formuleId };
}

/**
 * Gamme reelle du produit : les operations viennent du referentiel, avec leurs
 * postes de travail. Elle est indispensable pour que la confirmation d'une
 * commande client genere un ordre de fabrication exploitable en atelier.
 */
async function creerGamme(itemId: number, rang: number, codes: string[]) {
  const operations = await prisma.operation.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  if (operations.length !== codes.length) {
    throw new Error(`Operations du referentiel introuvables : ${codes.join(", ")}`);
  }
  const operationParCode = new Map(operations.map((operation) => [operation.code, operation.id]));

  const postes = await prisma.workCenter.findMany({
    where: { code: { startsWith: "PT-" } },
    select: { id: true, code: true },
  });
  const posteParCode = new Map(postes.map((poste) => [poste.code.slice(3), poste.id]));

  return prisma.productRoute.create({
    data: {
      code: `${PREFIXE}-GAM-${rang}`,
      label: `Gamme de test ventes ${rang}`,
      itemId,
      version: 1,
      status: "ACTIVE",
      factory: "COMMUN",
      isDefault: true,
      steps: {
        create: codes.map((code, index) => ({
          stepNo: index + 1,
          operationId: operationParCode.get(code)!,
          workCenterId: posteParCode.get(code) ?? null,
          standardTimeMinutes: "1",
          isFinalStep: index === codes.length - 1,
        })),
      },
    },
    select: { id: true, code: true },
  });
}

/** Entree de stock reelle : le grand livre est ecrit, aucun solde n'est force. */
async function approvisionner(
  articleId: number,
  quantite: number,
  coutUnitaire = 60,
  warehouseId = depotVente,
) {
  return prisma.$transaction((tx) =>
    enregistrerMouvement(tx, {
      type: "ENTREE_INITIALE",
      itemId: articleId,
      warehouseId,
      status: "LIBRE",
      quantity: quantite,
      unitCost: coutUnitaire,
      unitCode: "PCS",
      comment: "Stock initial de test ventes",
      acteur: vendeur,
    }),
  );
}

/** Devis reel portant le jeton du fichier. */
async function creerDevisTest(articleId: number, quantite = 10, prix = 100) {
  return creerDevis(
    {
      customerId: clientId,
      lines: [{ itemId: articleId, quantity: quantite, unitPrice: prix, unitCode: "PCS" }],
    },
    vendeur,
  );
}

/** Devis envoye puis accepte, pret a etre converti. */
async function devisAccepte(articleId: number, quantite = 10, prix = 100) {
  const devis = await creerDevisTest(articleId, quantite, prix);
  await changerStatutDevis({ quoteId: devis.quoteId, statut: "ENVOYE" }, vendeur);
  await changerStatutDevis({ quoteId: devis.quoteId, statut: "ACCEPTE" }, vendeur);
  return devis;
}

/** Commande client confirmee, avec sa premiere ligne en base. */
async function creerCommandeConfirmee(articleId: number, quantite = 10, prix = 100) {
  const commande = await creerCommandeClient(
    {
      customerId: clientId,
      lines: [{ itemId: articleId, quantity: quantite, unitPrice: prix, unitCode: "PCS" }],
    },
    vendeur,
  );
  const confirmation = await confirmerCommandeClient(
    { orderId: commande.orderId, sourceWarehouseId: depotVente, targetWarehouseId: depotProduitFini },
    vendeur,
  );
  const enregistree = await prisma.salesOrder.findUniqueOrThrow({
    where: { id: commande.orderId },
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });

  return {
    orderId: commande.orderId,
    numero: commande.numero,
    totalTTC: commande.totalTTC,
    confirmation,
    commande: enregistree,
    ligne: premier(enregistree.lines),
  };
}

/** Bon de livraison prepare puis reellement expedie (sortie de stock reelle). */
async function bonLivraisonExpedie(options: {
  articleId: number;
  quantite: number;
  prix?: number;
  orderId?: number | null;
  orderLineId?: number | null;
  warehouseId?: number;
}) {
  const livraison = await creerBonLivraison(
    {
      customerId: clientId,
      warehouseId: options.warehouseId ?? depotVente,
      orderId: options.orderId ?? null,
      lines: [
        {
          orderLineId: options.orderLineId ?? null,
          itemId: options.articleId,
          quantity: options.quantite,
          unitPrice: options.prix,
        },
      ],
    },
    vendeur,
  );
  await preparerBonLivraison(livraison.deliveryId, vendeur);
  await expedierBonLivraison(livraison.deliveryId, vendeur);
  return livraison;
}

beforeAll(async () => {
  const depotMP = await prisma.warehouse.findUnique({ where: { code: "DEP-MP" } });
  if (!depotMP) throw new Error("Le depot DEP-MP du referentiel de test est introuvable.");
  depotVente = depotMP.id;

  const depotPF = await prisma.warehouse.findUnique({ where: { code: "DEP-PF" } });
  if (!depotPF) throw new Error("Le depot DEP-PF du referentiel de test est introuvable.");
  depotProduitFini = depotPF.id;

  vendeur = await acteurTest();
  utilisateursCrees.push(vendeur.id);

  const client = await prisma.thirdParty.create({
    data: {
      code: `${PREFIXE}-CLIENT`,
      label1: `Client de test ${PREFIXE}`,
      type: "CLIENT",
      isClient: true,
      isSupplier: false,
    },
  });
  clientId = client.id;
});

afterAll(async () => {
  const articles = await prisma.item.findMany({
    where: { code: { startsWith: PREFIXE } },
    select: { id: true },
  });
  const itemIds = articles.map((article) => article.id);

  const tiers = await prisma.thirdParty.findMany({
    where: { code: { startsWith: PREFIXE } },
    select: { id: true },
  });
  const tiersIds = tiers.map((partie) => partie.id);

  const livraisons = await prisma.deliveryNote.findMany({
    where: { customerId: { in: tiersIds } },
    select: { id: true },
  });
  const livraisonIds = livraisons.map((livraison) => livraison.id);

  const factures = await prisma.invoice.findMany({
    where: { thirdPartyId: { in: tiersIds } },
    select: { id: true },
  });
  const factureIds = factures.map((facture) => facture.id);

  const paiements = await prisma.payment.findMany({
    where: { thirdPartyId: { in: tiersIds } },
    select: { id: true },
  });
  const paiementIds = paiements.map((paiement) => paiement.id);

  // Qualite puis comptabilite : les ecritures precedent leurs pieces.
  await prisma.qualityCheck.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.nonConformity.deleteMany({ where: { itemId: { in: itemIds } } });

  await prisma.accountingEntry.deleteMany({
    where: {
      OR: [
        { invoiceId: { in: factureIds } },
        { paymentId: { in: paiementIds } },
        { documentType: "BON_LIVRAISON", documentId: { in: livraisonIds.map(String) } },
        { documentType: "FACTURE_CLIENT", documentId: { in: factureIds.map(String) } },
      ],
    },
  });
  await prisma.paymentAllocation.deleteMany({
    where: { OR: [{ paymentId: { in: paiementIds } }, { invoiceId: { in: factureIds } }] },
  });
  await prisma.payment.deleteMany({ where: { id: { in: paiementIds } } });
  await prisma.invoice.deleteMany({ where: { id: { in: factureIds } } });
  await prisma.deliveryNote.deleteMany({ where: { id: { in: livraisonIds } } });
  await prisma.salesOrder.deleteMany({ where: { customerId: { in: tiersIds } } });
  await prisma.quote.deleteMany({ where: { customerId: { in: tiersIds } } });

  // Ordres de fabrication, soldes, lots, mouvements et articles de test.
  await supprimerParPrefixe(PREFIXE);

  await prisma.thirdParty.deleteMany({ where: { id: { in: tiersIds } } });
  await prisma.user.deleteMany({ where: { id: { in: utilisateursCrees } } });
});

// -----------------------------------------------------------------------------
// Outils communs aux scenarios
// -----------------------------------------------------------------------------

const ANNEE = new Date().getFullYear();

/** Numero attendu pour une sequence : PREFIX-ANNEE-00000. */
function numeroAttendu(prefixe: string, taille: number): RegExp {
  return new RegExp(`^${prefixe}-${ANNEE}-\\d{${taille}}$`);
}

// -----------------------------------------------------------------------------
// Devis
// -----------------------------------------------------------------------------

describe("Devis client", () => {
  it("cree un devis numerote avec ses lignes, sa TVA et sa trace d'audit", async () => {
    const article = await creerArticle();
    const devis = await creerDevisTest(article.id, 10, 100);

    expect(devis.numero).toMatch(numeroAttendu("DEV", 4));
    expect(D.toFixed(devis.totalTTC, 2)).toBe("1190.00");

    const enregistre = await prisma.quote.findUniqueOrThrow({
      where: { id: devis.quoteId },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });

    expect(enregistre.status).toBe("BROUILLON");
    expect(enregistre.customerId).toBe(clientId);
    expect(enregistre.currency).toBe("DZD");
    expect(D.toFixed(enregistre.subtotalHT, 2)).toBe("1000.00");
    expect(D.toFixed(enregistre.vatAmount, 2)).toBe("190.00");
    expect(D.toFixed(enregistre.totalTTC, 2)).toBe("1190.00");

    expect(enregistre.lines).toHaveLength(1);
    expect(D.eq(enregistre.lines[0].quantity, D.of("10"))).toBe(true);
    expect(D.eq(enregistre.lines[0].unitPrice, D.of("100"))).toBe(true);
    expect(D.toFixed(enregistre.lines[0].lineTTC, 2)).toBe("1190.00");

    const trace = await prisma.auditLog.findFirst({
      where: { entity: "Quote", entityId: String(devis.quoteId), action: "CREATION" },
    });
    expect(trace?.userId).toBe(vendeur.id);
  });

  it("refuse un tiers qui n'est pas client et les saisies invalides", async () => {
    const article = await creerArticle();
    const fournisseur = await prisma.thirdParty.create({
      data: {
        code: `${PREFIXE}-TD-1`,
        label1: `Fournisseur de test ${PREFIXE}`,
        type: "FOURNISSEUR",
        isSupplier: true,
        isClient: false,
      },
    });

    expect(
      await codeErreur(() =>
        creerDevis(
          { customerId: fournisseur.id, lines: [{ itemId: article.id, quantity: 1, unitPrice: 10 }] },
          vendeur,
        ),
      ),
      "un devis ne peut pas viser un tiers qui n'est pas client",
    ).toBe("VALIDATION");

    expect(
      await codeErreur(() => creerDevis({ customerId: clientId, lines: [] }, vendeur)),
    ).toBe("VALIDATION");

    expect(await codeErreur(() => creerDevisTest(article.id, 0, 100))).toBe("VALIDATION");
    expect(await codeErreur(() => creerDevisTest(article.id, -5, 100))).toBe("VALIDATION");

    expect(
      await codeErreur(() =>
        creerDevis(
          {
            customerId: clientId,
            lines: [{ itemId: article.id, quantity: 1, unitPrice: 100 }],
            discountRate: 100,
          },
          vendeur,
        ),
      ),
    ).toBe("VALIDATION");

    const clientInconnu = await erreurAttendue(() =>
      creerDevis(
        { customerId: 999_999_999, lines: [{ itemId: article.id, quantity: 1, unitPrice: 10 }] },
        vendeur,
      ),
    );
    expect(clientInconnu.code).toBe("NON_TROUVE");
  });

  it("suit les transitions autorisees et exige un motif pour refuser", async () => {
    const article = await creerArticle();
    const devis = await creerDevisTest(article.id, 5, 200);

    // Un devis brouillon ne peut pas etre accepte sans avoir ete envoye.
    expect(
      await codeErreur(() => changerStatutDevis({ quoteId: devis.quoteId, statut: "ACCEPTE" }, vendeur)),
    ).toBe("CONFLIT");

    await changerStatutDevis({ quoteId: devis.quoteId, statut: "ENVOYE" }, vendeur);
    expect(
      await codeErreur(() => changerStatutDevis({ quoteId: devis.quoteId, statut: "REFUSE" }, vendeur)),
      "un refus sans motif est refuse",
    ).toBe("VALIDATION");

    await changerStatutDevis(
      { quoteId: devis.quoteId, statut: "REFUSE", motif: "Prix juge trop eleve par le client" },
      vendeur,
    );
    const refuse = await prisma.quote.findUniqueOrThrow({ where: { id: devis.quoteId } });
    expect(refuse.status).toBe("REFUSE");
    expect(refuse.notes).toContain("Prix juge trop eleve");

    // Aucune transition ne part d'un devis refuse.
    expect(
      await codeErreur(() => changerStatutDevis({ quoteId: devis.quoteId, statut: "ENVOYE" }, vendeur)),
    ).toBe("CONFLIT");
  });
});

// -----------------------------------------------------------------------------
// Conversion devis -> commande -> ordre de fabrication
// -----------------------------------------------------------------------------

describe("Conversion et confirmation", () => {
  it("convertit un devis accepte en commande en recopiant ses lignes", async () => {
    const article = await creerArticle();
    const devis = await devisAccepte(article.id, 10, 100);

    const commande = await transformerDevisEnCommande(
      { quoteId: devis.quoteId, expectedDate: new Date(Date.now() + 7 * 86_400_000) },
      vendeur,
    );
    expect(commande.numero).toMatch(numeroAttendu("CC", 5));

    const enregistree = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: commande.orderId },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
    expect(enregistree.status).toBe("BROUILLON");
    expect(enregistree.quoteId).toBe(devis.quoteId);
    expect(enregistree.lines).toHaveLength(1);
    expect(D.eq(enregistree.lines[0].quantity, D.of("10"))).toBe(true);
    expect(D.eq(enregistree.lines[0].unitPrice, D.of("100"))).toBe(true);
    expect(D.toFixed(enregistree.totalTTC, 2)).toBe("1190.00");

    // Le devis d'origine reste consultable et n'est jamais supprime.
    const apres = await prisma.quote.findUniqueOrThrow({ where: { id: devis.quoteId } });
    expect(apres.status).toBe("CONVERTI");
    expect(apres.convertedOrderId).toBe(commande.orderId);

    expect(
      await codeErreur(() => transformerDevisEnCommande({ quoteId: devis.quoteId }, vendeur)),
      "un devis ne peut pas etre converti deux fois",
    ).toBe("ETAT_INVALIDE");
  });

  it("refuse de convertir un devis qui n'est pas accepte", async () => {
    const article = await creerArticle();
    const devis = await creerDevisTest(article.id, 3, 100);

    expect(
      await codeErreur(() => transformerDevisEnCommande({ quoteId: devis.quoteId }, vendeur)),
    ).toBe("ETAT_INVALIDE");

    const enregistre = await prisma.quote.findUniqueOrThrow({ where: { id: devis.quoteId } });
    expect(enregistre.status).toBe("BROUILLON");
  });

  it("genere un ordre de fabrication a la confirmation et rapporte les echecs ligne par ligne", async () => {
    const fabricable = await creerProduitFini();
    const sansFabrication = await creerProduitFini({ avecNomenclature: false, avecGamme: false });

    const commande = await creerCommandeClient(
      {
        customerId: clientId,
        lines: [
          {
            itemId: fabricable.produit.id,
            quantity: 6,
            unitPrice: 500,
            unitCode: "PCS",
            autoCreateWorkOrder: true,
          },
          {
            itemId: sansFabrication.produit.id,
            quantity: 2,
            unitPrice: 300,
            unitCode: "PCS",
            autoCreateWorkOrder: true,
          },
        ],
      },
      vendeur,
    );

    const confirmation = await confirmerCommandeClient(
      { orderId: commande.orderId, sourceWarehouseId: depotVente, targetWarehouseId: depotProduitFini },
      vendeur,
    );

    expect(confirmation.ordresCrees).toHaveLength(1);
    expect(confirmation.lignesEnEchec, "l'echec est rapporte, jamais masque").toHaveLength(1);
    expect(confirmation.lignesEnEchec[0].itemId).toBe(sansFabrication.produit.id);
    expect(confirmation.lignesEnEchec[0].motif.toLowerCase()).toContain("nomenclature");

    const ordre = await prisma.workOrder.findUniqueOrThrow({
      where: { id: confirmation.ordresCrees[0].workOrderId },
    });
    expect(ordre.salesOrderId).toBe(commande.orderId);
    expect(ordre.itemId).toBe(fabricable.produit.id);
    expect(ordre.salesOrderLineId).not.toBeNull();
    expect(ordre.number).toMatch(numeroAttendu("OF", 5));
    expect(D.eq(ordre.quantityPlanned, D.of("6"))).toBe(true);

    const enregistree = await prisma.salesOrder.findUniqueOrThrow({ where: { id: commande.orderId } });
    expect(enregistree.status).toBe("CONFIRMEE");
    expect(enregistree.confirmedAt).not.toBeNull();

    // Une commande deja confirmee ne peut pas l'etre deux fois.
    expect(
      await codeErreur(() => confirmerCommandeClient({ orderId: commande.orderId }, vendeur)),
    ).toBe("CONFLIT");
  });

  it("annule une commande confirmee, puis refuse sa confirmation", async () => {
    const article = await creerArticle();
    const commande = await creerCommandeClient(
      {
        customerId: clientId,
        lines: [{ itemId: article.id, quantity: 1, unitPrice: 50, unitCode: "PCS" }],
      },
      vendeur,
    );

    expect(
      await codeErreur(() => annulerCommandeClient({ orderId: commande.orderId, motif: "non" }, vendeur)),
      "un motif trop court est refuse",
    ).toBe("VALIDATION");

    await annulerCommandeClient(
      { orderId: commande.orderId, motif: "Annulation demandee par le client" },
      vendeur,
    );

    const annulee = await prisma.salesOrder.findUniqueOrThrow({ where: { id: commande.orderId } });
    expect(annulee.status).toBe("ANNULEE");

    expect(
      await codeErreur(() => confirmerCommandeClient({ orderId: commande.orderId }, vendeur)),
    ).toBe("ETAT_INVALIDE");
  });

  it("l'ordre genere reste annulable et la commande demeure confirmee", async () => {
    const fabricable = await creerProduitFini();
    const commande = await creerCommandeClient(
      {
        customerId: clientId,
        lines: [
          {
            itemId: fabricable.produit.id,
            quantity: 2,
            unitPrice: 500,
            unitCode: "PCS",
            autoCreateWorkOrder: true,
          },
        ],
      },
      vendeur,
    );
    const confirmation = await confirmerCommandeClient(
      { orderId: commande.orderId, sourceWarehouseId: depotVente, targetWarehouseId: depotProduitFini },
      vendeur,
    );
    const ordreId = confirmation.ordresCrees[0].workOrderId;

    expect(
      await codeErreur(() => annulerOrdreFabrication(ordreId, "non", vendeur)),
      "un motif trop court est refuse",
    ).toBe("VALIDATION");

    await annulerOrdreFabrication(ordreId, "Commande reportee a la semaine prochaine", vendeur);

    const ordre = await prisma.workOrder.findUniqueOrThrow({ where: { id: ordreId } });
    expect(ordre.status).toBe("ANNULE");
    expect(D.isZero(D.of(ordre.quantityRemaining))).toBe(true);

    const operations = await prisma.workOrderOperation.findMany({ where: { workOrderId: ordreId } });
    expect(operations.length).toBeGreaterThan(0);
    expect(operations.every((operation) => operation.status === "ANNULEE")).toBe(true);

    const trace = await prisma.auditLog.findFirst({
      where: { entity: "WorkOrder", entityId: String(ordreId), action: "ANNULATION" },
    });
    expect(trace?.reason).toBe("Commande reportee a la semaine prochaine");
    expect(trace?.userId).toBe(vendeur.id);

    const commandeApres = await prisma.salesOrder.findUniqueOrThrow({ where: { id: commande.orderId } });
    expect(commandeApres.status).toBe("CONFIRMEE");
  });
});

// -----------------------------------------------------------------------------
// Bons de livraison et sortie de stock
// -----------------------------------------------------------------------------

describe("Bons de livraison", () => {
  it("prepare puis expedie un bon de livraison : le stock sort reellement", async () => {
    const article = await creerArticle();
    await approvisionner(article.id, 20, 100);

    const { orderId, ligne } = await creerCommandeConfirmee(article.id, 10, 100);
    const livraison = await creerBonLivraison(
      {
        customerId: clientId,
        warehouseId: depotVente,
        orderId,
        lines: [{ orderLineId: ligne.id, itemId: article.id, quantity: 6, unitPrice: 100 }],
      },
      vendeur,
    );

    expect(livraison.statut).toBe("BROUILLON");
    expect(livraison.numero).toMatch(numeroAttendu("BL", 5));

    await preparerBonLivraison(livraison.deliveryId, vendeur);
    const preparee = await prisma.deliveryNote.findUniqueOrThrow({
      where: { id: livraison.deliveryId },
    });
    expect(preparee.status).toBe("PREPAREE");

    const expedition = await expedierBonLivraison(livraison.deliveryId, vendeur);
    expect(expedition.mouvements).toBeGreaterThan(0);
    expect(D.gt(expedition.coutTotal, 0)).toBe(true);

    const expediee = await prisma.deliveryNote.findUniqueOrThrow({
      where: { id: livraison.deliveryId },
    });
    expect(expediee.status).toBe("EXPEDIEE");
    expect(expediee.qualityReleased).toBe(true);

    const mouvement = await prisma.stockMovement.findFirst({
      where: { documentType: "BON_LIVRAISON", documentId: String(livraison.deliveryId) },
    });
    expect(mouvement).not.toBeNull();
    expect(mouvement?.type).toBe("LIVRAISON_CLIENT");
    expect(D.eq(mouvement!.quantity, D.of("-6"))).toBe(true);
    expect(mouvement?.thirdPartyId).toBe(clientId);

    expect(D.eq(await disponibleArticle(article.id, depotVente), D.of("14"))).toBe(true);

    const ligneCommande = await prisma.salesOrderLine.findUniqueOrThrow({ where: { id: ligne.id } });
    expect(D.eq(ligneCommande.quantityDelivered, D.of("6"))).toBe(true);

    const commande = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(commande.status).toBe("PARTIELLEMENT_LIVREE");
  });

  it("refuse une expedition sans stock suffisant et signale le manquant", async () => {
    const article = await creerArticle();
    await approvisionner(article.id, 3, 100);

    const livraison = await creerBonLivraison(
      {
        customerId: clientId,
        warehouseId: depotVente,
        lines: [{ itemId: article.id, quantity: 10, unitPrice: 100 }],
      },
      vendeur,
    );
    await preparerBonLivraison(livraison.deliveryId, vendeur);

    const erreur = await erreurAttendue(() => expedierBonLivraison(livraison.deliveryId, vendeur));
    expect(erreur.code).toBe("ETAT_INVALIDE");
    expect(erreur.message).toContain("disponible");

    // Rien n'est sorti du stock et la livraison reste preparee.
    expect(
      await prisma.stockMovement.count({
        where: { documentType: "BON_LIVRAISON", documentId: String(livraison.deliveryId) },
      }),
    ).toBe(0);
    const apres = await prisma.deliveryNote.findUniqueOrThrow({ where: { id: livraison.deliveryId } });
    expect(apres.status).toBe("PREPAREE");

    const enAttente = await livraisonsEnAttenteDeStock();
    const ligneEnAttente = enAttente.find((element) => element.livraisonId === livraison.deliveryId);
    expect(ligneEnAttente).toBeDefined();
    expect(ligneEnAttente!.lignes[0].itemCode).toBe(article.code);
    expect(D.gt(ligneEnAttente!.lignes[0].manquant, 0)).toBe(true);
    expect(D.eq(ligneEnAttente!.lignes[0].manquant, D.of("7"))).toBe(true);
  });

  it("livre un bon de livraison expedie", async () => {
    const article = await creerArticle();
    await approvisionner(article.id, 5, 100);

    const { ligne } = await creerCommandeConfirmee(article.id, 5, 100);

    expect(
      await codeErreur(() =>
        livrerBonLivraison({ deliveryId: 999_999_999 }, vendeur),
      ),
    ).toBe("NON_TROUVE");

    const livraison = await bonLivraisonExpedie({
      articleId: article.id,
      quantite: 5,
      prix: 100,
      orderLineId: ligne.id,
    });

    await livrerBonLivraison(
      { deliveryId: livraison.deliveryId, commentaire: "Recu par le client" },
      vendeur,
    );

    const livree = await prisma.deliveryNote.findUniqueOrThrow({ where: { id: livraison.deliveryId } });
    expect(livree.status).toBe("LIVREE");
    expect(livree.notes).toContain("Recu par le client");

    expect(
      await codeErreur(() => livrerBonLivraison({ deliveryId: livraison.deliveryId }, vendeur)),
    ).toBe("CONFLIT");
  });

  it("annule une livraison expediee par retour en stock, sans effacer la sortie", async () => {
    const article = await creerArticle();
    await approvisionner(article.id, 20, 100);

    const livraison = await bonLivraisonExpedie({ articleId: article.id, quantite: 5, prix: 100 });
    expect(D.eq(await disponibleArticle(article.id, depotVente), D.of("15"))).toBe(true);

    expect(
      await codeErreur(() =>
        annulerBonLivraison({ deliveryId: livraison.deliveryId, motif: "court" }, vendeur),
      ),
    ).toBe("VALIDATION");

    await annulerBonLivraison(
      { deliveryId: livraison.deliveryId, motif: "Erreur de preparation du colis" },
      vendeur,
    );

    const annulee = await prisma.deliveryNote.findUniqueOrThrow({ where: { id: livraison.deliveryId } });
    expect(annulee.status).toBe("ANNULEE");

    const retour = await prisma.stockMovement.findFirst({
      where: {
        documentType: "BON_LIVRAISON",
        documentId: String(livraison.deliveryId),
        type: "RETOUR_CLIENT",
      },
    });
    expect(retour).not.toBeNull();
    expect(D.eq(retour!.quantity, D.of("5"))).toBe(true);

    // La sortie d'origine reste au grand livre : elle n'est jamais effacee.
    const sortie = await prisma.stockMovement.findFirst({
      where: {
        documentType: "BON_LIVRAISON",
        documentId: String(livraison.deliveryId),
        type: "LIVRAISON_CLIENT",
      },
    });
    expect(sortie).not.toBeNull();

    expect(D.eq(await disponibleArticle(article.id, depotVente), D.of("20"))).toBe(true);
  });

  it("n'annule pas une livraison deja facturee", async () => {
    const article = await creerArticle();
    await approvisionner(article.id, 10, 100);

    const livraison = await bonLivraisonExpedie({ articleId: article.id, quantite: 4, prix: 100 });
    const facture = await creerFactureClient(
      { customerId: clientId, deliveryId: livraison.deliveryId },
      vendeur,
    );

    const erreur = await erreurAttendue(() =>
      annulerBonLivraison(
        { deliveryId: livraison.deliveryId, motif: "Le client souhaite annuler" },
        vendeur,
      ),
    );
    expect(erreur.code).toBe("ETAT_INVALIDE");
    expect(erreur.message).toContain("avoir");

    const enregistree = await prisma.deliveryNote.findUniqueOrThrow({
      where: { id: livraison.deliveryId },
    });
    expect(enregistree.status).toBe("EXPEDIEE");
    expect(facture.numero).toMatch(numeroAttendu("FC", 5));
  });
});

// -----------------------------------------------------------------------------
// Qualite avant livraison
// -----------------------------------------------------------------------------

describe("Liberation qualite avant livraison", () => {
  it("interdit de livrer un produit fabrique non libere, puis l'autorise apres controle", async () => {
    const { produit, composant } = await creerProduitFini({ operations: ["COUPE", "MEULAGE"] });
    await approvisionner(composant.id, 100, 10);

    const commande = await creerCommandeClient(
      {
        customerId: clientId,
        lines: [
          {
            itemId: produit.id,
            quantity: 6,
            unitPrice: 900,
            unitCode: "PCS",
            autoCreateWorkOrder: true,
          },
        ],
      },
      vendeur,
    );
    const confirmation = await confirmerCommandeClient(
      { orderId: commande.orderId, sourceWarehouseId: depotVente, targetWarehouseId: depotProduitFini },
      vendeur,
    );
    expect(confirmation.ordresCrees).toHaveLength(1);
    const ordreId = confirmation.ordresCrees[0].workOrderId;

    const ligneCommande = await prisma.salesOrderLine.findFirstOrThrow({
      where: { orderId: commande.orderId },
    });
    const livraison = await creerBonLivraison(
      {
        customerId: clientId,
        warehouseId: depotProduitFini,
        orderId: commande.orderId,
        lines: [
          { orderLineId: ligneCommande.id, itemId: produit.id, quantity: 6, unitPrice: 900 },
        ],
      },
      vendeur,
    );
    await preparerBonLivraison(livraison.deliveryId, vendeur);

    // Le produit fini est produit en interne mais n'a pas encore ete libere par
    // la qualite : il ne peut pas partir chez le client.
    const bloquee = await erreurAttendue(() => expedierBonLivraison(livraison.deliveryId, vendeur));
    expect(bloquee.code).toBe("ETAT_INVALIDE");
    expect(bloquee.message).toContain("liberation qualite");
    expect(
      await prisma.stockMovement.count({
        where: { documentType: "BON_LIVRAISON", documentId: String(livraison.deliveryId) },
      }),
    ).toBe(0);

    // La fabrication est reellement executee en atelier.
    const lancement = await lancerOrdreFabrication(ordreId, vendeur);
    expect(lancement.matieres).toBeGreaterThan(0);

    const operation = await prisma.workOrderOperation.findFirstOrThrow({
      where: { workOrderId: ordreId },
      orderBy: { stepNo: "asc" },
    });
    await demarrerOperation({
      workOrderOperationId: operation.id,
      acteur: vendeur,
      commentaire: "Demarrage de la coupe",
    });
    const declaration = await declarerProduction({
      workOrderOperationId: operation.id,
      quantiteProduite: "6",
      quantiteConforme: "6",
      acteur: vendeur,
      commentaire: "Serie complete",
    });
    expect(D.eq(declaration.quantiteConforme, D.of("6"))).toBe(true);

    // Le controle final libere la quantite conforme : elle entre en stock.
    const liberation = await libererProduitFini({
      workOrderId: ordreId,
      quantiteLiberee: "6",
      acteur: vendeur,
      commentaire: "Controle final conforme",
    });
    expect(D.eq(liberation.quantiteLiberee, D.of("6"))).toBe(true);
    expect(liberation.decision).toBe("ACCEPTE");

    const ordre = await prisma.workOrder.findUniqueOrThrow({ where: { id: ordreId } });
    expect(ordre.qualityReleasedAt).not.toBeNull();

    const etatProduit = await prisma.stockMovement.findFirst({
      where: { itemId: produit.id, type: "PRODUCTION_PRODUIT_FINI" },
    });
    expect(etatProduit).not.toBeNull();

    // La marchandise liberee peut enfin etre livree.
    const expedition = await expedierBonLivraison(livraison.deliveryId, vendeur);
    expect(expedition.numero).toBe(livraison.numero);

    const expediee = await prisma.deliveryNote.findUniqueOrThrow({
      where: { id: livraison.deliveryId },
    });
    expect(expediee.status).toBe("EXPEDIEE");

    // Un ordre deja libere ne peut pas etre libere une seconde fois.
    expect(
      await codeErreur(() =>
        libererProduitFini({ workOrderId: ordreId, quantiteLiberee: "1", acteur: vendeur }),
      ),
    ).toBe("CONFLIT");
  });
});

// -----------------------------------------------------------------------------
// Facturation, reglement et avoir
// -----------------------------------------------------------------------------

describe("Facturation client", () => {
  it("facture un bon de livraison, le comptabilise et l'encaisse", async () => {
    const article = await creerArticle();
    await approvisionner(article.id, 10, 60);

    const livraison = await bonLivraisonExpedie({ articleId: article.id, quantite: 6, prix: 100 });
    const facture = await creerFactureClient(
      { customerId: clientId, deliveryId: livraison.deliveryId },
      vendeur,
    );
    expect(facture.numero).toMatch(numeroAttendu("FC", 5));

    const brouillon = await prisma.invoice.findUniqueOrThrow({
      where: { id: facture.invoiceId },
      include: { lines: true },
    });
    expect(brouillon.status).toBe("BROUILLON");
    expect(brouillon.direction).toBe("CLIENT");
    expect(brouillon.nature).toBe("FACTURE");
    expect(brouillon.deliveryId).toBe(livraison.deliveryId);
    expect(brouillon.lines).toHaveLength(1);
    expect(D.toFixed(brouillon.subtotalHT, 2)).toBe("600.00");
    expect(D.toFixed(brouillon.vatAmount, 2)).toBe("114.00");
    expect(D.toFixed(brouillon.totalTTC, 2)).toBe("714.00");

    // Aucun encaissement n'est possible avant la comptabilisation.
    expect(
      await codeErreur(() =>
        reglerFactureClient({ invoiceId: facture.invoiceId, method: "ESPECES" }, vendeur),
      ),
    ).toBe("ETAT_INVALIDE");

    const validation = await validerFactureClient({ invoiceId: facture.invoiceId }, vendeur);
    expect(validation.numero).toBe(facture.numero);
    expect(validation.numeroEcriture.length).toBeGreaterThan(0);

    const postee = await prisma.invoice.findUniqueOrThrow({ where: { id: facture.invoiceId } });
    expect(postee.status).toBe("POSTEE");
    expect(D.eq(postee.balance, D.of("714"))).toBe(true);

    const ecriture = await prisma.accountingEntry.findFirst({
      where: { documentType: "FACTURE_CLIENT", documentId: String(facture.invoiceId) },
    });
    expect(ecriture).not.toBeNull();
    expect(ecriture?.status).toBe("POSTEE");

    // Encaissement partiel, puis solde.
    await reglerFactureClient(
      { invoiceId: facture.invoiceId, method: "VIREMENT", amount: 300, reference: "VIR-001" },
      vendeur,
    );
    const partielle = await prisma.invoice.findUniqueOrThrow({ where: { id: facture.invoiceId } });
    expect(D.eq(partielle.paidAmount, D.of("300"))).toBe(true);
    expect(D.eq(partielle.balance, D.of("414"))).toBe(true);

    expect(
      await codeErreur(() =>
        reglerFactureClient({ invoiceId: facture.invoiceId, method: "ESPECES", amount: 500 }, vendeur),
      ),
      "un encaissement superieur au reste du est refuse",
    ).toBe("VALIDATION");

    await reglerFactureClient({ invoiceId: facture.invoiceId, method: "ESPECES" }, vendeur);
    const reglee = await prisma.invoice.findUniqueOrThrow({ where: { id: facture.invoiceId } });
    expect(D.eq(reglee.paidAmount, D.of("714"))).toBe(true);
    expect(D.eq(reglee.balance, D.ZERO)).toBe(true);

    const reglements = await prisma.payment.findMany({ where: { thirdPartyId: clientId } });
    expect(reglements.length).toBeGreaterThanOrEqual(2);

    expect(
      await codeErreur(() =>
        reglerFactureClient({ invoiceId: facture.invoiceId, method: "ESPECES", amount: 10 }, vendeur),
      ),
    ).toBe("CONFLIT");
  });

  it("refuse de facturer une livraison non expediee, puis deux fois la meme livraison", async () => {
    const article = await creerArticle();
    await approvisionner(article.id, 10, 60);

    const livraison = await creerBonLivraison(
      {
        customerId: clientId,
        warehouseId: depotVente,
        lines: [{ itemId: article.id, quantity: 2, unitPrice: 100 }],
      },
      vendeur,
    );

    expect(
      await codeErreur(() =>
        creerFactureClient({ customerId: clientId, deliveryId: livraison.deliveryId }, vendeur),
      ),
      "une livraison non expediee ne peut pas etre facturee",
    ).toBe("ETAT_INVALIDE");

    await preparerBonLivraison(livraison.deliveryId, vendeur);
    await expedierBonLivraison(livraison.deliveryId, vendeur);
    const facture = await creerFactureClient(
      { customerId: clientId, deliveryId: livraison.deliveryId },
      vendeur,
    );

    const doublon = await erreurAttendue(() =>
      creerFactureClient({ customerId: clientId, deliveryId: livraison.deliveryId }, vendeur),
    );
    expect(doublon.code).toBe("CONFLIT");
    expect(doublon.message).toContain("avoir");

    await validerFactureClient({ invoiceId: facture.invoiceId }, vendeur);
    expect(
      await codeErreur(() => validerFactureClient({ invoiceId: facture.invoiceId }, vendeur)),
      "une facture deja comptabilisee ne peut pas l'etre deux fois",
    ).toBe("CONFLIT");
  });

  it("etablit un avoir sur facture comptabilisee et refuse tout depassement", async () => {
    const article = await creerArticle();
    await approvisionner(article.id, 10, 60);

    const livraison = await bonLivraisonExpedie({ articleId: article.id, quantite: 2, prix: 100 });
    const facture = await creerFactureClient(
      { customerId: clientId, deliveryId: livraison.deliveryId },
      vendeur,
    );

    expect(
      await codeErreur(() =>
        creerAvoirClient(
          { invoiceId: facture.invoiceId, montantHT: 50, motif: "Remise commerciale" },
          vendeur,
        ),
      ),
      "un avoir ne peut pas preceder la comptabilisation de sa facture",
    ).toBe("ETAT_INVALIDE");

    await validerFactureClient({ invoiceId: facture.invoiceId }, vendeur);

    expect(
      await codeErreur(() =>
        creerAvoirClient(
          { invoiceId: facture.invoiceId, montantHT: 500, motif: "Erreur de tarification" },
          vendeur,
        ),
      ),
      "le cumul des avoirs ne peut pas depasser la facture",
    ).toBe("VALIDATION");

    const avoir = await creerAvoirClient(
      { invoiceId: facture.invoiceId, montantHT: 100, motif: "Remise accordee apres facturation" },
      vendeur,
    );
    expect(avoir.numero).toMatch(numeroAttendu("AC", 5));

    const enregistre = await prisma.invoice.findUniqueOrThrow({ where: { id: avoir.invoiceId } });
    expect(enregistre.nature).toBe("AVOIR");
    expect(enregistre.direction).toBe("CLIENT");
    expect(enregistre.originalInvoiceId).toBe(facture.invoiceId);
    expect(D.toFixed(enregistre.totalTTC, 2)).toBe("100.00");
    expect(D.eq(enregistre.balance, D.of("-100"))).toBe(true);

    // La facture d'origine reste intacte.
    const origine = await prisma.invoice.findUniqueOrThrow({ where: { id: facture.invoiceId } });
    expect(origine.status).toBe("POSTEE");
    expect(D.toFixed(origine.totalTTC, 2)).toBe("238.00");

    // Un avoir ne se regle pas.
    expect(
      await codeErreur(() =>
        reglerFactureClient({ invoiceId: avoir.invoiceId, method: "ESPECES" }, vendeur),
      ),
    ).toBe("ETAT_INVALIDE");
  });
});

// -----------------------------------------------------------------------------
// Libelles et protection du domaine
// -----------------------------------------------------------------------------

describe("Libelles francais et protection du domaine", () => {
  it("expose un libelle francais pour chaque statut et mode de reglement", () => {
    const tables: [string, Record<string, string>][] = [
      ["devis", LIBELLES_STATUT_DEVIS],
      ["commande client", LIBELLES_STATUT_COMMANDE_CLIENT],
      ["bon de livraison", LIBELLES_STATUT_LIVRAISON],
      ["facture", LIBELLES_STATUT_FACTURE],
      ["mode de reglement", LIBELLES_MODE_REGLEMENT],
    ];

    for (const [nom, table] of tables) {
      const entrees = Object.entries(table);
      expect(entrees.length, nom).toBeGreaterThan(0);

      for (const [code, texte] of entrees) {
        expect(texte.trim().length, `${nom}.${code}`).toBeGreaterThan(2);
        expect(texte, `${nom}.${code} ne doit pas afficher son code technique`).not.toBe(code);
      }
    }

    expect(libelle(LIBELLES_STATUT_LIVRAISON, "BROUILLON")).toBe("Brouillon");
    expect(libelle(LIBELLES_STATUT_LIVRAISON, "EXPEDIEE")).toBe("Expediee");
    expect(libelle(LIBELLES_STATUT_COMMANDE_CLIENT, "PARTIELLEMENT_LIVREE")).toContain(
      "Partiellement",
    );
    expect(libelle(LIBELLES_STATUT_DEVIS, "CONVERTI")).toContain("Converti");
    expect(libelle(LIBELLES_MODE_REGLEMENT, "VIREMENT")).toBe("Virement");
    expect(libelle(LIBELLES_STATUT_FACTURE, "POSTEE")).not.toBe("POSTEE");
  });

  it("n'expose aucune fonction de suppression ou de modification directe d'un document", async () => {
    const module = await import("@/lib/vente/service");

    for (const nom of Object.keys(module)) {
      expect(nom, `l'export ${nom} ne doit pas permettre d'effacer un document`).not.toMatch(
        /supprim|delete|remove|efface|purge/i,
      );
    }
  });
});
