/**
 * `/activity` — every group's feed, merged and reverse-chronological (docs/07 §ActivityFeed).
 *
 * ## Article VIII
 *
 * No Firestore here. One hook, `useActivity()`, which owns the one-query-per-group fan-out and
 * the merge; the cost of that shape is documented in `core/src/repositories/activityRepo.ts`
 * and is deliberate until Phase 10 measures it.
 *
 * ## Pagination is a button, not a scroll sentinel
 *
 * checklists/phase-08 §2 asks for infinite scroll. A visible "Load older activity" control is
 * what ships first: it is reachable by keyboard, it announces itself, and it does not depend on
 * `IntersectionObserver`, which has no React Native equivalent (the port swaps it for
 * `FlatList`'s `onEndReached`). Upgrading it later changes this file only.
 */

import { useActivity } from '@splitsutra/core/hooks';

import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Screen, Stack } from '../components/Layout';
import { List } from '../components/List';
import { Text } from '../components/Text';
import { ScreenHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';
import { ActivityRow } from './activity/ActivityRow';

export function ActivityScreen() {
  const { entries, loading, error, hasMore, loadMore } = useActivity();

  const header = <ScreenHeader title="Activity" />;

  if (loading) {
    return (
      <Screen header={header}>
        <Text tone="secondary">Loading…</Text>
      </Screen>
    );
  }

  if (error !== null) {
    return (
      <Screen header={header}>
        <Stack gap="sm" aria-live="polite">
          <Text tone="danger">Could not load your activity. {error.message}</Text>
        </Stack>
      </Screen>
    );
  }

  // One instant for the whole page, so two rows written a second apart do not disagree about
  // whether it is "1h ago" or "2h ago".
  const now = Date.now();

  return (
    <Screen header={header} label="Activity">
      <Stack gap="lg">
        <List
          data={entries}
          aria-label="Activity"
          keyExtractor={(entry) => `${entry.groupId}/${entry.activity.id}`}
          empty={
            <EmptyState
              glyph="📋"
              title="Nothing has happened yet"
              body="Expenses, payments and people joining your groups all show up here. Add an expense to get started."
              action={<Button to={paths.AddExpense()}>Add an expense</Button>}
            />
          }
          renderItem={(entry) => <ActivityRow entry={entry} now={now} />}
        />

        {hasMore && (
          <Button variant="secondary" fullWidth onPress={loadMore}>
            Load older activity
          </Button>
        )}
      </Stack>
    </Screen>
  );
}
