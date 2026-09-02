import { HttpsError } from 'firebase-functions/v2/https';

import { FieldValue, Timestamp, db, type Transaction } from '../common/admin.js';

/**
 * Group and profile reads shared by the triggers and the callables.
 *
 * Everything that comes out of Firestore is treated as `unknown` and narrowed here
 * rather than cast at each call site — Admin SDK reads are NOT subject to
 * `firestore.rules`, so a document reaching this code has been validated by
 * nothing at all until this file says otherwise (see `common/admin.ts`).
 */

export interface GroupRecord {
  id: string;
  name: string;
  currency: string;
  memberIds: string[];
  memberCount: number;
  isImplicit: boolean;
  createdBy: string;
  deletedAt: unknown;
}

function narrowGroup(id: string, raw: Record<string, unknown> | undefined): GroupRecord | null {
  if (raw === undefined) return null;
  const currency = raw['currency'];
  const name = raw['name'];
  const memberIds = raw['memberIds'];
  if (typeof currency !== 'string' || typeof name !== 'string' || !Array.isArray(memberIds)) {
    return null;
  }
  return {
    id,
    name,
    currency,
    memberIds: memberIds.filter((m): m is string => typeof m === 'string'),
    memberCount: typeof raw['memberCount'] === 'number' ? raw['memberCount'] : memberIds.length,
    isImplicit: raw['isImplicit'] === true,
    createdBy: typeof raw['createdBy'] === 'string' ? raw['createdBy'] : '',
    deletedAt: raw['deletedAt'] ?? null,
  };
}

/** Trigger-side read. Returns `null` rather than throwing — a trigger has no caller. */
export async function readGroup(gid: string): Promise<GroupRecord | null> {
  const snap = await db.doc(`groups/${gid}`).get();
  return narrowGroup(gid, snap.data());
}

/** Callable-side read. `not-found` if it is missing or soft-deleted (D5). */
export async function requireGroup(gid: string): Promise<GroupRecord> {
  const group = await readGroup(gid);
  if (group === null) {
    throw new HttpsError('not-found', 'Group not found.');
  }
  if (group.deletedAt !== null) {
    throw new HttpsError('not-found', 'This group has been deleted.');
  }
  return group;
}

export async function readGroupInTransaction(
  tx: Transaction,
  gid: string,
): Promise<GroupRecord | null> {
  const snap = await tx.get(db.doc(`groups/${gid}`));
  return narrowGroup(gid, snap.data());
}

/** The denormalized public projection copied into member docs and friend docs (D4). */
export interface ProfileSnapshot {
  displayName: string;
  photoURL: string | null;
}

/**
 * Reads `users/{uid}` for the fields that get denormalized elsewhere.
 *
 * Falls back to a placeholder rather than failing: docs/06 §"User profile creation"
 * makes the profile client-upserted and explicitly self-healing, so a member doc
 * must still be creatable in the window before the profile lands. Names are
 * cosmetic and never used for authorization, so a stale one is a display bug, not
 * a security one — `onUserProfileWritten` repairs it on the next profile write.
 */
export async function profileSnapshot(uid: string): Promise<ProfileSnapshot> {
  const snap = await db.doc(`users/${uid}`).get();
  const raw = snap.data();
  const displayName = raw?.['displayName'];
  const photoURL = raw?.['photoURL'];
  return {
    displayName: typeof displayName === 'string' && displayName.length > 0 ? displayName : 'Member',
    photoURL: typeof photoURL === 'string' ? photoURL : null,
  };
}

/**
 * A fresh `groups/{gid}/members/{uid}` document.
 *
 * 🔴 `balanceMinor` is seeded to 0 and is thereafter written ONLY by the balance
 *    pipeline (`common/balances.ts`). Never re-`set()` a member doc that may
 *    already exist — that resets a live balance to zero, which is precisely the T2
 *    attack, self-inflicted. Every caller here checks existence first.
 */
export function newMemberDoc(
  uid: string,
  role: 'admin' | 'member',
  profile: ProfileSnapshot,
): Record<string, unknown> {
  return {
    uid,
    role,
    displayName: profile.displayName,
    photoURL: profile.photoURL,
    balanceMinor: 0,
    joinedAt: FieldValue.serverTimestamp(),
    // Explicitly null, never omitted: `requireActiveMember` in common/callable.ts
    // tests `leftAt !== null`, so a missing field would read as "has left".
    leftAt: null,
  };
}

/**
 * The name to print in an activity summary.
 *
 * Prefers the member doc's denormalized snapshot (D4 — it is the name that was
 * current in this group) and falls back to the profile, then to the uid. Never
 * throws: a feed entry with an ugly name beats no feed entry at all (T8 depends on
 * the entry existing).
 */
export async function memberName(gid: string, uid: string): Promise<string> {
  const snap = await db.doc(`groups/${gid}/members/${uid}`).get();
  const denormalized = snap.data()?.['displayName'];
  if (typeof denormalized === 'string' && denormalized.length > 0) return denormalized;
  const profile = await profileSnapshot(uid);
  return profile.displayName.length > 0 ? profile.displayName : uid;
}

export interface MemberSummary {
  uid: string;
  role: 'admin' | 'member';
  displayName: string;
  balanceMinor: number;
  hasLeft: boolean;
}

/** Every member document in a group, narrowed. Includes people who have left. */
export async function readAllMembers(gid: string): Promise<MemberSummary[]> {
  const snap = await db.collection(`groups/${gid}/members`).get();
  return snap.docs.map((doc) => {
    const raw = doc.data();
    const balanceMinor = raw['balanceMinor'];
    const displayName = raw['displayName'];
    return {
      uid: doc.id,
      role: raw['role'] === 'admin' ? 'admin' : 'member',
      displayName: typeof displayName === 'string' ? displayName : doc.id,
      balanceMinor: typeof balanceMinor === 'number' ? balanceMinor : 0,
      hasLeft: raw['leftAt'] != null,
    };
  });
}

/**
 * Marks a member as departed, in the caller's transaction.
 *
 * docs/06 §"leaveGroup": leaving sets `leftAt` and drops the uid from `memberIds`
 * — it does NOT delete the member document, because historical expenses still
 * reference that person and the group must still render (Article V).
 *
 * `memberCount` is recomputed from the resulting array rather than decremented.
 * A decrement drifts permanently the first time it runs twice; a recount cannot.
 */
export function markMemberLeftInTransaction(
  tx: Transaction,
  group: GroupRecord,
  uid: string,
): void {
  const remaining = group.memberIds.filter((id) => id !== uid);
  tx.update(db.doc(`groups/${group.id}/members/${uid}`), {
    leftAt: Timestamp.now(),
  });
  tx.update(db.doc(`groups/${group.id}`), {
    memberIds: remaining,
    memberCount: remaining.length,
  });
}

/**
 * ADR-13 — promote a friendship's group to an ordinary one the first time it holds an expense.
 *
 * ## Why a friendship starts hidden, and why it should not stay hidden
 *
 * D2 makes a friendship a group with `isImplicit: true`, filtered out of the Groups tab. That
 * is right for a friendship with no money in it: fifty friends would otherwise mean fifty
 * one-person cards, and the Groups tab would stop being useful.
 *
 * The cost only appears once money arrives. Every group feature then needs a second,
 * friend-shaped entry point, because the group screens are unreachable — the expense list, the
 * balance, settling up and a server-side balance projection were each built or fixed separately
 * for exactly this reason, and comments, activity and editing would have been next. A hidden
 * group is a group whose features have to be re-implemented one at a time.
 *
 * So the moment a friendship has an expense it becomes an ordinary group and inherits all of
 * them. Nothing moves: the group keeps its id, so `friends/{fid}.implicitGroupId` still points
 * at it, the ledger is untouched, and the friend screen keeps working.
 *
 * `type` stays `'friend'` — it is in `GROUP_TYPES` and the UI labels it "Friends", so the group
 * says what it is rather than pretending to be a trip. Only `isImplicit` changes.
 *
 * ## 🔴 Diff-guarded, and it has to be
 *
 * Writes ONLY when `isImplicit` is actually true. `onExpenseWritten` calls this on every expense
 * write, and an unconditional update would rewrite the group document on every expense in every
 * friendship forever (Article XI). It also cannot loop: `onGroupCreated` triggers on document
 * CREATE, so updating a group re-fires nothing.
 *
 * ⚠️ Promotion is one-way and there is no demotion. Deleting the last expense leaves an ordinary
 * group behind rather than hiding it again — reappearing and disappearing from the Groups tab as
 * a balance crosses zero would be worse than staying.
 */
export async function promoteFriendshipIfNeeded(gid: string): Promise<boolean> {
  const ref = db.doc(`groups/${gid}`);
  const snap = await ref.get();
  if (snap.data()?.['isImplicit'] !== true) return false;

  await ref.update({ isImplicit: false, lastActivityAt: FieldValue.serverTimestamp() });
  return true;
}
