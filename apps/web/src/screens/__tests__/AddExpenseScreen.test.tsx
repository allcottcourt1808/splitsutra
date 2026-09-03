/**
 * `/expense/new` — the screen the product lives or dies on.
 *
 * The arithmetic is proved in `screens/expense/__tests__/formState.test.tsx`. What is checked
 * here is everything that only exists once the form is on screen:
 *
 * - the three states of a subscription are three different screens, never one;
 * - Save is disabled until the draft is complete, and what it writes is what the split engine
 *   resolved — with the **same expense id** the preview used as its tie-break seed;
 * - the checksum pair the Security Rules compare against `amountMinor` holds for the draft
 *   that actually gets written;
 * - `participantIds` — `splits.map(s => s.uid)` — follows the ticked rows exactly.
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import { sumMinor, type Group, type GroupMember } from '@splitsutra/core';

import { render } from '../../__tests__/helpers/render';
import { paths } from '../../navigation/paths';
import { previewSplits, type ExpenseDraft } from '../expense/formState';
import { AddExpenseScreen } from '../AddExpenseScreen';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Seams
 * ────────────────────────────────────────────────────────────────────────────────────────── */

interface Emitter<T> {
  next: (value: T) => void;
  fail: (error: Error) => void;
}

const seam = vi.hoisted(() => ({
  groups: null as unknown,
  members: null as unknown,
  createExpense: vi.fn(),
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: { displayName: 'Me' } }),
  // Feeds the picker's friendship labels. Empty, so a 1:1 falls back to stripping `selfName`.
  useFriends: () => ({ friends: [], loading: false, error: null }),
}));

vi.mock('@splitsutra/core/repositories', () => ({
  newExpenseId: () => 'e-new',
  createExpense: (...args: unknown[]) => seam.createExpense(...args) as unknown,
  watchExpenseGroups: (_uid: string, next: unknown, fail: unknown) => {
    seam.groups = { next, fail };
    return vi.fn();
  },
  watchExpenseMembers: (_groupId: string, next: unknown, fail: unknown) => {
    seam.members = { next, fail };
    return vi.fn();
  },
}));

function groupFeed(): Emitter<readonly Group[]> {
  return seam.groups as Emitter<readonly Group[]>;
}

function memberFeed(): Emitter<readonly GroupMember[]> {
  return seam.members as Emitter<readonly GroupMember[]>;
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Fixtures and DOM helpers
 * ────────────────────────────────────────────────────────────────────────────────────────── */

const GROUP = { id: 'g1', name: 'Goa Trip', currency: 'USD' } as unknown as Group;

const MEMBERS = [
  { uid: 'u1', displayName: 'Neethu', photoURL: null, role: 'admin' },
  { uid: 'u2', displayName: 'Priya Sharma', photoURL: null, role: 'member' },
  { uid: 'u3', displayName: 'Ravi Kumar', photoURL: null, role: 'member' },
] as unknown as GroupMember[];

/** A friendship's implicit 1:1 group (D2) — what "add an expense with a friend" writes to. */
const IMPLICIT_GROUP = {
  id: 'g-implicit',
  name: 'Priya Sharma',
  currency: 'USD',
  isImplicit: true,
  memberIds: ['u1', 'u2'],
} as unknown as Group;

const PAIR = MEMBERS.slice(0, 2);

const routes: RouteObject[] = [
  { path: '/expense/new', element: <AddExpenseScreen /> },
  { path: '/groups/:gid', element: <p>Landed on the group</p> },
  { path: '/groups', element: <p>Landed on the group list</p> },
  { path: '/friends/:uid', element: <p>Landed on the friend</p> },
];

function visit(at: string = `${paths.AddExpense()}?gid=g1`): HTMLElement {
  const memory = createMemoryRouter(routes, { initialEntries: [at] });
  return render(<RouterProvider router={memory} />).container;
}

/** Mount, then let both subscriptions answer — the ordinary case every test but three needs. */
function visitLoaded(): HTMLElement {
  const container = visit();
  act(() => {
    groupFeed().next([GROUP]);
  });
  act(() => {
    memberFeed().next(MEMBERS);
  });
  return container;
}

function field(container: HTMLElement, label: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label')].find(
    (candidate) => (candidate.textContent ?? '').trim() === label,
  );
  const input = found === undefined ? null : document.getElementById(found.htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error(`no field labelled "${label}"`);
  return input;
}

/**
 * Type into a controlled input.
 *
 * The value goes through the prototype setter rather than `input.value = …` so React's own
 * value tracker sees a change and does not swallow the event.
 */
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

/** The ✓/○ toggle in front of a split row, in member order. */
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

function fillValidExpense(container: HTMLElement): void {
  type(field(container, 'Amount'), '100.00');
  type(field(container, 'Description'), 'Dinner at Olive');
}

function savedDraft(): ExpenseDraft {
  const call = seam.createExpense.mock.calls.at(-1);
  if (call === undefined) throw new Error('createExpense was never called');
  return call[0] as ExpenseDraft;
}

beforeEach(() => {
  seam.groups = null;
  seam.members = null;
  seam.createExpense = vi.fn().mockResolvedValue('e-new');
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Tests
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('<AddExpenseScreen> — loading, error, empty', () => {
  it('says it is loading before the group list answers', () => {
    const container = visit();

    expect(container.textContent).toContain('Loading');
    expect(container.querySelector('input')).toBeNull();
  });

  it('reports a failed subscription rather than an empty form', () => {
    const container = visit();

    act(() => {
      groupFeed().fail(new Error('permission denied'));
    });

    expect(container.textContent).toContain('permission denied');
    expect(container.querySelector('input')).toBeNull();
  });

  it('offers the next action when there is no group to spend in', () => {
    const container = visit();

    act(() => {
      groupFeed().next([]);
    });

    expect(container.textContent).toContain('No group yet');
    expect(container.querySelector(`a[href="${paths.CreateGroup()}"]`)).not.toBeNull();
    expect(container.querySelector(`a[href="${paths.AddFriend()}"]`)).not.toBeNull();
  });
});

describe('<AddExpenseScreen> — the three-tap path', () => {
  it('opens on the group from the query string with everyone in and you paying', () => {
    const container = visitLoaded();
    const text = container.textContent ?? '';

    expect(text).toContain('Goa Trip');
    expect(text).toContain('Priya Sharma');
    expect(includeToggles(container)).toHaveLength(3);
    expect(
      includeToggles(container).every((toggle) => toggle.getAttribute('aria-pressed') === 'true'),
    ).toBe(true);
    // Article IX / NFR-4: the amount is the field that gets focus and a numeric keypad.
    expect(field(container, 'Amount').inputMode).toBe('decimal');
  });

  it('keeps Save disabled until the draft is complete', () => {
    const container = visitLoaded();

    expect(button(container, 'Save').disabled).toBe(true);

    type(field(container, 'Amount'), '100.00');
    expect(button(container, 'Save').disabled).toBe(true);

    type(field(container, 'Description'), 'Dinner at Olive');
    expect(button(container, 'Save').disabled).toBe(false);
  });

  it('previews the amounts the split engine resolves, remainder unit included', () => {
    const container = visitLoaded();

    fillValidExpense(container);

    // $100 across three people is 33.34 / 33.33 / 33.33 — never 33.33 three times.
    const text = container.textContent ?? '';
    expect(text).toContain('33.34');
    expect(text).toContain('33.33');
  });

  it('states an amount it cannot read instead of rounding it', () => {
    const container = visitLoaded();

    type(field(container, 'Amount'), '1.234');

    expect(container.textContent).toContain('2 decimal places');
    expect(button(container, 'Save').disabled).toBe(true);
  });
});

describe('<AddExpenseScreen> — where it lands afterwards', () => {
  it('goes to the group for an ordinary group', async () => {
    const container = visitLoaded();

    fillValidExpense(container);
    await pressAndSettle(button(container, 'Save'));

    expect(container.textContent).toContain('Landed on the group');
  });

  it('goes to the FRIEND for a friend expense, not the implicit group', async () => {
    // 🔴 The implicit group is not a place in this product. `groupRepo` filters implicit groups
    // out of the Groups tab, so landing on `/groups/g-implicit` gave a screen you could see
    // exactly once and never navigate back to — and presented a friendship as a group, which is
    // the internal model leaking out. The friendship's own screen is where the expense lives.
    const container = visit(`${paths.AddExpense()}?gid=g-implicit`);
    act(() => {
      groupFeed().next([IMPLICIT_GROUP]);
    });
    act(() => {
      memberFeed().next(PAIR);
    });

    fillValidExpense(container);
    await pressAndSettle(button(container, 'Save'));

    expect(container.textContent).toContain('Landed on the friend');
    expect(container.textContent).not.toContain('Landed on the group');
  });
});

describe('<AddExpenseScreen> — what gets written', () => {
  it('writes the draft under the id the preview was seeded with', async () => {
    const container = visitLoaded();

    fillValidExpense(container);
    await pressAndSettle(button(container, 'Save'));

    // 🔴 The tie-break seed. A different id here moves a cent between two people.
    expect(seam.createExpense).toHaveBeenCalledWith(expect.anything(), 'u1', 'e-new');
    expect(savedDraft().amountMinor).toBe(10_000);
    expect(savedDraft().description).toBe('Dinner at Olive');
    expect(savedDraft().paidBy).toEqual([{ uid: 'u1', amountMinor: 10_000 }]);
  });

  it('writes a draft whose splits and payers both total the amount', async () => {
    const container = visitLoaded();

    fillValidExpense(container);
    await pressAndSettle(button(container, 'Save'));

    // 🔴 The two-layer integrity check: `expenseRepo` derives splitsTotalMinor / paidTotalMinor
    // from these very arrays, and the rule denies the write unless both equal amountMinor.
    const draft = savedDraft();
    const splits = previewSplits(draft.split, draft.amountMinor, 'e-new');

    expect(sumMinor(splits.map((split) => split.amountMinor))).toBe(draft.amountMinor);
    expect(sumMinor(draft.paidBy.map((payer) => payer.amountMinor))).toBe(draft.amountMinor);
  });

  it('carries only the ticked participants, because participantIds is built from them', async () => {
    const container = visitLoaded();

    fillValidExpense(container);
    press(includeToggles(container)[2] as HTMLElement);
    await pressAndSettle(button(container, 'Save'));

    const draft = savedDraft();
    const splits = previewSplits(draft.split, draft.amountMinor, 'e-new');

    expect(splits.map((split) => split.uid)).toEqual(['u1', 'u2']);
    expect(sumMinor(splits.map((split) => split.amountMinor))).toBe(10_000);
  });

  it('lands on the group once the write resolves', async () => {
    const container = visitLoaded();

    fillValidExpense(container);
    await pressAndSettle(button(container, 'Save'));

    expect(container.textContent).toContain('Landed on the group');
  });

  it('shows a denial in words and stays on the form', async () => {
    seam.createExpense = vi
      .fn()
      .mockRejectedValue(new Error('Missing or insufficient permissions'));
    const container = visitLoaded();

    fillValidExpense(container);
    await pressAndSettle(button(container, 'Save'));

    expect(container.textContent).toContain('Missing or insufficient permissions');
    expect(container.textContent).not.toContain('Landed on the group');
    expect(field(container, 'Description').value).toBe('Dinner at Olive');
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Category auto-detection
 * ────────────────────────────────────────────────────────────────────────────────────────── */

const CATEGORY_NAMES =
  /General|Food|Groceries|Transport|Fuel|Travel|Accommodation|Rent|Utilities|Household|Entertainment|Medical|Insurance|Education/u;

/**
 * A category chip by its label.
 *
 * Not `button()`: a chip renders its decorative glyph inside the same element as its label, so
 * its `textContent` is "🎬Entertainment" with no separator and an exact-match lookup finds
 * nothing.
 */
/** The collapsed category row, or `undefined` when the picker is already open. */
function categoryRow(container: HTMLElement): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((candidate) =>
    (candidate.getAttribute('aria-label') ?? '').startsWith('Category, '),
  );
}

function categoryChip(container: HTMLElement, name: string): HTMLButtonElement {
  // The chips live behind a collapsed summary row now (CategoryPicker), so a test that wants
  // one has to open the picker exactly as a user would.
  const row = categoryRow(container);
  if (row !== undefined) press(row);

  const found = [...container.querySelectorAll('button')].find((candidate) =>
    (candidate.textContent ?? '').endsWith(name),
  );
  if (found === undefined) throw new Error(`no category chip for "${name}"`);
  return found;
}

/**
 * The current category — off the collapsed row's accessible name, or off `aria-pressed` when
 * the grid happens to be open. Never off styling.
 *
 * 🔴 Reading the COLLAPSED row is the point of the first branch. The category is auto-detected
 *    from the description, and the only thing that makes that safe is the guess staying visible
 *    without opening anything. Asserting through the summary row is asserting that.
 */
function selectedCategory(container: HTMLElement): string {
  const row = categoryRow(container);
  if (row !== undefined) {
    return (row.getAttribute('aria-label') ?? '')
      .replace(/^Category, /u, '')
      .replace(/\. Change it$/u, '');
  }

  const chips = [...container.querySelectorAll('button[aria-pressed="true"]')];
  const category = chips.find((chip) => CATEGORY_NAMES.test(chip.textContent ?? ''));
  return (category?.textContent ?? '').replace(/[^A-Za-z]/gu, '');
}

describe('<AddExpenseScreen> — category from the description', () => {
  it('starts on the default category', () => {
    expect(selectedCategory(visitLoaded())).toBe('General');
  });

  it('follows the description as it is typed', () => {
    const container = visitLoaded();

    type(field(container, 'Description'), 'Dinner at Olive');
    expect(selectedCategory(container)).toBe('Food');

    type(field(container, 'Description'), 'Petrol on the way');
    expect(selectedCategory(container)).toBe('Fuel');
  });

  it('falls back to the default when the description stops matching', () => {
    const container = visitLoaded();

    type(field(container, 'Description'), 'Dinner at Olive');
    expect(selectedCategory(container)).toBe('Food');

    // Not left on Food describing text that no longer mentions it.
    type(field(container, 'Description'), 'Something else entirely');
    expect(selectedCategory(container)).toBe('General');
  });

  it('never overrules a category the user picked, however the description changes', () => {
    const container = visitLoaded();

    type(field(container, 'Description'), 'Dinner at Olive');
    expect(selectedCategory(container)).toBe('Food');

    press(categoryChip(container, 'Entertainment'));
    expect(selectedCategory(container)).toBe('Entertainment');

    // The guess is spent for the rest of this form. This is the assertion that matters: a
    // deliberate choice surviving further typing is the difference between a helpful default
    // and a field that fights you.
    type(field(container, 'Description'), 'Dinner and drinks');
    expect(selectedCategory(container)).toBe('Entertainment');

    type(field(container, 'Description'), 'Petrol');
    expect(selectedCategory(container)).toBe('Entertainment');
  });

  it('saves the detected category rather than the default', async () => {
    const container = visitLoaded();

    fillValidExpense(container);
    type(field(container, 'Description'), 'Groceries for the week');
    await pressAndSettle(button(container, 'Save'));

    expect(seam.createExpense.mock.calls[0]?.[0]).toMatchObject({ category: 'groceries' });
  });
});
