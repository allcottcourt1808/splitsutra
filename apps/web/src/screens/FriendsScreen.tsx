/**
 * `/friends` — the friends list, with pending requests at the top.
 *
 * checklists/phase-05 §7.
 *
 * ## The requests section IS the in-app notification
 *
 * docs/03 defers a `notifications` collection ("deferred with push"), and this feature does not
 * need one. `useFriendRequests().incoming` is a live subscription over the pending requests
 * addressed to the signed-in user, so one sent while the app is open appears here without a
 * refresh, and it disappears the moment it is answered — including when it is answered on
 * another device, which a separate notification document would have had to be told about.
 *
 * The same count badges the Friends tab (`navigation/TabBar.tsx`), which is what makes it
 * discoverable from anywhere in the app rather than only once you happen to open this screen.
 *
 * ## Article VIII
 *
 * No Firestore here. Two hooks and one callable, all from `@splitsutra/core`.
 */

import { useState } from 'react';

import { respondToFriendRequest } from '@splitsutra/core/repositories';
import { useFriendRequests, useFriends } from '@splitsutra/core/hooks';
import type { BalanceByCurrency, CurrencyCode, MinorUnits } from '@splitsutra/core';

import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card, Screen, Row, Stack } from '../components/Layout';
import { EmptyState } from '../components/EmptyState';
import { List } from '../components/List';
import { ListRow } from '../components/ListRow';
import { Money } from '../components/Money';
import { Text } from '../components/Text';
import { ScreenHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';

/**
 * The single currency this friend has a balance in, or `null`.
 *
 * 🔴 Returns `null` for a friend with balances in more than one currency rather than picking one
 * or adding them up. `balanceMinor` is a **sparse** map and D6 forbids summing across it — USD
 * plus EUR is a number that means nothing. The row shows a count instead, and the friend detail
 * screen is where the breakdown belongs.
 *
 * A settled friend has an empty map, not `{ USD: 0 }`, so "no entries" reads as "nothing
 * outstanding" and needs no special case.
 */
function soleBalance(
  balanceMinor: BalanceByCurrency,
): { currency: CurrencyCode; amount: MinorUnits } | null {
  const entries = Object.entries(balanceMinor) as [CurrencyCode, MinorUnits][];
  if (entries.length !== 1) return null;
  const [currency, amount] = entries[0]!;
  return { currency, amount };
}

/** How many currencies this friend has an outstanding balance in. */
function currencyCount(balanceMinor: BalanceByCurrency): number {
  return Object.keys(balanceMinor).length;
}

export function FriendsScreen() {
  const { friends, loading: friendsLoading } = useFriends();
  const { incoming } = useFriendRequests();

  /** Request ids currently in flight, so both buttons on that row disable together. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function respond(requestId: string, accept: boolean): Promise<void> {
    setBusy((current) => new Set(current).add(requestId));
    setError(null);
    try {
      await respondToFriendRequest({ requestId, accept });
      // No local removal: the request leaves `incoming` on its own, because the subscription
      // sees the status change. Removing it here too would fight the snapshot and flicker.
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not answer that request.');
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(requestId);
        return next;
      });
    }
  }

  return (
    <Screen
      header={
        <ScreenHeader
          title="Friends"
          trailing={
            <Button variant="ghost" to={paths.AddFriend()}>
              Add
            </Button>
          }
        />
      }
    >
      <Stack gap="lg">
        {incoming.length > 0 && (
          <Stack gap="sm">
            <Text variant="caption" tone="secondary" weight="semibold">
              {incoming.length === 1 ? '1 friend request' : `${incoming.length} friend requests`}
            </Text>

            <List
              data={incoming}
              aria-label="Friend requests"
              gap="sm"
              keyExtractor={(request) => request.id}
              renderItem={(request) => (
                <Card>
                  <Stack gap="sm">
                    <Row gap="sm" align="center">
                      <Avatar name={request.fromName} photoURL={request.fromPhotoURL} />
                      <Stack>
                        <Text weight="semibold">{request.fromName}</Text>
                        <Text variant="caption" tone="secondary">
                          wants to be friends
                        </Text>
                      </Stack>
                    </Row>
                    <Row gap="sm">
                      <Button
                        fullWidth
                        disabled={busy.has(request.id)}
                        onPress={() => {
                          void respond(request.id, true);
                        }}
                        label={`Accept the friend request from ${request.fromName}`}
                      >
                        Accept
                      </Button>
                      <Button
                        variant="secondary"
                        fullWidth
                        disabled={busy.has(request.id)}
                        onPress={() => {
                          void respond(request.id, false);
                        }}
                        label={`Decline the friend request from ${request.fromName}`}
                      >
                        Decline
                      </Button>
                    </Row>
                  </Stack>
                </Card>
              )}
            />

            {error !== null && <Text tone="danger">{error}</Text>}
          </Stack>
        )}

        {!friendsLoading && (
          <List
            data={friends}
            aria-label="Friends"
            keyExtractor={(friend) => friend.friendUid}
            empty={
              // Suppressed while a request is waiting: "you have no friends yet" under an
              // invitation to accept one is both wrong and slightly rude.
              incoming.length > 0 ? null : (
                <EmptyState
                  glyph="👋"
                  title="No friends yet"
                  body="Add someone by email or phone. They will get a request to accept before you share any expenses."
                  action={<Button to={paths.AddFriend()}>Add a friend</Button>}
                />
              )
            }
            renderItem={(friend) => {
              const sole = soleBalance(friend.balanceMinor);
              const count = currencyCount(friend.balanceMinor);
              return (
                <ListRow
                  title={friend.displayName}
                  leading={<Avatar name={friend.displayName} photoURL={friend.photoURL} />}
                  to={paths.FriendDetail({ uid: friend.friendUid })}
                  trailing={
                    sole !== null ? (
                      <Money minorUnits={sole.amount} currency={sole.currency} tone="auto" />
                    ) : count > 1 ? (
                      <Text variant="caption" tone="secondary">
                        {`${count} currencies`}
                      </Text>
                    ) : (
                      <Text variant="caption" tone="secondary">
                        Settled up
                      </Text>
                    )
                  }
                />
              );
            }}
          />
        )}
      </Stack>
    </Screen>
  );
}
