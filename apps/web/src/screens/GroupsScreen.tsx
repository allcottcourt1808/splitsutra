/**
 * `/groups` — the Groups tab, and the app's home (docs/07 §GroupList).
 *
 * checklists/phase-05 §4, checklists/phase-07 §2.
 *
 * ## The summary card never adds two currencies together
 *
 * D6 / AC-B2.3: `balanceByCurrency` is sparse and a group fixes one currency at creation, so
 * "overall" is one line per currency and nothing else. A single figure would have to invent an
 * exchange rate, and v1 has none — the forward design in docs/03 exists precisely so that
 * number never has to be taken away again.
 *
 * ## Article VIII
 *
 * No Firestore here. Two hooks from `@splitsutra/core/hooks`, and the balances they surface are
 * read from the member documents the server wrote — never recomputed (Article III).
 */

import { useMemo } from 'react';

import { useAuth, useGroups, useMyGroupBalances } from '@splitsutra/core/hooks';
import type { CurrencyCode, Group, GroupType, MinorUnits } from '@splitsutra/core';

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
import { groupLabel, isFriendship } from './group/groupLabel';
import { useFriendshipNames } from './group/useFriendshipNames';

/**
 * One glyph per group type (phase-05 §4, 🟢 "Group photo/emoji per type").
 *
 * Keyed by `GroupType`, not by the pick list, so a group created under the retired `couple` type
 * still gets a glyph rather than an empty cell.
 */
const TYPE_GLYPH: Readonly<Record<GroupType, string>> = {
  trip: '🧳',
  home: '🏠',
  friends: '👥',
  other: '📁',
  // A friendship, and it IS rendered here — it used to be filtered out (D2), until ADR-13 made
  // it an ordinary group the moment it holds an expense. A person, not a folder. Note this is
  // `friend`, the 1:1 container — not `friends` above, which is a group someone chose.
  friend: '👤',
  couple: '💞',
};

/** A currency, and the user's net position across every group using it. */
interface CurrencyLine {
  readonly currency: CurrencyCode;
  readonly netMinor: number;
}

/**
 * The overall summary: one net figure per currency.
 *
 * 🔴 **Netted across directions, and NEVER across currencies.** The second half is Article I and
 * D6 and is not a preference — adding `USD` to `INR` produces a number that means nothing. One
 * line per currency, always.
 *
 * The first half was the other way round until now, showing "You are owed $65" and "You owe
 * $194.17" as separate lines. The reasoning was that netting hides the fact that somebody is
 * waiting to be paid — which is true, and was the right call while this card was the only
 * summary on the screen.
 *
 * It is not the only summary any more. Every group is listed directly beneath it with its own
 * signed amount and its own counterparty, so "who is waiting to be paid" is answered in more
 * detail one line further down than this card could ever manage. Repeating a coarser version of
 * it above meant the top of the screen was two numbers that had to be combined mentally before
 * they said anything.
 *
 * ⚠️ What is genuinely lost: at a glance you can no longer tell a settled-in-both-directions
 * user (`+500` and `−500`) from a truly settled one — both now read as absent. The group rows
 * below distinguish them, which is the whole basis for this change; if that ever stops being
 * true, this decision has to be revisited with it.
 */
function summarise(
  groups: readonly Group[],
  balanceByGroup: ReadonlyMap<string, MinorUnits>,
): readonly CurrencyLine[] {
  const lines = new Map<CurrencyCode, number>();

  for (const group of groups) {
    const balance = balanceByGroup.get(group.id);
    if (balance === undefined || balance === 0) continue;

    lines.set(group.currency, (lines.get(group.currency) ?? 0) + balance);
  }

  return (
    [...lines]
      .map(([currency, netMinor]) => ({ currency, netMinor }))
      // A currency whose groups cancel out exactly is dropped rather than shown as zero —
      // Article I: settled is an ABSENT entry, not a `0` row.
      .filter((line) => line.netMinor !== 0)
      .sort((a, b) => a.currency.localeCompare(b.currency))
  );
}

export function GroupsScreen() {
  const { groups, loading, error } = useGroups();
  const { profile } = useAuth();

  const groupIds = useMemo(() => groups.map((group) => group.id), [groups]);
  const { balanceByGroup } = useMyGroupBalances(groupIds);

  // A promoted friendship (ADR-13) is a card on this screen, and its stored name is
  // `"<you> & <them>"` — half of which is the reader's own name. See `groupLabel`.
  const friendNames = useFriendshipNames();
  const selfName = profile?.displayName ?? '';

  const lines = useMemo(() => summarise(groups, balanceByGroup), [groups, balanceByGroup]);

  const header = (
    <ScreenHeader
      title="Groups"
      trailing={
        <Button variant="ghost" to={paths.CreateGroup()}>
          New
        </Button>
      }
    />
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
          <Text tone="danger">Could not load your groups. {error.message}</Text>
        </Stack>
      </Screen>
    );
  }

  return (
    <Screen header={header}>
      <Stack gap="lg">
        {groups.length > 0 && (
          <Card aria-label="Overall balance">
            <Stack gap="xs">
              <Text variant="caption" tone="secondary" weight="semibold">
                Overall
              </Text>

              {lines.length === 0 ? (
                <Text weight="semibold">You are all settled up</Text>
              ) : (
                <Stack gap="xs" as="ul" aria-label="Overall balance by currency">
                  {lines.map((line) => (
                    <Stack as="li" key={line.currency} gap="xs">
                      <Money
                        minorUnits={line.netMinor as MinorUnits}
                        currency={line.currency}
                        tone="auto"
                        label={line.netMinor > 0 ? 'You are owed' : 'You owe'}
                        size="large"
                      />
                    </Stack>
                  ))}
                </Stack>
              )}
            </Stack>
          </Card>
        )}

        <List
          data={groups}
          aria-label="Groups"
          keyExtractor={(group) => group.id}
          empty={
            <EmptyState
              glyph="🧳"
              title="No groups yet"
              body="A group is where a trip, a flat, or a night out lives. Create one, or add a friend and split one-to-one."
              action={
                <Row gap="sm">
                  <Button to={paths.CreateGroup()}>Create a group</Button>
                  <Button variant="secondary" to={paths.AddFriend()}>
                    Add a friend
                  </Button>
                </Row>
              }
            />
          }
          renderItem={(group) => {
            const balance = balanceByGroup.get(group.id);
            const label = groupLabel(group, {
              friendName: friendNames.get(group.id),
              selfName,
            });
            return (
              <ListRow
                title={label}
                // A friendship says "Friend", not "2 members" — the count is both of you, and
                // it is the one line where the row could still read as a folder.
                subtitle={
                  isFriendship(group)
                    ? `${TYPE_GLYPH[group.type]} Friend`
                    : `${TYPE_GLYPH[group.type]} ${String(group.memberCount)} ${
                        group.memberCount === 1 ? 'member' : 'members'
                      }`
                }
                leading={<Avatar name={label} photoURL={group.photoURL} />}
                to={paths.GroupDetail({ gid: group.id })}
                trailing={
                  balance === undefined ? undefined : balance === 0 ? (
                    <Text variant="caption" tone="secondary">
                      Settled up
                    </Text>
                  ) : (
                    <Money
                      minorUnits={balance}
                      currency={group.currency}
                      tone="auto"
                      label={balance > 0 ? 'you are owed' : 'you owe'}
                    />
                  )
                }
              />
            );
          }}
        />
      </Stack>
    </Screen>
  );
}
