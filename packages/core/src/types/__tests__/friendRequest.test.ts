/**
 * `friendRequestSchema` — the state machine invariants.
 *
 * These are the rules a Cloud Function has to get right on every write and that no other layer
 * re-checks: Security Rules deny all client writes to this collection, so nothing else is
 * looking. They are asserted against the schema because the schema is what every *read* goes
 * through — a Function that writes a contradictory document is caught at the read boundary as a
 * `DocumentParseError` naming the field, which is exactly where a bug like this should surface.
 *
 * The rules under test, and why each one exists:
 *
 * - **`respondedAt` is null exactly while pending.** Not "null when pending" — the biconditional.
 *   A `declined` document with a null `respondedAt` looks pending to anything that sorts by it,
 *   and a `pending` one with a timestamp looks answered.
 * - **An accepted request records its group.** Acceptance creates the implicit group (D2); a
 *   document that says `accepted` with no `implicitGroupId` is a friendship whose group nothing
 *   can find.
 * - **Sender and recipient differ.** AC-B1.6, restated at the storage layer so a bug in the
 *   callable cannot persist a self-request.
 */

import { describe, expect, it } from 'vitest';

import { friendRequestId, friendRequestSchema, isPending } from '../friendRequest.js';

/** A stand-in `Timestamp`. `timestampSchema` accepts anything `Timestamp`-like. */
const ts = { seconds: 1_700_000_000, nanoseconds: 0, toDate: () => new Date(), toMillis: () => 0 };

const FROM = 'uid-sender';
const TO = 'uid-recipient';

/** A valid `pending` document. Every case below is this with one thing changed. */
function pending(overrides: Record<string, unknown> = {}) {
  return {
    id: friendRequestId(FROM, TO),
    fromUid: FROM,
    fromName: 'Neethu',
    fromPhotoURL: null,
    toUid: TO,
    toName: 'Sandeep',
    toPhotoURL: null,
    status: 'pending',
    implicitGroupId: null,
    createdAt: ts,
    updatedAt: ts,
    respondedAt: null,
    ...overrides,
  };
}

describe('friendRequestId', () => {
  it('is direction-sensitive, so both people can have an outstanding request at once', () => {
    expect(friendRequestId(FROM, TO)).not.toBe(friendRequestId(TO, FROM));
  });

  it('is deterministic, which is what makes a duplicate request impossible', () => {
    expect(friendRequestId(FROM, TO)).toBe(friendRequestId(FROM, TO));
  });
});

describe('friendRequestSchema', () => {
  it('accepts a pending request', () => {
    const parsed = friendRequestSchema.parse(pending());
    expect(parsed.status).toBe('pending');
    expect(isPending(parsed)).toBe(true);
  });

  it('accepts an accepted request that records its group', () => {
    const parsed = friendRequestSchema.parse(
      pending({ status: 'accepted', implicitGroupId: 'group-1', respondedAt: ts }),
    );
    expect(parsed.implicitGroupId).toBe('group-1');
    expect(isPending(parsed)).toBe(false);
  });

  it.each(['declined', 'cancelled'] as const)(
    'accepts a %s request with no group — nothing was created',
    (status) => {
      const parsed = friendRequestSchema.parse(
        pending({ status, implicitGroupId: null, respondedAt: ts }),
      );
      expect(parsed.implicitGroupId).toBeNull();
    },
  );

  it('rejects a pending request that claims it was answered', () => {
    expect(() => friendRequestSchema.parse(pending({ respondedAt: ts }))).toThrow(/respondedAt/);
  });

  it.each(['accepted', 'declined', 'cancelled'] as const)(
    'rejects a %s request with no respondedAt',
    (status) => {
      const doc = pending({ status, respondedAt: null, implicitGroupId: 'group-1' });
      expect(() => friendRequestSchema.parse(doc)).toThrow(/respondedAt/);
    },
  );

  it('rejects an accepted request with no group — the friendship would be unreachable', () => {
    const doc = pending({ status: 'accepted', implicitGroupId: null, respondedAt: ts });
    expect(() => friendRequestSchema.parse(doc)).toThrow(/implicitGroupId/);
  });

  it('rejects a request addressed to its own sender (AC-B1.6)', () => {
    expect(() => friendRequestSchema.parse(pending({ toUid: FROM }))).toThrow(/toUid/);
  });

  it('rejects a status outside the four the state machine defines', () => {
    expect(() => friendRequestSchema.parse(pending({ status: 'expired' }))).toThrow();
  });
});
