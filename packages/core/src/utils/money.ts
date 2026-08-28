/**
 * Money formatting — THE ONLY IMPLEMENTATION (Article VI).
 *
 * This function is called from three runtimes that must agree with each other:
 *
 *   - `apps/web` renders it into `<Money>`;
 *   - `firebase/functions` renders the same amounts into activity `summary` strings, which
 *     are then stored and read back by every client;
 *   - `apps/mobile` (Phase 12) renders it under Hermes.
 *
 * A second implementation anywhere in that list is how a group ends up seeing one number on
 * the expense row and a different one in the feed entry describing that same expense.
 *
 * ╔══════════════════════════════════════════════════════════════════════════════════════════╗
 * ║ 🔴 NO `Intl.NumberFormat`. NOT FOR THE EXPONENT, AND NOT FOR THE SEPARATORS EITHER.        ║
 * ╚══════════════════════════════════════════════════════════════════════════════════════════╝
 *
 * The exponent rule is the recorded one (docs/04-split-engine.md §1, docs/12-decisions.md Q4):
 * ICU data varies between JavaScript runtimes and **Hermes is frequently built with a trimmed
 * ICU**, so `resolvedOptions().minimumFractionDigits` can answer `2` for JPY. `¥12,550` then
 * renders as `¥125.50` — every amount wrong by 100×, silently, with no exception to catch and
 * no way for a user to report it beyond "the numbers are mad". The exponent here comes from the
 * hardcoded {@link getExponent} table and from nowhere else.
 *
 * The separators are hand-rolled for a narrower reason. The previous implementation
 * (`apps/web/src/components/Money.tsx`) spliced its digits into the *pattern* `Intl` returned —
 * so a trimmed ICU that reports 0 fraction digits for USD produced a pattern with no fraction
 * slot at all, and `$125.50` came out as `$125`, dropping the cents on the floor. Deriving the
 * digits correctly is not enough if the frame they are poured into is ICU-shaped. So the whole
 * string is built here, from the table, and is byte-identical on every engine.
 *
 * That determinism is not a nicety: `summary` strings are written by a Cloud Function running
 * full-ICU Node and displayed next to amounts formatted on the client. If the two disagree
 * about a thousands separator, the feed looks broken.
 *
 * The cost is that {@link LOCALE_CONVENTIONS} is a small hand-audited table rather than CLDR —
 * see its comment for exactly how small, and what an unlisted locale gets.
 *
 * Article I: the conversion below never divides. It pads the integer minor-unit value into a
 * digit string, slices it into whole and fractional digits, and groups them by hand. There is
 * no `parseFloat` and no `minor / 100`, so `0.1 + 0.2` never gets a chance to happen.
 *
 * @see docs/04-split-engine.md §1
 * @see packages/core/src/types/currency.ts — the hardcoded ISO 4217 table
 */

import { getCurrency, getExponent, isCurrencyCode, type CurrencyCode } from '../types/currency.js';
import type { MinorUnits } from '../types/money.js';

/* -------------------------------------------------------------------------- */
/* Locale conventions                                                         */
/* -------------------------------------------------------------------------- */

/** How one locale writes a number and places a currency symbol. Display data only. */
interface NumberConvention {
  /** Thousands separator. `''` disables grouping entirely. */
  readonly group: string;
  /** Decimal separator. */
  readonly decimal: string;
  /**
   * `western` groups in threes forever (`1,234,567`). `indian` groups the last three and
   * then in twos (`12,34,567` — twelve lakh thirty-four thousand).
   */
  readonly grouping: 'western' | 'indian';
  /** `prefix` writes `$1.00`; `suffix` writes `1,00 €` with a non-breaking space. */
  readonly symbol: 'prefix' | 'suffix';
}

/** U+00A0. Keeps the symbol from wrapping onto its own line mid-amount. */
const NBSP = ' ';

/**
 * `1,234.50` — en, and the large ICU family that shares its punctuation (ja, zh, ko, he, th).
 *
 * Also the fallback for every locale not named below, which is why it is the plainest option:
 * an unrecognised locale should get something universally readable, not something exotic.
 */
const COMMA_DOT: NumberConvention = {
  group: ',',
  decimal: '.',
  grouping: 'western',
  symbol: 'prefix',
};

/** `1.234,50 €` — de, es, it, nl, pt and neighbours. */
const DOT_COMMA: NumberConvention = {
  group: '.',
  decimal: ',',
  grouping: 'western',
  symbol: 'suffix',
};

/** `1 234,50 €` — fr and most of Slavic/Nordic Europe. The space is non-breaking. */
const SPACE_COMMA: NumberConvention = {
  group: NBSP,
  decimal: ',',
  grouping: 'western',
  symbol: 'suffix',
};

/** `₹12,34,567.50` — the lakh/crore grouping used across India. */
const INDIAN: NumberConvention = {
  group: ',',
  decimal: '.',
  grouping: 'indian',
  symbol: 'prefix',
};

/**
 * Language subtag → convention.
 *
 * 🔴 This is deliberately a *small hand-audited table*, not a CLDR port, and it is
 * **display data only** — nothing here can change an amount, only how it is punctuated.
 * The worst case for an unlisted or mis-mapped locale is that a French user sees
 * `1,234.50 €` instead of `1 234,50 €`: cosmetic, and visible the moment anyone looks.
 * Compare that with the failure mode of asking ICU: an exponent that is wrong by one and
 * an amount that is wrong by 100×, invisibly. Cosmetic drift is the price of determinism,
 * and it is the right side of that trade.
 *
 * Extending it is safe and expected — add the subtag, add a test row. Note that it is a
 * `Map` rather than an object literal so that a locale string like `"constructor"` cannot
 * reach `Object.prototype` and come back as a "convention".
 */
const LOCALE_CONVENTIONS: ReadonlyMap<string, NumberConvention> = new Map([
  // Comma-dot. Listed explicitly rather than left to the fallback so the table doubles as
  // documentation of what has actually been checked.
  ['en', COMMA_DOT],
  ['ja', COMMA_DOT],
  ['zh', COMMA_DOT],
  ['ko', COMMA_DOT],
  ['th', COMMA_DOT],
  ['he', COMMA_DOT],
  ['ms', COMMA_DOT],
  ['ga', COMMA_DOT],

  // Dot-comma.
  ['de', DOT_COMMA],
  ['es', DOT_COMMA],
  ['it', DOT_COMMA],
  ['nl', DOT_COMMA],
  ['pt', DOT_COMMA],
  ['id', DOT_COMMA],
  ['tr', DOT_COMMA],
  ['da', DOT_COMMA],
  ['el', DOT_COMMA],
  ['ro', DOT_COMMA],
  ['hr', DOT_COMMA],
  ['sl', DOT_COMMA],
  ['sr', DOT_COMMA],
  ['vi', DOT_COMMA],
  ['ca', DOT_COMMA],

  // Space-comma.
  ['fr', SPACE_COMMA],
  ['ru', SPACE_COMMA],
  ['uk', SPACE_COMMA],
  ['pl', SPACE_COMMA],
  ['cs', SPACE_COMMA],
  ['sk', SPACE_COMMA],
  ['sv', SPACE_COMMA],
  ['nb', SPACE_COMMA],
  ['nn', SPACE_COMMA],
  ['no', SPACE_COMMA],
  ['fi', SPACE_COMMA],
  ['hu', SPACE_COMMA],
  ['bg', SPACE_COMMA],
  ['lv', SPACE_COMMA],
  ['lt', SPACE_COMMA],
  ['et', SPACE_COMMA],

  // Indian grouping. Region `IN` covers `en-IN` and friends; these are the subtags that
  // imply India without carrying a region.
  ['hi', INDIAN],
  ['bn', INDIAN],
  ['ta', INDIAN],
  ['te', INDIAN],
  ['mr', INDIAN],
  ['gu', INDIAN],
  ['kn', INDIAN],
  ['ml', INDIAN],
  ['pa', INDIAN],
]);

/**
 * Neutral default. `'en-US'` rather than anything read off the host, because Article II makes
 * a locale an argument to this layer: `apps/web` passes `navigator.language`, Cloud Functions
 * pass the group's locale, and neither of them is core's business to discover.
 */
const DEFAULT_LOCALE = 'en-US';

/**
 * Pick a convention from a BCP-47 tag.
 *
 * Handles `en`, `en-US`, `zh-Hans-CN` and the underscore spelling some platforms emit
 * (`en_IN`). The region check runs first so that `en-IN` gets lakh grouping while `en-US`
 * does not.
 */
function resolveConvention(locale: string): NumberConvention {
  const subtags = locale.split(/[-_]/);
  const language = (subtags[0] ?? '').toLowerCase();

  // The script subtag sits between language and region (`zh-Hans-CN`), so scan rather than
  // assuming position. Regions are the two-letter subtags; UN M.49 numeric regions are not
  // mapped here and fall through to the language.
  const region = subtags
    .slice(1)
    .find((tag) => /^[A-Za-z]{2}$/.test(tag))
    ?.toUpperCase();
  if (region === 'IN') return INDIAN;

  return LOCALE_CONVENTIONS.get(language) ?? COMMA_DOT;
}

/* -------------------------------------------------------------------------- */
/* Digit assembly                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Insert `separator` into a run of digits.
 *
 * Both styles take the last three digits as one group; `indian` then switches to twos, which
 * is what turns `100000` into `1,00,000` (one lakh) rather than `100,000`.
 */
function groupDigits(whole: string, convention: NumberConvention): string {
  if (convention.group === '') return whole;

  const groups: string[] = [];
  let end = whole.length;
  let size = 3;
  while (end > 0) {
    const start = Math.max(0, end - size);
    groups.unshift(whole.slice(start, end));
    end = start;
    if (convention.grouping === 'indian') size = 2;
  }
  return groups.join(convention.group);
}

/* -------------------------------------------------------------------------- */
/* The public API                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Render integer minor units as a currency string.
 *
 * ```ts
 * formatMoney(toMinorUnits(300000), 'INR')            // "₹3,000.00"
 * formatMoney(toMinorUnits(300000), 'INR', 'en-IN')   // "₹3,000.00"
 * formatMoney(toMinorUnits(12550), 'JPY')             // "¥12,550"   ← exponent 0
 * formatMoney(toMinorUnits(12550), 'KWD')             // "د.ك12.550" ← exponent 3
 * formatMoney(toMinorUnits(-2500), 'USD')             // "-$25.00"
 * ```
 *
 * The sign is rendered. `<Money>` deliberately passes a magnitude and carries direction in
 * colour *and* words instead (docs/07 NFR-5), but a bare `formatMoney` must never quietly
 * turn what someone owes into what they are owed — an activity `summary` has no colour to
 * lean on.
 *
 * @param minorUnits Integer minor units, e.g. `12550` for `$125.50`. Signed.
 * @param currency ISO 4217 code. Must be one the hardcoded table knows.
 * @param locale BCP-47 tag, used only to pick punctuation. Defaults to `en-US`; core never
 *   reads a locale off a global (Article II).
 * @throws {RangeError} if `minorUnits` is not a safe integer, or `currency` is unknown.
 */
export function formatMoney(
  minorUnits: MinorUnits,
  currency: CurrencyCode,
  locale: string = DEFAULT_LOCALE,
): string {
  // The brand normally makes this unreachable, but a `as MinorUnits` cast or a JavaScript
  // caller (Cloud Functions consume the built output) can still get here with `12.5`.
  // Article I: throw rather than truncate. The previous implementation called `Math.trunc`,
  // which silently turned a float bug into a plausible-looking wrong number and destroyed
  // the evidence of where it came from.
  if (!Number.isSafeInteger(minorUnits)) {
    throw new RangeError(
      `[splitsutra] formatMoney expects integer minor units, received: ${String(minorUnits)}. ` +
        'Money is never a float (Article I) — mint amounts with toMinorUnits().',
    );
  }
  if (!isCurrencyCode(currency)) {
    throw new RangeError(
      `[splitsutra] formatMoney received an unknown ISO 4217 code: ${String(currency)}.`,
    );
  }

  // 🔴 The exponent comes from the hardcoded table. Never from Intl. See the file header.
  const exponent = getExponent(currency);
  const convention = resolveConvention(locale);

  const negative = minorUnits < 0;
  const magnitude = Math.abs(minorUnits);

  // Integer → digit string → whole / fraction. No division anywhere, so no float is ever
  // constructed and no rounding can occur. The pad guarantees at least one whole digit,
  // which is what makes `5` render as `$0.05` rather than `$.05`.
  const digits = String(magnitude).padStart(exponent + 1, '0');
  const cut = digits.length - exponent;
  const whole = groupDigits(digits.slice(0, cut), convention);
  const fraction = exponent === 0 ? '' : digits.slice(cut);

  const number = fraction === '' ? whole : `${whole}${convention.decimal}${fraction}`;

  // Display data (`currency.ts` is explicit that `symbol` is never computed with).
  const symbol = getCurrency(currency).symbol;
  const withSymbol =
    convention.symbol === 'prefix' ? `${symbol}${number}` : `${number}${NBSP}${symbol}`;

  // ASCII hyphen-minus rather than U+2212. Some locales prefer the typographic minus, but a
  // sign that survives copy-paste into a spreadsheet is worth more here than typography.
  return negative ? `-${withSymbol}` : withSymbol;
}
