import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
  groupDoc,
  memberDoc,
  seed,
  seedWorld,
  seededCommentDoc,
  seededExpenseDoc,
  seededSettlementDoc,
} from './helpers';

const MINE = 'exp_mine';
const THEIRS = 'exp_theirs';
const INVITE = 'inv_token';

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
  await seed(env, async (ctx) => {
    const db = ctx.firestore();

    await setDoc(
      doc(db, `groups/${OTHER_GROUP}`),
      groupDoc({ name: 'Ski trip', createdBy: CAROL, memberIds: [CAROL, DAN] }),
    );
    await setDoc(doc(db, `groups/${OTHER_GROUP}/members/${CAROL}`), memberDoc(CAROL));
    await setDoc(doc(db, `groups/${OTHER_GROUP}/members/${DAN}`), memberDoc(DAN));

    await setDoc(doc(db, `groups/${GROUP}/expenses/${MINE}`), seededExpenseDoc());
    await setDoc(
      doc(db, `groups/${OTHER_GROUP}/expenses/${THEIRS}`),
      seededExpenseDoc({
        groupId: OTHER_GROUP,
        createdBy: CAROL,
        participantIds: [CAROL, DAN],
        splits: [
          { uid: CAROL, amountMinor: 2500 },
          { uid: DAN, amountMinor: 2500 },
        ],
        paidBy: [{ uid: CAROL, amountMinor: 5000 }],
      }),
    );

    await setDoc(doc(db, `groups/${GROUP}/expenses/${MINE}/comments/cmt_1`), seededCommentDoc());
    await setDoc(doc(db, `groups/${GROUP}/settlements/set_1`), seededSettlementDoc());
    await setDoc(doc(db, `groups/${GROUP}/activity/act_1`), {
      type: 'expense.created',
      uid: ALICE,
      expenseId: MINE,
      createdAt: PAST,
    });
    await setDoc(doc(db, `users/${ALICE}/friends/${BOB}`), {
      uid: BOB,
      displayName: 'Bob Example',
      balanceMinor: { USD: 2500 },
      createdAt: PAST,
    });
    await setDoc(doc(db, `invites/${INVITE}`), {
      groupId: GROUP,
      createdBy: ALICE,
      createdAt: PAST,
      expiresAt: PAST,
      usedAt: null,
    });
  });
});

// T9
describe('collectionGroup expenses — read', () => {
  it('allows a query constrained to the caller and returns only their expenses', async () => {
    const db = as(env, ALICE).firestore();
    const snap = await assertSucceeds(
      getDocs(
        query(collectionGroup(db, 'expenses'), where('participantIds', 'array-contains', ALICE)),
      ),
    );
    expect(snap.docs.map((d) => d.id)).toEqual([MINE]);
  });

  it('denies the same query without the array-contains constraint', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(getDocs(collectionGroup(db, 'expenses')));
  });

  it('denies a query constrained to someone else’s uid', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      getDocs(
        query(collectionGroup(db, 'expenses'), where('participantIds', 'array-contains', CAROL)),
      ),
    );
  });

  it('denies a signed-out caller', async () => {
    const db = asAnon(env).firestore();
    await assertFails(
      getDocs(
        query(collectionGroup(db, 'expenses'), where('participantIds', 'array-contains', ALICE)),
      ),
    );
  });
});

describe('collectionGroup — no query is granted over the other subcollections', () => {
  for (const name of ['members', 'comments', 'settlements', 'activity', 'friends']) {
    it(`denies collectionGroup('${name}') to a member of the group`, async () => {
      const db = as(env, ALICE).firestore();
      await assertFails(getDocs(collectionGroup(db, name)));
    });
  }
});

describe('groups/{gid}/activity — read', () => {
  it('allows a member', async () => {
    const db = as(env, BOB).firestore();
    await assertSucceeds(getDoc(doc(db, `groups/${GROUP}/activity/act_1`)));
  });

  it('denies a non-member', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(getDoc(doc(db, `groups/${GROUP}/activity/act_1`)));
  });
});

// T8
describe('groups/{gid}/activity — write', () => {
  it('denies the group admin creating an entry', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `groups/${GROUP}/activity/act_2`), {
        type: 'expense.created',
        uid: ALICE,
        expenseId: MINE,
        createdAt: PAST,
      }),
    );
  });

  it('denies the group admin editing an entry', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, `groups/${GROUP}/activity/act_1`), { uid: BOB }));
  });
});

describe('invites/{inviteId}', () => {
  it('denies read to the group admin', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(getDoc(doc(db, `invites/${INVITE}`)));
  });

  it('denies write to the group admin', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, `invites/${INVITE}`), { usedAt: PAST }));
  });
});
