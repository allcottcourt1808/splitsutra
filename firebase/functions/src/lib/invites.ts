import { randomBytes } from 'node:crypto';

import { Timestamp } from '../common/admin.js';

/**
 * Invite tokens. docs/03 §"invites", checklists/phase-05 §8.
 *
 * ⚠️ `INVITE_TTL_DAYS` also exists in `@splitsutra/core` (`types/invite.ts`), which is
 *    where the Zod schema derives `expiresAt = createdAt + 14 days`. It is not
 *    re-exported through `common/contracts.ts` — the seam file that lists every
 *    borrowed core symbol — so it is mirrored here rather than imported through a
 *    second, undocumented path. This is not money math, so Article VI is not in
 *    play, but the two values must move together: add it to the contracts
 *    re-export list next time that file is revised and delete this constant.
 */
export const INVITE_TTL_DAYS = 14;

/**
 * 128 bits of randomness, lowercase hex — exactly what `inviteSchema` in
 * `@splitsutra/core` requires (`/^[0-9a-f]{32}$/`).
 *
 * 🔴 `crypto.randomBytes`, never `Math.random()`. The token IS the authorization to
 *    join a group: `invites/{id}` is unreadable to every client (rules deny read
 *    outright), so possession of the token is the entire access-control decision
 *    that `redeemInvite` makes. A predictable token means anyone can join any
 *    group, which is T4 by the front door.
 *
 *    128 bits is also why `redeemInvite` needs no brute-force rate limit: guessing
 *    is not a threat model at that width.
 */
export function mintInviteToken(): string {
  return randomBytes(16).toString('hex');
}

/** `createdAt + 14 days`, as a Firestore timestamp. */
export function inviteExpiry(now: number = Date.now()): Timestamp {
  return Timestamp.fromMillis(now + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}
