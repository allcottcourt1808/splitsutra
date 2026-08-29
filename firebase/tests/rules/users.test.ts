// users/{uid} and users/{uid}/friends/{friendUid} — the private profile.
// ownsClaimedIdentity() blocks identity spoofing: onUserProfileWritten derives
// usernames/{sha256(email)} from this document, so claiming an email you do not hold would
// redirect that person's friend lookups to you.

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
  ALICE_EMAIL,
  ALICE_PHONE,
  BOB,
  BOB_EMAIL,
  OTHER_PAST,
  PAST,
  as,
  asAnon,
  createTestEnv,
  seed,
  seededUserDoc,
  userDoc,
} from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

describe('users/{uid} — get', () => {
  beforeEach(async () => {
    await seed(env, async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${ALICE}`), seededUserDoc(ALICE));
    });
  });

  it('allows a user to read their own profile', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, `users/${ALICE}`)));
  });

  it('denies reading another user’s profile', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(getDoc(doc(db, `users/${ALICE}`)));
  });

  it('denies a signed-out reader', async () => {
    const db = asAnon(env).firestore();
    await assertFails(getDoc(doc(db, `users/${ALICE}`)));
  });
});

describe('users — list (T5)', () => {
  beforeEach(async () => {
    await seed(env, async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, `users/${ALICE}`), seededUserDoc(ALICE, { email: ALICE_EMAIL }));
      await setDoc(doc(db, `users/${BOB}`), seededUserDoc(BOB, { email: BOB_EMAIL }));
    });
  });

  // Denied even for a signed-in user who owns one of the documents (T5).
  it('denies enumerating users even to a signed-in user who owns one of them', async () => {
    const db = as(env, ALICE, { email: ALICE_EMAIL }).firestore();
    await assertFails(getDocs(collection(db, 'users')));
  });

  it('denies enumerating users to a signed-out caller', async () => {
    const db = asAnon(env).firestore();
    await assertFails(getDocs(collection(db, 'users')));
  });
});

describe('users/{uid} — create', () => {
  it('allows creating your own profile', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(setDoc(doc(db, `users/${ALICE}`), userDoc(ALICE)));
  });

  it('denies creating a profile at someone else’s uid', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(setDoc(doc(db, `users/${ALICE}`), userDoc(ALICE)));
  });

  it('denies a profile whose uid field does not match its document id', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `users/${ALICE}`), userDoc(ALICE, { uid: BOB })));
  });

  it('denies an empty displayName', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `users/${ALICE}`), userDoc(ALICE, { displayName: '' })));
  });

  it('denies a displayName over 50 characters', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `users/${ALICE}`), userDoc(ALICE, { displayName: 'x'.repeat(51) })),
    );
  });

  // T7 — a client-chosen createdAt lets someone backdate their own account.
  it('denies a createdAt that is not request.time', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `users/${ALICE}`), userDoc(ALICE, { createdAt: PAST })));
  });

  describe('ownsClaimedIdentity', () => {
    it('allows storing the email that is on your own token', async () => {
      const db = as(env, ALICE, { email: ALICE_EMAIL }).firestore();
      await assertSucceeds(
        setDoc(doc(db, `users/${ALICE}`), userDoc(ALICE, { email: ALICE_EMAIL })),
      );
    });

    // The spoof: index usernames/sha256(bob@) at Alice.
    it('denies claiming an email you do not hold', async () => {
      const db = as(env, ALICE, { email: ALICE_EMAIL }).firestore();
      await assertFails(setDoc(doc(db, `users/${ALICE}`), userDoc(ALICE, { email: BOB_EMAIL })));
    });

    it('denies claiming any email when the token carries none', async () => {
      const db = as(env, ALICE).firestore();
      await assertFails(setDoc(doc(db, `users/${ALICE}`), userDoc(ALICE, { email: ALICE_EMAIL })));
    });

    it('allows storing the phone number that is on your own token', async () => {
      const db = as(env, ALICE, { phone_number: ALICE_PHONE }).firestore();
      await assertSucceeds(
        setDoc(doc(db, `users/${ALICE}`), userDoc(ALICE, { phoneNumber: ALICE_PHONE })),
      );
    });

    it('denies claiming a phone number you do not hold', async () => {
      const db = as(env, ALICE, { phone_number: ALICE_PHONE }).firestore();
      await assertFails(
        setDoc(doc(db, `users/${ALICE}`), userDoc(ALICE, { phoneNumber: '+15550100999' })),
      );
    });

    // Phone-only user: no email claim, hence .get(k, null) in tokenEmail().
    it('allows a profile with neither identity field', async () => {
      const db = as(env, ALICE, { phone_number: ALICE_PHONE }).firestore();
      await assertSucceeds(setDoc(doc(db, `users/${ALICE}`), userDoc(ALICE)));
    });
  });
});

describe('users/{uid} — update', () => {
  beforeEach(async () => {
    await seed(env, async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${ALICE}`), seededUserDoc(ALICE));
    });
  });

  it('allows a user to rename themselves', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `users/${ALICE}`), {
        displayName: 'Alice Renamed',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('denies updating another user’s profile', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(
      updateDoc(doc(db, `users/${ALICE}`), {
        displayName: 'Owned',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('denies changing the immutable uid field', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, `users/${ALICE}`), {
        uid: BOB,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('denies rewriting createdAt', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, `users/${ALICE}`), {
        createdAt: OTHER_PAST,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('denies an update whose updatedAt is not request.time', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, `users/${ALICE}`), { displayName: 'X', updatedAt: PAST }));
  });

  it('denies adding an email you do not hold', async () => {
    const db = as(env, ALICE, { email: ALICE_EMAIL }).firestore();
    await assertFails(
      updateDoc(doc(db, `users/${ALICE}`), {
        email: BOB_EMAIL,
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe('users/{uid} — delete', () => {
  beforeEach(async () => {
    await seed(env, async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${ALICE}`), seededUserDoc(ALICE));
    });
  });

  // Deletion is the deleteAccount callable — it must first prove every balance is zero.
  it('denies the account owner deleting their own profile', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(deleteDoc(doc(db, `users/${ALICE}`)));
  });

  it('denies anyone else deleting it', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(deleteDoc(doc(db, `users/${ALICE}`)));
  });
});

describe('users/{uid}/friends/{friendUid}', () => {
  beforeEach(async () => {
    await seed(env, async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${ALICE}/friends/${BOB}`), {
        uid: BOB,
        displayName: 'Bob Example',
        balanceMinor: { USD: -2500 },
        createdAt: PAST,
      });
    });
  });

  it('allows reading your own friend list', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, `users/${ALICE}/friends/${BOB}`)));
  });

  it('denies reading someone else’s friend list', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(getDoc(doc(db, `users/${ALICE}/friends/${BOB}`)));
  });

  // T2 — this document holds balanceMinor.
  it('denies the owner writing their own friend record', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/friends/${BOB}`), {
        uid: BOB,
        displayName: 'Bob',
        balanceMinor: {},
        createdAt: PAST,
      }),
    );
  });

  it('denies the owner zeroing out a balance they owe', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, `users/${ALICE}/friends/${BOB}`), { balanceMinor: {} }));
  });

  it('denies the owner deleting a friend record', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(deleteDoc(doc(db, `users/${ALICE}/friends/${BOB}`)));
  });
});
