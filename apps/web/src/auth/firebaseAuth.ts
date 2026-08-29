/**
 * The credential flows — email/password, Google, phone OTP (AC-A1.1).
 *
 * ── WHAT THIS FILE IS NOW, AND WHAT IT USED TO BE ────────────────────────────────────────
 * It used to initialise Firebase itself: `initializeApp`, `getAuth(app)`, `setPersistence`,
 * memoised behind its own `getAuthClient()` promise. That was correct while core had no
 * `src/firebase/`, and it became a **latent startup collision** the moment core got one.
 *
 * 🔴 `getAuth()` and `initializeAuth()` cannot both run against the same app.
 *    `getAuth` lazily initialises auth with defaults; `initializeAuth` — which core calls,
 *    because it is the only entry point that accepts a persistence strategy — throws
 *    `auth/already-initialized` if auth has been touched. So whichever of the two ran first
 *    won, and the loser failed at runtime. Which one ran first depended on import order and
 *    on which screen the user happened to land on. Nothing typechecked differently either
 *    way; the tests never called it; a green suite proved nothing about it.
 *
 * Resolved by deleting this file's half. `initFirebase()` in `platform/startup.ts` is now the
 * only initialisation in the app, and everything here reaches the same `Auth` through core's
 * `getAuthClient()`. Persistence (AC-A1.7) arrives through the `PlatformAdapter`, as Article II
 * requires, instead of being applied twice from two places.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────────────────
 * `watchAuthState`, `getCurrentUser`, `getIdToken` and `signOut` used to live here too, and
 * are now core's (`repositories/authRepo.ts`). That is the split docs/02 describes: core owns
 * everything *after* a credential exists — who is signed in, when it changes, the token,
 * signing out — because that is the part Phase 12 reuses unchanged. What stays here is only
 * what genuinely cannot leave the browser:
 *
 *   - `signInWithPopup` needs `window.open`
 *   - `RecaptchaVerifier` needs a real DOM element to attach to
 *
 * A screen imports the functions below and nothing else from `firebase/auth`.
 *
 * ── NO FIREBASEUI (Q17 / R7) ─────────────────────────────────────────────────────────────
 * `firebaseui@6.1.0` declares `peerDependencies: firebase "^9.1.3 || ^10.0.0"` and this
 * project is on firebase 12, so it installs as an unmet peer and upstream has shipped nothing
 * for SDK 11 or 12. The deciding argument is in docs/02 itself: FirebaseUI is web-only and
 * "does not port", so Phase 12 needs custom auth screens regardless. `no-firebaseui-or-compat`
 * in `.dependency-cruiser.cjs` enforces the ban. The modular `firebase/auth` SDK used below is
 * normal usage, not compat.
 */

import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  updateProfile,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';

import { getAuthClient } from '@splitsutra/core/firebase';

/* -------------------------------------------------------------------------- */
/* Email + password                                                           */
/* -------------------------------------------------------------------------- */

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const credential = await signInWithEmailAndPassword(getAuthClient(), email, password);
  return credential.user;
}

/**
 * Create an account, seeding `displayName` from what the user typed.
 *
 * The Auth profile is not the source of truth — `users/{uid}` is (docs/03) — but seeding it
 * means the very first `upsertUserProfile()` has a real name to copy instead of falling back to
 * the email local-part.
 *
 * ⚠️ `updateProfile` is awaited BEFORE this resolves, and that ordering is load-bearing.
 * `onAuthStateChanged` fires the moment the account exists, and the auth store runs
 * `upsertUserProfile` on that emission. If the name landed afterwards, the profile document
 * would already have been written with the fallback — and `upsertUserProfile` deliberately
 * never rewrites `displayName` on a later launch (it would silently revert the user's own
 * edits), so the seed would be lost permanently rather than corrected on the next run.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string,
): Promise<User> {
  const credential = await createUserWithEmailAndPassword(getAuthClient(), email, password);
  const trimmed = displayName.trim();
  if (trimmed.length > 0) {
    await updateProfile(credential.user, { displayName: trimmed });
  }
  return credential.user;
}

/* -------------------------------------------------------------------------- */
/* Google                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Google sign-in via POPUP, not redirect.
 *
 * checklists/phase-03-auth.md §2: redirect loses state on some mobile browsers. It also loses
 * the `/invite/:token` destination the route guard is holding, which is exactly the deep link
 * AC-B3.3 requires to survive login.
 *
 * ⚠️ Requires `popupRedirectResolver` to have been passed to `initFirebase` — see the note in
 * `platform/startup.ts`. Without it this fails with
 * `auth/operation-not-supported-in-this-environment`.
 */
export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  // Always show the chooser: a shared laptop that silently reuses the last Google account is
  // how one person's expenses end up in another person's group.
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(getAuthClient(), provider);
  return credential.user;
}

/* -------------------------------------------------------------------------- */
/* Phone / SMS OTP                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Build the invisible reCAPTCHA the phone provider requires.
 *
 * ⚠️ The one genuinely DOM-bound piece of auth: it needs a real element to attach to. It stays
 * in this directory for that reason — Article II keeps it out of core, and Phase 12 replaces it
 * with the native SafetyNet / DeviceCheck flow, which needs no equivalent. A screen must never
 * construct one directly.
 *
 * The caller owns the returned verifier and must `clear()` it — a second verifier on the same
 * element throws, which is what happens under StrictMode's double-invoked effects if the first
 * is not torn down.
 */
export function createPhoneVerifier(container: HTMLElement): RecaptchaVerifier {
  return new RecaptchaVerifier(getAuthClient(), container, { size: 'invisible' });
}

/**
 * Send the SMS code. `phoneE164` must already be normalised, e.g. `+14155550123`.
 *
 * ⚠️ SMS is the one auth method that costs real money per attempt and is the standard target
 * for toll fraud, which is why docs/18 restricts the SMS region policy to a single region.
 * The reCAPTCHA above is the other half of that defence; neither is optional.
 *
 * The returned handle is what confirms the code; hold it in component state and throw it away
 * when the user edits the number.
 */
export async function startPhoneSignIn(
  phoneE164: string,
  verifier: RecaptchaVerifier,
): Promise<ConfirmationResult> {
  return signInWithPhoneNumber(getAuthClient(), phoneE164, verifier);
}

export async function confirmPhoneCode(
  confirmation: ConfirmationResult,
  code: string,
): Promise<User> {
  const credential = await confirmation.confirm(code);
  return credential.user;
}
