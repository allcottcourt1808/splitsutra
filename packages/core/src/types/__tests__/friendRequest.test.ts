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

import {
  UNDO_DECLINE_WINDOW_MS,
  declineUndoState,
  friendRequestId,
  friendRequestSchema,
  isPending,
} from '../friendRequest.js';

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

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * declineUndoState — the one part of undoDeclineFriendRequest that computes
 *
 * Cloud Functions have no test harness in this repository, so the timing rule was pulled into
 * core to be testable at its boundary, which is where an off-by-one would live. What is NOT
 * here, and cannot be: the caller being `toUid`. That is the load-bearing half of the check and
 * it is enforced against the stored document inside the Function.
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('declineUndoState', () => {
  const NOW = Date.UTC(2026, 7, 31, 12);

  it('allows an undo immediately after the decline', () => {
    expect(declineUndoState('declined', NOW, NOW)).toBe('undoable');
  });

  it('allows one exactly at the edge of the window, and refuses one millisecond past it', () => {
    // The boundary is the whole reason this is a function and not an inline comparison.
    expect(declineUndoState('declined', NOW - UNDO_DECLINE_WINDOW_MS, NOW)).toBe('undoable');
    expect(declineUndoState('declined', NOW - UNDO_DECLINE_WINDOW_MS - 1, NOW)).toBe(
      'window-passed',
    );
  });

  it('refuses a decline from long ago', () => {
    expect(declineUndoState('declined', NOW - 7 * 24 * 60 * 60 * 1000, NOW)).toBe('window-passed');
  });

  it('reports every other status as not-declined, so nothing else can be undone this way', () => {
    for (const status of ['pending', 'accepted', 'cancelled'] as const) {
      expect(declineUndoState(status, NOW, NOW)).toBe('not-declined');
    }
  });

  it('🔴 treats a declined request with no respondedAt as too old, never as just now', () => {
    // Unreachable for a well-formed document — the refine above guarantees the timestamp. If a
    // malformed one ever existed, reading `null` as "no time has passed" would turn it into an
    // undo that never expires.
    expect(declineUndoState('declined', null, NOW)).toBe('window-passed');
  });

  it('is bounded in minutes, not hours — an accident is noticed immediately', () => {
    expect(UNDO_DECLINE_WINDOW_MS).toBeGreaterThan(60_000);
    expect(UNDO_DECLINE_WINDOW_MS).toBeLessThanOrEqual(30 * 60_000);
  });
});
