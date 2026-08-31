/**
 * `invites/{inviteId}` — the reusable link.
 *
 * Two things are worth holding in place here. One is the redeemability rule, because it is the
 * whole access-control decision `redeemInvite` makes on a token that is otherwise unreadable.
 * The other is **backward decode**: invites written before the link became reusable are still in
 * the database, and a schema that cannot read them turns old documents into crashes rather than
 * into dead links.
 */

import { describe, expect, it } from 'vitest';

import { INVITE_STATUSES, inviteSchema, isInviteRedeemable, type Invite } from '../invite.js';

/** A Firestore `Timestamp` stand-in with the method the schema and helper actually call. */
function ts(millis: number): Invite['expiresAt'] {
  return {
    toMillis: () => millis,
    toDate: () => new Date(millis),
    seconds: Math.floor(millis / 1000),
    nanoseconds: 0,
  } as unknown as Invite['expiresAt'];
}

const NOW = Date.UTC(2026, 7, 30, 12);
const TOKEN = 'a'.repeat(32);

/** What `createInvite` writes today. */
function stored(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'inv1',
    token: TOKEN,
    groupId: 'g1',
    groupName: 'Goa Trip',
    createdBy: 'u1',
    createdByName: 'Priya Sharma',
    status: 'pending',
    redeemedBy: [],
    acceptedBy: null,
    expiresAt: ts(NOW + 86_400_000),
    createdAt: ts(NOW),
    ...overrides,
  };
}

describe('isInviteRedeemable', () => {
  it('is true for a pending link that has not expired', () => {
    expect(isInviteRedeemable({ status: 'pending', expiresAt: ts(NOW + 1000) }, NOW)).toBe(true);
  });

  it('stays true no matter how many people have already used it', () => {
    // The point of the change: redemption does not consume the link.
    const invite = { status: 'pending', expiresAt: ts(NOW + 1000) } as const;

    expect(isInviteRedeemable(invite, NOW)).toBe(true);
    expect(isInviteRedeemable(invite, NOW)).toBe(true);
  });

  it('is false once expired, on the boundary as well as past it', () => {
    expect(isInviteRedeemable({ status: 'pending', expiresAt: ts(NOW) }, NOW)).toBe(false);
    expect(isInviteRedeemable({ status: 'pending', expiresAt: ts(NOW - 1) }, NOW)).toBe(false);
  });

  it('is false for every status except pending', () => {
    for (const status of INVITE_STATUSES) {
      const redeemable = isInviteRedeemable({ status, expiresAt: ts(NOW + 1000) }, NOW);
      expect(redeemable).toBe(status === 'pending');
    }
  });

  it('treats a legacy accepted invite as dead', () => {
    // A link spent under the old single-use rule does not come back to life because the rules
    // around it changed.
    expect(isInviteRedeemable({ status: 'accepted', expiresAt: ts(NOW + 1000) }, NOW)).toBe(false);
  });
});

describe('inviteSchema', () => {
  it('accepts what createInvite writes', () => {
    const parsed = inviteSchema.parse(stored());

    expect(parsed.status).toBe('pending');
    expect(parsed.redeemedBy).toEqual([]);
  });

  it('accepts a link several people have walked through', () => {
    const parsed = inviteSchema.parse(stored({ redeemedBy: ['u2', 'u3', 'u4'] }));

    expect(parsed.redeemedBy).toEqual(['u2', 'u3', 'u4']);
    // 🔴 Still pending. A used link is not a spent one.
    expect(parsed.status).toBe('pending');
  });

  it('decodes an invite written before redeemedBy existed', () => {
    const legacy = stored({ status: 'accepted', acceptedBy: 'u2' });
    delete legacy['redeemedBy'];

    const parsed = inviteSchema.parse(legacy);

    expect(parsed.acceptedBy).toBe('u2');
    expect(parsed.redeemedBy).toEqual([]);
  });

  it('rejects more redeemers than a group can hold', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `u${String(i)}`);

    expect(() => inviteSchema.parse(stored({ redeemedBy: tooMany }))).toThrow();
  });

  it('still requires a legacy accepted invite to name who accepted it', () => {
    expect(() => inviteSchema.parse(stored({ status: 'accepted', acceptedBy: null }))).toThrow();
  });

  it('rejects a token that is not 128 bits of lowercase hex', () => {
    expect(() => inviteSchema.parse(stored({ token: 'A'.repeat(32) }))).toThrow();
    expect(() => inviteSchema.parse(stored({ token: 'a'.repeat(31) }))).toThrow();
    expect(() => inviteSchema.parse(stored({ token: 'z'.repeat(32) }))).toThrow();
  });
});
