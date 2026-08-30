/**
 * `/groups` — the list, the order it is handed, and the overall summary.
 *
 * 🔴 D6 / AC-B2.3 lives here: this is the only screen in the tab where two currencies meet, so
 * it is the only place a summed or netted total could be invented. The two-currency case below
 * asserts neither number reaches the DOM.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CurrencyCode, Group, GroupType, MinorUnits } from '@splitsutra/core';

import { renderAt } from '../../__tests__/helpers/render';
import { paths } from '../../navigation/paths';
import { GroupsScreen } from '../GroupsScreen';

const state = vi.hoisted(() => ({
  groups: [] as unknown[],
  loading: false,
  error: null as Error | null,
  balanceByGroup: new Map<string, number>(),
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useGroups: () => ({ groups: state.groups, loading: state.loading, error: state.error }),
  useMyGroupBalances: () => ({
    balanceByGroup: state.balanceByGroup,
    loading: false,
    error: null,
  }),
}));

const TS = { seconds: 0, nanoseconds: 0 } as unknown as Group['createdAt'];

interface GroupOverrides {
  readonly type?: GroupType;
  readonly currency?: CurrencyCode;
  readonly memberCount?: number;
}

function group(id: string, name: string, overrides: GroupOverrides = {}): Group {
  return {
    id,
    name,
    type: overrides.type ?? 'trip',
    isImplicit: false,
    photoURL: null,
    currency: overrides.currency ?? ('USD' as CurrencyCode),
    memberIds: ['u1'],
    memberCount: overrides.memberCount ?? 3,
    simplifyDebts: false,
    createdBy: 'u1',
    createdAt: TS,
    updatedAt: TS,
    lastActivityAt: TS,
    deletedAt: null,
    baseCurrency: null,
    allowMixedCurrency: null,
  };
}

function balances(entries: Record<string, number>): Map<string, MinorUnits> {
  return new Map(Object.entries(entries)) as Map<string, MinorUnits>;
}

function visit(): HTMLElement {
  return renderAt(<GroupsScreen />, paths.GroupList()).container;
}

function rows(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('ul[aria-label="Groups"] > li')];
}

function summaryLines(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('ul[aria-label="Overall balance by currency"] > li')];
}

beforeEach(() => {
  state.groups = [];
  state.loading = false;
  state.error = null;
  state.balanceByGroup = new Map();
});

describe('<GroupsScreen>', () => {
  it('says it is loading before the first answer arrives', () => {
    state.loading = true;

    const container = visit();

    expect(container.textContent).toContain('Loading');
    expect(rows(container)).toHaveLength(0);
  });

  it('reports a failed subscription instead of an empty list', () => {
    state.error = new Error('permission denied');

    const container = visit();

    expect(container.textContent).toContain('permission denied');
    expect(container.textContent).not.toContain('No groups yet');
  });

  it('offers both next actions when there is nothing to show', () => {
    const container = visit();

    expect(container.textContent).toContain('No groups yet');
    expect(container.querySelector(`a[href="${paths.CreateGroup()}"]`)).not.toBeNull();
    expect(container.querySelector(`a[href="${paths.AddFriend()}"]`)).not.toBeNull();
    expect(container.querySelector('[aria-label="Overall balance"]')).toBeNull();
  });

  it('keeps the lastActivityAt order it was handed rather than re-sorting', () => {
    // The ordering is `watchMyGroups`'s `orderBy('lastActivityAt','desc')`; the screen's
    // contract is only that it does not reshuffle it.
    state.groups = [
      group('g-newest', 'Goa Trip'),
      group('g-middle', 'Flat'),
      group('g-oldest', 'Ski 2024'),
    ];

    const rendered = rows(visit());

    expect(rendered).toHaveLength(3);
    expect(rendered[0]?.textContent).toContain('Goa Trip');
    expect(rendered[1]?.textContent).toContain('Flat');
    expect(rendered[2]?.textContent).toContain('Ski 2024');
  });

  it('links each row to its group and names the type and member count', () => {
    state.groups = [group('g1', 'Goa Trip', { type: 'trip', memberCount: 4 })];

    const container = visit();
    const [row] = rows(container);

    expect(row?.textContent).toContain('4 members');
    expect(container.querySelector(`a[href="${paths.GroupDetail({ gid: 'g1' })}"]`)).not.toBeNull();
  });

  it('shows the per-group balance with its direction in the group currency', () => {
    state.groups = [group('g1', 'Goa Trip'), group('g2', 'Flat'), group('g3', 'Ski 2024')];
    state.balanceByGroup = balances({ g1: 2500, g2: -1000, g3: 0 });

    const rendered = rows(visit());

    expect(rendered[0]?.textContent).toContain('you are owed');
    expect(rendered[0]?.textContent).toContain('25.00');
    expect(rendered[1]?.textContent).toContain('you owe');
    expect(rendered[1]?.textContent).toContain('10.00');
    expect(rendered[2]?.textContent).toContain('Settled up');
    expect(rendered[2]?.textContent).not.toContain('0.00');
  });

  it('leaves the trailing slot empty while a group balance has not arrived', () => {
    state.groups = [group('g1', 'Goa Trip')];

    const [row] = rows(visit());

    expect(row?.textContent).not.toContain('Settled up');
    expect(row?.textContent).not.toContain('0.00');
  });

  it('summarises one line per currency and never a summed or netted total (D6)', () => {
    // 🔴 Article I / D6. A single figure would read 1500 netted, or 3500 added blind — and
    // both would be inventing an exchange rate the app does not have.
    state.groups = [
      group('g1', 'Goa Trip', { currency: 'USD' as CurrencyCode }),
      group('g2', 'Berlin', { currency: 'EUR' as CurrencyCode }),
    ];
    state.balanceByGroup = balances({ g1: 2500, g2: -1000 });

    const container = visit();
    const text = container.textContent ?? '';

    expect(summaryLines(container)).toHaveLength(2);
    expect(text).toContain('You are owed');
    expect(text).toContain('You owe');
    expect(text).toContain('25.00');
    expect(text).toContain('10.00');
    expect(text).not.toContain('15.00');
    expect(text).not.toContain('35.00');
  });

  it('adds within one currency but keeps owed and owing apart', () => {
    state.groups = [
      group('g1', 'Goa Trip', { currency: 'USD' as CurrencyCode }),
      group('g2', 'Flat', { currency: 'USD' as CurrencyCode }),
      group('g3', 'Ski 2024', { currency: 'USD' as CurrencyCode }),
    ];
    state.balanceByGroup = balances({ g1: 2500, g2: 1000, g3: -500 });

    const container = visit();
    const [line] = summaryLines(container);

    expect(summaryLines(container)).toHaveLength(1);
    expect(line?.textContent).toContain('You are owed');
    expect(line?.textContent).toContain('35.00');
    expect(line?.textContent).toContain('You owe');
    expect(line?.textContent).toContain('5.00');
    // Netting the two would print 30.00 and hide that somebody is waiting to be paid.
    expect(line?.textContent).not.toContain('30.00');
  });

  it('reads a group with a zero balance as settled rather than as a zero line', () => {
    state.groups = [group('g1', 'Goa Trip')];
    state.balanceByGroup = balances({ g1: 0 });

    const container = visit();

    expect(summaryLines(container)).toHaveLength(0);
    expect(container.textContent).toContain('You are all settled up');
    expect(container.textContent).not.toContain('0.00');
  });
});
