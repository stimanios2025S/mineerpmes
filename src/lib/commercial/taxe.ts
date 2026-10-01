import type { Db } from "@/lib/db";
import { D, type Decimal } from "@/lib/decimal";
import { validation } from "@/lib/errors";

/**
 * Regles de calcul communes aux documents commerciaux (achat et vente).
 *
 * Aucun taux de TVA n'est code en dur : le taux est resolu depuis la table
 * « TaxRate » (code explicite de la ligne, sinon taux de l'article, sinon taux
 * par defaut actif). Si aucun taux n'existe, le document est refuse plutot que
 * de laisser passer un montant fiscal invente.
 */

export interface TauxTvaResolu {
  code: string | null;
  taux: Decimal;
}

export async function resoudreTauxTva(
  tx: Db,
  entree: { vatRateCode?: string | null; itemId?: number | null },
): Promise<TauxTvaResolu> {
  let code = entree.vatRateCode ?? null;

  if (!code && entree.itemId) {
    const article = await tx.item.findUnique({
      where: { id: entree.itemId },
      select: { taxRateCode: true },
    });
    code = article?.taxRateCode ?? null;
  }

  if (!code) {
    const defaut = await tx.taxRate.findFirst({
      where: { isActive: true },
      orderBy: { isDefault: "desc" },
      select: { code: true, rate: true },
    });
    if (!defaut) {
      throw validation(
        "Aucun taux de TVA n'est configure. Renseignez la table des taux avant d'etablir un document commercial.",
      );
    }
    return { code: defaut.code, taux: D.of(defaut.rate) };
  }

  const taux = await tx.taxRate.findUnique({
    where: { code },
    select: { code: true, rate: true, isActive: true },
  });
  if (!taux) {
    throw validation(
      `Taux de TVA inconnu : « ${code} ». Verifiez la fiche article ou la table des taux.`,
    );
  }
  if (!taux.isActive) {
    throw validation(`Le taux de TVA « ${code} » est inactif : il ne peut plus etre applique.`);
  }

  return { code: taux.code, taux: D.of(taux.rate) };
}

export interface LigneCalculee {
  brut: Decimal;
  remise: Decimal;
  ht: Decimal;
  tva: Decimal;
  ttc: Decimal;
}

/**
 * Calcule une ligne de document commercial au centime pres.
 * Le calcul reste integralement decimal : aucun flottant n'intervient.
 */
export function calculerLigne(
  quantite: Decimal,
  prixUnitaire: Decimal,
  tauxRemise: Decimal,
  tauxTva: Decimal,
): LigneCalculee {
  const brut = D.mul(quantite, prixUnitaire);
  const remise = D.roundAmount(D.mul(brut, D.div(tauxRemise, D.CENT)));
  const ht = D.roundAmount(D.sub(brut, remise));
  const tva = D.roundAmount(D.mul(ht, D.div(tauxTva, D.CENT)));
  return { brut, remise, ht, tva, ttc: D.roundAmount(D.add(ht, tva)) };
}
