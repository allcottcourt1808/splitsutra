/**
 * Typed, converter-attached Firestore references — the collection map of docs/03-data-model.md
 * expressed once, in code.
 *
 * Every `collection()` and `doc()` call in the product is in this file. Two reasons:
 *
 * 1. **Paths are typos waiting to happen.** `'gropus'` fails as a permission-denied, not as a
 *    404, because Rules deny an unmatched path. Spelling each path once turns that class of
 *    bug into a compile error.
 * 2. **The converter can't be forgotten.** Every reference below leaves here with
 *    `.withConverter(...)` already applied, so a malformed document throws a
 *    `DocumentParseError` naming its path at the boundary rather than surfacing as an
 *    `undefined` amount three screens later (`types/converters.ts`).
 *
 * 🔴 Not re-exported from `repositories/index.ts`. Handing a screen a `DocumentReference` is
 * Article VIII with extra steps — it can `getDoc()` that reference without ever importing
 * Firestore, which is exactly the coupling the article exists to prevent.
 */

import {
  collection,
  doc,
  type CollectionReference,
  type DocumentReference,
} from 'firebase/firestore';

import { getDb } from '../firebase/index.js';
import {
  friendConverter,
  friendRequestConverter,
  groupConverter,
  groupMemberConverter,
  userConverter,
  usernameIndexConverter,
  type Friend,
  type FriendRequest,
  type Group,
  type GroupMember,
  type User,
  type UsernameIndex,
} from '../types/index.js';

/**
 * Collection segment names, in one place.
 *
 * These strings also appear in `firestore.rules` and in `firebase/functions`; there is no way
 * to share a constant across a `.rules` file, so this is a copy by necessity. If one changes,
 * all three change together.
 */
export const COLLECTION = {
  users: 'users',
  usernames: 'usernames',
  friends: 'friends',
  friendRequests: 'friendRequests',
  groups: 'groups',
  members: 'members',
} as const;

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * users/
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** `users/{uid}` — the private profile. Readable only by its owner. */
export function userDoc(uid: string): DocumentReference<User> {
  return doc(getDb(), COLLECTION.users, uid).withConverter(userConverter);
}

/**
 * `usernames/{normalizedKey}` — the friend-lookup index.
 *
 * `get` only, never `list`: Rules deny enumeration so the collection cannot be harvested for
 * emails and phone numbers (threat T5). The key is `sha256(lower(email))` or
 * `sha256(e164(phone))` in hex — see `src/utils/` once the hash helper lands in Phase 05.
 */
export function usernameDoc(normalizedKey: string): DocumentReference<UsernameIndex> {
  return doc(getDb(), COLLECTION.usernames, normalizedKey).withConverter(usernameIndexConverter);
}

/** `users/{uid}/friends` — Function-written, owner-readable. */
export function friendsCollection(uid: string): CollectionReference<Friend> {
  return collection(getDb(), COLLECTION.users, uid, COLLECTION.friends).withConverter(
    friendConverter,
  );
}

/** `users/{uid}/friends/{friendUid}`. */
export function friendDoc(uid: string, friendUid: string): DocumentReference<Friend> {
  return doc(getDb(), COLLECTION.users, uid, COLLECTION.friends, friendUid).withConverter(
    friendConverter,
  );
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * friendRequests/
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * `friendRequests` — the root collection. Function-written; both parties may read.
 *
 * Top-level rather than a subcollection under the recipient, because BOTH parties need to read
 * a request: the recipient to answer it, the sender to see that it is still outstanding. Rules
 * allow a `users/{uid}` read only where `isSelf(uid)`, so a subcollection would have made the
 * sender's own outbox unreadable to them and forced a second, mirrored document to exist purely
 * so it could be read — two documents to keep in step for one fact.
 */
export function friendRequestsCollection(): CollectionReference<FriendRequest> {
  return collection(getDb(), COLLECTION.friendRequests).withConverter(friendRequestConverter);
}

/** `friendRequests/{requestId}`. Build the id with `friendRequestId(fromUid, toUid)`. */
export function friendRequestDoc(requestId: string): DocumentReference<FriendRequest> {
  return doc(getDb(), COLLECTION.friendRequests, requestId).withConverter(friendRequestConverter);
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * groups/
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** `groups` — the root collection. */
export function groupsCollection(): CollectionReference<Group> {
  return collection(getDb(), COLLECTION.groups).withConverter(groupConverter);
}

/** `groups/{groupId}`. */
export function groupDoc(groupId: string): DocumentReference<Group> {
  return doc(getDb(), COLLECTION.groups, groupId).withConverter(groupConverter);
}

/**
 * `groups/{groupId}/members` — membership, and the balance cache.
 *
 * Read-only to clients in every direction (Article III, threats T2/T4): joins, leaves, role
 * changes and balances are all Cloud Function writes.
 */
export function membersCollection(groupId: string): CollectionReference<GroupMember> {
  return collection(getDb(), COLLECTION.groups, groupId, COLLECTION.members).withConverter(
    groupMemberConverter,
  );
}

/** `groups/{groupId}/members/{uid}`. */
export function memberDoc(groupId: string, uid: string): DocumentReference<GroupMember> {
  return doc(getDb(), COLLECTION.groups, groupId, COLLECTION.members, uid).withConverter(
    groupMemberConverter,
  );
}
