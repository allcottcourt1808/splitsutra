/**
 * `friendRequests/{requestId}` — the consent step in front of a friendship.
 *
 * ## Reads are subscriptions; writes are callables
 *
 * The three mutations here are `httpsCallable` wrappers, not Firestore writes, because
 * `firestore.rules` denies every client write to this collection. Accepting a request creates a
 * group, two member documents and two `friends` documents carrying `balanceMinor` — a
 * multi-document, cross-user, atomic write that Rules cannot express and a client must not be
 * trusted with (Article III, threats T2/T4).
 *
 * The reads are plain `onSnapshot` queries, so the recipient's inbox updates live: a request
 * sent while they have the app open appears without a refresh, which is what makes "the
 * notification goes in-app" true rather than a thing you find out about next launch.
 *
 * ## The queries need composite indexes
 *
 * Both of the watchers below filter on two fields and order on a third, which Firestore cannot
 * serve from single-field indexes. Both are declared in `firestore.indexes.json`; without them
 * the query fails at runtime with a `failed-precondition` whose message contains the URL that
 * creates the missing index.
 *
 * @see docs/06-cloud-functions.md §sendFriendRequest
 * @see ../types/friendRequest.ts — why the document ID is derived
 */

import { orderBy, query, where } from 'firebase/firestore';

import {
  cancelFriendRequestSchema,
  respondToFriendRequestSchema,
  sendFriendRequestSchema,
  type CancelFriendRequestInput,
  type FriendRequest,
  type RespondToFriendRequestInput,
  type SendFriendRequestInput,
} from '../types/index.js';
import { CALLABLE, callFunction } from './callables.js';
import { friendRequestsCollection } from './refs.js';
import { watchQuery, type OnError, type OnNext, type Unsubscribe } from './subscribe.js';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Reads
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Requests addressed to `uid` and still awaiting an answer — **the in-app notification**.
 *
 * There is no `notifications` collection (docs/03 defers it with push), and this is why one is
 * not needed for this feature: the pending request already is the notification. It carries the
 * sender's name and photo, it is authoritative rather than a copy that can drift, and it
 * disappears from the query the instant it is answered — including when it is answered on
 * another device, which a separate notification document would have had to be told about.
 *
 * Ordered newest-first so the badge count and the top of the list agree about what is new.
 */
export function watchIncomingFriendRequests(
  uid: string,
  onNext: OnNext<readonly FriendRequest[]>,
  onError: OnError,
): Unsubscribe {
  return watchQuery(
    query(
      friendRequestsCollection(),
      where('toUid', '==', uid),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
    ),
    onNext,
    onError,
  );
}

/**
 * Requests `uid` has sent that have not been answered yet.
 *
 * Shown so the Add Friend screen can say "Request sent" instead of offering to send a second
 * one, and so there is somewhere to withdraw from. Deliberately does not surface answered
 * requests: an accepted one is visible as a friend, and telling somebody they were declined
 * serves no purpose the product wants to serve.
 */
export function watchOutgoingFriendRequests(
  uid: string,
  onNext: OnNext<readonly FriendRequest[]>,
  onError: OnError,
): Unsubscribe {
  return watchQuery(
    query(
      friendRequestsCollection(),
      where('fromUid', '==', uid),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
    ),
    onNext,
    onError,
  );
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Writes — every one a callable
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** What `sendFriendRequest` returns. */
export interface SendFriendRequestResult {
  /** `friendRequests/{id}` that now exists, or the one that already did. */
  readonly requestId: string;
  /** The resolved contact — exactly the `usernames/{key}` public projection, never more. */
  readonly toUid: string;
  readonly displayName: string;
  readonly photoURL: string | null;
  /**
   * What actually happened. `already-pending` means an identical request was outstanding;
   * `already-friends` means they were friends before this call.
   */
  readonly outcome: 'sent' | 'already-pending' | 'already-friends' | 'auto-accepted';
  /**
   * The shared implicit group — set when the outcome established or found a friendship
   * (`already-friends`, `auto-accepted`), `null` while a request is merely pending.
   */
  readonly implicitGroupId: string | null;
}

/**
 * Look a contact up by email or phone and ask them to be friends.
 *
 * The resolve goes through the hashed `usernames/` index inside the Function; the raw identifier
 * never reaches a query against `users`, so this cannot enumerate the user table (T5). Every
 * unresolvable lookup — no account, tombstoned account, dangling index entry — comes back as the
 * same `functions/not-found` with the same message, on purpose.
 *
 * Validated here against the same schema the Function uses, to save a round trip on a malformed
 * address and to produce a message that names the field. Article IV: that parse is UX. The
 * Function's parse is the one that is load-bearing.
 */
export async function sendFriendRequest(
  input: SendFriendRequestInput,
): Promise<SendFriendRequestResult> {
  const payload = sendFriendRequestSchema.parse(input);
  return callFunction<SendFriendRequestInput, SendFriendRequestResult>(
    CALLABLE.sendFriendRequest,
    payload,
  );
}

/** What `respondToFriendRequest` returns. */
export interface RespondToFriendRequestResult {
  readonly requestId: string;
  readonly status: 'accepted' | 'declined';
  /** The implicit group the acceptance created, or `null` on a decline. */
  readonly implicitGroupId: string | null;
}

/**
 * Accept or decline a request addressed to the caller.
 *
 * On accept the Function creates the implicit group, both member documents and both `friends`
 * documents **in one transaction** — a friendship that exists on one side only is a corrupt
 * state no screen checks for and nothing would repair.
 *
 * Only the recipient may call this. The sender withdrawing uses {@link cancelFriendRequest},
 * which is a different authorization check and leaves a different terminal state.
 */
export async function respondToFriendRequest(
  input: RespondToFriendRequestInput,
): Promise<RespondToFriendRequestResult> {
  const payload = respondToFriendRequestSchema.parse(input);
  return callFunction<RespondToFriendRequestInput, RespondToFriendRequestResult>(
    CALLABLE.respondToFriendRequest,
    payload,
  );
}

/** What `cancelFriendRequest` returns. */
export interface CancelFriendRequestResult {
  readonly requestId: string;
  readonly status: 'cancelled';
}

/**
 * Withdraw a request the caller sent and has not had an answer to.
 *
 * Leaves `cancelled` rather than `declined`, and the difference is load-bearing: a cancelled
 * request can be sent again, a declined one cannot. Withdrawing your own request must not cost
 * you the ability to ask again later.
 */
export async function cancelFriendRequest(
  input: CancelFriendRequestInput,
): Promise<CancelFriendRequestResult> {
  const payload = cancelFriendRequestSchema.parse(input);
  return callFunction<CancelFriendRequestInput, CancelFriendRequestResult>(
    CALLABLE.cancelFriendRequest,
    payload,
  );
}
