/**
 * What to call a group on screen — and specifically, what to call a **friendship**.
 *
 * ## 🔴 A friendship's name cannot be stored, because there is only one of it
 *
 * `establishFriendship` names the pair's group `"<creator> & <other>"` (`implicitGroupName`),
 * and while that group was hidden (D2) the name was cosmetic — it showed up in exports and
 * support tooling and nowhere a user would look. ADR-13 promotes it to an ordinary group the
 * moment it holds an expense, and it inherits every group screen, header and list row along
 * with the features. "Sandeep & Sandeep Tharayil (Sans)" is now a card in the Groups tab.
 *
 * The obvious fix — rename the group to the friend's name at promotion — cannot work. A group
 * document holds ONE `name`, read by BOTH members. Storing "Sandeep" is right for Neethu and
 * absurd for Sandeep, who would open the Groups tab and find a card named after himself. The
 * friend's name is a per-VIEWER fact, so it has to be resolved per viewer, at render.
 *
 * ## 🔴 Keyed on `type`, deliberately not on `isImplicit`
 *
 * Promotion clears `isImplicit`, so gating on it means the label stops working at exactly the
 * point the group becomes visible — which is the only point it was ever needed. That is the
 * same trap the balance projection fell into (see `recomputeBalances`), and it is worth naming
 * twice: `isImplicit` answers "is this hidden", not "is this a friendship".
 *
 * `type === 'friend'` is the durable answer, and it is not forgeable. `SELECTABLE_GROUP_TYPES`
 * excludes `friend`, and `updateGroup` takes a `CreatableGroupType`, so no client can set the
 * flag on an ordinary group or clear it on a friendship — only `establishFriendship` writes it.
 *
 * ## A deliberate rename still wins
 *
 * A pair can rename their group ("Goa 2026") and both of them should then see that, not each
 * other's names. The auto-generated name always contains `" & "` because that is the only
 * separator `implicitGroupName` uses, so a stored name WITHOUT it was chosen by a person and is
 * shown verbatim.
 *
 * ⚠️ The converse is not exact: renaming to something that itself contains `" & "` ("Bob & the
 * bikes") reads as auto-generated and gets overridden. It fails toward the friend's name, which
 * is never wrong about who the group is with — and renaming without an ampersand fixes it. The
 * principled version is a server-written `nameIsAuto` marker; it is not worth a schema field and
 * a Functions deploy until this heuristic is actually observed to misfire.
 */

import type { GroupType } from '@splitsutra/core';

/** The shape this needs — structural, so callers can pass a `Group` or a test fixture. */
export interface NameableGroup {
  readonly name: string;
  readonly type: GroupType;
}

/** The separator `implicitGroupName` joins the two display names with. */
const JOIN = ' & ';

/**
 * Is this group the two-person container behind a friendship (D2), before or after ADR-13
 * promotion?
 *
 * Exported because callers need the same answer for more than the label: a friendship has no
 * meaningful member count ("2 members" is both of you) and belongs under "People" rather than
 * "Groups" in the expense picker.
 */
export function isFriendship(group: NameableGroup): boolean {
  return group.type === 'friend';
}

/**
 * The stored name with the viewer's own name removed from either end, or `null` when it is not
 * there to remove.
 *
 * 🔴 Only an EXACT match, at one end or the other. Splitting on `" & "` would be shorter and
 *    wrong: a display name may itself contain an ampersand, and `implicitGroupName` truncates
 *    the join at 60 characters, so the second name can be cut mid-word. Both cases simply fail
 *    to match here, and the caller falls back to the stored name — long, never wrong.
 */
function withoutSelf(name: string, selfName: string): string | null {
  if (selfName.length === 0) return null;

  const prefix = `${selfName}${JOIN}`;
  if (name.startsWith(prefix)) return name.slice(prefix.length);

  const suffix = `${JOIN}${selfName}`;
  if (name.endsWith(suffix)) return name.slice(0, -suffix.length);

  return null;
}

/** Where the counterparty's name can come from, best source first. */
export interface GroupLabelSources {
  /**
   * The other member's CURRENT display name, when the caller already has it.
   *
   * The freshest source there is: member documents are the one place the profile fan-out
   * (`onUserProfileWritten`) actually rewrites on a rename. Screens that already subscribe to
   * members — the group detail header — should pass it.
   */
  readonly friendName?: string | null | undefined;
  /**
   * The viewer's own display name, used to strip their half off the stored `"A & B"`.
   *
   * The fallback for lists, where per-group member documents are unreachable: `firestore.rules`
   * denies collection-group reads on `members` (T9), so a list has no way to ask for everyone
   * else's name in one query.
   */
  readonly selfName?: string | undefined;
}

/**
 * The name to show for `group`, from this viewer's point of view.
 *
 * Ordinary groups are their stored name and nothing else — this only ever changes a friendship.
 */
export function groupLabel(group: NameableGroup, sources: GroupLabelSources = {}): string {
  if (!isFriendship(group)) return group.name;

  // Chosen by a person — see the header. Shown verbatim to both members.
  if (!group.name.includes(JOIN)) return group.name;

  const friendName = sources.friendName?.trim() ?? '';
  if (friendName.length > 0) return friendName;

  return withoutSelf(group.name, sources.selfName ?? '') ?? group.name;
}
