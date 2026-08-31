/**
 * The Add/Edit Expense form as data: one state object, one pure derivation.
 *
 * Keeping the derivation out of the component is what makes the money side of this screen
 * testable without a DOM, and it is the only way the preview can be guaranteed to equal what
 * gets stored — **the previewed amounts come from `previewSplits`, which is the same call
 * `createExpense` makes, with the same expense id as the tie-break seed** (docs/07 §Split sheet,
 * docs/04 §2.5). There is no second allocator here, and no rounding of any kind.
 */

import {
  DEFAULT_EXPENSE_CATEGORY,
  computeSplits,
  sumMinor,
  type CurrencyCode,
  type ExactEntry,
  type Expense,
  type ExpenseCategory,
  type MinorUnits,
  type PercentEntry,
  type ShareEntry,
  type SplitAllocation,
  type SplitMethod,
} from '@splitsutra/core';

import {
  amountInputError,
  formatAmountInput,
  formatPercentInput,
  parsePercentInput,
  tryParseAmountInput,
} from './amount';

/** 100% in basis points. Mirrors `TOTAL_BASIS_POINTS`; percentages are never floats. */
const TOTAL_BPS = 10_000;

/* -------------------------------------------------------------------------- */
/* Draft shapes                                                               */
/* -------------------------------------------------------------------------- */
/*
 * Structural mirrors of `ExpenseDraft` / `SplitDraft` / `PayerDraft` in
 * `packages/core/src/repositories/expenseRepo.ts`. Declared here rather than imported so that
 * this module — the part with the arithmetic in it — depends only on the package root barrel
 * and can be exercised without a Firestore-carrying import in the way. `createExpense` accepts
 * the object below by structure.
 */

/** One payer's contribution (AC-D1.4). */
export interface PayerDraft {
  readonly uid: string;
  readonly amountMinor: MinorUnits;
}

export type SplitDraft =
  | { readonly method: 'equal'; readonly uids: readonly string[] }
  | { readonly method: 'exact'; readonly amounts: readonly ExactEntry[] }
  | { readonly method: 'percent'; readonly percentages: readonly PercentEntry[] }
  | { readonly method: 'shares'; readonly shares: readonly ShareEntry[] };

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

/**
 * The shares a draft resolves to — **the same call `createExpense` makes**, with the same
 * expense id as the tie-break seed, so the preview equals what gets stored (docs/07).
 *
 * @throws {DomainError} whatever `computeSplits` throws.
 */
export function previewSplits(
  split: SplitDraft,
  totalMinor: MinorUnits,
  expenseId: string,
): SplitAllocation[] {
  switch (split.method) {
    case 'equal':
      return computeSplits({
        method: 'equal',
        totalMinor,
        uids: split.uids,
        tieBreakSeed: expenseId,
      });
    case 'exact':
      return computeSplits({ method: 'exact', totalMinor, amounts: split.amounts });
    case 'percent':
      return computeSplits({
        method: 'percent',
        totalMinor,
        percentages: split.percentages,
        tieBreakSeed: expenseId,
      });
    case 'shares':
      return computeSplits({
        method: 'shares',
        totalMinor,
        shares: split.shares,
        tieBreakSeed: expenseId,
      });
  }
}

/**
 * How far into the future a user may date an expense. checklists/phase-06 §5: not > 1 day.
 *
 * Exported so the date field can hand the same bound to the calendar as `max`. One constant,
 * or the picker offers a day the form then refuses.
 */
export const MAX_FUTURE_DAYS = 1;

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

/** One row of the split sheet. All four methods share the row; each reads its own field. */
export interface ParticipantState {
  readonly uid: string;
  /** Whether this person is in the split at all. A zero share still counts as in (AC-D2.6). */
  readonly included: boolean;
  /** `exact` — what they owe, as typed. */
  readonly exactInput: string;
  /** `percent` — their percentage, as typed. */
  readonly percentInput: string;
  /** `shares` — their share count. */
  readonly shares: number;
}

export type PayerMode = 'single' | 'multiple';

export interface ExpenseFormState {
  readonly groupId: string | null;
  readonly description: string;
  readonly amountInput: string;
  readonly category: ExpenseCategory;
  /** `YYYY-MM-DD`. Kept as text so a half-typed date is a validation message, not a crash. */
  readonly dateInput: string;
  readonly splitMethod: SplitMethod;
  readonly participants: readonly ParticipantState[];
  readonly payerMode: PayerMode;
  readonly singlePayerUid: string;
  /** `uid → amount as typed`, used only in `multiple` mode. */
  readonly payerInputs: Readonly<Record<string, string>>;
}

/** `YYYY-MM-DD` in the viewer's own timezone — the date they would call today. */
export function toDateInput(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Local midnight for a `YYYY-MM-DD` string, or `null` when it is not a real date. */
export function fromDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value.trim());
  if (match === null) return null;

  const [, year, month, day] = match as unknown as [string, string, string, string];
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  // Rejects 2026-02-31, which `new Date` would roll forward into March.
  return toDateInput(date) === value.trim() ? date : null;
}

function blankParticipant(uid: string): ParticipantState {
  return { uid, included: true, exactInput: '', percentInput: '', shares: 1 };
}

/** A fresh form: everyone in, split equally, dated today, paid by you (docs/07 §AddExpense). */
export function initialFormState(options: {
  readonly groupId: string | null;
  readonly selfUid: string;
  readonly memberUids: readonly string[];
  readonly today: Date;
}): ExpenseFormState {
  return {
    groupId: options.groupId,
    description: '',
    amountInput: '',
    category: DEFAULT_EXPENSE_CATEGORY,
    dateInput: toDateInput(options.today),
    splitMethod: 'equal',
    participants: options.memberUids.map(blankParticipant),
    payerMode: 'single',
    singlePayerUid: options.selfUid,
    payerInputs: {},
  };
}

/**
 * Reconcile the participant rows with the group's current members.
 *
 * Called whenever the member list arrives or the chosen group changes. Rows the user has
 * already touched are preserved — switching group must not silently discard typed amounts for
 * people who are in both groups — and members who are no longer present are dropped.
 */
export function syncParticipants(
  state: ExpenseFormState,
  memberUids: readonly string[],
): ExpenseFormState {
  const existing = new Map(state.participants.map((participant) => [participant.uid, participant]));
  const participants = memberUids.map((uid) => existing.get(uid) ?? blankParticipant(uid));

  const unchanged =
    participants.length === state.participants.length &&
    participants.every((participant, index) => participant === state.participants[index]);

  return unchanged ? state : { ...state, participants };
}

/**
 * Restore a saved expense into the form.
 *
 * `rawValue` is what makes this honest: a percentage split reopens showing the percentages the
 * user typed, not percentages recomputed from the resolved amounts, which would drift
 * (docs/03 "Why `rawValue` exists").
 *
 * Members who are not currently in the split are included as unticked rows, so the edit screen
 * can add them — AC-D3.2's union of old and new participants.
 */
export function formStateFromExpense(
  expense: Expense,
  memberUids: readonly string[],
): ExpenseFormState {
  const bySplit = new Map(expense.splits.map((split) => [split.uid, split]));
  const uids = [...new Set([...expense.splits.map((split) => split.uid), ...memberUids])];

  const participants = uids.map((uid): ParticipantState => {
    const split = bySplit.get(uid);
    if (split === undefined) return { ...blankParticipant(uid), included: false };
    return {
      uid,
      included: true,
      exactInput: formatAmountInput(split.amountMinor, expense.currency),
      percentInput:
        expense.splitMethod === 'percent' ? formatPercentInput(split.rawValue ?? 0) : '',
      shares: expense.splitMethod === 'shares' ? (split.rawValue ?? 0) : 1,
    };
  });

  const payerInputs: Record<string, string> = {};
  for (const payer of expense.paidBy) {
    payerInputs[payer.uid] = formatAmountInput(payer.amountMinor, expense.currency);
  }

  return {
    groupId: expense.groupId,
    description: expense.description,
    amountInput: formatAmountInput(expense.amountMinor, expense.currency),
    category: expense.category,
    dateInput: toDateInput(expense.date.toDate()),
    splitMethod: expense.splitMethod,
    participants,
    payerMode: expense.paidBy.length > 1 ? 'multiple' : 'single',
    singlePayerUid: expense.paidBy[0]?.uid ?? '',
    payerInputs,
  };
}

/* -------------------------------------------------------------------------- */
/* Derivation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The live footer under the split sheet — the primary feedback mechanism (docs/07).
 *
 * Amounts travel as minor units rather than as formatted strings so the screen can render them
 * through `<Money>`, which is the only thing in this app allowed to turn an integer into words.
 */
export interface SplitFooter {
  /** Zero, one, or two amounts. Two means a range, e.g. an equal split with a leftover unit. */
  readonly amounts: readonly MinorUnits[];
  /** The words that go after the amounts. Never the only signal — see NFR-5. */
  readonly text: string;
  /** `true` blocks saving and colours the footer. */
  readonly danger: boolean;
}

export interface FormDerivation {
  readonly amountMinor: MinorUnits | null;
  readonly amountError: string | null;
  readonly descriptionError: string | null;
  readonly date: Date | null;
  readonly dateError: string | null;
  readonly payers: readonly PayerDraft[] | null;
  readonly payerError: string | null;
  /** `total − sum(payers)`, for the multiple-payers remainder line. `null` when not applicable. */
  readonly payerRemainingMinor: number | null;
  /** Resolved shares, straight from the split engine. `null` when the split is not yet valid. */
  readonly allocations: readonly SplitAllocation[] | null;
  readonly splitError: string | null;
  readonly footer: SplitFooter;
  /** Non-null only when every field above is valid. Save is enabled exactly when this is set. */
  readonly draft: ExpenseDraft | null;
}

export interface DeriveOptions {
  readonly currency: CurrencyCode;
  /** The id the expense will be saved under — the split engine's tie-break seed. */
  readonly expenseId: string;
  readonly today: Date;
}

function includedParticipants(state: ExpenseFormState): readonly ParticipantState[] {
  return state.participants.filter((participant) => participant.included);
}

/** The split as the repository wants it, or a message explaining what the user still owes. */
function buildSplit(
  state: ExpenseFormState,
  currency: CurrencyCode,
): { split: SplitDraft | null; error: string | null } {
  const chosen = includedParticipants(state);
  if (chosen.length === 0) {
    return { split: null, error: 'Choose at least one person to split this with.' };
  }

  switch (state.splitMethod) {
    case 'equal':
      return { split: { method: 'equal', uids: chosen.map((p) => p.uid) }, error: null };

    case 'exact': {
      const amounts = chosen.map((participant) => ({
        uid: participant.uid,
        amountMinor:
          participant.exactInput.trim() === ''
            ? 0
            : (tryParseAmountInput(participant.exactInput, currency) ?? -1),
      }));
      if (amounts.some((entry) => entry.amountMinor < 0)) {
        return { split: null, error: 'One of the amounts is not a number.' };
      }
      return { split: { method: 'exact', amounts }, error: null };
    }

    case 'percent': {
      try {
        const percentages = chosen.map((participant) => ({
          uid: participant.uid,
          bps: parsePercentInput(participant.percentInput),
        }));
        return { split: { method: 'percent', percentages }, error: null };
      } catch (cause: unknown) {
        return {
          split: null,
          error: cause instanceof Error ? cause.message : 'Invalid percentage.',
        };
      }
    }

    case 'shares':
      return {
        split: {
          method: 'shares',
          shares: chosen.map((participant) => ({
            uid: participant.uid,
            shares: participant.shares,
          })),
        },
        error: null,
      };
  }
}

/** The footer copy for each method. Save is blocked exactly when `danger` is true. */
function buildFooter(
  state: ExpenseFormState,
  split: SplitDraft | null,
  allocations: readonly SplitAllocation[] | null,
  amountMinor: MinorUnits | null,
): SplitFooter {
  const people = includedParticipants(state).length;
  const peopleLabel = people === 1 ? '1 person' : `${String(people)} people`;

  if (state.splitMethod === 'exact' && split?.method === 'exact') {
    const assigned = sumMinor(split.amounts.map((entry) => entry.amountMinor));
    const remaining = (amountMinor ?? 0) - assigned;
    if (remaining === 0)
      return { amounts: [], text: `All assigned · ${peopleLabel}`, danger: false };
    return {
      amounts: [Math.abs(remaining) as MinorUnits],
      text: remaining > 0 ? 'left to assign' : 'over-assigned',
      danger: true,
    };
  }

  if (state.splitMethod === 'percent' && split?.method === 'percent') {
    const assigned = split.percentages.reduce((sum, entry) => sum + entry.bps, 0);
    const remaining = TOTAL_BPS - assigned;
    if (remaining === 0)
      return { amounts: [], text: `100% assigned · ${peopleLabel}`, danger: false };
    return {
      amounts: [],
      text:
        remaining > 0
          ? `${formatPercentInput(remaining)}% remaining`
          : `${formatPercentInput(-remaining)}% over 100%`,
      danger: true,
    };
  }

  if (state.splitMethod === 'shares' && split?.method === 'shares') {
    const total = split.shares.reduce((sum, entry) => sum + entry.shares, 0);
    if (total <= 0) return { amounts: [], text: 'Give at least one person a share.', danger: true };
    const shareLabel = total === 1 ? '1 share' : `${String(total)} shares`;
    return { amounts: [], text: `${shareLabel} across ${peopleLabel}`, danger: false };
  }

  if (allocations === null || allocations.length === 0) {
    return { amounts: [], text: `Split equally · ${peopleLabel}`, danger: false };
  }

  // Equal split. The range appears only when the total does not divide evenly, which is exactly
  // when the leftover minor unit has been handed to somebody — showing one number would be a lie.
  const values = allocations.map((allocation) => allocation.amountMinor);
  const low = Math.min(...values) as MinorUnits;
  const high = Math.max(...values) as MinorUnits;
  return {
    amounts: low === high ? [low] : [low, high],
    text: `per person · ${peopleLabel}`,
    danger: false,
  };
}

/** Payers, or the reason they are not usable yet. */
function buildPayers(
  state: ExpenseFormState,
  currency: CurrencyCode,
  amountMinor: MinorUnits | null,
): { payers: readonly PayerDraft[] | null; remaining: number | null; error: string | null } {
  if (state.payerMode === 'single') {
    if (state.singlePayerUid === '') {
      return { payers: null, remaining: null, error: 'Choose who paid.' };
    }
    if (amountMinor === null) return { payers: null, remaining: null, error: null };
    return {
      payers: [{ uid: state.singlePayerUid, amountMinor }],
      remaining: 0,
      error: null,
    };
  }

  const entries = Object.entries(state.payerInputs)
    .map(([uid, input]) => ({ uid, amountMinor: tryParseAmountInput(input, currency) }))
    .filter((entry) => entry.amountMinor !== null && entry.amountMinor > 0);

  if (entries.length === 0) {
    return { payers: null, remaining: amountMinor, error: 'Enter what each person paid.' };
  }

  const payers = entries.map((entry) => ({
    uid: entry.uid,
    amountMinor: entry.amountMinor as MinorUnits,
  }));
  const paid = sumMinor(payers.map((payer) => payer.amountMinor));
  const remaining = amountMinor === null ? null : amountMinor - paid;

  if (remaining !== null && remaining !== 0) {
    return { payers: null, remaining, error: null };
  }
  return { payers, remaining, error: null };
}

/**
 * Everything the screen renders, derived from the form state in one pass.
 *
 * Pure and total: it never throws. A `DomainError` out of the split engine — percentages that
 * do not reach 100%, exact amounts that do not sum, every share left at zero — is caught and
 * turned into `splitError`, because those are all things a user is in the middle of fixing.
 */
export function deriveExpenseForm(state: ExpenseFormState, options: DeriveOptions): FormDerivation {
  const { currency, expenseId, today } = options;

  const amountMinor = tryParseAmountInput(state.amountInput, currency);
  const amountError = amountInputError(state.amountInput, currency);

  const description = state.description.trim();
  const descriptionError =
    description.length > 100 ? 'Keep the description to 100 characters or fewer.' : null;

  const date = fromDateInput(state.dateInput);
  const latest = new Date(today.getFullYear(), today.getMonth(), today.getDate() + MAX_FUTURE_DAYS);
  const dateError =
    date === null
      ? 'Use a real date, written as YYYY-MM-DD.'
      : date.getTime() > latest.getTime()
        ? 'An expense cannot be dated more than a day ahead.'
        : null;

  const { split, error: splitError } = buildSplit(state, currency);

  let allocations: readonly SplitAllocation[] | null = null;
  if (split !== null && amountMinor !== null && splitError === null) {
    try {
      allocations = previewSplits(split, amountMinor, expenseId);
    } catch {
      // Expected while the user is still typing — percentages that do not reach 100%, exact
      // amounts mid-entry. The footer already says what is missing, so the engine's
      // developer-facing message is deliberately not surfaced.
      allocations = null;
    }
  }

  const footer = buildFooter(state, split, allocations, amountMinor);
  const { payers, remaining, error: payerError } = buildPayers(state, currency, amountMinor);

  const groupId = state.groupId;
  const complete =
    groupId !== null &&
    amountMinor !== null &&
    amountError === null &&
    description.length >= 1 &&
    descriptionError === null &&
    date !== null &&
    dateError === null &&
    split !== null &&
    splitError === null &&
    allocations !== null &&
    !footer.danger &&
    payers !== null &&
    payerError === null;

  return {
    amountMinor,
    amountError,
    descriptionError,
    date,
    dateError,
    payers,
    payerError,
    payerRemainingMinor: remaining,
    allocations,
    splitError,
    footer,
    draft:
      complete && split !== null && payers !== null && date !== null && amountMinor !== null
        ? {
            groupId,
            description,
            amountMinor,
            currency,
            category: state.category,
            date,
            paidBy: payers,
            split,
          }
        : null,
  };
}
