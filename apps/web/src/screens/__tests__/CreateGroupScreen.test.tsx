/**
 * `/groups/new`.
 *
 * Group creation is the one direct client write in this tab, so what matters here is the shape
 * of the payload: `createGroup` is handed the signed-in uid and the three fields Rules allow,
 * and nothing else. `memberIds`, `memberCount` and `createdBy` are the repository's to set from
 * that uid (threat T4), and the creator's member document is `onGroupCreated`'s (Article III).
 *
 * `CURRENCIES` is the real table from core — the point of the picker is that it comes from the
 * hardcoded ISO 4217 list rather than from `Intl` (docs/04 §1).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import { render } from '../../__tests__/helpers/render';
import { paths } from '../../navigation/paths';
import { CreateGroupScreen } from '../CreateGroupScreen';

const state = vi.hoisted(() => ({
  user: null as unknown,
  profile: null as unknown,
  createGroup: vi.fn(),
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useAuth: () => ({ user: state.user, profile: state.profile, loading: false, error: null }),
  useProfile: () => ({ profile: state.profile, loading: false, error: null }),
}));

vi.mock('@splitsutra/core/repositories', () => ({
  createGroup: (...args: unknown[]) => state.createGroup(...args) as Promise<string>,
}));

const routes: RouteObject[] = [
  { path: '/groups/new', element: <CreateGroupScreen /> },
  { path: '/groups/:gid', element: <p>Group home</p> },
];

function visit(): HTMLElement {
  const memory = createMemoryRouter(routes, { initialEntries: [paths.CreateGroup()] });
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

beforeEach(() => {
  state.user = { uid: 'u1' };
  state.profile = null;
  state.createGroup = vi.fn().mockResolvedValue('g-new');
});

describe('<CreateGroupScreen>', () => {
  it('cannot save while nobody is signed in', () => {
    state.user = null;

    const container = visit();
    type(field(container, 'Group name'), 'Goa Trip');

    expect(button(container, 'Create').disabled).toBe(true);
  });

  it('cannot save an empty name, and says why once the field is touched', () => {
    const container = visit();

    expect(button(container, 'Create').disabled).toBe(true);
    expect(container.textContent).not.toContain('Give the group a name');

    type(field(container, 'Group name'), 'Goa Trip');
    type(field(container, 'Group name'), '   ');

    expect(container.textContent).toContain('Give the group a name');
    expect(button(container, 'Create').disabled).toBe(true);
  });

  it('offers the pinned common currencies until the search narrows them', () => {
    const container = visit();

    expect(currencies(container)).toHaveLength(8);
    expect(container.textContent).toContain('Showing the most common');

    type(field(container, 'Find a currency'), 'rupee');

    const narrowed = currencies(container);

    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed[0]?.textContent).toContain('INR');
  });

  it('says so when nothing matches, rather than showing an empty box', () => {
    const container = visit();

    type(field(container, 'Find a currency'), 'zzz');

    expect(currencies(container)).toHaveLength(0);
    expect(container.textContent).toContain('No currency matches');
    expect(container.textContent).toContain('Try the three-letter code');
  });

  it('🔴 states that the currency is fixed at creation (AC-C1.1)', () => {
    const text = visit().textContent ?? '';

    expect(text).toContain("a group's currency is fixed when it is created");
    expect(text).toContain('nothing is ever converted');
  });

  it("starts from the profile's default currency", () => {
    state.profile = { uid: 'u1', defaultCurrency: 'INR' };

    const container = visit();

    expect(container.textContent).toContain('INR · ₹');
  });

  it('falls back to the app default when the profile has not arrived', () => {
    expect(visit().textContent).toContain('USD · $');
  });

  it('creates with the signed-in uid and only the fields Rules allow', async () => {
    const container = visit();

    type(field(container, 'Group name'), '  Goa Trip  ');
    await press(container, 'Home');
    await press(container, 'Use Indian Rupee');
    await press(container, 'Create');

    expect(state.createGroup).toHaveBeenCalledTimes(1);
    const [uid, input] = state.createGroup.mock.calls[0] as [string, Record<string, unknown>];

    expect(uid).toBe('u1');
    expect(input).toEqual({ name: 'Goa Trip', type: 'home', currency: 'INR' });
    // 🔴 Threat T4 / Article III: none of these is the client's to choose.
    expect(Object.keys(input)).not.toContain('memberIds');
    expect(Object.keys(input)).not.toContain('memberCount');
    expect(Object.keys(input)).not.toContain('createdBy');
  });

  it('marks the chosen currency as selected', async () => {
    const container = visit();
    await press(container, 'Use Indian Rupee');

    const selected = [...container.querySelectorAll('[aria-label="Indian Rupee, selected"]')];

    expect(selected).toHaveLength(1);
    expect(container.textContent).toContain('INR · ₹');
  });

  it('lands on the new group once it is created', async () => {
    const container = visit();

    type(field(container, 'Group name'), 'Goa Trip');
    await press(container, 'Create');

    expect(container.textContent).toContain('Group home');
  });

  it('stays put and says what went wrong when the write is refused', async () => {
    state.createGroup = vi.fn().mockRejectedValue(new Error('Missing or insufficient permissions'));

    const container = visit();

    type(field(container, 'Group name'), 'Goa Trip');
    await press(container, 'Create');

    expect(container.textContent).toContain('Missing or insufficient permissions');
    expect(container.textContent).not.toContain('Group home');
  });

  it('clears a failure the moment the form is edited again', async () => {
    state.createGroup = vi.fn().mockRejectedValue(new Error('Missing or insufficient permissions'));

    const container = visit();

    type(field(container, 'Group name'), 'Goa Trip');
    await press(container, 'Create');
    type(field(container, 'Group name'), 'Goa Trip 2026');

    expect(container.textContent).not.toContain('Missing or insufficient permissions');
  });
});
