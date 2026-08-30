/**
 * `/groups/:gid/balances` — every member's net, and the simplified way to clear it.
 *
 * checklists/phase-07 §3, docs/07 §GroupBalances.
 *
 * ## Where each number comes from
 *
 * The **Balances** tab renders `balanceMinor` exactly as the server wrote it (Article III). The
 * **Suggested payments** tab runs `simplifyDebts()` from `core/src/domain` over those same
 * numbers — one implementation of the money math, shared with the Cloud Functions (Article VI),
 * and a pure function that writes nothing (Article VII). Simplification never touches the
 * ledger: it is a different set of payments that reaches the same place (AC-E3.3).
 *
 * ## The explanation is not decoration
 *
 * ⚠️ AC-E3.4. "Why am I paying Carol when I borrowed from Bob?" is the single most common
 * confusion this feature creates, and the sentence above the list is the answer. Removing it
 * turns a good feature into a support queue.
 */

import { useMemo, useState } from 'react';
import { useParams } from 'react-router';

import { useGroup, useGroupBalances } from '@splitsutra/core/hooks';
import { updateGroup } from '@splitsutra/core/repositories';
import { simplifyDebts, type MinorUnits } from '@splitsutra/core';

import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card, Row, Screen, Stack } from '../components/Layout';
import { List } from '../components/List';
import { ListRow } from '../components/ListRow';
import { Money } from '../components/Money';
import { SegmentedControl } from '../components/SegmentedControl';
import { Text } from '../components/Text';
import { ScreenHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';

type Tab = 'balances' | 'suggested';

const TABS = [
  { value: 'balances', label: 'Balances' },
  { value: 'suggested', label: 'Suggested payments' },
] as const satisfies readonly { value: Tab; label: string }[];

/**
 * The settle-up route with the payment prefilled.
 *
 * The path comes from `paths.SettleUp` — never assembled by hand — and the prefill rides in the
 * query string, which `RouteParamMap` documents but does not model. Phase 12 passes the same
 * three values as navigation params.
 */
function settleUpTo(gid: string, fromUid: string, toUid: string, amountMinor: number): string {
  const query = new URLSearchParams({
    from: fromUid,
    to: toUid,
    amountMinor: String(amountMinor),
  });
  return `${paths.SettleUp({ gid })}?${query.toString()}`;
}

export function GroupBalancesScreen() {
  const { gid } = useParams();
  const groupId = gid ?? '';

  const { group, loading: groupLoading } = useGroup(groupId);
  const { members, balances, settled, loading, error } = useGroupBalances(groupId);

  /**
   * `null` until the user picks a tab, so the group's own `simplifyDebts` setting decides which
   * view opens first (docs/04 §4: simplification is display-only *unless* the group turns it on).
   */
  const [chosenTab, setChosenTab] = useState<Tab | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const tab: Tab = chosenTab ?? (group?.simplifyDebts === true ? 'suggested' : 'balances');

  const nameOf = useMemo(() => {
    const names = new Map(members.map((member) => [member.uid, member.displayName]));
    return (uid: string): string => names.get(uid) ?? 'Someone who left';
  }, [members]);

  // Pure and deterministic (ties break on ascending uid), so the list does not reshuffle
  // between renders while somebody is reading it.
  const transfers = useMemo(() => simplifyDebts(balances), [balances]);

  const owing = balances.filter((balance) => balance.balanceMinor < 0).length;

  const header = <ScreenHeader title="Balances" backTo={paths.GroupDetail({ gid: groupId })} />;

  // Currency lives on the group document, which is a separate subscription from the members.
  // Rendering before it lands gives amountless rows, indistinguishable from settled.
  if (loading || groupLoading) {
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
          <Text tone="danger">Could not load the balances. {error.message}</Text>
        </Stack>
      </Screen>
    );
  }

  const currency = group?.currency ?? null;

  return (
    <Screen header={header}>
      <Stack gap="lg">
        <SegmentedControl
          label="Balance view"
          options={TABS}
          value={tab}
          onValueChange={setChosenTab}
        />

        {settled ? (
          <Card>
            <Stack gap="xs">
              <Text weight="semibold">All settled up</Text>
              <Text variant="caption" tone="secondary">
                Nobody in this group owes anybody anything.
              </Text>
            </Stack>
          </Card>
        ) : tab === 'balances' ? (
          <List
            data={balances}
            aria-label="Member balances"
            keyExtractor={(balance) => balance.uid}
            renderItem={(balance) => (
              <ListRow
                title={nameOf(balance.uid)}
                leading={<Avatar name={nameOf(balance.uid)} />}
                chevron={false}
                trailing={
                  currency === null ? undefined : balance.balanceMinor === 0 ? (
                    <Text variant="caption" tone="secondary">
                      Settled up
                    </Text>
                  ) : (
                    <Money
                      minorUnits={balance.balanceMinor as MinorUnits}
                      currency={currency}
                      tone="auto"
                      label={balance.balanceMinor > 0 ? 'is owed' : 'owes'}
                    />
                  )
                }
              />
            )}
          />
        ) : (
          <Stack gap="sm">
            <Card>
              <Stack gap="xs">
                <Text weight="semibold">
                  {`Instead of ${String(owing)} ${owing === 1 ? 'payment' : 'payments'}, settle up in ${String(transfers.length)}.`}
                </Text>
                <Text variant="caption" tone="secondary">
                  Amounts owed do not change — only who pays whom. You might be asked to pay someone
                  you never borrowed from directly; that clears the same debt in fewer steps.
                </Text>
              </Stack>
            </Card>

            <List
              data={transfers}
              aria-label="Suggested payments"
              gap="sm"
              keyExtractor={(transfer) => `${transfer.fromUid}-${transfer.toUid}`}
              renderItem={(transfer) => (
                <Card>
                  <Stack gap="sm">
                    <Row gap="sm" align="center">
                      <Avatar name={nameOf(transfer.fromUid)} />
                      <Stack gap="xs" flex="1">
                        <Text weight="semibold" truncate>
                          {`${nameOf(transfer.fromUid)} pays ${nameOf(transfer.toUid)}`}
                        </Text>
                        {currency !== null && (
                          <Money
                            minorUnits={transfer.amountMinor as MinorUnits}
                            currency={currency}
                            tone="plain"
                          />
                        )}
                      </Stack>
                    </Row>
                    <Button
                      variant="secondary"
                      to={settleUpTo(
                        groupId,
                        transfer.fromUid,
                        transfer.toUid,
                        transfer.amountMinor,
                      )}
                      label={`Record that ${nameOf(transfer.fromUid)} paid ${nameOf(transfer.toUid)}`}
                    >
                      Settle up
                    </Button>
                  </Stack>
                </Card>
              )}
            />
          </Stack>
        )}

        {group !== null && (
          <Stack gap="sm">
            <Text weight="semibold">Use simplified payments by default</Text>
            <Text variant="caption" tone="secondary">
              Turning this on makes suggested payments the group&apos;s default settle-up view for
              everyone. It never changes what anyone owes.
            </Text>
            <SegmentedControl
              label="Simplify debts by default"
              options={[
                { value: 'off', label: 'Off' },
                { value: 'on', label: 'On' },
              ]}
              value={group.simplifyDebts ? 'on' : 'off'}
              onValueChange={(next) => {
                setFailure(null);
                void updateGroup(groupId, { simplifyDebts: next === 'on' }).catch(
                  (cause: unknown) => {
                    setFailure(
                      cause instanceof Error ? cause.message : 'Could not change that setting.',
                    );
                  },
                );
              }}
            />
            {failure !== null && (
              <Stack aria-live="polite">
                <Text tone="danger">{failure}</Text>
              </Stack>
            )}
          </Stack>
        )}
      </Stack>
    </Screen>
  );
}
