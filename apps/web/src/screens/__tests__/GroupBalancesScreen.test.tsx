/**
 * `/groups/:gid/balances` — the stored balances, and `simplifyDebts()` over them.
 *
 * `simplifyDebts` is the real implementation from core (Article VI): mocking it would leave the
 * screen's only interesting claim — that suggested payments come from the same numbers the
 * Balances tab shows — untested.
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import type { CurrencyCode, Group, GroupMember } from '@splitsutra/core';

import { render } from '../../__tests__/helpers/render';
import { paths } from '../../navigation/paths';
import { GroupBalancesScreen } from '../GroupBalancesScreen';

const state = vi.hoisted(() => ({
  group: null as unknown,
  members: [] as unknown[],
  balances: [] as unknown[],
  settled: false,
  loading: false,
  error: null as Error | null,
  updateGroup: vi.fn(),
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useGroup: () => ({ group: state.group, loading: false, error: null }),
  useGroupBalances: () => ({
    members: state.members,
    balances: state.balances,
    settled: state.settled,
    loading: state.loading,
    error: state.error,
  }),
}));

vi.mock('@splitsutra/core/repositories', () => ({
  updateGroup: (...args: unknown[]) => state.updateGroup(...args) as Promise<void>,
}));

const TS = { seconds: 0, nanoseconds: 0 } as unknown as Group['createdAt'];

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: 'g1',
    name: 'Goa Trip',
    type: 'trip',
    isImplicit: false,
    photoURL: null,
    currency: 'USD' as CurrencyCode,
    memberIds: ['u1', 'u2', 'u3'],
    memberCount: 3,
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

const routes: RouteObject[] = [{ path: '/groups/:gid/balances', element: <GroupBalancesScreen /> }];

function visit(): HTMLElement {
  const memory = createMemoryRouter(routes, {
    initialEntries: [paths.GroupBalances({ gid: 'g1' })],
  });
  return render(<RouterProvider router={memory} />).container;
}

function press(container: HTMLElement, text: string): void {
  const button = [...container.querySelectorAll('button')].find(
    (el) => (el.textContent ?? '').trim() === text,
  );
  if (button === undefined) throw new Error(`No button reading "${text}"`);
  act(() => {
    button.click();
  });
}

function rows(container: HTMLElement, label: string): Element[] {
  return [...container.querySelectorAll(`ul[aria-label="${label}"] > li`)];
}

/** Three members whose stored balances already sum to zero (AC-E1.3). */
function threeWayDebt(): void {
  state.members = [
    member('u1', 'Priya Sharma'),
    member('u2', 'Ravi Kumar'),
    member('u3', 'Anita Rao'),
  ];
  state.balances = [
    { uid: 'u1', balanceMinor: 2000 },
    { uid: 'u2', balanceMinor: -500 },
    { uid: 'u3', balanceMinor: -1500 },
  ];
}

beforeEach(() => {
  state.group = group();
  state.members = [];
  state.balances = [];
  state.settled = false;
  state.loading = false;
  state.error = null;
  state.updateGroup = vi.fn().mockResolvedValue(undefined);
});

describe('<GroupBalancesScreen>', () => {
  it('says it is loading before the first answer arrives', () => {
    state.loading = true;

    expect(visit().textContent).toContain('Loading');
  });

  it('reports a failed subscription instead of an all-settled group', () => {
    state.error = new Error('permission denied');

    const container = visit();

    expect(container.textContent).toContain('permission denied');
    expect(container.textContent).not.toContain('All settled up');
  });

  it('reads a group with nothing outstanding as settled, not as a column of zeros', () => {
    state.settled = true;
    state.members = [member('u1', 'Priya Sharma')];
    state.balances = [{ uid: 'u1', balanceMinor: 0 }];

    const container = visit();

    expect(container.textContent).toContain('All settled up');
    expect(container.textContent).not.toContain('0.00');
    expect(rows(container, 'Member balances')).toHaveLength(0);
  });

  it('renders every stored balance with its direction and never an aggregate (D6)', () => {
    // 🔴 Article I / D6. Balances are per person. A group total would be 0 (netted) or 40.00
    // (added blind) and neither is a fact about anybody.
    threeWayDebt();

    const container = visit();
    const rendered = rows(container, 'Member balances');
    const text = container.textContent ?? '';

    expect(rendered).toHaveLength(3);
    expect(rendered[0]?.textContent).toContain('Priya Sharma');
    expect(rendered[0]?.textContent).toContain('is owed');
    expect(text).toContain('20.00');
    expect(text).toContain('5.00');
    expect(text).toContain('15.00');
    expect(text).not.toContain('40.00');
  });

  it('renders amounts in the group currency and nothing at all before the group arrives', () => {
    threeWayDebt();
    state.group = group({ currency: 'EUR' as CurrencyCode });

    expect(visit().textContent).toContain('€');

    state.group = null;

    const container = visit();

    expect(rows(container, 'Member balances')).toHaveLength(3);
    expect(container.textContent).not.toContain('20.00');
  });

  it('names someone who has left rather than showing a bare uid', () => {
    state.members = [member('u1', 'Priya Sharma')];
    state.balances = [
      { uid: 'u1', balanceMinor: 500 },
      { uid: 'gone', balanceMinor: -500 },
    ];

    const rendered = rows(visit(), 'Member balances');

    expect(rendered[1]?.textContent).toContain('Someone who left');
    expect(rendered[1]?.textContent).not.toContain('gone');
  });

  it('opens on the balances tab and switches to the suggested payments', () => {
    threeWayDebt();

    const container = visit();

    expect(rows(container, 'Member balances')).toHaveLength(3);

    press(container, 'Suggested payments');

    expect(rows(container, 'Member balances')).toHaveLength(0);
    expect(rows(container, 'Suggested payments').length).toBeGreaterThan(0);
  });

  it("opens on the suggested payments when the group's own setting says so", () => {
    threeWayDebt();
    state.group = group({ simplifyDebts: true });

    const container = visit();

    expect(rows(container, 'Suggested payments').length).toBeGreaterThan(0);

    press(container, 'Balances');

    expect(rows(container, 'Member balances')).toHaveLength(3);
  });

  it('⚠️ explains why a suggested payment goes to someone you never borrowed from (AC-E3.4)', () => {
    threeWayDebt();
    state.group = group({ simplifyDebts: true });

    const text = visit().textContent ?? '';

    // 🔴 The explanation is what AC-E3.4 actually requires — explain the substitution, not
    //    quantify it. Since ADR-12 this tab is where a new group lands, so this is the first
    //    thing it reads.
    expect(text).toContain('Amounts owed do not change');
    expect(text).toContain('someone you never borrowed from');

    expect(text).toContain('Settle up in 2 payments.');
  });

  it('never claims a payment count it cannot compute (AC-E3.4)', () => {
    // 🔴 Regression guard. The card used to read "Instead of ${debtors} payments, settle up in
    //    ${transfers}". Every debtor must discharge their own balance, so each is the payer of
    //    at least one transfer and `transfers >= debtors` is an identity — the sentence could
    //    only ever claim a reduction that was equal or worse, and with a three-way debt it
    //    rendered "Instead of 2 payments, settle up in 2".
    //
    //    The real quantity is the pairwise-debt count, which this app stores nowhere by design
    //    (docs/03). So the assertion is that no such comparison appears AT ALL — reinstating one
    //    requires new data, not a new expression over these balances.
    threeWayDebt();
    state.group = group({ simplifyDebts: true });

    expect(visit().textContent ?? '').not.toContain('Instead of');
  });

  it('prefills settle up from a suggested payment without touching the ledger', () => {
    threeWayDebt();
    state.group = group({ simplifyDebts: true });

    const container = visit();
    const hrefs = [...container.querySelectorAll('ul[aria-label="Suggested payments"] a')].map(
      (a) => a.getAttribute('href') ?? '',
    );

    expect(hrefs).toHaveLength(2);
    for (const href of hrefs) {
      expect(href.startsWith(`${paths.SettleUp({ gid: 'g1' })}?`)).toBe(true);
      const query = new URLSearchParams(href.slice(href.indexOf('?')));
      expect(query.get('to')).toBe('u1');
      expect(['u2', 'u3']).toContain(query.get('from'));
      expect(Number(query.get('amountMinor'))).toBeGreaterThan(0);
    }
    expect(state.updateGroup).not.toHaveBeenCalled();
  });

  it('turns the group default on through updateGroup, and reports a refusal', async () => {
    threeWayDebt();

    const container = visit();
    press(container, 'On');

    expect(state.updateGroup).toHaveBeenCalledWith('g1', { simplifyDebts: true });

    state.updateGroup = vi.fn().mockRejectedValue(new Error('not a member of this group'));

    const failing = visit();
    await act(async () => {
      press(failing, 'On');
      await Promise.resolve();
    });

    expect(failing.textContent).toContain('not a member of this group');
  });

  it('offers no group default while the group document has not arrived', () => {
    threeWayDebt();
    state.group = null;

    expect(visit().textContent).not.toContain('Use simplified payments by default');
  });
});
