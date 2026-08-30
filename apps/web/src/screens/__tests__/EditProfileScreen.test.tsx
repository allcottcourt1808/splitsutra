/**
 * `/account/profile` — the currency picker only.
 *
 * The picker is collapsed behind a summary row for the same reason `CreateGroupScreen`'s is: an
 * open search field over eight rows fills a 390px screen and pushes the display name field and
 * the Save button out of reach. What these tests hold is that the collapse never hides the
 * *answer* — the current default is named whether the list is open or not — and that the value
 * a tap chooses is the one `updateUserProfile` is handed.
 *
 * 🔴 One thing is deliberately asserted by its absence: this screen must **not** repeat
 * `CreateGroupScreen`'s "the currency is fixed when it is created" warning. That is AC-C1.1 /
 * threat T10, and it is true of `groups/{gid}.currency`, not of `users/{uid}.defaultCurrency`,
 * which is freely editable and only seeds the next group.
 *
 * `CURRENCIES` is the real table from core — the picker exists because the list is the hardcoded
 * ISO 4217 one rather than whatever `Intl` happens to ship (docs/04 §1).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderAt } from '../../__tests__/helpers/render';
import { paths } from '../../navigation/paths';
import { EditProfileScreen } from '../EditProfileScreen';

const state = vi.hoisted(() => ({
  user: null as unknown,
  profile: null as unknown,
  updateUserProfile: vi.fn(),
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useAuth: () => ({ user: state.user, profile: state.profile, loading: false, error: null }),
  useProfile: () => ({ profile: state.profile, loading: false, error: null }),
}));

vi.mock('@splitsutra/core/repositories', () => ({
  updateUserProfile: (...args: unknown[]) => state.updateUserProfile(...args) as Promise<void>,
}));

function visit(): HTMLElement {
  return renderAt(<EditProfileScreen />, paths.EditProfile()).container;
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

// React tracks the input's value on the node, so the change has to go through the prototype
// setter or it is discarded as a no-op.
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

function currencies(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('ul[aria-label="Currencies"] > li')];
}

/**
 * The picker is collapsed on arrival, so every currency assertion has to open it first. The
 * summary row's accessible name carries the current currency, hence the prefix match.
 */
async function openCurrencyPicker(container: HTMLElement): Promise<void> {
  const row = [...container.querySelectorAll('button, a')].find((el) =>
    (el.getAttribute('aria-label') ?? '').startsWith('Currency, '),
  );
  if (!(row instanceof HTMLElement)) throw new Error('No collapsed currency row to open');
  await act(async () => {
    row.click();
    await Promise.resolve();
  });
}

beforeEach(() => {
  state.user = { uid: 'u1' };
  state.profile = { uid: 'u1', displayName: 'Neethu', defaultCurrency: 'USD' };
  state.updateUserProfile = vi.fn().mockResolvedValue(undefined);
});

describe('<EditProfileScreen> currency picker', () => {
  it('keeps the list collapsed so the name field and Save stay on screen', () => {
    const container = visit();

    expect(container.querySelector('ul[aria-label="Currencies"]')).toBeNull();
    expect(currencies(container)).toHaveLength(0);
    // Collapsed is not hidden: the current default is still named.
    expect(container.textContent).toContain('USD — US Dollar');
    expect(button(container, 'Save').disabled).toBe(true);
  });

  it('offers the pinned common currencies once it is opened', async () => {
    const container = visit();
    await openCurrencyPicker(container);

    expect(currencies(container)).toHaveLength(8);
    expect(container.textContent).toContain('Showing the most common');
    // The one already in effect is marked rather than repeated as a choice.
    expect(container.querySelectorAll('[aria-label="US Dollar, current default"]')).toHaveLength(1);
  });

  it('collapses back to the choice once one is picked', async () => {
    const container = visit();
    await openCurrencyPicker(container);
    await press(container, 'Use Indian Rupee');

    expect(container.querySelector('ul[aria-label="Currencies"]')).toBeNull();
    expect(container.textContent).toContain('INR — Indian Rupee');
    expect(button(container, 'Save').disabled).toBe(false);
  });

  it('closes without changing the selection, and forgets the search when it reopens', async () => {
    const container = visit();
    await openCurrencyPicker(container);

    type(field(container, 'Find a currency'), 'zzz');
    await press(container, 'Done');

    expect(container.querySelector('ul[aria-label="Currencies"]')).toBeNull();
    expect(container.textContent).toContain('USD — US Dollar');
    // Nothing was chosen, so there is still nothing to save.
    expect(button(container, 'Save').disabled).toBe(true);

    await openCurrencyPicker(container);

    expect(currencies(container)).toHaveLength(8);
  });

  it('saves the picked currency, and only the field that changed', async () => {
    const container = visit();
    await openCurrencyPicker(container);
    await press(container, 'Use Indian Rupee');
    await press(container, 'Save');

    expect(state.updateUserProfile).toHaveBeenCalledTimes(1);
    const [uid, patch] = state.updateUserProfile.mock.calls[0] as [string, Record<string, unknown>];

    expect(uid).toBe('u1');
    expect(patch).toEqual({ defaultCurrency: 'INR' });
  });

  it('🔴 does not claim the default is fixed — only a group’s currency is (AC-C1.1)', () => {
    const text = visit().textContent ?? '';

    expect(text).not.toContain('fixed when it is created');
    // Both readers named: an explicit group, and the implicit one a friendship carries. The
    // copy claimed only the first until the Cloud Functions `currencyHint` path turned up.
    expect(text).toContain('starting currency for groups you create');
    expect(text).toContain('add a friend');
  });

  it('offers nothing to change until the profile has arrived', () => {
    state.profile = null;

    const container = visit();

    expect(container.querySelector('ul[aria-label="Currencies"]')).toBeNull();
    expect(
      [...container.querySelectorAll('button, a')].filter((el) =>
        (el.getAttribute('aria-label') ?? '').startsWith('Currency, '),
      ),
    ).toHaveLength(0);
  });
});
