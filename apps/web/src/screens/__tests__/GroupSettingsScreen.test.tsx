/**
 * `/groups/:gid/settings`.
 *
 * 🔴 Two things this file exists to pin. `currency` never reaches `updateGroup` (AC-C1.1, T10),
 * and leaving / deleting go through callables rather than a client write (Article III).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import type { CurrencyCode, Group, GroupMember, GroupType } from '@splitsutra/core';

import { render } from '../../__tests__/helpers/render';
import { paths } from '../../navigation/paths';
import { GroupSettingsScreen } from '../GroupSettingsScreen';

const state = vi.hoisted(() => ({
  group: null as unknown,
  loading: false,
  error: null as Error | null,
  me: null as unknown,
  isAdmin: false,
  updateGroup: vi.fn(),
  leaveGroup: vi.fn(),
  deleteGroup: vi.fn(),
  recomputeGroupBalances: vi.fn(),
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useGroup: () => ({ group: state.group, loading: state.loading, error: state.error }),
  useGroupMembers: () => ({ me: state.me, isAdmin: state.isAdmin }),
  // Only feeds the screen's accessible label, which names the group — see `groupLabel`.
  useAuth: () => ({ user: { uid: 'u1', displayName: 'Me' } }),
}));

vi.mock('@splitsutra/core/repositories', () => ({
  updateGroup: (...args: unknown[]) => state.updateGroup(...args) as Promise<void>,
  leaveGroup: (...args: unknown[]) => state.leaveGroup(...args) as Promise<unknown>,
  deleteGroup: (...args: unknown[]) => state.deleteGroup(...args) as Promise<unknown>,
  recomputeGroupBalances: (...args: unknown[]) =>
    state.recomputeGroupBalances(...args) as Promise<unknown>,
}));

const TS = { seconds: 0, nanoseconds: 0 } as unknown as Group['createdAt'];

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: 'g1',
    name: 'Goa Trip',
    type: 'trip' as GroupType,
    isImplicit: false,
    photoURL: null,
    currency: 'INR' as CurrencyCode,
    memberIds: ['u1'],
    memberCount: 1,
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

function me(left = false): GroupMember {
  return {
    uid: 'u1',
    role: 'admin',
    displayName: 'Priya Sharma',
    photoURL: null,
    balanceMinor: 0,
    joinedAt: TS,
    leftAt: left ? TS : null,
  } as unknown as GroupMember;
}

const routes: RouteObject[] = [{ path: '/groups/:gid/settings', element: <GroupSettingsScreen /> }];

function visit(): HTMLElement {
  const memory = createMemoryRouter(routes, {
    initialEntries: [paths.GroupSettings({ gid: 'g1' })],
  });
  return render(<RouterProvider router={memory} />).container;
}

function field(container: HTMLElement, label: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label')].find(
    (el) => (el.textContent ?? '').trim() === label,
  );
  const id = found?.getAttribute('for') ?? '';
  const input = container.ownerDocument.getElementById(id);
  if (!(input instanceof HTMLInputElement)) throw new Error(`No field labelled "${label}"`);
  return input;
}

// React listens for the native `input` event on the root, so the value has to be set through
// the prototype's own setter or React's tracker swallows the change as a no-op.
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

beforeEach(() => {
  state.group = group();
  state.loading = false;
  state.error = null;
  state.me = me();
  state.isAdmin = true;
  state.updateGroup = vi.fn().mockResolvedValue(undefined);
  state.leaveGroup = vi.fn().mockResolvedValue({ groupId: 'g1', left: true });
  state.deleteGroup = vi
    .fn()
    .mockResolvedValue({ groupId: 'g1', deleted: true, alreadyDeleted: false });
  state.recomputeGroupBalances = vi
    .fn()
    .mockResolvedValue({ groupId: 'g1', currency: 'INR', repaired: true, driftCount: 2 });
});

describe('<GroupSettingsScreen>', () => {
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
    state.group = null;

    const container = visit();

    expect(container.textContent).toContain('Group not found');
    expect(container.querySelector(`a[href="${paths.GroupList()}"]`)).not.toBeNull();
  });

  it('renames through updateGroup, trimmed, and never touches the currency', async () => {
    const container = visit();

    expect(button(container, 'Save name').disabled).toBe(true);

    type(field(container, 'Group name'), '  Goa Trip 2026  ');
    await press(container, 'Save name');

    expect(state.updateGroup).toHaveBeenCalledWith('g1', { name: 'Goa Trip 2026' });
    expect(container.textContent).toContain('Name saved.');
  });

  it('refuses to save a name the schema would reject', () => {
    const container = visit();

    type(field(container, 'Group name'), '   ');

    expect(container.textContent).toContain('A group needs a name.');
    expect(button(container, 'Save name').disabled).toBe(true);
  });

  it('changes the type and the simplification default through updateGroup', async () => {
    const container = visit();

    await press(container, 'Home');
    expect(state.updateGroup).toHaveBeenCalledWith('g1', { type: 'home' });

    await press(container, 'On');
    expect(state.updateGroup).toHaveBeenCalledWith('g1', { simplifyDebts: true });

    for (const [, patch] of state.updateGroup.mock.calls) {
      expect(Object.keys(patch as object)).not.toContain('currency');
    }
  });

  it('🔴 states the currency and offers no control that could change it (AC-C1.1)', () => {
    const container = visit();
    const text = container.textContent ?? '';

    expect(text).toContain('INR');
    expect(text).toContain('cannot be changed');
    expect(() => field(container, 'Currency')).toThrow();
  });

  it('rebuilds balances through the callable and reports what it found', async () => {
    const container = visit();
    await press(container, 'Rebuild balances');

    expect(state.recomputeGroupBalances).toHaveBeenCalledWith({ groupId: 'g1' });
    expect(container.textContent).toContain('Fixed 2 balances.');
  });

  it('says so when a rebuild found nothing to fix', async () => {
    state.recomputeGroupBalances = vi
      .fn()
      .mockResolvedValue({ groupId: 'g1', currency: 'INR', repaired: false, driftCount: 0 });

    const container = visit();
    await press(container, 'Rebuild balances');

    expect(container.textContent).toContain('Everything already matched.');
  });

  it('leaves through the callable, not through a member document write', async () => {
    const container = visit();
    await press(container, 'Leave group');

    expect(state.leaveGroup).toHaveBeenCalledWith({ groupId: 'g1' });
    expect(state.updateGroup).not.toHaveBeenCalled();
    expect(container.textContent).toContain('You have left this group.');
  });

  it("shows the callable's refusal verbatim — it names the outstanding amount", async () => {
    state.leaveGroup = vi.fn().mockRejectedValue(new Error('Settle ₹250.00 before leaving.'));

    const container = visit();
    await press(container, 'Leave group');

    expect(container.textContent).toContain('Settle ₹250.00 before leaving.');
    expect(container.textContent).not.toContain('You have left this group.');
  });

  it('offers no way to leave a group already left', () => {
    state.me = me(true);

    expect(visit().textContent).not.toContain('Leave this group');
  });

  it('deletes through the callable, and only for an admin', async () => {
    state.isAdmin = false;

    expect(visit().textContent).not.toContain('Delete this group');

    state.isAdmin = true;

    const container = visit();
    await press(container, 'Delete group');

    expect(state.deleteGroup).toHaveBeenCalledWith({ groupId: 'g1' });
    expect(container.textContent).toContain('Group deleted.');
  });

  it('reports a refused delete', async () => {
    state.deleteGroup = vi.fn().mockRejectedValue(new Error('Ravi Kumar still owes ₹120.00.'));

    const container = visit();
    await press(container, 'Delete group');

    expect(container.textContent).toContain('Ravi Kumar still owes ₹120.00.');
  });
});
