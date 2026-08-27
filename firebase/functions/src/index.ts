/**
 * Cloud Functions entry point. `package.json` points `main` at the build of this file, and
 * the deployer reads it to discover what to deploy — anything not re-exported here does not
 * exist as far as Firebase is concerned.
 *
 * That was the state until now: all eight implementations below were written, none were
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
 * ## Not yet implemented
 *
 * `packages/core` defines input schemas for four more callables that have no implementation
 * yet — `addFriend`, `deleteGroup`, `recomputeGroupBalances` and `deleteAccount`. They are
 * deliberately absent rather than stubbed: an exported stub is a deployed, callable endpoint
 * that silently does nothing, which is worse than a missing one that fails loudly at the
 * client. See docs/06-cloud-functions.md for the full inventory.
 */

/* ── Callables: client-invoked, auth-checked in each function's own preamble ─────────── */
export { createInvite } from './callable/createInvite.js';
export { leaveGroup } from './callable/leaveGroup.js';
export { redeemInvite } from './callable/redeemInvite.js';
export { removeMember } from './callable/removeMember.js';

/* ── Triggers: Firestore-driven. Article V — recompute is idempotent, so a retried ─────
 *    delivery cannot double-count. */
export { onExpenseWritten } from './triggers/onExpenseWritten.js';
export { onGroupCreated } from './triggers/onGroupCreated.js';
export { onSettlementWritten } from './triggers/onSettlementWritten.js';
export { onUserProfileWritten } from './triggers/onUserProfileWritten.js';
