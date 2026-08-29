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
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { ALICE, BOB, CAROL, PAST, as, asAnon, createTestEnv, seed, seedWorld } from './helpers';

const EVE = 'uid_eve';
const FRANK = 'uid_frank';

const ALICE_TO_BOB = `${ALICE}__${BOB}`;
const EVE_TO_FRANK = `${EVE}__${FRANK}`;

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
    await setDoc(doc(db, `friendRequests/${ALICE_TO_BOB}`), {
      fromUid: ALICE,
      toUid: BOB,
      status: 'pending',
      createdAt: PAST,
    });
    await setDoc(doc(db, `friendRequests/${EVE_TO_FRANK}`), {
      fromUid: EVE,
      toUid: FRANK,
      status: 'pending',
      createdAt: PAST,
    });
  });
});

describe('friendRequests — get', () => {
  it('allows the sender to read their own request', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, `friendRequests/${ALICE_TO_BOB}`)));
  });

  it('allows the recipient to read the request sent to them', async () => {
    const db = as(env, BOB).firestore();
    await assertSucceeds(getDoc(doc(db, `friendRequests/${ALICE_TO_BOB}`)));
  });

  it('denies a third party', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(getDoc(doc(db, `friendRequests/${ALICE_TO_BOB}`)));
  });

  it('denies a signed-out caller', async () => {
    const db = asAnon(env).firestore();
    await assertFails(getDoc(doc(db, `friendRequests/${ALICE_TO_BOB}`)));
  });
});

describe('friendRequests — list', () => {
  it('allows a query filtered on toUid == the caller', async () => {
    const db = as(env, BOB).firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'friendRequests'), where('toUid', '==', BOB))),
    );
  });

  it('allows a query filtered on fromUid == the caller', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'friendRequests'), where('fromUid', '==', ALICE))),
    );
  });

  it('denies an unfiltered list of the collection', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(getDocs(collection(db, 'friendRequests')));
  });

  it('denies a query filtered on a pair the caller is not part of', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      getDocs(query(collection(db, 'friendRequests'), where('toUid', '==', FRANK))),
    );
  });

  it('denies a signed-out caller', async () => {
    const db = asAnon(env).firestore();
    await assertFails(getDocs(query(collection(db, 'friendRequests'), where('toUid', '==', BOB))));
  });
});

describe('friendRequests — write', () => {
  it('denies the sender creating their own request', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `friendRequests/${ALICE}__${CAROL}`), {
        fromUid: ALICE,
        toUid: CAROL,
        status: 'pending',
        createdAt: PAST,
      }),
    );
  });

  // A client that could write here could write its own request straight to 'accepted'.
  it('denies the recipient setting status to accepted', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(updateDoc(doc(db, `friendRequests/${ALICE_TO_BOB}`), { status: 'accepted' }));
  });

  it('denies the sender deleting their own request', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(deleteDoc(doc(db, `friendRequests/${ALICE_TO_BOB}`)));
  });
});
