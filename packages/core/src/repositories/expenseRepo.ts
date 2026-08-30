/**
 * `groups/{groupId}/expenses` — the ledger (Article V), and its comment thread (ADR-11).
 *
 * Two things in this file are load-bearing and easy to get wrong.
 *
 * **1. The client computes the splits, but never the arithmetic.** Every amount written from
 * here comes out of `domain/splits.ts` (Article VI). Nothing in this module rounds, divides,
 * or sums a float.
 *
 * **2. The checksum fields.** Security Rules have no `reduce()`, so they cannot verify that
 * `splits` adds up to `amountMinor`. Q1 Option A: the client writes redundant
 * `splitsTotalMinor` / `paidTotalMinor` fields and the rule asserts they equal `amountMinor`.
 * A forged pair is accepted at the rules layer **by design** — `onExpenseWritten` recomputes
 * the real sums server-side and quarantines a document that disagrees. The job here is only
 * to write honest ones, which is why they are derived from the same arrays that get written
 * rather than passed in.
 *
 * They are absent from `expenseSchema` (they are a rules artefact, not app data), so the write
 * payloads below are assembled as plain objects rather than as `Expense` literals.
 *
 * 🔴 The expense id is minted **before** the splits are computed, because it is the
 * `tieBreakSeed` that decides who absorbs the leftover minor unit. `newExpenseId()` exists so
 * a form can preview with the id it will actually save under — docs/07 requires the preview to
 * equal what gets stored, and with a different seed it would not.
 */

import {
  Timestamp,
  doc,
  limit as limitTo,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

import {
  computeSplits,
  DomainError,
  type ExactEntry,
  type PercentEntry,
  type ShareEntry,
  type SplitAllocation,
  type SplitInput,
} from '../domain/index.js';
import {
  MAX_GROUP_MEMBERS,
  allUnique,
  isCurrencyCode,
  isValidAmount,
  sumMinor,
  type CurrencyCode,
  type Expense,
  type ExpenseCategory,
  type Group,
  type GroupMember,
  type MinorUnits,
  type Payer,
  type Split,
} from '../types/index.js';
import { addComment, type CommentAuthor } from './commentRepo.js';
import { watchActiveMembers, watchGroupsForUser } from './groupRepo.js';
import { expenseDoc, expensesCollection, participatingExpensesQuery } from './refs.js';
import { watchDoc, watchQuery, type OnError, type OnNext, type Unsubscribe } from './subscribe.js';

/** Default page size for an expense list. docs/07: 25 per page. */
export const EXPENSE_PAGE_SIZE = 25;

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Draft shapes
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** One payer's contribution. Multiple payers are supported (AC-D1.4). */
export interface PayerDraft {
  readonly uid: string;
  readonly amountMinor: MinorUnits;
}

/**
 * How the expense is divided, tagged by method.
 *
 * Mirrors `SplitInput` from the split engine minus the total and the seed, which this module
 * supplies — a caller cannot accidentally preview against one seed and save against another.
 */
export type SplitDraft =
  | { readonly method: 'equal'; readonly uids: readonly string[] }
  | { readonly method: 'exact'; readonly amounts: readonly ExactEntry[] }
  | { readonly method: 'percent'; readonly percentages: readonly PercentEntry[] }
  | { readonly method: 'shares'; readonly shares: readonly ShareEntry[] };

/** Everything the form collects. `date` is the user's chosen date, not the write time. */
export interface ExpenseDraft {
  readonly groupId: string;
  readonly description: string;
  readonly amountMinor: MinorUnits;
  readonly currency: CurrencyCode;
  readonly category: ExpenseCategory;
  readonly date: Date;
  readonly paidBy: readonly PayerDraft[];
  readonly split: SplitDraft;
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Split preview — the same call the write makes
 * ────────────────────────────────────────────────────────────────────────────────────────── */

function toSplitInput(split: SplitDraft, totalMinor: MinorUnits, tieBreakSeed: string): SplitInput {
  switch (split.method) {
    case 'equal':
      return { method: 'equal', totalMinor, uids: split.uids, tieBreakSeed };
    case 'exact':
      return { method: 'exact', totalMinor, amounts: split.amounts };
    case 'percent':
      return { method: 'percent', totalMinor, percentages: split.percentages, tieBreakSeed };
    case 'shares':
      return { method: 'shares', totalMinor, shares: split.shares, tieBreakSeed };
  }
}

/**
 * The resolved shares for a draft, exactly as they would be stored.
 *
 * The form calls this for its live preview and this module calls it again on save, with the
 * same `expenseId`, so the two cannot disagree (docs/07 §Split sheet).
 *
 * @throws {DomainError} everything `computeSplits` throws.
 */
export function previewSplits(
  split: SplitDraft,
  totalMinor: MinorUnits,
  expenseId: string,
): SplitAllocation[] {
  return computeSplits(toSplitInput(split, totalMinor, expenseId));
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Client-side validation — UX only (Article IV), mirroring the seven invariants
 * ────────────────────────────────────────────────────────────────────────────────────────── */

function assertDraft(draft: ExpenseDraft): void {
  if (!isValidAmount(draft.amountMinor) || draft.amountMinor <= 0) {
    throw new DomainError('INVALID_AMOUNT', 'An expense amount must be a positive whole number.');
  }
  if (!isCurrencyCode(draft.currency)) {
    throw new DomainError('INVALID_AMOUNT', `Unknown currency code: ${draft.currency}.`);
  }
  const description = draft.description.trim();
  if (description.length < 1 || description.length > 100) {
    throw new DomainError('INVALID_AMOUNT', 'A description must be 1 to 100 characters.');
  }
  if (draft.paidBy.length < 1 || draft.paidBy.length > MAX_GROUP_MEMBERS) {
    throw new DomainError('NO_PARTICIPANTS', 'An expense needs between 1 and 50 payers.');
  }
  if (!allUnique(draft.paidBy.map((payer) => payer.uid))) {
    throw new DomainError('DUPLICATE_UID', 'A payer appears more than once.');
  }
  for (const payer of draft.paidBy) {
    if (!isValidAmount(payer.amountMinor) || payer.amountMinor <= 0) {
      throw new DomainError(
        'INVALID_AMOUNT',
        `Every payer must contribute a positive whole amount (${payer.uid}).`,
      );
    }
  }
  // Invariant 2. The rules layer only sees the checksum, so this is where a user finds out.
  const paidTotal = sumMinor(draft.paidBy.map((payer) => payer.amountMinor));
  if (paidTotal !== draft.amountMinor) {
    throw new DomainError(
      'EXACT_SUM_MISMATCH',
      `Payers total ${String(paidTotal)} but the expense is ${String(draft.amountMinor)}.`,
    );
  }
}

/**
 * Invariants 3, 5 and 7, checked against the arrays that are about to be written rather than
 * against the draft — so a split engine change could never slip a bad document past.
 */
function assertSplits(splits: readonly Split[], amountMinor: MinorUnits): void {
  if (splits.length < 1 || splits.length > MAX_GROUP_MEMBERS) {
    throw new DomainError('NO_PARTICIPANTS', 'An expense needs between 1 and 50 participants.');
  }
  if (!allUnique(splits.map((split) => split.uid))) {
    throw new DomainError('DUPLICATE_UID', 'A participant appears more than once.');
  }
  const total = sumMinor(splits.map((split) => split.amountMinor));
  if (total !== amountMinor) {
    throw new DomainError(
      'EXACT_SUM_MISMATCH',
      `Shares total ${String(total)} but the expense is ${String(amountMinor)}.`,
    );
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Writes
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Mint the id an expense will be written under.
 *
 * `doc()` with no path segment asks the SDK for a fresh id offline; nothing is written until
 * `createExpense`. Callers hold on to it so their preview and their save share a tie-break seed.
 */
export function newExpenseId(groupId: string): string {
  return doc(expensesCollection(groupId)).id;
}

/** The body both create and update assemble, minus the fields only one of them may set. */
function expenseBody(draft: ExpenseDraft, expenseId: string) {
  assertDraft(draft);

  const splits: Split[] = previewSplits(draft.split, draft.amountMinor, expenseId).map(
    (allocation) => ({
      uid: allocation.uid,
      amountMinor: allocation.amountMinor,
      rawValue: allocation.rawValue,
    }),
  );
  assertSplits(splits, draft.amountMinor);

  const paidBy: Payer[] = [...draft.paidBy]
    .map((payer) => ({ uid: payer.uid, amountMinor: payer.amountMinor }))
    .sort((a, b) => (a.uid < b.uid ? -1 : 1));

  return {
    id: expenseId,
    groupId: draft.groupId,
    description: draft.description.trim(),
    amountMinor: draft.amountMinor,
    currency: draft.currency,
    category: draft.category,
    date: Timestamp.fromDate(draft.date),
    paidBy,
    splitMethod: draft.split.method,
    splits,
    participantIds: splits.map((split) => split.uid),

    // Q1 Option A — the two fields Rules compare against `amountMinor`. Derived from the very
    // arrays above, so they cannot drift from what is written beside them.
    splitsTotalMinor: sumMinor(splits.map((split) => split.amountMinor)),
    paidTotalMinor: sumMinor(paidBy.map((payer) => payer.amountMinor)),

    fxRateToBase: null,
    amountInBaseMinor: null,
  };
}

/**
 * Create an expense and return its id.
 *
 * `createdAt` is `serverTimestamp()` because the rule pins it to `request.time` (T7); a client
 * clock would simply be denied. `commentCount` / `lastCommentAt` are seeded here so the
 * document parses before `onCommentWritten` has ever touched it.
 *
 * @param createdBy The signed-in uid. Rules require it to equal `request.auth.uid`.
 * @param expenseId Pre-minted id from {@link newExpenseId}, when the caller previewed with one.
 * @throws {DomainError} when the draft fails a client-side invariant.
 */
export async function createExpense(
  draft: ExpenseDraft,
  createdBy: string,
  expenseId: string = newExpenseId(draft.groupId),
): Promise<string> {
  const payload = {
    ...expenseBody(draft, expenseId),
    createdBy,
    createdAt: serverTimestamp(),
    updatedBy: null,
    updatedAt: serverTimestamp(),
    deletedAt: null,
    commentCount: 0,
    lastCommentAt: null,
  };

  await setDoc(expenseDoc(draft.groupId, expenseId), payload);
  return expenseId;
}

/**
 * Rewrite an expense in place. Creator or group admin only — the rule enforces ADR-11 and this
 * function does not second-guess it, so a screen that hides Edit is doing UX, not security.
 *
 * The tie-break seed stays the expense id, so re-saving an unchanged equal split hands the
 * leftover unit to the same person it did before (docs/04 §2.1).
 *
 * `createdBy`, `createdAt`, `groupId` and `currency` are in the rule's immutable list and are
 * therefore not part of the patch at all.
 */
export async function updateExpense(
  groupId: string,
  expenseId: string,
  draft: ExpenseDraft,
  updatedBy: string,
): Promise<void> {
  const {
    id: _id,
    groupId: _groupId,
    currency: _currency,
    ...patch
  } = expenseBody({ ...draft, groupId }, expenseId);

  await updateDoc(expenseDoc(groupId, expenseId), {
    ...patch,
    updatedBy,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Article V — soft delete. There is no hard delete of an expense; `allow delete: if false`.
 *
 * Setting `deletedAt` is an *update*, so it runs through the same ADR-11 gate as an edit.
 */
export async function softDeleteExpense(
  groupId: string,
  expenseId: string,
  updatedBy: string,
): Promise<void> {
  await updateDoc(expenseDoc(groupId, expenseId), {
    deletedAt: serverTimestamp(),
    updatedBy,
    updatedAt: serverTimestamp(),
  });
}

/** Undo the 5-second delete toast (AC-D3.3) — the inverse of {@link softDeleteExpense}. */
export async function restoreExpense(
  groupId: string,
  expenseId: string,
  updatedBy: string,
): Promise<void> {
  await updateDoc(expenseDoc(groupId, expenseId), {
    deletedAt: null,
    updatedBy,
    updatedAt: serverTimestamp(),
  });
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Reads
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** One expense. Emits `null` when it does not exist. Soft-deleted ones still emit. */
export function watchExpense(
  groupId: string,
  expenseId: string,
  onNext: OnNext<Expense | null>,
  onError: OnError,
): Unsubscribe {
  return watchDoc(expenseDoc(groupId, expenseId), onNext, onError);
}

/** A group's live expenses, newest first. Index: `deletedAt` ASC + `date` DESC. */
export function watchGroupExpenses(
  groupId: string,
  onNext: OnNext<readonly Expense[]>,
  onError: OnError,
  pageSize: number = EXPENSE_PAGE_SIZE,
): Unsubscribe {
  return watchQuery(
    query(
      expensesCollection(groupId),
      where('deletedAt', '==', null),
      orderBy('date', 'desc'),
      limitTo(pageSize),
    ),
    onNext,
    onError,
  );
}

/**
 * Every expense the user participates in, across groups.
 *
 * 🔴 The `participantIds` constraint comes from `participatingExpensesQuery` and is not
 * optional — the collection-group rule is satisfiable only from the query's own constraints,
 * so dropping it denies the whole query (threat T9). Extra constraints are fine, and the
 * three-field collection-group index in `firestore.indexes.json` covers this shape.
 */
export function watchMyExpenses(
  uid: string,
  onNext: OnNext<readonly Expense[]>,
  onError: OnError,
  pageSize: number = EXPENSE_PAGE_SIZE,
): Unsubscribe {
  return watchQuery(
    query(
      participatingExpensesQuery(uid),
      where('deletedAt', '==', null),
      orderBy('date', 'desc'),
      limitTo(pageSize),
    ),
    onNext,
    onError,
  );
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * The comment thread — ADR-11's other half, implemented in `commentRepo.ts`
 * ────────────────────────────────────────────────────────────────────────────────────────── *
 * 🔴 Nothing below touches Firestore. The thread is one implementation, in `commentRepo.ts`
 * (Article VI); these are the names the expense screens import, pointed at it.
 *
 * There is still no `updateComment` anywhere — `allow update: if false` (AC-D4.4, threat T12) —
 * and `deleteExpenseComment` is still the hard delete `firestore.rules` describes, because it is
 * now literally `deleteComment`.
 */

/** Flat and chronological, oldest first (AC-D4.5). See `commentRepo.watchComments`. */
export { watchComments as watchExpenseComments } from './commentRepo.js';

/** Remove your own comment (AC-D4.3). See `commentRepo.deleteComment`. */
export { deleteComment as deleteExpenseComment } from './commentRepo.js';

/**
 * Post one comment and return its id.
 *
 * The author snapshot and the text arrive separately here and together in `addComment`; this
 * joins them. Every check — the 1–500 length guard that produces the message the composer shows,
 * the `displayName` / `photoURL` parses, `createdAt == request.time` (threat T7) — happens there.
 */
export async function addExpenseComment(
  groupId: string,
  expenseId: string,
  author: CommentAuthor,
  text: string,
): Promise<string> {
  return addComment(groupId, expenseId, { ...author, text });
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Composer context — implemented in `groupRepo.ts`
 * ────────────────────────────────────────────────────────────────────────────────────────── *
 * The Add Expense form needs the group it is writing into and that group's members: the currency
 * the amount is denominated in, who can be a payer, and who can be a participant. Both reads are
 * group-shaped, and `groupRepo.ts` now exists and owns them. These two keep the names the
 * composer imports; neither holds a query (Article VI).
 */

/**
 * Groups the signed-in user may add an expense to, most recently active first.
 *
 * `includeImplicit: true`: a hidden 1:1 friend group (D2) is a group you may add an expense to —
 * D2 hides implicit groups from the **Groups tab**, not from the picker that would otherwise make
 * a second friend expense unreachable from the Add tab. Page size is `MY_GROUPS_PAGE_SIZE`, which
 * is the 50 this function used to hardcode and the 50 docs/03 §Query patterns specifies.
 *
 * The `memberIds array-contains` shape is not incidental: the group `list` rule is written
 * against `memberIds` precisely so a 50-group list does not blow the 20-access-call budget.
 */
export function watchExpenseGroups(
  uid: string,
  onNext: OnNext<readonly Group[]>,
  onError: OnError,
): Unsubscribe {
  return watchGroupsForUser(uid, onNext, onError, { includeImplicit: true });
}

/**
 * A group's members, name-ordered, with the ones who have left dropped.
 *
 * Read-only in every direction (Article III): `allow write: if false` on this subcollection is
 * what makes it impossible for a client to write its own `balanceMinor`.
 */
export function watchExpenseMembers(
  groupId: string,
  onNext: OnNext<readonly GroupMember[]>,
  onError: OnError,
): Unsubscribe {
  return watchActiveMembers(groupId, onNext, onError);
}
