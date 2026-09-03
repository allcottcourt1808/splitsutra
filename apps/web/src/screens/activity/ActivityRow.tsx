/**
 * One row of the activity feed: actor avatar, the server-rendered `summary`, the amount, and a
 * relative timestamp (docs/07 §ActivityFeed).
 *
 * `summary` is displayed verbatim. It is pre-rendered by
 * `firebase/functions/src/lib/activity.ts` precisely so the feed needs no joins — rebuilding
 * the sentence here would be a second implementation of it that could disagree.
 */

import { formatRelativeTime } from '@splitsutra/core';
import type { ActivityFeedEntry } from '@splitsutra/core/hooks';

import { Avatar } from '../../components/Avatar';
import { ListRow } from '../../components/ListRow';
import { Money } from '../../components/Money';
import { paths } from '../../navigation/paths';
import { groupLabel } from '../group/groupLabel';

/**
 * Where tapping the row goes.
 *
 * Expense events deep-link to the expense; everything else lands on the group, because
 * settlements and membership changes have no detail screen of their own. The implicit 1:1
 * friend group (D2) has no group screen at all, so those rows are not tappable.
 */
function targetPath(entry: ActivityFeedEntry): string | undefined {
  const { activity, groupId, isImplicit } = entry;
  const group = isImplicit ? undefined : paths.GroupDetail({ gid: groupId });

  switch (activity.type) {
    case 'expense.created':
    case 'expense.updated':
    case 'expense.deleted':
      return activity.targetId === null
        ? group
        : paths.ExpenseDetail({ gid: groupId, eid: activity.targetId });
    default:
      return group;
  }
}

export interface ActivityRowProps {
  entry: ActivityFeedEntry;
  /**
   * The instant the whole page is rendered against, so every row in one paint agrees about
   * what "2h ago" means.
   */
  now: number;
  /** `implicitGroupId → the friend's name`, and the viewer's own name — see `groupLabel`. */
  friendNames?: ReadonlyMap<string, string> | undefined;
  selfName?: string | undefined;
}

export function ActivityRow({ entry, now, friendNames, selfName }: ActivityRowProps) {
  const { activity, groupId, groupName, groupType, isImplicit } = entry;

  const when = formatRelativeTime(activity.createdAt.toDate(), now);
  // A promoted friendship (ADR-13) reaches this feed with a real destination and a stored name
  // of `"<you> & <them>"`. Naming the group is the point of the line — naming the reader is not.
  const label = groupLabel(
    { name: groupName, type: groupType },
    { friendName: friendNames?.get(groupId), selfName },
  );
  const subtitle = isImplicit ? when : `${when} · ${label}`;

  return (
    <ListRow
      title={activity.summary}
      subtitle={subtitle}
      leading={<Avatar name={activity.actorName} />}
      to={targetPath(entry)}
      trailing={
        // `tone="plain"` — an activity amount is an expense total, not a balance, so it carries
        // no owed/owing direction and must not be coloured as if it did.
        activity.amountMinor !== null && activity.currency !== null ? (
          <Money minorUnits={activity.amountMinor} currency={activity.currency} tone="plain" />
        ) : undefined
      }
    />
  );
}
