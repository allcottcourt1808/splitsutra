// Article III + Article V — the server owns the truth about balances, and the ledger is the
// only truth there is.
//
// These are the round-trips `tests/rules` structurally cannot make. The rules suite proves a
// client cannot WRITE `balanceMinor`; it can say nothing about what the number becomes, because
// the only thing that ever writes it is `onExpenseWritten` → `recomputeBalances`. Every
// assertion below writes to the ledger through an ordinary client, waits for that pipeline, and
// reads the answer back.
//
// The invariant under all of them is AC-E1.3: across all member docs in a group,
// `sum(balanceMinor) === 0`, exactly.

import { deleteDoc, doc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

import {
  balancesOf,
  createGroup,
  createProfile,
  createTestEnv,
  expenseDoc,
  isPermissionDenied,
  joinViaInvite,
  memberDocOf,
  rejectionCode,
  serverBalances,
  serverDoc,
  settlementDoc,
  signIn,
  staysAt,
  sumOf,
  waitFor,
  withAdmin,
  type Actor,
} from './helpers';

let env: RulesTestEnvironment;
let alice: Actor;
let bob: Actor;

// File-unique addresses: Firestore is cleared between files, the Auth emulator is not.
const ALICE_EMAIL = 'balances-alice@example.com';
const BOB_EMAIL = 'balances-bob@example.com';

// A fresh group per test, so no two tests can reach each other's documents.
let groupSeq = 0;
function nextGroupId(): string {
  groupSeq += 1;
  return `grp_balances_${String(groupSeq)}`;
}

// 🔴 `clearFirestore()` runs ONCE, not per test — the opposite of tests/rules, and deliberately.
// Triggers are asynchronous and at-least-once: wiping the database between tests deletes the
// documents a still-queued invocation is about to write to, which surfaces inside the Function
// as `5 NOT_FOUND: no entity to update` and a retry behind it. Isolation comes from a unique
// group id per test instead, which costs nothing and cannot race.
beforeAll(async () => {
  env = await createTestEnv();
  await env.clearFirestore();
  alice = await signIn(ALICE_EMAIL, 'Alice Example');
  bob = await signIn(BOB_EMAIL, 'Bob Example');
  await createProfile(alice);
  await createProfile(bob);
});

afterAll(async () => {
  await alice.dispose();
  await bob.dispose();
  await env.cleanup();
});

/** Alice's group with Bob in it — the shape almost every test below starts from. */
async function twoPersonGroup(): Promise<string> {
  const gid = nextGroupId();
  await createGroup(alice, gid);
  await joinViaInvite(alice, bob, gid);
  return gid;
}

/** Alice pays 50.00 for a dinner the two of them split evenly. */
async function evenDinner(gid: string, eid = 'exp_dinner'): Promise<void> {
  await setDoc(
    doc(alice.db, `groups/${gid}/expenses/${eid}`),
    expenseDoc(
      gid,
      alice,
      [
        { uid: alice.uid, amountMinor: 2500 },
        { uid: bob.uid, amountMinor: 2500 },
      ],
      [{ uid: alice.uid, amountMinor: 5000 }],
    ),
  );
  await waitFor(
    'the balance pipeline to fold in the dinner',
    () => serverBalances(gid),
    (b) => b[bob.uid] === -2500,
  );
}

describe('onGroupCreated — the creator’s member document is minted server-side', () => {
  it('seeds the creator as admin with a zero balance', async () => {
    const gid = nextGroupId();
    await createGroup(alice, gid);

    const member = await memberDocOf(alice, gid, alice.uid);
    expect(member).not.toBeNull();
    expect(member?.role).toBe('admin');
    expect(member?.leftAt).toBeNull();
    // Article I: a group-member balance is a scalar integer in the group currency, not a float
    // and not a map. (The sparse per-currency map is the FRIEND document — see friends.test.ts.)
    expect(member?.balanceMinor).toBe(0);
    expect(Number.isSafeInteger(member?.balanceMinor)).toBe(true);
  });

  it('does not let the creator write that document themselves', async () => {
    // The rules half of this lives in tests/rules; what it proves HERE is that the only writer
    // on this path is the Function — the seeded document above was not the client's.
    const gid = nextGroupId();
    await createGroup(alice, gid);

    const denied = await isPermissionDenied(
      updateDoc(doc(alice.db, `groups/${gid}/members/${alice.uid}`), { role: 'member' }),
    );
    expect(denied).toBe(true);
  });
});

describe('onExpenseWritten — writing to the ledger produces the balances', () => {
  it('moves both members by the right amount and keeps the sum at zero', async () => {
    const gid = await twoPersonGroup();
    await evenDinner(gid);

    // Read as an ordinary member, not with rules off: what the app sees is the claim.
    const balances = await balancesOf(alice, gid);
    // Sign convention (docs/04 §3): > 0 means "is owed money".
    expect(balances[alice.uid]).toBe(2500);
    expect(balances[bob.uid]).toBe(-2500);
    expect(sumOf(balances)).toBe(0);
  });

  it('accumulates across several expenses and stays exactly integral', async () => {
    const gid = await twoPersonGroup();

    // 10.01 paid by Alice, split 5.01 / 5.00 — an odd amount, so the remainder lands on
    // somebody. Article I: it lands as an integer, and the two shares sum to the total exactly.
    await setDoc(
      doc(alice.db, `groups/${gid}/expenses/exp_odd`),
      expenseDoc(
        gid,
        alice,
        [
          { uid: alice.uid, amountMinor: 501 },
          { uid: bob.uid, amountMinor: 500 },
        ],
        [{ uid: alice.uid, amountMinor: 1001 }],
      ),
    );
    // Bob pays the next one, so the two partially cancel. 6.67 split 3.33 / 3.34.
    await setDoc(
      doc(bob.db, `groups/${gid}/expenses/exp_taxi`),
      expenseDoc(
        gid,
        bob,
        [
          { uid: alice.uid, amountMinor: 333 },
          { uid: bob.uid, amountMinor: 334 },
        ],
        [{ uid: bob.uid, amountMinor: 667 }],
      ),
    );

    const balances = await waitFor(
      'both expenses to be folded into the balances',
      () => serverBalances(gid),
      (b) => b[alice.uid] === 500 - 333,
    );

    expect(balances[alice.uid]).toBe(167);
    expect(balances[bob.uid]).toBe(-167);
    expect(sumOf(balances)).toBe(0);
    for (const value of Object.values(balances)) {
      expect(Number.isSafeInteger(value)).toBe(true);
    }
  });

  it('returns everyone to zero once a settlement covers the debt', async () => {
    const gid = await twoPersonGroup();
    await evenDinner(gid);

    await setDoc(
      doc(bob.db, `groups/${gid}/settlements/set_paid`),
      settlementDoc(gid, bob, bob.uid, alice.uid, 2500),
    );

    const balances = await waitFor(
      'onSettlementWritten to zero the pair out',
      () => serverBalances(gid),
      (b) => b[bob.uid] === 0,
    );
    expect(balances[alice.uid]).toBe(0);
    expect(balances[bob.uid]).toBe(0);
    expect(sumOf(balances)).toBe(0);
  });

  it('rebuilds from the ledger when an expense is soft-deleted', async () => {
    // Article V: nothing is hard-deleted, and every derived value must be rebuildable from
    // what remains. Setting `deletedAt` is the only delete the rules allow.
    const gid = await twoPersonGroup();
    await evenDinner(gid);

    await updateDoc(doc(alice.db, `groups/${gid}/expenses/exp_dinner`), {
      deletedAt: new Date(),
      updatedBy: alice.uid,
    });

    const balances = await waitFor(
      'the soft delete to be folded out of the balances',
      () => serverBalances(gid),
      (b) => b[alice.uid] === 0,
    );
    expect(balances[bob.uid]).toBe(0);
    expect(sumOf(balances)).toBe(0);

    // Article V — the document is still there, and a hard delete is refused outright.
    expect(await serverDoc(`groups/${gid}/expenses/exp_dinner`)).not.toBeNull();
    expect(
      await isPermissionDenied(deleteDoc(doc(alice.db, `groups/${gid}/expenses/exp_dinner`))),
    ).toBe(true);
  });
});

describe('Article III — a client cannot write its own balance', () => {
  it('refuses the write and leaves the Function-computed value standing', async () => {
    const gid = await twoPersonGroup();
    await evenDinner(gid);

    // T2, from every angle a client has: erase your own debt, and rewrite somebody else's.
    expect(
      await isPermissionDenied(
        updateDoc(doc(bob.db, `groups/${gid}/members/${bob.uid}`), { balanceMinor: 0 }),
      ),
    ).toBe(true);
    expect(
      await isPermissionDenied(
        setDoc(doc(bob.db, `groups/${gid}/members/${bob.uid}`), { balanceMinor: 0 }),
      ),
    ).toBe(true);
    expect(
      await isPermissionDenied(
        updateDoc(doc(alice.db, `groups/${gid}/members/${bob.uid}`), { balanceMinor: 999_999 }),
      ),
    ).toBe(true);

    // The point of the test is this line, not the three above: the denial changed nothing, and
    // no partial write slipped through behind it.
    await staysAt(
      'Bob’s balance after three refused writes',
      async () => (await serverBalances(gid))[bob.uid],
      -2500,
    );
    expect((await balancesOf(bob, gid))[bob.uid]).toBe(-2500);
  });
});

describe('Article V — balances are a cache, and the cache is rebuildable', () => {
  it('recomputeGroupBalances repairs a balance corrupted behind the rules', async () => {
    const gid = await twoPersonGroup();
    await evenDinner(gid);

    // Corruption no client could cause — written with rules off, which is the only way to
    // simulate a dropped trigger or a bad migration. That is the state Article V says must be
    // recoverable from the ledger alone.
    await withAdmin(env, async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `groups/${gid}/members/${bob.uid}`), {
        balanceMinor: 0,
      });
    });
    expect((await serverBalances(gid))[bob.uid]).toBe(0);

    const result = await alice.call<{ repaired: boolean; driftCount: number }>(
      'recomputeGroupBalances',
      { groupId: gid },
    );
    expect(result.repaired).toBe(true);
    expect(result.driftCount).toBeGreaterThan(0);

    const balances = await waitFor(
      'the recompute to restore the ledger truth',
      () => serverBalances(gid),
      (b) => b[bob.uid] === -2500,
    );
    expect(balances[alice.uid]).toBe(2500);
    expect(sumOf(balances)).toBe(0);
  });

  it('refuses a recompute from somebody who is not a member', async () => {
    const gid = nextGroupId();
    await createGroup(alice, gid);

    expect(await rejectionCode(bob.call('recomputeGroupBalances', { groupId: gid }))).toBe(
      'functions/permission-denied',
    );
  });
});

describe('Layer 2 — a forged expense is quarantined and never enters the money', () => {
  it('keeps a splits array that lies about its own checksum out of the balances', async () => {
    // Q1 Option A, the sophisticated attack: `splitsTotalMinor` equals `amountMinor`, so
    // firestore.rules is satisfied — it has no `reduce()` and cannot sum the array. The real
    // sums are recomputed by `checkExpense` in the Function, which is the only place this is
    // caught. Without that half, Option A is theatre (docs/12 Q1).
    const gid = await twoPersonGroup();

    await setDoc(
      doc(bob.db, `groups/${gid}/expenses/exp_forged`),
      expenseDoc(
        gid,
        bob,
        // Claims 50.00 total; the shares actually sum to 1.00, all of it charged to Alice.
        [
          { uid: alice.uid, amountMinor: 100 },
          { uid: bob.uid, amountMinor: 0 },
        ],
        [{ uid: bob.uid, amountMinor: 5000 }],
      ),
    );

    // Article V — quarantine, not deletion. The evidence survives, and the flag is what
    // `recomputeBalances` filters the document out of the ledger by.
    const quarantined = await waitFor(
      'the integrity check to quarantine the forged expense',
      () => serverDoc(`groups/${gid}/expenses/exp_forged`),
      (expense) => expense?.['integrityStatus'] === 'quarantined',
    );
    expect(quarantined?.['integrityReason']).toContain('splits sum to 100');

    // Held for several seconds because the failure this guards against is a LATE write, not a
    // wrong immediate one.
    await staysAt(
      'the balance sum after a forged expense',
      async () => sumOf(await serverBalances(gid)),
      0,
      4_000,
    );
    const balances = await serverBalances(gid);
    expect(balances[alice.uid]).toBe(0);
    expect(balances[bob.uid]).toBe(0);
  });
});
