/**
 * The "With you and" picker — what it shows collapsed, and what it does with a long list.
 *
 * The behaviour worth protecting is that this thing stays SMALL. It replaced a wrapping row of
 * chips that rendered one per group, over a collection `watchExpenseGroups` caps at 50 and that
 * includes every 1:1 friend group — so the failure mode was a screen of chips above the amount
 * field. A test that only checked "the selected group is named" would pass just as happily if
 * the other forty-nine were rendered underneath it, so the assertions here are about what is
 * NOT on screen until asked for.
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';

import type { Group } from '@splitsutra/core';

import { render } from '../../../__tests__/helpers/render';
import { GroupPicker } from '../GroupPicker';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Fixtures
 * ────────────────────────────────────────────────────────────────────────────────────────── */

function group(over: Partial<Group> & { id: string; name: string }): Group {
  return {
    type: 'trip',
    isImplicit: false,
    photoURL: null,
    currency: 'USD',
    memberCount: 3,
    ...over,
  } as unknown as Group;
}

function person(id: string, name: string): Group {
  return group({ id, name, type: 'friend', isImplicit: true, memberCount: 2 });
}

/** 50 groups — the real cap, which is the number the old chip row had to render. */
function manyGroups(): Group[] {
  return Array.from({ length: 50 }, (_, index) =>
    group({ id: `g${String(index)}`, name: `Group ${String(index)}` }),
  );
}

function mount(ui: Parameters<typeof render>[0]) {
  return render(ui).container;
}

function rows(container: HTMLElement): string[] {
  return [...container.querySelectorAll('li')].map((li) => li.textContent ?? '');
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

function type(container: HTMLElement, value: string): void {
  const input = container.querySelector('input[type="search"]');
  if (input === null) throw new Error('no search field');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Tests
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('GroupPicker', () => {
  it('🔴 renders ONE row for fifty groups until asked to open', () => {
    const container = mount(
      <GroupPicker
        groups={manyGroups()}
        selectedId="g0"
        onSelect={() => undefined}
        selfName="Me"
      />,
    );

    // The whole point. The old chip row put all fifty on screen above the amount field.
    //
    // Collapsed there is no list at ALL — the summary is a bare row, not a one-item list — so
    // the count of list items is zero rather than one, and the assertion is on the two things
    // that actually matter: the selection is named, and nothing else is.
    expect(rows(container)).toHaveLength(0);
    expect(container.textContent).toContain('Group 0');
    expect(container.textContent).not.toContain('Group 1');

    // One tappable control, so there is exactly one thing to do here and no wall to scan.
    expect(container.querySelectorAll('button, a')).toHaveLength(1);
  });

  it('opens to the full list, sectioned into people and groups', () => {
    const groups = [person('f1', 'Priya & Me'), group({ id: 'g1', name: 'Goa Trip' })];
    const container = mount(
      <GroupPicker groups={groups} selectedId="g1" onSelect={() => undefined} selfName="Me" />,
    );

    press(container, 'Change it');

    expect(container.querySelector('ul[aria-label="People"]')).not.toBeNull();
    expect(container.querySelector('ul[aria-label="Groups"]')).not.toBeNull();
  });

  it('filters on what the reader can see, not the stored name', () => {
    // Stored as "Me & Priya"; the row reads "Priya". Searching "Priya" has to find it, and
    // searching your own name must NOT match every 1:1 you are in.
    const groups = [person('f1', 'Me & Priya'), group({ id: 'g1', name: 'Goa Trip' })];
    const container = mount(
      <GroupPicker groups={groups} selectedId="g1" onSelect={() => undefined} selfName="Me" />,
    );

    press(container, 'Change it');

    type(container, 'priya');
    expect(rows(container)).toHaveLength(1);
    expect(container.textContent).toContain('1 match.');

    type(container, 'Me');
    expect(rows(container)).toHaveLength(0);
    expect(container.textContent).toContain('Nothing matches');
  });

  it('reports the chosen group and closes, so the amount field is not left buried', () => {
    const chosen: string[] = [];
    const groups = [group({ id: 'g1', name: 'Goa Trip' }), group({ id: 'g2', name: 'Flat' })];
    const container = mount(
      <GroupPicker
        groups={groups}
        selectedId="g1"
        onSelect={(id) => chosen.push(id)}
        selfName="Me"
      />,
    );

    press(container, 'Change it');
    press(container, 'Choose Flat');

    expect(chosen).toEqual(['g2']);
    expect(container.querySelector('input[type="search"]')).toBeNull();
  });

  it('offers a way in when nothing is selected yet', () => {
    const container = mount(
      <GroupPicker
        groups={[group({ id: 'g1', name: 'Goa Trip' })]}
        selectedId={null}
        onSelect={() => undefined}
        selfName="Me"
      />,
    );

    // Never a blank row: an empty selection still has to be tappable, or the form is a dead end.
    expect(container.textContent).toContain('Choose a group or person');
    press(container, 'Choose a group or person');
    expect(container.querySelector('input[type="search"]')).not.toBeNull();
  });
});

/* The naming rule itself now lives in `screens/group/groupLabel.ts`, and is tested there — it
   stopped being picker-local when ADR-13 promotion put the same name in the Groups tab. */
