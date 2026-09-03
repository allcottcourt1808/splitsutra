/**
 * The callable Cloud Functions seam.
 *
 * Anything a client is not allowed to write directly — joining a group, leaving one, removing
 * a member, answering a friend request, repairing balances — is a callable, because each of those
 * has a precondition that only the server can check atomically (Article III/IV). Rules deny
 * the direct write; this module is the door that is actually open.
 *
 * ## The payload is validated twice, on purpose
 *
 * Each wrapper parses its input with the **same Zod schema the Function parses it with**
 * (`types/callables.ts`). The client-side parse exists to save a round trip and to produce a
 * message that names the field; the server-side parse is the one that is load-bearing. Article
 * IV: client validation is UX, never a security control.
 *
 * ## Errors
 *
 * A Function throwing `HttpsError` arrives here as a `FirebaseError` whose `code` is
 * `functions/<status>` and whose `message` is the string the Function chose. Those messages are
 * written to be shown to a user — `leaveGroup` returns the outstanding amount so the UI can say
 * "settle $X first" — so they are deliberately passed through untouched rather than replaced
 * with a generic apology.
 *
 * 🔴 **With one subtraction: the SDK appends the HTTP status.** `firebase/functions` builds
 * `message` as `"<what the Function said> [<http status>]"`, so a user reading a carefully
 * written sentence also read `[400]` on the end of it. Screens are not at fault for showing it —
 * passing the message through is the correct thing for them to do — so it is removed here, at
 * the one place every callable error passes through, rather than in each screen that displays
 * one. Nothing is lost: `code` (`functions/failed-precondition`) survives untouched and says
 * more than the number did.
 *
 * @see docs/06-cloud-functions.md — the inventory and each function's contract
 * @see firebase/functions/src/index.ts — the deployed names
 */

import { httpsCallable } from 'firebase/functions';

import { getFunctionsClient } from '../firebase/index.js';

/**
 * The deployed function names.
 *
 * 🔴 **The export name in `firebase/functions/src/index.ts` IS the deployed name.** A rename
 * there is a delete-plus-create, not a refactor, and this table is the client half of that
 * contract — they change together or the call 404s at runtime with `functions/not-found`.
 */
export const CALLABLE = {
  addFriendToGroup: 'addFriendToGroup',
  cancelFriendRequest: 'cancelFriendRequest',
  createInvite: 'createInvite',
  deleteAccount: 'deleteAccount',
  deleteGroup: 'deleteGroup',
  leaveGroup: 'leaveGroup',
  recomputeGroupBalances: 'recomputeGroupBalances',
  redeemInvite: 'redeemInvite',
  removeMember: 'removeMember',
  repairGroupMembership: 'repairGroupMembership',
  respondToFriendRequest: 'respondToFriendRequest',
  sendFriendRequest: 'sendFriendRequest',
  undoDeclineFriendRequest: 'undoDeclineFriendRequest',
} as const;

/** One of the deployed callable names. */
export type CallableName = (typeof CALLABLE)[keyof typeof CALLABLE];

/**
 * Invoke a callable and unwrap `result.data`.
 *
 * Deliberately not generic over a response *schema*: a callable's response is produced by our
 * own Function against a shape we control, so parsing it again would be validating our own
 * output. Documents are different — those can be written by an older client, a migration, or a
 * bug, which is why every *document* read goes through a converter.
 */
/**
 * The ` [404]` the Functions SDK appends to every callable error message.
 *
 * Anchored to the end and requiring the whole bracket, so a message that merely *contains* a
 * bracketed number keeps it. The digit count is not pinned: a Cloud Run rejection that never
 * reached the Function arrives as `internal [0]`, which is the same noise from the same source.
 */
const STATUS_SUFFIX = /\s\[\d+\]$/;

/**
 * The message a user should see, given what the SDK produced.
 *
 * Exported for its tests. Pure, and total: a message without the suffix comes back unchanged.
 */
export function withoutStatusSuffix(message: string): string {
  return message.replace(STATUS_SUFFIX, '');
}

export async function callFunction<Request, Response>(
  name: CallableName,
  payload: Request,
): Promise<Response> {
  const fn = httpsCallable<Request, Response>(getFunctionsClient(), name);
  try {
    const result = await fn(payload);
    return result.data;
  } catch (cause: unknown) {
    // Trimmed in place and rethrown, rather than wrapped in a new Error. Callers read `code`
    // off this object — AddFriendScreen singles out `functions/not-found` to offer an invite —
    // and a wrapper would have to copy every field it might ever be asked for. Narrowing the
    // error at the exact moment it is being made *more* readable would be the wrong trade.
    if (cause instanceof Error) {
      cause.message = withoutStatusSuffix(cause.message);
    }
    throw cause;
  }
}
