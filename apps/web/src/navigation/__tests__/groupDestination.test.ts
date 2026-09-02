/**
 * The rule this pins: an implicit group is not a place, so nothing should route to it.
 *
 * It has been got wrong twice — `AddExpenseScreen` after saving, and `SettleUpScreen` in both
 * its dismiss target and its post-save redirect — which is why the decision now lives in one
 * function with a test rather than in three call sites with a comment.
 */
import { describe, expect, it } from 'vitest';

import { paths } from '../paths';
import { groupActionDestination } from '../groupDestination';

const SELF = 'u1';
const FRIEND = 'u2';

describe('groupActionDestination', () => {
  it('sends an ordinary group to its own screen', () => {
    const group = { isImplicit: false, memberIds: [SELF, FRIEND, 'u3'] };

    expect(groupActionDestination(group, 'g-goa', SELF)).toBe(paths.GroupDetail({ gid: 'g-goa' }));
  });

  it('sends a friendship to the FRIEND, never to the implicit group', () => {
    // `/groups/{implicitGid}` is filtered out of the Groups tab, so landing there is a screen
    // you can reach once and never navigate back to.
    const group = { isImplicit: true, memberIds: [SELF, FRIEND] };

    expect(groupActionDestination(group, 'g-implicit', SELF)).toBe(
      paths.FriendDetail({ uid: FRIEND }),
    );
  });

  it('picks the OTHER member, not whichever is first', () => {
    const group = { isImplicit: true, memberIds: [FRIEND, SELF] };

    expect(groupActionDestination(group, 'g-implicit', SELF)).toBe(
      paths.FriendDetail({ uid: FRIEND }),
    );
  });

  it('falls back to the group when there is no other member', () => {
    // Should not exist. Losing the redirect beats routing to `/friends/undefined`.
    const group = { isImplicit: true, memberIds: [SELF] };

    expect(groupActionDestination(group, 'g-broken', SELF)).toBe(
      paths.GroupDetail({ gid: 'g-broken' }),
    );
  });

  it('falls back to the group when the group has not loaded yet', () => {
    expect(groupActionDestination(null, 'g-goa', SELF)).toBe(paths.GroupDetail({ gid: 'g-goa' }));
  });
});
