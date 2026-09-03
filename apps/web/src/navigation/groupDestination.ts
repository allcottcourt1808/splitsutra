/**
 * Where to go after acting on a group — and why "the group" is sometimes the wrong answer.
 *
 * 🔴 An implicit group is not a place in this product.
 *
 * A friendship IS a group (D2), so adding an expense or recording a settlement "with a friend"
 * operates on that friendship's implicit group. But `groupRepo` filters implicit groups out of
 * the Groups tab, so `/groups/{implicitGid}` is a screen you can arrive at exactly once and
 * never navigate back to. It also presents a friendship as a group, which is the internal model
 * leaking into the product.
 *
 * The friendship's own screen is the durable destination, and it now shows the balance and the
 * expenses that action just changed.
 *
 * ⚠️ Extracted rather than copied. This was written inline in `AddExpenseScreen` first, and
 * `SettleUpScreen` needed exactly the same decision in two more places — its dismiss target and
 * its post-save redirect. Three copies of a rule about where a friendship lives is how two of
 * them quietly stop agreeing.
 */

import { paths } from './paths';

/** The shape both callers already have to hand; deliberately not the whole `Group`. */
export interface GroupDestinationInput {
  readonly isImplicit: boolean;
  readonly memberIds: readonly string[];
}

/**
 * The screen to land on after an action inside `groupId`.
 *
 * Falls back to the group screen when the other member cannot be identified. A 1:1 group with
 * no second member should not exist, and losing the redirect is a better failure than routing
 * to `/friends/undefined`.
 */
export function groupActionDestination(
  group: GroupDestinationInput | null,
  groupId: string,
  selfUid: string,
): string {
  if (group?.isImplicit !== true) return paths.GroupDetail({ gid: groupId });

  const friendUid = group.memberIds.find((memberId) => memberId !== selfUid);
  return friendUid === undefined
    ? paths.GroupDetail({ gid: groupId })
    : paths.FriendDetail({ uid: friendUid });
}
