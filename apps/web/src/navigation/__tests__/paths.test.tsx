/**
 * `isTabActive` and the path builders.
 *
 * This is the one file in the component project that tests no components at all, and it is
 * the highest-value one. `isTabActive` decides which of five tabs lights up on every screen
 * in the app, it is four lines of string comparison, and every way of getting it wrong
 * (`includes` instead of `startsWith`, forgetting the segment boundary, forgetting that the
 * raised Add button is not a destination) produces a tab bar that still renders fine and is
 * simply pointing at the wrong place.
 *
 * @see docs/07-ui-ux-spec.md §Navigation model
 */

import { describe, expect, it } from 'vitest';
import { SAMPLE_URLS } from '../../__tests__/helpers/sampleUrls';
import { HOME_PATH, ROUTE_PATTERNS, TABS, isTabActive, paths, type TabDescriptor } from '../paths';

function tab(key: TabDescriptor['key']): TabDescriptor {
  const found = TABS.find((candidate) => candidate.key === key);
  expect(found, `TABS has no '${key}' entry`).toBeDefined();
  return found!;
}

function activeTabKeys(pathname: string): readonly string[] {
  return TABS.filter((candidate) => isTabActive(candidate, pathname)).map((t) => t.key);
}

describe('isTabActive', () => {
  it('marks a tab active on its own destination path', () => {
    for (const descriptor of TABS.filter((t) => !t.raised)) {
      expect(isTabActive(descriptor, descriptor.path), descriptor.key).toBe(true);
    }
  });

  it('keeps a section tab active for the screens nested inside it', () => {
    const groups = tab('groups');

    expect(isTabActive(groups, '/groups/g1')).toBe(true);
    expect(isTabActive(groups, '/groups/g1/settle')).toBe(true);
    expect(isTabActive(groups, '/groups/new')).toBe(true);
    expect(isTabActive(tab('account'), '/account/profile')).toBe(true);
  });

  it('does not activate a tab for a path that merely shares its prefix', () => {
    // `startsWith('/groups')` alone would light Groups up on all three of these.
    expect(isTabActive(tab('groups'), '/groupsomething')).toBe(false);
    expect(isTabActive(tab('groups'), '/groups-archive')).toBe(false);
    expect(isTabActive(tab('friends'), '/friendship')).toBe(false);
  });

  it('treats a trailing slash as the section root', () => {
    expect(isTabActive(tab('groups'), '/groups/')).toBe(true);
  });

  it('never marks the raised Add button as the current tab', () => {
    const add = tab('add');

    expect(add.raised).toBe(true);
    // Even standing on the screen it navigates to: it is an action, not a destination.
    expect(isTabActive(add, add.path)).toBe(false);
    expect(isTabActive(add, '/expense')).toBe(false);
    expect(isTabActive(add, '/expense/g1/e1')).toBe(false);
  });

  it('activates at most one tab for any screen in the route table', () => {
    for (const [screen, url] of Object.entries(SAMPLE_URLS)) {
      expect(activeTabKeys(url).length, `${screen} -> ${url}`).toBeLessThanOrEqual(1);
    }
  });

  it('activates no tab for a path outside every section', () => {
    expect(activeTabKeys('/')).toEqual([]);
    expect(activeTabKeys(ROUTE_PATTERNS.SignIn)).toEqual([]);
  });

  it('lights the Groups tab on the home path', () => {
    // docs/07 marks GroupList as Home, and landing there with a dark tab bar looks broken.
    expect(activeTabKeys(HOME_PATH)).toEqual(['groups']);
  });
});

describe('the tab descriptors', () => {
  it('lists the five destinations of the navigation model in order', () => {
    expect(TABS.map((t) => t.key)).toEqual(['groups', 'friends', 'add', 'activity', 'account']);
  });

  it('points every tab at a declared route pattern', () => {
    const declared = new Set<string>(Object.values(ROUTE_PATTERNS));
    for (const descriptor of TABS) {
      expect(declared.has(descriptor.path), `${descriptor.key} -> ${descriptor.path}`).toBe(true);
    }
  });

  it('gives every tab a visible label, since an icon alone never names it', () => {
    for (const descriptor of TABS) {
      expect(descriptor.label.trim().length, descriptor.key).toBeGreaterThan(0);
    }
  });
});

describe('path builders', () => {
  it('percent-encodes params so a pasted invite token cannot invent a path segment', () => {
    // An invite token arrives from a URL someone pasted; it is untrusted input.
    expect(paths.JoinGroup({ token: 'a/b' })).toBe('/invite/a%2Fb');
    expect(paths.JoinGroup({ token: '../groups' })).toBe('/invite/..%2Fgroups');
    expect(paths.GroupDetail({ gid: 'g 1' })).toBe('/groups/g%201');
    expect(paths.ExpenseDetail({ gid: 'g/1', eid: 'e?1' })).toBe('/expense/g%2F1/e%3F1');
  });

  it('builds a URL that starts with its own route pattern prefix', () => {
    expect(paths.GroupSettings({ gid: 'g1' })).toBe('/groups/g1/settings');
    expect(paths.EditExpense({ gid: 'g1', eid: 'e1' })).toBe('/expense/g1/e1/edit');
    expect(paths.FriendDetail({ uid: 'u1' })).toBe('/friends/u1');
  });
});
