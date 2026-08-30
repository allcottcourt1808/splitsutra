/**
 * The Add/Edit form as data — the money-bearing half of the expense tab, tested without a DOM.
 *
 * Article X: this is where the arithmetic on this tab is proven. The screen tests beside it
 * only check that the screen hands these functions the right inputs and does the right thing
 * with the answer.
 *
 * Two properties get the most attention here because the rules layer depends on them:
 *
 * - **The two-layer integrity check.** `splitsTotalMinor` / `paidTotalMinor` are written by
 *   `expenseRepo` from the very arrays it stores, and the rule asserts both equal
 *   `amountMinor`. A draft this module hands back must therefore already satisfy
 *   `sum(previewSplits(draft)) === sum(draft.paidBy) === draft.amountMinor`, or the save is a
 *   guaranteed denial. Every draft assertion below goes through `expectChecksums`.
 * - **`participantIds`** is `splits.map(s => s.uid)` — the collection-group rule and the index
 *   both read it — so who is in the split has to follow the form exactly.
 *
 * (`.tsx` rather than `.ts` because the root Vitest config gives `*.test.ts` to the `unit`
 * project, which is rooted at `packages/core`. See the note in `amount.test.tsx`.)
 */

import { describe, expect, it } from 'vitest';

import {
  computeSplits,
  sumMinor,
  type CurrencyCode,
  type Expense,
  type MinorUnits,
} from '@splitsutra/core';

import {
  deriveExpenseForm,
  formStateFromExpense,
  fromDateInput,
  initialFormState,
  previewSplits,
  syncParticipants,
  toDateInput,
  type ExpenseDraft,
  type ExpenseFormState,
  type ParticipantState,
} from '../formState';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Fixtures
 * ────────────────────────────────────────────────────────────────────────────────────────── */

const TODAY = new Date(2026, 7, 29);
const EID = 'e-fixed';
const USD: CurrencyCode = 'USD';

function participant(uid: string, overrides: Partial<ParticipantState> = {}): ParticipantState {
  return { uid, included: true, exactInput: '', percentInput: '', shares: 1, ...overrides };
}

function formState(overrides: Partial<ExpenseFormState> = {}): ExpenseFormState {
  return {
    groupId: 'g1',
    description: 'Dinner at Olive',
    amountInput: '30.00',
    category: 'food',
    dateInput: toDateInput(TODAY),
    splitMethod: 'equal',
    participants: [participant('u1'), participant('u2'), participant('u3')],
    payerMode: 'single',
    singlePayerUid: 'u1',
    payerInputs: {},
    ...overrides,
  };
}

function derive(state: ExpenseFormState, expenseId: string = EID) {
  return deriveExpenseForm(state, { currency: USD, expenseId, today: TODAY });
}

/** The uid → amount map the engine resolves a draft to, keyed for readable assertions. */
function resolved(draft: ExpenseDraft, expenseId: string = EID): Record<string, number> {
  return Object.fromEntries(
    previewSplits(draft.split, draft.amountMinor, expenseId).map((a) => [a.uid, a.amountMinor]),
  );
}

/**
 * 🔴 The two checksums the Security Rules compare against `amountMinor`.
 *
 * `expenseRepo` derives them from the arrays it writes, so a draft that fails this would be
 * denied at the rules layer — and quarantined by `onExpenseWritten` if it somehow were not.
 */
function expectChecksums(draft: ExpenseDraft, expenseId: string = EID): void {
  const splits = previewSplits(draft.split, draft.amountMinor, expenseId);

  expect(sumMinor(splits.map((split) => split.amountMinor))).toBe(draft.amountMinor);
  expect(sumMinor(draft.paidBy.map((payer) => payer.amountMinor))).toBe(draft.amountMinor);
}

/** A stored expense, shaped for `formStateFromExpense` — only the fields it reads are real. */
function expenseWith(overrides: Partial<Expense> = {}): Expense {
  const date = new Date(2026, 6, 4);
  return {
    id: EID,
    groupId: 'g1',
    description: 'Dinner at Olive',
    amountMinor: 3000,
    currency: USD,
    category: 'food',
    date: { toDate: () => date, toMillis: () => date.getTime() },
    paidBy: [{ uid: 'u1', amountMinor: 3000 }],
    splitMethod: 'equal',
    splits: [
      { uid: 'u1', amountMinor: 1000, rawValue: null },
      { uid: 'u2', amountMinor: 1000, rawValue: null },
      { uid: 'u3', amountMinor: 1000, rawValue: null },
    ],
    participantIds: ['u1', 'u2', 'u3'],
    createdBy: 'u1',
    deletedAt: null,
    ...overrides,
  } as unknown as Expense;
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Dates
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('date fields', () => {
  it('round-trips a local date without crossing a timezone', () => {
    expect(fromDateInput(toDateInput(TODAY))?.getTime()).toBe(TODAY.getTime());
  });

  it('rejects a date that does not exist rather than rolling it forward', () => {
    expect(fromDateInput('2026-02-31')).toBeNull();
    expect(fromDateInput('29-08-2026')).toBeNull();
    expect(fromDateInput('')).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Initial state and participant reconciliation
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('initialFormState', () => {
  it('defaults to everyone in, split equally, dated today, paid by you', () => {
    const state = initialFormState({
      groupId: 'g1',
      selfUid: 'u1',
      memberUids: ['u1', 'u2'],
      today: TODAY,
    });

    expect(state.splitMethod).toBe('equal');
    expect(state.dateInput).toBe(toDateInput(TODAY));
    expect(state.singlePayerUid).toBe('u1');
    expect(state.payerMode).toBe('single');
    expect(state.participants.every((p) => p.included)).toBe(true);
    expect(state.participants.map((p) => p.uid)).toEqual(['u1', 'u2']);
  });
});

describe('syncParticipants', () => {
  it('keeps what the user already typed for people who are still members', () => {
    const state = formState({
      participants: [participant('u1', { exactInput: '12.00' }), participant('u2')],
    });

    const next = syncParticipants(state, ['u1', 'u2', 'u3']);

    expect(next.participants.map((p) => p.uid)).toEqual(['u1', 'u2', 'u3']);
    expect(next.participants[0]?.exactInput).toBe('12.00');
  });

  it('drops rows for people who are no longer in the group', () => {
    const next = syncParticipants(formState(), ['u1']);

    expect(next.participants.map((p) => p.uid)).toEqual(['u1']);
  });

  it('returns the same object when nothing moved, so React does not re-render', () => {
    const state = formState();

    expect(syncParticipants(state, ['u1', 'u2', 'u3'])).toBe(state);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Seeding the form from a stored expense
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('formStateFromExpense', () => {
  it('restores the amount, description, category and date as editable text', () => {
    const state = formStateFromExpense(expenseWith(), ['u1', 'u2', 'u3']);

    expect(state.amountInput).toBe('30.00');
    expect(state.description).toBe('Dinner at Olive');
    expect(state.category).toBe('food');
    expect(state.dateInput).toBe('2026-07-04');
    expect(state.groupId).toBe('g1');
  });

  it('restores percentages as they were typed, not recomputed from the amounts', () => {
    // 🔴 docs/03 "Why rawValue exists". 333/1000 recomputed reads 33.3%, not the 33.33% typed.
    const state = formStateFromExpense(
      expenseWith({
        amountMinor: 1000 as MinorUnits,
        splitMethod: 'percent',
        splits: [
          { uid: 'u1', amountMinor: 333 as MinorUnits, rawValue: 3333 },
          { uid: 'u2', amountMinor: 333 as MinorUnits, rawValue: 3333 },
          { uid: 'u3', amountMinor: 334 as MinorUnits, rawValue: 3334 },
        ],
      }),
      ['u1', 'u2', 'u3'],
    );

    expect(state.splitMethod).toBe('percent');
    expect(state.participants.map((p) => p.percentInput)).toEqual(['33.33', '33.33', '33.34']);
  });

  it('restores share counts', () => {
    const state = formStateFromExpense(
      expenseWith({
        amountMinor: 10_000 as MinorUnits,
        splitMethod: 'shares',
        splits: [
          { uid: 'u1', amountMinor: 5000 as MinorUnits, rawValue: 2 },
          { uid: 'u2', amountMinor: 2500 as MinorUnits, rawValue: 1 },
          { uid: 'u3', amountMinor: 2500 as MinorUnits, rawValue: 1 },
        ],
      }),
      ['u1', 'u2', 'u3'],
    );

    expect(state.participants.map((p) => p.shares)).toEqual([2, 1, 1]);
  });

  it('lists current members who are not in the split as unticked rows (AC-D3.2)', () => {
    const state = formStateFromExpense(
      expenseWith({
        splits: [
          { uid: 'u1', amountMinor: 1500 as MinorUnits, rawValue: null },
          { uid: 'u2', amountMinor: 1500 as MinorUnits, rawValue: null },
        ],
      }),
      ['u1', 'u2', 'u4'],
    );

    expect(state.participants.map((p) => [p.uid, p.included])).toEqual([
      ['u1', true],
      ['u2', true],
      ['u4', false],
    ]);
  });

  it('keeps a participant who has since left the group, so the total still adds up', () => {
    const state = formStateFromExpense(expenseWith(), ['u1', 'u2']);

    expect(state.participants.map((p) => p.uid)).toEqual(['u1', 'u2', 'u3']);
    expect(state.participants.every((p) => p.included)).toBe(true);
  });

  it('reopens in multiple-payer mode when more than one person paid', () => {
    const state = formStateFromExpense(
      expenseWith({
        paidBy: [
          { uid: 'u1', amountMinor: 2000 as MinorUnits },
          { uid: 'u2', amountMinor: 1000 as MinorUnits },
        ],
      }),
      ['u1', 'u2', 'u3'],
    );

    expect(state.payerMode).toBe('multiple');
    expect(state.payerInputs).toEqual({ u1: '20.00', u2: '10.00' });
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Derivation — the preview, and the draft
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('deriveExpenseForm — the preview is the split engine', () => {
  it('previews with the engine itself, not an approximation', () => {
    // 🔴 Article VI. $100 / 3 is 3334 / 3333 / 3333, and the preview must be that, to the unit.
    const derivation = derive(formState({ amountInput: '100.00' }));

    expect(derivation.allocations).toEqual(
      computeSplits({
        method: 'equal',
        totalMinor: 10_000 as MinorUnits,
        uids: ['u1', 'u2', 'u3'],
        tieBreakSeed: EID,
      }),
    );
    expect(
      sumMinor((derivation.allocations ?? []).map((allocation) => allocation.amountMinor)),
    ).toBe(10_000);
  });

  it('moves the leftover unit with the expense id, and never within one', () => {
    const state = formState({ amountInput: '100.00' });
    const recipients = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map((eid) => {
      const allocations = derive(state, eid).allocations ?? [];
      return allocations.find((allocation) => allocation.amountMinor === 3334)?.uid;
    });

    expect(new Set(recipients).size).toBeGreaterThan(1);
    expect(derive(state, 'e1').allocations).toEqual(derive(state, 'e1').allocations);
  });

  it('never throws while the user is mid-typing an invalid split', () => {
    const derivation = derive(
      formState({
        splitMethod: 'percent',
        participants: [
          participant('u1', { percentInput: '50' }),
          participant('u2', { percentInput: '20' }),
        ],
      }),
    );

    expect(derivation.allocations).toBeNull();
    expect(derivation.draft).toBeNull();
    expect(derivation.footer.danger).toBe(true);
    expect(derivation.footer.text).toContain('30% remaining');
  });
});

describe('deriveExpenseForm — the draft and its checksums', () => {
  it('produces a draft whose splits and payers both total the amount', () => {
    const derivation = derive(formState({ amountInput: '100.00' }));
    const draft = derivation.draft;

    expect(draft).not.toBeNull();
    expectChecksums(draft as ExpenseDraft);
  });

  it('holds the checksums for every split method', () => {
    const cases: readonly ExpenseFormState[] = [
      formState({ amountInput: '100.00' }),
      formState({
        amountInput: '100.00',
        splitMethod: 'exact',
        participants: [
          participant('u1', { exactInput: '50.00' }),
          participant('u2', { exactInput: '30.00' }),
          participant('u3', { exactInput: '20.00' }),
        ],
      }),
      formState({
        amountInput: '10.00',
        splitMethod: 'percent',
        participants: [
          participant('u1', { percentInput: '33.33' }),
          participant('u2', { percentInput: '33.33' }),
          participant('u3', { percentInput: '33.34' }),
        ],
      }),
      formState({
        amountInput: '100.00',
        splitMethod: 'shares',
        participants: [
          participant('u1', { shares: 2 }),
          participant('u2', { shares: 1 }),
          participant('u3', { shares: 1 }),
        ],
      }),
    ];

    for (const state of cases) {
      const draft = derive(state).draft;
      expect(draft).not.toBeNull();
      expectChecksums(draft as ExpenseDraft);
    }
  });

  it('resolves percentages and shares to the amounts docs/04 specifies', () => {
    const percent = derive(
      formState({
        amountInput: '10.00',
        splitMethod: 'percent',
        participants: [
          participant('u1', { percentInput: '33.33' }),
          participant('u2', { percentInput: '33.33' }),
          participant('u3', { percentInput: '33.34' }),
        ],
      }),
    ).draft;
    const shares = derive(
      formState({
        amountInput: '100.00',
        splitMethod: 'shares',
        participants: [
          participant('u1', { shares: 2 }),
          participant('u2', { shares: 1 }),
          participant('u3', { shares: 1 }),
        ],
      }),
    ).draft;

    expect(resolved(percent as ExpenseDraft)).toEqual({ u1: 333, u2: 333, u3: 334 });
    expect(resolved(shares as ExpenseDraft)).toEqual({ u1: 5000, u2: 2500, u3: 2500 });
  });

  it('carries exactly the ticked participants — the array participantIds is built from', () => {
    // 🔴 The collection-group rule and the index both read participantIds; excluding someone
    // here is what removes them from every "expenses I am in" query.
    const draft = derive(
      formState({
        amountInput: '20.00',
        participants: [
          participant('u1'),
          participant('u2'),
          participant('u3', { included: false }),
        ],
      }),
    ).draft;

    expect(draft?.split).toEqual({ method: 'equal', uids: ['u1', 'u2'] });
    expect(Object.keys(resolved(draft as ExpenseDraft))).toEqual(['u1', 'u2']);
    expectChecksums(draft as ExpenseDraft);
  });

  it('keeps a zero-share participant in the split (AC-D2.6)', () => {
    const draft = derive(
      formState({
        amountInput: '20.00',
        splitMethod: 'exact',
        participants: [
          participant('u1', { exactInput: '20.00' }),
          participant('u2', { exactInput: '' }),
        ],
      }),
    ).draft;

    expect(resolved(draft as ExpenseDraft)).toEqual({ u1: 2000, u2: 0 });
  });

  it('blocks the draft until exact amounts reach the total', () => {
    const short = derive(
      formState({
        amountInput: '100.00',
        splitMethod: 'exact',
        participants: [
          participant('u1', { exactInput: '50.00' }),
          participant('u2', { exactInput: '30.00' }),
        ],
      }),
    );

    expect(short.draft).toBeNull();
    expect(short.footer.danger).toBe(true);
    expect(short.footer.amounts).toEqual([2000]);
    expect(short.footer.text).toBe('left to assign');
  });

  it('blocks the draft when the payers do not add up to the total', () => {
    const derivation = derive(
      formState({
        amountInput: '100.00',
        payerMode: 'multiple',
        payerInputs: { u1: '60.00', u2: '30.00' },
      }),
    );

    expect(derivation.draft).toBeNull();
    expect(derivation.payerRemainingMinor).toBe(1000);
  });

  it('accepts several payers once they do add up', () => {
    const draft = derive(
      formState({
        amountInput: '100.00',
        payerMode: 'multiple',
        payerInputs: { u1: '60.00', u2: '40.00' },
      }),
    ).draft;

    expect(draft?.paidBy).toEqual([
      { uid: 'u1', amountMinor: 6000 },
      { uid: 'u2', amountMinor: 4000 },
    ]);
    expectChecksums(draft as ExpenseDraft);
  });

  it('refuses an empty split, a bad amount, an over-long description and a future date', () => {
    expect(derive(formState({ participants: [] })).splitError).toContain('at least one person');
    expect(derive(formState({ amountInput: '1.234' })).amountError).toMatch(/decimal places/u);
    expect(derive(formState({ description: 'x'.repeat(101) })).descriptionError).not.toBeNull();
    expect(derive(formState({ dateInput: '2026-09-30' })).dateError).toMatch(/day ahead/u);
    expect(derive(formState({ description: '  ' })).draft).toBeNull();
  });

  it('allows tomorrow, which is the documented edge of the date rule', () => {
    expect(derive(formState({ dateInput: '2026-08-30' })).dateError).toBeNull();
    expect(derive(formState({ dateInput: '2026-08-31' })).dateError).not.toBeNull();
  });

  it('round-trips a stored expense back into an identical draft', () => {
    // The edit screen's whole contract: open, change nothing, save the same numbers.
    const expense = expenseWith();
    const state = formStateFromExpense(expense, ['u1', 'u2', 'u3']);
    const draft = deriveExpenseForm(state, {
      currency: expense.currency,
      expenseId: expense.id,
      today: TODAY,
    }).draft;

    expect(draft?.amountMinor).toBe(expense.amountMinor);
    expect(draft?.description).toBe(expense.description);
    expect(draft?.paidBy).toEqual([{ uid: 'u1', amountMinor: 3000 }]);
    expect(resolved(draft as ExpenseDraft, expense.id)).toEqual({ u1: 1000, u2: 1000, u3: 1000 });
    expectChecksums(draft as ExpenseDraft, expense.id);
  });
});
