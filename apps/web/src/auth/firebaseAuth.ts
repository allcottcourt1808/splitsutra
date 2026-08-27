/**
 * Firebase Auth wiring for the web app.
 *
 * ── WHY THERE IS NO FIREBASEUI HERE (Q17 / R7) ───────────────────────────────────────────
 * docs/02 §Authentication architecture and ADR-03 describe a FirebaseUI widget quarantined
 * behind `apps/web/src/auth/FirebaseUIMount.tsx`. That plan was dropped.
 * `firebaseui@6.1.0` declares `peerDependencies: firebase "^9.1.3 || ^10.0.0"`; this
 * project is on firebase 11, so it installs as an unmet peer and upstream has shipped
 * nothing for SDK 11 or 12. The deciding argument is in docs/02 itself: FirebaseUI is
 * web-only and "does not port", so Phase 12 has to write custom auth screens regardless —
 * FirebaseUI would have bought a day now and charged it back later.
 *
 * Consequences:
 *   - 🔴 **Nothing in this repo imports `firebaseui` or `firebase/compat`.** The old
 *     `firebaseui-is-quarantined` carve-out for this directory is now the blanket
 *     `no-firebaseui-or-compat` rule in `.dependency-cruiser.cjs` — a strictly stronger
 *     guarantee, and the thing that stops the compat shim creeping back in.
 *   - The modular `firebase/auth` SDK used below is normal usage, not compat.
 *   - `RecaptchaVerifier` (needed for phone OTP) is modular too, and stays inside this
 *     directory so no screen ever touches it.
 *
 * ── WHY IT IS HERE AND NOT IN CORE ───────────────────────────────────────────────────────
 * It should not be, permanently. `@splitsutra/core` owns Firebase app init and `authRepo`.
 *
 * TODO(phase-02): replace `initApp()` with `initFirebase(readFirebaseConfig())` from
 *   `@splitsutra/core` once `packages/core/src/firebase/` exists.
 * TODO(phase-03): move the sign-in calls into `core/src/repositories/authRepo.ts` and this
 *   file shrinks to nothing (checklists/phase-03-auth.md §1). The UI in `SignInPanel.tsx`
 *   then talks only to the repository, which is what makes the native login screens in
 *   Phase 12 a re-skin rather than a rewrite.
 */

import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type Auth,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import { getPlatformAdapter } from '@splitsutra/core';
import { EMULATOR, readFirebaseConfig, useEmulators } from '../platform/firebaseEnv';

/* -------------------------------------------------------------------------- */
/* Initialisation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Memoised as a PROMISE, not as an `Auth`. Persistence must be applied before the first
 * sign-in call or the session silently falls back to in-memory and does not survive a
 * refresh (AC-A1.7) — so every consumer awaits the same settled setup.
 *
 * React 19 StrictMode double-invokes effects in dev; memoising here is what stops that
 * turning into two `initializeApp` calls.
 */
let authPromise: Promise<Auth> | null = null;

export function getAuthClient(): Promise<Auth> {
  if (authPromise !== null) return authPromise;

  authPromise = (async (): Promise<Auth> => {
    const app = getApps().length === 0 ? initializeApp(readFirebaseConfig()) : getApp();
    const auth = getAuth(app);

    if (useEmulators()) {
      // `disableWarnings` suppresses the red banner the SDK injects into the DOM, which
      // would sit on top of the phone column.
      connectAuthEmulator(auth, EMULATOR.authUrl, { disableWarnings: true });
    }

    // Article II: core never decides how a platform stores a session. The web adapter
    // returns `browserLocalPersistence`; the RN adapter returns the AsyncStorage-backed one.
    await setPersistence(auth, getPlatformAdapter().getAuthPersistence());
    return auth;
  })();

  return authPromise;
}

/* -------------------------------------------------------------------------- */
/* Session                                                                    */
/* -------------------------------------------------------------------------- */

export type { User as AuthUser };

/**
 * Subscribe to the auth state. Returns an unsubscribe.
 *
 * `onAuthStateChanged` fires once with the restored session (or `null`) before anything
 * else, which is what lets the route guards distinguish "still resolving" from "signed
 * out" — and therefore avoid the flash of the login screen that phase-03 §4 calls out as
 * the most common bug in this area.
 */
export function watchAuthState(
  onChange: (user: User | null) => void,
  onError: (error: unknown) => void,
): () => void {
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;

  getAuthClient()
    .then((auth) => {
      if (cancelled) return;
      unsubscribe = onAuthStateChanged(auth, onChange, onError);
    })
    .catch(onError);

  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

export async function signOut(): Promise<void> {
  const auth = await getAuthClient();
  await fbSignOut(auth);
}

/* -------------------------------------------------------------------------- */
/* Sign-in methods — AC-A1.1: email/password, phone, Google                    */
/* -------------------------------------------------------------------------- */

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const auth = await getAuthClient();
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

/**
 * Create an account, seeding `displayName` from what the user typed.
 *
 * The Auth profile is not the source of truth — `users/{uid}` is (docs/03) — but seeding it
 * means the very first `upsertUserProfile()` has a real name to copy instead of falling
 * back to the email local-part.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string,
): Promise<User> {
  const auth = await getAuthClient();
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const trimmed = displayName.trim();
  if (trimmed.length > 0) {
    await updateProfile(credential.user, { displayName: trimmed });
  }
  return credential.user;
}

/**
 * Google sign-in via POPUP, not redirect.
 *
 * checklists/phase-03-auth.md §2: redirect loses state on some mobile browsers. It also
 * loses the `/invite/:token` destination the guard is holding, which is exactly the deep
 * link AC-B3.3 requires to survive login.
 */
export async function signInWithGoogle(): Promise<User> {
  const auth = await getAuthClient();
  const provider = new GoogleAuthProvider();
  // Always show the chooser: a shared laptop that silently reuses the last Google account
  // is how one person's expenses end up in another person's group.
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  return credential.user;
}

/* -------------------------------------------------------------------------- */
/* Phone / SMS OTP                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Build the invisible reCAPTCHA the phone provider requires.
 *
 * ⚠️ This is the one genuinely DOM-bound piece of auth: it needs a real element to attach
 * to. It stays in this directory for that reason — Article II keeps it out of core, and
 * Phase 12 replaces it with the native SafetyNet / DeviceCheck flow, which needs no
 * equivalent. A screen must never construct one.
 */
export async function createPhoneVerifier(container: HTMLElement): Promise<RecaptchaVerifier> {
  const auth = await getAuthClient();
  return new RecaptchaVerifier(auth, container, { size: 'invisible' });
}

/**
 * Send the SMS code. `phoneE164` must already be normalised, e.g. `+919876543210`.
 *
 * The returned handle is what confirms the code; hold it in component state and throw it
 * away when the user edits the number.
 */
export async function startPhoneSignIn(
  phoneE164: string,
  verifier: RecaptchaVerifier,
): Promise<ConfirmationResult> {
  const auth = await getAuthClient();
  return signInWithPhoneNumber(auth, phoneE164, verifier);
}

export async function confirmPhoneCode(
  confirmation: ConfirmationResult,
  code: string,
): Promise<User> {
  const credential = await confirmation.confirm(code);
  return credential.user;
}
