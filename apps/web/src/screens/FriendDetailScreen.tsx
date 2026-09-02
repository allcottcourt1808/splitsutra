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
 * ## 🔴 Why the balance does NOT come from `friend.balanceMinor`
 *
 * `users/{uid}/friends/{fid}` carries a `balanceMinor` map, and it is **not maintained**.
 * `establishFriendship` seeds it and nothing in the codebase ever writes it again —
 * `recomputeBalances` writes `groups/{gid}/members/{uid}.balanceMinor` and touches no friend
 * document. Reading it meant this screen said "Settled up" no matter what anyone spent.
 *
 * That field is not being fixed by giving it a writer. A second trigger fanning group balances
 * into friend documents would be a second cache of the same money, free to drift from the
 * ledger — exactly what Article VI forbids and the reason `auditBalances` deliberately excludes
 * it. The balance below comes from the implicit group's member document, which IS the one cache
 * the server maintains (Article III), so there is nothing new to keep in step.
 *
 * ⚠️ `friend.balanceMinor` is therefore now read by nothing. Removing it is a schema change and
 * a migration, so it stays for the moment — but do not reach for it.
 *
 * ## Sparse, not zero
 *
 * Article I: a settled balance is an **absent** entry, not `0`. An implicit group has exactly
 * one currency, so there is at most one row here — built only when the balance is non-zero, so
 * "settled up" stays the empty case rather than a row displaying nothing.
 */

import { useParams } from 'react-router';

import { useAuth, useFriend, useGroup, useGroupMembers } from '@splitsutra/core/hooks';
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
