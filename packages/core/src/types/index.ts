/**
 * `@splitsutra/core` types barrel — every schema, inferred type, and Firestore converter.
 *
 * One Zod schema per entity in docs/03-data-model.md is the **single source of truth** for that
 * entity's shape: the client, the Cloud Functions, and the tests all parse through the same
 * definition, and every exported TypeScript type is `z.infer`red from it. There is no
 * hand-written interface anywhere in this folder that mirrors a schema — a parallel interface is
 * a second source of truth, and the two always drift.
 *
 * Re-exported wholesale from the package root barrel (`packages/core/src/index.ts`), and
 * available on its own as `@splitsutra/core/types`.
 *
 * 🔴 **`domain/**` must not import this barrel.** `./primitives` and `./converters` carry
 * `import type` edges to `firebase/firestore`, and `./primitives` pulls in Zod at runtime; the
 * domain layer stays pure by importing the leaf modules it actually needs — `../types/money`,
 * `../types/currency` — both of which are deliberately dependency-free (Articles VI and VII).
 *
 * Modules are re-exported with `export *` rather than named lists so the barrel cannot silently
 * fall behind a schema file that grows a new export.
 */

/* ── Foundations: zero-dependency, safe for `domain/**` to import directly ────────────────── */

/** Branded `MinorUnits`, `MAX_AMOUNT_MINOR`, `toMinorUnits`, `isValidAmount` — Article I. */
export * from './money.js';

/** `CurrencyCode`, the hardcoded ISO 4217 `CURRENCIES` table, `getExponent` — never `Intl`. */
export * from './currency.js';

/* ── Shared schema building blocks ────────────────────────────────────────────────────────── */

/** `timestampSchema`, `uidSchema`, the minor-unit schemas, `MAX_GROUP_MEMBERS`, `sumMinor`. */
export * from './primitives.js';

/* ── Entities, in the order they appear in docs/03-data-model.md ──────────────────────────── */

/** `users/{uid}` and the public projection in `usernames/{normalizedKey}`. */
export * from './user.js';

/** `users/{uid}/friends/{friendUid}`. */
export * from './friend.js';

/** `friendRequests/{requestId}` — the consent step in front of a friendship. */
export * from './friendRequest.js';

/** `groups/{groupId}` and `groups/{groupId}/members/{uid}`. */
export * from './group.js';

/** `groups/{groupId}/expenses/{expenseId}`, plus its `Payer` and `Split` members. */
export * from './expense.js';

/** `groups/{groupId}/settlements/{settlementId}`. */
export * from './settlement.js';

/** `groups/{groupId}/expenses/{expenseId}/comments/{commentId}`. */
export * from './callables.js';
export * from './comment.js';

/** `groups/{groupId}/activity/{activityId}`. */
export * from './activity.js';

/** `invites/{inviteId}`. */
export * from './invite.js';

/* ── The Firestore read boundary ──────────────────────────────────────────────────────────── */

/** `withConverter` converters that parse every read, and the `DocumentParseError` they throw. */
export * from './converters.js';
