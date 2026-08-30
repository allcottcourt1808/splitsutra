/**
 * `/expense/:gid/:eid/edit` — the same form as Add, seeded from a stored expense.
 *
 * Four things are load-bearing here and each has a test below:
 *
 * - **ADR-11, both ways.** The creator and a group admin get the form; everyone else gets an
 *   explanation. A form that renders and then dies on a rules denial reads as a broken app.
 * - **The checksums.** An edit rewrites `splits` and `paidBy`, so `splitsTotalMinor` and
 *   `paidTotalMinor` — which `expenseRepo` derives from those very arrays, and which the rule
 *   compares against `amountMinor` — have to be recomputed from the new numbers, not carried
 *   over from the old ones.
 * - **`participantIds`.** It is `splits.map(s => s.uid)`, and the collection-group rule and
 *   index both depend on it, so changing who is involved has to change that array.
 * - **The tie-break seed stays the expense id.** Re-saving an unchanged equal split must hand
 *   the leftover minor unit to the same person it did before (docs/04 §2.1).
 *
 * Article V: the Delete action here is a soft delete, like every other delete of an expense.
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import {
  computeSplits,
  sumMinor,
  type Expense,
  type GroupMember,
  type MinorUnits,
} from '@splitsutra/core';

import { render } from '../../__tests__/helpers/render';
import { paths } from '../../navigation/paths';
import { previewSplits, type ExpenseDraft } from '../expense/formState';
import { EditExpenseScreen } from '../EditExpenseScreen';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Seams
 * ────────────────────────────────────────────────────────────────────────────────────────── */

const seam = vi.hoisted(() => ({
  selfUid: 'u1',
  expense: null as unknown,
  loading: false,
  error: null as Error | null,
  members: null as unknown,
  membersFail: null as unknown,
  updateExpense: vi.fn(),
  softDeleteExpense: vi.fn(),
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useAuth: () => ({ user: { uid: seam.selfUid } }),
  useExpense: () => ({ expense: seam.expense, loading: seam.loading, error: seam.error }),
}));

vi.mock('@splitsutra/core/repositories', () => ({
  updateExpense: (...args: unknown[]) => seam.updateExpense(...args) as unknown,
  softDeleteExpense: (...args: unknown[]) => seam.softDeleteExpense(...args) as unknown,
  watchExpenseMembers: (_groupId: string, next: unknown, fail: unknown) => {
    seam.members = next;
    seam.membersFail = fail;
    return vi.fn();
  },
}));

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Fixtures
 * ────────────────────────────────────────────────────────────────────────────────────────── */

const EID = 'e1';

function stamp(): { toDate: () => Date; toMillis: () => number } {
  const date = new Date(2026, 6, 4);
  return { toDate: () => date, toMillis: () => date.getTime() };
}

const MEMBERS = [
  { uid: 'u1', displayName: 'Neethu', photoURL: null, role: 'member' },
  { uid: 'u2', displayName: 'Priya Sharma', photoURL: null, role: 'member' },
  { uid: 'u3', displayName: 'Ravi Kumar', photoURL: null, role: 'admin' },
] as unknown as GroupMember[];

function expenseWith(overrides: Record<string, unknown> = {}): Expense {
  return {
    id: EID,
    groupId: 'g1',
    description: 'Dinner at Olive',
    amountMinor: 3000,
    currency: 'USD',
    category: 'food',
    date: stamp(),
    paidBy: [{ uid: 'u1', amountMinor: 3000 }],
    splitMethod: 'equal',
    splits: [
      { uid: 'u1', amountMinor: 1000, rawValue: null },
      { uid: 'u2', amountMinor: 1000, rawValue: null },
      { uid: 'u3', amountMinor: 1000, rawValue: null },
    ],
    participantIds: ['u1', 'u2', 'u3'],
    createdBy: 'u1',
    createdAt: stamp(),
    updatedBy: null,
    updatedAt: stamp(),
    deletedAt: null,
    commentCount: 0,
    lastCommentAt: null,
    ...overrides,
  } as unknown as Expense;
}

const routes: RouteObject[] = [
  { path: '/expense/:gid/:eid/edit', element: <EditExpenseScreen /> },
  { path: '/expense/:gid/:eid', element: <p>Landed on the expense</p> },
  { path: '/groups/:gid', element: <p>Landed on the group</p> },
  { path: '/groups', element: <p>Landed on the group list</p> },
];

/** Mount without answering the member subscription — the pre-first-snapshot screen. */
function visit(): HTMLElement {
  const memory = createMemoryRouter(routes, {
    initialEntries: [paths.EditExpense({ gid: 'g1', eid: EID })],
  });
  return render(<RouterProvider router={memory} />).container;
}

function emitMembers(members: readonly GroupMember[] = MEMBERS): void {
  act(() => {
    (seam.members as ((value: readonly GroupMember[]) => void) | null)?.(members);
  });
}

function visitLoaded(members: readonly GroupMember[] = MEMBERS): HTMLElement {
  const container = visit();
  emitMembers(members);
  return container;
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * DOM helpers
 * ────────────────────────────────────────────────────────────────────────────────────────── */

function field(container: HTMLElement, label: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label')].find(
    (candidate) => (candidate.textContent ?? '').trim() === label,
  );
  const input = found === undefined ? null : document.getElementById(found.htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error(`no field labelled "${label}"`);
  return input;
}

function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (candidate) => (candidate.textContent ?? '').trim() === text,
  );
  if (found === undefined) throw new Error(`no button labelled "${text}"`);
  return found;
}

function includeToggles(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((candidate) =>
    ['✓', '○'].includes((candidate.textContent ?? '').trim()),
  );
}

function press(element: HTMLElement): void {
  act(() => {
    element.click();
  });
}

async function pressAndSettle(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}

function savedCall(): { gid: string; eid: string; draft: ExpenseDraft; uid: string } {
  const call = seam.updateExpense.mock.calls.at(-1);
  if (call === undefined) throw new Error('updateExpense was never called');
  return {
    gid: call[0] as string,
    eid: call[1] as string,
    draft: call[2] as ExpenseDraft,
    uid: call[3] as string,
  };
}

/**
 * 🔴 The pair Security Rules compare against `amountMinor`, recomputed from the edited draft.
 *
 * `expenseRepo.updateExpense` writes `splitsTotalMinor` / `paidTotalMinor` from the arrays it
 * resolves out of this draft, so if these do not hold, the update is denied at the rules layer
 * and quarantined by `onExpenseWritten` if it somehow were not.
 */
function expectRecomputedChecksums(draft: ExpenseDraft): readonly string[] {
  const splits = previewSplits(draft.split, draft.amountMinor, EID);

  expect(sumMinor(splits.map((split) => split.amountMinor))).toBe(draft.amountMinor);
  expect(sumMinor(draft.paidBy.map((payer) => payer.amountMinor))).toBe(draft.amountMinor);

  // participantIds is exactly this, and the collection-group rule and index both read it.
  return splits.map((split) => split.uid);
}

beforeEach(() => {
  seam.selfUid = 'u1';
  seam.expense = expenseWith();
  seam.loading = false;
  seam.error = null;
  seam.members = null;
  seam.membersFail = null;
  seam.updateExpense = vi.fn().mockResolvedValue(undefined);
  seam.softDeleteExpense = vi.fn().mockResolvedValue(undefined);
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Tests
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('<EditExpenseScreen> — loading, error, missing, deleted', () => {
  it('says it is loading until both the expense and the members have answered', () => {
    seam.loading = true;

    expect(visit().textContent).toContain('Loading');

    seam.loading = false;

    // The expense has resolved but the member list has not, and the admin check needs it.
    expect(visit().textContent).toContain('Loading');
  });

  it('reports a failed subscription and still offers a way out', () => {
    seam.error = new Error('permission denied');
    seam.expense = null;

    const container = visit();

    expect(container.textContent).toContain('permission denied');
    expect(container.querySelector('input')).toBeNull();
    expect(
      container.querySelector(`a[href="${paths.ExpenseDetail({ gid: 'g1', eid: EID })}"]`),
    ).not.toBeNull();
  });

  it('reports a failed member subscription rather than guessing at the permission', () => {
    const container = visit();

    act(() => {
      (seam.membersFail as ((error: Error) => void) | null)?.(new Error('permission denied'));
    });

    expect(container.textContent).toContain('permission denied');
    expect(container.querySelector('input')).toBeNull();
  });

  it('offers a way back when the id resolves to nothing', () => {
    seam.expense = null;

    const container = visitLoaded();

    expect(container.textContent).toContain('Expense not found');
    expect(container.querySelector(`a[href="${paths.GroupList()}"]`)).not.toBeNull();
  });

  it('refuses to edit a soft-deleted expense', () => {
    // Article V — the record survives for the audit trail; there is nothing there to change.
    seam.expense = expenseWith({ deletedAt: stamp() });

    const container = visitLoaded();

    expect(container.textContent).toContain('This expense was deleted');
    expect(container.querySelector('input')).toBeNull();
  });
});

describe('<EditExpenseScreen> — ADR-11', () => {
  it('gives the form to the person who added it', () => {
    const container = visitLoaded();

    expect(field(container, 'Amount').value).toBe('30.00');
    expect(field(container, 'Description').value).toBe('Dinner at Olive');
  });

  it('gives the form to a group admin who did not add it', () => {
    seam.selfUid = 'u3';

    const container = visitLoaded();

    expect(field(container, 'Amount').value).toBe('30.00');
  });

  it('refuses everyone else in words, rather than rendering a form the rules will deny', () => {
    seam.selfUid = 'u2';

    const container = visitLoaded();
    const text = container.textContent ?? '';

    expect(container.querySelector('input')).toBeNull();
    expect(text).toContain('Only the person who added this can edit it');
    expect(text).toContain('Neethu or a group admin can change this expense');
    expect(
      container.querySelector(`a[href="${paths.ExpenseDetail({ gid: 'g1', eid: EID })}"]`),
    ).not.toBeNull();
    expect(seam.updateExpense).not.toHaveBeenCalled();
  });
});

describe('<EditExpenseScreen> — seeding the form', () => {
  it('restores percentages as they were typed, not recomputed from the amounts', () => {
    seam.expense = expenseWith({
      amountMinor: 1000,
      splitMethod: 'percent',
      splits: [
        { uid: 'u1', amountMinor: 333, rawValue: 3333 },
        { uid: 'u2', amountMinor: 333, rawValue: 3333 },
        { uid: 'u3', amountMinor: 334, rawValue: 3334 },
      ],
    });

    const container = visitLoaded();

    expect(field(container, "Priya Sharma's share").value).toBe('33.33');
    expect(field(container, "Ravi Kumar's share").value).toBe('33.34');
  });

  it('lists a current member who is not in the split as an unticked row (AC-D3.2)', () => {
    seam.expense = expenseWith({
      splits: [
        { uid: 'u1', amountMinor: 1500, rawValue: null },
        { uid: 'u2', amountMinor: 1500, rawValue: null },
      ],
      participantIds: ['u1', 'u2'],
    });

    const container = visitLoaded();
    const toggles = includeToggles(container);

    expect(toggles.map((toggle) => toggle.getAttribute('aria-pressed'))).toEqual([
      'true',
      'true',
      'false',
    ]);
  });

  it('cannot move the expense to another group — groupId and currency are immutable', () => {
    const container = visitLoaded();

    expect(container.textContent).not.toContain('With you and');
  });
});

describe('<EditExpenseScreen> — what an edit writes', () => {
  it('recomputes the checksums from the new amount', async () => {
    const container = visitLoaded();

    type(field(container, 'Amount'), '60.00');
    await pressAndSettle(button(container, 'Save changes'));

    const { gid, eid, draft, uid } = savedCall();

    expect([gid, eid, uid]).toEqual(['g1', EID, 'u1']);
    expect(draft.amountMinor).toBe(6000);
    // 🔴 Both totals follow the new amount. Carrying the old 3000 over is a denied write.
    expect(expectRecomputedChecksums(draft)).toEqual(['u1', 'u2', 'u3']);
  });

  it('keeps participantIds correct when the edit changes who is involved', async () => {
    const container = visitLoaded();

    press(includeToggles(container)[2] as HTMLElement);
    await pressAndSettle(button(container, 'Save changes'));

    const { draft } = savedCall();

    expect(draft.split).toEqual({ method: 'equal', uids: ['u1', 'u2'] });
    expect(expectRecomputedChecksums(draft)).toEqual(['u1', 'u2']);
  });

  it('adds a participant who was not in the original split', async () => {
    seam.expense = expenseWith({
      splits: [
        { uid: 'u1', amountMinor: 1500, rawValue: null },
        { uid: 'u2', amountMinor: 1500, rawValue: null },
      ],
      participantIds: ['u1', 'u2'],
    });
    const container = visitLoaded();

    press(includeToggles(container)[2] as HTMLElement);
    await pressAndSettle(button(container, 'Save changes'));

    expect(expectRecomputedChecksums(savedCall().draft)).toEqual(['u1', 'u2', 'u3']);
  });

  it('re-derives with the expense id, so the leftover unit does not move on a re-save', async () => {
    // 🔴 docs/04 §2.1. $10 across three is 334/333/333; a fresh seed would hand the extra
    // cent to somebody else every time the expense was opened and saved again.
    seam.expense = expenseWith({
      amountMinor: 1000,
      splits: [
        { uid: 'u1', amountMinor: 334, rawValue: null },
        { uid: 'u2', amountMinor: 333, rawValue: null },
        { uid: 'u3', amountMinor: 333, rawValue: null },
      ],
    });
    const container = visitLoaded();

    type(field(container, 'Description'), 'Dinner at Olive, again');
    await pressAndSettle(button(container, 'Save changes'));

    const { draft } = savedCall();

    expect(previewSplits(draft.split, draft.amountMinor, EID)).toEqual(
      computeSplits({
        method: 'equal',
        totalMinor: 1000 as MinorUnits,
        uids: ['u1', 'u2', 'u3'],
        tieBreakSeed: EID,
      }),
    );
  });

  it('blocks Save while the edited split does not add up', () => {
    const container = visitLoaded();

    press(button(container, 'Exactly'));
    type(field(container, 'Priya Sharma owes'), '5.00');

    expect(container.textContent).toContain('left to assign');
    expect(button(container, 'Save changes').disabled).toBe(true);
    expect(seam.updateExpense).not.toHaveBeenCalled();
  });

  it('lands back on the expense once the write resolves', async () => {
    const container = visitLoaded();

    type(field(container, 'Amount'), '60.00');
    await pressAndSettle(button(container, 'Save changes'));

    expect(container.textContent).toContain('Landed on the expense');
  });

  it('shows a denial in words and keeps the edit on screen', async () => {
    seam.updateExpense = vi
      .fn()
      .mockRejectedValue(new Error('Missing or insufficient permissions'));
    const container = visitLoaded();

    type(field(container, 'Amount'), '60.00');
    await pressAndSettle(button(container, 'Save changes'));

    expect(container.textContent).toContain('Missing or insufficient permissions');
    expect(container.textContent).not.toContain('Landed on the expense');
    expect(field(container, 'Amount').value).toBe('60.00');
  });
});

describe('<EditExpenseScreen> — delete', () => {
  it('asks before deleting, and soft-deletes when confirmed', async () => {
    const container = visitLoaded();

    press(button(container, 'Delete expense'));
    expect(container.textContent).toContain('stays in the group’s history');
    expect(seam.softDeleteExpense).not.toHaveBeenCalled();

    await pressAndSettle(button(container, 'Delete expense'));

    // Article V — soft delete only. There is no hard delete of an expense anywhere.
    expect(seam.softDeleteExpense).toHaveBeenCalledWith('g1', EID, 'u1');
    expect(container.textContent).toContain('Landed on the group');
  });

  it('writes nothing when the delete is called off', () => {
    const container = visitLoaded();

    press(button(container, 'Delete expense'));
    press(button(container, 'Keep it'));

    expect(seam.softDeleteExpense).not.toHaveBeenCalled();
    expect(field(container, 'Amount').value).toBe('30.00');
  });
});
