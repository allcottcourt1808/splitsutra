/**
 * `implicitGroupId → the friend's display name`, for labelling friendship groups in a list.
 *
 * ## Why the friend document, and not the member document
 *
 * `groups/{gid}/members/{otherUid}.displayName` is the better name — it is the one the profile
 * fan-out rewrites when somebody renames themselves. It is also unreachable from a list:
 * `firestore.rules` denies collection-group reads on `members` (T9), so asking "the other
 * person's name in each of my groups" would be one listener per group on top of the one
 * `useMyGroupBalances` already opens. `useFriends` is a single subscription that answers it for
 * every friendship at once, and it is already open on the Friends tab.
 *
 * ⚠️ `friends/{fid}.displayName` is a snapshot taken when the friendship was established, and
 * `onUserProfileWritten` fans out to `usernames/` and `groups/{gid}/members/{uid}` — NOT to
 * friend documents, whatever `friendSchema` says about D4. So a friend who renames themselves
 * keeps their old name here until the friendship is rewritten.
 *
 * That is a pre-existing gap in the Friends list rather than one this introduces, and it costs
 * nothing extra: the alternative source is `groups/{gid}.name`, which is a snapshot from the
 * same moment and goes stale identically. The screen that CAN do better — group detail, which
 * already subscribes to members — passes `friendName` explicitly and does not use this map.
 */

import { useMemo } from 'react';

import { useFriends } from '@splitsutra/core/hooks';

const NONE: ReadonlyMap<string, string> = new Map();

export function useFriendshipNames(): ReadonlyMap<string, string> {
  const { friends } = useFriends();

  return useMemo(() => {
    if (friends.length === 0) return NONE;

    const byGroupId = new Map<string, string>();
    for (const friend of friends) {
      // A friendship with no group is `repairGroupMembership` territory, not a naming problem;
      // an empty name would blank a label that the stored group name could still have filled.
      if (friend.implicitGroupId.length === 0) continue;
      if (friend.displayName.trim().length === 0) continue;
      byGroupId.set(friend.implicitGroupId, friend.displayName);
    }
    return byGroupId;
  }, [friends]);
}
