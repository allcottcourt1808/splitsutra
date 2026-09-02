// The invite / redeem round-trip — the only path by which anybody joins a group.
//
// This is the flow that exists BECAUSE the rules deny it: `groups/{gid}/members/{uid}` is
// `allow write: if false` for every client (T2 + T4) and `invites/{inviteId}` is
// `allow read, write: if false` outright, so a client can neither add itself to a group nor
// even see the credential that would let it. Only the Admin SDK bridges that gap, which means
// every authorization decision on this path is made in `redeemInvite`'s function body — and a
// function body is only testable by calling it.
//
// The `invites/` denial tests here are not a duplicate of tests/rules. The rules suite can only
// deny a made-up document id; these hold a REAL invite id and a REAL token, handed back by
// `createInvite` moments earlier, and show that possessing them buys a client nothing.

import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

import {
  createGroup,
  createProfile,
  createTestEnv,
  groupOf,
  isPermissionDenied,
  memberDocOf,
  rejectionCode,
  serverDoc,
  signIn,
  signedOut,
  waitFor,
  type Actor,
  type AnonymousActor,
} from './helpers';

interface InviteResult {
  inviteId: string;
  token: string;
  groupName: string;
  expiresAtMillis: number;
  redeemedCount: number;
  created: boolean;
}

interface RedeemResult {
  groupId: string;
  groupName: string;
  alreadyMember: boolean;
}

let env: RulesTestEnvironment;
let alice: Actor;
let bob: Actor;
let carol: Actor;
let anon: AnonymousActor;

const ALICE_EMAIL = 'invites-alice@example.com';
const BOB_EMAIL = 'invites-bob@example.com';
const CAROL_EMAIL = 'invites-carol@example.com';

let groupSeq = 0;
function nextGroupId(): string {
  groupSeq += 1;
  return `grp_invites_${String(groupSeq)}`;
}

// One clear, at the start. See the note in balances.test.ts: clearing between tests races the
// asynchronous triggers this suite exists to observe.
beforeAll(async () => {
  env = await createTestEnv();
  await env.clearFirestore();
  alice = await signIn(ALICE_EMAIL, 'Alice Example');
  bob = await signIn(BOB_EMAIL, 'Bob Example');
  carol = await signIn(CAROL_EMAIL, 'Carol Example');
  anon = signedOut();
  await createProfile(alice);
  await createProfile(bob);
  await createProfile(carol);
});

afterAll(async () => {
  await alice.dispose();
  await bob.dispose();
  await carol.dispose();
  await anon.dispose();
  await env.cleanup();
});

describe('createInvite — one live link at a time', () => {
  it('mints a link for an active member and returns the token exactly once', async () => {
    const gid = nextGroupId();
    await createGroup(alice, gid);

    const invite = await alice.call<InviteResult>('createInvite', { groupId: gid });
    expect(invite.created).toBe(true);
    expect(invite.groupName).toBe('Lisbon trip');
    expect(invite.redeemedCount).toBe(0);
    // 128 bits of lowercase hex — `inviteSchema.token` and `redeemInviteSchema` both require it,
    // and it is the entire access-control decision `redeemInvite` makes.
    expect(invite.token).toMatch(/^[0-9a-f]{32}$/);
    expect(invite.expiresAtMillis).toBeGreaterThan(Date.now());
  });

  it('returns the SAME link on a second call rather than minting a second door', async () => {
    const gid = nextGroupId();
    await createGroup(alice, gid);

    const first = await alice.call<InviteResult>('createInvite', { groupId: gid });
    const second = await alice.call<InviteResult>('createInvite', { groupId: gid });

    expect(second.created).toBe(false);
    expect(second.inviteId).toBe(first.inviteId);
    expect(second.token).toBe(first.token);
  });

  it('reset revokes the old token and issues a new one', async () => {
    const gid = nextGroupId();
    await createGroup(alice, gid);

    const first = await alice.call<InviteResult>('createInvite', { groupId: gid });
    const reset = await alice.call<InviteResult>('createInvite', { groupId: gid, reset: true });

    expect(reset.created).toBe(true);
    expect(reset.token).not.toBe(first.token);

    // The counterweight to a link that keeps working: nobody still holding the old string can
    // open this group.
    expect(await rejectionCode(carol.call('redeemInvite', { token: first.token }))).toBe(
      'functions/failed-precondition',
    );
    await expect(carol.call<RedeemResult>('redeemInvite', { token: reset.token })).resolves.toEqual(
      expect.objectContaining({ groupId: gid, alreadyMember: false }),
    );
  });

  it('refuses a caller who is not a member of the group', async () => {
    const gid = nextGroupId();
    await createGroup(alice, gid);

    expect(await rejectionCode(bob.call('createInvite', { groupId: gid }))).toBe(
      'functions/permission-denied',
    );
    expect(await rejectionCode(anon.call('createInvite', { groupId: gid }))).toBe(
      'functions/unauthenticated',
    );
  });
});

describe('invites/{inviteId} — unreachable to every client, real id and all', () => {
  it('denies read, list-by-token, and every kind of write', async () => {
    const gid = nextGroupId();
    await createGroup(alice, gid);
    const invite = await alice.call<InviteResult>('createInvite', { groupId: gid });

    // The group's own admin, who just created this invite and knows its id.
    expect(await isPermissionDenied(getDoc(doc(alice.db, `invites/${invite.inviteId}`)))).toBe(
      true,
    );
    // Harvesting by token — the query the join screen would want if it could have it.
    expect(
      await isPermissionDenied(
        getDocs(query(collection(alice.db, 'invites'), where('token', '==', invite.token))),
      ),
    ).toBe(true);
    // And the whole collection, which would leak every group name in the database.
    expect(await isPermissionDenied(getDocs(collection(carol.db, 'invites')))).toBe(true);
    expect(await isPermissionDenied(getDoc(doc(anon.db, `invites/${invite.inviteId}`)))).toBe(true);

    // Writes: minting yourself a door, revoking somebody else's, and deleting the record.
    expect(
      await isPermissionDenied(
        setDoc(doc(carol.db, 'invites/forged'), {
          token: '0'.repeat(32),
          groupId: gid,
          status: 'pending',
        }),
      ),
    ).toBe(true);
    expect(
      await isPermissionDenied(
        setDoc(doc(alice.db, `invites/${invite.inviteId}`), { status: 'revoked' }),
      ),
    ).toBe(true);
    expect(await isPermissionDenied(deleteDoc(doc(alice.db, `invites/${invite.inviteId}`)))).toBe(
      true,
    );

    // The token still works, so none of the refusals above damaged the invite.
    const redeemed = await bob.call<RedeemResult>('redeemInvite', { token: invite.token });
    expect(redeemed.alreadyMember).toBe(false);
  });
});

describe('redeemInvite — the join', () => {
  it('adds the member, widens memberIds, and writes the activity entry', async () => {
    const gid = nextGroupId();
    await createGroup(alice, gid);
    const invite = await alice.call<InviteResult>('createInvite', { groupId: gid });

    const result = await bob.call<RedeemResult>('redeemInvite', { token: invite.token });
    expect(result).toEqual({ groupId: gid, groupName: 'Lisbon trip', alreadyMember: false });

    await waitFor(
      'Bob’s member document to exist',
      () => serverDoc(`groups/${gid}/members/${bob.uid}`),
      (member) => member !== null,
    );

    const member = await memberDocOf(bob, gid, bob.uid);
    expect(member?.role).toBe('member');
    expect(member?.leftAt).toBeNull();
    expect(member?.balanceMinor).toBe(0);

    // `memberCount` is recomputed from the array, never incremented — an increment drifts
    // permanently the first time it runs twice.
    const group = await groupOf(bob, gid);
    expect(group?.['memberIds']).toEqual([alice.uid, bob.uid]);
    expect(group?.['memberCount']).toBe(2);

    // T8: the feed entry commits in the SAME transaction as the join, so a join that happened
    // is always visible and one that rolled back never is.
    const activity = await getDocs(collection(bob.db, `groups/${gid}/activity`));
    const joined = activity.docs.map((d) => d.data()).filter((a) => a['type'] === 'member.joined');
    expect(joined).toHaveLength(1);
    expect(joined[0]?.['actorUid']).toBe(bob.uid);
  });

  it('is idempotent — a double tap is success, not an error', async () => {
    const gid = nextGroupId();
    await createGroup(alice, gid);
    const invite = await alice.call<InviteResult>('createInvite', { groupId: gid });

    await bob.call<RedeemResult>('redeemInvite', { token: invite.token });
    const again = await bob.call<RedeemResult>('redeemInvite', { token: invite.token });
    expect(again.alreadyMember).toBe(true);

    const group = await groupOf(bob, gid);
    expect(group?.['memberIds']).toEqual([alice.uid, bob.uid]);
    expect(group?.['memberCount']).toBe(2);
  });

  it('stays open for the next person — a shared link is not consumed by the first tap', async () => {
    const gid = nextGroupId();
    await createGroup(alice, gid);
    const invite = await alice.call<InviteResult>('createInvite', { groupId: gid });

    await bob.call<RedeemResult>('redeemInvite', { token: invite.token });
    const second = await carol.call<RedeemResult>('redeemInvite', { token: invite.token });
    expect(second.alreadyMember).toBe(false);

    const stored = await serverDoc(`invites/${invite.inviteId}`);
    expect(stored?.['status']).toBe('pending');
    expect(stored?.['redeemedBy']).toEqual([bob.uid, carol.uid]);
  });

  it('rejects an unknown token, a malformed one, and a caller with no token at all', async () => {
    // Well-formed but never minted: 128 bits of hex that nothing issued.
    expect(await rejectionCode(bob.call('redeemInvite', { token: 'a'.repeat(32) }))).toBe(
      'functions/not-found',
    );
    // Refused by the shared Zod schema before it costs a Firestore read.
    expect(await rejectionCode(bob.call('redeemInvite', { token: 'not-a-token' }))).toBe(
      'functions/invalid-argument',
    );
    expect(await rejectionCode(bob.call('redeemInvite', {}))).toBe('functions/invalid-argument');
    expect(await rejectionCode(anon.call('redeemInvite', { token: 'a'.repeat(32) }))).toBe(
      'functions/unauthenticated',
    );
  });
});
