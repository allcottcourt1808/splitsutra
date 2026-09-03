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
 * ## One link per group, and it keeps working
 *
 * `invites/{id}` is unreadable to clients — no `get`, no `list` — so the response from
 * `createInvite` is the only copy of the token that will ever exist on this device. That is
 * why the button asks for the link rather than minting one: a group has one active link, and
 * `createInvite` returns the existing one when there is one. Pressing it twice gives the same
 * string, so the link can be re-shared with a fourth person a week later.
 *
 * The link is good for everyone it reaches until it expires or is reset — which is the whole
 * point, and also the exposure. **Reset link** is the counterweight and belongs next to it:
 * a standing credential nobody can revoke is a worse design than a single-use one.
 */

import { useState } from 'react';
import { useParams } from 'react-router';

import { useFriends, useGroup, useGroupMembers } from '@splitsutra/core/hooks';
import { getPlatformAdapter } from '@splitsutra/core/platform';
import {
  addFriendToGroup,
  createInvite,
  leaveGroup,
  removeMember,
} from '@splitsutra/core/repositories';
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
  const { friends } = useFriends();

  /**
   * Friends who are not already in this group.
   *
   * Filtered on `members` rather than `activeMembers`: somebody who LEFT still has a member
   * document, and re-adding them is a real thing to want, so they stay in this list. The
   * callable handles the rejoin by clearing `leftAt` rather than re-creating the document,
   * which is what preserves their balance history.
   */
  const addableFriends = friends.filter(
    (friend) => !activeMembers.some((member) => member.uid === friend.friendUid),
  );

  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  /** How many people have already joined through the link on screen. */
  const [redeemedCount, setRedeemedCount] = useState(0);

  async function createLink(reset: boolean): Promise<void> {
    setBusy(reset ? 'reset' : 'invite');
    setFailure(null);
    setMessage(null);
    try {
      const result = await createInvite(reset ? { groupId, reset: true } : { groupId });
      const url = inviteUrl(result.token);
      setInvite(url);
      setRedeemedCount(result.redeemedCount);

      if (reset) {
        setMessage('New link ready. The old one no longer works.');
        return;
      }

      try {
        await getPlatformAdapter().share({
          title: `Join ${result.groupName} on SplitSutra`,
          url,
          text: `Join ${result.groupName} on SplitSutra. The link works for 14 days.`,
        });
      } catch {
        // Sharing is a convenience; the link is on screen either way (AC-B3.2).
        setMessage('Copy the link below and send it to as many people as you like.');
      }
    } catch (cause: unknown) {
      setFailure(
        describe(
          cause,
          reset
            ? 'Could not reset the invite link. Try again.'
            : 'Could not get an invite link. Try again.',
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  /**
   * Copy and Share are two intents, not one with a fallback.
   *
   * The share sheet is a modal detour and on desktop it frequently does not exist at all;
   * somebody who just wants the string in their paste buffer should not have to open one and
   * cancel out of it. `share()` still falls back to the clipboard when no sheet exists — this
   * is the case where copying is what was actually asked for.
   */
  async function copyLink(url: string): Promise<void> {
    setBusy('copy');
    setFailure(null);
    setMessage(null);
    try {
      await getPlatformAdapter().copy(url);
      setMessage('Link copied.');
    } catch (cause: unknown) {
      // Genuinely possible in the field: `navigator.clipboard` is undefined on an insecure
      // origin, so this says what to do instead rather than just failing.
      setFailure(describe(cause, 'Could not copy. Select the link above and copy it by hand.'));
    } finally {
      setBusy(null);
    }
  }

  async function shareLink(url: string): Promise<void> {
    setBusy('share');
    setFailure(null);
    setMessage(null);
    try {
      await getPlatformAdapter().share({
        title: `Join ${group?.name ?? 'the group'} on SplitSutra`,
        url,
        text: `Join ${group?.name ?? 'the group'} on SplitSutra. The link works for 14 days.`,
      });
    } catch {
      setMessage('Copy the link above and send it to as many people as you like.');
    } finally {
      setBusy(null);
    }
  }

  async function addFriend(uid: string, displayName: string): Promise<void> {
    setBusy(uid);
    setFailure(null);
    setMessage(null);
    try {
      const result = await addFriendToGroup({ groupId, uid });
      setMessage(
        result.alreadyMember
          ? `${displayName} is already in this group.`
          : `${displayName} was added to the group.`,
      );
    } catch (cause: unknown) {
      setFailure(describe(cause, `Could not add ${displayName}. Try again.`));
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
        {/* 🔴 Friends first, link second. A link is what you need for somebody who is NOT
            already a friend; for somebody who is, sending a URL and waiting for them to open
            it is ceremony around a decision both people have already made. `addFriendToGroup`
            refuses anyone who is not a confirmed friend, which is what makes skipping the
            acceptance step safe rather than a way back to the hole friendRequests closed. */}
        {addableFriends.length > 0 && (
          <Card>
            <Stack gap="sm">
              <Text weight="semibold">Add a friend</Text>
              <Text variant="caption" tone="secondary">
                They join straight away — no link, and nothing for them to accept.
              </Text>
              <List
                data={addableFriends}
                aria-label="Friends you can add"
                keyExtractor={(friend) => friend.friendUid}
                renderItem={(friend) => (
                  <ListRow
                    title={friend.displayName}
                    leading={<Avatar name={friend.displayName} photoURL={friend.photoURL} />}
                    trailing={
                      <Button
                        variant="secondary"
                        size="compact"
                        loading={busy === friend.friendUid}
                        disabled={busy !== null}
                        onPress={() => {
                          void addFriend(friend.friendUid, friend.displayName);
                        }}
                        label={`Add ${friend.displayName} to this group`}
                      >
                        Add
                      </Button>
                    }
                  />
                )}
              />
            </Stack>
          </Card>
        )}

        <Card>
          <Stack gap="sm">
            <Text weight="semibold">Invite someone</Text>
            <Text variant="caption" tone="secondary">
              One link for the whole group — share it with as many people as you like. Anyone
              holding it can join, and it stops working after 14 days.
            </Text>
            <Button
              loading={busy === 'invite'}
              disabled={busy !== null || me === null}
              onPress={() => {
                void createLink(false);
              }}
            >
              {invite === null ? 'Get the invite link' : 'Share again'}
            </Button>
            {invite !== null && (
              <Stack gap="sm">
                <Card>
                  <Text variant="caption">{invite}</Text>
                </Card>
                {/* Two intents, not one with a fallback. The share sheet is a modal detour and
                    on desktop often does not exist; somebody who wants the string in their
                    paste buffer should not have to open one and cancel out of it. */}
                <Row gap="sm">
                  {/* `flex` lives on the Stack, not the Button: Button has no flex prop, and
                      adding one would put layout inside a primitive whose job is the control. */}
                  <Stack flex="1">
                    <Button
                      variant="secondary"
                      loading={busy === 'copy'}
                      disabled={busy !== null}
                      onPress={() => {
                        void copyLink(invite);
                      }}
                      label="Copy the invite link to the clipboard"
                    >
                      Copy
                    </Button>
                  </Stack>
                  <Stack flex="1">
                    <Button
                      variant="secondary"
                      loading={busy === 'share'}
                      disabled={busy !== null}
                      onPress={() => {
                        void shareLink(invite);
                      }}
                      label="Share the invite link"
                    >
                      Share
                    </Button>
                  </Stack>
                </Row>
                <Text variant="caption" tone="secondary">
                  {redeemedCount === 0
                    ? 'Nobody has joined through this link yet.'
                    : `${String(redeemedCount)} ${redeemedCount === 1 ? 'person has' : 'people have'} joined through this link.`}
                </Text>
                <Button
                  variant="secondary"
                  loading={busy === 'reset'}
                  disabled={busy !== null || me === null}
                  onPress={() => {
                    void createLink(true);
                  }}
                  label="Reset the invite link, so the current one stops working"
                >
                  Reset link
                </Button>
              </Stack>
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
