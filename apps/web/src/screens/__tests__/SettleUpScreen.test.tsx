/**
 * `/groups/:gid/settle`.
 *
 * `parseAmountToMinor` is the real implementation (Article VI / Article I): a mock would let the
 * screen hand `createSettlement` a float and nothing here would notice. Only the write itself is
 * replaced.
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import type { CurrencyCode, Group, GroupMember } from '@splitsutra/core';
import type * as Repositories from '@splitsutra/core/repositories';

import { render } from '../../__tests__/helpers/render';
import { paths } from '../../navigation/paths';
import { SettleUpScreen } from '../SettleUpScreen';

const state = vi.hoisted(() => ({
  user: null as unknown,
  group: null as unknown,
  activeMembers: [] as unknown[],
  loading: false,
  error: null as Error | null,
  createSettlement: vi.fn(),
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useAuth: () => ({ user: state.user, profile: null, loading: false, error: null }),
  useGroup: () => ({ group: state.group, loading: false, error: null }),
  useGroupBalances: () => ({
    activeMembers: state.activeMembers,
    loading: state.loading,
    error: state.error,
  }),
}));

vi.mock('@splitsutra/core/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof Repositories>();
  return {
    parseAmountToMinor: actual.parseAmountToMinor,
    createSettlement: (...args: unknown[]) => state.createSettlement(...args) as Promise<string>,
  };
});

const TS = { seconds: 0, nanoseconds: 0 } as unknown as Group['createdAt'];

function group(currency: CurrencyCode = 'USD' as CurrencyCode): Group {
  return {
    id: 'g1',
    name: 'Goa Trip',
    type: 'trip',
    isImplicit: false,
    photoURL: null,
    currency,
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
  };
}

function member(uid: string, displayName: string, balanceMinor: number): GroupMember {
  return {
    uid,
    role: 'member',
    displayName,
    photoURL: null,
    balanceMinor,
    joinedAt: TS,
    leftAt: null,
  } as unknown as GroupMember;
}

const routes: RouteObject[] = [
  { path: '/groups/:gid/settle', element: <SettleUpScreen /> },
  { path: '/groups/:gid', element: <p>Group home</p> },
];

function visit(query = ''): HTMLElement {
  const memory = createMemoryRouter(routes, {
    initialEntries: [`${paths.SettleUp({ gid: 'g1' })}${query}`],
  });
  return render(<RouterProvider router={memory} />).container;
}

function field(container: HTMLElement, label: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label')].find((el) =>
    (el.textContent ?? '').trim().startsWith(label),
  );
  const id = found?.getAttribute('for') ?? '';
  const input = container.ownerDocument.getElementById(id);
  if (!(input instanceof HTMLInputElement)) throw new Error(`No field labelled "${label}"`);
  return input;
}

// React tracks the value on the node, so the change has to go through the prototype setter.
function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (el) => (el.textContent ?? '').trim() === name || el.getAttribute('aria-label') === name,
  );
  if (found === undefined) throw new Error(`No button named "${name}"`);
  return found;
}

async function press(container: HTMLElement, name: string): Promise<void> {
  const target = button(container, name);
  await act(async () => {
    target.click();
    await Promise.resolve();
  });
}

function rows(container: HTMLElement, label: string): Element[] {
  return [...container.querySelectorAll(`ul[aria-label="${label}"] > li`)];
}

/** Priya (the signed-in user) owes $25.00; Ravi is owed it; Anita is square. */
function threeMembers(): void {
  state.activeMembers = [
    member('u1', 'Priya Sharma', -2500),
    member('u2', 'Ravi Kumar', 2500),
    member('u3', 'Anita Rao', 0),
  ];
}

beforeEach(() => {
  state.user = { uid: 'u1' };
  state.group = group();
  state.activeMembers = [];
  state.loading = false;
  state.error = null;
  state.createSettlement = vi.fn().mockResolvedValue('s-new');
});

describe('<SettleUpScreen>', () => {
  it('says it is loading before the first answer arrives', () => {
    state.loading = true;

    expect(visit().textContent).toContain('Loading');
  });

  it('reports a failed subscription instead of an empty group', () => {
    state.error = new Error('permission denied');

    const container = visit();

    expect(container.textContent).toContain('permission denied');
    expect(container.textContent).not.toContain('Nobody to pay yet');
  });

  it('sends a lone member to the invite screen rather than to a form they cannot use', () => {
    state.activeMembers = [member('u1', 'Priya Sharma', 0)];

    const container = visit();

    expect(container.textContent).toContain('Nobody to pay yet');
    expect(
      container.querySelector(`a[href="${paths.GroupMembers({ gid: 'g1' })}"]`),
    ).not.toBeNull();
  });

  it('reports a missing group rather than claiming there is nobody to pay', () => {
    threeMembers();
    state.group = null;

    const text = visit().textContent;
    expect(text).toContain('Group not found');
    expect(text).not.toContain('Nobody to pay yet');
  });

  it('⚠️ says that no money will move (AC-E2.3)', () => {
    threeMembers();

    const text = visit().textContent ?? '';

    expect(text).toContain('No money will move');
    expect(text).toContain('records a payment you have already made outside the app');
    expect(text).toContain('never transfers money');
  });

  it('starts with the signed-in user paying, and their whole debt in the field', () => {
    threeMembers();

    const container = visit();

    expect(rows(container, 'Who paid')[0]?.textContent).toContain('Priya Sharma (you)');
    expect(rows(container, 'Who paid')[0]?.textContent).toContain('Paying');
    expect(field(container, 'Amount').value).toBe('25.00');
    expect(container.textContent).toContain('Priya Sharma still owes $25.00 in this group');
    expect(button(container, 'Record').disabled).toBe(true);
  });

  it('takes the payer, payee and amount from a suggested payment (AC-E3.4)', () => {
    threeMembers();

    const container = visit('?from=u3&to=u2&amountMinor=1250');

    expect(rows(container, 'Who paid')[2]?.textContent).toContain('Paying');
    expect(field(container, 'Amount').value).toBe('12.50');
    expect(container.textContent).toContain('Anita Rao paid Ravi Kumar $12.50.');
  });

  it('keeps the payer out of the payee list, and drops a payee who becomes the payer', async () => {
    threeMembers();

    const container = visit();

    expect(rows(container, 'Who paid')).toHaveLength(3);
    expect(rows(container, 'Who they paid')).toHaveLength(2);

    await press(container, 'Paid to Ravi Kumar');
    expect(rows(container, 'Who they paid')[0]?.textContent).toContain('Receiving');

    await press(container, 'Ravi Kumar paid');
    expect(rows(container, 'Who they paid')).toHaveLength(2);
    expect(container.textContent).not.toContain('Receiving');
  });

  it('🔴 parses the typed amount into minor units without ever touching a float', async () => {
    threeMembers();

    const container = visit();
    await press(container, 'Paid to Ravi Kumar');

    // 0.1 is the case that catches `parseFloat(x) * 100` — it produces 10.000000000000002.
    type(field(container, 'Amount'), '0.1');
    await press(container, 'Record');

    const [, input] = state.createSettlement.mock.calls[0] as [string, { amountMinor: number }];

    expect(input.amountMinor).toBe(10);
    expect(Number.isInteger(input.amountMinor)).toBe(true);
  });

  it('rejects an amount that is not a well-formed number', async () => {
    threeMembers();

    const container = visit();
    await press(container, 'Paid to Ravi Kumar');
    type(field(container, 'Amount'), '25,50,00.1.2');

    expect(container.textContent).toContain('Enter an amount like 25 or 25.50.');
    expect(button(container, 'Record').disabled).toBe(true);
  });

  it('rejects a payment of nothing', async () => {
    threeMembers();

    const container = visit();
    await press(container, 'Paid to Ravi Kumar');
    type(field(container, 'Amount'), '0');

    expect(container.textContent).toContain('A payment has to be more than zero.');
    expect(button(container, 'Record').disabled).toBe(true);
  });

  it('allows a partial payment without complaint (AC-E2.2)', async () => {
    threeMembers();

    const container = visit();
    await press(container, 'Paid to Ravi Kumar');
    type(field(container, 'Amount'), '10');

    expect(container.textContent).not.toContain('That is more than is outstanding');
    expect(button(container, 'Record').disabled).toBe(false);
  });

  it('warns about an overpayment but still permits it (AC-E2.6)', async () => {
    threeMembers();

    const container = visit();
    await press(container, 'Paid to Ravi Kumar');
    type(field(container, 'Amount'), '40');

    expect(container.textContent).toContain('That is more than is outstanding');
    expect(button(container, 'Record').disabled).toBe(false);
  });

  it('rejects a date it cannot read back', async () => {
    threeMembers();

    const container = visit();
    await press(container, 'Paid to Ravi Kumar');
    type(field(container, 'Date'), '2026-02-31');

    expect(container.textContent).toContain('Use the format 2026-08-29.');
    expect(button(container, 'Record').disabled).toBe(true);
  });

  it('records the payment and lands back on the group', async () => {
    threeMembers();

    const container = visit();
    await press(container, 'Paid to Ravi Kumar');
    type(field(container, 'Amount'), '25.50');
    type(field(container, 'Date'), '2026-08-29');
    type(field(container, 'Note (optional)'), '  Cash at the airport  ');
    await press(container, 'Record');

    expect(state.createSettlement).toHaveBeenCalledTimes(1);
    const [uid, input] = state.createSettlement.mock.calls[0] as [
      string,
      Record<string, unknown> & { date: Date },
    ];

    expect(uid).toBe('u1');
    expect(input).toMatchObject({
      groupId: 'g1',
      fromUid: 'u1',
      toUid: 'u2',
      amountMinor: 2550,
      currency: 'USD',
      note: 'Cash at the airport',
    });
    // A user-chosen day, read back as a local date — not a server timestamp (T7).
    expect(input.date.getFullYear()).toBe(2026);
    expect(input.date.getMonth()).toBe(7);
    expect(input.date.getDate()).toBe(29);
    expect(container.textContent).toContain('Group home');
  });

  it('sends no note rather than an empty one', async () => {
    threeMembers();

    const container = visit();
    await press(container, 'Paid to Ravi Kumar');
    await press(container, 'Record');

    const [, input] = state.createSettlement.mock.calls[0] as [string, { note: string | null }];

    expect(input.note).toBeNull();
  });

  it('records a payment between two other people', async () => {
    threeMembers();

    const container = visit();
    await press(container, 'Anita Rao paid');
    await press(container, 'Paid to Ravi Kumar');
    type(field(container, 'Amount'), '5');
    await press(container, 'Record');

    const [, input] = state.createSettlement.mock.calls[0] as [
      string,
      { fromUid: string; toUid: string; amountMinor: number },
    ];

    expect(input).toMatchObject({ fromUid: 'u3', toUid: 'u2', amountMinor: 500 });
  });

  it('stays put and says what went wrong when the write is refused', async () => {
    threeMembers();
    state.createSettlement = vi
      .fn()
      .mockRejectedValue(new Error('Missing or insufficient permissions'));

    const container = visit();
    await press(container, 'Paid to Ravi Kumar');
    await press(container, 'Record');

    expect(container.textContent).toContain('Missing or insufficient permissions');
    expect(container.textContent).not.toContain('Group home');
    expect(button(container, 'Record').disabled).toBe(false);
  });
});
