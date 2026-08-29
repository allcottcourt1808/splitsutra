// usernames/{sha256(key)} — friend-lookup index. Threat T5.
// get is open to signed-in callers because it requires already knowing the plaintext
// identifier; list is denied because it requires nothing and would dump every email and phone.

import { createHash } from 'node:crypto';

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
  limit,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ALICE, ALICE_EMAIL, BOB, BOB_EMAIL, as, asAnon, createTestEnv, seed } from './helpers';

function usernameKey(identifier: string): string {
  return createHash('sha256').update(identifier.toLowerCase()).digest('hex');
}

const ALICE_KEY = usernameKey(ALICE_EMAIL);
const BOB_KEY = usernameKey(BOB_EMAIL);

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `usernames/${ALICE_KEY}`), {
      uid: ALICE,
      displayName: 'Alice Example',
      photoURL: null,
    });
    await setDoc(doc(db, `usernames/${BOB_KEY}`), {
      uid: BOB,
      displayName: 'Bob Example',
      photoURL: null,
    });
  });
});

describe('usernames — get', () => {
  it('allows a signed-in user to resolve a contact they already know', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, `usernames/${BOB_KEY}`)));
  });

  it('denies a signed-out caller', async () => {
    const db = asAnon(env).firestore();
    await assertFails(getDoc(doc(db, `usernames/${BOB_KEY}`)));
  });

  it('returns nothing for a hash that matches no account', async () => {
    const db = as(env, ALICE).firestore();
    const snap = await getDoc(doc(db, `usernames/${usernameKey('nobody@example.com')}`));
    expect(snap.exists()).toBe(false);
  });
});

describe('usernames — list (T5)', () => {
  it('denies dumping the whole index to a signed-in user', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(getDocs(collection(db, 'usernames')));
  });

  it('denies dumping it to a signed-out caller', async () => {
    const db = asAnon(env).firestore();
    await assertFails(getDocs(collection(db, 'usernames')));
  });

  // No constrained form slips through, so the table cannot be paged out either.
  it('denies a limited query', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(getDocs(query(collection(db, 'usernames'), limit(1))));
  });

  it('denies a filtered query, even one matching a single known contact', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(getDocs(query(collection(db, 'usernames'), where('uid', '==', BOB))));
  });
});

describe('usernames — write', () => {
  it('denies a signed-in user creating an index entry', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `usernames/${usernameKey('victim@example.com')}`), {
        uid: ALICE,
        displayName: 'Alice Example',
        photoURL: null,
      }),
    );
  });

  it('denies repointing an existing entry at yourself', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, `usernames/${BOB_KEY}`), { uid: ALICE }));
  });

  it('denies deleting your own entry', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(deleteDoc(doc(db, `usernames/${ALICE_KEY}`)));
  });
});
