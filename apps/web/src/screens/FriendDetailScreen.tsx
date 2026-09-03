/**
 * `/friends/:uid` — one friendship, its balance, and the expenses behind it.
 *
 * ## 🔴 A friendship IS a group, and that is where the money lives
 *
 * D2: accepting a friend request creates an **implicit** 1:1 group (`isImplicit: true`,
 * `type: 'friend'`), written by `establishFriendship` through the Admin SDK. Adding an expense
 * "with a friend" writes it to `groups/{friend.implicitGroupId}/expenses/…` like any other
 * group expense, and `recomputeBalances` folds it into that group's member documents.
 *
 * So this screen reads the implicit group. It is not a special case of the money model — it is
 * the ordinary one, reached by a different door. `groupRepo`'s list filter drops implicit groups
 * (`!group.isImplicit`) so a friendship does not appear as a card in Groups; this screen is
 * where it appears instead.
 *
 * ## 🔴 Why the balance comes from the member document, not `friend.balanceMinor`
 *
 * Both now hold the same number, and they are not the same kind of thing.
 *
 * `groups/{gid}/members/{uid}.balanceMinor` is the **authoritative cache** — the value
 * `recomputeBalances` computes from the ledger (Article III). `users/{uid}/friends/{fid}
 * .balanceMinor` is a **projection of it**, written in the same transaction, and it exists for
 * one reason: the Friends LIST cannot reach member documents at all, because `firestore.rules`
 * denies collection-group reads on `members` (T9). A list of N friendships would otherwise need
 * N subscriptions.
 *
 * This screen is already reading one specific friendship, so it reads the authoritative value
 * and skips the copy. A projection can be stale in ways the source cannot — it is skipped when
 * the friend document does not yet exist, and every friendship predating the projection carried
 * an empty map until `auditBalances` repaired it.
 *
 * ⚠️ That is also why the list and this screen once disagreed: the list read the projection back
 * when nothing wrote it, and said "Settled up" to someone who was owed money. If they ever
 * disagree again, the member document is right and the projection is stale — look at
 * `hasFriendProjectionDrift` in `common/balances.ts`.
 *
 * ## Sparse, not zero
 *
 * Article I: a settled balance is an **absent** entry, not `0`. An implicit group has exactly
 * one currency, so there is at most one row here — built only when the balance is non-zero, so
 * "settled up" stays the empty case rather than a row displaying nothing.
 */

import { useParams } from 'react-router';

import { useAuth, useFriend, useGroup, useGroupMembers, useGroups } from '@splitsutra/core/hooks';
import { CURRENCIES, type CurrencyCode, type MinorUnits } from '@splitsutra/core';

import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card, Row, Screen, Stack } from '../components/Layout';
import { EmptyState } from '../components/EmptyState';
import { List } from '../components/List';
import { ListRow } from '../components/ListRow';
import { Money } from '../components/Money';
import { Text } from '../components/Text';
import { ScreenHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';
import { ExpenseLedger } from './group/ExpenseLedger';
import { SharedGroupRow } from './friend/SharedGroupRow';

type BalanceEntry = readonly [CurrencyCode, MinorUnits];

function directionLabel(amount: MinorUnits): string | undefined {
  if (amount > 0) return 'owes you';
  if (amount < 0) return 'you owe';
  return undefined;
}

export function FriendDetailScreen() {
  const { uid } = useParams();
  const { user } = useAuth();
  const { friend, loading, error } = useFriend(uid ?? '');

  // 🔴 Called unconditionally and BEFORE the early returns below, because hooks are not
  // allowed after one. Both tolerate `''` by not subscribing at all, which is exactly the
  // right behaviour while the friend document is still loading or turns out not to exist.
  const implicitGroupId = friend?.implicitGroupId ?? '';
  const { group } = useGroup(implicitGroupId);
  const { activeMembers, me } = useGroupMembers(implicitGroupId);
  const { groups } = useGroups();

  const header = (
    <ScreenHeader title={friend?.displayName ?? 'Friend'} backTo={paths.FriendList()} />
  );

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
          <Text tone="danger">Could not load this friend. {error.message}</Text>
        </Stack>
      </Screen>
    );
  }

  if (friend === null) {
    return (
      <Screen header={header}>
        <EmptyState
          glyph="🔍"
          title="Not a friend"
          body="You are not friends with this person, so there is nothing to show. Send them a request to start sharing expenses."
          action={<Button to={paths.FriendList()}>Back to friends</Button>}
        />
      </Screen>
    );
  }

  /**
   * The real groups both of you are in.
   *
   * `useGroups` already excludes implicit groups and soft-deleted ones, so this cannot pick up
   * the friendship's own group and show it twice — once as "Balance" above and again as a row
   * pretending to be an ordinary group.
   */
  const sharedGroups = groups.filter(
    (candidate) =>
      candidate.id !== implicitGroupId && candidate.memberIds.includes(friend.friendUid),
  );

  // Sparse — see the header. At most one row, because an implicit group has one currency.
  const balances: readonly BalanceEntry[] =
    group !== null && me !== null && me.balanceMinor !== 0
      ? [[group.currency, me.balanceMinor] as BalanceEntry]
      : [];

  return (
    <Screen header={header} label={friend.displayName}>
      <Stack gap="lg">
        <Card>
          <Row gap="md" align="center">
            <Avatar name={friend.displayName} photoURL={friend.photoURL} size="avatarLg" />
            <Stack gap="xs" flex="1">
              <Text variant="title" truncate>
                {friend.displayName}
              </Text>
              <Text variant="caption" tone="secondary">
                {balances.length === 0 ? 'Settled up' : 'Outstanding in 1 currency'}
              </Text>
            </Stack>
          </Row>
        </Card>

        <Stack gap="sm">
          <Text variant="caption" tone="secondary" weight="semibold">
            Balance
          </Text>

          <List
            data={balances}
            aria-label="Balance by currency"
            keyExtractor={([currency]) => currency}
            empty={
              <Card>
                <Stack gap="xs">
                  <Text weight="semibold">Settled up</Text>
                  <Text variant="caption" tone="secondary">
                    {`Nothing outstanding with ${friend.displayName}.`}
                  </Text>
                </Stack>
              </Card>
            }
            renderItem={([currency, amount]) => (
              <ListRow
                title={currency}
                subtitle={CURRENCIES[currency].name}
                trailing={
                  <Money
                    minorUnits={amount}
                    currency={currency}
                    tone="auto"
                    label={directionLabel(amount)}
                  />
                }
              />
            )}
          />
        </Stack>

        {/* 🔴 The only route to settling up with a friend.
            `SettleUp` lives at `/groups/:gid/settle` and was reachable ONLY from
            GroupDetailScreen and GroupBalancesScreen — both group screens. A friendship's
            implicit group is filtered out of the Groups tab, so there was no path to it at all:
            you could run up a balance with a friend and had no way to clear it.

            Shown only once there is something to settle. A "Settle up" button on a pair who owe
            each other nothing is an invitation to record a payment that did not happen. */}
        {balances.length > 0 && (
          <Button to={paths.SettleUp({ gid: implicitGroupId })}>Settle up</Button>
        )}

        <Stack gap="sm">
          <Text variant="caption" tone="secondary" weight="semibold">
            In shared groups
          </Text>
          {/* 🔴 The caption is load-bearing, not decoration. These amounts come from
              `simplifyDebts`, so in a group of three or more they are a settlement SUGGESTION
              and can pair two people who never shared an expense. On a friend's page that
              number invites a stronger reading than it can carry, so it says what it is. */}
          <List
            data={sharedGroups}
            aria-label="Balances in shared groups"
            keyExtractor={(shared) => shared.id}
            empty={
              <Card>
                <Text variant="caption" tone="secondary">
                  {`You and ${friend.displayName} are not in any groups together yet.`}
                </Text>
              </Card>
            }
            renderItem={(shared) => (
              <SharedGroupRow
                group={shared}
                friendUid={friend.friendUid}
                selfUid={user?.uid ?? ''}
                friendName={friend.displayName}
              />
            )}
          />
          {sharedGroups.length > 0 && (
            <Text variant="caption" tone="secondary">
              Amounts are the simplified way to settle each group, so they may involve people other
              than the two of you.
            </Text>
          )}
        </Stack>

        <Stack gap="sm">
          <Text variant="caption" tone="secondary" weight="semibold">
            Shared expenses
          </Text>
          {group === null ? (
            <Card>
              <Text variant="caption" tone="secondary">
                Loading…
              </Text>
            </Card>
          ) : (
            // The same component `GroupDetailScreen` renders, pointed at the implicit group.
            // Deliberately not a second, friend-shaped expense list: one ledger, one renderer.
            <ExpenseLedger
              groupId={implicitGroupId}
              currency={group.currency}
              selfUid={user?.uid ?? ''}
              members={activeMembers}
            />
          )}
        </Stack>
      </Stack>
    </Screen>
  );
}
