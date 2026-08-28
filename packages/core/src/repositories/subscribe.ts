/**
 * The `onSnapshot` seam — every realtime subscription in the product funnels through here.
 *
 * Firestore already *is* a realtime sync engine, so server state reaches the UI as a
 * subscription rather than as a fetch-and-cache (docs/02 §Technology choices). These two
 * helpers are the whole mechanism; the repositories above them only build queries.
 *
 * ## Why the callbacks are wrapped in try/catch
 *
 * The converters parse inside `snapshot.data()`, which runs *inside* the `next` callback.
 * An unhandled throw there escapes into the SDK's listener loop, where nothing owns it: the
 * subscription survives, the component never hears about it, and the screen sits on a spinner
 * for ever. Catching it and routing it to `onError` is what makes the promise in
 * `types/converters.ts` — "a malformed document fails here rather than in a component" — true
 * for subscriptions and not only for one-shot reads.
 *
 * ## Why one bad document fails the whole list
 *
 * {@link watchQuery} does not skip an unparseable document. Silently dropping a group the user
 * is a member of would present as data loss with no error anywhere — strictly worse than a
 * loud failure, because the user's own conclusion is that the app ate their group. A
 * `DocumentParseError` is a bug report; it is meant to be noisy.
 */

import { onSnapshot, type DocumentReference, type Query } from 'firebase/firestore';

/**
 * Cancels a subscription.
 *
 * Declared here rather than re-exported from `firebase/firestore` so that a hook, a screen, or
 * the React Native port can hold one without importing the SDK — the Firestore and Auth
 * `Unsubscribe` types are structurally this, and a caller should not have to know which one it
 * was handed.
 */
export type Unsubscribe = () => void;

/** Receives every new value. A document that does not exist arrives as `null`, not as absent. */
export type OnNext<T> = (value: T) => void;

/**
 * Receives a permission denial, a lost connection that could not be recovered, or a
 * `DocumentParseError`.
 *
 * Required, not optional: a subscription whose failures go nowhere is a screen that spins for
 * ever, which is the single most common shape of "the app is broken" in a Firestore codebase.
 */
export type OnError = (error: Error) => void;

/** Normalise whatever came out of a `catch` into an `Error`, so `onError` has one contract. */
function toError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  return new Error(`Firestore subscription failed: ${String(cause)}`);
}

/**
 * Subscribe to one document. Emits `null` while it does not exist.
 *
 * `includeMetadataChanges` is left off: with `persistentLocalCache` enabled, turning it on
 * doubles every emission (once from cache, once when the write is acknowledged) and the app
 * has no use for the second one.
 */
export function watchDoc<T>(
  ref: DocumentReference<T>,
  onNext: OnNext<T | null>,
  onError: OnError,
): Unsubscribe {
  return onSnapshot(
    ref,
    (snapshot) => {
      try {
        onNext(snapshot.exists() ? snapshot.data() : null);
      } catch (cause: unknown) {
        onError(toError(cause));
      }
    },
    (error) => {
      onError(error);
    },
  );
}

/**
 * Subscribe to a query. Emits a new array on every change, including the first empty one.
 *
 * The array is a fresh object each time, which is what a React hook needs to re-render — but
 * it also means a consumer must not use it as a dependency without memoising downstream.
 */
export function watchQuery<T>(
  query: Query<T>,
  onNext: OnNext<readonly T[]>,
  onError: OnError,
): Unsubscribe {
  return onSnapshot(
    query,
    (snapshot) => {
      try {
        onNext(snapshot.docs.map((document) => document.data()));
      } catch (cause: unknown) {
        onError(toError(cause));
      }
    },
    (error) => {
      onError(error);
    },
  );
}
