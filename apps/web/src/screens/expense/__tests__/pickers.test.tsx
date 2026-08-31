/**
 * The two smaller composer pickers — `MemberPicker` and `CategoryPicker`.
 *
 * Both collapse a wrapping chip row to a single summary row, and both are only defensible
 * because the value they collapse is usually already right. So the assertions are the same
 * pair each time: collapsed shows the current value and nothing else, and the current value is
 * never hidden — a picker that concealed its own state would be worse than the chips it
 * replaced, not smaller.
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';

import type { ExpenseCategory, GroupMember } from '@splitsutra/core';

import { render } from '../../../__tests__/helpers/render';
import { MemberPicker } from '../MemberPicker';
import { CategoryPicker } from '../CategoryPicker';

function member(uid: string, displayName: string): GroupMember {
  return { uid, displayName, photoURL: null, role: 'member' } as unknown as GroupMember;
}

/** 50 members — `MAX_GROUP_MEMBERS`, the number the old chip row had to render. */
function manyMembers(): GroupMember[] {
  return Array.from({ length: 50 }, (_, index) =>
    member(`u${String(index)}`, `Person ${String(index)}`),
  );
}

function mount(ui: Parameters<typeof render>[0]) {
  return render(ui).container;
}

function press(container: HTMLElement, label: string): void {
  const target = [...container.querySelectorAll('button, a')].find((element) =>
    (element.getAttribute('aria-label') ?? element.textContent ?? '').includes(label),
  );
  if (target === undefined) throw new Error(`no control matching ${label}`);
  act(() => {
    (target as HTMLElement).click();
  });
}

const nameOf = (uid: string): string => (uid === 'u0' ? 'You' : `Person ${uid.slice(1)}`);

describe('MemberPicker', () => {
  it('🔴 shows one row for fifty members until opened', () => {
    const container = mount(
      <MemberPicker
        members={manyMembers()}
        selectedUid="u0"
        onSelect={() => undefined}
        nameOf={nameOf}
        label="Paid by"
      />,
    );

    expect(container.textContent).toContain('You');
    expect(container.textContent).not.toContain('Person 1');
    expect(container.querySelectorAll('button, a')).toHaveLength(1);
  });

  it('finds someone by the name the row shows, including "You"', () => {
    const container = mount(
      <MemberPicker
        members={[member('u0', 'Alice'), member('u1', 'Bob')]}
        selectedUid="u0"
        onSelect={() => undefined}
        nameOf={nameOf}
        label="Paid by"
      />,
    );

    press(container, 'Change it');

    // `nameOf` renders the signed-in user as "You", and that is the only name for them on
    // screen — searching the stored displayName would make yourself unfindable.
    const input = container.querySelector('input[type="search"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(input, 'you');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(container.textContent).toContain('1 match.');
  });

  it('reports the chosen uid and collapses', () => {
    const chosen: string[] = [];
    const container = mount(
      <MemberPicker
        members={[member('u0', 'Alice'), member('u1', 'Bob')]}
        selectedUid="u0"
        onSelect={(uid) => chosen.push(uid)}
        nameOf={nameOf}
        label="Paid by"
      />,
    );

    press(container, 'Change it');
    press(container, 'Choose Person 1');

    expect(chosen).toEqual(['u1']);
    expect(container.querySelector('input[type="search"]')).toBeNull();
  });
});

describe('CategoryPicker', () => {
  it('🔴 states the current category rather than hiding it', () => {
    // The whole reason auto-detection is safe is that its guess stays visible. A collapsed
    // picker that showed only "Category ›" would break that, silently.
    const container = mount(<CategoryPicker value="travel" onChange={() => undefined} />);

    expect(container.textContent).toContain('Travel');
    expect(container.textContent).not.toContain('Groceries');
  });

  it('expands to every category and collapses again on choosing', () => {
    const chosen: ExpenseCategory[] = [];
    const container = mount(
      <CategoryPicker value="general" onChange={(category) => chosen.push(category)} />,
    );

    press(container, 'Change it');
    // All fourteen, so the expanded state is still the fast recognition grid.
    expect(container.querySelectorAll('button')).toHaveLength(14);

    press(container, 'Groceries');
    expect(chosen).toEqual(['groceries']);
    // Back to one control — leaving the grid open would undo the collapse.
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });
});
