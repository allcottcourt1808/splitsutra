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

import { useGroups, useMyGroupBalances } from '@splitsutra/core/hooks';
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

/** One glyph per group type (phase-05 §4, 🟢 "Group photo/emoji per type"). */
const TYPE_GLYPH: Readonly<Record<GroupType, string>> = {
  trip: '🧳',
  home: '🏠',
  couple: '💞',
  other: '📁',
  // Never rendered here: implicit friend groups are filtered out of the list (D2).
  friend: '👤',
};

/** A currency, and the total owed to / owed by the user across the groups using it. */
interface CurrencyLine {
  readonly currency: CurrencyCode;
  readonly owedMinor: number;
  readonly oweMinor: number;
}

/**
 * The overall summary, grouped by currency.
 *
 * Amounts are added only *within* a currency. Owed and owing are kept apart rather than netted:
 * "you are owed ₹3,000 and you owe ₹500" is two true statements, while "₹2,500" hides the fact
 * that somebody is waiting to be paid.
 */
function summarise(
  groups: readonly Group[],
  balanceByGroup: ReadonlyMap<string, MinorUnits>,
): readonly CurrencyLine[] {
  const lines = new Map<CurrencyCode, { owedMinor: number; oweMinor: number }>();

  for (const group of groups) {
    const balance = balanceByGroup.get(group.id);
    if (balance === undefined || balance === 0) continue;

    const line = lines.get(group.currency) ?? { owedMinor: 0, oweMinor: 0 };
    if (balance > 0) line.owedMinor += balance;
    else line.oweMinor += -balance;
    lines.set(group.currency, line);
  }

  return [...lines]
    .map(([currency, line]) => ({ currency, ...line }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export function GroupsScreen() {
  const { groups, loading, error } = useGroups();

  const groupIds = useMemo(() => groups.map((group) => group.id), [groups]);
  const { balanceByGroup } = useMyGroupBalances(groupIds);

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
                      {line.owedMinor > 0 && (
                        <Money
                          minorUnits={line.owedMinor as MinorUnits}
                          currency={line.currency}
                          tone="positive"
                          label="You are owed"
                          size="large"
                        />
                      )}
                      {line.oweMinor > 0 && (
                        <Money
                          minorUnits={-line.oweMinor as MinorUnits}
                          currency={line.currency}
                          tone="negative"
                          label="You owe"
                          size="large"
                        />
                      )}
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
            return (
              <ListRow
                title={group.name}
                subtitle={`${TYPE_GLYPH[group.type]} ${String(group.memberCount)} ${
                  group.memberCount === 1 ? 'member' : 'members'
                }`}
                leading={<Avatar name={group.name} photoURL={group.photoURL} />}
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
