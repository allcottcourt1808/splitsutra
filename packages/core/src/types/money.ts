/**
 * Money — the branded minor-unit integer type.
 *
 * Constitution Article I: money is never a float. Every monetary value in this codebase is a
 * JavaScript `number` holding an **integer count of minor units**. `$125.50` is `12550`.
 *
 * See docs/04-split-engine.md §1.
 *
 * This module deliberately has **zero imports**. It is the lowest layer in the package, so
 * `src/domain/**` (which must stay pure — Article VII) can depend on it without dragging in
 * Zod, Firebase, or anything else.
 */

/**
 * Brand carrier. Never exists at runtime — `declare` emits nothing.
 *
 * Shape taken verbatim from docs/04-split-engine.md §1.
 */
declare const MinorBrand: unique symbol;

/**
 * An integer count of a currency's minor units, e.g. cents for USD, yen for JPY (exponent 0),
 * fils for KWD (exponent 3).
 *
 * The brand makes it a **type error** to pass a raw `number` — and therefore a possible float —
 * where minor units are expected. It costs nothing at runtime and catches the class of bug that
 * matters most here.
 *
 * The integer alone is meaningless without its currency: `12550` is $125.50 in USD but ¥12,550
 * in JPY. Always keep `amountMinor` and `currency` adjacent (docs/03-data-model.md).
 */
export type MinorUnits = number & { readonly [MinorBrand]: true };

/**
 * The upper bound on any stored minor-unit integer.
 *
 * **The bound is on the stored integer, not on the displayed amount**, so it holds regardless of
 * currency: 1e9 minor units is 10 million major units at exponent 2, 1 billion at exponent 0
 * (JPY), and 1 million at exponent 3 (KWD).
 *
 * Justification (docs/04-split-engine.md §1 "Safe bound"): the largest intermediate produced by
 * any algorithm in `src/domain/**` is `amountMinor * weight`, where `weight` is at most `10_000`
 * (percentages carried as basis points). `1e9 * 1e4 = 1e13`, comfortably under
 * `Number.MAX_SAFE_INTEGER` (`9.007e15`).
 *
 * 🔴 **Do not raise this bound without redoing that arithmetic.** Raising it to 1e12, for
 * example, puts the intermediate at 1e16 — past `MAX_SAFE_INTEGER`, where integer arithmetic
 * silently stops being exact and every downstream invariant in the system quietly becomes a lie.
 */
export const MAX_AMOUNT_MINOR = 1_000_000_000;

/**
 * `true` when `n` is a whole number inside the safe bound, in either direction.
 *
 * Signed, because balances are signed: `balanceMinor > 0` means "is owed money" and
 * `balanceMinor < 0` means "owes money" (docs/04-split-engine.md §3).
 *
 * This checks *representability*, not business rules. "An expense total must be > 0" and "a split
 * share must be >= 0" are per-field constraints and live in the schemas
 * (`positiveMinorUnitsSchema` / `nonNegativeMinorUnitsSchema` in `./primitives`).
 */
export function isValidAmount(n: number): boolean {
  return Number.isInteger(n) && Math.abs(n) <= MAX_AMOUNT_MINOR;
}

/**
 * The only sanctioned way to mint a {@link MinorUnits} from a plain `number`.
 *
 * Throws rather than rounding. A caller that reached this function with `1234.5` has a bug
 * upstream — silently rounding it would push a wrong number into someone's balance and destroy
 * the evidence of where it came from.
 *
 * @throws {RangeError} if `n` is not an integer within ±{@link MAX_AMOUNT_MINOR}.
 */
export function toMinorUnits(n: number): MinorUnits {
  if (!isValidAmount(n)) {
    throw new RangeError(
      `Not a valid minor-unit amount: ${String(n)}. ` +
        `Expected a whole number between -${String(MAX_AMOUNT_MINOR)} and ${String(MAX_AMOUNT_MINOR)}.`,
    );
  }
  return n as MinorUnits;
}

/** Zero, pre-branded. Handy as a reduce seed and as an empty balance. */
export const ZERO_MINOR = 0 as MinorUnits;

/**
 * Narrowing predicate for `unknown` input — the boundary version of {@link isValidAmount}.
 *
 * Useful in Zod refinements and when reading values off a Firestore document.
 */
export function isMinorUnits(v: unknown): v is MinorUnits {
  return typeof v === 'number' && isValidAmount(v);
}
