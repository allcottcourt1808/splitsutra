/**
 * The group's expense list (docs/07 §GroupDetail): expenses and recorded payments in one
 * chronological list, grouped by month, newest first.
 *
 * ## Two subscriptions, one list
 *
 * Expenses and settlements are separate collections and therefore separate listeners. They are
 * merged into a single ledger by `./ledger.ts`, which is where the ordering and grouping
 * decisions live and where they are tested.
 *
 * ## The number on the right is not a balance
 *
 * Each row shows what that one expense did to the reader's position — what they paid, minus
 * their share. The group balance is the server's and is read from the member documents; adding
 * these rows up would be a second implementation of the money math (Article VI) that disagrees
 * with the real balance the moment a settlement lands.
 *
 * ## Errors get a way out
 *
 * A Firestore `permission-denied` **terminates** the listener rather than retrying, so a list
 * denied once stays empty for the life of the mount. Both hooks expose `retry()` and this
 * component surfaces it. Without that, the failure is silent and looks exactly like a group with
 * no expenses — which is how the missing list here was first mistaken for a permissions bug.
 */

import { useState } from 'react';

import { useGroupExpenses, useGroupSettlements } from '@splitsutra/core/hooks';
import { formatRelativeTime } from '@splitsutra/core';
import type { CurrencyCode, Expense, GroupMember, MinorUnits, Settlement } from '@splitsutra/core';

import { Button } from '../../components/Button';
import { Card, Stack } from '../../components/Layout';
import { List } from '../../components/List';
import { ListRow } from '../../components/ListRow';
import { Money } from '../../components/Money';
import { Text } from '../../components/Text';
import { paths } from '../../navigation/paths';
import { CATEGORY_GLYPH, SETTLEMENT_GLYPH } from '../expense/categoryGlyph';
import { buildLedger, isInvolved, myNetMinor, type LedgerEntry } from './ledger';

/** How many expenses to subscribe to at a time (docs/07: "infinite scroll at 25/page"). */
const PAGE = 25;

export interface ExpenseLedgerProps {
  readonly groupId: string;
  readonly currency: CurrencyCode;
  readonly selfUid: string;
  /** Member documents, for turning the uids on an expense back into people. */
  readonly members: readonly GroupMember[];
}

/**
 * `uid → the name to show`, with the reader as "You".
 *
 * Someone who has left keeps their member document (docs/06 §leaveGroup), so this only falls
 * through for a uid whose document is not readable — which happens while the member subscription
 * is still delivering its first snapshot.
 */
function nameFor(members: readonly GroupMember[], uid: string, selfUid: string): string {
  if (uid === selfUid) return 'You';
  return members.find((member) => member.uid === uid)?.displayName ?? 'Someone';
}

/** "You paid" / "Priya paid" / "3 people paid" — the stem of an expense row's subtitle. */
function payerLabel(expense: Expense, members: readonly GroupMember[], selfUid: string): string {
  if (expense.paidBy.length > 1) return `${String(expense.paidBy.length)} people paid`;

  const payer = expense.paidBy[0];
  if (payer === undefined) return 'Nobody paid';

  return payer.uid === selfUid ? 'You paid' : `${nameFor(members, payer.uid, selfUid)} paid`;
}

interface RowContext {
  readonly currency: CurrencyCode;
  readonly selfUid: string;
  readonly members: readonly GroupMember[];
  /** The instant the whole list is rendered against, so every "2h ago" in one paint agrees. */
  readonly now: number;
}

function ExpenseRow({ expense, ctx }: { expense: Expense; ctx: RowContext }) {
  const net = myNetMinor(expense, ctx.selfUid);
  const involved = isInvolved(expense, ctx.selfUid);
  const paid = payerLabel(expense, ctx.members, ctx.selfUid);

  return (
    <ListRow
      title={expense.description}
      subtitle={`${paid} · ${formatRelativeTime(expense.date.toDate(), ctx.now)}`}
      leading={<Text aria-hidden>{CATEGORY_GLYPH[expense.category]}</Text>}
      to={paths.ExpenseDetail({ gid: expense.groupId, eid: expense.id })}
      trailing={
        involved ? (
          // The direction word sits ON ITS OWN LINE above the amount rather than inside
          // `<Money label>`, which renders both inline. `.rowTrailing` is `flex: 0 0 auto`, so an
          // inline "you borrowed $100.00" cannot shrink and pushes the whole row past a 390px
          // viewport — the design target (Article IX). Two short lines fit; one long one does not.
          //
          // The word is not decoration. NFR-5: the red/green must never be the only signal.
          <>
            <Text variant="caption" tone="secondary">
              {net > 0 ? 'you lent' : net < 0 ? 'you borrowed' : 'settled'}
            </Text>
            <Money
              minorUnits={Math.abs(net) as MinorUnits}
              currency={ctx.currency}
              tone={net > 0 ? 'positive' : net < 0 ? 'negative' : 'neutral'}
            />
          </>
        ) : (
          <Text variant="caption" tone="secondary">
            Not involved
          </Text>
        )
      }
      label={`${expense.description}, ${paid}`}
    />
  );
}

/**
 * A recorded payment, muted and visually distinct from an expense (docs/07).
 *
 * Not tappable: a settlement has no detail screen, and a row that looks tappable and does
 * nothing is worse than one that plainly is not.
 */
function SettlementRow({ settlement, ctx }: { settlement: Settlement; ctx: RowContext }) {
  const from = nameFor(ctx.members, settlement.fromUid, ctx.selfUid);
  const to = nameFor(ctx.members, settlement.toUid, ctx.selfUid);

  return (
    <ListRow
      muted
      title={`${from} paid ${to}`}
      subtitle={`Payment · ${formatRelativeTime(settlement.date.toDate(), ctx.now)}`}
      leading={<Text aria-hidden>{SETTLEMENT_GLYPH}</Text>}
      trailing={
        <Money
          minorUnits={settlement.amountMinor as MinorUnits}
          currency={ctx.currency}
          tone="plain"
        />
      }
    />
  );
}

export function ExpenseLedger({ groupId, currency, selfUid, members }: ExpenseLedgerProps) {
  const [pageSize, setPageSize] = useState(PAGE);

  const {
    expenses,
    loading: expensesLoading,
    error: expensesError,
    retry: retryExpenses,
  } = useGroupExpenses(groupId, pageSize);
  const {
    settlements,
    loading: settlementsLoading,
    error: settlementsError,
    retry: retrySettlements,
  } = useGroupSettlements(groupId);

  const now = Date.now();
  const months = buildLedger(expenses, settlements, now);

  const error = expensesError ?? settlementsError;

  if (error !== null) {
    return (
      <Card>
        <Stack gap="sm" aria-live="polite">
          <Text tone="danger">{`Could not load the expenses. ${error.message}`}</Text>
          <Button
            variant="secondary"
            onPress={() => {
              retryExpenses();
              retrySettlements();
            }}
          >
            Try again
          </Button>
        </Stack>
      </Card>
    );
  }

  if (expensesLoading || settlementsLoading) {
    return (
      <Card>
        <Text tone="secondary">Loading expenses…</Text>
      </Card>
    );
  }

  if (months.length === 0) {
    return (
      <Card>
        <Text variant="caption" tone="secondary">
          No expenses yet. Anything you add — and any payment you record — appears here, newest
          first.
        </Text>
      </Card>
    );
  }

  // A full page came back, so there may be more behind it. Firestore does not report a total,
  // and asking for one would cost a second query for a number nobody reads.
  const mayHaveMore = expenses.length >= pageSize;

  const ctx: RowContext = { currency, selfUid, members, now };

  return (
    <Stack gap="lg">
      {months.map((month) => (
        <Stack key={month.key} gap="sm">
          <Text variant="caption" tone="secondary" weight="semibold">
            {month.label}
          </Text>
          <Card>
            <List
              data={month.entries}
              aria-label={`Expenses in ${month.label}`}
              keyExtractor={(entry: LedgerEntry) => `${entry.kind}:${entry.id}`}
              renderItem={(entry: LedgerEntry) =>
                entry.kind === 'expense' ? (
                  <ExpenseRow expense={entry.expense} ctx={ctx} />
                ) : (
                  <SettlementRow settlement={entry.settlement} ctx={ctx} />
                )
              }
            />
          </Card>
        </Stack>
      ))}

      {mayHaveMore && (
        <Button
          variant="secondary"
          onPress={() => {
            setPageSize((size) => size + PAGE);
          }}
        >
          Show more
        </Button>
      )}
    </Stack>
  );
}
