/**
 * `groups/{groupId}/activity` — the audit feed.
 *
 * Read-only to clients (threat T8). Every entry is written by
 * `firebase/functions/src/lib/activity.ts` and `firestore.rules` denies every client write, so
 * this file exposes subscriptions and nothing else.
 *
 * 🔴 **Cost: the cross-group feed is N queries, one per group, merged client-side.**
 * There is no collection-group rule for `activity` — `firestore.rules` grants a read only
 * inside `match /groups/{groupId}`, and the `/{path=**}/activity/{id}` block exists purely to
 * make that absence visibly deliberate. So there is no single query that can answer "everything
 * that happened to me". checklists/phase-08 §"The N-query problem" says to build this naive
 * version, measure it in Phase 10, and only then consider a `users/{uid}/feed` mirror written by
 * the same Function. Do not pre-empt that (Article XII).
 *
 * The merge itself lives in `hooks/useActivity.ts`, which owns the N subscriptions.
 */

import { limit, orderBy, query, where } from 'firebase/firestore';

import type { Activity, Group } from '../types/index.js';
import { activityCollection, groupsCollection } from './refs.js';
import { watchQuery, type OnError, type OnNext, type Unsubscribe } from './subscribe.js';

/** Entries per page (AC-F1.3), applied **per group** before the client-side merge. */
export const ACTIVITY_PAGE_SIZE = 25;

/**
 * The groups whose feeds make up the user's activity, live.
 *
 * Queried here rather than reused from `groupRepo` because the feed's needs differ: it wants
 * every group the user is in — implicit friend groups included, since a 1:1 expense is activity
 * too — and it needs no ordering, so it stays on the automatic single-field index.
 *
 * Soft-deleted groups are dropped client-side rather than with a `where('deletedAt', '==', null)`
 * that would cost a composite index for a handful of documents (AC-F1.4: only groups the user is
 * currently in — leaving a group removes the uid from `memberIds`, so the query itself handles
 * that half).
 */
export function watchActivityGroups(
  uid: string,
  onNext: OnNext<readonly Group[]>,
  onError: OnError,
): Unsubscribe {
  return watchQuery(
    query(groupsCollection(), where('memberIds', 'array-contains', uid)),
    (groups) => {
      onNext(groups.filter((group) => group.deletedAt === null));
    },
    onError,
  );
}

/**
 * One group's feed, newest first.
 *
 * `orderBy('createdAt', 'desc')` on a single field is served by the automatic index, so this
 * needs no entry in `firestore.indexes.json`.
 */
export function watchGroupActivity(
  groupId: string,
  pageSize: number,
  onNext: OnNext<readonly Activity[]>,
  onError: OnError,
): Unsubscribe {
  return watchQuery(
    query(activityCollection(groupId), orderBy('createdAt', 'desc'), limit(pageSize)),
    onNext,
    onError,
  );
}
