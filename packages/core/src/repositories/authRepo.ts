/**
 * Firebase Auth, wrapped — checklists/phase-03-auth.md §1.
 *
 * ## What this file is for
 *
 * Sign-*in* is not here. Email/password, phone OTP and Google all need platform pieces core
 * cannot have — a `RecaptchaVerifier` needs a DOM node, a popup needs `window.open` — so they
 * live in `apps/web/src/auth/**`, which is the only place `firebase/auth` is called for a
 * credential flow (docs/02 §Authentication architecture).
 *
 * What core owns is everything *after* the credential exists: who is signed in, when that
 * changes, the ID token, and signing out. That is the part Phase 12 reuses unchanged — "the
 * contract is what ports, not the screens".
 *
 * ## Why the user is remapped
 *
 * {@link AuthUser} is a plain object, not the SDK's `User`. The SDK class carries `reload()`,
 * `delete()`, `getIdToken()` and a `providerData` array; handing that to a screen invites a
 * component to call one of them, and `user.delete()` from a component is an account deletion
 * that skips the balance check `deleteAccount` exists to enforce (AC-A3.2).
 *
 * The field set is deliberately a strict subset of `User`, so an SDK `User` is assignable to
 * `AuthUser` and `apps/web/src/auth/**` can pass a fresh `UserCredential.user` straight into
 * `upsertUserProfile` without unwrapping it.
 */

import { onAuthStateChanged, signOut as signOutOfFirebase } from 'firebase/auth';

import { getAuthClient } from '../firebase/index.js';
import type { OnError, OnNext, Unsubscribe } from './subscribe.js';

/**
 * The signed-in user, reduced to the fields the app actually uses.
 *
 * `displayName` and `photoURL` here are the **provider's** values, not the profile's. The
 * profile in `users/{uid}` is the editable one (AC-A2.1) and is what every screen renders;
 * these are only the seed values `upsertUserProfile` uses on first sign-in.
 */
export interface AuthUser {
  readonly uid: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly phoneNumber: string | null;
  readonly photoURL: string | null;
  readonly emailVerified: boolean;
  readonly isAnonymous: boolean;
}

/**
 * Copy anything `AuthUser`-shaped — the SDK's `User` included, since {@link AuthUser} is a
 * strict subset of it — into a plain {@link AuthUser}.
 *
 * The parameter is typed as `AuthUser` rather than as the SDK's `User` so this module needs no
 * import of the `User` class at all, and so a test can pass a literal.
 *
 * Exported because `apps/web/src/auth/**` holds a real `User` straight after a sign-in and
 * needs the same shape the rest of the app sees.
 */
export function toAuthUser(user: AuthUser): AuthUser {
  return {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    phoneNumber: user.phoneNumber,
    photoURL: user.photoURL,
    emailVerified: user.emailVerified,
    isAnonymous: user.isAnonymous,
  };
}

/**
 * Subscribe to sign-in state. Emits `null` when signed out.
 *
 * 🔴 The **first** emission is what resolves "still loading" into an answer, and it does not
 * arrive synchronously — the SDK has to rehydrate the session from persistence first. A guard
 * that treats "no user yet" as "signed out" produces the flash of the login screen that
 * phase-03 §4 calls out as the most common bug in this area. `useAuth` holds `loading: true`
 * until this fires once.
 */
export function watchAuthState(onNext: OnNext<AuthUser | null>, onError: OnError): Unsubscribe {
  return onAuthStateChanged(
    getAuthClient(),
    (user) => {
      onNext(user === null ? null : toAuthUser(user));
    },
    (error) => {
      onError(error instanceof Error ? error : new Error(String(error)));
    },
  );
}

/**
 * Whoever is signed in right now, or `null`.
 *
 * A synchronous peek, for the repositories that need the caller's uid to build a write. It is
 * **not** a substitute for {@link watchAuthState} in the UI: before the session has rehydrated
 * this returns `null` for a user who is in fact signed in.
 */
export function getCurrentUser(): AuthUser | null {
  const user = getAuthClient().currentUser;
  return user === null ? null : toAuthUser(user);
}

/**
 * The signed-in uid, or throw.
 *
 * Every repository write needs it, and every one of them would otherwise repeat the same
 * null-check. Reaching this means a screen invoked a mutation from behind a broken route
 * guard, so it is a bug, not a user-facing condition.
 */
export function requireUid(): string {
  const user = getCurrentUser();
  if (user === null) {
    throw new Error('[splitsutra] Not signed in. This action requires an authenticated user.');
  }
  return user.uid;
}

/**
 * The current ID token, or `null` when signed out.
 *
 * `forceRefresh` re-mints it against the Auth server; the cached one is refreshed
 * automatically about five minutes before it expires, so force it only after a custom claim
 * has changed server-side.
 */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const user = getAuthClient().currentUser;
  if (user === null) return null;
  return user.getIdToken(forceRefresh);
}

/**
 * Sign out (AC-A3.1).
 *
 * Only ends the session. It does **not** clear Firestore's local cache: the routing that
 * follows unmounts every subscription, and clearing IndexedDB on a shared device is a
 * `clearIndexedDbPersistence()` call that fails while any listener is still attached — a
 * cleanup that throws on the way out is worse than a cache that is simply unreadable without a
 * session, which Rules already guarantee.
 */
export async function signOut(): Promise<void> {
  await signOutOfFirebase(getAuthClient());
}
