/**
 * `/groups/:gid` — the group home (docs/07 §GroupDetail).
 *
 * Header, member stack, balance strip and a settle-up action. The expense list itself is
 * Phase 06's; until it lands the section explains what will appear there rather than showing a
 * spinner that never resolves.
 *
 * ## `null` is a real answer here
 *
 * Rules gate `get` on membership, so a group the user has left, was removed from, or never
 * joined arrives as a missing document. There is nothing more specific this screen could
 * honestly say, and the state it shows offers a way back rather than a dead end (docs/15 rule 6).
 */

import { useParams } from 'react-router';

import { useGroup, useGroupBalances } from '@splitsutra/core/hooks';
import type { GroupType, MinorUnits } from '@splitsutra/core';

import { AvatarStack } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card, Row, Screen, Stack } from '../components/Layout';
import { EmptyState } from '../components/EmptyState';
import { Money } from '../components/Money';
import { Text } from '../components/Text';
import { ScreenHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';

const TYPE_LABEL: Readonly<Record<GroupType, string>> = {
  trip: 'Trip',
  home: 'Home',
  couple: 'Couple',
  other: 'Group',
  friend: 'Friends',
};

export function GroupDetailScreen() {
  const { gid } = useParams();
  const groupId = gid ?? '';

  const { group, loading, error } = useGroup(groupId);
  const { activeMembers, myBalanceMinor, loading: membersLoading } = useGroupBalances(groupId);

  const header = <ScreenHeader title={group?.name ?? 'Group'} backTo={paths.GroupList()} />;

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
          <Text tone="danger">Could not load this group. {error.message}</Text>
        </Stack>
      </Screen>
    );
  }

  if (group === null) {
    return (
      <Screen header={header}>
        <EmptyState
          glyph="🔍"
          title="Group not found"
          body="This group does not exist, or you are no longer a member of it."
          action={<Button to={paths.GroupList()}>Back to groups</Button>}
        />
      </Screen>
    );
  }

  return (
    <Screen
      label={group.name}
      header={
        <ScreenHeader
          title={group.name}
          backTo={paths.GroupList()}
          trailing={
            <Button variant="ghost" to={paths.GroupSettings({ gid: group.id })}>
              Settings
            </Button>
          }
        />
      }
      footer={
        <Stack padding="md">
          <Button fullWidth to={paths.AddExpense()}>
            Add an expense
          </Button>
        </Stack>
      }
    >
      <Stack gap="lg">
        <Card>
          <Row gap="md" align="center">
            <Stack gap="xs" flex="1">
              <Text variant="caption" tone="secondary">
                {TYPE_LABEL[group.type]} · {group.currency}
              </Text>
              {activeMembers.length > 0 && (
                <AvatarStack
                  people={activeMembers.map((member) => ({
                    uid: member.uid,
                    displayName: member.displayName,
                    photoURL: member.photoURL,
                  }))}
                />
              )}
              <Text variant="caption" tone="secondary">
                {`${String(group.memberCount)} ${group.memberCount === 1 ? 'member' : 'members'}`}
              </Text>
            </Stack>
            <Button variant="secondary" to={paths.GroupMembers({ gid: group.id })}>
              Members
            </Button>
          </Row>
        </Card>

        <Card aria-label="Your balance in this group">
          <Stack gap="sm">
            {membersLoading ? (
              <Text tone="secondary">Loading balances…</Text>
            ) : myBalanceMinor === 0 ? (
              <Text weight="semibold">You are settled up in this group</Text>
            ) : (
              <Money
                minorUnits={myBalanceMinor as MinorUnits}
                currency={group.currency}
                tone="auto"
                size="large"
                label={myBalanceMinor > 0 ? 'You are owed' : 'You owe'}
              />
            )}

            <Row gap="sm">
              <Button variant="secondary" to={paths.GroupBalances({ gid: group.id })}>
                Balances
              </Button>
              <Button to={paths.SettleUp({ gid: group.id })}>Settle up</Button>
            </Row>
          </Stack>
        </Card>

        <Stack gap="sm">
          <Text variant="caption" tone="secondary" weight="semibold">
            Expenses
          </Text>
          <Card>
            <Text variant="caption" tone="secondary">
              Expenses and recorded payments in {group.name} appear here, newest first, once you add
              one.
            </Text>
          </Card>
        </Stack>
      </Stack>
    </Screen>
  );
}
