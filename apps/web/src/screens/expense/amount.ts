/**
 * Text field ↔ minor units. The boundary Article I talks about.
 *
 * Everything below works on **digit strings**. There is no `parseFloat`, no `Number(input)` on
 * anything with a decimal point, and no `× 100`: the fractional digits are sliced out of the
 * typed characters and concatenated onto the whole part, so `0.1 + 0.2` never gets a chance to
 * happen and `"12.345"` in a 2-decimal currency is a rejection rather than a silent round.
 *
 * ⚠️ This belongs in `@splitsutra/core` next to `formatMoney` — docs/04 §1 names it
 * `parseAmount(input, currency)` and puts it in core, where Cloud Functions and the mobile app
 * can reach it. It is here because `packages/core/src/utils/money.ts` was not this change's to
 * edit. Moving it is a cut-and-paste plus an import swap; nothing else depends on where it lives.
 *
 * ## The input grammar, and why it is spelled out
 *
 * `"1,234.5"` is 1234.5 to an English reader and 1.2345 to a German one, and guessing wrong is
 * a 100× error in someone's balance. So the rule is fixed and documented on the field itself:
 *
 * - Currency symbols, spaces and `+` are ignored.
 * - `.` is always the decimal separator.
 * - `,` is a grouping separator — **unless** it is the only separator present and is not
 *   followed by exactly three digits, in which case it is read as a decimal separator, so
 *   `"1234,50"` means 1234.50 and `"1,234"` means 1234.
 * - More than `exponent` fractional digits throws. `"100.5"` is valid USD and invalid JPY.
 */

import { getExponent, toMinorUnits, type CurrencyCode, type MinorUnits } from '@splitsutra/core';

/** Thrown for anything a user could fix by retyping. The message is written to be shown. */
export class AmountInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountInputError';
  }
}

/** Digits only, split into the whole part and the fractional part the user actually typed. */
interface Parts {
  readonly whole: string;
  readonly fraction: string;
}

function splitOnSeparator(cleaned: string): Parts {
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');

  // Both kinds present: the later one is the decimal separator, the earlier one is grouping.
  const decimalAt =
    lastDot >= 0 && lastComma >= 0
      ? Math.max(lastDot, lastComma)
      : lastDot >= 0
        ? lastDot
        : lastComma >= 0 && !isGroupingComma(cleaned, lastComma)
          ? lastComma
          : -1;

  if (decimalAt === -1) return { whole: digitsOf(cleaned), fraction: '' };

  return {
    whole: digitsOf(cleaned.slice(0, decimalAt)),
    fraction: digitsOf(cleaned.slice(decimalAt + 1)),
  };
}

/** A lone `,` followed by exactly three digits is thousands grouping, not a decimal point. */
function isGroupingComma(cleaned: string, at: number): boolean {
  return cleaned.indexOf(',') !== at || digitsOf(cleaned.slice(at + 1)).length === 3;
}

function digitsOf(value: string): string {
  return value.replace(/\D/gu, '');
}

/**
 * Parse a typed amount into minor units of `currency`.
 *
 * @throws {AmountInputError} for anything the user typed wrong — empty, non-numeric, too many
 *   decimal places for this currency, or past `MAX_AMOUNT_MINOR`.
 */
export function parseAmountInput(input: string, currency: CurrencyCode): MinorUnits {
  const exponent = getExponent(currency);
  const cleaned = input.trim();

  if (cleaned === '') throw new AmountInputError('Enter an amount.');
  if (/[^\d.,\s+$€£¥₹]/u.test(cleaned)) {
    throw new AmountInputError('Amounts can only contain digits, a decimal point and separators.');
  }

  const { whole, fraction } = splitOnSeparator(cleaned);
  if (whole === '' && fraction === '') throw new AmountInputError('Enter an amount.');

  if (fraction.length > exponent) {
    throw new AmountInputError(
      exponent === 0
        ? `${currency} has no decimal places.`
        : `${currency} amounts have at most ${String(exponent)} decimal places.`,
    );
  }

  // Concatenation, not multiplication: "12" + "5" padded to "50" is 1250 exactly, for every
  // exponent, with no intermediate float.
  const digits = `${whole}${fraction.padEnd(exponent, '0')}`;

  try {
    return toMinorUnits(Number(digits));
  } catch {
    throw new AmountInputError('That amount is too large.');
  }
}

/** `null` when the field cannot be parsed. For live previews that must not throw mid-typing. */
export function tryParseAmountInput(input: string, currency: CurrencyCode): MinorUnits | null {
  try {
    return parseAmountInput(input, currency);
  } catch {
    return null;
  }
}

/** The message for a failed parse, or `null`. Blank input is not an error while still typing. */
export function amountInputError(input: string, currency: CurrencyCode): string | null {
  if (input.trim() === '') return null;
  try {
    parseAmountInput(input, currency);
    return null;
  } catch (cause: unknown) {
    return cause instanceof Error ? cause.message : 'That amount is not valid.';
  }
}

/**
 * Minor units back into an editable string — `300000` INR becomes `"3000.00"`.
 *
 * Ungrouped and always `.`-separated, because it goes back into a field governed by the grammar
 * above. `formatMoney` is what renders an amount for *reading*.
 */
export function formatAmountInput(minorUnits: number, currency: CurrencyCode): string {
  const exponent = getExponent(currency);
  const digits = String(Math.abs(minorUnits)).padStart(exponent + 1, '0');
  const cut = digits.length - exponent;
  const whole = digits.slice(0, cut);
  return exponent === 0 ? whole : `${whole}.${digits.slice(cut)}`;
}

/* -------------------------------------------------------------------------- */
/* Percentages                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A typed percentage into integer basis points — `"33.33"` becomes `3333`.
 *
 * Basis points are the stored form precisely so that `33.33 + 33.33 + 33.34` can equal 100
 * exactly (docs/04 §2.3). Parsing goes through the same digit-string path as money for the
 * same reason.
 */
export function parsePercentInput(input: string): number {
  const cleaned = input.trim();
  if (cleaned === '') return 0;
  if (/[^\d.,\s%]/u.test(cleaned)) throw new AmountInputError('Enter a percentage.');

  const { whole, fraction } = splitOnSeparator(cleaned.replace('%', ''));
  if (whole === '' && fraction === '') return 0;
  if (fraction.length > 2) {
    throw new AmountInputError('Percentages have at most 2 decimal places.');
  }

  const bps = Number(`${whole}${fraction.padEnd(2, '0')}`);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new AmountInputError('A percentage must be between 0 and 100.');
  }
  return bps;
}

/** `3333` back into `"33.33"`, trailing zeros trimmed so a whole percentage reads as `"25"`. */
export function formatPercentInput(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const cents = bps % 100;
  if (cents === 0) return String(whole);
  return `${String(whole)}.${String(cents).padStart(2, '0')}`.replace(/0$/u, '');
}
