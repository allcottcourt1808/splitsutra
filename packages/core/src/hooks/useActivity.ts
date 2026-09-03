/**
 * `useActivity()` — the merged, reverse-chronological feed behind `/activity`.
 *
 * 🔴 **This hook owns N subscriptions**: one over the user's groups, then one per group over
 * that group's `activity`. There is no collection-group rule for `activity`, so there is no
 * single query that can answer "everything that happened to me" — see the cost note in
 * `repositories/activityRepo.ts` and checklists/phase-08 §"The N-query problem". The naive
 * version ships; Phase 10 measures it (Article XII).
 *
 * Pagination is per-group: each group is queried for `pageSize` entries, the results are merged
 * and sliced back to `pageSize`. `loadMore()` widens the window and re-subscribes, which is the
 * honest way to paginate N interleaved streams — a cursor per stream would have to be re-merged
 * on every emission anyway.
 */

import { useEffect, useMemo, useState } from 'react';

import {
  ACTIVITY_PAGE_SIZE,
  watchActivityGroups,
  watchGroupActivity,
} from '../repositories/activityRepo.js';
import type { Unsubscribe } from '../repositories/subscribe.js';
import type { Activity, Group, GroupType } from '../types/index.js';
import { useAuth } from './useAuth.js';

/**
 * One feed row: the entry, plus the group it belongs to.
 *
 * The group context is not on the activity document — it is the path segment above it — and the
 * row needs it to build a link to the expense or the group (`paths.ExpenseDetail` takes both ids).
 */
export interface ActivityFeedEntry {
  readonly groupId: string;
  readonly groupName: string;
  /**
   * `'friend'` for a friendship (D2), before or after ADR-13 promotion.
   *
   * The row needs it because `groupName` is stored as `"<you> & <them>"` for a friendship, so
   * it cannot be shown to either member as-is — see the web app's `groupLabel`. Carried here
   * rather than derived from `isImplicit`, which promotion clears.
   */
  readonly groupType: GroupType;
  /** `true` for the hidden 1:1 friend group (D2), which has no group screen worth linking to. */
  readonly isImplicit: boolean;
  readonly activity: Activity;
}

/** What {@link useActivity} returns. */
export interface UseActivityResult {
  /** Newest first, across every group the user is currently in. */
  readonly entries: readonly ActivityFeedEntry[];
  /** `true` until the groups query **and** every group's first activity snapshot have landed. */
  readonly loading: boolean;
  readonly error: Error | null;
  /** `true` when widening the window could reveal more. */
  readonly hasMore: boolean;
  /** Widen the window by one page. No-op while `hasMore` is false. */
  readonly loadMore: () => void;
}

const NO_ENTRIES: readonly ActivityFeedEntry[] = [];
const NO_GROUPS: readonly Group[] = [];
const NO_BUCKETS: ReadonlyMap<string, readonly Activity[]> = new Map();

/**
 * Newest first, comparing the timestamp's parts rather than `toMillis()`.
 *
 * Core validates timestamps structurally (`TimestampLike`), and nanosecond precision is what
 * separates two entries written by the same batch — millisecond truncation would order them
 * arbitrarily.
 */
function byNewestFirst(a: ActivityFeedEntry, b: ActivityFeedEntry): number {
  const seconds = b.activity.createdAt.seconds - a.activity.createdAt.seconds;
  if (seconds !== 0) return seconds;
  return b.activity.createdAt.nanoseconds - a.activity.createdAt.nanoseconds;
}

interface Merged {
  readonly entries: readonly ActivityFeedEntry[];
  readonly hasMore: boolean;
}

/**
 * Flatten the per-group buckets into one ordered page.
 *
 * Driven by `groups` rather than by the bucket keys, so a group the user has just left cannot
 * contribute rows from a snapshot that has not been torn down yet (AC-F1.4).
 */
function merge(
  groups: readonly Group[],
  buckets: ReadonlyMap<string, readonly Activity[]>,
  pageSize: number,
): Merged {
  const entries: ActivityFeedEntry[] = [];
  let saturated = false;

  for (const group of groups) {
    const bucket = buckets.get(group.id);
    if (bucket === undefined) continue;
    // A group that returned a full page may be hiding more behind its own limit.
    if (bucket.length >= pageSize) saturated = true;
    for (const activity of bucket) {
      entries.push({
        groupId: group.id,
        groupName: group.name,
        groupType: group.type,
        isImplicit: group.isImplicit,
        activity,
      });
    }
  }

  entries.sort(byNewestFirst);
  return { entries: entries.slice(0, pageSize), hasMore: saturated || entries.length > pageSize };
}

export function useActivity(): UseActivityResult {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [pageSize, setPageSize] = useState(ACTIVITY_PAGE_SIZE);
  const [groups, setGroups] = useState<readonly Group[]>(NO_GROUPS);
  const [buckets, setBuckets] = useState<ReadonlyMap<string, readonly Activity[]>>(NO_BUCKETS);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (uid === null) {
      setGroups(NO_GROUPS);
      setBuckets(NO_BUCKETS);
      setReady(true);
      setError(null);
      return;
    }

    setReady(false);
    setError(null);

    // Closure state, not React state: these are rebuilt whenever the effect re-runs, and a
    // snapshot arriving for one group must not clobber another group's rows.
    const perGroup = new Map<string, readonly Activity[]>();
    const subscriptions = new Map<string, Unsubscribe>();
    const awaiting = new Set<string>();
    let groupsSeen = false;

    const publish = (): void => {
      setBuckets(new Map(perGroup));
      setReady(groupsSeen && awaiting.size === 0);
    };

    const stopGroups = watchActivityGroups(
      uid,
      (next) => {
        groupsSeen = true;
        setGroups(next);

        const live = new Set(next.map((group) => group.id));

        for (const group of next) {
          if (subscriptions.has(group.id)) continue;
          awaiting.add(group.id);
          subscriptions.set(
            group.id,
            watchGroupActivity(
              group.id,
              pageSize,
              (rows) => {
                perGroup.set(group.id, rows);
                awaiting.delete(group.id);
                publish();
              },
              setError,
            ),
          );
        }

        for (const [groupId, stop] of subscriptions) {
          if (live.has(groupId)) continue;
          stop();
          subscriptions.delete(groupId);
          perGroup.delete(groupId);
          awaiting.delete(groupId);
        }

        publish();
      },
      setError,
    );

    return () => {
      stopGroups();
      for (const stop of subscriptions.values()) stop();
      subscriptions.clear();
    };
  }, [uid, pageSize]);

  const merged = useMemo(
    () =>
      uid === null ? { entries: NO_ENTRIES, hasMore: false } : merge(groups, buckets, pageSize),
    [uid, groups, buckets, pageSize],
  );

  const loadMore = useMemo(
    () => (): void => {
      setPageSize((current) => current + ACTIVITY_PAGE_SIZE);
    },
    [],
  );

  return useMemo(
    () => ({
      entries: merged.entries,
      loading: !ready && error === null,
      error,
      hasMore: merged.hasMore,
      loadMore,
    }),
    [merged, ready, error, loadMore],
  );
}
