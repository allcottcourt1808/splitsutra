/**
 * What `createGroup` actually writes, and the shape of the `members` subscription.
 *
 * A shape test over the payload handed to `setDoc`, not a round trip. Everything asserted here
 * is something Security Rules or a threat model pins, or a product default that was decided
 * once and would be invisible if it drifted:
 *
 * - `memberIds` is exactly `[uid]` and `memberCount` is 1 (threat T4 — a client that could seed
 *   a wider member list could add itself to a stranger's group).
 * - `createdBy` is the signed-in uid, never an argument.
 * - `simplifyDebts` defaults to `true` (ADR-12). This is the one that most needs a test: it is a
 *   single word in a payload, it reads as an implementation detail, and reverting it would look
 *   like a tidy-up in review while silently changing what every new group does.
 *
 * The second half is the same kind of test over a query instead of a write. `watchMembers` pages
 * an unbounded subcollection (checklists/phase-10 §5b), and the ONLY thing that stops the page
 * from swallowing a current member is the `orderBy('leftAt','asc')` in front of the `limit()`.
 * That pairing is one line, reads as a formatting detail, and losing it silently deletes people
 * from the expense and settle-up pickers — so it is asserted rather than trusted to a comment.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_GROUP_MEMBERS, type GroupMember } from '../../types/index.js';

interface Written {
  readonly path: string;
  readonly data: Record<string, unknown>;
}

/** A recorded query constraint. The mocks below record instead of building anything. */
interface Constraint {
  readonly kind: string;
  readonly field?: string;
  readonly direction?: string;
  readonly count?: number;
}

interface Subscription {
  readonly source: { path: string };
  readonly constraints: readonly Constraint[];
  readonly onNext: (members: readonly GroupMember[]) => void;
}

const captured: { writes: Written[]; subscriptions: Subscription[] } = {
  writes: [],
  subscriptions: [],
};

vi.mock('firebase/firestore', () => ({
  doc: () => ({ id: 'new-group-id', path: 'groups/new-group-id' }),
  setDoc: (reference: { path: string }, data: Record<string, unknown>) => {
    captured.writes.push({ path: reference.path, data });
    return Promise.resolve();
  },
  updateDoc: () => Promise.resolve(),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  query: (source: unknown, ...constraints: Constraint[]) => ({ source, constraints }),
  where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
  orderBy: (field: string, direction = 'asc') => ({ kind: 'orderBy', field, direction }),
  limit: (count: number) => ({ kind: 'limit', count }),
}));

vi.mock('../refs.js', () => ({
  groupsCollection: () => ({ path: 'groups' }),
  groupDoc: (groupId: string) => ({ path: `groups/${groupId}` }),
  memberDoc: (groupId: string, uid: string) => ({ path: `groups/${groupId}/members/${uid}` }),
  membersCollection: (groupId: string) => ({ path: `groups/${groupId}/members` }),
}));

vi.mock('../callables.js', () => ({
  CALLABLE: {},
  callFunction: vi.fn(),
}));

vi.mock('../subscribe.js', () => ({
  watchDoc: () => () => undefined,
  watchQuery: (
    built: { source: { path: string }; constraints: Constraint[] },
    onNext: (members: readonly GroupMember[]) => void,
  ) => {
    captured.subscriptions.push({ ...built, onNext });
    return () => undefined;
  },
}));

const { MEMBERS_PAGE_SIZE, createGroup, watchActiveMembers, watchMembers } =
  await import('../groupRepo.js');

/** The single document `createGroup` writes. */
function payload(): Record<string, unknown> {
  expect(captured.writes).toHaveLength(1);
  return captured.writes[0]!.data;
}

/** The single query the subscription under test built. */
function subscription(): Subscription {
  expect(captured.subscriptions).toHaveLength(1);
  return captured.subscriptions[0]!;
}

/** Enough of a member document for the sort and the `leftAt` filter. */
function member(uid: string, displayName: string, leftAt: unknown = null): GroupMember {
  return {
    uid,
    role: 'member',
    displayName,
    photoURL: null,
    balanceMinor: 0,
    joinedAt: {},
    leftAt,
  } as unknown as GroupMember;
}

describe('createGroup', () => {
  beforeEach(() => {
    captured.writes = [];
    captured.subscriptions = [];
  });

  it('turns debt simplification on for a new group (ADR-12)', async () => {
    await createGroup('u_alice', { name: 'Goa Trip', type: 'trip' });
    expect(payload()['simplifyDebts']).toBe(true);
  });

  it('still lets a caller ask for it off', async () => {
    // The default is a default, not a policy — the create path has to stay able to say no, or
    // the group settings toggle is the only way to reach a state the app should be able to
    // create directly.
    await createGroup('u_alice', { name: 'Goa Trip', type: 'trip', simplifyDebts: false });
    expect(payload()['simplifyDebts']).toBe(false);
  });

  it('seeds exactly one member, the creator (threat T4)', async () => {
    await createGroup('u_alice', { name: 'Goa Trip', type: 'trip' });
    const data = payload();
    expect(data['memberIds']).toEqual(['u_alice']);
    expect(data['memberCount']).toBe(1);
    expect(data['createdBy']).toBe('u_alice');
  });

  it('writes the v2 forward fields explicitly rather than leaving them absent', async () => {
    // docs/03: a v1 document should be complete, so v2 is an additive change and never a
    // backfill over documents missing the key.
    await createGroup('u_alice', { name: 'Goa Trip', type: 'trip' });
    const data = payload();
    expect(data).toHaveProperty('baseCurrency', null);
    expect(data).toHaveProperty('allowMixedCurrency', null);
  });
});

describe('watchMembers', () => {
  beforeEach(() => {
    captured.writes = [];
    captured.subscriptions = [];
  });

  it('caps the page, so a churned group is a fixed read and not a growing one', () => {
    // The subcollection is a tombstone log: `leaveGroup`, `removeMember` and `deleteAccount`
    // all set `leftAt` and keep the document. Without a limit, a group that has churned
    // through 200 people re-delivers 200 documents on every single snapshot.
    watchMembers(
      'g1',
      () => undefined,
      () => undefined,
    );

    const { source, constraints } = subscription();
    expect(source.path).toBe('groups/g1/members');
    expect(constraints).toContainEqual({ kind: 'limit', count: MEMBERS_PAGE_SIZE });
  });

  it('🔴 orders by leftAt ascending, which is what makes the cap safe to have', () => {
    // Firestore sorts null before every other value and `leftAt` is null for exactly the
    // current members, so ascending order puts all of them at the front of the page. Any other
    // order — or none — and the row that falls off the end is eventually a current member, who
    // then cannot be named on an expense or a settlement. This assertion is the guarantee.
    watchMembers(
      'g1',
      () => undefined,
      () => undefined,
    );

    const { constraints } = subscription();
    expect(constraints[0]).toEqual({ kind: 'orderBy', field: 'leftAt', direction: 'asc' });
  });

  it('🔴 leaves room for every member a group can hold at once', () => {
    // `memberIds` is capped at MAX_GROUP_MEMBERS by the schema, by Rules and by both invite
    // Functions, so the page has to be at least that big for the guarantee above to hold.
    // Lowering the page size below it is the one edit that turns this from a cost fix into
    // data loss, and it would look like a harmless constant change in review.
    expect(MEMBERS_PAGE_SIZE).toBeGreaterThanOrEqual(MAX_GROUP_MEMBERS);
  });

  it('still emits current members first, then departed ones, each block by name', () => {
    // The server order is `leftAt`, which says nothing about names — the display order is the
    // client-side sort, and it has to survive the query gaining an ordering of its own.
    let emitted: readonly GroupMember[] = [];
    watchMembers(
      'g1',
      (next) => {
        emitted = next;
      },
      () => undefined,
    );

    subscription().onNext([
      member('u3', 'Zoya Khan'),
      member('u4', 'Bilal Ahmed', { seconds: 1 }),
      member('u1', 'anita rao'),
      member('u2', 'Aditya Menon', { seconds: 2 }),
    ]);

    expect(emitted.map((m) => m.uid)).toEqual(['u1', 'u3', 'u2', 'u4']);
  });
});

describe('watchActiveMembers', () => {
  beforeEach(() => {
    captured.writes = [];
    captured.subscriptions = [];
  });

  it('is a filter over the one members subscription, not a second query', () => {
    watchActiveMembers(
      'g1',
      () => undefined,
      () => undefined,
    );

    const { source, constraints } = subscription();
    expect(source.path).toBe('groups/g1/members');
    expect(constraints).toContainEqual({ kind: 'orderBy', field: 'leftAt', direction: 'asc' });
  });

  it('drops the departed, and is complete because they sort behind the page cut', () => {
    let emitted: readonly GroupMember[] = [];
    watchActiveMembers(
      'g1',
      (next) => {
        emitted = next;
      },
      () => undefined,
    );

    subscription().onNext([
      member('u1', 'Anita Rao'),
      member('u2', 'Bilal Ahmed', { seconds: 1 }),
      member('u3', 'Zoya Khan'),
    ]);

    expect(emitted.map((m) => m.uid)).toEqual(['u1', 'u3']);
  });
});
