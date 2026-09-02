// The friendship round-trip, and the balance projection the Friends list depends on.
//
// ── Why this file exists ─────────────────────────────────────────────────────────────────────
// A friendship IS a group (D2): accepting a request creates an implicit 1:1 group and both
// `users/{uid}/friends/{fid}` documents in one transaction. An expense "with a friend" is an
// ordinary expense in that group, and `recomputeBalances` folds it into the member documents
// like any other.
//
// 🔴 It then PROJECTS that number onto both friend documents, and only an emulator round-trip
// can prove it. The Friends list reads the projection because it has no alternative:
// `firestore.rules` denies collection-group reads on `members` (T9), so a client cannot ask
// "my balance in each friendship" in one query, and `settlements` is denied too so it cannot
// derive them from the ledger either. A projection that silently stops being written is a list
// that confidently tells you that you are settled up with somebody who owes you money — which
// is exactly the bug this file was written after.
//
// ── The distinction under test ───────────────────────────────────────────────────────────────
// `groups/{gid}/members/{uid}.balanceMinor` is a SCALAR in the group's currency.
// `users/{uid}/friends/{fid}.balanceMinor` is a SPARSE MAP keyed by currency. A settled pair is
// an EMPTY map, never `{ USD: 0 }` — Article I, and D6 forbids summing across the entries.

import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

import {
  GROUP_CURRENCY,
  createProfile,
  createTestEnv,
  expenseDoc,
  serverBalances,
  serverDoc,
  settlementDoc,
  signIn,
  waitFor,
  type Actor,
} from './helpers';

interface FriendRequestResult {
  requestId: string;
}

let env: RulesTestEnvironment;
let alice: Actor;
let bob: Actor;

// File-unique addresses: Firestore is cleared between files, the Auth emulator is not.
const ALICE_EMAIL = 'friends-alice@example.com';
const BOB_EMAIL = 'friends-bob@example.com';

/** The implicit group id, discovered from the friend document rather than guessed. */
let implicitGid = '';

beforeAll(async () => {
  env = await createTestEnv();
  await env.clearFirestore();
  alice = await signIn(ALICE_EMAIL, 'Alice Example');
  bob = await signIn(BOB_EMAIL, 'Bob Example');
  await createProfile(alice);
  await createProfile(bob);

  // The profile trigger has to land before the lookup: `sendFriendRequest` resolves an email
  // through `usernames/{sha256(email)}`, which `onUserProfileWritten` writes.
  await waitFor(
    'the usernames index to carry Bob',
    () => serverDoc(`users/${bob.uid}`),
    (profile) => profile !== null,
  );

  const request = await alice.call<FriendRequestResult>('sendFriendRequest', {
    email: BOB_EMAIL,
  });
  await bob.call('respondToFriendRequest', { requestId: request.requestId, accept: true });

  const friendDoc = await waitFor(
    'establishFriendship to write the friend documents',
    () => serverDoc(`users/${alice.uid}/friends/${bob.uid}`),
    (friend) => friend !== null,
  );
  implicitGid = String(friendDoc?.['implicitGroupId'] ?? '');
});

afterAll(async () => {
  await alice.dispose();
  await bob.dispose();
  await env.cleanup();
});

/** Both sides of the projection, keyed by whose document it is. */
async function friendBalances(): Promise<Record<string, Record<string, number>>> {
  const [mine, theirs] = await Promise.all([
    serverDoc(`users/${alice.uid}/friends/${bob.uid}`),
    serverDoc(`users/${bob.uid}/friends/${alice.uid}`),
  ]);
  return {
    [alice.uid]: (mine?.['balanceMinor'] as Record<string, number>) ?? {},
    [bob.uid]: (theirs?.['balanceMinor'] as Record<string, number>) ?? {},
  };
}

describe('establishFriendship — the implicit group', () => {
  it('creates a 1:1 implicit group with both people in it', async () => {
    expect(implicitGid).not.toBe('');

    const group = await serverDoc(`groups/${implicitGid}`);
    expect(group?.['isImplicit']).toBe(true);
    expect(group?.['type']).toBe('friend');
    expect(group?.['memberCount']).toBe(2);
    expect(group?.['memberIds']).toEqual(expect.arrayContaining([alice.uid, bob.uid]));
  });

  it('seeds both friend documents with an EMPTY balance map, not a zero', async () => {
    // Article I — sparse. `{ USD: 0 }` would render as a row saying nothing.
    const balances = await friendBalances();
    expect(balances[alice.uid]).toEqual({});
    expect(balances[bob.uid]).toEqual({});
  });
});

describe('the friend balance projection', () => {
  it('projects the computed balance onto BOTH friend documents', async () => {
    // Alice pays 40.00 for something they split evenly.
    await setDoc(
      doc(alice.db, `groups/${implicitGid}/expenses/exp_friend_dinner`),
      expenseDoc(
        implicitGid,
        alice,
        [
          { uid: alice.uid, amountMinor: 2000 },
          { uid: bob.uid, amountMinor: 2000 },
        ],
        [{ uid: alice.uid, amountMinor: 4000 }],
      ),
    );

    const projected = await waitFor(
      'the projection to reach both friend documents',
      friendBalances,
      (balances) => balances[alice.uid]?.[GROUP_CURRENCY] === 2000,
    );

    // Sign convention (docs/04 §3): > 0 means "is owed money", and the two documents are
    // opposite views of the same debt.
    expect(projected[alice.uid]).toEqual({ [GROUP_CURRENCY]: 2000 });
    expect(projected[bob.uid]).toEqual({ [GROUP_CURRENCY]: -2000 });

    // 🔴 The projection agrees with the authoritative cache it was copied from. If these two
    // ever disagree, the member document is right and the projection is stale.
    const members = await serverBalances(implicitGid);
    expect(projected[alice.uid]?.[GROUP_CURRENCY]).toBe(members[alice.uid]);
    expect(projected[bob.uid]?.[GROUP_CURRENCY]).toBe(members[bob.uid]);
  });

  it('goes back to an EMPTY map once the debt is settled, never to a zero entry', async () => {
    // The regression that matters for the list: a settled friendship has to read as settled,
    // and `{ USD: 0 }` is a different document from `{}`. The Friends list decides "Settled up"
    // by counting the entries in this map, so a lingering zero row would say "outstanding in 1
    // currency" about a pair who owe each other nothing.
    await setDoc(
      doc(bob.db, `groups/${implicitGid}/settlements/set_friend_paid`),
      settlementDoc(implicitGid, bob, bob.uid, alice.uid, 2000),
    );

    const settled = await waitFor(
      'the settlement to empty both projections',
      friendBalances,
      (balances) => Object.keys(balances[alice.uid] ?? {}).length === 0,
    );

    expect(settled[alice.uid]).toEqual({});
    expect(settled[bob.uid]).toEqual({});

    const members = await serverBalances(implicitGid);
    expect(members[alice.uid]).toBe(0);
    expect(members[bob.uid]).toBe(0);
  });
});
