/**
 * `friendRequests/{requestId}` — a proposed friendship, awaiting the recipient's answer.
 *
 * Written by Cloud Functions only. Both parties can read it; nobody can write it directly,
 * because accepting one creates a group and two `friends` documents that carry `balanceMinor`
 * (Article III, threat T2).
 *
 * ## Why this collection exists at all
 *
 * Adding a friend used to be unilateral: `addFriend` resolved a contact and immediately created
 * the implicit group and both friend documents. That is what AC-B1.4 and AC-B1.5 described, and
 * it meant anyone who knew your email could put themselves in your friends list — and, because a
 * friendship IS a group (D2), in a shared group with you — without you ever agreeing to it.
 * Consent now sits between the lookup and the write.
 *
 * ## The document ID is derived, not random
 *
 * `requestId = ${fromUid}__${toUid}` (see {@link friendRequestId}). Two consequences, both
 * deliberate:
 *
 * - **A duplicate request is impossible by construction.** No query, no transaction, no
 *   uniqueness constraint to maintain — the second send lands on the same document as the first.
 * - **"Have I already asked?" and "have they asked me?" are both a `get`.** The reciprocal
 *   lookup that makes mutual requests auto-accept is one read of a known path rather than a
 *   query, so it costs nothing and cannot race.
 *
 * The cost is that the pair keeps only its latest state rather than a history of every request
 * ever sent between them. That is the right trade here: this is a consent record, not a ledger,
 * and nothing in the product asks how many times someone was declined.
 *
 * ## Both names are denormalized, not one
 *
 * `firestore.rules` allows a `users/{uid}` read only where `isSelf(uid)`, so neither party can
 * read the other's profile. An inbox row that had only `fromUid` would be a request from nobody.
 * Both sides are therefore snapshotted at send time, the same way group members and friend
 * documents carry their counterpart's name (D4).
 *
 * @see docs/03-data-model.md
 * @see docs/06-cloud-functions.md §sendFriendRequest
 */

import { z } from 'zod';

import { displayNameSchema, photoUrlSchema, timestampSchema, uidSchema } from './primitives.js';

/**
 * The lifecycle.
 *
 * `pending` is the only non-terminal state; the other three are final for that pair-direction.
 * There is no `expired`: an invite expires because it is a bearer token that leaks (D — see
 * `invite.ts`), whereas a request is addressed to one person and is only worth what they decide.
 */
export const FRIEND_REQUEST_STATUSES = ['pending', 'accepted', 'declined', 'cancelled'] as const;

/**
 * How long a decline can be taken back, measured from `respondedAt`.
 *
 * An undo exists because Decline sits next to Accept and a thumb is not a decision. It is
 * **bounded** because an accident is discovered immediately: a minute later it is a mistake, a
 * week later it is a change of mind, and a change of mind should mean asking the person again
 * rather than silently reviving a request they were never told had died.
 *
 * 🔴 Enforced by `undoDeclineFriendRequest` against **server** time, and only for `toUid` — the
 * person who did the declining. This constant is shared with the client so the button can stop
 * being offered at the same moment it stops working; the client copy is UX, the server copy is
 * the rule (Article IV).
 */
export const UNDO_DECLINE_WINDOW_MS = 10 * 60 * 1000;
export const friendRequestStatusSchema = z.enum(FRIEND_REQUEST_STATUSES);
export type FriendRequestStatus = z.infer<typeof friendRequestStatusSchema>;

/** Separator for {@link friendRequestId}. Two underscores: a Firebase UID cannot contain one. */
const ID_SEPARATOR = '__';

/**
 * The deterministic document ID for a request from `fromUid` to `toUid`.
 *
 * **Direction matters.** `friendRequestId(a, b)` and `friendRequestId(b, a)` are different
 * documents, which is what lets both people have an outstanding request at once — the state the
 * mutual auto-accept in `sendFriendRequest` exists to collapse.
 */
export function friendRequestId(fromUid: string, toUid: string): string {
  return `${fromUid}${ID_SEPARATOR}${toUid}`;
}

/** The unrefined object shape. Exported so partial-update payloads can reuse `.shape`. */
export const friendRequestBaseSchema = z.object({
  /** Equals the document ID — `${fromUid}__${toUid}`. */
  id: z.string().min(3).max(300),

  /** Who asked. */
  fromUid: uidSchema,
  /** Snapshot at send time, so the recipient's inbox renders without reading `users/{fromUid}`. */
  fromName: displayNameSchema,
  fromPhotoURL: photoUrlSchema,

  /** Who was asked. */
  toUid: uidSchema,
  /** Snapshot at send time, so the sender's outbox renders without reading `users/{toUid}`. */
  toName: displayNameSchema,
  toPhotoURL: photoUrlSchema,

  status: friendRequestStatusSchema,

  /**
   * The implicit group the acceptance created (D2), or `null` while the request is unanswered.
   *
   * Stored so an accepted request can link straight to the shared group without a second
   * lookup, and so the accept path is verifiably idempotent: a retried acceptance finds this
   * already set and returns it rather than minting a second group for the same pair.
   */
  implicitGroupId: z.string().min(1).max(1500).nullable(),

  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  /** When the status left `pending`. `null` exactly while it is still `pending`. */
  respondedAt: timestampSchema.nullable(),
});

export const friendRequestSchema = friendRequestBaseSchema
  .refine((r) => r.fromUid !== r.toUid, {
    message: 'A friend request cannot be addressed to its own sender',
    path: ['toUid'],
  })
  .refine((r) => (r.status === 'pending') === (r.respondedAt === null), {
    message: 'respondedAt must be null while pending, and set once it is not',
    path: ['respondedAt'],
  })
  .refine((r) => r.status !== 'accepted' || r.implicitGroupId !== null, {
    message: 'An accepted request must record the group it created',
    path: ['implicitGroupId'],
  });

export type FriendRequest = z.infer<typeof friendRequestSchema>;

/** `true` while the request is still awaiting an answer. */
export function isPending(request: FriendRequest): boolean {
  return request.status === 'pending';
}

/** Why a decline can or cannot be taken back. */
export type DeclineUndoState = 'undoable' | 'not-declined' | 'window-passed';

/**
 * Whether `undoDeclineFriendRequest` will accept this document, and if not, why.
 *
 * Pure and in `core` so the one part of that Function which actually *computes* something can
 * be tested — the rest of it is auth, a transaction and a write, and this repository has no
 * harness for those. The boundary is where the off-by-one lives, so the boundary is what has
 * tests.
 *
 * Takes milliseconds rather than a `Timestamp` on purpose: the client and the Admin SDK have
 * different `Timestamp` classes, and a shared rule that only one of them can call is not
 * shared. The caller unwraps.
 *
 * 🔴 This decides *timing only*. It knows nothing about **who** is calling, and the caller
 * being `toUid` is the load-bearing half of the check — enforced in the Function against the
 * stored document, never here and never on the client.
 *
 * @param respondedAtMillis when the status left `pending`, or `null` if it has not.
 */
export function declineUndoState(
  status: FriendRequestStatus,
  respondedAtMillis: number | null,
  now: number = Date.now(),
): DeclineUndoState {
  if (status !== 'declined') return 'not-declined';
  // A declined request always carries `respondedAt` — the schema refine below enforces it. A
  // document that somehow lacks one is treated as too old rather than as "just now", so a
  // malformed write cannot become an unbounded undo.
  if (respondedAtMillis === null) return 'window-passed';
  return now - respondedAtMillis <= UNDO_DECLINE_WINDOW_MS ? 'undoable' : 'window-passed';
}
