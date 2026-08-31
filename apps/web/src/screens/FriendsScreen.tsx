/**
 * `/friends` — everyone you are connected to, and everyone you asked.
 *
 * checklists/phase-05 §7.
 *
 * ## Three sections, three different kinds of fact
 *
 * **Active** is a friendship: a `users/{uid}/friends/{friendUid}` document exists, so there is a
 * balance to show and a detail screen to open. **Requested** and **Withdrawn** are not
 * friendships at all — they are `friendRequests` documents in two different states, with no
 * friend document behind them. That is why neither is tappable: `FriendDetail` reads the
 * friendship, and there is none to read.
 *
 * ## 🔴 There is no "Declined" section, and its absence is the feature
 *
 * A request that was turned down is terminal — `sendFriendRequest` refuses to overwrite one —
 * and the product does not tell the sender it happened. That is enforced one layer down, in
 * `watchWithdrawnFriendRequests`, which excludes the status at the *query*: a declined request
 * never reaches this device, so no change to this file could put it on screen by accident.
 *
 * Withdrawn is the opposite case and safe to show: the user withdrew it themselves, so it is
 * their own action being reported back to them, not somebody else's answer.
 *
 * ## Asking again takes the same key it took the first time
 *
 * A Withdrawn row has no "Ask again" button. `sendFriendRequest` resolves people through
 * `usernames/{sha256(contact)}` and takes an email or a phone number — never a uid — and the
 * request document deliberately does not keep the contact key that found them. Re-sending from
 * this row would mean either storing that key (a durable copy of someone's email in a document
 * the other party can read) or opening a uid-shaped path into sending requests. Both are worse
 * than retyping an address, so the row points at Add Friend instead.
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
 * No Firestore here. Three hooks and one callable, all from `@splitsutra/core`.
 */

import { useState } from 'react';

import { respondToFriendRequest } from '@splitsutra/core/repositories';
import { useFriendRequests, useFriends, useWithdrawnFriendRequests } from '@splitsutra/core/hooks';
import {
  formatRelativeTime,
  type BalanceByCurrency,
  type CurrencyCode,
  type FriendRequest,
  type MinorUnits,
} from '@splitsutra/core';

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

/** The label above a section. Same treatment as the request count, so the three read as peers. */
function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="caption" tone="secondary" weight="semibold">
      {children}
    </Text>
  );
}

/**
 * One outgoing request, in either of the two states this screen shows.
 *
 * Not tappable, and not for want of a destination: there is no friendship behind a request, so
 * there is nothing for `FriendDetail` to open.
 */
function RequestRow({
  request,
  caption,
  muted,
}: {
  request: FriendRequest;
  caption: string;
  muted?: boolean | undefined;
}) {
  return (
    <ListRow
      title={request.toName}
      subtitle={caption}
      leading={<Avatar name={request.toName} photoURL={request.toPhotoURL} />}
      muted={muted}
      label={`${request.toName} — ${caption}`}
    />
  );
}

export function FriendsScreen() {
  const { friends, loading: friendsLoading } = useFriends();
  const { incoming, outgoing } = useFriendRequests();
  const { withdrawn } = useWithdrawnFriendRequests();

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

  /**
   * Nothing to show anywhere — the only state that earns the big empty state.
   *
   * Checked across all four lists, not just `friends`: "No friends yet" printed above a request
   * you sent an hour ago is both wrong and slightly rude.
   */
  const nothingYet =
    friends.length === 0 &&
    incoming.length === 0 &&
    outgoing.length === 0 &&
    withdrawn.length === 0;

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
            <SectionLabel>
              {incoming.length === 1 ? '1 friend request' : `${incoming.length} friend requests`}
            </SectionLabel>

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

        {!friendsLoading && nothingYet && (
          <EmptyState
            glyph="👋"
            title="No friends yet"
            body="Add someone by email or phone. They will get a request to accept before you share any expenses."
            action={<Button to={paths.AddFriend()}>Add a friend</Button>}
          />
        )}

        {!friendsLoading && friends.length > 0 && (
          <Stack gap="sm">
            <SectionLabel>{`Active · ${friends.length}`}</SectionLabel>

            <List
              data={friends}
              aria-label="Active friends"
              keyExtractor={(friend) => friend.friendUid}
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
          </Stack>
        )}

        {outgoing.length > 0 && (
          <Stack gap="sm">
            <SectionLabel>{`Requested · ${outgoing.length}`}</SectionLabel>

            <List
              data={outgoing}
              aria-label="Requests you sent"
              keyExtractor={(request) => request.id}
              renderItem={(request) => (
                <RequestRow
                  request={request}
                  caption={`Asked ${formatRelativeTime(request.createdAt.toMillis())}`}
                />
              )}
            />
          </Stack>
        )}

        {withdrawn.length > 0 && (
          <Stack gap="sm">
            <SectionLabel>{`Withdrawn · ${withdrawn.length}`}</SectionLabel>

            <List
              data={withdrawn}
              aria-label="Requests you withdrew"
              keyExtractor={(request) => request.id}
              renderItem={(request) => (
                <RequestRow
                  request={request}
                  muted
                  caption={`Withdrawn ${formatRelativeTime(
                    (request.respondedAt ?? request.updatedAt).toMillis(),
                  )}`}
                />
              )}
            />

            <Text variant="caption" tone="secondary">
              To ask again, add them by email or phone — the same way you found them the first time.
            </Text>
          </Stack>
        )}
      </Stack>
    </Screen>
  );
}
