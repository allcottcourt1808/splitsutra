import { MAX_AMOUNT_MINOR, isValidAmount, toMinorUnits, type MinorUnits } from '../types/money.js';
import { DomainError } from './errors.js';
import { hashToInt } from './hash.js';

/**
 * ============================================================================
 * The allocator — the single place in this codebase where money is divided.
 * ============================================================================
 *
 * Doc 04 §2.5: all four split methods funnel into this one function. Equal split
 * is "all weights 1". Percentage is "weights are basis points". Shares is "weights
 * are share counts". Exact is the one method that does not allocate at all,
 * because the user already supplied integers that sum to the total (§2.2) — there
 * is nothing to round, and rounding a number the user typed would be a bug.
 *
 * Article VI: one implementation. If you are about to add a `Math.round` anywhere
 * else in this package, you are about to create the second one.
 */

/**
 * Upper bound on any single weight.
 *
 * Doc 04 §1 ("Safe bound") derives `MAX_AMOUNT_MINOR = 1e9` from the largest
 * intermediate in this file: `total * weight`, "where `weight` is at most 10 000
 * (percent in basis points)". `1e9 * 1e4 = 1e13`, comfortably inside
 * `Number.MAX_SAFE_INTEGER` (`9.007e15`).
 *
 * Percentages satisfy that bound automatically (they sum to 10 000). Share counts
 * have no natural ceiling, so the bound is enforced here — otherwise a user typing
 * a ten-million-share split would push `total * weight` past `2^53`, where integer
 * arithmetic silently stops being exact and the "sums to total" guarantee dies
 * quietly. **Do not raise this without redoing the arithmetic in doc 04 §1.**
 */
export const MAX_WEIGHT = 10_000;

/** A participant and the weight of their share. */
export interface WeightedParticipant {
  readonly uid: string;
  readonly weight: number;
}

/** A participant and the minor units allocated to them. */
export interface ParticipantAllocation {
  readonly uid: string;
  readonly amountMinor: MinorUnits;
}

/**
 * Compares uids by UTF-16 code unit, ascending.
 *
 * Deliberately **not** `localeCompare`: that is ICU-backed, and doc 04 §1 explains
 * at length why ICU-dependent behaviour cannot be trusted to agree between the web
 * build and Hermes on React Native. An ordering that differs between platforms
 * would hand the leftover cent to different people on different devices.
 *
 * Never returns 0, matching doc 04 §4's comparators verbatim. Callers guarantee
 * uids are unique (`assertParticipants`), so the equal case cannot occur.
 */
export function compareUid(a: string, b: string): number {
  return a < b ? -1 : 1;
}

/**
 * Throws unless there is at least one participant and every uid is distinct.
 *
 * A duplicated uid would not fail loudly — it would produce a split that looks
 * fine and quietly gives one person two shares — so it is rejected at the door.
 * An empty participant list is rejected for the same reason: an "exact" split of
 * zero across nobody sums correctly and means nothing.
 *
 * @throws {DomainError} `NO_PARTICIPANTS`, `DUPLICATE_UID`
 */
export function assertParticipants(uids: readonly string[]): void {
  if (uids.length === 0) {
    throw new DomainError('NO_PARTICIPANTS', 'A split needs at least one participant.');
  }
  const seen = new Set<string>();
  for (const uid of uids) {
    if (seen.has(uid)) {
      throw new DomainError('DUPLICATE_UID', `Duplicate participant uid: "${uid}"`);
    }
    seen.add(uid);
  }
}

/**
 * Throws unless `total` is an integer in `[0, MAX_AMOUNT_MINOR]`.
 *
 * The `MinorUnits` brand is erased at runtime, and Cloud Functions run this code
 * on documents written by clients we do not control (Article IV), so the branded
 * type is a compile-time convenience, not a guarantee. Re-check.
 *
 * @throws {DomainError} `NEGATIVE_TOTAL`, `INVALID_TOTAL`
 */
export function assertValidTotal(total: number): void {
  // Negative is checked *before* `isValidAmount` so both branches stay reachable
  // regardless of whether `isValidAmount` itself admits negative amounts.
  if (total < 0) {
    throw new DomainError(
      'NEGATIVE_TOTAL',
      `Cannot allocate a negative total (${total}). ` +
        'Refunds and credits are not modelled; see the note on `allocate`.',
    );
  }
  if (!isValidAmount(total)) {
    throw new DomainError(
      'INVALID_TOTAL',
      `Total must be an integer in [0, ${MAX_AMOUNT_MINOR}] minor units, got ${total}.`,
    );
  }
}

/** Internal working record for one participant during allocation. */
interface AllocationPart<T> {
  readonly entry: T;
  /** `floor(total * weight / totalWeight)` — the guaranteed part of the share. */
  readonly floorValue: number;
  /** `(total * weight) mod totalWeight` — how close this share was to the next unit. */
  readonly remainder: number;
  /** Seed-rotated position, used to break ties in `remainder` deterministically. */
  readonly rank: number;
  /** 0 or 1: whether this participant absorbed one of the leftover minor units. */
  extra: number;
}

/**
 * The largest-remainder allocation, generic over whatever the caller wants to keep
 * attached to each weight.
 *
 * Keeping the caller's entry object on the part (rather than returning a bare
 * parallel array) is what lets every public wrapper avoid positional index reads,
 * which `noUncheckedIndexedAccess` would otherwise force into `!` assertions or
 * unreachable `undefined` branches.
 *
 * Entries are consumed in the order given: **the caller establishes the canonical
 * tie-break order.** `allocate` uses array order; `allocateToUids` sorts by uid
 * first, exactly as doc 04 §2.1 does (`const ordered = [...uids].sort()`).
 */
function allocateEntries<T extends { readonly weight: number }>(
  total: number,
  entries: readonly T[],
  tieBreakSeed: string,
): Array<T & { readonly amountMinor: MinorUnits }> {
  // --- Validation -----------------------------------------------------------
  assertValidTotal(total);

  const count = entries.length;
  if (count === 0) {
    throw new DomainError('NO_PARTICIPANTS', 'Cannot allocate to zero participants.');
  }

  for (const entry of entries) {
    if (!Number.isInteger(entry.weight) || entry.weight < 0 || entry.weight > MAX_WEIGHT) {
      throw new DomainError(
        'INVALID_WEIGHT',
        `Weights must be integers in [0, ${MAX_WEIGHT}], got ${entry.weight}.`,
      );
    }
  }

  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight === 0) {
    throw new DomainError('ZERO_TOTAL_WEIGHT', 'At least one weight must be greater than zero.');
  }

  // --- Largest remainder (doc 04 §2.3) --------------------------------------
  // `start` rotates the tie-break order. For an equal split every remainder is
  // identical, so the rotation alone decides who absorbs the leftover units —
  // which is exactly the behaviour doc 04 §2.1 specifies. For weighted splits
  // remainders usually differ, so the rotation only ever settles genuine ties.
  const start = hashToInt(tieBreakSeed) % count;

  const parts: Array<AllocationPart<T>> = entries.map((entry, index) => {
    // `product <= MAX_AMOUNT_MINOR * MAX_WEIGHT = 1e13 < 2^53`, so it is exact.
    //
    // That bound also makes `Math.floor(product / totalWeight)` exact: for
    // integers `0 <= a < 2^53` and `b > 0`, the true quotient's distance to the
    // next integer is at least `1/b`, while the rounding error of IEEE-754
    // division is at most `(a/b) * 2^-53 < 1/b`. So the division can never round
    // across an integer boundary and the floor is the true one. This is the
    // whole reason doc 04 §1 bounds amounts at 1e9 — the bound is not about
    // display, it is about this line.
    const product = total * entry.weight;
    const floorValue = Math.floor(product / totalWeight);
    // Identical to `product % totalWeight` for non-negative operands, written as
    // a subtraction because JS `%` is truncated rather than floored and would
    // change meaning the day someone tries to make this handle negatives.
    const remainder = product - floorValue * totalWeight;
    return {
      entry,
      floorValue,
      remainder,
      rank: (index - start + count) % count,
      extra: 0,
    };
  });

  // `leftover = sum(remainder_i) / totalWeight`, an integer in `[0, count)`.
  // Every leftover unit is handed out below, so nothing is dropped and nothing is
  // invented: the result sums to `total` exactly. Always. No tolerance.
  const leftover = total - parts.reduce((sum, part) => sum + part.floorValue, 0);

  // Largest fractional part first; genuine ties fall back to the seeded rotation.
  // `rank` is unique, so the ordering is total and the output is deterministic.
  const order = [...parts].sort((a, b) => b.remainder - a.remainder || a.rank - b.rank);

  // `order` holds the same object references as `parts`, so this is visible below.
  // A participant with weight 0 has remainder 0 — the minimum — and leftover is 0
  // whenever every remainder is 0, so a zero weight can never receive a unit.
  for (const part of order.slice(0, leftover)) {
    part.extra = 1;
  }

  return parts.map((part) => ({
    ...part.entry,
    // Safe by construction: `0 <= floorValue + extra <= total <= MAX_AMOUNT_MINOR`.
    amountMinor: toMinorUnits(part.floorValue + part.extra),
  }));
}

/**
 * Splits `total` across `weights` using the largest-remainder method.
 *
 * Guarantees — these are the contract, and each one has a property test:
 * - `result.length === weights.length`
 * - `sum(result) === total`, **exactly, always, with no tolerance**
 * - every element is an integer in `[0, total]`
 * - a weight of `0` always receives `0`
 * - the same `(total, weights, tieBreakSeed)` always produces the same output
 *
 * Ties in the fractional parts are broken by a rotation seeded from
 * `tieBreakSeed` (in practice the expense id), so the extra minor unit moves
 * around between expenses instead of always taxing the same participant, while
 * staying perfectly reproducible from stored data (Article VII). Ties are broken
 * by *position*, so the caller decides what position means — pass participants in
 * ascending-uid order, or use {@link allocateToUids}, which does it for you.
 *
 * **Negative totals are rejected.** Doc 04 permits amounts in `[0, MAX]` only, and
 * guarantees non-negative outputs; there is no refund or credit concept in the
 * data model. Supporting them later means re-deriving the floor/remainder step
 * with a floored modulo (JS `%` truncates toward zero), not just deleting the
 * guard — hence the explicit error rather than a silently wrong answer.
 *
 * @param total Amount to distribute, in minor units.
 * @param weights One integer weight per participant, each in `[0, MAX_WEIGHT]`;
 *   at least one must be greater than zero.
 * @param tieBreakSeed Stable per-expense seed, normally the expense id.
 * @throws {DomainError} `NEGATIVE_TOTAL`, `INVALID_TOTAL`, `NO_PARTICIPANTS`,
 *   `INVALID_WEIGHT`, `ZERO_TOTAL_WEIGHT`
 */
export function allocate(total: MinorUnits, weights: number[], tieBreakSeed: string): MinorUnits[] {
  return allocateEntries(
    total,
    weights.map((weight) => ({ weight })),
    tieBreakSeed,
  ).map((part) => part.amountMinor);
}

/**
 * {@link allocate} keyed by uid — the form the four split methods use.
 *
 * Participants are sorted by ascending uid before allocation (doc 04 §2.1's
 * `[...uids].sort()`), which fixes the tie-break order independently of the order
 * the caller happened to pass them in. **The result is returned in that same
 * ascending-uid order**, not the input order: a stable output ordering is one less
 * thing that can reshuffle a settle-up screen between renders, and callers that
 * need a specific order are already sorting for display.
 *
 * Generic in the participant type so callers can carry extra fields (a raw
 * percentage, a share count) through the allocation and read them back off the
 * result, instead of re-joining two arrays by index afterwards.
 *
 * @throws {DomainError} `NO_PARTICIPANTS`, `DUPLICATE_UID`, plus everything
 *   {@link allocate} throws.
 */
export function allocateToUids<T extends WeightedParticipant>(
  total: MinorUnits,
  participants: readonly T[],
  tieBreakSeed: string,
): Array<T & { readonly amountMinor: MinorUnits }> {
  assertParticipants(participants.map((participant) => participant.uid));

  const ordered = [...participants].sort((a, b) => compareUid(a.uid, b.uid));

  return allocateEntries(total, ordered, tieBreakSeed);
}
