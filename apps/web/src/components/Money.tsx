/**
 * <Money> — the web app's only currency-rendering component.
 *
 * "No screen formats currency by hand" (docs/07 §Component library). The colour semantics and
 * the accompanying words live here; the minor-units → string conversion does not.
 *
 * ARTICLE VI — THE FORMATTING ITSELF MOVED DOWN INTO CORE.
 * `formatMoney` now lives in `@splitsutra/core` (`packages/core/src/utils/money.ts`), because
 * Cloud Functions render the same amounts into activity `summary` strings and React Native will
 * render them again in Phase 12. Three copies of "how many decimal places does KWD have" is
 * three chances to disagree about someone's balance. This component is what the phase-06 TODO
 * asked it to become: a thin wrapper that adds tone and label.
 *
 * 🔴 WHAT WAS WRONG HERE BEFORE, AND MUST NOT COME BACK.
 * The version this replaces took the minor-unit exponent from
 * `Intl.NumberFormat(...).resolvedOptions().minimumFractionDigits`, and even exported that as a
 * reusable `minorUnitExponent()` helper. docs/04-split-engine.md §1 bans exactly this: ICU data
 * varies between runtimes and Hermes ships a trimmed ICU, so JPY can come back with exponent 2
 * and `¥12,550` renders as `¥125.50` — every amount wrong by 100×, silently. The exponent now
 * comes from the hardcoded ISO 4217 table in core, and `minorUnitExponent()` is gone rather than
 * fixed: no caller should be able to ask that question anywhere but the table.
 *
 * ARTICLE II — the locale is resolved *here* and passed down. `navigator` is a DOM global, and
 * `apps/web` is the one package allowed to touch it; core takes a locale as an argument.
 */

import {
  formatMoney,
  getCurrency,
  type CurrencyCode,
  type MinorUnits,
  type MoneyTone,
} from '@splitsutra/core';
import styles from './text.module.css';
import { cx } from './tokenProps';
import { Text, type TextTone } from './Text';

/**
 * The user's locale, or `en-US` when the platform reports nothing usable.
 *
 * This is the platform read that core is not allowed to make. It stays a plain function rather
 * than a hook: `<Money>` renders in lists of hundreds of rows, and the language does not change
 * without a reload.
 */
function resolveLocale(): string {
  const nav = typeof navigator === 'undefined' ? undefined : navigator.language;
  return nav !== undefined && nav.length > 0 ? nav : 'en-US';
}

/**
 * The currency symbol, e.g. `"₹"`. For the AmountInput prefix (phase 06).
 *
 * Reads the hardcoded table in core rather than `Intl.NumberFormat(...).formatToParts`, for the
 * same reason as the exponent: docs/04 §1 designates the table's `symbol` field as the fallback
 * for a trimmed Hermes ICU, and one source is better than a source plus a fallback.
 */
export function currencySymbol(currency: CurrencyCode): string {
  return getCurrency(currency).symbol;
}

const TONE_TO_TEXT: Readonly<Record<MoneyTone, TextTone>> = {
  positive: 'positive',
  negative: 'negative',
  neutral: 'neutral',
};

export interface MoneyProps {
  /**
   * Integer minor units — `12550` is `$125.50`. Never a float (Article I).
   *
   * Branded, so a raw `number` off a form cannot be passed without going through
   * `toMinorUnits()` and being validated.
   */
  minorUnits: MinorUnits;
  /** ISO 4217 code. Never sum two different ones (docs/15 rule 7). */
  currency: CurrencyCode;
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

  // docs/15 rule 4: direction is carried by colour AND words, never by a bare minus sign the
  // user has to interpret. That only holds while a tone is actually applied — under
  // `tone="plain"` there is no colour, so the sign is the one thing left saying which way the
  // money went, and `formatMoney` renders it.
  //
  // The cast is `Math.abs` of an integer, so it cannot break the brand's invariant.
  // `toMinorUnits()` is deliberately not used: it also enforces MAX_AMOUNT_MINOR, which is a
  // bound on a single stored amount, not on a summed balance — re-imposing it here would throw
  // inside a render for a group that is merely large.
  const shown = resolvedTone === 'plain' ? minorUnits : (Math.abs(minorUnits) as MinorUnits);
  const formatted = formatMoney(shown, currency, resolveLocale());

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
