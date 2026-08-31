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
export async function callFunction<Request, Response>(
  name: CallableName,
  payload: Request,
): Promise<Response> {
  const fn = httpsCallable<Request, Response>(getFunctionsClient(), name);
  const result = await fn(payload);
  return result.data;
}
