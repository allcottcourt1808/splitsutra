/**
 * The session state machine behind `useAuth` — who is signed in, the profile that follows
 * them, and the self-healing upsert — expressed **without React**.
 *
 * ## Why the logic is not in the hook
 *
 * Two reasons, and the second is the one that mattered:
 *
 * 1. **It is testable in the `unit` project.** That project runs on `node` with no DOM, and
 *    core may not depend on `react-dom` at all (Article II, enforced by
 *    `core-is-platform-agnostic`), so there is no renderer here to drive a hook with. Every
 *    branch below — the torn-down-listener race, the retry after a failed upsert, the
 *    referential stability `useSyncExternalStore` demands — is reachable from a plain node
 *    test. `useAuth.ts` is then eight lines with nothing in it worth asserting on.
 * 2. **Auth state is not component state.** A repository is a plain function callable from
 *    outside the React tree, and something has to hold "who is signed in" for those callers
 *    too. Module state, like `firebase/init.ts`'s handles and the platform adapter.
 *
 * ## The listener is started once and never stopped
 *
 * {@link subscribeAuthState} starts the `onAuthStateChanged` subscription on the first
 * subscriber and does **not** tear it down when the last one goes away. That is deliberate:
 * React 19 StrictMode subscribes, unsubscribes and resubscribes every effect in development,
 * and a store that tore down on refcount zero would re-run the profile upsert on every one
 * of those cycles. The subscription is app-lifetime anyway — the router is always mounted —
 * so the only thing refcounting would buy is a class of bug.
 *
 * {@link resetAuthStore} exists for tests, and only for tests.
 *
 * @see checklists/phase-03-auth.md §1, §3
 */

import type { User } from '../types/index.js';
import {
  upsertUserProfile,
  watchAuthState,
  watchUserProfile,
  type AuthUser,
  type Unsubscribe,
} from '../repositories/index.js';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * The snapshot
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Everything `useAuth` exposes except `signOut`, which is a module-level function and needs
 * no place in a snapshot.
 *
 * 🔴 `loading` answers **"do we know yet whether anyone is signed in?"** and nothing else. It
 * goes false on the first `onAuthStateChanged` emission, which is what a route guard needs:
 * treating "no user yet" as "signed out" is the flash of the login screen that
 * checklists/phase-03-auth.md §4 calls the most common bug in this area (AC-A1.5, AC-A1.6).
 *
 * It deliberately does **not** also cover the profile. A guard that waited for the profile
 * document would hold the whole app on a spinner behind a Firestore round trip it does not
 * need, and a signed-in user with `profile === null` is a real, renderable state — it is the
 * half-second before the first snapshot arrives, and it is also what a user whose profile is
 * being repaired sees. `useProfile` is where that distinction is drawn.
 */
export interface AuthState {
  /** The Firebase Auth session, or `null` when signed out. */
  readonly user: AuthUser | null;
  /** `users/{uid}`, or `null` when signed out or not yet arrived. */
  readonly profile: User | null;
  /** `true` until the first sign-in-state emission. See the note above. */
  readonly loading: boolean;
  /** The most recent failure from the session, the profile subscription, or the upsert. */
  readonly error: Error | null;
}

/** Signed out, and known to be: every field at rest. */
const SIGNED_OUT: AuthState = { user: null, profile: null, loading: false, error: null };

/** Before the first emission, nobody knows anything yet. */
const RESOLVING: AuthState = { user: null, profile: null, loading: true, error: null };

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Module state
 * ────────────────────────────────────────────────────────────────────────────────────────── */

let state: AuthState = RESOLVING;

const listeners = new Set<() => void>();

let unsubscribeAuth: Unsubscribe | null = null;
let unsubscribeProfile: Unsubscribe | null = null;

/**
 * The uid the profile subscription is currently for, or `null` when there is none.
 *
 * Doubles as the guard on every profile callback. `onSnapshot`'s unsubscribe does not promise
 * that an in-flight emission will not still be delivered, so a fast sign-out then sign-in can
 * land the *previous* user's profile in the *new* user's state — one account's display name
 * on another account's screen. Comparing against this before every `setState` closes that.
 */
let watchedUid: string | null = null;

/** The uid {@link upsertUserProfile} has already run for, so a re-emission costs nothing. */
let upsertedUid: string | null = null;

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Transitions
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Apply a patch, and notify only if the snapshot actually changed.
 *
 * The equality check is what makes this store safe for `useSyncExternalStore`: that hook
 * calls `getSnapshot` after every notification and re-renders whenever the identity differs,
 * so handing out a fresh object for an unchanged state is a render for nothing — and
 * returning a fresh object from *every* `getSnapshot` call is the infinite loop React warns
 * about by name.
 */
function setState(patch: Partial<AuthState>): void {
  const next: AuthState = { ...state, ...patch };
  if (
    next.user === state.user &&
    next.profile === state.profile &&
    next.loading === state.loading &&
    next.error === state.error
  ) {
    return;
  }

  state = next;
  // Copied before iterating: a listener is allowed to unsubscribe from inside its own
  // notification, and mutating a Set mid-iteration silently skips the following entry.
  for (const listener of [...listeners]) listener();
}

function stopProfileWatch(): void {
  // Cleared first, so an emission already in flight is ignored rather than applied.
  watchedUid = null;
  unsubscribeProfile?.();
  unsubscribeProfile = null;
}

function startProfileWatch(uid: string): void {
  stopProfileWatch();
  watchedUid = uid;
  unsubscribeProfile = watchUserProfile(
    uid,
    (profile) => {
      if (watchedUid !== uid) return;
      setState({ profile });
    },
    (error) => {
      if (watchedUid !== uid) return;
      setState({ error });
    },
  );
}

/**
 * Create the profile if it is missing (AC-A1.2, AC-A1.3).
 *
 * Fire-and-forget on purpose: the *result* of the write reaches the UI through the profile
 * subscription started just above, not through this promise. Awaiting it here would hold the
 * sign-in transition on a round trip whose outcome the subscription reports anyway.
 *
 * On failure `upsertedUid` is released so the next emission retries — a create that lost to a
 * dropped connection must not leave the user permanently profile-less.
 */
async function ensureProfile(user: AuthUser): Promise<void> {
  if (upsertedUid === user.uid) return;
  upsertedUid = user.uid;

  try {
    await upsertUserProfile(user);
  } catch (cause: unknown) {
    if (upsertedUid === user.uid) upsertedUid = null;
    // Signed out, or switched accounts, while the write was in flight. The failure belongs to
    // a session nobody is looking at any more.
    if (watchedUid !== user.uid) return;
    setState({ error: toError(cause) });
  }
}

function handleAuthUser(user: AuthUser | null): void {
  if (user === null) {
    stopProfileWatch();
    upsertedUid = null;
    setState(SIGNED_OUT);
    return;
  }

  if (state.user?.uid === user.uid) {
    // The same account with a refreshed session object. Keep the profile and its
    // subscription; only the user object is new.
    setState({ user, loading: false });
  } else {
    // A different account. The previous profile has to go in the same tick the user does, or
    // the UI renders the old name under the new session for as long as the first snapshot
    // takes to arrive.
    setState({ user, profile: null, loading: false, error: null });
    startProfileWatch(user.uid);
  }

  void ensureProfile(user);
}

function start(): void {
  if (unsubscribeAuth !== null) return;

  try {
    unsubscribeAuth = watchAuthState(handleAuthUser, (error) => {
      setState({ loading: false, error });
    });
  } catch (cause: unknown) {
    // `getAuthClient()` throws when `initFirebase()` was never called. Surfacing that as
    // `error` rather than letting it escape means the failure lands in the one place the
    // contract already has for failures, instead of unmounting the tree from inside a
    // `subscribe` callback. The message it carries still names the missing startup call.
    setState({ loading: false, error: toError(cause) });
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * The `useSyncExternalStore` contract
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** Subscribe to session changes. Starts the underlying listener on the first caller. */
export function subscribeAuthState(listener: () => void): Unsubscribe {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The current snapshot.
 *
 * Referentially stable between transitions — see {@link setState}. Safe to call outside
 * React, and the honest way for a non-component caller to ask who is signed in without
 * racing the synchronous `getCurrentUser()` against session rehydration.
 */
export function getAuthState(): AuthState {
  return state;
}

/**
 * The snapshot a server render would see.
 *
 * This app is a client-rendered SPA, so nothing calls this today. `useSyncExternalStore`
 * requires it regardless, and it must never read the live `state` — a hydration mismatch is
 * precisely what happens if it does.
 */
export function getInitialAuthState(): AuthState {
  return RESOLVING;
}

/**
 * Test helper — drop every subscription and forget the session.
 *
 * 🔴 Tests only. It clears the listener set, which in a running app means every mounted
 * component silently stops receiving updates. Mirrors `resetFirebase()`.
 */
export function resetAuthStore(): void {
  unsubscribeAuth?.();
  unsubscribeAuth = null;
  stopProfileWatch();
  upsertedUid = null;
  listeners.clear();
  state = RESOLVING;
}
