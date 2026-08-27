/**
 * <Money> — THE ONLY PLACE CURRENCY IS FORMATTED.
 *
 * "No screen formats currency by hand" (docs/07 §Component library). One component owns
 * the minor-units -> string conversion and the colour semantics, so a formatting bug is
 * fixed in one place.
 *
 * ARTICLE I — MONEY IS NEVER A FLOAT.
 * The conversion below never divides. It pads the integer minor-unit value to a string,
 * slices it into whole and fractional digits, groups the whole part with `Intl`, and
 * splices the pieces back into the locale's own currency pattern. No `parseFloat`, no
 * `minor / 100`, so `0.1 + 0.2` never gets a chance to happen.
 *
 * The minor-unit exponent comes from `Intl` (`resolvedOptions().minimumFractionDigits`),
 * which already knows that JPY has 0 and BHD has 3 — rather than a second hand-written
 * currency table, which would drift from the `CURRENCIES` table in core (Article VI).
 *
 * TODO(phase-06): move `formatMinorUnits` into `@splitsutra/core` `utils/currency` as
 *   `formatMoney(minorUnits, currency, locale)`. Cloud Functions render the same
 *   amounts into activity `summary` strings, and Article VI forbids two implementations
 *   of the same money formatting. It lives here only until core's currency utils exist;
 *   this component then becomes a thin wrapper that adds the colour semantics.
 *
 * TODO(phase-06): tighten `minorUnits: number` to the branded `MinorUnits` type from
 *   `@splitsutra/core` once `core/src/types` lands. The brand is what stops a raw float
 *   being passed in from a form.
 */

import type { MoneyTone } from '@splitsutra/core';
import styles from './text.module.css';
import { cx } from './tokenProps';
import { Text, type TextTone } from './Text';

/** Falls back to en-US when the platform reports nothing usable. */
function resolveLocale(): string {
  const nav = typeof navigator === 'undefined' ? undefined : navigator.language;
  return nav !== undefined && nav.length > 0 ? nav : 'en-US';
}

const patternCache = new Map<string, Intl.NumberFormat>();
const groupingCache = new Map<string, Intl.NumberFormat>();

function currencyPattern(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  const hit = patternCache.get(key);
  if (hit !== undefined) return hit;
  const nf = new Intl.NumberFormat(locale, { style: 'currency', currency });
  patternCache.set(key, nf);
  return nf;
}

function integerGrouping(locale: string): Intl.NumberFormat {
  const hit = groupingCache.get(locale);
  if (hit !== undefined) return hit;
  const nf = new Intl.NumberFormat(locale, { useGrouping: true, maximumFractionDigits: 0 });
  groupingCache.set(locale, nf);
  return nf;
}

/**
 * How many minor units make one major unit, as a digit count: USD/INR 2, JPY 0, BHD 3.
 *
 * Sourced from `Intl` rather than a hand-written table, so it cannot drift from the
 * `CURRENCIES` metadata that `@splitsutra/core` owns (Article VI).
 */
export function minorUnitExponent(currency: string, locale: string = resolveLocale()): number {
  return currencyPattern(locale, currency).resolvedOptions().minimumFractionDigits ?? 2;
}

/** The currency symbol for this locale, e.g. `"₹"`. For the AmountInput prefix. */
export function currencySymbol(currency: string, locale: string = resolveLocale()): string {
  const part = currencyPattern(locale, currency)
    .formatToParts(0)
    .find((p) => p.type === 'currency');
  return part?.value ?? currency;
}

/**
 * Format integer minor units as a currency string, without ever producing a float.
 *
 * @param minorUnits e.g. `300000` with `INR` -> `"₹3,000.00"`
 */
export function formatMinorUnits(
  minorUnits: number,
  currency: string,
  locale: string = resolveLocale(),
): string {
  const pattern = currencyPattern(locale, currency);
  const exponent = pattern.resolvedOptions().minimumFractionDigits ?? 2;

  // Magnitude only. Direction is carried by colour AND words, never by a bare minus
  // sign the user has to interpret (docs/15 rule 4).
  const magnitude = Math.abs(Math.trunc(minorUnits));

  // Integer -> digit string -> whole / fraction. No division anywhere.
  const asDigits = String(magnitude).padStart(exponent + 1, '0');
  const cut = asDigits.length - exponent;
  const wholeDigits = asDigits.slice(0, cut);
  const fractionDigits = exponent === 0 ? '' : asDigits.slice(cut);

  const grouped = integerGrouping(locale).format(Number(wholeDigits));

  // Splice into the locale's own currency pattern so symbol placement, non-breaking
  // spaces and the decimal separator all stay correct for the user's locale.
  return pattern
    .formatToParts(0)
    .map((part) => {
      if (part.type === 'integer') return grouped;
      if (part.type === 'fraction') return fractionDigits;
      if (part.type === 'group') return '';
      return part.value;
    })
    .join('');
}

const TONE_TO_TEXT: Readonly<Record<MoneyTone, TextTone>> = {
  positive: 'positive',
  negative: 'negative',
  neutral: 'neutral',
};

export interface MoneyProps {
  /** Integer minor units. Never a float (Article I). */
  minorUnits: number;
  /** ISO 4217 code. Never sum two different ones (docs/15 rule 7). */
  currency: string;
  /**
   * `auto` derives the money-direction colour from the sign: positive = you are owed,
   * negative = you owe, zero = settled.
   * Pass an explicit tone for amounts that are not a balance (an expense total).
   */
  tone?: MoneyTone | 'auto' | 'plain' | undefined;
  /**
   * The words that go with the colour.
   *
   * NFR-5 / docs/07: green and orange must NEVER be the only signal. Pass "you owe" /
   * "owes you" / "you paid" here and it renders in front of the amount.
   */
  label?: string | undefined;
  /** Hero sizing for the balance strip and the Add Expense amount. */
  size?: 'default' | 'large' | undefined;
}

export function Money({
  minorUnits,
  currency,
  tone = 'auto',
  label,
  size = 'default',
}: MoneyProps) {
  const resolvedTone: MoneyTone | 'plain' =
    tone === 'auto'
      ? minorUnits > 0
        ? 'positive'
        : minorUnits < 0
          ? 'negative'
          : 'neutral'
      : tone;

  const textTone: TextTone = resolvedTone === 'plain' ? 'default' : TONE_TO_TEXT[resolvedTone];
  const formatted = formatMinorUnits(minorUnits, currency);

  return (
    <Text
      variant="amount"
      tone={textTone}
      className={cx(styles.money, size === 'large' && styles.moneyLarge)}
    >
      {label === undefined ? formatted : `${label} ${formatted}`}
    </Text>
  );
}
