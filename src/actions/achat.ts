"use server";

import { revalidatePath } from "next/cache";
import {
  annulerCommandeFournisseur,
  annulerReception,
  approuverCommandeFournisseur,
  approuverDemandeAchat,
  creerAvoirFournisseur,
  creerBonReception,
  creerCommandeFournisseur,
  enregistrerFactureFournisseur,
  refuserDemandeAchat,
  reglerFactureFournisseur,
  retourFournisseur,
  soumettreDemandeAchat,
  validerFactureFournisseur,
  type FactureFournisseurInput,
  type LigneCommandeFournisseurInput,
  type LigneReceptionInput,
} from "@/lib/achat/service";
import { D } from "@/lib/decimal";
import { validation } from "@/lib/errors";
import { CLE_PARAMETRE, lireParametreBooleen } from "@/lib/settings";
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

/**
 * Actions serveur du cycle achats.
 *
 * Principes appliques ici :
 *  - le controle d'acces est refait cote serveur pour chaque action, la
 *    permission etant celle du geste metier, pas celle de la page ;
 *  - aucun ecrit n'est fait directement en base : toutes les operations
 *    passent par `@/lib/achat/service`, qui porte les regles metier (separation
 *    des taches, rapprochement trois voies, mouvements de stock) ;
 *  - tout motif exigé par le service (refus, annulation, retour, avoir,
 *    justification d'ecart) est transmis tel quel : le service reste seul juge
 *    de la longueur minimale et de la validite.
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

function modeReglement(valeur: string | null): ModeReglement {
  const trouve = MODES_REGLEMENT.find((mode) => mode === valeur);
  if (!trouve) {
    throw validation("Selectionnez un mode de reglement valide.");
  }
  return trouve;
}

const STATUTS_STOCK_RETOUR = ["LIBRE", "QUARANTAINE", "BLOQUE", "REBUT"] as const;

type StatutStockRetour = (typeof STATUTS_STOCK_RETOUR)[number];

/**
 * Statut de stock a debiter lors d'un retour fournisseur. Toute valeur non
 * reconnue retombe sur la quarantaine : on ne retire jamais une marchandise
 * d'un statut disponible sans que l'operateur l'ait explicitement choisi.
 */
function statutStockRetour(valeur: string | null): StatutStockRetour {
  const trouve = STATUTS_STOCK_RETOUR.find((statut) => statut === valeur);
  return trouve ?? "QUARANTAINE";
}

// -----------------------------------------------------------------------------
// 1. Demandes d'achat
// -----------------------------------------------------------------------------

export async function actionSoumettreDemande(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.ACHAT_DEMANDE_CREER);

  return executer("La demande d'achat a ete soumise pour approbation.", async () => {
    const demandeId = entierOu(formData.get("demandeId"));
    if (!demandeId) throw validation("La demande d'achat est introuvable.");

    await soumettreDemandeAchat(demandeId, acteur);

    revalidatePath("/achats/demandes");
    revalidatePath(`/achats/demandes/${demandeId}`);
    return {};
  });
}

export async function actionApprouverDemande(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.ACHAT_COMMANDE_APPROUVER);

  return executer("La demande d'achat a ete approuvee.", async () => {
    const demandeId = entierOu(formData.get("demandeId"));
    if (!demandeId) throw validation("La demande d'achat est introuvable.");

    await approuverDemandeAchat(
      demandeId,
      acteur,
      texteOuNull(formData.get("commentaire")) ?? undefined,
    );

    revalidatePath("/achats/demandes");
    revalidatePath(`/achats/demandes/${demandeId}`);
    return {};
  });
}

export async function actionRefuserDemande(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.ACHAT_COMMANDE_APPROUVER);

  return executer("La demande d'achat a ete refusee.", async () => {
    const demandeId = entierOu(formData.get("demandeId"));
    if (!demandeId) throw validation("La demande d'achat est introuvable.");
    const motif = texteObligatoire(formData.get("motif"), "Motif du refus");

    await refuserDemandeAchat(demandeId, motif, acteur);

    revalidatePath("/achats/demandes");
    revalidatePath(`/achats/demandes/${demandeId}`);
    return {};
  });
}

// -----------------------------------------------------------------------------
// 2. Bons de commande fournisseur
// -----------------------------------------------------------------------------

export async function actionCreerCommandeFournisseur(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.ACHAT_COMMANDE_CREER);

  return executer(
    "Le bon de commande fournisseur a ete enregistre au statut brouillon.",
    async () => {
      const fournisseurId = entierOu(formData.get("fournisseurId"));
      if (!fournisseurId) throw validation("Selectionnez le fournisseur.");

      const demandeId = entierOu(formData.get("demandeId"));
      const depuisDemande = booleen(formData.get("depuisDemande")) && demandeId !== null;

      const lignes: LigneCommandeFournisseurInput[] = [];

      // Une commande issue d'une demande approuvee reprend ses lignes dans le
      // service : la saisie manuelle est alors inutile et n'est pas lue.
      if (!depuisDemande) {
        const total = nombreLignes(formData);
        for (let index = 0; index < total; index += 1) {
          const itemId = entierOu(formData.get(`ligne_${index}_itemId`));
          const quantite = decimalOuNull(formData.get(`ligne_${index}_quantite`));
          if (itemId === null && quantite === null) continue;
          if (itemId === null) {
            throw validation(`Ligne ${index + 1} : selectionnez un article.`);
          }
          if (quantite === null) {
            throw validation(`Ligne ${index + 1} : la quantite commandee est obligatoire.`);
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
            expectedDate: dateOuNull(formData.get(`ligne_${index}_datePrevue`)),
            description: texteOuNull(formData.get(`ligne_${index}_description`)),
          });
        }
      }

      const resultat = await creerCommandeFournisseur(
        {
          supplierId: fournisseurId,
          requestId: demandeId,
          depuisDemande: depuisDemande ? true : undefined,
          lines: lignes,
          orderDate: dateOuNull(formData.get("dateCommande")) ?? undefined,
          expectedDate: dateOuNull(formData.get("datePrevue")),
          discountRate: decimalOuNull(formData.get("remiseGlobale")) ?? 0,
          paymentTermsDays: entierOu(formData.get("conditionsReglement")) ?? 0,
          currency: texteOuNull(formData.get("devise")) ?? undefined,
          deliveryAddress: texteOuNull(formData.get("adresseLivraison")),
          notes: texteOuNull(formData.get("notes")),
        },
        acteur,
      );

      revalidatePath("/achats/commandes");
      if (demandeId !== null) revalidatePath(`/achats/demandes/${demandeId}`);

      return { id: resultat.orderId, numero: resultat.numero };
    },
  );
}

export async function actionApprouverCommandeFournisseur(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.ACHAT_COMMANDE_APPROUVER);

  return executer("Le bon de commande fournisseur a ete approuve.", async () => {
    const commandeId = entierOu(formData.get("commandeId"));
    if (!commandeId) throw validation("Le bon de commande est introuvable.");

    await approuverCommandeFournisseur(
      commandeId,
      acteur,
      texteOuNull(formData.get("commentaire")) ?? undefined,
    );

    revalidatePath("/achats/commandes");
    revalidatePath(`/achats/commandes/${commandeId}`);
    return {};
  });
}

export async function actionAnnulerCommandeFournisseur(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.ACHAT_COMMANDE_APPROUVER);

  return executer("Le bon de commande fournisseur a ete annule.", async () => {
    const commandeId = entierOu(formData.get("commandeId"));
    if (!commandeId) throw validation("Le bon de commande est introuvable.");
    const motif = texteObligatoire(formData.get("motif"), "Motif de l'annulation");

    await annulerCommandeFournisseur(commandeId, motif, acteur);

    revalidatePath("/achats/commandes");
    revalidatePath(`/achats/commandes/${commandeId}`);
    return {};
  });
}

// -----------------------------------------------------------------------------
// 3. Receptions fournisseur
// -----------------------------------------------------------------------------

export async function actionCreerBonReception(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.ACHAT_RECEPTIONNER);

  return executer(
    "La reception a ete enregistree ; les mouvements de stock ont ete generes.",
    async () => {
      const fournisseurId = entierOu(formData.get("fournisseurId"));
      if (!fournisseurId) throw validation("Le fournisseur de la reception est introuvable.");

      const depotId = entierOu(formData.get("depotId"));
      if (!depotId) throw validation("Selectionnez le depot de destination.");

      // Seules les lignes portant une quantite strictement positive sont
      // receptionnees : une ligne laissee a zero est consideree non livree,
      // elle n'est jamais corrigee d'office.
      const lignes: LigneReceptionInput[] = [];
      const total = nombreLignes(formData);
      for (let index = 0; index < total; index += 1) {
        const itemId = entierOu(formData.get(`ligne_${index}_itemId`));
        if (itemId === null) continue;
        const quantite = decimalOuNull(formData.get(`ligne_${index}_quantite`));
        if (quantite === null || D.lte(quantite, 0)) continue;

        lignes.push({
          orderLineId: entierOu(formData.get(`ligne_${index}_orderLineId`)),
          itemId,
          quantityReceived: quantite,
          lotNumber: texteOuNull(formData.get(`ligne_${index}_lot`)),
          locationId: entierOu(formData.get(`ligne_${index}_emplacement`)),
          unitCode: texteOuNull(formData.get(`ligne_${index}_unite`)),
          notes: texteOuNull(formData.get(`ligne_${index}_note`)),
        });
      }

      if (lignes.length === 0) {
        throw validation("Saisissez la quantite recue d'au moins une ligne.");
      }

      // Le controle qualitatif obligatoire est un parametre d'application : la
      // ligne ne peut jamais le desactiver, elle peut seulement le demander
      // lorsqu'il n'est pas obligatoire.
      const controleObligatoire = await lireParametreBooleen(
        CLE_PARAMETRE.QUALITE_CONTROLE_RECEPTION_OBLIGATOIRE,
        true,
      );
      const demandeControle = booleen(formData.get("controleQualitatif"));

      const resultat = await creerBonReception(
        {
          supplierId: fournisseurId,
          warehouseId: depotId,
          orderId: entierOu(formData.get("commandeId")),
          receiptDate: dateOuNull(formData.get("dateReception")) ?? undefined,
          deliveryNoteNumber: texteOuNull(formData.get("numeroBonLivraison")),
          qualityRequired: demandeControle ? true : controleObligatoire ? undefined : false,
          notes: texteOuNull(formData.get("notes")),
          lines: lignes,
        },
        acteur,
      );

      revalidatePath("/achats/receptions");
      const commandeId = entierOu(formData.get("commandeId"));
      if (commandeId !== null) revalidatePath(`/achats/commandes/${commandeId}`);

      return {
        id: resultat.receiptId,
        numero: resultat.numero,
        quantiteEnQuarantaine: D.toFixed(resultat.quantiteEnQuarantaine, 3),
      };
    },
  );
}

export async function actionAnnulerReception(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.ACHAT_RECEPTIONNER);

  return executer(
    "La reception a ete annulee : des mouvements de stock inverses ont ete enregistres.",
    async () => {
      const receptionId = entierOu(formData.get("receptionId"));
      if (!receptionId) throw validation("La reception est introuvable.");
      const motif = texteObligatoire(formData.get("motif"), "Motif de l'annulation");

      await annulerReception({ receiptId: receptionId, motif }, acteur);

      revalidatePath("/achats/receptions");
      revalidatePath(`/achats/receptions/${receptionId}`);
      revalidatePath("/achats/commandes");
      return {};
    },
  );
}

export async function actionRetourFournisseur(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.ACHAT_RECEPTIONNER);

  return executer(
    "Le retour fournisseur a ete enregistre : les quantites sont sorties du stock.",
    async () => {
      const fournisseurId = entierOu(formData.get("fournisseurId"));
      if (!fournisseurId) throw validation("Le fournisseur du retour est introuvable.");
      const depotId = entierOu(formData.get("depotId"));
      if (!depotId) throw validation("Le depot du retour est introuvable.");
      const motif = texteObligatoire(formData.get("motif"), "Motif du retour fournisseur");

      const lignes: {
        itemId: number;
        quantity: string;
        lotNumber: string | null;
        qualityStatus: StatutStockRetour;
        unitCost?: string;
      }[] = [];

      const total = nombreLignes(formData);
      for (let index = 0; index < total; index += 1) {
        const itemId = entierOu(formData.get(`ligne_${index}_itemId`));
        if (itemId === null) continue;
        const quantite = decimalOuNull(formData.get(`ligne_${index}_quantite`));
        if (quantite === null || D.lte(quantite, 0)) continue;

        lignes.push({
          itemId,
          quantity: quantite,
          lotNumber: texteOuNull(formData.get(`ligne_${index}_lot`)),
          qualityStatus: statutStockRetour(texteOuNull(formData.get(`ligne_${index}_statut`))),
          unitCost: decimalOuNull(formData.get(`ligne_${index}_cout`)) ?? undefined,
        });
      }

      if (lignes.length === 0) {
        throw validation("Saisissez la quantite a retourner d'au moins une ligne.");
      }

      const resultat = await retourFournisseur(
        {
          supplierId: fournisseurId,
          warehouseId: depotId,
          motif,
          documentOrigine: texteOuNull(formData.get("documentOrigine")),
          lines: lignes,
        },
        acteur,
      );

      revalidatePath("/achats/receptions");
      const receptionId = entierOu(formData.get("receptionId"));
      if (receptionId !== null) revalidatePath(`/achats/receptions/${receptionId}`);

      return { mouvements: resultat.movemementIds.length };
    },
  );
}

// -----------------------------------------------------------------------------
// 4. Factures fournisseur
// -----------------------------------------------------------------------------

export async function actionEnregistrerFactureFournisseur(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.ACHAT_FACTURE_SAISIR);

  return executer(
    "La facture fournisseur a ete enregistree. Les ecarts de rapprochement sont conserves tels quels.",
    async () => {
      const fournisseurId = entierOu(formData.get("fournisseurId"));
      if (!fournisseurId) throw validation("Selectionnez le fournisseur.");

      const referenceFournisseur = texteObligatoire(
        formData.get("referenceFournisseur"),
        "Reference de la facture fournisseur",
      );

      const lignes: FactureFournisseurInput["lines"] = [];
      const total = nombreLignes(formData);
      for (let index = 0; index < total; index += 1) {
        const itemId = entierOu(formData.get(`ligne_${index}_itemId`));
        const quantite = decimalOuNull(formData.get(`ligne_${index}_quantite`));
        if (itemId === null && quantite === null) continue;
        if (itemId === null) {
          throw validation(`Ligne ${index + 1} : l'article de la ligne est introuvable.`);
        }
        if (quantite === null) {
          throw validation(`Ligne ${index + 1} : la quantite facturee est obligatoire.`);
        }
        lignes.push({
          itemId,
          orderLineId: entierOu(formData.get(`ligne_${index}_orderLineId`)),
          // La ligne de reception est transmise lorsqu'elle est connue : le
          // rapprochement trois voies s'appuie alors sur la ligne exacte, sans
          // recherche approximative par article.
          receiptLineId: entierOu(formData.get(`ligne_${index}_receiptLineId`)),
          description: texteOuNull(formData.get(`ligne_${index}_description`)),
          quantity: quantite,
          unitPrice: decimalObligatoire(
            formData.get(`ligne_${index}_prixUnitaire`),
            `Prix unitaire (ligne ${index + 1})`,
          ),
          vatRateCode: texteOuNull(formData.get(`ligne_${index}_codeTva`)),
        });
      }

      if (lignes.length === 0) {
        throw validation("Saisissez au moins une ligne a facturer.");
      }

      const resultat = await enregistrerFactureFournisseur(
        {
          supplierId: fournisseurId,
          supplierRef: referenceFournisseur,
          orderId: entierOu(formData.get("commandeId")),
          receiptId: entierOu(formData.get("receptionId")),
          invoiceDate: dateOuNull(formData.get("dateFacture")) ?? undefined,
          dueDate: dateOuNull(formData.get("dateEcheance")),
          paymentTermsDays: entierOu(formData.get("conditionsReglement")) ?? undefined,
          currency: texteOuNull(formData.get("devise")) ?? undefined,
          notes: texteOuNull(formData.get("notes")),
          lines: lignes,
        },
        acteur,
      );

      revalidatePath("/achats/factures");

      return {
        id: resultat.supplierInvoiceId,
        numero: resultat.numero,
        rapprochementTroisVoies: resultat.rapprochementTroisVoies,
        nombreEcarts: resultat.ecarts.length,
      };
    },
  );
}

export async function actionValiderFactureFournisseur(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.ACHAT_TIERS_MATCHING);

  return executer(
    "La facture fournisseur a ete validee et comptabilisee.",
    async () => {
      const factureId = entierOu(formData.get("factureId"));
      if (!factureId) throw validation("La facture fournisseur est introuvable.");

      const resultat = await validerFactureFournisseur(
        {
          supplierInvoiceId: factureId,
          // La justification n'est lue que si l'operateur en a saisi une : le
          // service decide seul si elle est obligatoire (rapprochement non
          // conforme) et refuse la validation dans le cas contraire.
          justificationEcart: texteOuNull(formData.get("justificationEcart")),
          entryDate: dateOuNull(formData.get("dateEcriture")) ?? undefined,
        },
        acteur,
      );

      revalidatePath("/achats/factures");
      revalidatePath(`/achats/factures/${factureId}`);
      revalidatePath("/achats/commandes");

      return { numeroEcriture: resultat.numeroEcriture };
    },
  );
}

export async function actionReglerFactureFournisseur(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.REGLEMENT_SAISIR);

  return executer("Le reglement fournisseur a ete enregistre et affecte a la facture.", async () => {
    const factureId = entierOu(formData.get("factureId"));
    if (!factureId) throw validation("La facture fournisseur est introuvable.");

    const montant = decimalOuNull(formData.get("montant"));

    const resultat = await reglerFactureFournisseur(
      {
        supplierInvoiceId: factureId,
        method: modeReglement(texteOuNull(formData.get("mode"))),
        amount: montant ?? undefined,
        paymentDate: dateOuNull(formData.get("datePaiement")) ?? undefined,
        reference: texteOuNull(formData.get("reference")),
        bankAccount: texteOuNull(formData.get("compteBancaire")),
      },
      acteur,
    );

    revalidatePath("/achats/factures");
    revalidatePath(`/achats/factures/${factureId}`);

    return { reglement: resultat.numero };
  });
}

export async function actionCreerAvoirFournisseur(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await acteurDe(PERMISSIONS.ACHAT_FACTURE_SAISIR);

  return executer("L'avoir fournisseur a ete etabli sur la facture d'origine.", async () => {
    const factureId = entierOu(formData.get("factureId"));
    if (!factureId) throw validation("La facture fournisseur d'origine est introuvable.");

    const motif = texteObligatoire(formData.get("motif"), "Motif de l'avoir");

    const resultat = await creerAvoirFournisseur(
      {
        supplierInvoiceId: factureId,
        montantHT: decimalObligatoire(formData.get("montantHT"), "Montant HT de l'avoir"),
        montantTVA: decimalOuNull(formData.get("montantTVA")) ?? 0,
        motif,
        invoiceDate: dateOuNull(formData.get("dateAvoir")) ?? undefined,
      },
      acteur,
    );

    revalidatePath("/achats/factures");
    revalidatePath(`/achats/factures/${factureId}`);

    return { numero: resultat.numero, totalTTC: D.toFixed(resultat.totalTTC, 2) };
  });
}
