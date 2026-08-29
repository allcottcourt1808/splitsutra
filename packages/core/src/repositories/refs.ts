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
  collectionGroup,
  doc,
  query,
  where,
  type CollectionReference,
  type DocumentReference,
  type Query,
} from 'firebase/firestore';

import { getDb } from '../firebase/index.js';
import {
  activityConverter,
  commentConverter,
  expenseConverter,
  friendConverter,
  friendRequestConverter,
  groupConverter,
  groupMemberConverter,
  settlementConverter,
  userConverter,
  usernameIndexConverter,
  type Activity,
  type Comment,
  type Expense,
  type Friend,
  type FriendRequest,
  type Group,
  type GroupMember,
  type Settlement,
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
  expenses: 'expenses',
  settlements: 'settlements',
  comments: 'comments',
  activity: 'activity',
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

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * groups/{groupId}/expenses/
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** `groups/{groupId}/expenses`. */
export function expensesCollection(groupId: string): CollectionReference<Expense> {
  return collection(getDb(), COLLECTION.groups, groupId, COLLECTION.expenses).withConverter(
    expenseConverter,
  );
}

/** `groups/{groupId}/expenses/{expenseId}`. */
export function expenseDoc(groupId: string, expenseId: string): DocumentReference<Expense> {
  return doc(getDb(), COLLECTION.groups, groupId, COLLECTION.expenses, expenseId).withConverter(
    expenseConverter,
  );
}

/**
 * Every expense the user participates in, across groups.
 *
 * 🔴 The `participantIds` constraint is not optional. The `/{path=**}/expenses/{eid}` rule
 * allows a collection-group read only where the caller is in `participantIds`, and Firestore
 * accepts a query only when the rule is satisfiable from the query's own constraints — drop
 * the `where` and the whole query is denied. Baked in here so no caller can get it wrong.
 */
export function participatingExpensesQuery(uid: string): Query<Expense> {
  return query(
    collectionGroup(getDb(), COLLECTION.expenses).withConverter(expenseConverter),
    where('participantIds', 'array-contains', uid),
  );
}

/** `groups/{groupId}/expenses/{expenseId}/comments`. */
export function commentsCollection(
  groupId: string,
  expenseId: string,
): CollectionReference<Comment> {
  return collection(
    getDb(),
    COLLECTION.groups,
    groupId,
    COLLECTION.expenses,
    expenseId,
    COLLECTION.comments,
  ).withConverter(commentConverter);
}

/** `groups/{groupId}/expenses/{expenseId}/comments/{commentId}`. */
export function commentDoc(
  groupId: string,
  expenseId: string,
  commentId: string,
): DocumentReference<Comment> {
  return doc(
    getDb(),
    COLLECTION.groups,
    groupId,
    COLLECTION.expenses,
    expenseId,
    COLLECTION.comments,
    commentId,
  ).withConverter(commentConverter);
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * groups/{groupId}/settlements/  ·  groups/{groupId}/activity/
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** `groups/{groupId}/settlements`. */
export function settlementsCollection(groupId: string): CollectionReference<Settlement> {
  return collection(getDb(), COLLECTION.groups, groupId, COLLECTION.settlements).withConverter(
    settlementConverter,
  );
}

/** `groups/{groupId}/settlements/{settlementId}`. */
export function settlementDoc(
  groupId: string,
  settlementId: string,
): DocumentReference<Settlement> {
  return doc(
    getDb(),
    COLLECTION.groups,
    groupId,
    COLLECTION.settlements,
    settlementId,
  ).withConverter(settlementConverter);
}

/**
 * `groups/{groupId}/activity` — read-only to clients (threat T8).
 *
 * There is no collection-group rule for `activity`, so a cross-group feed is one query per
 * group, merged client-side. That is deliberate; see checklists/phase-08 §"The N-query
 * problem" before replacing it with a `users/{uid}/feed` mirror.
 */
export function activityCollection(groupId: string): CollectionReference<Activity> {
  return collection(getDb(), COLLECTION.groups, groupId, COLLECTION.activity).withConverter(
    activityConverter,
  );
}
