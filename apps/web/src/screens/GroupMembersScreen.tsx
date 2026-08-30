/**
 * `/groups/:gid/members` — who is in the group, and the two ways that changes.
 *
 * checklists/phase-05 §4 and §8.
 *
 * ## Nothing on this screen writes to `members`
 *
 * 🔴 `groups/{gid}/members` is `allow write: if false` in every direction (Article III, threats
 * T2/T4). Adding somebody is `createInvite` + `redeemInvite`; removing somebody is
 * `removeMember`; leaving is `leaveGroup`. Each one has a precondition — a zero balance, an
 * admin role — that can only be checked by reading other members' documents, which Rules cannot
 * do. The buttons here are callable invocations, and the `HttpsError` messages they throw are
 * written to be shown to a user (they name the outstanding amount), so they are displayed
 * verbatim rather than replaced with an apology.
 *
 * ## The invite token is shown once
 *
 * `invites/{id}` is unreadable to clients — no `get`, no `list` — so the response from
 * `createInvite` is the only copy of the token that will ever exist on this device. Losing it
 * means minting another, which is cheap; leaking it means anyone holding the link can join.
 */

import { useState } from 'react';
import { useParams } from 'react-router';

import { useGroup, useGroupMembers } from '@splitsutra/core/hooks';
import { getPlatformAdapter } from '@splitsutra/core/platform';
import { createInvite, leaveGroup, removeMember } from '@splitsutra/core/repositories';
import type { GroupMember, MinorUnits } from '@splitsutra/core';

import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card, Row, Screen, Stack } from '../components/Layout';
import { List } from '../components/List';
import { ListRow } from '../components/ListRow';
import { Money } from '../components/Money';
import { Text } from '../components/Text';
import { ScreenHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';

/**
 * An absolute invite URL.
 *
 * The path comes from `paths.JoinGroup` — never concatenated by hand — and only the origin is
 * read off the platform. Phase 12 replaces this one line with a configured deep-link scheme.
 */
function inviteUrl(token: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}${paths.JoinGroup({ token })}`;
}

function describe(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : '';
  return message.length > 0 ? message : fallback;
}

/** What is in flight: `'invite'`, `'leave'`, or the uid being removed. One at a time. */
type Busy = string | null;

export function GroupMembersScreen() {
  const { gid } = useParams();
  const groupId = gid ?? '';

  const { group } = useGroup(groupId);
  const { members, activeMembers, me, isAdmin, loading, error } = useGroupMembers(groupId);

  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);

  async function createLink(): Promise<void> {
    setBusy('invite');
    setFailure(null);
    setMessage(null);
    try {
      const result = await createInvite({ groupId });
      const url = inviteUrl(result.token);
      setInvite(url);
      try {
        await getPlatformAdapter().share({
          title: `Join ${result.groupName} on SplitSutra`,
          url,
          text: `Join ${result.groupName} on SplitSutra. The link works for 14 days.`,
        });
      } catch {
        // Sharing is a convenience; the link is on screen either way (AC-B3.2).
        setMessage('Copy the link below and send it however you like.');
      }
    } catch (cause: unknown) {
      setFailure(describe(cause, 'Could not create an invite link. Try again.'));
    } finally {
      setBusy(null);
    }
  }

  async function remove(member: GroupMember): Promise<void> {
    setBusy(member.uid);
    setFailure(null);
    setMessage(null);
    try {
      await removeMember({ groupId, uid: member.uid });
      setMessage(`${member.displayName} was removed.`);
    } catch (cause: unknown) {
      setFailure(
        describe(cause, `Could not remove ${member.displayName}. They may still owe or be owed.`),
      );
    } finally {
      setBusy(null);
    }
  }

  async function leave(): Promise<void> {
    setBusy('leave');
    setFailure(null);
    setMessage(null);
    try {
      await leaveGroup({ groupId });
      setMessage('You have left this group.');
    } catch (cause: unknown) {
      setFailure(describe(cause, 'Could not leave the group. Settle your balance first.'));
    } finally {
      setBusy(null);
    }
  }

  const header = <ScreenHeader title="Members" backTo={paths.GroupDetail({ gid: groupId })} />;

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
          <Text tone="danger">Could not load the members. {error.message}</Text>
        </Stack>
      </Screen>
    );
  }

  const currency = group?.currency ?? null;

  return (
    <Screen header={header}>
      <Stack gap="lg">
        <Card>
          <Stack gap="sm">
            <Text weight="semibold">Invite someone</Text>
            <Text variant="caption" tone="secondary">
              Anyone with the link can join this group. It stops working after 14 days.
            </Text>
            <Button
              loading={busy === 'invite'}
              disabled={busy !== null || me === null}
              onPress={() => {
                void createLink();
              }}
            >
              Create an invite link
            </Button>
            {invite !== null && (
              <Card>
                <Text variant="caption">{invite}</Text>
              </Card>
            )}
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

        <List
          data={members}
          aria-label="Members"
          keyExtractor={(member) => member.uid}
          empty={
            <Card>
              <Text variant="caption" tone="secondary">
                Nobody here yet. The member list fills in a moment after a group is created.
              </Text>
            </Card>
          }
          renderItem={(member) => {
            const departed = member.leftAt !== null;
            const isMe = me !== null && member.uid === me.uid;
            return (
              <Stack gap="xs">
                <ListRow
                  title={isMe ? `${member.displayName} (you)` : member.displayName}
                  subtitle={
                    departed ? 'Left this group' : member.role === 'admin' ? 'Admin' : undefined
                  }
                  leading={<Avatar name={member.displayName} photoURL={member.photoURL} />}
                  chevron={false}
                  muted={departed}
                  trailing={
                    currency === null ? undefined : member.balanceMinor === 0 ? (
                      <Text variant="caption" tone="secondary">
                        Settled up
                      </Text>
                    ) : (
                      <Money
                        minorUnits={member.balanceMinor as MinorUnits}
                        currency={currency}
                        tone="auto"
                        label={member.balanceMinor > 0 ? 'is owed' : 'owes'}
                      />
                    )
                  }
                />
                {isAdmin && !departed && !isMe && (
                  <Row>
                    <Button
                      variant="ghost"
                      disabled={busy !== null}
                      loading={busy === member.uid}
                      onPress={() => {
                        void remove(member);
                      }}
                      label={`Remove ${member.displayName} from the group`}
                    >
                      Remove
                    </Button>
                  </Row>
                )}
              </Stack>
            );
          }}
        />

        {me !== null && me.leftAt === null && (
          <Card>
            <Stack gap="sm">
              <Text weight="semibold">Leave this group</Text>
              <Text variant="caption" tone="secondary">
                {activeMembers.length === 1
                  ? 'You are the only member left. Leaving keeps the group and its history intact.'
                  : 'You can only leave once your balance in this group is zero. Everything you have already added stays.'}
              </Text>
              <Button
                variant="danger"
                loading={busy === 'leave'}
                disabled={busy !== null}
                onPress={() => {
                  void leave();
                }}
              >
                Leave group
              </Button>
            </Stack>
          </Card>
        )}
      </Stack>
    </Screen>
  );
}
