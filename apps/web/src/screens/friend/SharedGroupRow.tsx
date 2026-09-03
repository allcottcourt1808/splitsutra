/**
 * One shared group, on the friend detail screen: what this pair owes each other in it.
 *
 * ## 🔴 A member balance is NOT a pairwise debt
 *
 * `groups/{gid}/members/{uid}.balanceMinor` is a member's net position against the whole group,
 * not against any one person. In a three-way group "Priya is −2000" says nothing about who she
 * owes. Turning that into "Sandeep owes you ₹500" is `simplifyDebts()`, the same function
 * `SettleUpScreen` uses — so this screen shows the number the app already tells you to pay, and
 * never a second, differently-derived answer to the same question (Article VI).
 *
 * ## ⚠️ It is a settlement SUGGESTION, and on this screen that needs saying
 *
 * `simplifyDebts` finds a minimal set of transfers that settles the group. With more than two
 * people the plan is one of several valid ones, and it can pair up two members who never shared
 * an expense — that is the whole point of simplification (ADR-12, on by default), and it is what
 * makes three payments become one.
 *
 * On the settle-up screen that reads correctly, because the question there is "what should I
 * pay". On a FRIEND's page the same number invites a stronger reading — "this is what passed
 * between us" — which it is not. Hence the caption on the section in `FriendDetailScreen`, and
 * hence the group name on every row: the amount is only meaningful with the group attached.
 *
 * ## One listener per shared group
 *
 * Same shape as `useMyGroupBalances` and the activity feed, and deliberate for the same reason
 * (docs/03): N is bounded by the groups this pair actually share, which is small, and Article XII
 * wants a measurement before a denormalised mirror exists to be kept in step. Unlike the friends
 * LIST — where the projection exists because rules make N unbounded and unreachable — this is a
 * screen about one friendship, opened deliberately.
 */

import { useMemo } from 'react';

import { useGroupBalances } from '@splitsutra/core/hooks';
import { simplifyDebts, toMinorUnits, type CurrencyCode, type Group } from '@splitsutra/core';

import { ListRow } from '../../components/ListRow';
import { Money } from '../../components/Money';
import { Text } from '../../components/Text';
import { paths } from '../../navigation/paths';

export interface SharedGroupRowProps {
  readonly group: Group;
  readonly friendUid: string;
  readonly selfUid: string;
}

export function SharedGroupRow({ group, friendUid, selfUid }: SharedGroupRowProps) {
  const { balances, loading, error } = useGroupBalances(group.id);

  /**
   * Signed from the reader's point of view, matching the balance convention everywhere else:
   * positive means they owe you.
   *
   * `null` means genuinely nothing between the two of you in this group — either the plan
   * settles them through other people, or everyone is square.
   */
  const amountMinor = useMemo(() => {
    if (balances.length === 0) return null;

    const transfer = simplifyDebts(balances).find(
      (candidate) =>
        (candidate.fromUid === selfUid && candidate.toUid === friendUid) ||
        (candidate.fromUid === friendUid && candidate.toUid === selfUid),
    );
    if (transfer === undefined) return null;

    // `fromUid` pays `toUid`. They pay you → they owe you → positive.
    //
    // `toMinorUnits` rather than a cast: `Transfer.amountMinor` is a plain `number`, and the
    // brand exists precisely so that re-entering the money type goes through the one function
    // that checks it is a safe integer (Article I). A cast here would launder a float.
    return toMinorUnits(
      transfer.fromUid === friendUid ? transfer.amountMinor : -transfer.amountMinor,
    );
  }, [balances, selfUid, friendUid]);

  const trailing =
    error !== null ? (
      <Text variant="caption" tone="danger">
        Unavailable
      </Text>
    ) : loading ? (
      <Text variant="caption" tone="secondary">
        …
      </Text>
    ) : amountMinor === null ? (
      <Text variant="caption" tone="secondary">
        Settled up
      </Text>
    ) : (
      <Money
        minorUnits={amountMinor}
        currency={group.currency as CurrencyCode}
        tone="auto"
        label={amountMinor > 0 ? 'owes you' : 'you owe'}
      />
    );

  // The currency is on the subtitle as well as in the amount: two groups in different
  // currencies sit next to each other here, and D6 forbids ever adding them up.
  //
  // `to` rather than `onPress`: `ListRow` renders a real anchor for it, so the row is
  // cmd-clickable and the destination is a deep link. It is safe to send someone there from
  // here because these are real groups by construction — `useGroups` has already excluded the
  // implicit ones, which have no group screen worth landing on.
  return (
    <ListRow
      title={group.name}
      subtitle={group.currency}
      trailing={trailing}
      to={paths.GroupDetail({ gid: group.id })}
    />
  );
}
