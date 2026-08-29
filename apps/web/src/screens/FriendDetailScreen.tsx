import { useParams } from 'react-router';

import { useFriend } from '@splitsutra/core/hooks';
import {
  CURRENCIES,
  type BalanceByCurrency,
  type CurrencyCode,
  type MinorUnits,
} from '@splitsutra/core';

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

type BalanceEntry = readonly [CurrencyCode, MinorUnits];

// D6 — one row per currency. Never summed, and never rendered as a total.
function balanceEntries(balanceMinor: BalanceByCurrency): readonly BalanceEntry[] {
  return Object.entries(balanceMinor) as BalanceEntry[];
}

function directionLabel(amount: MinorUnits): string | undefined {
  if (amount > 0) return 'owes you';
  if (amount < 0) return 'you owe';
  return undefined;
}

export function FriendDetailScreen() {
  const { uid } = useParams();
  const { friend, loading, error } = useFriend(uid ?? '');

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

  const balances = balanceEntries(friend.balanceMinor);

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
                {balances.length === 0
                  ? 'Settled up'
                  : balances.length === 1
                    ? 'Outstanding in 1 currency'
                    : `Outstanding in ${String(balances.length)} currencies`}
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
          <Card>
            <Text variant="caption" tone="secondary">
              {`Expenses you share with ${friend.displayName} will appear here once you add one.`}
            </Text>
          </Card>
        </Stack>
      </Stack>
    </Screen>
  );
}
