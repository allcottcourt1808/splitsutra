/**
 * What a group is called on screen — and above all, what a FRIENDSHIP is called.
 *
 * These moved here from `GroupPicker.test.tsx`, which is where the rule used to live. It stopped
 * being picker-local when ADR-13 started promoting a friendship into the Groups tab: the stored
 * `"<you> & <them>"` reached a list row, a screen header and an activity subtitle, and the same
 * answer has to come out of all of them.
 *
 * 🔴 The regression this file exists to catch is the `isImplicit` one. Promotion clears that
 *    flag, so any rule keyed on it goes quiet at exactly the moment the name becomes visible —
 *    the same trap the balance projection fell into. `promoted()` below is the fixture that
 *    would have caught it, and it is the only fixture that matters.
 */

import { describe, expect, it } from 'vitest';

import type { NameableGroup } from '../groupLabel';
import { groupLabel, isFriendship } from '../groupLabel';

/** A friendship that has never held an expense: still hidden. */
function friendship(name: string): NameableGroup {
  return { name, type: 'friend' };
}

/**
 * A friendship AFTER ADR-13 promotion. Structurally identical for naming purposes — which is
 * the point: `type` is what carries the fact, and `isImplicit` is not consulted at all.
 */
const promoted = friendship;

function realGroup(name: string): NameableGroup {
  return { name, type: 'trip' };
}

describe('isFriendship', () => {
  it('is about the type, which promotion does not change', () => {
    expect(isFriendship(friendship('Me & Priya'))).toBe(true);
    expect(isFriendship(promoted('Me & Priya'))).toBe(true);
    expect(isFriendship(realGroup('Goa'))).toBe(false);
    // `friends` is a group somebody chose to label that way. Not a friendship.
    expect(isFriendship({ name: 'The lads', type: 'friends' })).toBe(false);
  });
});

describe('groupLabel', () => {
  it('drops the viewer from a 1:1 label, at either end', () => {
    expect(groupLabel(friendship('Me & Priya'), { selfName: 'Me' })).toBe('Priya');
    expect(groupLabel(friendship('Priya & Me'), { selfName: 'Me' })).toBe('Priya');
  });

  it('🔴 keeps doing it after promotion', () => {
    // The whole bug: a friendship becomes an ordinary, VISIBLE group the first time it holds an
    // expense, and that is the first time anyone sees its name. A rule that stopped here would
    // have looked correct in every test written before ADR-13.
    expect(groupLabel(promoted('Me & Priya'), { selfName: 'Me' })).toBe('Priya');
  });

  it('prefers a supplied friend name over anything parsed out of the stored one', () => {
    // The stored name is a snapshot from when the friendship was established; a member document
    // is rewritten by the profile fan-out. When a caller has one, it wins.
    expect(groupLabel(promoted('Me & Priya'), { friendName: 'Priya Nair', selfName: 'Me' })).toBe(
      'Priya Nair',
    );
    // And it rescues a name `implicitGroupName` truncated at 60 characters:
    expect(groupLabel(promoted('Me & Priya Nai'), { friendName: 'Priya Nair' })).toBe('Priya Nair');
  });

  it('ignores a blank or whitespace friend name rather than showing an empty row', () => {
    expect(groupLabel(promoted('Me & Priya'), { friendName: '   ', selfName: 'Me' })).toBe('Priya');
    expect(groupLabel(promoted('Me & Priya'), { friendName: null, selfName: 'Me' })).toBe('Priya');
  });

  it('leaves a real group alone even when the name contains yours', () => {
    expect(groupLabel(realGroup('Me & the lads'), { selfName: 'Me' })).toBe('Me & the lads');
    // …and even when a friend name is passed, which a caller does unconditionally.
    expect(groupLabel(realGroup('Goa'), { friendName: 'Priya', selfName: 'Me' })).toBe('Goa');
  });

  it('shows a deliberately renamed friendship verbatim, to both members', () => {
    // No " & ", so `implicitGroupName` cannot have produced it — somebody typed it.
    expect(groupLabel(promoted('Goa 2026'), { friendName: 'Priya', selfName: 'Me' })).toBe(
      'Goa 2026',
    );
  });

  it('🔴 falls back to the stored name rather than guessing', () => {
    // The three ways the cheap `split(' & ')` version would have been wrong.
    // A name containing an ampersand of its own:
    expect(groupLabel(friendship('Ben & Jerry & Me'), { selfName: 'Me' })).toBe('Ben & Jerry');
    // `implicitGroupName` truncates the join at 60 chars, so the viewer's name can be cut:
    expect(groupLabel(friendship('Priya & M'), { selfName: 'Me' })).toBe('Priya & M');
    // No name to match against, and no friend name either:
    expect(groupLabel(friendship('Priya & Me'), { selfName: '' })).toBe('Priya & Me');
    expect(groupLabel(friendship('Priya & Me'))).toBe('Priya & Me');
  });
});
