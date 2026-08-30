/**
 * `/groups/:gid/settle` — record a payment that has already happened.
 *
 * checklists/phase-07 §6, docs/07 §SettleUp.
 *
 * ## ⚠️ The confirmation copy is a requirement, not filler
 *
 * AC-E2.3: **"This records a payment you have already made outside the app. No money will
 * move."** SplitSutra never moves money, and a settle-up button that looks like it might is the
 * single worst misunderstanding this product can create. Do not soften it, and do not move it
 * below the fold.
 *
 * ## Prefill
 *
 * `from`, `to` and `amountMinor` arrive in the query string from a suggested payment
 * (AC-E3.4 / `GroupBalancesScreen`). They are a starting point, not a constraint: AC-E2.2 says a
 * partial payment must be possible, so the amount stays editable and only a *larger* one is
 * flagged.
 *
 * ## Article I
 *
 * The typed amount is turned into minor units by `parseAmountToMinor` in core — string
 * arithmetic on the digits, no `parseFloat`, no multiplication by 100.
 */

import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { useAuth, useGroup, useGroupBalances } from '@splitsutra/core/hooks';
import { createSettlement, parseAmountToMinor } from '@splitsutra/core/repositories';
import { formatMoney, getCurrency, type CurrencyCode, type MinorUnits } from '@splitsutra/core';

import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card, Row, Screen, Stack } from '../components/Layout';
import { EmptyState } from '../components/EmptyState';
import { Input } from '../components/Input';
import { List } from '../components/List';
import { ListRow } from '../components/ListRow';
import { Text } from '../components/Text';
import { ModalHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';

const NOTE_MAX = 200;

/** `YYYY-MM-DD` in local time — what a date field shows and what `new Date(y, m, d)` reverses. */
function isoDay(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Parses `YYYY-MM-DD` as a local date. `null` for anything else, including `2026-02-31`. */
function parseDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const [, year = '', month = '', day = ''] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return isoDay(date) === value.trim() ? date : null;
}

export function SettleUpScreen() {
  const { gid } = useParams();
  const groupId = gid ?? '';
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const { user } = useAuth();
  const { group, loading: groupLoading } = useGroup(groupId);
  const { activeMembers, loading, error } = useGroupBalances(groupId);

  const prefillFrom = search.get('from');
  const prefillTo = search.get('to');
  const prefillAmount = search.get('amountMinor');

  const [chosenFrom, setChosenFrom] = useState<string | null>(null);
  const [chosenTo, setChosenTo] = useState<string | null>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [day, setDay] = useState(() => isoDay(new Date()));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const currency: CurrencyCode | null = group?.currency ?? null;

  const fromUid = chosenFrom ?? prefillFrom ?? user?.uid ?? null;
  const toUid = chosenTo ?? prefillTo ?? null;

  const balanceOf = useMemo(() => {
    const map = new Map(activeMembers.map((member) => [member.uid, member.balanceMinor]));
    return (uid: string): number => map.get(uid) ?? 0;
  }, [activeMembers]);

  const nameOf = useMemo(() => {
    const map = new Map(activeMembers.map((member) => [member.uid, member.displayName]));
    return (uid: string): string => map.get(uid) ?? uid;
  }, [activeMembers]);

  /**
   * What the payer still owes, in minor units.
   *
   * A debtor's `balanceMinor` is negative, so the outstanding amount is its magnitude. Prefilled
   * as the full debt (docs/07) and editable down for a partial payment (AC-E2.2).
   */
  const outstandingMinor = fromUid === null ? 0 : Math.max(0, -balanceOf(fromUid));

  const suggestedMinor =
    prefillAmount !== null && /^\d+$/.test(prefillAmount)
      ? Number(prefillAmount)
      : outstandingMinor;

  const amountText =
    amount ??
    (currency === null || suggestedMinor === 0
      ? ''
      : formatMoney(suggestedMinor as MinorUnits, currency, 'en-US').replace(/[^\d.]/g, ''));

  const amountMinor = currency === null ? null : parseAmountToMinor(amountText, currency);

  const parsedDay = parseDay(day);

  const amountError =
    amountText.trim().length === 0
      ? undefined
      : amountMinor === null
        ? 'Enter an amount like 25 or 25.50.'
        : amountMinor <= 0
          ? 'A payment has to be more than zero.'
          : undefined;

  // AC-E2.6 — a warning, not a block. Overpaying is a real thing people do, and the ledger
  // handles it; refusing it outright would be the app telling someone their own payment did
  // not happen.
  const overpaying = amountMinor !== null && outstandingMinor > 0 && amountMinor > outstandingMinor;

  const canSave =
    user !== null &&
    currency !== null &&
    fromUid !== null &&
    toUid !== null &&
    fromUid !== toUid &&
    amountMinor !== null &&
    amountMinor > 0 &&
    parsedDay !== null &&
    note.length <= NOTE_MAX &&
    !saving;

  async function save(): Promise<void> {
    if (!canSave || user === null || currency === null) return;
    if (fromUid === null || toUid === null || amountMinor === null || parsedDay === null) return;

    setSaving(true);
    setFailure(null);
    try {
      await createSettlement(user.uid, {
        groupId,
        fromUid,
        toUid,
        amountMinor,
        currency,
        date: parsedDay,
        note: note.trim().length === 0 ? null : note.trim(),
      });
      await navigate(paths.GroupDetail({ gid: groupId }), { replace: true });
    } catch (cause: unknown) {
      setFailure(
        cause instanceof Error
          ? cause.message
          : 'Could not record that payment. Check your connection and try again.',
      );
      setSaving(false);
    }
  }

  const header = (
    <ModalHeader
      title="Settle up"
      dismissTo={paths.GroupDetail({ gid: groupId })}
      action={
        <Button
          variant="ghost"
          disabled={!canSave}
          loading={saving}
          onPress={() => {
            void save();
          }}
        >
          Record
        </Button>
      }
    />
  );

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
          <Text tone="danger">Could not load this group. {error.message}</Text>
        </Stack>
      </Screen>
    );
  }

  // A late group document is handled by the loading gate above, so reaching here with no
  // currency means the group really is gone — not that it is still in flight.
  if (currency === null) {
    return (
      <Screen header={header}>
        <EmptyState
          glyph="🔍"
          title="Group not found"
          body="It may have been deleted, or you may no longer be a member."
          action={<Button to={paths.GroupList()}>Back to groups</Button>}
        />
      </Screen>
    );
  }

  if (activeMembers.length < 2) {
    return (
      <Screen header={header}>
        <EmptyState
          glyph="🤝"
          title="Nobody to pay yet"
          body="A payment needs two people in the group. Invite someone first, then come back."
          action={<Button to={paths.GroupMembers({ gid: groupId })}>Invite someone</Button>}
        />
      </Screen>
    );
  }

  return (
    <Screen header={header}>
      <Stack gap="lg">
        <Card>
          <Stack gap="xs">
            <Text weight="semibold">No money will move</Text>
            <Text variant="caption" tone="secondary">
              This records a payment you have already made outside the app. SplitSutra never
              transfers money — it only updates who owes what.
            </Text>
          </Stack>
        </Card>

        <Stack gap="sm">
          <Text weight="semibold">Who paid</Text>
          <Card flush>
            <List
              data={activeMembers}
              aria-label="Who paid"
              keyExtractor={(member) => member.uid}
              renderItem={(member) => (
                <ListRow
                  title={
                    member.uid === user?.uid ? `${member.displayName} (you)` : member.displayName
                  }
                  subtitle={member.uid === fromUid ? 'Paying' : undefined}
                  leading={<Avatar name={member.displayName} photoURL={member.photoURL} />}
                  chevron={false}
                  trailing={
                    <Text aria-hidden tone={member.uid === fromUid ? 'primary' : 'secondary'}>
                      {member.uid === fromUid ? '✓' : ''}
                    </Text>
                  }
                  label={`${member.displayName} paid`}
                  onPress={() => {
                    setChosenFrom(member.uid);
                    if (member.uid === toUid) setChosenTo(null);
                    setAmount(null);
                  }}
                />
              )}
            />
          </Card>
        </Stack>

        <Stack gap="sm">
          <Text weight="semibold">Who they paid</Text>
          <Card flush>
            <List
              data={activeMembers.filter((member) => member.uid !== fromUid)}
              aria-label="Who they paid"
              keyExtractor={(member) => member.uid}
              renderItem={(member) => (
                <ListRow
                  title={
                    member.uid === user?.uid ? `${member.displayName} (you)` : member.displayName
                  }
                  subtitle={member.uid === toUid ? 'Receiving' : undefined}
                  leading={<Avatar name={member.displayName} photoURL={member.photoURL} />}
                  chevron={false}
                  trailing={
                    <Text aria-hidden tone={member.uid === toUid ? 'primary' : 'secondary'}>
                      {member.uid === toUid ? '✓' : ''}
                    </Text>
                  }
                  label={`Paid to ${member.displayName}`}
                  onPress={() => {
                    setChosenTo(member.uid);
                  }}
                />
              )}
            />
          </Card>
        </Stack>

        <Input
          label={`Amount (${currency})`}
          value={amountText}
          onValueChange={setAmount}
          inputMode="decimal"
          leading={<Text aria-hidden>{getCurrency(currency).symbol}</Text>}
          error={amountError}
          helper={
            outstandingMinor > 0 && fromUid !== null
              ? `${nameOf(fromUid)} still owes ${formatMoney(outstandingMinor as MinorUnits, currency)} in this group. A smaller amount is fine.`
              : 'Enter the amount that actually changed hands.'
          }
        />

        {overpaying && (
          <Stack aria-live="polite">
            <Text variant="caption" tone="secondary">
              That is more than is outstanding. Recording it is fine — the extra becomes credit the
              other way.
            </Text>
          </Stack>
        )}

        <Input
          label="Date"
          value={day}
          onValueChange={setDay}
          inputMode="numeric"
          placeholder="2026-08-29"
          error={parsedDay === null ? 'Use the format 2026-08-29.' : undefined}
          helper={parsedDay === null ? undefined : 'When the payment actually happened.'}
        />

        <Input
          label="Note (optional)"
          value={note}
          onValueChange={setNote}
          maxLength={NOTE_MAX}
          placeholder="Cash at the airport"
          helper={`${String(NOTE_MAX - note.length)} characters left.`}
        />

        {fromUid !== null && toUid !== null && amountMinor !== null && amountMinor > 0 && (
          <Card>
            <Row gap="sm" align="center">
              <Text variant="caption" tone="secondary">
                {`${nameOf(fromUid)} paid ${nameOf(toUid)} ${formatMoney(amountMinor, currency)}.`}
              </Text>
            </Row>
          </Card>
        )}

        {failure !== null && (
          <Stack aria-live="polite">
            <Text tone="danger">{failure}</Text>
          </Stack>
        )}
      </Stack>
    </Screen>
  );
}
