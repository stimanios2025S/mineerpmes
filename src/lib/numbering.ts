import { prisma, type Db } from "@/lib/db";
import { nonTrouve } from "@/lib/errors";

/**
 * Numerotation documentaire.
 * Chaque sequence est incrementee de facon atomique, ce qui garantit
 * l'unicite des numeros meme sous acces concurrent.
 */

export const SEQUENCES = {
  ORDRE_FABRICATION: "ORDRE_FABRICATION",
  MOUVEMENT_STOCK: "MOUVEMENT_STOCK",
  DEVIS: "DEVIS",
  COMMANDE_CLIENT: "COMMANDE_CLIENT",
  BON_LIVRAISON: "BON_LIVRAISON",
  FACTURE_CLIENT: "FACTURE_CLIENT",
  AVOIR_CLIENT: "AVOIR_CLIENT",
  DEMANDE_ACHAT: "DEMANDE_ACHAT",
  COMMANDE_FOURNISSEUR: "COMMANDE_FOURNISSEUR",
  BON_RECEPTION: "BON_RECEPTION",
  FACTURE_FOURNISSEUR: "FACTURE_FOURNISSEUR",
  AVOIR_FOURNISSEUR: "AVOIR_FOURNISSEUR",
  REGLEMENT: "REGLEMENT",
  CONTROLE_QUALITE: "CONTROLE_QUALITE",
  NON_CONFORMITE: "NON_CONFORMITE",
  ECRITURE_COMPTABLE: "ECRITURE_COMPTABLE",
  AFFECTATION: "AFFECTATION",
  LOT: "LOT",
  TRANSFERT: "TRANSFERT",
  IMPORT: "IMPORT",
} as const;

export type CodeSequence = (typeof SEQUENCES)[keyof typeof SEQUENCES];

interface DefinitionSequence {
  label: string;
  prefix: string;
  pattern: string;
  padding: number;
  resetYearly: boolean;
}

export const DEFINITIONS_SEQUENCES: Record<string, DefinitionSequence> = {
  [SEQUENCES.ORDRE_FABRICATION]: {
    label: "Ordre de fabrication",
    prefix: "OF",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 5,
    resetYearly: true,
  },
  [SEQUENCES.MOUVEMENT_STOCK]: {
    label: "Mouvement de stock",
    prefix: "MVT",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 6,
    resetYearly: true,
  },
  [SEQUENCES.DEVIS]: {
    label: "Devis client",
    prefix: "DEV",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 4,
    resetYearly: true,
  },
  [SEQUENCES.COMMANDE_CLIENT]: {
    label: "Commande client",
    prefix: "CC",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 5,
    resetYearly: true,
  },
  [SEQUENCES.BON_LIVRAISON]: {
    label: "Bon de livraison",
    prefix: "BL",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 5,
    resetYearly: true,
  },
  [SEQUENCES.FACTURE_CLIENT]: {
    label: "Facture client",
    prefix: "FC",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 5,
    resetYearly: true,
  },
  [SEQUENCES.AVOIR_CLIENT]: {
    label: "Avoir client",
    prefix: "AC",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 5,
    resetYearly: true,
  },
  [SEQUENCES.DEMANDE_ACHAT]: {
    label: "Demande d'achat",
    prefix: "DA",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 5,
    resetYearly: true,
  },
  [SEQUENCES.COMMANDE_FOURNISSEUR]: {
    label: "Commande fournisseur",
    prefix: "CF",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 5,
    resetYearly: true,
  },
  [SEQUENCES.BON_RECEPTION]: {
    label: "Bon de reception",
    prefix: "BR",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 5,
    resetYearly: true,
  },
  [SEQUENCES.FACTURE_FOURNISSEUR]: {
    label: "Facture fournisseur",
    prefix: "FF",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 5,
    resetYearly: true,
  },
  [SEQUENCES.AVOIR_FOURNISSEUR]: {
    label: "Avoir fournisseur",
    prefix: "AF",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 5,
    resetYearly: true,
  },
  [SEQUENCES.REGLEMENT]: {
    label: "Reglement",
    prefix: "REG",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 5,
    resetYearly: true,
  },
  [SEQUENCES.CONTROLE_QUALITE]: {
    label: "Controle qualite",
    prefix: "CQ",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 5,
    resetYearly: true,
  },
  [SEQUENCES.NON_CONFORMITE]: {
    label: "Non-conformite",
    prefix: "NC",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 4,
    resetYearly: true,
  },
  [SEQUENCES.ECRITURE_COMPTABLE]: {
    label: "Ecriture comptable",
    prefix: "EC",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 6,
    resetYearly: true,
  },
  [SEQUENCES.AFFECTATION]: {
    label: "Affectation",
    prefix: "AFF",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 5,
    resetYearly: true,
  },
  [SEQUENCES.LOT]: {
    label: "Lot de fabrication",
    prefix: "LOT",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 5,
    resetYearly: true,
  },
  [SEQUENCES.TRANSFERT]: {
    label: "Transfert inter-depots",
    prefix: "TRF",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 5,
    resetYearly: true,
  },
  [SEQUENCES.IMPORT]: {
    label: "Import de donnees",
    prefix: "IMP",
    pattern: "{PREFIX}-{YYYY}-{SEQ}",
    padding: 4,
    resetYearly: false,
  },
};

export async function initialiserSequences(db: Db = prisma): Promise<number> {
  let crees = 0;
  for (const [code, definition] of Object.entries(DEFINITIONS_SEQUENCES)) {
    const existante = await db.numberingSequence.findUnique({ where: { code } });
    if (!existante) {
      await db.numberingSequence.create({
        data: {
          code,
          label: definition.label,
          prefix: definition.prefix,
          pattern: definition.pattern,
          padding: definition.padding,
          resetYearly: definition.resetYearly,
          nextValue: 1,
        },
      });
      crees += 1;
    }
  }
  return crees;
}

function formaterNumero(
  pattern: string,
  prefix: string,
  annee: number,
  valeur: number,
  padding: number,
): string {
  return pattern
    .replace(/\{PREFIX\}/g, prefix)
    .replace(/\{YYYY\}/g, String(annee))
    .replace(/\{YY\}/g, String(annee).slice(-2))
    .replace(/\{SEQ\}/g, String(valeur).padStart(padding, "0"));
}

/**
 * Reserve le prochain numero d'une sequence.
 * Doit etre appele a l'interieur de la transaction qui cree le document.
 */
export async function prochainNumero(
  code: string,
  db: Db = prisma,
  date: Date = new Date(),
): Promise<string> {
  const annee = date.getFullYear();

  const existante = await db.numberingSequence.findUnique({ where: { code } });
  if (!existante) {
    throw nonTrouve(`La sequence de numerotation « ${code} »`);
  }

  // Remise a zero annuelle, atomique et sans effet si deja faite.
  if (existante.resetYearly) {
    await db.numberingSequence.updateMany({
      where: {
        code,
        OR: [{ lastYear: null }, { lastYear: { not: annee } }],
      },
      data: { nextValue: 1, lastYear: annee },
    });
  }

  const misAJour = await db.numberingSequence.update({
    where: { code },
    data: { nextValue: { increment: 1 } },
  });

  const valeur = misAJour.nextValue - 1;
  return formaterNumero(
    misAJour.pattern,
    misAJour.prefix,
    annee,
    valeur,
    misAJour.padding,
  );
}

/** Apercu du prochain numero sans le consommer. */
export async function apercuProchainNumero(
  code: string,
  db: Db = prisma,
  date: Date = new Date(),
): Promise<string> {
  const sequence = await db.numberingSequence.findUnique({ where: { code } });
  if (!sequence) throw nonTrouve(`La sequence de numerotation « ${code} »`);
  const annee = date.getFullYear();
  const valeur = sequence.resetYearly && sequence.lastYear !== annee ? 1 : sequence.nextValue;
  return formaterNumero(sequence.pattern, sequence.prefix, annee, valeur, sequence.padding);
}
