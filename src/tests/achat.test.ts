/**
 * Tests d'integration du domaine Achats.
 *
 * Ils s'executent contre la vraie base PostgreSQL de test : aucun service n'est
 * simule et chaque appel ecrit reellement les documents, les mouvements de
 * stock, les ecritures comptables et le journal d'audit.
 *
 * Toutes les donnees creees portent le jeton PREFIXE et sont supprimees en fin
 * d'execution. Le referentiel du seed (depots, unites, taux de TVA, regles
 * d'ecriture) est uniquement lu : il n'est jamais modifie.
 */

import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { DomainError } from "@/lib/errors";
import {
  annulerCommandeFournisseur,
  annulerReception,
  approuverCommandeFournisseur,
  approuverDemandeAchat,
  creerAvoirFournisseur,
  creerBonReception,
  creerCommandeFournisseur,
  creerDemandeAchat,
  enregistrerFactureFournisseur,
  receptionsEnAttenteQualite,
  refuserDemandeAchat,
  reglerFactureFournisseur,
  retourFournisseur,
  soumettreDemandeAchat,
  validerFactureFournisseur,
} from "@/lib/achat/service";
import {
  LIBELLES_STATUT_COMMANDE_FOURNISSEUR,
  LIBELLES_STATUT_DEMANDE_ACHAT,
  LIBELLES_STATUT_FACTURE,
  LIBELLES_STATUT_RECEPTION,
  libelle,
} from "@/lib/libelles";
import { controlerReception } from "@/lib/qualite/service";
import { disponibleArticle, enregistrerMouvement } from "@/lib/stock/service";
import { acteurTest, jeton, supprimerParPrefixe, type ActeurTest } from "@/tests/aide";

/** Prefixe unique du fichier : toutes les donnees creees commencent par lui. */
const PREFIXE = jeton("TA");

let demandeur: ActeurTest;
let approbateur: ActeurTest;
let fournisseurId = 0;
let depotId = 0;
let compteurArticle = 0;

const demandesCreees: number[] = [];
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

/** Cree un article de test avec un code unique. */
async function creerArticle(
  proprietes: { isPurchasable?: boolean; isSellable?: boolean } = {},
) {
  compteurArticle += 1;
  return prisma.item.create({
    data: {
      code: `${PREFIXE}-ART-${compteurArticle}`,
      label1: `Article de test ${compteurArticle}`,
      type: "MATIERE_PREMIERE",
      status: "ACTIF",
      unitCode: "PCS",
      isPurchasable: proprietes.isPurchasable ?? true,
      isSellable: proprietes.isSellable ?? false,
    },
  });
}

/** Cree une demande d'achat reelle portant le jeton du fichier. */
async function creerDemandeTest(articleId: number, quantite = 10, prix = 100) {
  const demande = await creerDemandeAchat(
    {
      supplierId: fournisseurId,
      justification: "Reapprovisionnement de l'atelier metallurgie",
      lines: [{ itemId: articleId, quantity: quantite, estimatedPrice: prix, unitCode: "PCS" }],
    },
    demandeur,
  );
  demandesCreees.push(demande.requestId);
  return demande;
}

/** Cree une commande fournisseur approuvee (createur puis approbateur distincts). */
async function creerCommandeApprouvee(articleId: number, quantite: number, prix: number) {
  const commande = await creerCommandeFournisseur(
    {
      supplierId: fournisseurId,
      lines: [{ itemId: articleId, quantity: quantite, unitPrice: prix, unitCode: "PCS" }],
    },
    approbateur,
  );
  await approuverCommandeFournisseur(
    commande.orderId,
    demandeur,
    "Commande verifiee et validee par le service achats",
  );
  return prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: commande.orderId },
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });
}

/** Commande fournisseur entierement receptionnee (sans controle qualite bloquant). */
async function commanderEtReceptionner(articleId: number, quantite: number, prix: number) {
  const commande = await creerCommandeApprouvee(articleId, quantite, prix);
  const ligneCommande = premier(commande.lines);
  const reception = await creerBonReception(
    {
      supplierId: fournisseurId,
      warehouseId: depotId,
      orderId: commande.id,
      qualityRequired: false,
      lines: [
        {
          orderLineId: ligneCommande.id,
          itemId: articleId,
          quantityReceived: quantite,
          unitPrice: prix,
        },
      ],
    },
    demandeur,
  );
  const ligneReception = await prisma.goodsReceiptLine.findFirstOrThrow({
    where: { receiptId: reception.receiptId },
  });
  return { commande, ligneCommande, reception, ligneReception };
}

/** Reception soumise au controle qualite obligatoire (parametre seme a true). */
async function receptionnerEnControle(articleId: number, quantite: number, prix = 100) {
  const commande = await creerCommandeApprouvee(articleId, quantite, prix);
  const ligneCommande = premier(commande.lines);
  const reception = await creerBonReception(
    {
      supplierId: fournisseurId,
      warehouseId: depotId,
      orderId: commande.id,
      lines: [
        {
          orderLineId: ligneCommande.id,
          itemId: articleId,
          quantityReceived: quantite,
          unitPrice: prix,
        },
      ],
    },
    demandeur,
  );
  const ligneReception = await prisma.goodsReceiptLine.findFirstOrThrow({
    where: { receiptId: reception.receiptId },
  });
  return { commande, ligneCommande, reception, ligneReception };
}

/** Facture fournisseur conforme (trois voies alignees) puis comptabilisee. */
async function facturerEtValider(
  articleId: number,
  quantite: number,
  prix: number,
  reference: string,
) {
  const { commande, ligneCommande, reception, ligneReception } = await commanderEtReceptionner(
    articleId,
    quantite,
    prix,
  );
  const facture = await enregistrerFactureFournisseur(
    {
      supplierId: fournisseurId,
      supplierRef: `${PREFIXE}-${reference}`,
      orderId: commande.id,
      receiptId: reception.receiptId,
      lines: [
        {
          itemId: articleId,
          orderLineId: ligneCommande.id,
          receiptLineId: ligneReception.id,
          quantity: quantite,
          unitPrice: prix,
        },
      ],
    },
    demandeur,
  );
  return { commande, reception, facture };
}

beforeAll(async () => {
  const depot = await prisma.warehouse.findUnique({ where: { code: "DEP-MP" } });
  if (!depot) throw new Error("Le depot DEP-MP du referentiel de test est introuvable.");
  depotId = depot.id;

  demandeur = await acteurTest();
  approbateur = await acteurTest();
  utilisateursCrees.push(demandeur.id, approbateur.id);

  const fournisseur = await prisma.thirdParty.create({
    data: {
      code: `${PREFIXE}-FOURNISSEUR`,
      label1: `Fournisseur de test ${PREFIXE}`,
      type: "FOURNISSEUR",
      isSupplier: true,
      isClient: false,
    },
  });
  fournisseurId = fournisseur.id;
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

  const paiements = await prisma.payment.findMany({
    where: { thirdPartyId: { in: tiersIds } },
    select: { id: true },
  });
  const paiementIds = paiements.map((paiement) => paiement.id);

  const factures = await prisma.invoice.findMany({
    where: { thirdPartyId: { in: tiersIds } },
    select: { id: true },
  });
  const factureIds = factures.map((facture) => facture.id);

  // Les controles qualite et les non-conformites precedent les documents.
  await prisma.qualityCheck.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.nonConformity.deleteMany({ where: { itemId: { in: itemIds } } });

  await prisma.accountingEntry.deleteMany({
    where: { OR: [{ invoiceId: { in: factureIds } }, { paymentId: { in: paiementIds } }] },
  });
  await prisma.paymentAllocation.deleteMany({
    where: { OR: [{ paymentId: { in: paiementIds } }, { invoiceId: { in: factureIds } }] },
  });
  await prisma.payment.deleteMany({ where: { id: { in: paiementIds } } });
  await prisma.invoice.deleteMany({ where: { id: { in: factureIds } } });
  await prisma.supplierInvoice.deleteMany({ where: { supplierId: { in: tiersIds } } });
  await prisma.goodsReceipt.deleteMany({ where: { supplierId: { in: tiersIds } } });
  await prisma.purchaseOrder.deleteMany({ where: { supplierId: { in: tiersIds } } });
  await prisma.purchaseRequest.deleteMany({ where: { id: { in: demandesCreees } } });

  // Soldes, lots, mouvements et articles de test.
  await supprimerParPrefixe(PREFIXE);

  await prisma.thirdParty.deleteMany({ where: { id: { in: tiersIds } } });
  await prisma.user.deleteMany({ where: { id: { in: utilisateursCrees } } });
});

describe("Demandes d'achat", () => {
  it("cree, soumet et approuve une demande d'achat reelle", async () => {
    const article = await creerArticle();
    const demande = await creerDemandeTest(article.id);

    expect(demande.numero).toMatch(/^DA-\d{4}-\d{5}$/);

    const enregistree = await prisma.purchaseRequest.findUniqueOrThrow({
      where: { id: demande.requestId },
      include: { lines: true },
    });
    expect(enregistree.status).toBe("BROUILLON");
    expect(enregistree.requesterId).toBe(demandeur.id);
    expect(enregistree.lines).toHaveLength(1);
    expect(Number(premier(enregistree.lines).quantity)).toBe(10);

    await soumettreDemandeAchat(demande.requestId, demandeur);
    const soumise = await prisma.purchaseRequest.findUniqueOrThrow({
      where: { id: demande.requestId },
    });
    expect(soumise.status).toBe("SOUMISE");

    // Separation des taches : le demandeur ne peut pas approuver sa demande.
    expect(await codeErreur(() => approuverDemandeAchat(demande.requestId, demandeur))).toBe(
      "VALIDATION",
    );

    await approuverDemandeAchat(
      demande.requestId,
      approbateur,
      "Demande conforme au besoin de l'atelier",
    );
    const approuvee = await prisma.purchaseRequest.findUniqueOrThrow({
      where: { id: demande.requestId },
    });
    expect(approuvee.status).toBe("APPROUVEE");
    expect(approuvee.approvedById).toBe(approbateur.id);
    expect(approuvee.approvedAt).not.toBeNull();

    // Une demande deja approuvee ne peut pas l'etre une seconde fois.
    expect(await codeErreur(() => approuverDemandeAchat(demande.requestId, approbateur))).toBe(
      "CONFLIT",
    );
  });

  it("refuse une demande puis interdit son approbation", async () => {
    const article = await creerArticle();
    const demande = await creerDemandeTest(article.id, 4, 50);
    await soumettreDemandeAchat(demande.requestId, demandeur);

    // Le motif de refus est exige.
    expect(
      await codeErreur(() => refuserDemandeAchat(demande.requestId, "non", approbateur)),
    ).toBe("VALIDATION");

    await refuserDemandeAchat(
      demande.requestId,
      "Budget insuffisant sur cet exercice",
      approbateur,
    );
    const refusee = await prisma.purchaseRequest.findUniqueOrThrow({
      where: { id: demande.requestId },
    });
    expect(refusee.status).toBe("REFUSEE");

    expect(await codeErreur(() => approuverDemandeAchat(demande.requestId, approbateur))).toBe(
      "ETAT_INVALIDE",
    );
  });
});

describe("Commandes fournisseur", () => {
  it("convertit une demande approuvee en commande numerotee et calcule les montants", async () => {
    const article = await creerArticle();
    const demande = await creerDemandeTest(article.id, 10, 100);
    await soumettreDemandeAchat(demande.requestId, demandeur);
    await approuverDemandeAchat(demande.requestId, approbateur);

    const commande = await creerCommandeFournisseur(
      { supplierId: fournisseurId, requestId: demande.requestId, depuisDemande: true, lines: [] },
      approbateur,
    );
    expect(commande.numero).toMatch(/^CF-\d{4}-\d{5}$/);
    expect(D.toFixed(commande.totalTTC, 2)).toBe("1190.00");

    const enregistree = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: commande.orderId },
      include: { lines: true },
    });
    expect(enregistree.status).toBe("BROUILLON");
    expect(enregistree.createdById).toBe(approbateur.id);
    expect(D.toFixed(enregistree.subtotalHT, 2)).toBe("1000.00");
    expect(D.toFixed(enregistree.vatAmount, 2)).toBe("190.00");
    expect(D.toFixed(enregistree.totalTTC, 2)).toBe("1190.00");

    const ligne = premier(enregistree.lines);
    expect(Number(ligne.quantity)).toBe(10);
    expect(D.toFixed(ligne.unitPrice, 2)).toBe("100.00");
    expect(ligne.vatRateCode).toBe("TVA19");

    const demandeConvertie = await prisma.purchaseRequest.findUniqueOrThrow({
      where: { id: demande.requestId },
    });
    expect(demandeConvertie.status).toBe("CONVERTIE");

    // Le createur de la commande ne peut pas l'approuver lui-meme.
    expect(
      await codeErreur(() => approuverCommandeFournisseur(commande.orderId, approbateur)),
    ).toBe("VALIDATION");

    await approuverCommandeFournisseur(
      commande.orderId,
      demandeur,
      "Prix verifies par le service achats",
    );
    const approuvee = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: commande.orderId },
    });
    expect(approuvee.status).toBe("APPROUVE");
    expect(approuvee.approvedById).toBe(demandeur.id);
    expect(approuvee.approvedAt).not.toBeNull();

    // Une demande deja convertie n'alimente plus une seconde commande.
    expect(
      await codeErreur(() =>
        creerCommandeFournisseur(
          { supplierId: fournisseurId, requestId: demande.requestId, depuisDemande: true, lines: [] },
          approbateur,
        ),
      ),
    ).toBe("ETAT_INVALIDE");
  });

  it("annule un bon de commande non receptionne et protege l'etat annule", async () => {
    const article = await creerArticle();
    const commande = await creerCommandeApprouvee(article.id, 5, 20);

    expect(
      await codeErreur(() => annulerCommandeFournisseur(commande.id, "non", demandeur)),
    ).toBe("VALIDATION");

    await annulerCommandeFournisseur(
      commande.id,
      "Erreur de fournisseur sur le bon de commande",
      demandeur,
    );
    const annulee = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: commande.id } });
    expect(annulee.status).toBe("ANNULE");
    expect(annulee.notes).toContain("Erreur de fournisseur");

    expect(
      await codeErreur(() =>
        annulerCommandeFournisseur(commande.id, "Seconde annulation demandee", demandeur),
      ),
    ).toBe("CONFLIT");
  });
});

describe("Receptions fournisseur", () => {
  it("enregistre une reception partielle puis le solde, avec de vrais mouvements de stock", async () => {
    const article = await creerArticle();
    const commande = await creerCommandeApprouvee(article.id, 10, 100);
    const ligneCommande = premier(commande.lines);

    const partielle = await creerBonReception(
      {
        supplierId: fournisseurId,
        warehouseId: depotId,
        orderId: commande.id,
        qualityRequired: false,
        deliveryNoteNumber: `${PREFIXE}-BL-FOURNISSEUR`,
        lines: [
          {
            orderLineId: ligneCommande.id,
            itemId: article.id,
            quantityReceived: 4,
            unitPrice: 100,
          },
        ],
      },
      demandeur,
    );

    expect(partielle.numero).toMatch(/^BR-\d{4}-\d{5}$/);
    expect(partielle.statut).toBe("ACCEPTE");
    expect(Number(partielle.quantiteEnQuarantaine)).toBe(0);
    expect(Number(partielle.quantiteDisponible)).toBe(4);

    const ligneRecue = await prisma.goodsReceiptLine.findFirstOrThrow({
      where: { receiptId: partielle.receiptId },
    });
    expect(Number(ligneRecue.quantityReceived)).toBe(4);
    expect(ligneRecue.qualityStatus).toBe("LIBRE");
    expect(ligneRecue.movementId).not.toBeNull();

    const apresPartiel = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: commande.id },
      include: { lines: true },
    });
    expect(apresPartiel.status).toBe("PARTIELLEMENT_RECU");
    expect(Number(premier(apresPartiel.lines).quantityReceived)).toBe(4);

    const mouvement = await prisma.stockMovement.findFirstOrThrow({
      where: { itemId: article.id, documentNumber: partielle.numero },
    });
    expect(mouvement.type).toBe("RECEPTION_FOURNISSEUR");
    expect(Number(mouvement.quantity)).toBe(4);
    expect(mouvement.status).toBe("LIBRE");
    expect(mouvement.warehouseId).toBe(depotId);
    expect(mouvement.thirdPartyId).toBe(fournisseurId);
    expect(mouvement.documentType).toBe("BON_RECEPTION");

    const solde = await prisma.stockBalance.findFirstOrThrow({
      where: { itemId: article.id, warehouseId: depotId, status: "LIBRE" },
    });
    expect(Number(solde.quantityPhysical)).toBe(4);
    expect(Number(await disponibleArticle(article.id, depotId))).toBe(4);

    // Sur-reception refusee : 4 + 8 depasserait les 10 commandees.
    expect(
      await codeErreur(() =>
        creerBonReception(
          {
            supplierId: fournisseurId,
            warehouseId: depotId,
            orderId: commande.id,
            qualityRequired: false,
            lines: [
              {
                orderLineId: ligneCommande.id,
                itemId: article.id,
                quantityReceived: 8,
                unitPrice: 100,
              },
            ],
          },
          demandeur,
        ),
      ),
    ).toBe("VALIDATION");

    const soldeReception = await creerBonReception(
      {
        supplierId: fournisseurId,
        warehouseId: depotId,
        orderId: commande.id,
        qualityRequired: false,
        lines: [
          {
            orderLineId: ligneCommande.id,
            itemId: article.id,
            quantityReceived: 6,
            unitPrice: 100,
          },
        ],
      },
      demandeur,
    );
    expect(soldeReception.statut).toBe("ACCEPTE");

    const apresSolde = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: commande.id },
      include: { lines: true },
    });
    expect(apresSolde.status).toBe("RECU");
    expect(Number(premier(apresSolde.lines).quantityReceived)).toBe(10);
    expect(Number(await disponibleArticle(article.id, depotId))).toBe(10);
  });

  it("annule une reception par contre-passation sans effacer le mouvement d'origine", async () => {
    const article = await creerArticle();
    const { commande, ligneCommande, reception } = await commanderEtReceptionner(
      article.id,
      10,
      100,
    );

    const mouvementOrigine = await prisma.stockMovement.findFirstOrThrow({
      where: { itemId: article.id, type: "RECEPTION_FOURNISSEUR" },
    });
    expect(Number(mouvementOrigine.quantity)).toBe(10);

    expect(
      await codeErreur(() =>
        annulerReception({ receiptId: reception.receiptId, motif: "court" }, demandeur),
      ),
    ).toBe("VALIDATION");

    await annulerReception(
      { receiptId: reception.receiptId, motif: "Erreur de saisie sur la quantite recue" },
      demandeur,
    );

    const annulee = await prisma.goodsReceipt.findUniqueOrThrow({
      where: { id: reception.receiptId },
    });
    expect(annulee.status).toBe("ANNULE");

    // Le mouvement d'origine est conserve : rien n'est efface du grand livre.
    const origine = await prisma.stockMovement.findUnique({
      where: { id: mouvementOrigine.id },
    });
    expect(origine).not.toBeNull();
    expect(Number(origine?.quantity)).toBe(10);

    const contrePassation = await prisma.stockMovement.findFirstOrThrow({
      where: {
        itemId: article.id,
        type: "RETOUR_FOURNISSEUR",
        documentNumber: annulee.number,
      },
    });
    expect(Number(contrePassation.quantity)).toBe(-10);
    expect(Number(contrePassation.balanceAfter)).toBe(0);

    expect(Number(await disponibleArticle(article.id, depotId))).toBe(0);

    const commandeApres = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: commande.id },
      include: { lines: true },
    });
    expect(commandeApres.status).toBe("APPROUVE");
    expect(Number(premier(commandeApres.lines).quantityReceived)).toBe(0);
    expect(premier(commandeApres.lines).id).toBe(ligneCommande.id);

    expect(
      await codeErreur(() =>
        annulerReception(
          { receiptId: reception.receiptId, motif: "Nouvelle demande d'annulation" },
          demandeur,
        ),
      ),
    ).toBe("CONFLIT");
  });
});

describe("Controle qualite a la reception", () => {
  it("place la marchandise en quarantaine et la retrouve en attente de qualite", async () => {
    const article = await creerArticle();
    const { reception, ligneReception } = await receptionnerEnControle(article.id, 5);

    // Le controle qualite obligatoire est actif dans le referentiel.
    expect(reception.statut).toBe("EN_CONTROLE_QUALITE");
    expect(Number(reception.quantiteEnQuarantaine)).toBe(5);
    expect(Number(reception.quantiteDisponible)).toBe(0);
    expect(Number(ligneReception.quantityQuarantined)).toBe(5);
    expect(ligneReception.qualityStatus).toBe("QUARANTAINE");

    const mouvement = await prisma.stockMovement.findFirstOrThrow({
      where: { itemId: article.id, type: "RECEPTION_FOURNISSEUR" },
    });
    expect(mouvement.status).toBe("QUARANTAINE");
    expect(Number(await disponibleArticle(article.id, depotId))).toBe(0);

    const enAttente = await receptionsEnAttenteQualite();
    expect(enAttente.some((ligne) => ligne.id === reception.receiptId)).toBe(true);
  });

  it("libere la marchandise acceptee, qui devient consommable", async () => {
    const article = await creerArticle();
    const { ligneReception } = await receptionnerEnControle(article.id, 5);

    const resultat = await controlerReception({
      goodsReceiptLineId: ligneReception.id,
      quantityChecked: 5,
      quantityConform: 5,
      decision: "ACCEPTE",
      commentaire: "Controle dimensionnel conforme",
      acteur: demandeur,
    });

    expect(resultat.decision).toBe("ACCEPTE");
    expect(Number(resultat.quantiteLiberee)).toBe(5);
    expect(Number(resultat.quantiteRejetee)).toBe(0);

    const ligneApres = await prisma.goodsReceiptLine.findUniqueOrThrow({
      where: { id: ligneReception.id },
    });
    expect(ligneApres.qualityDecision).toBe("ACCEPTE");
    expect(ligneApres.qualityStatus).toBe("LIBRE");

    expect(Number(await disponibleArticle(article.id, depotId))).toBe(5);

    const quarantaine = await prisma.stockBalance.findFirst({
      where: { itemId: article.id, warehouseId: depotId, status: "QUARANTAINE" },
    });
    expect(Number(quarantaine?.quantityPhysical ?? 0)).toBe(0);

    const controle = await prisma.qualityCheck.findFirstOrThrow({
      where: { goodsReceiptLineId: ligneReception.id },
    });
    expect(controle.decision).toBe("ACCEPTE");
    expect(controle.result).toBe("CONFORME");
    expect(controle.number).toMatch(/^CQ-\d{4}-\d{5}$/);
  });

  it("accepte sous reserve en liberant tout de meme la marchandise", async () => {
    const article = await creerArticle();
    const { ligneReception } = await receptionnerEnControle(article.id, 4);

    const resultat = await controlerReception({
      goodsReceiptLineId: ligneReception.id,
      quantityChecked: 4,
      quantityConform: 4,
      decision: "ACCEPTE_SOUS_RESERVE",
      commentaire: "Ecart de peinture mineur accepte sous reserve",
      acteur: demandeur,
    });
    expect(resultat.decision).toBe("ACCEPTE_SOUS_RESERVE");
    expect(Number(resultat.quantiteLiberee)).toBe(4);
    expect(Number(await disponibleArticle(article.id, depotId))).toBe(4);

    const ligneApres = await prisma.goodsReceiptLine.findUniqueOrThrow({
      where: { id: ligneReception.id },
    });
    expect(ligneApres.qualityStatus).toBe("LIBRE");
    expect(ligneApres.qualityDecision).toBe("ACCEPTE_SOUS_RESERVE");
  });

  it("maintient en quarantaine une marchandise non jugee et ouvre une non-conformite", async () => {
    const article = await creerArticle();
    const { ligneReception } = await receptionnerEnControle(article.id, 5);

    const resultat = await controlerReception({
      goodsReceiptLineId: ligneReception.id,
      quantityChecked: 5,
      quantityConform: 0,
      decision: "QUARANTAINE",
      commentaire: "Analyse complementaire requise avant decision",
      acteur: demandeur,
    });
    expect(resultat.decision).toBe("QUARANTAINE");
    expect(Number(resultat.quantiteLiberee)).toBe(0);

    const ligneApres = await prisma.goodsReceiptLine.findUniqueOrThrow({
      where: { id: ligneReception.id },
    });
    expect(ligneApres.qualityStatus).toBe("QUARANTAINE");
    expect(ligneApres.qualityDecision).toBe("QUARANTAINE");

    // La marchandise reste indisponible a la consommation.
    expect(Number(await disponibleArticle(article.id, depotId))).toBe(0);
    const soldeQuarantaine = await prisma.stockBalance.findFirstOrThrow({
      where: { itemId: article.id, warehouseId: depotId, status: "QUARANTAINE" },
    });
    expect(Number(soldeQuarantaine.quantityPhysical)).toBe(5);

    const nonConformite = await prisma.nonConformity.findFirstOrThrow({
      where: { itemId: article.id, source: "RECEPTION" },
    });
    expect(nonConformite.status).toBe("OUVERTE");
    // La quantite mise en cause est tracee : la marchandise maintenue en
    // quarantaine est integralement portee par la non-conformite.
    expect(Number(nonConformite.quantity)).toBe(5);

    // Une sortie sur le stock libre est refusee faute de disponible...
    expect(
      await codeErreur(() =>
        prisma.$transaction((tx) =>
          enregistrerMouvement(tx, {
            type: "LIVRAISON_CLIENT",
            itemId: article.id,
            warehouseId: depotId,
            status: "LIBRE",
            quantity: -1,
            acteur: demandeur,
          }),
        ),
      ),
    ).toBe("STOCK_INSUFFISANT");

    // ... et une sortie directe depuis la quarantaine est refusee par principe.
    expect(
      await codeErreur(() =>
        prisma.$transaction((tx) =>
          enregistrerMouvement(tx, {
            type: "LIVRAISON_CLIENT",
            itemId: article.id,
            warehouseId: depotId,
            status: "QUARANTAINE",
            quantity: -1,
            acteur: demandeur,
          }),
        ),
      ),
    ).toBe("CONFLIT");
  });

  it("met au rebut une marchandise rejetee, jamais disponible a la consommation", async () => {
    const article = await creerArticle();
    const { ligneReception } = await receptionnerEnControle(article.id, 5);

    const resultat = await controlerReception({
      goodsReceiptLineId: ligneReception.id,
      quantityChecked: 5,
      quantityConform: 0,
      quantityRejected: 5,
      decision: "REJETE",
      commentaire: "Fissures constatees sur la totalite de la livraison",
      acteur: demandeur,
    });
    expect(resultat.decision).toBe("REJETE");
    expect(Number(resultat.quantiteRejetee)).toBe(5);
    expect(Number(resultat.quantiteLiberee)).toBe(0);

    const ligneApres = await prisma.goodsReceiptLine.findUniqueOrThrow({
      where: { id: ligneReception.id },
    });
    expect(ligneApres.qualityDecision).toBe("REJETE");
    expect(ligneApres.qualityStatus).toBe("REBUT");

    const soldeRebut = await prisma.stockBalance.findFirstOrThrow({
      where: { itemId: article.id, warehouseId: depotId, status: "REBUT" },
    });
    expect(Number(soldeRebut.quantityPhysical)).toBe(5);
    expect(Number(await disponibleArticle(article.id, depotId))).toBe(0);

    const nonConformite = await prisma.nonConformity.findFirstOrThrow({
      where: { itemId: article.id, source: "RECEPTION" },
    });
    expect(Number(nonConformite.quantity)).toBe(5);

    expect(
      await codeErreur(() =>
        prisma.$transaction((tx) =>
          enregistrerMouvement(tx, {
            type: "LIVRAISON_CLIENT",
            itemId: article.id,
            warehouseId: depotId,
            status: "LIBRE",
            quantity: -1,
            acteur: demandeur,
          }),
        ),
      ),
    ).toBe("STOCK_INSUFFISANT");
  });

  it("cloture l'entete de reception quand toutes les lignes sont decidees", async () => {
    const article = await creerArticle();
    const { reception, ligneReception } = await receptionnerEnControle(article.id, 3);

    // Une seule ligne, entierement acceptee : la reception quitte la liste des
    // receptions en attente de qualite et bascule au statut ACCEPTE.
    await controlerReception({
      goodsReceiptLineId: ligneReception.id,
      quantityChecked: 3,
      quantityConform: 3,
      decision: "ACCEPTE",
      commentaire: "Controle visuel conforme",
      acteur: demandeur,
    });

    const apres = await prisma.goodsReceipt.findUniqueOrThrow({
      where: { id: reception.receiptId },
    });
    expect(apres.status).toBe("ACCEPTE");

    const ligneApres = await prisma.goodsReceiptLine.findUniqueOrThrow({
      where: { id: ligneReception.id },
    });
    expect(ligneApres.qualityStatus).toBe("LIBRE");
    expect(ligneApres.qualityDecision).toBe("ACCEPTE");
    expect(Number(ligneApres.quantityAccepted)).toBe(3);
    expect(Number(ligneApres.quantityQuarantined)).toBe(0);

    // La reception ne figure plus dans les receptions a controler.
    const enAttente = await receptionsEnAttenteQualite();
    expect(enAttente.some((ligne) => ligne.id === reception.receiptId)).toBe(false);
  });
});

describe("Factures fournisseur et rapprochement trois voies", () => {
  it("rapproche les trois voies puis signale les ecarts sans les corriger en silence", async () => {
    const article = await creerArticle();
    const { commande, ligneCommande, reception, ligneReception } = await commanderEtReceptionner(
      article.id,
      10,
      100,
    );

    const conforme = await enregistrerFactureFournisseur(
      {
        supplierId: fournisseurId,
        supplierRef: `${PREFIXE}-FF-CONFORME`,
        orderId: commande.id,
        receiptId: reception.receiptId,
        lines: [
          {
            itemId: article.id,
            orderLineId: ligneCommande.id,
            receiptLineId: ligneReception.id,
            quantity: 10,
            unitPrice: 100,
          },
        ],
      },
      demandeur,
    );

    expect(conforme.numero).toMatch(/^FF-\d{4}-\d{5}$/);
    expect(conforme.rapprochementTroisVoies).toBe(true);
    expect(conforme.ecarts).toHaveLength(0);
    expect(D.toFixed(conforme.totalTTC, 2)).toBe("1190.00");

    const piece = await prisma.supplierInvoice.findUniqueOrThrow({
      where: { id: conforme.supplierInvoiceId },
      include: { invoice: true },
    });
    expect(piece.threeWayMatched).toBe(true);
    expect(piece.matchingNotes).toContain("conforme");
    expect(piece.invoice?.number).toBe(conforme.numero);

    // Facture discordante : prix different et quantite superieure au recu.
    const discordante = await enregistrerFactureFournisseur(
      {
        supplierId: fournisseurId,
        supplierRef: `${PREFIXE}-FF-ECART`,
        orderId: commande.id,
        receiptId: reception.receiptId,
        lines: [
          {
            itemId: article.id,
            orderLineId: ligneCommande.id,
            receiptLineId: ligneReception.id,
            quantity: 12,
            unitPrice: 110,
          },
        ],
      },
      demandeur,
    );

    expect(discordante.rapprochementTroisVoies).toBe(false);
    const types = discordante.ecarts.map((ecart) => ecart.type);
    expect(types).toContain("PRIX");
    expect(types).toContain("QUANTITE");
    expect(D.toFixed(discordante.totalTTC, 2)).toBe("1570.80");

    const pieceDiscordante = await prisma.supplierInvoice.findUniqueOrThrow({
      where: { id: discordante.supplierInvoiceId },
    });
    expect(pieceDiscordante.threeWayMatched).toBe(false);
    expect(pieceDiscordante.matchingNotes).toContain("[PRIX]");
    expect(pieceDiscordante.matchingNotes).toContain("[QUANTITE]");
    // L'ecart n'est jamais absorbe : la facture porte le montant reellement facture.
    expect(D.toFixed(pieceDiscordante.totalTTC, 2)).toBe("1570.80");
    expect(D.toFixed(commande.totalTTC, 2)).toBe("1190.00");

    // Une meme reference fournisseur ne peut pas etre enregistree deux fois.
    expect(
      await codeErreur(() =>
        enregistrerFactureFournisseur(
          {
            supplierId: fournisseurId,
            supplierRef: `${PREFIXE}-FF-ECART`,
            lines: [{ itemId: article.id, quantity: 1, unitPrice: 1 }],
          },
          demandeur,
        ),
      ),
    ).toBe("CONFLIT");

    // Une facture presentant un ecart ne peut pas etre comptabilisee sans
    // justification ecrite d'au moins dix caracteres.
    expect(
      await codeErreur(() =>
        validerFactureFournisseur({ supplierInvoiceId: discordante.supplierInvoiceId }, demandeur),
      ),
    ).toBe("VALIDATION");
    expect(
      await codeErreur(() =>
        validerFactureFournisseur(
          { supplierInvoiceId: discordante.supplierInvoiceId, justificationEcart: "ecart" },
          demandeur,
        ),
      ),
    ).toBe("VALIDATION");

    await validerFactureFournisseur(
      {
        supplierInvoiceId: discordante.supplierInvoiceId,
        justificationEcart: "Ecart de prix et de quantite accepte par le responsable achats",
      },
      demandeur,
    );

    const apresValidation = await prisma.supplierInvoice.findUniqueOrThrow({
      where: { id: discordante.supplierInvoiceId },
    });
    expect(apresValidation.status).toBe("POSTEE");
    // Les ecarts restent attaches au dossier : rien n'est masque.
    expect(apresValidation.matchingNotes).toContain("[PRIX]");
    expect(apresValidation.notes).toContain("Ecart de prix et de quantite accepte");

    const commandeApres = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: commande.id },
      include: { lines: true },
    });
    expect(Number(premier(commandeApres.lines).quantityInvoiced)).toBe(12);
    expect(commandeApres.status).toBe("FACTURE");
  });

  it("signale une facture sans commande et une marchandise encore en quarantaine", async () => {
    const article = await creerArticle();
    const articleEnControle = await creerArticle();

    const sansCommande = await enregistrerFactureFournisseur(
      {
        supplierId: fournisseurId,
        supplierRef: `${PREFIXE}-FF-SANS-CMD`,
        lines: [{ itemId: article.id, quantity: 1, unitPrice: 25 }],
      },
      demandeur,
    );
    expect(sansCommande.rapprochementTroisVoies).toBe(false);
    expect(sansCommande.ecarts.map((ecart) => ecart.type)).toContain("SANS_COMMANDE");

    const { commande, ligneCommande, reception, ligneReception } = await receptionnerEnControle(
      articleEnControle.id,
      5,
      100,
    );
    const factureQuarantaine = await enregistrerFactureFournisseur(
      {
        supplierId: fournisseurId,
        supplierRef: `${PREFIXE}-FF-QUARANTAINE`,
        orderId: commande.id,
        receiptId: reception.receiptId,
        lines: [
          {
            itemId: articleEnControle.id,
            orderLineId: ligneCommande.id,
            receiptLineId: ligneReception.id,
            quantity: 5,
            unitPrice: 100,
          },
        ],
      },
      demandeur,
    );

    expect(factureQuarantaine.rapprochementTroisVoies).toBe(false);
    expect(
      factureQuarantaine.ecarts.some(
        (ecart) => ecart.type === "SANS_RECEPTION" && ecart.detail.includes("quarantaine"),
      ),
    ).toBe(true);
  });
});

describe("Reglement fournisseur", () => {
  it("comptabilise la facture et protege le reglement", async () => {
    const article = await creerArticle();
    const { facture } = await facturerEtValider(article.id, 10, 100, "FF-REGLEMENT");

    // Aucun reglement n'est possible avant la comptabilisation de la facture.
    expect(
      await codeErreur(() =>
        reglerFactureFournisseur(
          { supplierInvoiceId: facture.supplierInvoiceId, method: "VIREMENT", amount: 100 },
          demandeur,
        ),
      ),
    ).toBe("ETAT_INVALIDE");

    const validation = await validerFactureFournisseur(
      { supplierInvoiceId: facture.supplierInvoiceId },
      demandeur,
    );
    expect(validation.numeroEcriture).toMatch(/^EC-\d{4}-\d{6}$/);

    const piece = await prisma.supplierInvoice.findUniqueOrThrow({
      where: { id: facture.supplierInvoiceId },
      include: { invoice: true },
    });
    expect(piece.status).toBe("POSTEE");
    expect(piece.postedAt).not.toBeNull();
    expect(piece.invoice).not.toBeNull();
    expect(piece.invoice?.status).toBe("POSTEE");
    expect(D.toFixed(piece.invoice?.balance, 2)).toBe("1190.00");

    const ecriture = await prisma.accountingEntry.findFirstOrThrow({
      where: { documentType: "FACTURE_FOURNISSEUR", documentId: String(piece.invoice?.id) },
    });
    expect(ecriture.number).toBe(validation.numeroEcriture);
    expect(ecriture.status).toBe("POSTEE");
    expect(ecriture.eventCode).toBe("FACTURE_FOURNISSEUR");
    expect(D.toFixed(ecriture.totalDebit, 2)).toBe("1190.00");
    expect(D.toFixed(ecriture.totalCredit, 2)).toBe("1190.00");

    expect(
      await codeErreur(() =>
        validerFactureFournisseur({ supplierInvoiceId: facture.supplierInvoiceId }, demandeur),
      ),
    ).toBe("CONFLIT");

    // Un reglement superieur au reste du est refuse avant toute ecriture.
    expect(
      await codeErreur(() =>
        reglerFactureFournisseur(
          { supplierInvoiceId: facture.supplierInvoiceId, method: "VIREMENT", amount: 5000 },
          demandeur,
        ),
      ),
    ).toBe("VALIDATION");
  });

  it("regle partiellement une facture fournisseur comptabilisee", async () => {
    const article = await creerArticle();
    const { facture } = await facturerEtValider(article.id, 10, 100, "FF-REGLEMENT-PARTIEL");
    await validerFactureFournisseur(
      { supplierInvoiceId: facture.supplierInvoiceId },
      demandeur,
    );

    // La facture est comptabilisee : un reglement partiel de 500 sur 1190 est
    // enregistre, valide et poste par le service de reglement.
    const reglement = await reglerFactureFournisseur(
      { supplierInvoiceId: facture.supplierInvoiceId, method: "VIREMENT", amount: 500 },
      demandeur,
    );
    expect(D.toFixed(reglement.montant, 2)).toBe("500.00");
    expect(D.toFixed(reglement.montantAffecte, 2)).toBe("500.00");

    // Le reglement est bien poste et son ecriture existe reellement.
    const paiement = await prisma.payment.findUniqueOrThrow({
      where: { id: reglement.paymentId },
    });
    expect(paiement.status).toBe("POSTE");
    expect(paiement.postedAt).not.toBeNull();
    expect(D.toFixed(paiement.amount, 2)).toBe("500.00");

    const ecriture = await prisma.accountingEntry.findFirstOrThrow({
      where: { documentType: "REGLEMENT", documentId: String(paiement.id) },
    });
    expect(ecriture.status).toBe("POSTEE");

    // La facture fournisseur passe en reglement partiel : 500 encaisses,
    // solde restant de 690.00 sur les 1190.00 initiaux.
    const partielle = await prisma.supplierInvoice.findUniqueOrThrow({
      where: { id: facture.supplierInvoiceId },
      include: { invoice: true },
    });
    expect(partielle.status).toBe("PARTIELLEMENT_REGLEE");
    expect(D.toFixed(partielle.paidAmount, 2)).toBe("500.00");
    expect(partielle.invoice?.status).toBe("PARTIELLEMENT_REGLEE");
    expect(D.toFixed(partielle.invoice?.balance, 2)).toBe("690.00");
  });
});

describe("Retours et avoirs fournisseur", () => {
  it("retourne de la marchandise au fournisseur : le stock diminue reellement", async () => {
    const article = await creerArticle();
    const { reception } = await commanderEtReceptionner(article.id, 10, 100);
    expect(Number(await disponibleArticle(article.id, depotId))).toBe(10);

    expect(
      await codeErreur(() =>
        retourFournisseur(
          {
            supplierId: fournisseurId,
            warehouseId: depotId,
            motif: "court",
            documentOrigine: reception.numero,
            lines: [{ itemId: article.id, quantity: 1, qualityStatus: "LIBRE" }],
          },
          demandeur,
        ),
      ),
    ).toBe("VALIDATION");

    const retour = await retourFournisseur(
      {
        supplierId: fournisseurId,
        warehouseId: depotId,
        motif: "Retour au fournisseur : defaut de soudure sur le lot",
        documentOrigine: reception.numero,
        lines: [{ itemId: article.id, quantity: 3, qualityStatus: "LIBRE", unitCost: 100 }],
      },
      demandeur,
    );
    expect(retour.movemementIds).toHaveLength(1);

    const mouvement = await prisma.stockMovement.findFirstOrThrow({
      where: { itemId: article.id, type: "RETOUR_FOURNISSEUR" },
    });
    expect(Number(mouvement.quantity)).toBe(-3);
    expect(mouvement.documentType).toBe("RETOUR_FOURNISSEUR");
    expect(mouvement.documentId).toBe(reception.numero);
    expect(mouvement.thirdPartyId).toBe(fournisseurId);

    // Le mouvement de reception d'origine est intact.
    const origine = await prisma.stockMovement.findFirstOrThrow({
      where: { itemId: article.id, type: "RECEPTION_FOURNISSEUR" },
    });
    expect(Number(origine.quantity)).toBe(10);
    expect(Number(await disponibleArticle(article.id, depotId))).toBe(7);

    // Un retour superieur au stock disponible est refuse.
    expect(
      await codeErreur(() =>
        retourFournisseur(
          {
            supplierId: fournisseurId,
            warehouseId: depotId,
            motif: "Retour de la totalite du stock disponible",
            lines: [{ itemId: article.id, quantity: 50, qualityStatus: "LIBRE" }],
          },
          demandeur,
        ),
      ),
    ).toBe("STOCK_INSUFFISANT");
  });

  it("etablit un avoir fournisseur rattache a la facture d'origine", async () => {
    const article = await creerArticle();
    const { commande, reception, facture } = await facturerEtValider(
      article.id,
      10,
      100,
      "FF-AVOIR",
    );

    // L'avoir ne peut pas preceder la comptabilisation de la facture.
    expect(
      await codeErreur(() =>
        creerAvoirFournisseur(
          {
            supplierInvoiceId: facture.supplierInvoiceId,
            montantHT: 100,
            motif: "Remise accordee par le fournisseur",
          },
          demandeur,
        ),
      ),
    ).toBe("ETAT_INVALIDE");

    await validerFactureFournisseur(
      { supplierInvoiceId: facture.supplierInvoiceId },
      demandeur,
    );

    const avoir = await creerAvoirFournisseur(
      {
        supplierInvoiceId: facture.supplierInvoiceId,
        montantHT: 150,
        montantTVA: 28.5,
        motif: "Remise commerciale sur facture",
      },
      demandeur,
    );

    expect(avoir.numero).toMatch(/^AF-\d{4}-\d{5}$/);
    expect(D.toFixed(avoir.totalTTC, 2)).toBe("178.50");

    const pieceAvoir = await prisma.invoice.findUniqueOrThrow({ where: { id: avoir.invoiceId } });
    const pieceOrigine = await prisma.invoice.findFirstOrThrow({
      where: { supplierInvoiceId: facture.supplierInvoiceId },
    });
    expect(pieceAvoir.nature).toBe("AVOIR");
    expect(pieceAvoir.direction).toBe("FOURNISSEUR");
    expect(pieceAvoir.originalInvoiceId).toBe(pieceOrigine.id);
    expect(D.toFixed(pieceAvoir.balance, 2)).toBe("-178.50");

    const avoirFournisseur = await prisma.supplierInvoice.findUniqueOrThrow({
      where: { id: avoir.supplierInvoiceId },
    });
    expect(avoirFournisseur.isCreditNote).toBe(true);
    expect(avoirFournisseur.status).toBe("POSTEE");
    expect(avoirFournisseur.threeWayMatched).toBe(true);
    expect(avoirFournisseur.supplierRef).toContain("AVOIR-");
    expect(avoirFournisseur.orderId).toBe(commande.id);
    expect(avoirFournisseur.receiptId).toBe(reception.receiptId);

    // Le cumul des avoirs ne peut pas depasser la facture d'origine.
    expect(
      await codeErreur(() =>
        creerAvoirFournisseur(
          {
            supplierInvoiceId: facture.supplierInvoiceId,
            montantHT: 2000,
            motif: "Avoir d'un montant superieur a la facture",
          },
          demandeur,
        ),
      ),
    ).toBe("VALIDATION");

    // Un avoir ne peut pas etre etabli sur un avoir.
    expect(
      await codeErreur(() =>
        creerAvoirFournisseur(
          {
            supplierInvoiceId: avoir.supplierInvoiceId,
            montantHT: 10,
            motif: "Avoir etabli sur un avoir",
          },
          demandeur,
        ),
      ),
    ).toBe("VALIDATION");

    // Un avoir ne genere aucun mouvement de stock.
    expect(await prisma.stockMovement.count({ where: { itemId: article.id } })).toBe(1);
  });
});

describe("Verrouillage des documents engages", () => {
  it("interdit d'annuler une commande receptionnee ou une reception facturee", async () => {
    const article = await creerArticle();
    const { commande, ligneCommande, reception, ligneReception } = await commanderEtReceptionner(
      article.id,
      10,
      100,
    );

    // Une commande deja receptionnee ne peut plus etre annulee.
    expect(
      await codeErreur(() =>
        annulerCommandeFournisseur(
          commande.id,
          "Annulation demandee par le service achats",
          demandeur,
        ),
      ),
    ).toBe("ETAT_INVALIDE");

    await enregistrerFactureFournisseur(
      {
        supplierId: fournisseurId,
        supplierRef: `${PREFIXE}-FF-VERROU`,
        orderId: commande.id,
        receiptId: reception.receiptId,
        lines: [
          {
            itemId: article.id,
            orderLineId: ligneCommande.id,
            receiptLineId: ligneReception.id,
            quantity: 10,
            unitPrice: 100,
          },
        ],
      },
      demandeur,
    );

    // Une reception facturee ne peut plus etre annulee.
    expect(
      await codeErreur(() =>
        annulerReception(
          { receiptId: reception.receiptId, motif: "Annulation apres facturation" },
          demandeur,
        ),
      ),
    ).toBe("ETAT_INVALIDE");
  });

  it("n'expose aucune fonction de modification ou de suppression d'un document d'achat", async () => {
    // Un document engage n'est jamais reecrit ni efface : il est contre-passe par
    // un nouveau document (retour, avoir, annulation avec contre-passation).
    const service = (await import("@/lib/achat/service")) as Record<string, unknown>;
    const mutations = Object.keys(service).filter((nom) =>
      /^(modifier|supprimer|mettreAJour|editer|effacer)/i.test(nom),
    );
    expect(mutations).toEqual([]);
  });
});

describe("Libelles francais des statuts", () => {
  it("expose un libelle francais pour chaque statut rencontre", () => {
    expect(libelle(LIBELLES_STATUT_DEMANDE_ACHAT, "APPROUVEE")).toBe("Approuvee");
    expect(libelle(LIBELLES_STATUT_COMMANDE_FOURNISSEUR, "PARTIELLEMENT_RECU")).toBe(
      "Partiellement recu",
    );
    expect(libelle(LIBELLES_STATUT_RECEPTION, "EN_CONTROLE_QUALITE")).toBe(
      "En controle qualite",
    );
    expect(libelle(LIBELLES_STATUT_FACTURE, "PARTIELLEMENT_REGLEE")).toBe(
      "Partiellement reglee",
    );

    for (const statut of [
      "BROUILLON",
      "SOUMISE",
      "APPROUVEE",
      "REFUSEE",
      "CONVERTIE",
      "ANNULEE",
    ]) {
      expect(LIBELLES_STATUT_DEMANDE_ACHAT[statut]).toBeTruthy();
    }
    for (const statut of [
      "BROUILLON",
      "SOUMIS",
      "APPROUVE",
      "PARTIELLEMENT_RECU",
      "RECU",
      "FACTURE",
      "CLOTURE",
      "ANNULE",
    ]) {
      expect(LIBELLES_STATUT_COMMANDE_FOURNISSEUR[statut]).toBeTruthy();
    }
    for (const statut of [
      "BROUILLON",
      "EN_CONTROLE_QUALITE",
      "ACCEPTE",
      "PARTIELLEMENT_ACCEPTE",
      "REJETE",
      "ANNULE",
    ]) {
      expect(LIBELLES_STATUT_RECEPTION[statut]).toBeTruthy();
    }
  });
});
