"use server";

import { revalidatePath } from "next/cache";
import type { MovementType, Prisma, StockStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { conflit, nonTrouve, validation } from "@/lib/errors";
import { aLaPermission, exigerPermissionEtUsine } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { prochainNumero, SEQUENCES } from "@/lib/numbering";
import {
  annulerMouvement,
  changerStatutStock,
  cleSolde,
  enregistrerInventaire,
  enregistrerMouvement,
  transfererStock,
  verrouillerSolde,
  type ActeurStock,
} from "@/lib/stock/service";
import {
  decimalObligatoire,
  entierOu,
  executer,
  texteObligatoire,
  texteOuNull,
  type ResultatAction,
} from "@/lib/actions/resultat";
import { LIBELLES_STATUT_STOCK, LIBELLES_TYPE_MOUVEMENT } from "@/lib/libelles";

/**
 * Actions serveur du module stock.
 *
 * Aucune quantite n'est ecrite directement dans `StockBalance` : toute
 * variation passe par le grand livre (`@/lib/stock/service`), qui cree
 * l'ecriture `StockMovement` et met a jour le solde dans la meme transaction.
 * Chaque action revalide la permission requise ET l'acces a la division du
 * depot concerne (`exigerPermissionEtUsine`) : masquer un bouton ne protege
 * rien, le controle est fait ici, avant toute lecture ou ecriture.
 */

/** Longueur minimale d'un motif ecrit : verifiee cote serveur. */
const MOTIF_MINIMUM = 10;

/**
 * Types de mouvement proposes pour une saisie manuelle d'entree.
 * Les types produits par les autres modules (production, achats, ventes) sont
 * volontairement exclus : ils doivent naitre de leur propre document.
 */
const TYPES_ENTREE_MANUELLE: readonly MovementType[] = [
  "ENTREE_INITIALE",
  "RECEPTION_FOURNISSEUR",
  "RETOUR_CLIENT",
];

/** Types de mouvement proposes pour une saisie manuelle de sortie. */
const TYPES_SORTIE_MANUELLE: readonly MovementType[] = [
  "SORTIE_PRODUCTION",
  "CONSOMMATION_OPERATION",
  "LIVRAISON_CLIENT",
  "RETOUR_FOURNISSEUR",
  "PERTE",
];

/**
 * Type d'ecriture associe a un changement de statut qualite.
 * Le grand livre ne possede pas de type dedie au blocage : `AJUSTEMENT` est le
 * type neutre des mouvements internes, et c'est le motif saisi, conserve dans
 * l'ecriture, qui porte le sens reel de l'operation.
 */
const TYPE_MOUVEMENT_STATUT: Record<StockStatus, MovementType> = {
  LIBRE: "LIBERATION_QUALITE",
  QUARANTAINE: "MISE_EN_QUARANTAINE",
  BLOQUE: "AJUSTEMENT",
  REBUT: "REBUT",
  EN_COURS_PRODUCTION: "AJUSTEMENT",
};

/** Rafraichit toutes les vues du module stock apres une ecriture. */
function rafraichirStock(): void {
  revalidatePath("/stock", "layout");
}

function acteurDe(utilisateur: { id: number; email: string }): ActeurStock {
  return { id: utilisateur.id, email: utilisateur.email };
}

function lireIdentifiant(
  formData: FormData,
  champ: string,
  libelleChamp: string,
): number {
  const identifiant = entierOu(formData.get(champ));
  if (identifiant === null) {
    throw validation(`Le champ « ${libelleChamp} » est obligatoire.`, {
      [champ]: "Selection obligatoire.",
    });
  }
  return identifiant;
}

/** Identifiant du grand livre : entier 64 bits, jamais converti en flottant. */
function lireIdentifiantMouvement(formData: FormData): bigint {
  const texte = texteObligatoire(formData.get("mouvementId"), "mouvement");
  if (!/^\d+$/.test(texte)) {
    throw validation("Le mouvement a annuler est introuvable.", {
      mouvementId: "Identifiant invalide.",
    });
  }
  return BigInt(texte);
}

/**
 * Verifie qu'une valeur de formulaire appartient bien a la liste de reference
 * francaise fournie. Une valeur inconnue est refusee, jamais remplacee par un
 * defaut silencieux.
 */
function choixObligatoire<T extends string>(
  valeur: string | null,
  table: Record<string, string>,
  libelleChamp: string,
): T {
  if (!valeur || !(valeur in table)) {
    throw validation(
      `Le champ « ${libelleChamp} » doit etre choisi dans la liste proposee.`,
      { [champLibelle(libelleChamp)]: "Valeur obligatoire ou inconnue." },
    );
  }
  return valeur as T;
}

/** Cle de champ utilisable comme identifiant de message d'erreur. */
function champLibelle(libelleChamp: string): string {
  return libelleChamp.replace(/[^A-Za-z0-9]+/g, "_");
}

function statutObligatoire(
  valeur: FormDataEntryValue | null,
  libelleChamp: string,
): StockStatus {
  return choixObligatoire<StockStatus>(
    texteOuNull(valeur),
    LIBELLES_STATUT_STOCK,
    libelleChamp,
  );
}

/**
 * Motif ecrit : les operations sensibles (correction, annulation, changement
 * de statut qualite) exigent une justification d'au moins dix caracteres,
 * controlee ici et non seulement par le navigateur.
 */
function motifObligatoire(
  valeur: FormDataEntryValue | null,
  libelleChamp: string,
): string {
  const motif = texteObligatoire(valeur, libelleChamp);
  if (motif.length < MOTIF_MINIMUM) {
    throw validation(
      `Le champ « ${libelleChamp} » doit comporter au moins ${MOTIF_MINIMUM} caracteres.`,
      { [champLibelle(libelleChamp)]: `Au moins ${MOTIF_MINIMUM} caracteres sont exiges.` },
    );
  }
  return motif;
}

/** Charge le depot puis verifie la permission et l'acces a sa division. */
async function depotAutorise(warehouseId: number, permission: string) {
  const depot = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, code: true, label: true, factory: true },
  });
  if (!depot) throw nonTrouve("Le depot");

  const utilisateur = await exigerPermissionEtUsine(permission, depot.factory);
  return { depot, utilisateur };
}

/**
 * Un emplacement appartient a un seul depot : accepter un emplacement etranger
 * ecrirait un solde sous une cle incoherente.
 */
async function verifierEmplacement(
  locationId: number | null,
  warehouseId: number,
  champ: string,
): Promise<void> {
  if (locationId === null) return;

  const emplacement = await prisma.location.findUnique({
    where: { id: locationId },
    select: { warehouseId: true },
  });
  if (!emplacement) throw nonTrouve("L'emplacement");
  if (emplacement.warehouseId !== warehouseId) {
    throw validation(
      "L'emplacement selectionne n'appartient pas au depot indique.",
      { [champ]: "Emplacement hors du depot." },
    );
  }
}

/**
 * Un lot est cree pour un article dans un depot donne : referencer un lot
 * etranger produirait un solde rattache a une matiere ou a un site qui n'est
 * pas le sien. Les transferts, eux, deplacement le lot de son depot d'origine
 * vers le depot de destination et ne sont donc pas soumis a ce controle.
 */
async function verifierLot(
  lotId: number | null,
  itemId: number,
  warehouseId: number,
  champ: string,
): Promise<void> {
  if (lotId === null) return;

  const lot = await prisma.stockLot.findUnique({
    where: { id: lotId },
    select: { lotNumber: true, itemId: true, warehouseId: true },
  });
  if (!lot) throw nonTrouve("Le lot");
  if (lot.itemId !== itemId) {
    throw validation(`Le lot ${lot.lotNumber} ne correspond pas a l'article selectionne.`, {
      [champ]: "Lot d'un autre article.",
    });
  }
  if (lot.warehouseId !== warehouseId) {
    throw validation(`Le lot ${lot.lotNumber} n'est pas rattache au depot indique.`, {
      [champ]: "Lot d'un autre depot.",
    });
  }
}

// -----------------------------------------------------------------------------
// Mouvements de stock
// -----------------------------------------------------------------------------

/**
 * Mouvement manuel d'entree ou de sortie.
 * Le sens est determine par le type choisi : l'operateur saisit toujours une
 * quantite positive, de sorte qu'aucune ecriture ne puisse etre inversee par
 * une double negation.
 */
export async function actionMouvementManuel(formData: FormData): Promise<ResultatAction> {
  return executer(
    "Le mouvement de stock a ete enregistre dans le grand livre.",
    async () => {
      const type = choixObligatoire<MovementType>(
        texteOuNull(formData.get("type")),
        LIBELLES_TYPE_MOUVEMENT,
        "type de mouvement",
      );

      const estSortie = TYPES_SORTIE_MANUELLE.includes(type);
      if (!estSortie && !TYPES_ENTREE_MANUELLE.includes(type)) {
        throw validation(
          "Ce type de mouvement n'est pas disponible en saisie manuelle : il doit naitre de son document d'origine.",
          { type: "Type non autorise en saisie manuelle." },
        );
      }

      const quantite = D.of(decimalObligatoire(formData.get("quantity"), "Quantite"));
      if (D.lte(quantite, 0)) {
        throw validation(
          "La quantite doit etre strictement positive : le sens du mouvement decoule du type choisi.",
          { quantity: "Quantite strictement positive exigee." },
        );
      }

      const justification = motifObligatoire(
        formData.get("justification"),
        "Justification du mouvement",
      );

      const itemId = lireIdentifiant(formData, "itemId", "L'article");
      const warehouseId = lireIdentifiant(formData, "warehouseId", "Le depot");
      const { depot, utilisateur } = await depotAutorise(
        warehouseId,
        PERMISSIONS.STOCK_MOUVEMENT_CREER,
      );

      const locationId = entierOu(formData.get("locationId"));
      const lotId = entierOu(formData.get("lotId"));
      const statut = statutObligatoire(formData.get("status"), "statut qualite");

      await verifierEmplacement(locationId, warehouseId, "locationId");
      await verifierLot(lotId, itemId, warehouseId, "lotId");

      const resultat = await prisma.$transaction((tx) =>
        enregistrerMouvement(tx, {
          type,
          itemId,
          warehouseId,
          locationId,
          lotId,
          status: statut,
          quantity: estSortie ? quantite.negated() : quantite,
          justification,
          comment: `${estSortie ? "Sortie" : "Entree"} manuelle dans le depot ${depot.code}`,
          acteur: acteurDe(utilisateur),
          autoriserNegatif: aLaPermission(
            utilisateur,
            PERMISSIONS.STOCK_NEGATIF_AUTORISER,
          ),
        }),
      );

      rafraichirStock();
      return {
        numero: resultat.numero,
        soldeApres: resultat.soldeApres.toFixed(6),
        disponibleApres: resultat.disponibleApres.toFixed(6),
      };
    },
  );
}

/**
 * Correction de stock : ecart signe applique au solde, toujours enregistre
 * comme un mouvement d'ajustement justifie. Le stock n'est jamais reecrit en
 * silence : l'ecart et son motif restent lisibles dans le grand livre.
 */
export async function actionCorrectionStock(formData: FormData): Promise<ResultatAction> {
  return executer(
    "La correction de stock a ete enregistree comme un mouvement d'ajustement.",
    async () => {
      const motif = motifObligatoire(formData.get("motif"), "Motif de la correction");

      const ecart = D.of(decimalObligatoire(formData.get("ecart"), "Ecart a appliquer"));
      if (ecart.isZero()) {
        throw validation(
          "Un ecart nul ne produit aucun mouvement : indiquez la quantite a ajouter (positive) ou a retirer (negative).",
          { ecart: "Ecart non nul exige." },
        );
      }

      const itemId = lireIdentifiant(formData, "itemId", "L'article");
      const warehouseId = lireIdentifiant(formData, "warehouseId", "Le depot");
      const { depot, utilisateur } = await depotAutorise(
        warehouseId,
        PERMISSIONS.STOCK_CORRECTION,
      );

      const locationId = entierOu(formData.get("locationId"));
      const lotId = entierOu(formData.get("lotId"));
      const statut = statutObligatoire(formData.get("status"), "statut qualite");

      await verifierEmplacement(locationId, warehouseId, "locationId");
      await verifierLot(lotId, itemId, warehouseId, "lotId");

      const resultat = await prisma.$transaction((tx) =>
        enregistrerMouvement(tx, {
          type: "AJUSTEMENT",
          itemId,
          warehouseId,
          locationId,
          lotId,
          status: statut,
          quantity: ecart,
          reason: motif,
          justification: motif,
          comment: `Correction de stock du depot ${depot.code}`,
          acteur: acteurDe(utilisateur),
          autoriserNegatif: aLaPermission(
            utilisateur,
            PERMISSIONS.STOCK_NEGATIF_AUTORISER,
          ),
          // Une correction ne revalorise pas le cout moyen : elle constate un
          // ecart de quantite, elle ne modifie pas le prix de la matiere.
          ignorerValorisation: true,
        }),
      );

      rafraichirStock();
      return {
        numero: resultat.numero,
        soldeApres: resultat.soldeApres.toFixed(6),
      };
    },
  );
}

/**
 * Annulation d'un mouvement : l'ecriture d'origine n'est jamais supprimee, elle
 * est contrepasssee par un mouvement inverse (`annulerMouvement`). Le motif
 * ecrit est exige ici puis revalide par le service.
 */
export async function actionAnnulerMouvement(formData: FormData): Promise<ResultatAction> {
  return executer(
    "Le mouvement a ete annule par une ecriture inverse auditee.",
    async () => {
      const motif = motifObligatoire(formData.get("motif"), "Motif d'annulation");
      const mouvementId = lireIdentifiantMouvement(formData);

      const mouvement = await prisma.stockMovement.findUnique({
        where: { id: mouvementId },
        select: {
          id: true,
          number: true,
          isReversal: true,
          warehouse: { select: { factory: true } },
          reverses: { select: { number: true } },
        },
      });
      if (!mouvement) throw nonTrouve("Le mouvement de stock");

      // Le depot du mouvement porte la division concernee.
      const utilisateur = await exigerPermissionEtUsine(
        PERMISSIONS.STOCK_ANNULER_MOUVEMENT,
        mouvement.warehouse.factory,
      );

      // Controles anticipes pour un message clair ; le service les refait dans
      // sa propre transaction, qui reste la reference.
      if (mouvement.reverses) {
        throw conflit(
          `Le mouvement ${mouvement.number} a deja ete annule par le mouvement ${mouvement.reverses.number}.`,
        );
      }
      if (mouvement.isReversal) {
        throw conflit("Un mouvement d'annulation ne peut pas etre annule a son tour.");
      }

      const resultat = await annulerMouvement(mouvementId, motif, acteurDe(utilisateur));

      rafraichirStock();
      return {
        mouvementAnnule: mouvement.number,
        mouvementInverseId: resultat.mouvementInverseId.toString(),
      };
    },
  );
}

// -----------------------------------------------------------------------------
// Transferts inter-ateliers
// -----------------------------------------------------------------------------

/**
 * Transfert entre deux depots : une sortie du depot source et une entree dans
 * le depot de destination, numerotees et rattachees a un meme document, afin
 * que le deplacement reste tracable de bout en bout (chassis peint ADMEDCO
 * transmissible a MOBILIX, par exemple).
 */
export async function actionTransfererStock(formData: FormData): Promise<ResultatAction> {
  return executer(
    "Le transfert inter-ateliers a ete enregistre : sortie du depot source et entree dans le depot de destination.",
    async () => {
      const itemId = lireIdentifiant(formData, "itemId", "L'article");
      const sourceWarehouseId = lireIdentifiant(
        formData,
        "sourceWarehouseId",
        "Le depot source",
      );
      const targetWarehouseId = lireIdentifiant(
        formData,
        "targetWarehouseId",
        "Le depot de destination",
      );

      if (sourceWarehouseId === targetWarehouseId) {
        throw validation(
          "Le depot de destination doit etre different du depot source.",
          { targetWarehouseId: "Depot de destination identique a la source." },
        );
      }

      const motif = motifObligatoire(formData.get("motif"), "Motif du transfert");

      const quantite = D.of(
        decimalObligatoire(formData.get("quantity"), "Quantite transferee"),
      );
      if (D.lte(quantite, 0)) {
        throw validation("La quantite transferee doit etre strictement positive.", {
          quantity: "Quantite strictement positive exigee.",
        });
      }

      // Les deux divisions sont concernees par le mouvement : l'operateur doit
      // etre autorise sur le depot de depart comme sur celui d'arrivee.
      const source = await depotAutorise(
        sourceWarehouseId,
        PERMISSIONS.STOCK_TRANSFERT,
      );
      const destination = await depotAutorise(
        targetWarehouseId,
        PERMISSIONS.STOCK_TRANSFERT,
      );

      const lotId = entierOu(formData.get("lotId"));
      const sourceLocationId = entierOu(formData.get("sourceLocationId"));
      const targetLocationId = entierOu(formData.get("targetLocationId"));

      await verifierEmplacement(sourceLocationId, sourceWarehouseId, "sourceLocationId");
      await verifierEmplacement(targetLocationId, targetWarehouseId, "targetLocationId");
      // Le lot transfere est celui du depot d'origine.
      await verifierLot(lotId, itemId, sourceWarehouseId, "lotId");

      const numero = await prisma.$transaction(async (tx) => {
        const numeroTransfert = await prochainNumero(SEQUENCES.TRANSFERT, tx);

        await transfererStock(tx, {
          itemId,
          lotId,
          quantity: quantite,
          sourceWarehouseId,
          sourceLocationId,
          targetWarehouseId,
          targetLocationId,
          type: "TRANSFERT_INTER_DEPOTS",
          documentType: "TRANSFERT_INTER_DEPOTS",
          documentId: numeroTransfert,
          documentNumber: numeroTransfert,
          comment: `Transfert ${source.depot.code} vers ${destination.depot.code}`,
          reason: motif,
          acteur: acteurDe(source.utilisateur),
          autoriserNegatif: aLaPermission(
            source.utilisateur,
            PERMISSIONS.STOCK_NEGATIF_AUTORISER,
          ),
        });

        return numeroTransfert;
      });

      rafraichirStock();
      return {
        numero,
        source: source.depot.code,
        destination: destination.depot.code,
      };
    },
  );
}

// -----------------------------------------------------------------------------
// Inventaire physique
// -----------------------------------------------------------------------------

/**
 * Apercu non bloquant de l'ecart d'inventaire.
 *
 * Il sert uniquement a annoncer un ecart precis dans le message de
 * confirmation : la saisie y est lue avec indulgence (une saisie invalide
 * renvoie `null`) car c'est l'action elle-meme qui valide, sans jamais laisser
 * echapper d'exception technique vers le navigateur.
 */
async function apercuInventaire(formData: FormData): Promise<{
  theorique: Prisma.Decimal;
  compte: Prisma.Decimal;
  ecart: Prisma.Decimal;
} | null> {
  const itemId = entierOu(formData.get("itemId"));
  const warehouseId = entierOu(formData.get("warehouseId"));
  if (itemId === null || warehouseId === null) return null;

  const texte = texteOuNull(formData.get("quantityComptee"));
  if (texte === null) return null;
  const normalise = texte.replace(/\s/g, "").replace(",", ".");
  if (!Number.isFinite(Number(normalise))) return null;

  const locationId = entierOu(formData.get("locationId"));
  const lotId = entierOu(formData.get("lotId"));

  const ligne = await prisma.stockBalance.findUnique({
    where: {
      balanceKey: cleSolde({ itemId, warehouseId, locationId, lotId, status: "LIBRE" }),
    },
    select: { quantityPhysical: true },
  });

  const theorique = ligne?.quantityPhysical ?? D.ZERO;
  const compte = D.of(normalise);
  return { theorique, compte, ecart: D.sub(compte, theorique) };
}

/**
 * Inventaire physique : la quantite comptee est confrontee au solde theorique.
 * L'ecart est TOUJOURS calcule par le serveur. Il est d'abord constate pour
 * exiger un motif ecrit des qu'il est non nul, puis reverifie au moment de
 * l'ecriture : si le stock a bouge entre l'affichage et l'enregistrement, le
 * comptage est refuse plutot que comptabilise sous une valeur fausse.
 */
export async function actionEnregistrerInventaire(
  formData: FormData,
): Promise<ResultatAction> {
  const apercu = await apercuInventaire(formData);

  const message = apercu
    ? apercu.ecart.isZero()
      ? `Inventaire conforme : ${D.toFixed(apercu.compte, 3)} compte(s), aucun ecart constate.`
      : `Inventaire enregistre : ecart de ${D.toFixed(apercu.ecart, 3)} (theorique ${D.toFixed(
          apercu.theorique,
          3,
        )}, compte ${D.toFixed(apercu.compte, 3)}).`
    : "L'inventaire physique a ete enregistre.";

  return executer(message, async () => {
    const itemId = lireIdentifiant(formData, "itemId", "L'article");
    const warehouseId = lireIdentifiant(formData, "warehouseId", "Le depot");
    const locationId = entierOu(formData.get("locationId"));
    const lotId = entierOu(formData.get("lotId"));

    const compte = D.of(
      decimalObligatoire(formData.get("quantityComptee"), "Quantite comptee"),
    );
    const commentaire = texteOuNull(formData.get("commentaire"));

    const { depot, utilisateur } = await depotAutorise(
      warehouseId,
      PERMISSIONS.STOCK_INVENTAIRE,
    );
    await verifierEmplacement(locationId, warehouseId, "locationId");
    await verifierLot(lotId, itemId, warehouseId, "lotId");

    // Solde theorique de la ligne inventoriee (cle identique a celle du service).
    const ligne = await prisma.stockBalance.findUnique({
      where: {
        balanceKey: cleSolde({ itemId, warehouseId, locationId, lotId, status: "LIBRE" }),
      },
      select: { quantityPhysical: true },
    });
    const theorique = ligne?.quantityPhysical ?? D.ZERO;
    const ecart = D.sub(compte, theorique);

    // Un ecart deplace du stock reel : il est refuse sans motif ecrit, et le
    // message rappelle l'ecart constate pour que la saisie reste verifiable.
    let motif: string | null = null;
    if (!ecart.isZero()) {
      const motifSaisi = texteOuNull(formData.get("motif"));
      if (motifSaisi === null || motifSaisi.length < MOTIF_MINIMUM) {
        throw validation(
          `Ecart d'inventaire de ${D.toFixed(ecart, 3)} constate (theorique ${D.toFixed(
            theorique,
            3,
          )}, compte ${D.toFixed(compte, 3)}) : un motif ecrit d'au moins ${MOTIF_MINIMUM} caracteres est obligatoire.`,
          { motif: `Motif d'au moins ${MOTIF_MINIMUM} caracteres exige.` },
        );
      }
      motif = motifSaisi;
    }

    const commentaireInventaire = motif
      ? `Motif de l'ecart : ${motif}. Theorique ${D.toFixed(theorique, 3)}, compte ${D.toFixed(
          compte,
          3,
        )}${commentaire ? `. ${commentaire}` : ""}`
      : commentaire;

    const resultat = await prisma.$transaction(async (tx) => {
      const courant = await verrouillerSolde(tx, {
        itemId,
        warehouseId,
        locationId,
        lotId,
        status: "LIBRE",
      });

      if (!courant.quantityPhysical.equals(theorique)) {
        throw conflit(
          `Le stock theorique a change depuis l'affichage (${D.toFixed(
            courant.quantityPhysical,
            3,
          )} au lieu de ${D.toFixed(
            theorique,
            3,
          )}) dans le depot ${depot.code}. Recomptez l'article avant d'enregistrer l'inventaire.`,
        );
      }

      return enregistrerInventaire(tx, {
        itemId,
        warehouseId,
        locationId,
        lotId,
        quantityComptee: compte,
        commentaire: commentaireInventaire,
        acteur: acteurDe(utilisateur),
      });
    });

    rafraichirStock();
    return {
      ecart: resultat.ecart.toFixed(6),
      mouvementId: resultat.mouvementId ? resultat.mouvementId.toString() : "",
    };
  });
}

// -----------------------------------------------------------------------------
// Lots et statuts qualite
// -----------------------------------------------------------------------------

/**
 * Changement de statut qualite d'un lot : quarantaine, blocage, liberation ou
 * rebut. La bascule deplace la quantite concernee entre deux statuts du meme
 * depot (`changerStatutStock`), met a jour le lot et conserve le motif ecrit.
 */
export async function actionChangerStatutLot(formData: FormData): Promise<ResultatAction> {
  return executer(
    "Le statut du lot a ete mis a jour et trace dans le grand livre.",
    async () => {
      const motif = motifObligatoire(formData.get("motif"), "Motif du changement de statut");

      const de = statutObligatoire(formData.get("de"), "statut d'origine");
      const vers = statutObligatoire(formData.get("vers"), "statut de destination");
      if (de === vers) {
        throw validation(
          "Le statut d'origine et le statut de destination sont identiques.",
          { vers: "Statut de destination identique au statut courant." },
        );
      }

      const quantite = D.of(
        decimalObligatoire(formData.get("quantity"), "Quantite a deplacer"),
      );
      if (D.lte(quantite, 0)) {
        throw validation("La quantite a deplacer doit etre strictement positive.", {
          quantity: "Quantite strictement positive exigee.",
        });
      }

      const lotId = lireIdentifiant(formData, "lotId", "Le lot");
      const itemId = lireIdentifiant(formData, "itemId", "L'article");
      const warehouseId = lireIdentifiant(formData, "warehouseId", "Le depot");
      const locationId = entierOu(formData.get("locationId"));

      const lot = await prisma.stockLot.findUnique({
        where: { id: lotId },
        select: {
          id: true,
          lotNumber: true,
          itemId: true,
          warehouseId: true,
          status: true,
        },
      });
      if (!lot) throw nonTrouve("Le lot");
      if (lot.itemId !== itemId || lot.warehouseId !== warehouseId) {
        throw validation(
          "Le lot indique ne correspond pas a l'article et au depot selectionnes.",
        );
      }
      if (lot.status !== de) {
        throw conflit(
          `Le lot ${lot.lotNumber} n'est plus au statut indique : rechargez la page avant de poursuivre.`,
        );
      }

      const { depot, utilisateur } = await depotAutorise(
        warehouseId,
        PERMISSIONS.STOCK_LOT_GERER,
      );
      await verifierEmplacement(locationId, warehouseId, "locationId");

      await prisma.$transaction(async (tx) => {
        // Deux operateurs peuvent agir en parallele : le statut est relu sous
        // transaction, une divergence interrompt l'operation.
        const courant = await tx.stockLot.findUnique({
          where: { id: lotId },
          select: { status: true },
        });
        if (!courant || courant.status !== de) {
          throw conflit(
            `Le lot ${lot.lotNumber} a change de statut entre-temps : aucun mouvement n'a ete enregistre.`,
          );
        }

        await changerStatutStock(tx, {
          itemId,
          warehouseId,
          locationId,
          lotId,
          quantity: quantite,
          de,
          vers,
          type: TYPE_MOUVEMENT_STATUT[vers],
          comment: `Changement de statut du lot ${lot.lotNumber} dans le depot ${depot.code}`,
          reason: motif,
          acteur: acteurDe(utilisateur),
        });
      });

      rafraichirStock();
      return { lot: lot.lotNumber, statut: vers };
    },
  );
}
