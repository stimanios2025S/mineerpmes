import { Prisma } from "@prisma/client";

/**
 * Aide au calcul decimal exact.
 * Aucune quantite ni aucun montant ne doit transiter par un nombre flottant
 * non controle : toutes les operations passent par Prisma.Decimal.
 */
export type DecimalInput = Prisma.Decimal | string | number | null | undefined;

export type Decimal = Prisma.Decimal;

export class DecimalUtil {
  static readonly ZERO = new Prisma.Decimal(0);
  static readonly UN = new Prisma.Decimal(1);
  static readonly CENT = new Prisma.Decimal(100);

  static of(value: DecimalInput): Prisma.Decimal {
    if (value === null || value === undefined || value === "") {
      return new Prisma.Decimal(0);
    }
    if (value instanceof Prisma.Decimal) return value;
    return new Prisma.Decimal(value);
  }

  static isZero(value: DecimalInput): boolean {
    return DecimalUtil.of(value).isZero();
  }

  static gt(a: DecimalInput, b: DecimalInput): boolean {
    return DecimalUtil.of(a).greaterThan(DecimalUtil.of(b));
  }

  static gte(a: DecimalInput, b: DecimalInput): boolean {
    return DecimalUtil.of(a).greaterThanOrEqualTo(DecimalUtil.of(b));
  }

  static lt(a: DecimalInput, b: DecimalInput): boolean {
    return DecimalUtil.of(a).lessThan(DecimalUtil.of(b));
  }

  static lte(a: DecimalInput, b: DecimalInput): boolean {
    return DecimalUtil.of(a).lessThanOrEqualTo(DecimalUtil.of(b));
  }

  static eq(a: DecimalInput, b: DecimalInput): boolean {
    return DecimalUtil.of(a).equals(DecimalUtil.of(b));
  }

  static add(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
    return DecimalUtil.of(a).plus(DecimalUtil.of(b));
  }

  static sub(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
    return DecimalUtil.of(a).minus(DecimalUtil.of(b));
  }

  /** Inverse le signe d'un decimal exact. */
  static neg(value: DecimalInput): Prisma.Decimal {
    return DecimalUtil.of(value).negated();
  }

  /** Valeur absolue d'un decimal exact. */
  static abs(value: DecimalInput): Prisma.Decimal {
    return DecimalUtil.of(value).abs();
  }

  static mul(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
    return DecimalUtil.of(a).times(DecimalUtil.of(b));
  }

  static div(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
    const divisor = DecimalUtil.of(b);
    if (divisor.isZero()) return new Prisma.Decimal(0);
    return DecimalUtil.of(a).dividedBy(divisor);
  }

  static sum(values: DecimalInput[]): Prisma.Decimal {
    return values.reduce<Prisma.Decimal>(
      (acc, value) => acc.plus(DecimalUtil.of(value)),
      new Prisma.Decimal(0),
    );
  }

  static min(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
    return Prisma.Decimal.min(DecimalUtil.of(a), DecimalUtil.of(b));
  }

  static max(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
    return Prisma.Decimal.max(DecimalUtil.of(a), DecimalUtil.of(b));
  }

  /** Arrondi commercial a n decimales (arrondi demi-superieur). */
  static round(value: DecimalInput, decimals = 2): Prisma.Decimal {
    return DecimalUtil.of(value).toDecimalPlaces(decimals, Prisma.Decimal.ROUND_HALF_UP);
  }

  /** Quantites : 6 decimales maximum, arrondi demi-superieur. */
  static roundQuantity(value: DecimalInput): Prisma.Decimal {
    return DecimalUtil.round(value, 6);
  }

  /** Montants : 4 decimales maximum. */
  static roundAmount(value: DecimalInput): Prisma.Decimal {
    return DecimalUtil.round(value, 4);
  }

  /** Taux et pourcentages : 4 decimales. */
  static roundRate(value: DecimalInput): Prisma.Decimal {
    return DecimalUtil.round(value, 4);
  }

  static toNumber(value: DecimalInput): number {
    return DecimalUtil.of(value).toNumber();
  }

  static toFixed(value: DecimalInput, decimals = 2): string {
    return DecimalUtil.of(value).toFixed(decimals);
  }

  /**
   * Taux en pourcentage : renvoie 0 si le denominateur est nul,
   * pour ne jamais produire de division par zero silencieuse.
   */
  static percent(numerator: DecimalInput, denominator: DecimalInput): Prisma.Decimal {
    const den = DecimalUtil.of(denominator);
    if (den.isZero()) return new Prisma.Decimal(0);
    return DecimalUtil.of(numerator).dividedBy(den).times(100);
  }

  /** Taux de perte exprime en pourcentage. */
  static lossRate(lost: DecimalInput, planned: DecimalInput): Prisma.Decimal {
    return DecimalUtil.roundRate(DecimalUtil.percent(lost, planned));
  }

  /** Applique un taux de perte prevu : quantite * (1 + taux/100). */
  static applyLossRate(quantity: DecimalInput, lossRatePercent: DecimalInput): Prisma.Decimal {
    const rate = DecimalUtil.of(lossRatePercent);
    return DecimalUtil.of(quantity).times(DecimalUtil.UN.plus(rate.dividedBy(100)));
  }
}

export const D = DecimalUtil;
