"use server";

import { revalidatePath } from "next/cache";
import type { QuoteStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { nonTrouve, validation } from "@/lib/errors";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  booleen,
  dateOuNull,
  decimalObligatoire,
  decimalOuNull,
  entierOu,
  executer,
  texteObligatoire,
  texteOuNull,
  type ResultatAction,
} from "@/lib/actions/resultat";
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
  preparerBonLivraison,
  reglerFactureClient,
  transformerDevisEnCommande,
  validerFactureClient,
  type LigneBonLivraisonInput,
  type LigneCommandeClientInput,
  type LigneDevisInput,
} from "@/lib/vente/service";

/**
 * Actions serveur du cycle de vente.
 *
 * Principes appliques ici, comme dans les autres modules :
 *  - le controle d'acces est refait cote serveur pour chaque action, avec la
 *    permission du geste metier et non celle de la page ;
 *  - aucune ecriture directe en base : tout passe par `@/lib/vente/service`,
 *    qui seul porte les regles (transitions de devis, sortie de stock FIFO,
 *    liberation qualite, facturation, reglements, avoirs) ;
 *  - tout motif exige par le service est transmis tel quel : le service reste
 *    seul juge de sa longueur minimale et de sa validite ;
 *  - les comptes rendus qui contiennent des echecs (generation d'ordres de
 *    fabrication) sont affiches ligne par ligne : jamais masques.
 */

/** Acteur transmis aux services : identite reelle de l'utilisateur connecte. */
async function acteurDe(permission: string): Promise<{ id: number; email: string }> {
  const utilisateur = await exigerPermission(permission);
  return { id: utilisateur.id, email: utilisateur.email };
}

/** Nombre de lignes declarees par un formulaire multi-lignes, borne superieurement. */
function nombreLignes(formData: FormData, maximum = 200): number {
  const declare = entierOu(formData.get("nombreLignes"), 0) ?? 0;
  return Math.min(Math.max(declare, 0), maximum);
}

const STATUTS_DEVIS: QuoteStatus[] = [
  "BROUILLON",
  "ENVOYE",
  "ACCEPTE",
  "REFUSE",
  "EXPIRE",
  "CONVERTI",
  "ANNULE",
];

const MODES_REGLEMENT = [
  "ESPECES",
  "CHEQUE",
  "VIREMENT",
  "TRAITE",
  "CARTE",
  "COMPENSATION",
  "AUTRE",
] as const;

type ModeReglement = (typeof MODES_REGLEMENT)[number];

/** Mode de reglement issu du formulaire : toute valeur inconnue est refusee. */
function modeReglement(valeur: string | null): ModeReglement {
  const trouve = MODES_REGLEMENT.find((mode) => mode === valeur);
  if (!trouve) {
    throw validation("Selectionnez un mode de reglement valide.");
  }
  return trouve;
}

// -----------------------------------------------------------------------------
// 1. Devis
// -----------------------------------------------------------------------------

export async function actionCreerDevis(formData: FormData): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.VENTE_DEVIS_CREER);

  return executer("Le devis a ete enregistre au statut brouillon.", async () => {
    const clientId = entierOu(formData.get("clientId"));
    if (!clientId) throw validation("Selectionnez le client du devis.");

    const lignes: LigneDevisInput[] = [];
    const total = nombreLignes(formData);
    for (let index = 0; index < total; index += 1) {
      const itemId = entierOu(formData.get(`ligne_${index}_itemId`));
      const quantite = decimalOuNull(formData.get(`ligne_${index}_quantite`));
      if (itemId === null && quantite === null) continue;
      if (itemId === null) {
        throw validation(`Ligne ${index + 1} : selectionnez un article vendable.`);
      }
      if (quantite === null) {
        throw validation(`Ligne ${index + 1} : la quantite est obligatoire.`);
      }
      lignes.push({
        itemId,
        quantity: quantite,
        unitCode: texteOuNull(formData.get(`ligne_${index}_unite`)),
        unitPrice: decimalObligatoire(
          formData.get(`ligne_${index}_prixUnitaire`),
          `Prix unitaire (ligne ${index + 1})`,
        ),
        discountRate: decimalOuNull(formData.get(`ligne_${index}_remise`)) ?? 0,
        vatRateCode: texteOuNull(formData.get(`ligne_${index}_codeTva`)),
        description: texteOuNull(formData.get(`ligne_${index}_description`)),
      });
    }

    const resultat = await creerDevis(
      {
        customerId: clientId,
        lines: lignes,
        quoteDate: dateOuNull(formData.get("dateDevis")) ?? undefined,
        validUntil: dateOuNull(formData.get("dateValidite")),
        discountRate: decimalOuNull(formData.get("remiseGlobale")) ?? 0,
        paymentTermsDays: entierOu(formData.get("conditionsReglement")) ?? undefined,
        currency: texteOuNull(formData.get("devise")) ?? undefined,
        notes: texteOuNull(formData.get("notes")),
      },
      acteur,
    );

    revalidatePath("/ventes/devis");

    return {
      id: resultat.quoteId,
      numero: resultat.numero,
      totalTTC: D.toFixed(resultat.totalTTC, 2),
    };
  });
}

export async function actionChangerStatutDevis(formData: FormData): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.VENTE_DEVIS_CREER);

  return executer("Le statut du devis a ete mis a jour.", async () => {
    const devisId = entierOu(formData.get("devisId"));
    if (!devisId) throw validation("Le devis est introuvable.");

    const statutBrut = texteObligatoire(formData.get("statut"), "Nouveau statut du devis");
    const statut = STATUTS_DEVIS.find((valeur) => valeur === statutBrut);
    if (!statut) {
      throw validation(`« ${statutBrut} » n'est pas un statut de devis valide.`);
    }

    const motif = texteOuNull(formData.get("motif"));
    // Le refus et l'annulation d'un devis sont des actes engages : le motif est
    // verifie ici, puis de nouveau par le service.
    if ((statut === "REFUSE" || statut === "ANNULE") && !motif) {
      throw validation("Un motif ecrit est obligatoire pour refuser ou annuler un devis.");
    }

    await changerStatutDevis({ quoteId: devisId, statut, motif }, acteur);

    revalidatePath("/ventes/devis");
    revalidatePath(`/ventes/devis/${devisId}`);
    return {};
  });
}

export async function actionTransformerDevisEnCommande(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.VENTE_COMMANDE_CREER);

  return executer(
    "Le devis accepte a ete transforme en commande client, au statut brouillon.",
    async () => {
      const devisId = entierOu(formData.get("devisId"));
      if (!devisId) throw validation("Le devis est introuvable.");

      const resultat = await transformerDevisEnCommande(
        {
          quoteId: devisId,
          orderDate: dateOuNull(formData.get("dateCommande")) ?? undefined,
          expectedDate: dateOuNull(formData.get("datePrevue")),
          deliveryAddress: texteOuNull(formData.get("adresseLivraison")),
          customerRef: texteOuNull(formData.get("referenceClient")),
          notes: texteOuNull(formData.get("notes")),
        },
        acteur,
      );

      revalidatePath("/ventes/devis");
      revalidatePath(`/ventes/devis/${devisId}`);
      revalidatePath("/ventes/commandes");

      return {
        id: resultat.orderId,
        numero: resultat.numero,
        totalTTC: D.toFixed(resultat.totalTTC, 2),
      };
    },
  );
}

// -----------------------------------------------------------------------------
// 2. Commandes client
// -----------------------------------------------------------------------------

export async function actionCreerCommandeClient(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.VENTE_COMMANDE_CREER);

  return executer(
    "La commande client a ete enregistree au statut brouillon.",
    async () => {
      const clientId = entierOu(formData.get("clientId"));
      if (!clientId) throw validation("Selectionnez le client de la commande.");

      const lignes: LigneCommandeClientInput[] = [];
      const total = nombreLignes(formData);
      for (let index = 0; index < total; index += 1) {
        const itemId = entierOu(formData.get(`ligne_${index}_itemId`));
        const quantite = decimalOuNull(formData.get(`ligne_${index}_quantite`));
        if (itemId === null && quantite === null) continue;
        if (itemId === null) {
          throw validation(`Ligne ${index + 1} : selectionnez un article vendable.`);
        }
        if (quantite === null) {
          throw validation(`Ligne ${index + 1} : la quantite est obligatoire.`);
        }
        lignes.push({
          itemId,
          quantity: quantite,
          unitCode: texteOuNull(formData.get(`ligne_${index}_unite`)),
          unitPrice: decimalObligatoire(
            formData.get(`ligne_${index}_prixUnitaire`),
            `Prix unitaire (ligne ${index + 1})`,
          ),
          discountRate: decimalOuNull(formData.get(`ligne_${index}_remise`)) ?? 0,
          vatRateCode: texteOuNull(formData.get(`ligne_${index}_codeTva`)),
          deliveryDate: dateOuNull(formData.get(`ligne_${index}_dateLivraison`)),
          description: texteOuNull(formData.get(`ligne_${index}_description`)),
          // Interrupteur explicite de la ligne : le service ne genere un ordre
          // de fabrication que si la ligne le demande, ou si la configuration
          // globale le prevoit.
          autoCreateWorkOrder: booleen(formData.get(`ligne_${index}_ordreAutomatique`)),
        });
      }

      const resultat = await creerCommandeClient(
        {
          customerId: clientId,
          lines: lignes,
          orderDate: dateOuNull(formData.get("dateCommande")) ?? undefined,
          expectedDate: dateOuNull(formData.get("datePrevue")),
          discountRate: decimalOuNull(formData.get("remiseGlobale")) ?? 0,
          paymentTermsDays: entierOu(formData.get("conditionsReglement")) ?? undefined,
          deliveryAddress: texteOuNull(formData.get("adresseLivraison")),
          customerRef: texteOuNull(formData.get("referenceClient")),
          currency: texteOuNull(formData.get("devise")) ?? undefined,
          notes: texteOuNull(formData.get("notes")),
        },
        acteur,
      );

      revalidatePath("/ventes/commandes");

      return {
        id: resultat.orderId,
        numero: resultat.numero,
        totalTTC: D.toFixed(resultat.totalTTC, 2),
      };
    },
  );
}

/**
 * Compte rendu de confirmation : les ordres crees et surtout les echecs sont
 * ecrits noir sur blanc, ligne par ligne. Une ligne dont l'ordre de fabrication
 * n'a pas pu etre genere doit etre traitee a la main : elle ne disparait jamais
 * du message.
 */
function composerCompteRenduConfirmation(resultat: {
  numero: string;
  ordresCrees: { numero: string; ligne: number; itemId: number }[];
  lignesEnEchec: { ligne: number; itemId: number; motif: string }[];
}): string {
  const parties: string[] = [`La commande ${resultat.numero} a ete confirmee.`];

  if (resultat.ordresCrees.length > 0) {
    parties.push(
      `${resultat.ordresCrees.length} ordre(s) de fabrication genere(s) : ${resultat.ordresCrees
        .map((ordre) => `${ordre.numero} (ligne ${ordre.ligne})`)
        .join(", ")}.`,
    );
  } else {
    parties.push("Aucun ordre de fabrication n'a ete genere.");
  }

  if (resultat.lignesEnEchec.length > 0) {
    parties.push(
      `Attention : ${resultat.lignesEnEchec.length} ligne(s) en echec, a traiter manuellement — ${resultat.lignesEnEchec
        .map((echec) => `ligne ${echec.ligne} (article ${echec.itemId}) : ${echec.motif}`)
        .join(" ; ")}.`,
    );
  }

  return parties.join(" ");
}

export async function actionConfirmerCommandeClient(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.VENTE_COMMANDE_CONFIRMER);

  const resultat = await executer(
    "La commande client a ete confirmee.",
    async () => {
      const commandeId = entierOu(formData.get("commandeId"));
      if (!commandeId) throw validation("La commande client est introuvable.");

      const compteRendu = await confirmerCommandeClient(
        {
          orderId: commandeId,
          sourceWarehouseId: entierOu(formData.get("depotSource")),
          targetWarehouseId: entierOu(formData.get("depotCible")),
          responsableId: entierOu(formData.get("responsableId")),
          motifException: texteOuNull(formData.get("motifException")),
        },
        acteur,
      );

      revalidatePath("/ventes/commandes");
      revalidatePath(`/ventes/commandes/${commandeId}`);
      revalidatePath("/production");

      return {
        numero: compteRendu.numero,
        ordresCrees: compteRendu.ordresCrees.map((ordre) => ({
          numero: ordre.numero,
          ligne: ordre.salesOrderLineId,
          itemId: ordre.itemId,
        })),
        lignesEnEchec: compteRendu.lignesEnEchec.map((echec) => ({
          ligne: echec.salesOrderLineId,
          itemId: echec.itemId,
          motif: echec.motif,
        })),
      };
    },
  );

  if (!resultat.ok) return resultat;

  // Le message de succes est reconstruit a partir du compte rendu reel renvoye
  // par le service : les ordres crees et les echecs sont tous deux affiches.
  return {
    ok: true,
    message: composerCompteRenduConfirmation({
      numero: resultat.numero,
      ordresCrees: resultat.ordresCrees,
      lignesEnEchec: resultat.lignesEnEchec,
    }),
  };
}

export async function actionAnnulerCommandeClient(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.VENTE_COMMANDE_CONFIRMER);

  return executer("La commande client a ete annulee.", async () => {
    const commandeId = entierOu(formData.get("commandeId"));
    if (!commandeId) throw validation("La commande client est introuvable.");
    const motif = texteObligatoire(formData.get("motif"), "Motif de l'annulation");

    await annulerCommandeClient({ orderId: commandeId, motif }, acteur);

    revalidatePath("/ventes/commandes");
    revalidatePath(`/ventes/commandes/${commandeId}`);
    return {};
  });
}

// -----------------------------------------------------------------------------
// 3. Bons de livraison
// -----------------------------------------------------------------------------

export async function actionCreerBonLivraison(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.VENTE_LIVRER);

  return executer(
    "Le bon de livraison a ete enregistre au statut brouillon. La marchandise n'est pas encore sortie du stock.",
    async () => {
      const clientId = entierOu(formData.get("clientId"));
      if (!clientId) throw validation("Le client du bon de livraison est introuvable.");

      const depotId = entierOu(formData.get("depotId"));
      if (!depotId) throw validation("Selectionnez le depot de depart.");

      // Seules les lignes portant une quantite strictement positive sont
      // livrees : une ligne laissee a zero n'est jamais corrigee d'office.
      const lignes: LigneBonLivraisonInput[] = [];
      const total = nombreLignes(formData);
      for (let index = 0; index < total; index += 1) {
        const itemId = entierOu(formData.get(`ligne_${index}_itemId`));
        if (itemId === null) continue;
        const quantite = decimalOuNull(formData.get(`ligne_${index}_quantite`));
        if (quantite === null || D.lte(quantite, 0)) continue;

        lignes.push({
          orderLineId: entierOu(formData.get(`ligne_${index}_orderLineId`)),
          itemId,
          quantity: quantite,
          unitPrice: decimalOuNull(formData.get(`ligne_${index}_prixUnitaire`)) ?? undefined,
          unitCode: texteOuNull(formData.get(`ligne_${index}_unite`)),
          notes: texteOuNull(formData.get(`ligne_${index}_note`)),
        });
      }

      if (lignes.length === 0) {
        throw validation("Saisissez la quantite a livrer d'au moins une ligne.");
      }

      const commandeId = entierOu(formData.get("commandeId"));

      const resultat = await creerBonLivraison(
        {
          customerId: clientId,
          warehouseId: depotId,
          orderId: commandeId,
          deliveryDate: dateOuNull(formData.get("dateLivraison")) ?? undefined,
          address: texteOuNull(formData.get("adresse")),
          carrier: texteOuNull(formData.get("transporteur")),
          customerRef: texteOuNull(formData.get("referenceClient")),
          notes: texteOuNull(formData.get("notes")),
          lines: lignes,
        },
        acteur,
      );

      revalidatePath("/ventes/livraisons");
      if (commandeId !== null) revalidatePath(`/ventes/commandes/${commandeId}`);

      return { id: resultat.deliveryId, numero: resultat.numero };
    },
  );
}

export async function actionPreparerBonLivraison(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.VENTE_LIVRER);

  return executer("Le bon de livraison a ete marque comme prepare.", async () => {
    const livraisonId = entierOu(formData.get("livraisonId"));
    if (!livraisonId) throw validation("Le bon de livraison est introuvable.");

    await preparerBonLivraison(livraisonId, acteur);

    revalidatePath("/ventes/livraisons");
    revalidatePath(`/ventes/livraisons/${livraisonId}`);
    return {};
  });
}

export async function actionExpedierBonLivraison(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.VENTE_LIVRER);

  const resultat = await executer(
    "Le bon de livraison a ete expedie ; la marchandise est sortie du stock.",
    async () => {
      const livraisonId = entierOu(formData.get("livraisonId"));
      if (!livraisonId) throw validation("Le bon de livraison est introuvable.");

      const compteRendu = await expedierBonLivraison(livraisonId, acteur);

      const commandeId = entierOu(formData.get("commandeId"));

      revalidatePath("/ventes/livraisons");
      revalidatePath(`/ventes/livraisons/${livraisonId}`);
      revalidatePath("/ventes/commandes");
      if (commandeId !== null) revalidatePath(`/ventes/commandes/${commandeId}`);

      return {
        numero: compteRendu.numero,
        mouvements: compteRendu.mouvements,
        coutTotal: D.toFixed(compteRendu.coutTotal, 2),
      };
    },
  );

  if (!resultat.ok) return resultat;

  return {
    ok: true,
    message: `Le bon de livraison ${resultat.numero} a ete expedie : ${resultat.mouvements} mouvement(s) de stock enregistre(s), cout de sortie valorise a ${resultat.coutTotal}.`,
  };
}

export async function actionLivrerBonLivraison(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.VENTE_LIVRER);

  return executer("Le bon de livraison a ete confirme comme livre au client.", async () => {
    const livraisonId = entierOu(formData.get("livraisonId"));
    if (!livraisonId) throw validation("Le bon de livraison est introuvable.");

    await livrerBonLivraison(
      {
        deliveryId: livraisonId,
        dateLivraison: dateOuNull(formData.get("dateLivraison")) ?? undefined,
        commentaire: texteOuNull(formData.get("commentaire")),
      },
      acteur,
    );

    revalidatePath("/ventes/livraisons");
    revalidatePath(`/ventes/livraisons/${livraisonId}`);
    revalidatePath("/ventes/commandes");
    return {};
  });
}

export async function actionAnnulerBonLivraison(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.VENTE_LIVRER);

  return executer(
    "Le bon de livraison a ete annule. Si la marchandise etait sortie, son retour en stock a ete enregistre.",
    async () => {
      const livraisonId = entierOu(formData.get("livraisonId"));
      if (!livraisonId) throw validation("Le bon de livraison est introuvable.");
      const motif = texteObligatoire(formData.get("motif"), "Motif de l'annulation");

      await annulerBonLivraison({ deliveryId: livraisonId, motif }, acteur);

      revalidatePath("/ventes/livraisons");
      revalidatePath(`/ventes/livraisons/${livraisonId}`);
      revalidatePath("/ventes/commandes");
      return {};
    },
  );
}

/**
 * Facture une livraison expediee. Le client n'est jamais repris du formulaire :
 * il est relu en base depuis la livraison, qui est la seule source fiable.
 */
export async function actionFacturerLivraison(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.VENTE_FACTURER);

  return executer(
    "La facture client a ete etablie a partir de la livraison, au statut brouillon.",
    async () => {
      const livraisonId = entierOu(formData.get("livraisonId"));
      if (!livraisonId) throw validation("Le bon de livraison est introuvable.");

      const livraison = await prisma.deliveryNote.findUnique({
        where: { id: livraisonId },
        select: { id: true, customerId: true },
      });
      if (!livraison) throw nonTrouve("Le bon de livraison");

      const resultat = await creerFactureClient(
        {
          customerId: livraison.customerId,
          deliveryId: livraison.id,
          invoiceDate: dateOuNull(formData.get("dateFacture")) ?? undefined,
          notes: texteOuNull(formData.get("notes")),
        },
        acteur,
      );

      revalidatePath("/ventes/livraisons");
      revalidatePath(`/ventes/livraisons/${livraisonId}`);
      revalidatePath("/ventes/factures");

      return {
        id: resultat.invoiceId,
        numero: resultat.numero,
        totalTTC: D.toFixed(resultat.totalTTC, 2),
      };
    },
  );
}

// -----------------------------------------------------------------------------
// 4. Factures client et reglements
// -----------------------------------------------------------------------------

export async function actionValiderFactureClient(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.VENTE_FACTURER);

  const resultat = await executer(
    "La facture client a ete validee et comptabilisee.",
    async () => {
      const factureId = entierOu(formData.get("factureId"));
      if (!factureId) throw validation("La facture client est introuvable.");

      const compteRendu = await validerFactureClient(
        {
          invoiceId: factureId,
          entryDate: dateOuNull(formData.get("dateEcriture")) ?? undefined,
        },
        acteur,
      );

      revalidatePath("/ventes/factures");
      revalidatePath(`/ventes/factures/${factureId}`);
      revalidatePath("/ventes/commandes");

      return { numero: compteRendu.numero, numeroEcriture: compteRendu.numeroEcriture };
    },
  );

  if (!resultat.ok) return resultat;

  return {
    ok: true,
    message: `La facture ${resultat.numero} a ete comptabilisee (ecriture ${resultat.numeroEcriture}).`,
  };
}

export async function actionReglerFactureClient(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.REGLEMENT_SAISIR);

  const resultat = await executer(
    "L'encaissement a ete enregistre et affecte a la facture.",
    async () => {
      const factureId = entierOu(formData.get("factureId"));
      if (!factureId) throw validation("La facture client est introuvable.");

      const montant = decimalOuNull(formData.get("montant"));

      const compteRendu = await reglerFactureClient(
        {
          invoiceId: factureId,
          // Un montant laisse vide signifie « le reste du » : c'est le service
          // qui le calcule, jamais l'interface.
          amount: montant ?? undefined,
          method: modeReglement(texteOuNull(formData.get("mode"))),
          paymentDate: dateOuNull(formData.get("datePaiement")) ?? undefined,
          reference: texteOuNull(formData.get("reference")),
          bankAccount: texteOuNull(formData.get("compteBancaire")),
        },
        acteur,
      );

      revalidatePath("/ventes/factures");
      revalidatePath(`/ventes/factures/${factureId}`);

      return {
        reglement: compteRendu.numero,
        montant: D.toFixed(compteRendu.montant, 2),
        montantAffecte: D.toFixed(compteRendu.montantAffecte, 2),
        numeroEcriture: compteRendu.numeroEcriture,
      };
    },
  );

  if (!resultat.ok) return resultat;

  return {
    ok: true,
    message: `L'encaissement ${resultat.reglement} de ${resultat.montantAffecte} a ete affecte a la facture (ecriture ${resultat.numeroEcriture}).`,
  };
}

export async function actionCreerAvoirClient(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.VENTE_FACTURER);

  return executer("L'avoir client a ete etabli sur la facture d'origine.", async () => {
    const factureId = entierOu(formData.get("factureId"));
    if (!factureId) throw validation("La facture d'origine est introuvable.");

    // L'avoir corrige une facture deja comptabilisee : son motif est exige par
    // le formulaire puis verifie une seconde fois par le service.
    const motif = texteObligatoire(formData.get("motif"), "Motif de l'avoir");

    const resultat = await creerAvoirClient(
      {
        invoiceId: factureId,
        montantHT: decimalObligatoire(formData.get("montantHT"), "Montant HT de l'avoir"),
        montantTVA: decimalOuNull(formData.get("montantTVA")) ?? 0,
        motif,
        invoiceDate: dateOuNull(formData.get("dateAvoir")) ?? undefined,
      },
      acteur,
    );

    revalidatePath("/ventes/factures");
    revalidatePath(`/ventes/factures/${factureId}`);

    return {
      id: resultat.invoiceId,
      numero: resultat.numero,
      totalTTC: D.toFixed(resultat.totalTTC, 2),
    };
  });
}
