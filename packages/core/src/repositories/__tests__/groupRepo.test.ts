/**
 * What `createGroup` actually writes — the fields no caller chooses.
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
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Written {
  readonly path: string;
  readonly data: Record<string, unknown>;
}

const captured: { writes: Written[] } = { writes: [] };

vi.mock('firebase/firestore', () => ({
  doc: () => ({ id: 'new-group-id', path: 'groups/new-group-id' }),
  setDoc: (reference: { path: string }, data: Record<string, unknown>) => {
    captured.writes.push({ path: reference.path, data });
    return Promise.resolve();
  },
  updateDoc: () => Promise.resolve(),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  query: (...args: unknown[]) => ({ args }),
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
}));

vi.mock('../refs.js', () => ({
  groupsCollection: () => ({ path: 'groups' }),
  groupDoc: (groupId: string) => ({ path: `groups/${groupId}` }),
  memberDoc: (groupId: string, uid: string) => ({ path: `groups/${groupId}/members/${uid}` }),
}));

vi.mock('../callables.js', () => ({
  CALLABLE: {},
  callFunction: vi.fn(),
}));

vi.mock('../subscribe.js', () => ({
  watchDoc: () => () => undefined,
  watchQuery: () => () => undefined,
}));

const { createGroup } = await import('../groupRepo.js');

/** The single document `createGroup` writes. */
function payload(): Record<string, unknown> {
  expect(captured.writes).toHaveLength(1);
  return captured.writes[0]!.data;
}

describe('createGroup', () => {
  beforeEach(() => {
    captured.writes = [];
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
