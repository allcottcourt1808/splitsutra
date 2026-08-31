/**
 * `/groups/:gid` — the group home.
 *
 * A missing group is a real answer here, not an error: Rules gate `get` on membership, so a
 * group the user left arrives as `null`.
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import type {
  CurrencyCode,
  Expense,
  Group,
  GroupMember,
  GroupType,
  MinorUnits,
  Settlement,
} from '@splitsutra/core';

import { render } from '../../__tests__/helpers/render';
import { paths } from '../../navigation/paths';
import { GroupDetailScreen } from '../GroupDetailScreen';

const state = vi.hoisted(() => ({
  group: null as unknown,
  loading: false,
  error: null as Error | null,
  activeMembers: [] as unknown[],
  myBalanceMinor: 0,
  membersLoading: false,
  expenses: [] as unknown[],
  settlements: [] as unknown[],
  ledgerLoading: false,
  ledgerError: null as Error | null,
}));

/** The two `retry` callbacks, so a test can assert the screen re-subscribed after a repair. */
const retries = vi.hoisted(() => ({
  group: vi.fn(),
  members: vi.fn(),
  expenses: vi.fn(),
  settlements: vi.fn(),
}));

const repo = vi.hoisted(() => ({ repairGroupMembership: vi.fn() }));

vi.mock('@splitsutra/core/hooks', () => ({
  useGroup: () => ({
    group: state.group,
    loading: state.loading,
    error: state.error,
    retry: retries.group,
  }),
  useGroupBalances: () => ({
    activeMembers: state.activeMembers,
    myBalanceMinor: state.myBalanceMinor,
    loading: state.membersLoading,
    retry: retries.members,
  }),
  useAuth: () => ({ user: { uid: 'u1' }, loading: false }),
  useGroupExpenses: () => ({
    expenses: state.expenses,
    loading: state.ledgerLoading,
    error: state.ledgerError,
    retry: retries.expenses,
  }),
  useGroupSettlements: () => ({
    settlements: state.settlements,
    loading: state.ledgerLoading,
    error: state.ledgerError,
    retry: retries.settlements,
  }),
}));

vi.mock('@splitsutra/core/repositories', () => ({
  repairGroupMembership: repo.repairGroupMembership,
}));

/**
 * The denial a missing member document produces.
 *
 * The `code` is the whole trigger — a bare `Error` saying "permission denied" must NOT start a
 * repair, which is why the fixture carries a real Firestore error shape rather than a message.
 */
function denied(): Error {
  return Object.assign(new Error('Missing or insufficient permissions.'), {
    code: 'permission-denied',
    name: 'FirebaseError',
  });
}

const TS = { seconds: 0, nanoseconds: 0 } as unknown as Group['createdAt'];

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: 'g1',
    name: 'Goa Trip',
    type: 'trip' as GroupType,
    isImplicit: false,
    photoURL: null,
    currency: 'USD' as CurrencyCode,
    memberIds: ['u1', 'u2'],
    memberCount: 2,
    simplifyDebts: false,
    createdBy: 'u1',
    createdAt: TS,
    updatedAt: TS,
    lastActivityAt: TS,
    deletedAt: null,
    baseCurrency: null,
    allowMixedCurrency: null,
    ...overrides,
  };
}

function member(uid: string, displayName: string): GroupMember {
  return {
    uid,
    role: 'member',
    displayName,
    photoURL: null,
    balanceMinor: 0,
    joinedAt: TS,
    leftAt: null,
  } as unknown as GroupMember;
}

/**
 * A Firestore `Timestamp` stand-in with the two methods the ledger actually calls.
 *
 * The dates below sit in a **past** year on purpose: `formatMonthLabel` prints the year only
 * when it differs from today's, so a fixture dated "this month" would produce a different
 * heading depending on when the suite runs.
 */
function ts(millis: number): Group['createdAt'] {
  return {
    toMillis: () => millis,
    toDate: () => new Date(millis),
  } as unknown as Group['createdAt'];
}

/** Branded money, for fixtures. `MinorUnits` is nominal, so a literal will not do. */
function minor(amount: number): MinorUnits {
  return amount as unknown as MinorUnits;
}

/** One entry in an expense's `paidBy`. */
function payer(uid: string, amountMinor: number): Expense['paidBy'][number] {
  return { uid, amountMinor: minor(amountMinor) };
}

/** One entry in an expense's `splits`. */
function share(uid: string, amountMinor: number): Expense['splits'][number] {
  return { uid, amountMinor: minor(amountMinor), rawValue: null };
}
const MARCH = Date.UTC(2025, 2, 10);
const APRIL = Date.UTC(2025, 3, 5);

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    groupId: 'g1',
    description: 'Dinner',
    amountMinor: minor(3000),
    currency: 'USD' as CurrencyCode,
    category: 'food',
    date: ts(MARCH),
    paidBy: [payer('u1', 3000)],
    splitMethod: 'equal',
    splits: [share('u1', 1500), share('u2', 1500)],
    participantIds: ['u1', 'u2'],
    createdBy: 'u1',
    createdAt: TS,
    updatedBy: null,
    updatedAt: TS,
    deletedAt: null,
    commentCount: 0,
    lastCommentAt: null,
    ...overrides,
  } as unknown as Expense;
}

function settlement(overrides: Partial<Settlement> = {}): Settlement {
  return {
    id: 's1',
    groupId: 'g1',
    fromUid: 'u2',
    toUid: 'u1',
    amountMinor: minor(1500),
    currency: 'USD' as CurrencyCode,
    date: ts(MARCH),
    note: null,
    createdBy: 'u2',
    createdAt: TS,
    deletedAt: null,
    ...overrides,
  } as unknown as Settlement;
}
const routes: RouteObject[] = [{ path: '/groups/:gid', element: <GroupDetailScreen /> }];

/** Clicking has to run inside `act` or React never flushes the state update it causes. */
async function press(container: HTMLElement, name: string): Promise<void> {
  const target = [...container.querySelectorAll('button')].find(
    (el) => (el.textContent ?? '').trim() === name,
  );
  if (target === undefined) throw new Error(`No button named "${name}"`);
  await act(async () => {
    target.click();
    await Promise.resolve();
  });
}

function visit(): HTMLElement {
  const memory = createMemoryRouter(routes, {
    initialEntries: [paths.GroupDetail({ gid: 'g1' })],
  });
  return render(<RouterProvider router={memory} />).container;
}

beforeEach(() => {
  state.group = null;
  state.loading = false;
  state.error = null;
  state.activeMembers = [];
  state.myBalanceMinor = 0;
  state.membersLoading = false;
  state.expenses = [];
  state.settlements = [];
  state.ledgerLoading = false;
  state.ledgerError = null;
  retries.group.mockClear();
  retries.members.mockClear();
  retries.expenses.mockClear();
  retries.settlements.mockClear();
  repo.repairGroupMembership.mockReset();
  repo.repairGroupMembership.mockResolvedValue({
    groupId: 'g1',
    repaired: true,
    role: 'admin',
    balancesRebuilt: true,
  });
});

describe('<GroupDetailScreen>', () => {
  it('says it is loading before the first answer arrives', () => {
    state.loading = true;

    expect(visit().textContent).toContain('Loading');
  });

  it('reports a failed subscription instead of a missing group', () => {
    state.error = new Error('permission denied');

    const container = visit();

    expect(container.textContent).toContain('permission denied');
    expect(container.textContent).not.toContain('Group not found');
  });

  it('offers a way back when the group resolves to nothing', () => {
    const container = visit();

    expect(container.textContent).toContain('Group not found');
    expect(container.querySelector(`a[href="${paths.GroupList()}"]`)).not.toBeNull();
  });

  it('names the group, its type and its currency', () => {
    state.group = group({ type: 'home' as GroupType, currency: 'EUR' as CurrencyCode });

    const text = visit().textContent ?? '';

    expect(text).toContain('Goa Trip');
    expect(text).toContain('Home');
    expect(text).toContain('EUR');
    expect(text).toContain('2 members');
  });

  it('shows the member stack once the members arrive, and nothing before', () => {
    state.group = group();

    expect(visit().querySelector('[aria-label^="Members:"]')).toBeNull();

    state.activeMembers = [member('u1', 'Priya Sharma'), member('u2', 'Ravi Kumar')];

    expect(
      visit().querySelector('[aria-label="Members: Priya Sharma, Ravi Kumar"]'),
    ).not.toBeNull();
  });

  it('keeps the balance strip loading separately from the group document', () => {
    state.group = group();
    state.membersLoading = true;

    const container = visit();

    expect(container.textContent).toContain('Loading balances…');
    expect(container.textContent).toContain('Goa Trip');
  });

  it('reads a zero balance as settled rather than as a zero amount', () => {
    state.group = group();

    const container = visit();

    expect(container.textContent).toContain('You are settled up in this group');
    expect(container.textContent).not.toContain('0.00');
  });

  it('shows the balance with its direction in the group currency', () => {
    state.group = group();
    state.myBalanceMinor = 2500;

    expect(visit().textContent).toContain('You are owed');
    expect(visit().textContent).toContain('25.00');

    state.myBalanceMinor = -1000;

    const owing = visit().textContent ?? '';

    expect(owing).toContain('You owe');
    expect(owing).toContain('10.00');
  });

  it('reaches every screen the group hangs off', () => {
    state.group = group();

    const container = visit();
    const href = (path: string): Element | null => container.querySelector(`a[href="${path}"]`);

    expect(href(paths.GroupSettings({ gid: 'g1' }))).not.toBeNull();
    expect(href(paths.GroupMembers({ gid: 'g1' }))).not.toBeNull();
    expect(href(paths.GroupBalances({ gid: 'g1' }))).not.toBeNull();
    expect(href(paths.SettleUp({ gid: 'g1' }))).not.toBeNull();
    // 🔴 Carries the group. Adding from inside a group must open the composer on THAT group —
    //    a bare /expense/new falls back to the most recently active one, which files the
    //    expense somewhere the user was not looking.
    expect(href(paths.AddExpense({ gid: 'g1' }))).not.toBeNull();
    expect(href(paths.AddExpense())).toBeNull();
  });

  /* ────────────────────────────────────────────────────────────────────────────────────── *
   * The expense ledger
   *
   * This section stood empty for a long time behind a placeholder card that read "…once you
   * add one" whatever the group actually held — so a group WITH expenses looked exactly like a
   * group with none, and the missing feature was reported as a permissions bug. Several of
   * these tests exist to keep that specific lie from coming back.
   * ────────────────────────────────────────────────────────────────────────────────────── */

  describe('the expense ledger', () => {
    it('says the group is empty only when it really is', () => {
      state.group = group();

      const text = visit().textContent ?? '';

      expect(text).toContain('Expenses');
      expect(text).toContain('No expenses yet');
    });

    it('lists expenses under a month heading, newest month first', () => {
      state.group = group();
      state.expenses = [
        expense({ id: 'e-april', description: 'Kayaks', date: ts(APRIL) }),
        expense({ id: 'e-march', description: 'Dinner', date: ts(MARCH) }),
      ];

      const text = visit().textContent ?? '';

      expect(text).toContain('Kayaks');
      expect(text).toContain('Dinner');
      expect(text).not.toContain('No expenses yet');
      // Newest first: April's heading and its row both precede March's.
      expect(text.indexOf('April')).toBeLessThan(text.indexOf('March'));
      expect(text.indexOf('Kayaks')).toBeLessThan(text.indexOf('Dinner'));
    });

    it('links each expense row to its detail screen', () => {
      state.group = group();
      state.expenses = [expense({ id: 'e-1' })];

      const container = visit();

      expect(
        container.querySelector(`a[href="${paths.ExpenseDetail({ gid: 'g1', eid: 'e-1' })}"]`),
      ).not.toBeNull();
    });

    it('reports what the expense did to YOU, not the expense total', () => {
      state.group = group();
      // u1 paid 30.00 and owes 15.00 of it, so u1 is up 15.00 — not 30.00.
      state.expenses = [expense()];

      const text = visit().textContent ?? '';

      expect(text).toContain('you lent');
      expect(text).toContain('15.00');
      expect(text).not.toContain('30.00');
    });

    it('says so plainly when you are not part of an expense', () => {
      state.group = group();
      state.expenses = [
        expense({
          paidBy: [payer('u2', 3000)],
          splits: [share('u2', 3000)],
          participantIds: ['u2'],
        }),
      ];

      const text = visit().textContent ?? '';

      expect(text).toContain('Not involved');
      expect(text).not.toContain('you lent');
      expect(text).not.toContain('you borrowed');
    });

    it('renders a settlement as a payment, and does not link it anywhere', () => {
      state.group = group();
      state.activeMembers = [member('u2', 'Priya')];
      state.settlements = [settlement()];

      const container = visit();
      const text = container.textContent ?? '';

      expect(text).toContain('Priya paid You');
      expect(text).toContain('Payment');
      // A settlement has no detail screen, and a row that looks tappable and is not is worse
      // than one that plainly is not.
      // Scoped to the DETAIL route: the screen's own "Add an expense" button is /expense/new,
      // and a selector loose enough to catch that proves nothing.
      expect(container.querySelector('a[href^="/expense/g1/"]')).toBeNull();
    });

    it('offers a way back when the expense subscription was denied', async () => {
      state.group = group();
      state.ledgerError = new Error('Missing or insufficient permissions.');

      const container = visit();

      expect(container.textContent).toContain('Could not load the expenses');

      // 🔴 The retry is the whole point: a Firestore permission-denied TERMINATES the listener,
      // so without it the list stays empty for the life of the mount and reads as "no
      // expenses" — exactly how this bug hid the first time.
      await press(container, 'Try again');

      expect(retries.expenses).toHaveBeenCalledTimes(1);
      expect(retries.settlements).toHaveBeenCalledTimes(1);
    });
  });

  /* ────────────────────────────────────────────────────────────────────────────────────── *
   * Repairing a group whose member document was never written
   * ────────────────────────────────────────────────────────────────────────────────────── */

  describe('when the member document is missing', () => {
    it('repairs the membership and re-subscribes both listeners', async () => {
      state.error = denied();

      const container = visit();

      expect(container.textContent).toContain('Finishing setting up this group');
      expect(repo.repairGroupMembership).toHaveBeenCalledWith({ groupId: 'g1' });

      await vi.waitFor(() => {
        expect(retries.group).toHaveBeenCalledTimes(1);
        expect(retries.members).toHaveBeenCalledTimes(1);
      });
    });

    it('attempts the repair once, not once per render', async () => {
      state.error = denied();

      const container = visit();
      await vi.waitFor(() => expect(retries.group).toHaveBeenCalled());
      // A second render of the same still-denied group must not call again — the failing case
      // is the one that would spin.
      container.dispatchEvent(new Event('resize'));

      expect(repo.repairGroupMembership).toHaveBeenCalledTimes(1);
    });

    it('does not repair an error that is not a permission denial', () => {
      state.error = new Error('permission denied');

      const container = visit();

      expect(repo.repairGroupMembership).not.toHaveBeenCalled();
      expect(container.textContent).toContain('permission denied');
    });

    it('shows the original failure, not the repair’s, when the repair is refused', async () => {
      state.error = denied();
      repo.repairGroupMembership.mockRejectedValue(
        Object.assign(new Error('You are not a member of this group.'), {
          code: 'functions/permission-denied',
        }),
      );

      const container = visit();

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Missing or insufficient permissions.');
      });
      expect(container.textContent).not.toContain('You are not a member of this group.');
      expect(retries.group).not.toHaveBeenCalled();
    });

    it('offers a manual retry once the automatic one is spent', async () => {
      state.error = denied();
      repo.repairGroupMembership.mockRejectedValue(new Error('offline'));

      const container = visit();
      await vi.waitFor(() => expect(container.textContent).toContain('Try again'));
      expect(retries.group).not.toHaveBeenCalled();

      await press(container, 'Try again');

      expect(retries.group).toHaveBeenCalledTimes(1);
      expect(retries.members).toHaveBeenCalledTimes(1);
    });
  });
});
