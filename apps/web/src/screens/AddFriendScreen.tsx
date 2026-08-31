/**
 * `/friends/add` — look someone up by email or phone, and ask them to be friends.
 *
 * checklists/phase-05 §7: "search by email or phone, result card, Add action", plus a
 * not-found state that offers an invite link (AC-B1.3).
 *
 * ## The ask is a request, not an add
 *
 * Sending does not create the friendship. It writes one `pending` document, and the friendship
 * appears only once the other person accepts (`packages/core/src/types/friendRequest.ts`). So
 * the success state here says "Request sent", never "Added" — the screen must not imply an
 * outcome that is still somebody else's to decide.
 *
 * The one exception is genuine and worth its own message: if they had already asked *you*,
 * sending is an acceptance, and you are friends immediately.
 *
 * ## Article VIII
 *
 * No Firestore anywhere in this file. The lookup, the send and the withdraw are all
 * `@splitsutra/core` calls, and the outgoing list is a hook. This screen ports to React Native
 * by swapping the primitives.
 */

import { useState, type FormEvent } from 'react';

import {
  cancelFriendRequest,
  sendFriendRequest,
  type SendFriendRequestResult,
} from '@splitsutra/core/repositories';
import { describeFriendLookup } from '@splitsutra/core';
import { useFriendRequests } from '@splitsutra/core/hooks';

import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card, Screen, Row, Stack } from '../components/Layout';
import { Input } from '../components/Input';
import { List } from '../components/List';
import { ListRow } from '../components/ListRow';
import { SegmentedControl } from '../components/SegmentedControl';
import { Text } from '../components/Text';
import { ScreenHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';

/** Which identifier the user is typing. Mirrors the `exactly one of` rule on the schema. */
type LookupMode = 'email' | 'phone';

const MODES = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
] as const satisfies readonly { value: LookupMode; label: string }[];

/**
 * What the last send produced, or the failure it produced instead.
 *
 * One state rather than a `result` and an `error`, because they are mutually exclusive and two
 * fields make "both set" representable — which renders as a success card above an error.
 */
type SendState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'sent'; readonly result: SendFriendRequestResult }
  | { readonly kind: 'failed'; readonly message: string; readonly notFound: boolean };

/**
 * A `FirebaseError` from a callable arrives with `code: 'functions/<status>'` and the message
 * the Function chose. Those messages are written to be shown to a user, so they are passed
 * through rather than replaced (see `repositories/callables.ts`).
 *
 * `not-found` is singled out because it is the one failure with a next action: the person has
 * no account, so offer to invite them (AC-B1.3).
 */
function describeSendError(cause: unknown): { message: string; notFound: boolean } {
  const code = typeof cause === 'object' && cause !== null ? Reflect.get(cause, 'code') : undefined;
  const raw = cause instanceof Error ? cause.message : String(cause);

  // 🔴 A ZodError is an Error, and its `.message` is the JSON-encoded issue array — origin,
  //    code, the raw regex source, the field path. That is what this function used to hand
  //    straight to the screen, and what a user actually saw after pressing Send.
  //
  //    `describeFriendLookup` now blocks the submit before it can happen, so this is the second
  //    line rather than the first. It stays because the shape of the guarantee matters: NOTHING
  //    a validator serialises should be able to reach a user, whichever validator it is and
  //    however it gets here.
  const isSerialisedIssues = raw.trimStart().startsWith('[') && raw.includes('"code"');

  return {
    message:
      raw.length > 0 && !isSerialisedIssues
        ? raw
        : 'Could not send that request. Check the address and try again.',
    notFound: code === 'functions/not-found',
  };
}

/** The line under the result card. Each outcome the Function can return says something different. */
function outcomeMessage(result: SendFriendRequestResult): string {
  switch (result.outcome) {
    case 'sent':
      return `Request sent. ${result.displayName} has to accept before you share any expenses.`;
    case 'already-pending':
      return `You have already asked ${result.displayName}. They have not answered yet.`;
    case 'auto-accepted':
      return `${result.displayName} had already asked you, so you are now friends.`;
    case 'already-friends':
      return `You and ${result.displayName} are already friends.`;
  }
}

export function AddFriendScreen() {
  const [mode, setMode] = useState<LookupMode>('email');
  const [value, setValue] = useState('');
  const [state, setState] = useState<SendState>({ kind: 'idle' });

  const { outgoing } = useFriendRequests();

  const trimmed = value.trim();

  /**
   * Live, on the field, while it is being typed — never an alert on submit (docs/07
   * §Interaction rules 3). It used to be neither: the value went straight to
   * `sendFriendRequest`, whose `.parse()` threw, and the ZodError JSON was rendered as the
   * failure message.
   */
  const inputError = describeFriendLookup(mode, value);

  // Blocked while the value cannot possibly resolve, so the round trip is not spent proving
  // what the schema already knows.
  const canSend = trimmed.length > 0 && inputError === null && state.kind !== 'sending';

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSend) return;

    setState({ kind: 'sending' });
    try {
      // Exactly one of the two, never both — the shared Zod schema refuses anything else, and
      // the Function refuses it again.
      const result = await sendFriendRequest(
        mode === 'email' ? { email: trimmed } : { phoneNumber: trimmed },
      );
      setState({ kind: 'sent', result });
      // Cleared only on success: a rejected address should stay in the field to be corrected,
      // not vanish and leave the user retyping it.
      setValue('');
    } catch (cause: unknown) {
      const { message, notFound } = describeSendError(cause);
      setState({ kind: 'failed', message, notFound });
    }
  }

  async function withdraw(requestId: string): Promise<void> {
    try {
      await cancelFriendRequest({ requestId });
    } catch (cause: unknown) {
      setState({ kind: 'failed', ...describeSendError(cause) });
    }
  }

  return (
    <Screen header={<ScreenHeader title="Add a friend" backTo={paths.FriendList()} />}>
      <Stack gap="lg">
        <form onSubmit={submit}>
          <Stack gap="md">
            <SegmentedControl
              label="Look up by"
              options={MODES}
              value={mode}
              onValueChange={(next) => {
                setMode(next);
                // The other field's value is never a valid value for this one, and leaving it
                // there produces a validation error the user did not cause.
                setValue('');
                setState({ kind: 'idle' });
              }}
            />

            {mode === 'email' ? (
              <Input
                label="Email address"
                value={value}
                onValueChange={setValue}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="them@example.com"
                error={inputError ?? undefined}
                helper="They will get a request to accept."
              />
            ) : (
              <Input
                label="Phone number"
                value={value}
                onValueChange={setValue}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+14155550123"
                // The Function matches E.164 exactly, because that is the format the
                // `usernames/` index was built from. Saying so up front beats a rejection.
                error={inputError ?? undefined}
                helper="Include the country code, e.g. +14155550123."
              />
            )}

            <Button type="submit" fullWidth disabled={!canSend} loading={state.kind === 'sending'}>
              Send request
            </Button>
          </Stack>
        </form>

        {state.kind === 'sent' && (
          <Card>
            <Stack gap="sm">
              <Row gap="sm" align="center">
                <Avatar name={state.result.displayName} photoURL={state.result.photoURL} />
                <Text weight="semibold">{state.result.displayName}</Text>
              </Row>
              <Text variant="caption" tone="secondary">
                {outcomeMessage(state.result)}
              </Text>
              {state.result.implicitGroupId !== null && (
                <Button variant="secondary" to={paths.FriendDetail({ uid: state.result.toUid })}>
                  Open
                </Button>
              )}
            </Stack>
          </Card>
        )}

        {state.kind === 'failed' && (
          <Card>
            <Stack gap="sm">
              <Text tone="danger">{state.message}</Text>
              {/*
                AC-B1.3. The only failure with a next action: there is no account to ask, so
                the useful thing is an invite rather than a retry. Sharing an invite link is a
                group action, so this points at the group list rather than minting a token for
                a group nobody has chosen.
              */}
              {state.notFound && (
                <Button variant="secondary" to={paths.GroupList()}>
                  Invite them to a group instead
                </Button>
              )}
            </Stack>
          </Card>
        )}

        {outgoing.length > 0 && (
          <Stack gap="sm">
            <Text variant="caption" tone="secondary" weight="semibold">
              Waiting for an answer
            </Text>
            <List
              data={outgoing}
              aria-label="Requests you have sent"
              keyExtractor={(request) => request.id}
              renderItem={(request) => (
                <ListRow
                  title={request.toName}
                  subtitle="Waiting for them to accept"
                  leading={<Avatar name={request.toName} photoURL={request.toPhotoURL} />}
                  trailing={
                    <Button
                      variant="ghost"
                      onPress={() => {
                        void withdraw(request.id);
                      }}
                    >
                      Withdraw
                    </Button>
                  }
                />
              )}
            />
          </Stack>
        )}
      </Stack>
    </Screen>
  );
}
