/**
 * The friend-request queries — what they ask Firestore for, and what they refuse to ask for.
 *
 * These are shape tests over the constraints handed to `query()`, not round trips. That is the
 * right altitude for the one property worth pinning here: **a declined request must never be
 * fetched.** Being turned down is terminal and the product does not report it to the sender, and
 * the only way to make that true rather than merely unrendered is to leave the status out of the
 * query — so a screen cannot surface it later by accident, and a device never holds it at all.
 *
 * A test that rendered a screen and looked for absence would pass just as happily if the
 * document were fetched and then dropped in a component. This one fails if it is ever fetched.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Constraint {
  readonly type: string;
  readonly field?: string;
  readonly op?: string;
  readonly value?: unknown;
  readonly direction?: string;
  readonly count?: number;
}

interface BuiltQuery {
  readonly constraints: readonly Constraint[];
}

const captured: { query: BuiltQuery | null } = { query: null };

vi.mock('firebase/firestore', () => ({
  query: (_base: unknown, ...constraints: Constraint[]): BuiltQuery => ({ constraints }),
  where: (field: string, op: string, value: unknown): Constraint => ({
    type: 'where',
    field,
    op,
    value,
  }),
  orderBy: (field: string, direction: string): Constraint => ({
    type: 'orderBy',
    field,
    direction,
  }),
  limit: (count: number): Constraint => ({ type: 'limit', count }),
}));

vi.mock('../refs.js', () => ({
  friendRequestsCollection: () => ({ path: 'friendRequests' }),
}));

vi.mock('../callables.js', () => ({
  CALLABLE: {},
  callFunction: vi.fn(),
}));

vi.mock('../subscribe.js', () => ({
  watchQuery: (builtQuery: BuiltQuery) => {
    captured.query = builtQuery;
    return () => undefined;
  },
}));

const {
  WITHDRAWN_REQUEST_LIMIT,
  watchIncomingFriendRequests,
  watchOutgoingFriendRequests,
  watchWithdrawnFriendRequests,
} = await import('../friendRequestRepo.js');

const noop = (): void => undefined;

/** Every `where` in the query that was built, as `field op value` triples. */
function filters(): readonly Constraint[] {
  return (captured.query?.constraints ?? []).filter((c) => c.type === 'where');
}

/** Every status value the query asks for, however it asks. */
function statusValues(): readonly unknown[] {
  return filters()
    .filter((c) => c.field === 'status')
    .flatMap((c) => (Array.isArray(c.value) ? (c.value as unknown[]) : [c.value]));
}

function constraintOfType(type: string): Constraint | undefined {
  return (captured.query?.constraints ?? []).find((c) => c.type === type);
}

beforeEach(() => {
  captured.query = null;
});

describe('watchIncomingFriendRequests', () => {
  it('asks for pending requests addressed to the user, newest first', () => {
    watchIncomingFriendRequests('u1', noop, noop);

    expect(filters()).toEqual([
      { type: 'where', field: 'toUid', op: '==', value: 'u1' },
      { type: 'where', field: 'status', op: '==', value: 'pending' },
    ]);
    expect(constraintOfType('orderBy')).toEqual({
      type: 'orderBy',
      field: 'createdAt',
      direction: 'desc',
    });
  });
});

describe('watchOutgoingFriendRequests', () => {
  it('asks only for pending requests the user sent', () => {
    watchOutgoingFriendRequests('u1', noop, noop);

    expect(filters()).toEqual([
      { type: 'where', field: 'fromUid', op: '==', value: 'u1' },
      { type: 'where', field: 'status', op: '==', value: 'pending' },
    ]);
  });

  it('does not widen to withdrawn requests', () => {
    // 🔴 The Add Friend screen reads this to decide whether it is already waiting on an answer.
    // A `cancelled` request in here would have it report a withdrawn request as outstanding.
    watchOutgoingFriendRequests('u1', noop, noop);

    expect(statusValues()).toEqual(['pending']);
  });
});

describe('watchWithdrawnFriendRequests', () => {
  it('asks for cancelled requests the user sent, newest first', () => {
    watchWithdrawnFriendRequests('u1', noop, noop);

    expect(filters()).toEqual([
      { type: 'where', field: 'fromUid', op: '==', value: 'u1' },
      { type: 'where', field: 'status', op: '==', value: 'cancelled' },
    ]);
    expect(constraintOfType('orderBy')).toEqual({
      type: 'orderBy',
      field: 'createdAt',
      direction: 'desc',
    });
  });

  it('🔴 never asks for a declined request', () => {
    // The whole point. Withdrawing is the user's own act and is theirs to see; being declined is
    // somebody else's answer and is deliberately never reported back. Excluded at the query, so
    // the document does not reach the device and no component can leak it.
    watchWithdrawnFriendRequests('u1', noop, noop);

    expect(statusValues()).not.toContain('declined');
    expect(statusValues()).toEqual(['cancelled']);
  });

  it('is capped, because withdrawals accumulate', () => {
    // `cancelFriendRequest` leaves the document behind, so this is the one outbox query whose
    // result set only ever grows.
    watchWithdrawnFriendRequests('u1', noop, noop);

    expect(constraintOfType('limit')).toEqual({ type: 'limit', count: WITHDRAWN_REQUEST_LIMIT });
  });

  it('leaves the other queries uncapped, so a cap cannot starve them', () => {
    watchOutgoingFriendRequests('u1', noop, noop);
    expect(constraintOfType('limit')).toBeUndefined();

    watchIncomingFriendRequests('u1', noop, noop);
    expect(constraintOfType('limit')).toBeUndefined();
  });
});
