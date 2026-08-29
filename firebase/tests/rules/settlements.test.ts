import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import {
  ALICE,
  BOB,
  CAROL,
  DAN,
  GROUP,
  OTHER_GROUP,
  OTHER_PAST,
  PAST,
  as,
  asAnon,
  createTestEnv,
  seed,
  seedWorld,
  seededSettlementDoc,
  settlementDoc,
} from './helpers';

let env: RulesTestEnvironment;

const ALICE_SETTLEMENT = 'stl_alice';
const BOB_SETTLEMENT = 'stl_bob';
const NEW_SETTLEMENT = 'stl_new';

const path = (id: string) => `groups/${GROUP}/settlements/${id}`;

function settlementWithoutNote(): Record<string, unknown> {
  const d: Record<string, unknown> = settlementDoc();
  delete d.note;
  return d;
}

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedWorld(env);
});

describe('groups/{gid}/settlements/{sid} — read', () => {
  beforeEach(async () => {
    await seed(env, async (ctx) => {
      await setDoc(doc(ctx.firestore(), path(ALICE_SETTLEMENT)), seededSettlementDoc());
    });
  });

  it('allows a member to read a settlement', async () => {
    const db = as(env, BOB).firestore();
    await assertSucceeds(getDoc(doc(db, path(ALICE_SETTLEMENT))));
  });

  it('allows a member to list settlements', async () => {
    const db = as(env, BOB).firestore();
    await assertSucceeds(getDocs(collection(db, `groups/${GROUP}/settlements`)));
  });

  it('denies a signed-in user who is in no group', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(getDoc(doc(db, path(ALICE_SETTLEMENT))));
  });

  it('denies a signed-out reader', async () => {
    const db = asAnon(env).firestore();
    await assertFails(getDoc(doc(db, path(ALICE_SETTLEMENT))));
  });
});

describe('groups/{gid}/settlements/{sid} — create', () => {
  it('allows an active member to record a settlement', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(setDoc(doc(db, path(NEW_SETTLEMENT)), settlementDoc()));
  });

  it('allows a settlement with no note at all', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(setDoc(doc(db, path(NEW_SETTLEMENT)), settlementWithoutNote()));
  });

  it('denies a non-positive amountMinor', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, path(NEW_SETTLEMENT)), settlementDoc({ amountMinor: 0 })));
  });

  it('denies a non-integer amountMinor', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, path(NEW_SETTLEMENT)), settlementDoc({ amountMinor: 25.5 })));
  });

  it('denies an amountMinor over the safe bound', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, path(NEW_SETTLEMENT)), settlementDoc({ amountMinor: 1000000001 })),
    );
  });

  it('denies a settlement from a user to themselves', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, path(NEW_SETTLEMENT)), settlementDoc({ fromUid: ALICE, toUid: ALICE })),
    );
  });

  it('denies a fromUid who is not a group member', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, path(NEW_SETTLEMENT)), settlementDoc({ fromUid: CAROL })));
  });

  it('denies a toUid who is not a group member', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, path(NEW_SETTLEMENT)), settlementDoc({ toUid: CAROL })));
  });

  it('denies a currency that is not a three-letter uppercase code', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, path(NEW_SETTLEMENT)), settlementDoc({ currency: 'usd' })));
  });

  it('denies a well-formed currency that is not the group currency', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, path(NEW_SETTLEMENT)), settlementDoc({ currency: 'EUR' })));
  });

  it('denies a groupId that does not match the path', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, path(NEW_SETTLEMENT)), settlementDoc({ groupId: OTHER_GROUP })),
    );
  });

  it('denies a date that is not a timestamp', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, path(NEW_SETTLEMENT)), settlementDoc({ date: '2026-01-15' })));
  });

  it('denies a note over 200 characters', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, path(NEW_SETTLEMENT)), settlementDoc({ note: 'x'.repeat(201) })),
    );
  });

  // T7
  it('denies a createdBy that is not the caller', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, path(NEW_SETTLEMENT)), settlementDoc({ createdBy: BOB })));
  });

  // T7
  it('denies a createdAt that is not request.time', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, path(NEW_SETTLEMENT)), settlementDoc({ createdAt: PAST })));
  });

  it('denies a settlement born already soft-deleted', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, path(NEW_SETTLEMENT)), settlementDoc({ deletedAt: PAST })));
  });

  it('denies a departed member', async () => {
    const db = as(env, DAN).firestore();
    await assertFails(setDoc(doc(db, path(NEW_SETTLEMENT)), settlementDoc({ createdBy: DAN })));
  });
});

// T11 — DEVIATION from docs/05: the ADR-11 creator-or-admin gate applied to settlements.
describe('groups/{gid}/settlements/{sid} — update', () => {
  beforeEach(async () => {
    await seed(env, async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, path(ALICE_SETTLEMENT)), seededSettlementDoc());
      await setDoc(doc(db, path(BOB_SETTLEMENT)), seededSettlementDoc({ createdBy: BOB }));
    });
  });

  it('allows the creator to edit the note', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(updateDoc(doc(db, path(ALICE_SETTLEMENT)), { note: 'Paid in cash' }));
  });

  it('allows a group admin to edit another member’s settlement', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(updateDoc(doc(db, path(BOB_SETTLEMENT)), { note: 'Paid in cash' }));
  });

  it('denies a member who is neither the creator nor an admin', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(updateDoc(doc(db, path(ALICE_SETTLEMENT)), { note: 'Paid in cash' }));
  });

  it('denies changing amountMinor', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, path(ALICE_SETTLEMENT)), { amountMinor: 100 }));
  });

  it('denies changing fromUid', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, path(ALICE_SETTLEMENT)), { fromUid: ALICE }));
  });

  it('denies changing toUid', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, path(ALICE_SETTLEMENT)), { toUid: BOB }));
  });

  it('denies changing currency', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, path(ALICE_SETTLEMENT)), { currency: 'EUR' }));
  });

  it('denies changing groupId', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, path(ALICE_SETTLEMENT)), { groupId: OTHER_GROUP }));
  });

  it('denies changing createdBy', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, path(ALICE_SETTLEMENT)), { createdBy: BOB }));
  });

  it('denies changing createdAt', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, path(ALICE_SETTLEMENT)), { createdAt: OTHER_PAST }));
  });
});

describe('groups/{gid}/settlements/{sid} — delete', () => {
  beforeEach(async () => {
    await seed(env, async (ctx) => {
      await setDoc(doc(ctx.firestore(), path(ALICE_SETTLEMENT)), seededSettlementDoc());
    });
  });

  // Article V — soft delete via update only.
  it('denies a hard delete even to the creator', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(deleteDoc(doc(db, path(ALICE_SETTLEMENT))));
  });

  it('denies a hard delete to an outsider', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(deleteDoc(doc(db, path(ALICE_SETTLEMENT))));
  });
});
