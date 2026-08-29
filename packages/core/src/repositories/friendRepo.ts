/**
 * `users/{uid}/friends/{friendUid}` — the established friendships.
 *
 * Read-only from a client in every direction (Rules: `allow write: if false`). A document
 * appears here only when a `friendRequests` document was accepted, and both directions are
 * written in the same transaction that creates the implicit group.
 *
 * Sorted client-side rather than by Firestore: `displayName` is a denormalized snapshot that the
 * profile fan-out rewrites, an `orderBy` on it would need its own index, and a friends list is
 * bounded by how many people someone actually shares expenses with. Article XII — this is not
 * where the cost is.
 */

import { type Friend } from '../types/index.js';
import { friendDoc, friendsCollection } from './refs.js';
import { watchDoc, watchQuery, type OnError, type OnNext, type Unsubscribe } from './subscribe.js';

/** Case-insensitive by display name, so the list does not reorder when someone renames a friend. */
function byDisplayName(a: Friend, b: Friend): number {
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
}

/**
 * Subscribe to the signed-in user's friends, ordered by name.
 *
 * Rules permit this only where the path's `{uid}` is the caller, so it works for the signed-in
 * user and nobody else.
 */
export function watchFriends(
  uid: string,
  onNext: OnNext<readonly Friend[]>,
  onError: OnError,
): Unsubscribe {
  return watchQuery(
    friendsCollection(uid),
    (friends) => {
      onNext([...friends].sort(byDisplayName));
    },
    onError,
  );
}

/** Subscribe to one friendship. Emits `null` when they are not (or are no longer) a friend. */
export function watchFriend(
  uid: string,
  friendUid: string,
  onNext: OnNext<Friend | null>,
  onError: OnError,
): Unsubscribe {
  return watchDoc(friendDoc(uid, friendUid), onNext, onError);
}
