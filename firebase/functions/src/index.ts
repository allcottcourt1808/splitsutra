/**
 * Cloud Functions entry point. `package.json` points `main` at the build of this file, and
 * the deployer reads it to discover what to deploy — anything not re-exported here does not
 * exist as far as Firebase is concerned.
 *
 * That was the state until now: all twelve implementations below were written, none were
 * exported, so the emulator reported "Failed to load function definition" and a deploy would
 * have shipped an empty codebase without failing.
 *
 * ## The export name IS the deployed function name
 *
 * Renaming one of these is not a refactor. Firebase matches deployed functions to source by
 * export name, so a rename is a delete plus a create: the old function is torn down and a new
 * one built, which drops its Firestore trigger registration and any in-flight retries with it.
 * Rename only deliberately, and expect to redeploy triggers.
 *
 * ## Imports carry .js — see tsconfig.json
 *
 * This package compiles under NodeNext and emits real ESM that Node loads at runtime.
 * Extensionless specifiers compile fine and then fail on the deployed instance with
 * ERR_MODULE_NOT_FOUND, so the extension is required rather than stylistic.
 *
 * ## The full inventory is now implemented
 *
 * Every callable `packages/core` defines an input schema for now has a real implementation.
 * `addFriend`, `deleteGroup`, `recomputeGroupBalances` and `deleteAccount` were previously
 * absent rather than stubbed, on the reasoning that an exported stub is a deployed, callable
 * endpoint that silently does nothing — worse than a missing one that fails loudly at the
 * client. That reasoning still stands and applies to anything added here later: export it when
 * it works, not before. See docs/06-cloud-functions.md for the inventory.
 *
 * Several of these are destructive or privacy-sensitive, and each carries its authorization
 * rule in its own header — `deleteGroup` (admin, and every balance zero), `deleteAccount`
 * (self, and every balance zero, in every group), `sendFriendRequest` (resolves only through
 * the hashed `usernames/` index) and `recomputeGroupBalances` (active member; rebuilds from
 * the ledger, never from the cache).
 *
 * ## `addFriend` was replaced, not renamed
 *
 * 🔴 It is gone from this file, and by the rule above that is a **teardown**: the deployed
 * `addFriend` is deleted on the next deploy rather than upgraded in place. That is correct —
 * its contract changed, not its name. A client calling the old name now gets
 * `functions/not-found` instead of silently creating a friendship nobody agreed to, which is
 * the failure mode to prefer. Nothing has been deployed from this repository yet, so no live
 * caller is affected; once that stops being true, ship the client and the functions together.
 *
 * In its place: `sendFriendRequest` (the lookup half) and `respondToFriendRequest` (the write
 * half, behind the consent of whoever was asked), plus `cancelFriendRequest` for the sender.
 */

/* ── Callables: client-invoked, auth-checked in each function's own preamble ─────────── */
export { cancelFriendRequest } from './callable/cancelFriendRequest.js';
export { createInvite } from './callable/createInvite.js';
export { deleteAccount } from './callable/deleteAccount.js';
export { deleteGroup } from './callable/deleteGroup.js';
export { leaveGroup } from './callable/leaveGroup.js';
export { recomputeGroupBalances } from './callable/recomputeGroupBalances.js';
export { redeemInvite } from './callable/redeemInvite.js';
export { removeMember } from './callable/removeMember.js';
export { repairGroupMembership } from './callable/repairGroupMembership.js';
export { respondToFriendRequest } from './callable/respondToFriendRequest.js';
export { sendFriendRequest } from './callable/sendFriendRequest.js';

/* ── Triggers: Firestore-driven. Article V — recompute is idempotent, so a retried ─────
 *    delivery cannot double-count. */
export { onExpenseWritten } from './triggers/onExpenseWritten.js';
export { onGroupCreated } from './triggers/onGroupCreated.js';
export { onSettlementWritten } from './triggers/onSettlementWritten.js';
export { onUserProfileWritten } from './triggers/onUserProfileWritten.js';
