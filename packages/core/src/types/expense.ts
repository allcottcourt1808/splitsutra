/**
 * `groups/{groupId}/expenses/{expenseId}` and its `paidBy` / `splits` members.
 *
 * See docs/03-data-model.md and docs/04-split-engine.md.
 */

import { z } from 'zod';

import {
  MAX_GROUP_MEMBERS,
  allUnique,
  currencyCodeSchema,
  documentIdSchema,
  nonNegativeMinorUnitsSchema,
  positiveMinorUnitsSchema,
  sameMembers,
  sumMinor,
  timestampSchema,
  uidSchema,
} from './primitives.js';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Enums
 * ────────────────────────────────────────────────────────────────────────────────────────── */

export const SPLIT_METHODS = ['equal', 'exact', 'percent', 'shares'] as const;
export const splitMethodSchema = z.enum(SPLIT_METHODS);
export type SplitMethod = z.infer<typeof splitMethodSchema>;

/**
 * The fixed category list (AC-D1.6). Defaults to `general`.
 *
 * ⚠️ `medical`, `insurance`, and `education` are **sensitive** under Constitution Article XIII:
 * they are excluded from the advertising enum entirely and map to `general`. Adding a
 * health-, medical-, or hardship-adjacent category here means adding it to the `SENSITIVE` set in
 * the ad-category derivation too (docs/14-monetization-ads.md §4).
 */
export const EXPENSE_CATEGORIES = [
  'general',
  'food',
  'groceries',
  'transport',
  'fuel',
  'travel',
  'accommodation',
  'rent',
  'utilities',
  'household',
  'entertainment',
  'medical',
  'insurance',
  'education',
] as const;
export const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

/** AC-D1.6. */
export const DEFAULT_EXPENSE_CATEGORY: ExpenseCategory = 'general';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Payers and splits
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * One contributor to what was actually paid.
 *
 * Multiple payers are supported (AC-D1.4); the sum of contributions must equal the expense total.
 */
export const payerSchema = z.object({
  uid: uidSchema,
  amountMinor: positiveMinorUnitsSchema,
});

export type Payer = z.infer<typeof payerSchema>;

/**
 * One participant's resolved share of an expense.
 *
 * `amountMinor` is **always the truth**. `rawValue` records what the user typed so the edit screen
 * can restore it: basis points for a percentage split (33.33% → `3333`), or the share count for a
 * shares split. Without it, reopening a percentage split shows meaningless recomputed percentages
 * (docs/03-data-model.md, "Why `rawValue` exists").
 */
export const splitSchema = z.object({
  uid: uidSchema,
  /** Zero is legitimate — a participant may carry a zero share and stay listed (AC-D2.6). */
  amountMinor: nonNegativeMinorUnitsSchema,
  /** `null` for `equal` and `exact`, where there is nothing to restore. */
  rawValue: z.number().int().nonnegative().nullable(),
});

export type Split = z.infer<typeof splitSchema>;

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Expense
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** The unrefined object shape. Exported so partial-update payloads can reuse `.shape`. */
export const expenseBaseSchema = z.object({
  /** Equals the document ID. */
  id: documentIdSchema,
  groupId: documentIdSchema,
  description: z.string().trim().min(1).max(100),
  /**
   * The expense total, in minor units of `currency`.
   *
   * Keep `amountMinor` and `currency` adjacent everywhere — v2 adds `fxRateToBase` and
   * `amountInBaseMinor` to this same cluster (docs/03-data-model.md).
   */
  amountMinor: positiveMinorUnitsSchema,
  /** Must equal the group's currency in v1. Cross-document, so it is checked in Rules, not here. */
  currency: currencyCodeSchema,
  category: expenseCategorySchema,
  /** The user-chosen date of the expense, not the write time. */
  date: timestampSchema,
  paidBy: z
    .array(payerSchema)
    .min(1, 'An expense must have at least one payer')
    .max(MAX_GROUP_MEMBERS),
  splitMethod: splitMethodSchema,
  splits: z
    .array(splitSchema)
    .min(1, 'An expense must have at least one participant')
    .max(MAX_GROUP_MEMBERS),
  /** Denormalized; equals `splits.map(s => s.uid)`. Drives the collection-group queries. */
  participantIds: z.array(uidSchema).min(1).max(MAX_GROUP_MEMBERS),
  createdBy: uidSchema,
  createdAt: timestampSchema,
  updatedBy: uidSchema.nullable(),
  updatedAt: timestampSchema,
  /** Soft delete only — Article V. Balances are reversed; the record survives for the audit trail. */
  deletedAt: timestampSchema.nullable(),

  /* ── Denormalized comment counters (maintained by `onCommentWritten`) ─────────────────── */

  /** Keeps the expense list cheap — no extra reads to show a comment count (AC-D4.7). */
  commentCount: z.number().int().nonnegative().default(0),
  /** Drives the "active discussion" indicator. */
  lastCommentAt: timestampSchema.nullable().default(null),

  /* ── Multi-currency forward design (v2, not built) ───────────────────────────────────────
   * docs/03-data-model.md, "Forward design: multi-currency".
   *
   * 🔴 **The one rule that matters: an expense stores the FX rate that applied on its own date.
   * Balances are never converted using today's rate.** Converting on read means last month's
   * settled group silently un-settles when the exchange rate moves — the defining bug of naive
   * multi-currency implementations, and very hard to explain to a user.
   *
   * Both fields are nullable and default to `null`, so v1 documents remain valid without a
   * backfill.
   */

  /** The rate on **this expense's own date**, converting `currency` → the group's base currency. */
  fxRateToBase: z.number().positive().finite().nullable().default(null),
  /** `amountMinor` converted at `fxRateToBase`, precomputed at write time. */
  amountInBaseMinor: positiveMinorUnitsSchema.nullable().default(null),
});

/**
 * The expense schema with the validation invariants from docs/03-data-model.md attached.
 *
 * Invariants 2, 3, 5 and 7 are enforced here. **They are also enforced in Security Rules and in
 * the Cloud Function** — a hostile client is the threat model, and rules 2 and 3 are precisely
 * what guarantee the zero-sum balance invariant (AC-E1.3). Do not skip them there just because
 * they are checked here (Article IV).
 *
 * Two of the seven cannot live in a single-document schema and are enforced in Rules and the
 * Function instead:
 * - **4.** every `splits[].uid` and `paidBy[].uid` is a current group member
 * - **6.** `currency === group.currency`
 */
export const expenseSchema = expenseBaseSchema.superRefine((expense, ctx) => {
  // Invariant 2 — sum(paidBy[].amountMinor) === amountMinor
  const paidTotal = sumMinor(expense.paidBy.map((p) => p.amountMinor));
  if (paidTotal !== expense.amountMinor) {
    ctx.addIssue({
      code: 'custom',
      path: ['paidBy'],
      message: `Payer contributions total ${String(paidTotal)} but the expense is ${String(expense.amountMinor)}`,
    });
  }

  // Invariant 3 — sum(splits[].amountMinor) === amountMinor
  const splitTotal = sumMinor(expense.splits.map((s) => s.amountMinor));
  if (splitTotal !== expense.amountMinor) {
    ctx.addIssue({
      code: 'custom',
      path: ['splits'],
      message: `Split shares total ${String(splitTotal)} but the expense is ${String(expense.amountMinor)}`,
    });
  }

  // Invariant 5 — uids are unique within splits, and within paidBy
  if (!allUnique(expense.paidBy.map((p) => p.uid))) {
    ctx.addIssue({ code: 'custom', path: ['paidBy'], message: 'A payer appears more than once' });
  }
  if (!allUnique(expense.splits.map((s) => s.uid))) {
    ctx.addIssue({
      code: 'custom',
      path: ['splits'],
      message: 'A participant appears more than once',
    });
  }

  // Invariant 7 — participantIds matches splits[].uid exactly
  if (
    !sameMembers(
      expense.participantIds,
      expense.splits.map((s) => s.uid),
    )
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['participantIds'],
      message: 'participantIds does not match the split participants',
    });
  }

  // Forward design — a converted amount is meaningless without the rate it was converted at.
  if (expense.amountInBaseMinor !== null && expense.fxRateToBase === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['fxRateToBase'],
      message: 'amountInBaseMinor was stored without the FX rate that produced it',
    });
  }
});

export type Expense = z.infer<typeof expenseSchema>;
