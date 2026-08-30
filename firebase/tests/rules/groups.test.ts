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
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
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
  groupDoc,
  memberDoc,
  seed,
  seedWorld,
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
  await seedWorld(env);
});

const NEW_GROUP = 'grp_new';

function newGroupDoc(overrides: Record<string, unknown> = {}) {
  return groupDoc({
    createdBy: ALICE,
    memberIds: [ALICE],
    memberCount: 1,
    createdAt: serverTimestamp(),
    ...overrides,
  });
}

describe('groups/{groupId} — get', () => {
  it('allows a member to read the group', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, `groups/${GROUP}`)));
  });

  it('allows another member to read the group', async () => {
    const db = as(env, BOB).firestore();
    await assertSucceeds(getDoc(doc(db, `groups/${GROUP}`)));
  });

  it('denies a non-member', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(getDoc(doc(db, `groups/${GROUP}`)));
  });

  it('denies a signed-out reader', async () => {
    const db = asAnon(env).firestore();
    await assertFails(getDoc(doc(db, `groups/${GROUP}`)));
  });
});

describe('groups — list', () => {
  beforeEach(async () => {
    await seed(env, async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), `groups/${OTHER_GROUP}`),
        groupDoc({ createdBy: CAROL, memberIds: [CAROL], memberCount: 1 }),
      );
    });
  });

  it('allows a query filtered to the caller’s own memberIds', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'groups'), where('memberIds', 'array-contains', ALICE))),
    );
  });

  it('allows a member with no groups to run the same filtered query', async () => {
    const db = as(env, DAN).firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'groups'), where('memberIds', 'array-contains', DAN))),
    );
  });

  it('denies an unfiltered list', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(getDocs(collection(db, 'groups')));
  });

  it('denies a query filtered to somebody else’s memberIds', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      getDocs(query(collection(db, 'groups'), where('memberIds', 'array-contains', BOB))),
    );
  });

  it('denies a signed-out list', async () => {
    const db = asAnon(env).firestore();
    await assertFails(
      getDocs(query(collection(db, 'groups'), where('memberIds', 'array-contains', ALICE))),
    );
  });
});

describe('groups — create', () => {
  it('allows a signed-in user to create a group they solely belong to', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc()));
  });

  it('denies a signed-out creator', async () => {
    const db = asAnon(env).firestore();
    await assertFails(setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc()));
  });

  // T7
  it('denies createdBy naming somebody else', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ createdBy: BOB })));
  });

  // T4
  it('denies seeding memberIds with anyone but the creator', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ memberIds: [ALICE, BOB] })),
    );
  });

  it('denies memberIds that omit the creator', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ memberIds: [BOB] })));
  });

  it('denies a memberCount that is not 1', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ memberCount: 2 })));
  });

  it('denies an empty name', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ name: '' })));
  });

  it('denies a name longer than 60 characters', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ name: 'x'.repeat(61) })),
    );
  });

  it('allows a 60-character name', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(
      setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ name: 'x'.repeat(60) })),
    );
  });

  it('denies a non-string name', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ name: 42 })));
  });

  it('denies a type outside the enum', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ type: 'work' })));
  });

  it('allows every creatable type', async () => {
    const db = as(env, ALICE).firestore();
    for (const type of ['trip', 'home', 'friends', 'other']) {
      await assertSucceeds(setDoc(doc(db, `groups/${type}_grp`), newGroupDoc({ type })));
    }
  });

  it('refuses to create a group under the retired couple type', async () => {
    // `couple` still decodes, so a document carrying it keeps loading — but Rules must not
    // let a new one in, or the pick list stops being the truth.
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, 'groups/couple_grp'), newGroupDoc({ type: 'couple' })));
  });

  it('refuses to let a client create the implicit friend type', async () => {
    // Only establishFriendship creates these, and it runs through the Admin SDK, which does
    // not consult Rules at all. A client asking for one is forging a hidden group.
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, 'groups/friend_grp'), newGroupDoc({ type: 'friend' })));
  });

  it('denies a non-boolean isImplicit', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ isImplicit: 'false' })));
  });

  it('denies a client-created implicit group', async () => {
    // Implicit groups are hidden from the group list. A client that could set this flag could
    // hide a group from the person it belongs to.
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ isImplicit: true })));
  });

  it('denies a currency that is not three uppercase letters', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ currency: 'usd' })));
    await assertFails(setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ currency: 'US' })));
    await assertFails(setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ currency: 'DOLLAR' })));
    await assertFails(setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ currency: 840 })));
  });

  // T7
  it('denies a backdated createdAt', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ createdAt: PAST })));
  });

  it('denies a group created already deleted', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `groups/${NEW_GROUP}`), newGroupDoc({ deletedAt: PAST })));
  });
});

describe('groups — update', () => {
  it('allows a member to rename the group', async () => {
    const db = as(env, BOB).firestore();
    await assertSucceeds(updateDoc(doc(db, `groups/${GROUP}`), { name: 'Porto trip' }));
  });

  it('allows a member to change the type and lastActivityAt', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `groups/${GROUP}`), { type: 'home', lastActivityAt: serverTimestamp() }),
    );
  });

  it('denies a non-member', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(updateDoc(doc(db, `groups/${GROUP}`), { name: 'Porto trip' }));
  });

  it('denies a signed-out writer', async () => {
    const db = asAnon(env).firestore();
    await assertFails(updateDoc(doc(db, `groups/${GROUP}`), { name: 'Porto trip' }));
  });

  // T4
  it('denies a member adding somebody to memberIds', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(updateDoc(doc(db, `groups/${GROUP}`), { memberIds: [ALICE, BOB, CAROL] }));
  });

  // T4
  it('denies a departed member adding themselves back to memberIds', async () => {
    const db = as(env, DAN).firestore();
    await assertFails(
      updateDoc(doc(db, `groups/${GROUP}`), { memberIds: [ALICE, BOB, DAN], memberCount: 3 }),
    );
  });

  // T4
  it('denies the admin removing somebody from memberIds', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, `groups/${GROUP}`), { memberIds: [ALICE] }));
  });

  it('denies changing memberCount', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, `groups/${GROUP}`), { memberCount: 3 }));
  });

  // T10
  it('denies changing the currency', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, `groups/${GROUP}`), { currency: 'EUR' }));
  });

  it('denies changing createdBy', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(updateDoc(doc(db, `groups/${GROUP}`), { createdBy: BOB }));
  });

  it('denies changing createdAt', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, `groups/${GROUP}`), { createdAt: serverTimestamp() }));
  });

  it('denies changing isImplicit', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, `groups/${GROUP}`), { isImplicit: true }));
  });

  it('denies renaming to an empty name', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, `groups/${GROUP}`), { name: '' }));
  });

  it('denies renaming to more than 60 characters', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, `groups/${GROUP}`), { name: 'x'.repeat(61) }));
  });

  it('denies renaming to a non-string', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, `groups/${GROUP}`), { name: null }));
  });
});

describe('groups — delete', () => {
  it('denies the admin who created the group', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(deleteDoc(doc(db, `groups/${GROUP}`)));
  });

  it('denies an ordinary member', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(deleteDoc(doc(db, `groups/${GROUP}`)));
  });

  it('denies a non-member', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(deleteDoc(doc(db, `groups/${GROUP}`)));
  });

  it('denies a signed-out caller', async () => {
    const db = asAnon(env).firestore();
    await assertFails(deleteDoc(doc(db, `groups/${GROUP}`)));
  });
});

describe('groups/{groupId}/members — read', () => {
  it('allows a member to read their own member doc', async () => {
    const db = as(env, BOB).firestore();
    await assertSucceeds(getDoc(doc(db, `groups/${GROUP}/members/${BOB}`)));
  });

  it('allows a member to read another member’s doc', async () => {
    const db = as(env, BOB).firestore();
    await assertSucceeds(getDoc(doc(db, `groups/${GROUP}/members/${ALICE}`)));
  });

  it('allows a member to list the roster', async () => {
    const db = as(env, ALICE).firestore();
    await assertSucceeds(getDocs(collection(db, `groups/${GROUP}/members`)));
  });

  // T1
  it('denies a non-member reading a member doc', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(getDoc(doc(db, `groups/${GROUP}/members/${ALICE}`)));
  });

  it('denies a non-member listing the roster', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(getDocs(collection(db, `groups/${GROUP}/members`)));
  });

  it('denies a signed-out reader', async () => {
    const db = asAnon(env).firestore();
    await assertFails(getDoc(doc(db, `groups/${GROUP}/members/${ALICE}`)));
  });
});

describe('groups/{groupId}/members — write', () => {
  it('denies the admin writing their own member doc', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, `groups/${GROUP}/members/${ALICE}`), { displayName: 'Alice A.' }),
    );
  });

  it('denies the admin overwriting their own member doc wholesale', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `groups/${GROUP}/members/${ALICE}`), memberDoc(ALICE)));
  });

  // T2
  it('denies a member zeroing out their own balanceMinor', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(
      updateDoc(doc(db, `groups/${GROUP}/members/${BOB}`), { balanceMinor: { USD: 0 } }),
    );
  });

  // T2
  it('denies the admin rewriting another member’s balanceMinor', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, `groups/${GROUP}/members/${BOB}`), { balanceMinor: { USD: -5000 } }),
    );
  });

  it('denies the admin promoting another member', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(updateDoc(doc(db, `groups/${GROUP}/members/${BOB}`), { role: 'admin' }));
  });

  // T4
  it('denies an outsider creating their own member doc', async () => {
    const db = as(env, CAROL).firestore();
    await assertFails(setDoc(doc(db, `groups/${GROUP}/members/${CAROL}`), memberDoc(CAROL)));
  });

  // T4
  it('denies the admin adding a member doc for somebody else', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(setDoc(doc(db, `groups/${GROUP}/members/${CAROL}`), memberDoc(CAROL)));
  });

  it('denies the admin deleting a member doc', async () => {
    const db = as(env, ALICE).firestore();
    await assertFails(deleteDoc(doc(db, `groups/${GROUP}/members/${BOB}`)));
  });

  it('denies a member deleting their own member doc', async () => {
    const db = as(env, BOB).firestore();
    await assertFails(deleteDoc(doc(db, `groups/${GROUP}/members/${BOB}`)));
  });

  it('denies a signed-out writer', async () => {
    const db = asAnon(env).firestore();
    await assertFails(setDoc(doc(db, `groups/${GROUP}/members/${CAROL}`), memberDoc(CAROL)));
  });
});
