import { isValidAmount, type MinorUnits } from '../types/money.js';
import { allocateToUids, assertParticipants, assertValidTotal, compareUid } from './allocate.js';
import { DomainError } from './errors.js';

/**
 * ============================================================================
 * The four split methods (doc 04 §2).
 * ============================================================================
 *
 * Every one of them satisfies the same contract:
 *
 *     sum(result[].amountMinor) === totalMinor      // EXACTLY. Always. No tolerance.
 *
 * Three of them get there by choosing weights and handing the problem to
 * `allocate`; the fourth (`exact`) gets there by refusing to compute at all.
 * **No method rounds anything itself** — Article VI, and the reason this file is
 * so thin. If a future split mode needs money divided, it chooses weights; it does
 * not reach for `Math.round`.
 */

/**
 * Split methods, matching `Expense.splitMethod` in doc 03.
 *
 * ⚠️ This is a **second declaration** of the union that `../types/expense` infers
 * from `splitMethodSchema`, and it is deliberate rather than an oversight. Domain
 * code cannot import the canonical one: `types/expense` → `types/primitives` →
 * `import type { Timestamp } from 'firebase/firestore'`, and `.dependency-cruiser.cjs`
 * runs the `domain-is-pure` rule with `tsPreCompilationDeps: true`, so even a
 * fully-erased type-only edge to the Firebase SDK fails `pnpm depcruise`.
 *
 * Two consequences worth knowing:
 * - Adding a fifth split method means editing `SPLIT_METHODS` in `types/expense.ts`
 *   **and** this union. `computeSplits`'s exhaustive `switch` is what turns the
 *   omission into a compile error rather than a runtime surprise.
 * - `./index.ts` does not re-export this name, because two declarations of
 *   `SplitMethod` reaching the package root barrel would be an ambiguous star
 *   export (TS2308). Import it from `@splitsutra/core/types`.
 */
export type SplitMethod = 'equal' | 'exact' | 'percent' | 'shares';

/**
 * 100% expressed in basis points.
 *
 * Percentages are stored as integer basis points (33.33% → 3333), never as
 * floats: `33.33 + 33.33 + 33.34` is not `100` in binary floating point, and a
 * validation rule that cannot be satisfied is worse than no rule at all.
 */
export const TOTAL_BASIS_POINTS = 10_000;

/**
 * One participant's resolved share, shaped to drop straight into
 * `Expense.splits` (doc 03).
 */
export interface SplitAllocation {
  readonly uid: string;
  /** The resolved owed amount — always the truth. */
  readonly amountMinor: MinorUnits;
  /**
   * What the user entered: basis points for `percent`, share count for `shares`,
   * `null` for `equal` and `exact` (where the amount *is* what was entered).
   * Kept so the edit screen can restore the original input rather than showing
   * meaningless recomputed percentages — doc 03, "Why `rawValue` exists".
   */
  readonly rawValue: number | null;
}

/** A participant and the exact amount the user typed for them. */
export interface ExactEntry {
  readonly uid: string;
  readonly amountMinor: number;
}

/** A participant and their share in integer basis points (33.33% → 3333). */
export interface PercentEntry {
  readonly uid: string;
  readonly bps: number;
}

/** A participant and their integer share count (2:1:1). */
export interface ShareEntry {
  readonly uid: string;
  readonly shares: number;
}

/**
 * Narrows an allocation result down to the three fields an `Expense.split` needs.
 *
 * The `rawValue` rides along through `allocateToUids` on the participant object
 * rather than being re-joined afterwards, which keeps every split mode free of
 * positional array lookups.
 */
function toSplitAllocation(part: {
  readonly uid: string;
  readonly amountMinor: MinorUnits;
  readonly rawValue: number | null;
}): SplitAllocation {
  return { uid: part.uid, amountMinor: part.amountMinor, rawValue: part.rawValue };
}

/**
 * **Equal split** (doc 04 §2.1, AC-D2.1).
 *
 * `base = floor(total / n)` to everyone, then one extra minor unit to the first
 * `total mod n` participants in a seed-rotated, uid-ordered sequence. Expressed
 * here as `allocate` with every weight equal to 1, which produces exactly that:
 * with equal weights every fractional remainder is identical, so the seeded
 * rotation alone decides who absorbs the leftover.
 *
 * Seeding from the expense id means the rotation is reproducible from stored data
 * alone and stays identical across edits of the same expense, while different
 * expenses spread the extra cent around instead of always taxing whoever's uid
 * sorts first.
 *
 * @param totalMinor The expense total, in minor units.
 * @param uids Participants. Order does not matter; results come back uid-ascending.
 * @param tieBreakSeed The expense id.
 */
export function splitEqual(
  totalMinor: MinorUnits,
  uids: readonly string[],
  tieBreakSeed: string,
): SplitAllocation[] {
  assertParticipants(uids);

  const participants = uids.map((uid) => ({ uid, weight: 1, rawValue: null }));

  return allocateToUids(totalMinor, participants, tieBreakSeed).map(toSplitAllocation);
}

/**
 * **Exact amounts** (doc 04 §2.2, AC-D2.2).
 *
 * The user supplies every amount directly, so there is no computation — only
 * validation. In particular this function does **not** adjust the last
 * participant to force the sum to match: that would hide a user's typo behind a
 * silently altered number. The UI shows a live `total − sum` indicator and blocks
 * save until it reads zero; this function is the same rule, enforced.
 *
 * @throws {DomainError} `EXACT_SUM_MISMATCH` when the amounts do not sum to the
 *   total exactly, with the shortfall in the message.
 */
export function splitExact(
  totalMinor: MinorUnits,
  amounts: readonly ExactEntry[],
): SplitAllocation[] {
  assertParticipants(amounts.map((entry) => entry.uid));
  assertValidTotal(totalMinor);

  for (const entry of amounts) {
    if (entry.amountMinor < 0 || !isValidAmount(entry.amountMinor)) {
      throw new DomainError(
        'INVALID_AMOUNT',
        `Exact amounts must be non-negative integers in minor units, ` +
          `got ${entry.amountMinor} for "${entry.uid}".`,
      );
    }
  }

  const assigned = amounts.reduce((sum, entry) => sum + entry.amountMinor, 0);
  if (assigned !== totalMinor) {
    throw new DomainError(
      'EXACT_SUM_MISMATCH',
      `Exact amounts must sum to the total. ${totalMinor - assigned} minor units ` +
        `left to assign (assigned ${assigned} of ${totalMinor}).`,
    );
  }

  return [...amounts]
    .sort((a, b) => compareUid(a.uid, b.uid))
    .map((entry) => ({
      uid: entry.uid,
      // Validated above, so the brand is honest.
      amountMinor: entry.amountMinor as MinorUnits,
      rawValue: null,
    }));
}

/**
 * **Percentage split** (doc 04 §2.3, AC-D2.3).
 *
 * Percentages arrive as integer basis points and must total exactly
 * `TOTAL_BASIS_POINTS`. The resulting minor units are allocated by the
 * largest-remainder method, so they total the expense amount exactly even when
 * the percentages do not divide evenly.
 *
 * @throws {DomainError} `INVALID_WEIGHT` for non-integer or negative basis points,
 *   `PERCENT_SUM_MISMATCH` when they do not total exactly 100%.
 */
export function splitPercent(
  totalMinor: MinorUnits,
  percentages: readonly PercentEntry[],
  tieBreakSeed: string,
): SplitAllocation[] {
  assertParticipants(percentages.map((entry) => entry.uid));

  for (const entry of percentages) {
    if (!Number.isInteger(entry.bps) || entry.bps < 0) {
      throw new DomainError(
        'INVALID_WEIGHT',
        `Percentages are integer basis points (33.33% is 3333), ` +
          `got ${entry.bps} for "${entry.uid}".`,
      );
    }
  }

  const totalBps = percentages.reduce((sum, entry) => sum + entry.bps, 0);
  if (totalBps !== TOTAL_BASIS_POINTS) {
    throw new DomainError(
      'PERCENT_SUM_MISMATCH',
      `Percentages must total exactly 100% (${TOTAL_BASIS_POINTS} basis points), ` +
        `got ${totalBps}.`,
    );
  }

  const participants = percentages.map((entry) => ({
    uid: entry.uid,
    weight: entry.bps,
    rawValue: entry.bps,
  }));

  return allocateToUids(totalMinor, participants, tieBreakSeed).map(toSplitAllocation);
}

/**
 * **Shares split** (doc 04 §2.4, AC-D2.4).
 *
 * Identical to {@link splitPercent} with `W = sum(shares)` in place of 10 000.
 * A participant may hold zero shares and still be listed (AC-D2.6); they receive
 * exactly zero, because a zero weight has a zero remainder and can therefore
 * never pick up a leftover unit.
 *
 * @throws {DomainError} `INVALID_WEIGHT` for non-integer, negative, or oversized
 *   share counts, `ZERO_TOTAL_WEIGHT` when every share is zero.
 */
export function splitShares(
  totalMinor: MinorUnits,
  shares: readonly ShareEntry[],
  tieBreakSeed: string,
): SplitAllocation[] {
  assertParticipants(shares.map((entry) => entry.uid));

  const participants = shares.map((entry) => ({
    uid: entry.uid,
    weight: entry.shares,
    rawValue: entry.shares,
  }));

  // Share counts are validated by `allocate` itself — integrality, non-negativity
  // and the `MAX_WEIGHT` ceiling that keeps `total * weight` inside 2^53 — rather
  // than being re-checked here. One implementation (Article VI).
  return allocateToUids(totalMinor, participants, tieBreakSeed).map(toSplitAllocation);
}

/** Tagged input for {@link computeSplits}. */
export type SplitInput =
  | {
      readonly method: 'equal';
      readonly totalMinor: MinorUnits;
      readonly uids: readonly string[];
      readonly tieBreakSeed: string;
    }
  | {
      readonly method: 'exact';
      readonly totalMinor: MinorUnits;
      readonly amounts: readonly ExactEntry[];
    }
  | {
      readonly method: 'percent';
      readonly totalMinor: MinorUnits;
      readonly percentages: readonly PercentEntry[];
      readonly tieBreakSeed: string;
    }
  | {
      readonly method: 'shares';
      readonly totalMinor: MinorUnits;
      readonly shares: readonly ShareEntry[];
      readonly tieBreakSeed: string;
    };

/**
 * Dispatches to the split method named by `input.method`.
 *
 * The expense form and the Cloud Function both call this rather than picking a
 * split function themselves, so switching split method (AC-D2.5) is a change of
 * input, not a change of code path.
 *
 * @throws {DomainError} Everything the individual methods throw, plus
 *   `INVALID_SPLIT_METHOD`.
 */
export function computeSplits(input: SplitInput): SplitAllocation[] {
  switch (input.method) {
    case 'equal':
      return splitEqual(input.totalMinor, input.uids, input.tieBreakSeed);
    case 'exact':
      return splitExact(input.totalMinor, input.amounts);
    case 'percent':
      return splitPercent(input.totalMinor, input.percentages, input.tieBreakSeed);
    case 'shares':
      return splitShares(input.totalMinor, input.shares, input.tieBreakSeed);
    default: {
      // Unreachable for a well-typed caller. Reachable for a hostile client or a
      // stale document arriving from Firestore, which is exactly the case
      // Article IV says to handle rather than assume away.
      const unknown = input as { readonly method?: unknown };
      throw new DomainError(
        'INVALID_SPLIT_METHOD',
        `Unknown split method: ${String(unknown.method)}`,
      );
    }
  }
}
