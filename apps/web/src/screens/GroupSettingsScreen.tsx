/**
 * `/groups/:gid/settings` — rename, type, simplification, and the two ways out.
 *
 * checklists/phase-05 §4, plus the "Balances look wrong?" repair valve from docs/07 §Account.
 *
 * ## Currency is displayed, not edited
 *
 * 🔴 AC-C1.1 / threat T10: `currency` is in the immutable field list on every group update.
 * Changing it after an expense exists would reinterpret every stored `amountMinor` in the
 * group, so it is shown here with the reason rather than left out — a setting that is missing
 * reads as an oversight, and someone will eventually try to "add" it.
 *
 * ## Leaving and deleting are callables, and they can refuse
 *
 * `leaveGroup` refuses while the caller's balance is not zero and `deleteGroup` refuses while
 * anybody's is (AC-C1.5, AC-C1.6). Those preconditions read other members' documents, which
 * Rules cannot do. The Functions put the outstanding amount in the message, so it is shown
 * verbatim.
 */

import { useState } from 'react';
import { useParams } from 'react-router';

import { useAuth, useGroup, useGroupMembers } from '@splitsutra/core/hooks';
import {
  deleteGroup,
  leaveGroup,
  recomputeGroupBalances,
  updateGroup,
  type CreatableGroupType,
} from '@splitsutra/core/repositories';
import { CURRENCIES, SELECTABLE_GROUP_TYPES, type GroupType } from '@splitsutra/core';

import { Button } from '../components/Button';
import { Card, Row, Screen, Stack } from '../components/Layout';
import { EmptyState } from '../components/EmptyState';
import { Input } from '../components/Input';
import { SegmentedControl } from '../components/SegmentedControl';
import { Text } from '../components/Text';
import { ScreenHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';
import { groupLabel } from './group/groupLabel';

const NAME_MAX = 60;

const TYPES = [
  { value: 'trip', label: 'Trip' },
  { value: 'home', label: 'Home' },
  { value: 'friends', label: 'Friends' },
  { value: 'other', label: 'Other' },
] as const satisfies readonly { value: CreatableGroupType; label: string }[];

const SIMPLIFY = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
] as const;

/**
 * Which segment to highlight for a group whose stored type the picker does not offer — the
 * implicit `friend` container, or the retired `couple`.
 *
 * Falls back to `Other` rather than leaving the control unselected, because an unselected
 * segmented control reads as "nobody has set this yet" when the truth is "set to something we no
 * longer offer". Nothing is written until the user actually picks, so the stored value survives
 * until they choose to change it — the detail screen still names it correctly meanwhile.
 */
function offerable(type: GroupType): CreatableGroupType {
  const offered: readonly GroupType[] = SELECTABLE_GROUP_TYPES;
  return offered.includes(type) ? (type as CreatableGroupType) : 'other';
}

function nameError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'A group needs a name.';
  if (trimmed.length > NAME_MAX) return `Keep it to ${NAME_MAX} characters or fewer.`;
  return undefined;
}

function describe(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : '';
  return message.length > 0 ? message : fallback;
}

export function GroupSettingsScreen() {
  const { gid } = useParams();
  const groupId = gid ?? '';

  const { group, loading, error } = useGroup(groupId);
  const { isAdmin, me } = useGroupMembers(groupId);
  const { user } = useAuth();

  /** `null` means "not edited yet", which is distinguishable from a name typed empty. */
  const [draftName, setDraftName] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const name = draftName ?? group?.name ?? '';
  const invalid = nameError(name);
  const renamed = group !== null && name.trim() !== group.name && invalid === undefined;

  async function run(key: string, action: () => Promise<string>, fallback: string): Promise<void> {
    setBusy(key);
    setFailure(null);
    setMessage(null);
    try {
      setMessage(await action());
    } catch (cause: unknown) {
      setFailure(describe(cause, fallback));
    } finally {
      setBusy(null);
    }
  }

  const header = (
    <ScreenHeader title="Group settings" backTo={paths.GroupDetail({ gid: groupId })} />
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

  const currency = CURRENCIES[group.currency];

  // The Name field below deliberately shows the STORED name, not this label: it is the field
  // that edits that value, and a friendship renamed to something without an ampersand is then
  // shown verbatim to both members (see `groupLabel`).
  return (
    <Screen
      header={header}
      label={`${groupLabel(group, { selfName: user?.displayName ?? '' })} settings`}
    >
      <Stack gap="lg">
        <Stack gap="sm">
          <Input
            label="Group name"
            value={name}
            onValueChange={(next) => {
              setDraftName(next);
              setMessage(null);
            }}
            maxLength={NAME_MAX + 10}
            error={draftName === null ? undefined : invalid}
          />
          <Button
            disabled={!renamed || busy !== null}
            loading={busy === 'rename'}
            onPress={() => {
              void run(
                'rename',
                async () => {
                  await updateGroup(groupId, { name: name.trim() });
                  setDraftName(null);
                  return 'Name saved.';
                },
                'Could not rename the group.',
              );
            }}
          >
            Save name
          </Button>
        </Stack>

        <Stack gap="sm">
          <Text weight="semibold">Type</Text>
          <SegmentedControl
            label="Group type"
            options={TYPES}
            value={offerable(group.type)}
            onValueChange={(next) => {
              void run(
                'type',
                async () => {
                  await updateGroup(groupId, { type: next });
                  return 'Type saved.';
                },
                'Could not change the type.',
              );
            }}
          />
        </Stack>

        <Stack gap="sm">
          <Text weight="semibold">Simplify debts</Text>
          <Text variant="caption" tone="secondary">
            Suggests the fewest payments that settle the group. Amounts owed do not change — only
            who pays whom (AC-E3.4).
          </Text>
          <SegmentedControl
            label="Simplify debts"
            options={SIMPLIFY}
            value={group.simplifyDebts ? 'on' : 'off'}
            onValueChange={(next) => {
              void run(
                'simplify',
                async () => {
                  await updateGroup(groupId, { simplifyDebts: next === 'on' });
                  return next === 'on' ? 'Simplification on.' : 'Simplification off.';
                },
                'Could not change that setting.',
              );
            }}
          />
        </Stack>

        <Card>
          <Stack gap="xs">
            <Row justify="between" align="baseline">
              <Text weight="semibold">Currency</Text>
              <Text variant="caption" tone="secondary">
                {group.currency} · {currency.symbol}
              </Text>
            </Row>
            <Text variant="caption" tone="secondary">
              {currency.name} was fixed when this group was created and cannot be changed — every
              amount already recorded here means what it says in {group.currency}.
            </Text>
          </Stack>
        </Card>

        <Card>
          <Stack gap="sm">
            <Text weight="semibold">Balances look wrong?</Text>
            <Text variant="caption" tone="secondary">
              Rebuilds every balance in this group from the expenses and payments themselves. It is
              always safe to run.
            </Text>
            <Button
              variant="secondary"
              disabled={busy !== null}
              loading={busy === 'recompute'}
              onPress={() => {
                void run(
                  'recompute',
                  async () => {
                    const result = await recomputeGroupBalances({ groupId });
                    return result.repaired
                      ? `Fixed ${String(result.driftCount)} ${
                          result.driftCount === 1 ? 'balance' : 'balances'
                        }.`
                      : 'Everything already matched.';
                  },
                  'Could not rebuild the balances.',
                );
              }}
            >
              Rebuild balances
            </Button>
          </Stack>
        </Card>

        <Stack gap="sm" aria-live="polite">
          {failure !== null && <Text tone="danger">{failure}</Text>}
          {message !== null && (
            <Text variant="caption" tone="secondary">
              {message}
            </Text>
          )}
        </Stack>

        {me !== null && me.leftAt === null && (
          <Card>
            <Stack gap="sm">
              <Text weight="semibold">Leave this group</Text>
              <Text variant="caption" tone="secondary">
                Only possible once your balance here is zero. Your expenses stay in the group.
              </Text>
              <Button
                variant="danger"
                disabled={busy !== null}
                loading={busy === 'leave'}
                onPress={() => {
                  void run(
                    'leave',
                    async () => {
                      await leaveGroup({ groupId });
                      return 'You have left this group.';
                    },
                    'Could not leave. Settle your balance first.',
                  );
                }}
              >
                Leave group
              </Button>
            </Stack>
          </Card>
        )}

        {isAdmin && (
          <Card>
            <Stack gap="sm">
              <Text weight="semibold">Delete this group</Text>
              <Text variant="caption" tone="secondary">
                Only possible when everyone is settled up. The group and its history are kept for
                the record, not erased.
              </Text>
              <Button
                variant="danger"
                disabled={busy !== null}
                loading={busy === 'delete'}
                onPress={() => {
                  void run(
                    'delete',
                    async () => {
                      await deleteGroup({ groupId });
                      return 'Group deleted.';
                    },
                    'Could not delete. Somebody still owes or is owed.',
                  );
                }}
              >
                Delete group
              </Button>
            </Stack>
          </Card>
        )}
      </Stack>
    </Screen>
  );
}
