/**
 * The tab bar's accessibility contract.
 *
 * `TabBar.tsx` states it in its own header, and these tests are that header made executable:
 *
 *   - the visible text label IS the accessible name; icons are `aria-hidden`
 *   - the active tab carries `aria-current="page"`
 *   - the raised Add button is labelled, and is never the current tab
 *
 * Every one of these fails silently. A screen reader announcing five identically-named
 * buttons, or announcing no current page at all, looks completely correct on screen — which
 * is exactly why it is worth a test rather than a review pass (NFR-4).
 */

import { describe, expect, it } from 'vitest';
import { renderAt } from '../../__tests__/helpers/render';
import { TABS } from '../paths';
import { TabBar } from '../TabBar';

function tabBar(container: HTMLElement): HTMLElement {
  const nav = container.querySelector<HTMLElement>('nav');
  expect(nav, 'TabBar rendered no <nav>').not.toBeNull();
  return nav!;
}

function tabLinks(container: HTMLElement): readonly HTMLAnchorElement[] {
  return Array.from(tabBar(container).querySelectorAll('a'));
}

/** The one link that is a destination for `key`. */
function linkFor(container: HTMLElement, key: string): HTMLAnchorElement {
  const descriptor = TABS.find((t) => t.key === key);
  expect(descriptor, `no '${key}' tab`).toBeDefined();
  const link = tabLinks(container).find((a) => a.getAttribute('href') === descriptor!.path);
  expect(link, `no link to ${descriptor!.path}`).toBeDefined();
  return link!;
}

function currentHrefs(container: HTMLElement): readonly (string | null)[] {
  return tabLinks(container)
    .filter((a) => a.getAttribute('aria-current') === 'page')
    .map((a) => a.getAttribute('href'));
}

describe('<TabBar>', () => {
  it('exposes the five destinations as a labelled navigation landmark', () => {
    const { container } = renderAt(<TabBar />, '/groups');

    expect(tabBar(container).getAttribute('aria-label')).toBe('Main');
    expect(tabLinks(container).map((a) => a.getAttribute('href'))).toEqual(TABS.map((t) => t.path));
  });

  it('announces the active tab with aria-current="page"', () => {
    const { container } = renderAt(<TabBar />, '/groups');

    expect(linkFor(container, 'groups').getAttribute('aria-current')).toBe('page');
    expect(currentHrefs(container)).toEqual(['/groups']);
  });

  it('keeps a section tab current on a screen nested inside it', () => {
    // Colour alone would still be right here; `aria-current` is what makes it announced.
    const { container } = renderAt(<TabBar />, '/groups/g1/settle');

    expect(currentHrefs(container)).toEqual(['/groups']);
  });

  it('moves aria-current to whichever section the location is in', () => {
    const friends = renderAt(<TabBar />, '/friends/u1');
    expect(currentHrefs(friends.container)).toEqual(['/friends']);

    const account = renderAt(<TabBar />, '/account/profile');
    expect(currentHrefs(account.container)).toEqual(['/account']);
  });

  it('announces no current page on a screen that belongs to no tab', () => {
    const { container } = renderAt(<TabBar />, '/login');

    expect(currentHrefs(container)).toEqual([]);
  });

  it('uses the visible text label as the accessible name of a destination tab', () => {
    const { container } = renderAt(<TabBar />, '/groups');

    for (const descriptor of TABS.filter((t) => !t.raised)) {
      const link = linkFor(container, descriptor.key);
      // An aria-label here would silently replace the visible word with whatever it said,
      // and the two would then drift apart with nothing to catch it.
      expect(link.hasAttribute('aria-label'), descriptor.key).toBe(false);
      expect(link.textContent, descriptor.key).toBe(descriptor.label);
    }
  });

  it('hides the tab icons from the accessibility tree', () => {
    const { container } = renderAt(<TabBar />, '/groups');

    const icons = Array.from(tabBar(container).querySelectorAll('svg'));
    expect(icons).toHaveLength(TABS.length);
    for (const icon of icons) {
      // Otherwise every tab announces twice: once for the glyph, once for the label.
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(icon.getAttribute('focusable')).toBe('false');
    }
  });

  it('labels the raised Add button, which has no text of its own', () => {
    const { container } = renderAt(<TabBar />, '/groups');
    const add = linkFor(container, 'add');

    expect(add.textContent).toBe('');
    expect(add.getAttribute('aria-label')).toBe('Add an expense');
  });

  it('never announces the raised Add button as the current page', () => {
    // docs/07: "it is an action, not a destination". Standing on the screen it opens must
    // not turn it into a selected tab.
    const { container } = renderAt(<TabBar />, '/expense/new');

    expect(linkFor(container, 'add').hasAttribute('aria-current')).toBe(false);
    expect(currentHrefs(container)).toEqual([]);
  });
});
