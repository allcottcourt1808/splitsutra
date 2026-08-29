import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import {
  ALICE,
  BOB,
  CAROL,
  DAN,
  GROUP,
  OTHER_GROUP,
  PAST,
  as,
  asAnon,
  createTestEnv,
  expenseDoc,
  seed,
  seedWorld,
  seededExpenseDoc,
} from './helpers';

const EXPENSE = 'exp_dinner';
const EXPENSES = `groups/${GROUP}/expenses`;

let env: RulesTestEnvironment;

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

async function seedExpense(
  overrides: Record<string, unknown> = {},
  id: string = EXPENSE,
): Promise<void> {
  await seed(env, async (ctx) => {
    await setDoc(doc(ctx.firestore(), `${EXPENSES}/${id}`), seededExpenseDoc(overrides));
  });
}

function uids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `uid_filler_${i}`);
}

describe('expenses — read', () => {
  beforeEach(async () => {
    await seedExpense();
  });

  it('allows a member to read an expense', async () => {
    const db = as(env, BOB).firestore();
    await assertSucceeds(getDoc(doc(db, `${EXPENSES}/${EXPENSE}`)));
  });

  it('allows a member to list the collection', async () => {
    const db = as(env, BOB).firestore();
    await assertSucceeds(getDocs(collection(db, EXPENSES)));
  });

  // T1
  it('denies a signed-in user who is in no group', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(getDoc(doc(db, `${EXPENSES}/${EXPENSE}`)));
  });

  it('denies a signed-in non-member listing the collection', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(getDocs(collection(db, EXPENSES)));
  });

  it('denies a signed-out caller', async () => {
    const db = asAnon(env).firestore();
    await assertFails(getDoc(doc(db, `${EXPENSES}/${EXPENSE}`)));
  });
});

describe('expenses — create', () => {
  it('allows an active member to create a valid expense', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc()));
  });

  it('denies a signed-out caller', async () => {
    const db = asAnon(env).firestore();
    await assertFails(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc()));
  });

  it('denies a signed-in user who is in no group', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ createdBy: CAROL })));
  });

  // isActiveMember, not isMember: Dan's member doc still exists, leftAt is set
  it('denies a departed member whose member doc still exists', async () => {
    const db = as(env, DAN).firestore();
    await assertFails(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ createdBy: DAN })));
  });

  // inv 1
  it('denies a non-positive amountMinor', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(
        doc(db, `${EXPENSES}/new`),
        expenseDoc({ amountMinor: 0, splitsTotalMinor: 0, paidTotalMinor: 0 }),
      ),
    );
  });

  it('denies an amountMinor above the safe bound', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(
        doc(db, `${EXPENSES}/new`),
        expenseDoc({
          amountMinor: 1000000001,
          splitsTotalMinor: 1000000001,
          paidTotalMinor: 1000000001,
        }),
      ),
    );
  });

  it('denies a non-integer amountMinor', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(
        doc(db, `${EXPENSES}/new`),
        expenseDoc({ amountMinor: 5000.5, splitsTotalMinor: 5000.5, paidTotalMinor: 5000.5 }),
      ),
    );
  });

  it('denies a currency that is not three uppercase letters', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ currency: 'usd' })));
  });

  // inv 6 / T10 — well-formed code, wrong group
  it('denies a well-formed currency that differs from the group currency', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ currency: 'EUR' })));
  });

  it('denies a groupId that does not match the path', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ groupId: OTHER_GROUP })));
  });

  it('denies an empty description', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ description: '' })));
  });

  it('denies a description longer than 100 characters', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ description: 'x'.repeat(101) })),
    );
  });

  it('denies an unknown splitMethod', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ splitMethod: 'weighted' })));
  });

  it('denies a date that is not a timestamp', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ date: '2026-01-15' })));
  });

  it('denies an empty splits array', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ splits: [], participantIds: [] })),
    );
  });

  it('denies more than 50 splits', async () => {
    const db = as(env, ALICE).firestore();
    const participantIds = uids(51);
    await assertFails(
      setDoc(
        doc(db, `${EXPENSES}/new`),
        expenseDoc({
          participantIds,
          splits: participantIds.map((uid) => ({ uid, amountMinor: 100 })),
        }),
      ),
    );
  });

  it('denies an empty paidBy array', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ paidBy: [] })));
  });

  // inv 7
  it('denies participantIds whose length differs from splits', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ participantIds: [ALICE] })));
  });

  // inv 5
  it('denies a duplicate participant', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(
        doc(db, `${EXPENSES}/new`),
        expenseDoc({
          participantIds: [ALICE, ALICE],
          splits: [
            { uid: ALICE, amountMinor: 2500 },
            { uid: ALICE, amountMinor: 2500 },
          ],
        }),
      ),
    );
  });

  // T6
  it('denies a participant who is not a group member', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(
        doc(db, `${EXPENSES}/new`),
        expenseDoc({
          participantIds: [ALICE, CAROL],
          splits: [
            { uid: ALICE, amountMinor: 2500 },
            { uid: CAROL, amountMinor: 2500 },
          ],
        }),
      ),
    );
  });

  // T3 layer 1
  it('denies splitsTotalMinor that does not equal amountMinor', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ splitsTotalMinor: 4000 })));
  });

  // T3 layer 1
  it('denies paidTotalMinor that does not equal amountMinor', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ paidTotalMinor: 4000 })));
  });

  // T7
  it('denies a createdBy that is not the caller', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ createdBy: BOB })));
  });

  // T7
  it('denies a createdAt that is not request.time', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ createdAt: PAST })));
  });

  it('denies a non-null deletedAt on create', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `${EXPENSES}/new`), expenseDoc({ deletedAt: PAST })));
  });

  // Q1 Option A: rules have no reduce(), so the checksums are all layer 1 can compare.
  it('accepts a forged checksum — layer 2 (onExpenseWritten) is what catches this', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(
      setDoc(
        doc(db, `${EXPENSES}/new`),
        expenseDoc({
          splits: [
            { uid: ALICE, amountMinor: 1 },
            { uid: BOB, amountMinor: 1 },
          ],
        }),
      ),
    );
  });
});

describe('expenses — update', () => {
  beforeEach(async () => {
    await seedExpense();
  });

  const edit = (overrides: Record<string, unknown>) => ({
    description: 'Dinner at Ramiro, revised',
    updatedAt: serverTimestamp(),
    ...overrides,
  });

  it('allows the creator to edit their own expense', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(updateDoc(doc(db, `${EXPENSES}/${EXPENSE}`), edit({ updatedBy: ALICE })));
  });

  it('allows a group admin to edit another member’s expense', async () => {
    await seedExpense({ createdBy: BOB }, 'exp_bob');
    const db = as(env, ALICE).firestore();
    await assertSucceeds(updateDoc(doc(db, `${EXPENSES}/exp_bob`), edit({ updatedBy: ALICE })));
  });

  // T11 / ADR-11
  it('denies a member who is neither the creator nor an admin', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(updateDoc(doc(db, `${EXPENSES}/${EXPENSE}`), edit({ updatedBy: BOB })));
  });

  it('denies a signed-in user who is in no group', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(updateDoc(doc(db, `${EXPENSES}/${EXPENSE}`), edit({ updatedBy: CAROL })));
  });

  it('denies a departed member editing their own expense', async () => {
    await seedExpense({ createdBy: DAN }, 'exp_dan');
    const db = as(env, DAN).firestore();
    await assertFails(updateDoc(doc(db, `${EXPENSES}/exp_dan`), edit({ updatedBy: DAN })));
  });

  it('denies changing currency', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, `${EXPENSES}/${EXPENSE}`), edit({ currency: 'EUR', updatedBy: ALICE })),
    );
  });

  it('denies changing groupId', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      updateDoc(
        doc(db, `${EXPENSES}/${EXPENSE}`),
        edit({ groupId: OTHER_GROUP, updatedBy: ALICE }),
      ),
    );
  });

  // T7
  it('denies changing createdBy', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, `${EXPENSES}/${EXPENSE}`), edit({ createdBy: BOB, updatedBy: ALICE })),
    );
  });

  // T7
  it('denies changing createdAt', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      updateDoc(
        doc(db, `${EXPENSES}/${EXPENSE}`),
        edit({ createdAt: serverTimestamp(), updatedBy: ALICE }),
      ),
    );
  });

  it('denies an updatedBy that is not the caller', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, `${EXPENSES}/${EXPENSE}`), edit({ updatedBy: BOB })));
  });

  it('denies an edit that breaks an invariant', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, `${EXPENSES}/${EXPENSE}`), edit({ amountMinor: 6000, updatedBy: ALICE })),
    );
  });

  // grandfathering: Dan is no longer in memberIds but stays a valid participant
  it('allows editing an expense whose participants include a departed member', async () => {
    await seedExpense(
      {
        participantIds: [ALICE, DAN],
        splits: [
          { uid: ALICE, amountMinor: 2500 },
          { uid: DAN, amountMinor: 2500 },
        ],
      },
      'exp_legacy',
    );
    const db = as(env, ALICE).firestore();
    await assertSucceeds(updateDoc(doc(db, `${EXPENSES}/exp_legacy`), edit({ updatedBy: ALICE })));
  });

  // Article V — the soft delete itself is an update, so ADR-11 governs it
  it('allows the creator to soft-delete by setting deletedAt', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `${EXPENSES}/${EXPENSE}`), {
        deletedAt: serverTimestamp(),
        updatedBy: ALICE,
      }),
    );
  });
});

describe('expenses — delete (Article V)', () => {
  beforeEach(async () => {
    await seedExpense();
  });

  it('denies a hard delete to the creator and group admin', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(deleteDoc(doc(db, `${EXPENSES}/${EXPENSE}`)));
  });

  it('denies a hard delete to another member', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(deleteDoc(doc(db, `${EXPENSES}/${EXPENSE}`)));
  });
});
