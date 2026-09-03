/**
 * `/groups/:gid` — the group home (docs/07 §GroupDetail).
 *
 * Header, member stack, balance strip, a settle-up action, and the expense ledger.
 *
 * The ledger section stood empty for a long time as a placeholder card that always read "…once
 * you add one", whatever the group actually held. That is worth remembering because of how it
 * failed: a group with expenses in it looked exactly like a group with none, and the missing
 * feature was reported as a permissions bug. A placeholder that states something false about
 * live data is worse than an obviously unfinished one.
 *
 * ## `null` is a real answer here
 *
 * Rules gate `get` on membership, so a group the user has left, was removed from, or never
 * joined arrives as a missing document. There is nothing more specific this screen could
 * honestly say, and the state it shows offers a way back rather than a dead end (docs/15 rule 6).
 *
 * ## A denial is not always a real answer
 *
 * `permission-denied` is different from a missing document, and it has one cause the user did
 * nothing to deserve: `isMember()` reads `groups/{gid}/members/{uid}`, which only
 * `onGroupCreated` ever writes, so a group whose trigger never ran is unopenable by its own
 * creator while still sitting in their group list (`allow list` reads `memberIds` and needs no
 * member document). Every group created on dev before the Functions deploy is in exactly that
 * state.
 *
 * So a denial gets ONE automatic `repairGroupMembership` attempt before this screen calls it a
 * failure. That callable is idempotent and refuses unless `memberIds` already names the caller,
 * so the worst case for a genuine denial — someone poking at a group they were removed from — is
 * one wasted round trip that returns `permission-denied` again.
 *
 * 🔴 One attempt per group id, tracked in a ref, and never in a `catch` that re-triggers itself.
 *    A retry loop here would be a self-inflicted denial-of-wallet: the failing case is the one
 *    that would spin (Article XI).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';

import { useAuth, useGroup, useGroupBalances } from '@splitsutra/core/hooks';
import { repairGroupMembership } from '@splitsutra/core/repositories';
import type { GroupType, MinorUnits } from '@splitsutra/core';

import { AvatarStack } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card, Row, Screen, Spacer, Stack } from '../components/Layout';
import { EmptyState } from '../components/EmptyState';
import { Money } from '../components/Money';
import { Text } from '../components/Text';
import { ScreenHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';
import { ExpenseLedger } from './group/ExpenseLedger';
import { groupLabel } from './group/groupLabel';

/**
 * Keyed by `GroupType`, so it covers the retired `couple` too — a group created before that type
 * was dropped from the picker still has to render as something.
 *
 * `friends` and `friend` deliberately read the same. They differ structurally (one is a group
 * someone created and labelled, the other is the hidden 1:1 container behind a friend expense),
 * but that distinction is ours, not the reader's — both are "friends" to the person looking.
 */
const TYPE_LABEL: Readonly<Record<GroupType, string>> = {
  trip: 'Trip',
  home: 'Home',
  friends: 'Friends',
  other: 'Group',
  friend: 'Friends',
  couple: 'Couple',
};

/**
 * Is this the denial a missing member document produces?
 *
 * Duck-typed on `code` rather than `instanceof FirestoreError`: Article VIII forbids a screen
 * importing the Firebase SDK at all, and `depcruise` enforces it. The string is part of the
 * Firestore error contract, not an implementation detail.
 */
function isPermissionDenied(error: Error | null): boolean {
  return (error as { readonly code?: unknown } | null)?.code === 'permission-denied';
}

export function GroupDetailScreen() {
  const { gid } = useParams();
  const groupId = gid ?? '';

  const { user } = useAuth();
  const { group, loading, error, retry: retryGroup } = useGroup(groupId);
  const {
    activeMembers,
    myBalanceMinor,
    loading: membersLoading,
    retry: retryMembers,
  } = useGroupBalances(groupId);

  const [repairing, setRepairing] = useState(false);
  // The group id already attempted, not a boolean: react-router reuses this component across
  // /groups/:gid changes, so a boolean would spend its one attempt on the first group and leave
  // every later one unrepaired.
  const attemptedFor = useRef<string | null>(null);

  const reload = useCallback(() => {
    attemptedFor.current = null;
    retryGroup();
    retryMembers();
  }, [retryGroup, retryMembers]);

  useEffect(() => {
    if (!isPermissionDenied(error)) return;
    if (attemptedFor.current === groupId) return;
    attemptedFor.current = groupId;

    // Guards the state writes, not the call: the repair itself must finish even if the screen
    // unmounts — abandoning it half way would leave the group bricked for the next visit.
    let mounted = true;
    setRepairing(true);

    void repairGroupMembership({ groupId })
      .then(() => {
        if (!mounted) return;
        setRepairing(false);
        // Both listeners died on the same denial, and one member document revives both.
        retryGroup();
        retryMembers();
      })
      .catch(() => {
        // Swallowed deliberately. The reason the group would not load is already on screen in
        // `error`; replacing it with the repair's own message would report the failure of the
        // fix instead of the problem.
        if (!mounted) return;
        setRepairing(false);
      });

    return () => {
      mounted = false;
    };
  }, [error, groupId, retryGroup, retryMembers]);

  /**
   * A promoted friendship (ADR-13) is titled with the other person, not with the stored
   * `"<you> & <them>"` — see `groupLabel`.
   *
   * The member documents are the FRESHEST source of that name: `onUserProfileWritten` rewrites
   * them on a rename, and neither `groups/{gid}.name` nor `friends/{fid}.displayName` is
   * touched by it. This screen already subscribes to them, so it costs nothing to prefer them
   * here, and `groupLabel` falls back to stripping the viewer's own name when they have not
   * arrived yet.
   */
  const label =
    group === null
      ? 'Group'
      : groupLabel(group, {
          friendName: activeMembers.find((member) => member.uid !== user?.uid)?.displayName,
          selfName: user?.displayName ?? '',
        });

  const header = <ScreenHeader title={label} backTo={paths.GroupList()} />;

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
          {repairing ? (
            <Text tone="secondary">Finishing setting up this group…</Text>
          ) : (
            <>
              <Text tone="danger">Could not load this group. {error.message}</Text>
              <Button variant="secondary" onPress={reload}>
                Try again
              </Button>
            </>
          )}
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
      label={label}
      header={
        <ScreenHeader
          title={label}
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
          {/* Carries the group, so the composer opens on the one you are looking at rather
              than on whichever was last active. Without it, adding from inside a group could
              silently file the expense somewhere else. */}
          <Button fullWidth to={paths.AddExpense({ gid: group.id })}>
            Add an expense
          </Button>
        </Stack>
      }
    >
      <Stack gap="lg">
        {/* One line, not four.

            This was a full card stacking the type, the avatars and the member count as three
            rows above a Members button — 145px of chrome before the balance, which is the
            number the screen exists to show. Everything it said still fits on one line beside
            the faces, so it says it there. */}
        <Card tight>
          <Row gap="sm">
            {activeMembers.length > 0 && (
              <AvatarStack
                people={activeMembers.map((member) => ({
                  uid: member.uid,
                  displayName: member.displayName,
                  photoURL: member.photoURL,
                }))}
                max={3}
              />
            )}
            <Text variant="caption" tone="secondary" truncate>
              {`${String(group.memberCount)} ${group.memberCount === 1 ? 'member' : 'members'} · ${TYPE_LABEL[group.type]} · ${group.currency}`}
            </Text>
            <Spacer />
            <Button variant="ghost" size="compact" to={paths.GroupMembers({ gid: group.id })}>
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
          <ExpenseLedger
            groupId={group.id}
            currency={group.currency}
            selfUid={user?.uid ?? ''}
            members={activeMembers}
          />
        </Stack>
      </Stack>
    </Screen>
  );
}
