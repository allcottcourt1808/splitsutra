/**
 * `/invite/:token` — the other half of an invite link.
 *
 * checklists/phase-05 §8, AC-B3.3 and AC-B3.5. `GroupMembersScreen` has been able to mint and
 * share these links since Phase 05; this is the screen the recipient actually opens.
 *
 * ## 🔴 It cannot name the group before you join, and that is deliberate
 *
 * phase-05 §8 asks for a screen "showing group name before joining". That is not buildable, and
 * the reason is a security decision rather than a gap: `firestore.rules` denies **every** client
 * read of `invites/{id}` — "a readable invite collection would leak group names and let tokens be
 * brute-forced offline". The caller is also not a member yet, so `groups/{gid}` denies them too.
 * Until the join commits, there is nothing about the group this device is allowed to learn.
 *
 * A `peekInvite` callable would technically work, since holding the token is already the
 * credential. It is not worth it: it hands an attacker an oracle that turns a guessed token into
 * a group name, which is most of what the rules comment is refusing to give away, in exchange for
 * one line of copy. And putting the name in the URL — `createInvite` does return it — is worse
 * still, because a query parameter is forgeable: a link could claim any group name it liked while
 * adding you to a stranger's. The name comes back from the join, where the server vouches for it.
 *
 * So the screen is honest about what it knows: you have an invite, joining adds you, here is the
 * group once you are in.
 *
 * ## Why the join is a tap, not an effect
 *
 * Redeeming on mount would mean opening a link is the same as accepting it — no reading it,
 * no backing out, and a stray back-navigation re-fires the join. It is also the one thing
 * `docs/06` warns about from the other side ("double-tapping the join button must not error"),
 * which presumes a button. The Function is idempotent, so a second tap is safe; that is a
 * backstop, not a licence to redeem without being asked.
 *
 * ## Signed out
 *
 * Nothing here handles it. `JoinGroup` sits inside `<RequireAuth>` (see `routes.tsx`), which
 * stashes `/invite/:token` in `location.state` and replays it after sign-in — so AC-B3.3 is
 * satisfied by the routing, and a screen-level check would be a second, weaker copy of it.
 */

import { useState } from 'react';
import { useParams } from 'react-router';

import { redeemInvite, type RedeemInviteResult } from '@splitsutra/core/repositories';

import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Card, Screen, Stack } from '../components/Layout';
import { Text } from '../components/Text';
import { ScreenHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';

/**
 * The token shape, checked before it costs a round trip.
 *
 * A truncated paste is the common case — links get mangled by chat apps — and it is worth
 * separating from "the server says no": one is fixable by getting the link again, the other is
 * not. The regex mirrors `redeemInviteSchema`; the wrapper re-checks it, and the Function checks
 * it again after that.
 */
const TOKEN_RE = /^[0-9a-f]{32}$/;

/**
 * One state, not a `result` plus an `error` plus a `busy` flag — three booleans make "joined and
 * failed" representable, which renders as a success card stacked on top of an error.
 */
type JoinState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'joining' }
  | { readonly kind: 'joined'; readonly result: RedeemInviteResult }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * The statuses `redeemInvite` throws deliberately, each with a sentence written to be read by a
 * user: "This invite link has expired", "This group is full (50 members)". AC-B3.5 asks for a
 * specific message per failure case, and the server is the only thing that knows which case it
 * is, so for these the message is passed through untouched.
 */
const EXPLAINED = new Set([
  'not-found',
  'failed-precondition',
  'deadline-exceeded',
  'resource-exhausted',
]);

/**
 * 🔴 Not every `FirebaseError` carries a sentence, and passing them all through puts a raw status
 * code on screen. Verified against the dev project with the Functions not yet deployed: the call
 * rejects with `code: 'functions/internal'` and `message: 'internal [0]'`, which rendered exactly
 * like that to the user. Unit tests cannot catch it — they mock the rejection, so they only ever
 * see the human-readable half.
 *
 * So the status decides. It is read as a plain property rather than by importing `FirebaseError`,
 * because Article VIII keeps `firebase/*` out of a screen; the shape is a documented part of the
 * callable contract (`repositories/callables.ts`).
 */
function describe(cause: unknown): string {
  const code = (cause as { readonly code?: unknown } | null)?.code;
  const status = typeof code === 'string' ? code.replace(/^functions\//, '') : '';
  const message = cause instanceof Error ? cause.message : '';

  if (EXPLAINED.has(status) && message.length > 0) return message;

  // Everything else is infrastructure — offline, App Check, a Function that is not deployed.
  // None of it is the invite's fault, and none of its wording was meant for a reader.
  return 'Could not join right now. Check your connection and try again.';
}

export function JoinGroupScreen() {
  const { token } = useParams();
  const inviteToken = token ?? '';
  const malformed = !TOKEN_RE.test(inviteToken);

  const [state, setState] = useState<JoinState>({ kind: 'idle' });

  async function join(): Promise<void> {
    setState({ kind: 'joining' });
    try {
      setState({ kind: 'joined', result: await redeemInvite({ token: inviteToken }) });
    } catch (cause: unknown) {
      setState({ kind: 'failed', message: describe(cause) });
    }
  }

  // Never reached the server, so it is not a failure the server can explain. Said plainly, with
  // the one action that helps: the sender can mint another link in seconds.
  if (malformed) {
    return (
      <Screen header={<ScreenHeader title="Join group" />} label="Join group">
        <EmptyState
          glyph="🔗"
          title="This invite link is not valid"
          body="It looks incomplete — links sometimes get cut short when they are forwarded. Ask whoever sent it to share it again."
          action={<Button to={paths.GroupList()}>Back to groups</Button>}
        />
      </Screen>
    );
  }

  if (state.kind === 'joined') {
    const { groupId, groupName, alreadyMember } = state.result;
    return (
      <Screen header={<ScreenHeader title="Join group" />} label="Join group">
        <EmptyState
          glyph={alreadyMember ? '👋' : '🎉'}
          // "You joined X" would be a lie when nothing changed, which is the ordinary outcome of
          // opening the same link twice.
          title={alreadyMember ? `You are already in ${groupName}` : `You joined ${groupName}`}
          body={
            alreadyMember
              ? 'Nothing changed — this invite had already been used by you.'
              : 'Expenses you add here will be split with everyone in the group.'
          }
          action={<Button to={paths.GroupDetail({ gid: groupId })}>Open {groupName}</Button>}
        />
      </Screen>
    );
  }

  return (
    <Screen header={<ScreenHeader title="Join group" />} label="Join group">
      <Stack gap="lg">
        <Card>
          <Stack gap="sm">
            <Text variant="title">You have been invited to a group</Text>
            <Text variant="body" tone="secondary">
              Joining adds you to the group and lets you see and add its expenses. You can leave
              again once your balance is settled.
            </Text>
          </Stack>
        </Card>

        {state.kind === 'failed' ? <Text tone="danger">{state.message}</Text> : null}

        <Button onPress={join} disabled={state.kind === 'joining'}>
          {state.kind === 'joining' ? 'Joining…' : 'Join group'}
        </Button>

        <Button to={paths.GroupList()} variant="secondary">
          Not now
        </Button>
      </Stack>
    </Screen>
  );
}
