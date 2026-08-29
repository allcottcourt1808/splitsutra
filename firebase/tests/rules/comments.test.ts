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
  PAST,
  as,
  asAnon,
  createTestEnv,
  commentDoc,
  seed,
  seedWorld,
  seededCommentDoc,
  seededExpenseDoc,
} from './helpers';

let env: RulesTestEnvironment;

const EXPENSE = 'exp_dinner';
const ALICE_COMMENT = 'cmt_alice';
const BOB_COMMENT = 'cmt_bob';
const NEW_COMMENT = 'cmt_new';

const COMMENTS = `groups/${GROUP}/expenses/${EXPENSE}/comments`;
const path = (id: string) => `${COMMENTS}/${id}`;

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
    await setDoc(doc(ctx.firestore(), `groups/${GROUP}/expenses/${EXPENSE}`), seededExpenseDoc());
  });
});

describe('groups/{gid}/expenses/{eid}/comments/{cid} — read', () => {
  beforeEach(async () => {
    await seed(env, async (ctx) => {
      await setDoc(doc(ctx.firestore(), path(ALICE_COMMENT)), seededCommentDoc());
    });
  });

  it('allows a member to read a comment', async () => {
    const db = as(env, BOB).firestore();
    await assertSucceeds(getDoc(doc(db, path(ALICE_COMMENT))));
  });

  it('allows a member to list the thread', async () => {
    const db = as(env, BOB).firestore();
    await assertSucceeds(getDocs(collection(db, COMMENTS)));
  });

  it('denies a signed-in user who is in no group', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(getDoc(doc(db, path(ALICE_COMMENT))));
  });

  it('denies a signed-out reader', async () => {
    const db = asAnon(env).firestore();
    await assertFails(getDoc(doc(db, path(ALICE_COMMENT))));
  });
});

describe('groups/{gid}/expenses/{eid}/comments/{cid} — create', () => {
  it('allows an active member to post a comment', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(setDoc(doc(db, path(NEW_COMMENT)), commentDoc()));
  });

  // T7
  it('denies a comment attributed to another user', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(setDoc(doc(db, path(NEW_COMMENT)), commentDoc({ uid: ALICE })));
  });

  it('denies empty text', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, path(NEW_COMMENT)), commentDoc({ text: '' })));
  });

  it('denies text over 500 characters', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, path(NEW_COMMENT)), commentDoc({ text: 'x'.repeat(501) })));
  });

  // T7
  it('denies a createdAt that is not request.time', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, path(NEW_COMMENT)), commentDoc({ createdAt: PAST })));
  });

  it('denies a comment born already soft-deleted', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, path(NEW_COMMENT)), commentDoc({ deletedAt: PAST })));
  });

  it('denies a departed member', async () => {
    const db = as(env, DAN).firestore();
    await assertFails(setDoc(doc(db, path(NEW_COMMENT)), commentDoc({ uid: DAN })));
  });

  it('denies a signed-in user who is in no group', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(setDoc(doc(db, path(NEW_COMMENT)), commentDoc({ uid: CAROL })));
  });
});

describe('groups/{gid}/expenses/{eid}/comments/{cid} — update', () => {
  beforeEach(async () => {
    await seed(env, async (ctx) => {
      await setDoc(doc(ctx.firestore(), path(BOB_COMMENT)), seededCommentDoc({ uid: BOB }));
    });
  });

  // T12 — non-editable by design (ADR-11)
  it('denies the author editing their own comment', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(updateDoc(doc(db, path(BOB_COMMENT)), { text: 'Actually it was 40' }));
  });

  it('denies the group admin editing a comment', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, path(BOB_COMMENT)), { text: 'Actually it was 40' }));
  });
});

describe('groups/{gid}/expenses/{eid}/comments/{cid} — delete', () => {
  beforeEach(async () => {
    await seed(env, async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, path(ALICE_COMMENT)), seededCommentDoc());
      await setDoc(doc(db, path(BOB_COMMENT)), seededCommentDoc({ uid: BOB }));
    });
  });

  it('allows the author to delete their own comment', async () => {
    const db = as(env, BOB).firestore();
    await assertSucceeds(deleteDoc(doc(db, path(BOB_COMMENT))));
  });

  it('denies another member deleting someone else’s comment', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(deleteDoc(doc(db, path(ALICE_COMMENT))));
  });

  it('denies the group admin deleting someone else’s comment', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(deleteDoc(doc(db, path(BOB_COMMENT))));
  });

  it('denies a signed-in user who is in no group', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(deleteDoc(doc(db, path(ALICE_COMMENT))));
  });
});
