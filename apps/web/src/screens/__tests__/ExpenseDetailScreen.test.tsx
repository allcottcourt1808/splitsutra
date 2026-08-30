/**
 * `/expense/:gid/:eid` — the breakdown, ADR-11, and the discussion thread.
 *
 * This screen is where ADR-11 becomes visible, so the two branches of it get the most
 * attention: the creator (or an admin) is offered Edit and Delete, and everyone else is
 * offered the thread **with the rule stated in words** — never a dead Edit button, never
 * silence.
 *
 * Article V is the other thing pinned here: Delete is a five-second deferred *soft* delete.
 * Nothing is written until the window closes, and Undo means no write happens at all.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import type { Comment, Expense, GroupMember } from '@splitsutra/core';

import { render } from '../../__tests__/helpers/render';
import { paths } from '../../navigation/paths';
import { ExpenseDetailScreen } from '../ExpenseDetailScreen';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Seams
 * ────────────────────────────────────────────────────────────────────────────────────────── */

const seam = vi.hoisted(() => ({
  selfUid: 'u1',
  expense: null as unknown,
  loading: false,
  error: null as Error | null,
  comments: [] as unknown[],
  commentsLoading: false,
  members: null as unknown,
  addExpenseComment: vi.fn(),
  softDeleteExpense: vi.fn(),
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useAuth: () => ({ user: { uid: seam.selfUid } }),
  useProfile: () => ({ profile: { displayName: 'Neethu', photoURL: null } }),
  useExpense: () => ({ expense: seam.expense, loading: seam.loading, error: seam.error }),
  useExpenseComments: () => ({
    comments: seam.comments,
    loading: seam.commentsLoading,
    error: null,
  }),
}));

vi.mock('@splitsutra/core/repositories', () => ({
  addExpenseComment: (...args: unknown[]) => seam.addExpenseComment(...args) as unknown,
  softDeleteExpense: (...args: unknown[]) => seam.softDeleteExpense(...args) as unknown,
  watchExpenseMembers: (_groupId: string, next: unknown) => {
    seam.members = next;
    return vi.fn();
  },
}));

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Fixtures
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** Anchored to now so `formatRelativeTime` — the real one — stays on its "Just now" rung. */
function stamp(): { toDate: () => Date; toMillis: () => number } {
  const ms = Date.now();
  return { toDate: () => new Date(ms), toMillis: () => ms };
}

const MEMBERS = [
  { uid: 'u1', displayName: 'Neethu', photoURL: null, role: 'member' },
  { uid: 'u2', displayName: 'Priya Sharma', photoURL: null, role: 'member' },
  { uid: 'u3', displayName: 'Ravi Kumar', photoURL: null, role: 'admin' },
] as unknown as GroupMember[];

function expenseWith(overrides: Record<string, unknown> = {}): Expense {
  return {
    id: 'e1',
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

function comment(overrides: Record<string, unknown> = {}): Comment {
  return {
    id: 'c1',
    uid: 'u2',
    displayName: 'Priya Sharma',
    photoURL: null,
    text: 'Wasn’t this $20?',
    createdAt: stamp(),
    deletedAt: null,
    ...overrides,
  } as unknown as Comment;
}

const routes: RouteObject[] = [
  { path: '/expense/:gid/:eid', element: <ExpenseDetailScreen /> },
  { path: '/groups/:gid', element: <p>Landed on the group</p> },
  { path: '/groups', element: <p>Landed on the group list</p> },
];

function visit(): HTMLElement {
  const memory = createMemoryRouter(routes, {
    initialEntries: [paths.ExpenseDetail({ gid: 'g1', eid: 'e1' })],
  });
  const container = render(<RouterProvider router={memory} />).container;
  act(() => {
    (seam.members as ((value: readonly GroupMember[]) => void) | null)?.(MEMBERS);
  });
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

function maybeButton(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (candidate) => (candidate.textContent ?? '').trim() === text,
  );
}

function press(element: HTMLElement): void {
  act(() => {
    element.click();
  });
}

beforeEach(() => {
  seam.selfUid = 'u1';
  seam.expense = expenseWith();
  seam.loading = false;
  seam.error = null;
  seam.comments = [];
  seam.commentsLoading = false;
  seam.members = null;
  seam.addExpenseComment = vi.fn().mockResolvedValue('c9');
  seam.softDeleteExpense = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Tests
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('<ExpenseDetailScreen> — loading, error, missing', () => {
  it('says it is loading before the first answer arrives', () => {
    seam.loading = true;
    seam.expense = null;

    expect(visit().textContent).toContain('Loading');
  });

  it('reports a failed subscription rather than an empty breakdown', () => {
    seam.error = new Error('permission denied');
    seam.expense = null;

    const container = visit();

    expect(container.textContent).toContain('permission denied');
    expect(container.textContent).not.toContain('Expense not found');
  });

  it('offers a way back when the id resolves to nothing', () => {
    seam.expense = null;

    const container = visit();

    expect(container.textContent).toContain('Expense not found');
    expect(container.querySelector(`a[href="${paths.GroupList()}"]`)).not.toBeNull();
  });
});

describe('<ExpenseDetailScreen> — the breakdown', () => {
  it('shows the total, who paid, and every share', () => {
    const container = visit();
    const text = container.textContent ?? '';

    expect(text).toContain('Dinner at Olive');
    expect(text).toContain('30.00');
    expect(text).toContain('10.00');
    expect(text).toContain('Priya Sharma');
    expect(text).toContain('Ravi Kumar');
    expect(container.querySelectorAll('ul[aria-label="Who paid"] > li')).toHaveLength(1);
    expect(container.querySelectorAll(`ul[aria-label="Each person's share"] > li`)).toHaveLength(3);
  });

  it('shows a percentage split as the percentages that were typed', () => {
    // docs/03 "Why rawValue exists" — 333/1000 recomputed reads 33.3%, not the 33.33% typed.
    seam.expense = expenseWith({
      amountMinor: 1000,
      splitMethod: 'percent',
      splits: [
        { uid: 'u1', amountMinor: 333, rawValue: 3333 },
        { uid: 'u2', amountMinor: 333, rawValue: 3333 },
        { uid: 'u3', amountMinor: 334, rawValue: 3334 },
      ],
    });

    const text = visit().textContent ?? '';

    expect(text).toContain('33.33%');
    expect(text).toContain('33.34%');
  });

  it('names who added it, and who last changed it', () => {
    seam.selfUid = 'u2';
    seam.expense = expenseWith({ updatedBy: 'u3' });

    const text = visit().textContent ?? '';

    expect(text).toContain('Added by Neethu');
    expect(text).toContain('Edited by Ravi Kumar');
  });

  it('marks a soft-deleted expense and offers neither Edit nor Delete', () => {
    // Article V — the record survives; it just stops counting.
    seam.expense = expenseWith({ deletedAt: stamp() });

    const container = visit();

    expect(container.textContent).toContain('This expense was deleted');
    expect(
      container.querySelector(`a[href="${paths.EditExpense({ gid: 'g1', eid: 'e1' })}"]`),
    ).toBeNull();
    expect(maybeButton(container, 'Delete expense')).toBeUndefined();
  });
});

describe('<ExpenseDetailScreen> — ADR-11', () => {
  it('offers Edit and Delete to the person who added it', () => {
    const container = visit();

    expect(
      container.querySelector(`a[href="${paths.EditExpense({ gid: 'g1', eid: 'e1' })}"]`),
    ).not.toBeNull();
    expect(maybeButton(container, 'Delete expense')).toBeDefined();
  });

  it('offers Edit to a group admin who did not add it', () => {
    seam.selfUid = 'u3';

    const container = visit();

    expect(
      container.querySelector(`a[href="${paths.EditExpense({ gid: 'g1', eid: 'e1' })}"]`),
    ).not.toBeNull();
  });

  it('explains the rule to everyone else instead of showing a dead Edit button', () => {
    seam.selfUid = 'u2';

    const container = visit();
    const text = container.textContent ?? '';

    expect(
      container.querySelector(`a[href="${paths.EditExpense({ gid: 'g1', eid: 'e1' })}"]`),
    ).toBeNull();
    expect(maybeButton(container, 'Delete expense')).toBeUndefined();
    expect(text).toContain('Something look wrong?');
    expect(text).toContain('only Neethu or a group admin can edit this expense');
    expect(text).toContain('Discussion');
  });
});

describe('<ExpenseDetailScreen> — delete, held for five seconds', () => {
  it('writes nothing until the undo window closes, then soft-deletes', async () => {
    vi.useFakeTimers();
    const container = visit();

    press(button(container, 'Delete expense'));

    expect(container.textContent).toContain('Deleting this expense');
    expect(seam.softDeleteExpense).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    // Article V — a soft delete, and the only delete there is.
    expect(seam.softDeleteExpense).toHaveBeenCalledWith('g1', 'e1', 'u1');
  });

  it('never writes at all when the delete is taken back', async () => {
    vi.useFakeTimers();
    const container = visit();

    press(button(container, 'Delete expense'));
    press(button(container, 'Undo'));

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(seam.softDeleteExpense).not.toHaveBeenCalled();
    expect(maybeButton(container, 'Delete expense')).toBeDefined();
  });
});

describe('<ExpenseDetailScreen> — the discussion', () => {
  it('distinguishes a loading thread from an empty one', () => {
    seam.commentsLoading = true;

    expect(visit().textContent).toContain('Loading the thread');

    seam.commentsLoading = false;

    expect(visit().textContent).toContain('No comments yet');
  });

  it('renders the thread, and a tombstone where a comment was deleted', () => {
    seam.comments = [
      comment(),
      comment({ id: 'c2', uid: 'u1', text: 'Fixed it', deletedAt: stamp() }),
    ];

    const text = visit().textContent ?? '';

    expect(text).toContain('Wasn’t this $20?');
    expect(text).toContain('This comment was deleted');
    expect(text).not.toContain('Fixed it');
  });

  it('posts a comment and clears the composer', async () => {
    const container = visit();

    expect(button(container, 'Post comment').disabled).toBe(true);

    type(field(container, 'Add a comment'), 'I paid the tip separately');
    expect(button(container, 'Post comment').disabled).toBe(false);

    await act(async () => {
      button(container, 'Post comment').click();
      await Promise.resolve();
    });

    expect(seam.addExpenseComment).toHaveBeenCalledWith(
      'g1',
      'e1',
      { uid: 'u1', displayName: 'Neethu', photoURL: null },
      'I paid the tip separately',
    );
    expect(field(container, 'Add a comment').value).toBe('');
  });

  it('says why a comment did not post', async () => {
    seam.addExpenseComment = vi
      .fn()
      .mockRejectedValue(new Error('Missing or insufficient permissions'));
    const container = visit();

    type(field(container, 'Add a comment'), 'Hello');
    await act(async () => {
      button(container, 'Post comment').click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Missing or insufficient permissions');
  });
});
