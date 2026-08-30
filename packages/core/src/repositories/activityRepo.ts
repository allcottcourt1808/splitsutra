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

import { limit, orderBy, query } from 'firebase/firestore';

import type { Activity, Group } from '../types/index.js';
import { watchGroupsForUser } from './groupRepo.js';
import { activityCollection } from './refs.js';
import { watchQuery, type OnError, type OnNext, type Unsubscribe } from './subscribe.js';

/** Entries per page (AC-F1.3), applied **per group** before the client-side merge. */
export const ACTIVITY_PAGE_SIZE = 25;

/**
 * The groups whose feeds make up the user's activity, live.
 *
 * 🔴 Not a query — `groupRepo.watchGroupsForUser` owns the only `memberIds array-contains`
 * subscription there is (Article VI). This names the two options the feed differs on:
 *
 * - `includeImplicit: true` — a 1:1 friend expense is activity too, and AC-F1.1 says the feed
 *   lists "group **and friend** events". Only the Groups tab hides implicit groups (D2).
 * - `pageSize: null` — every group the user is currently in (AC-F1.4), not the first 50, and
 *   unordered because the rows are re-sorted after the per-group merge anyway.
 *
 * Soft-deleted groups are dropped there, client-side, rather than with a
 * `where('deletedAt', '==', null)` that would cost a composite index for a handful of documents.
 * Leaving a group removes the uid from `memberIds`, so the query itself handles the other half
 * of AC-F1.4.
 */
export function watchActivityGroups(
  uid: string,
  onNext: OnNext<readonly Group[]>,
  onError: OnError,
): Unsubscribe {
  return watchGroupsForUser(uid, onNext, onError, { includeImplicit: true, pageSize: null });
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
