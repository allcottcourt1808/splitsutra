/**
 * Application startup — the three calls that must happen before React mounts, and the one
 * failure mode that otherwise presents as a blank white page.
 *
 * Split out of `main.tsx` so it can be tested without a DOM root and without `createRoot`.
 *
 * ## Order is not arbitrary
 *
 * 1. `installTokenCssVars()` — every stylesheet reads `var(--splitsutra-*)`, so the tokens
 *    have to be on `:root` before the first paint.
 * 2. `setPlatformAdapter(webAdapter)` — core throws if anything reaches for the adapter before
 *    it is set (Article II), and step 3 reaches for it.
 * 3. `initFirebase(...)` — needs the adapter, because auth persistence comes from it.
 * 4. `initAppCheck(...)` — needs the `FirebaseApp` from step 3, and must run before the first
 *    request: a token is attached only to traffic that starts after it.
 *
 * ## Why a missing config returns a result instead of throwing
 *
 * `readFirebaseConfig()` throws when `.env.local` is absent or incomplete. At module scope in
 * `main.tsx` that throw happens before `createRoot`, so nothing renders at all: the symptom is
 * a blank page with a console message, which reads exactly like a broken build. Returning the
 * failure lets `main.tsx` mount a panel that says which variables are missing and where to put
 * them — the same information, in the place the person is actually looking.
 *
 * ## 🔴 Why no `popupRedirectResolver` — and when you MUST put it back
 *
 * This used to pass `browserPopupRedirectResolver` into `initFirebase()`, because
 * `initializeAuth()` — unlike `getAuth()` — installs no resolver, and without one
 * `signInWithPopup` fails with `auth/operation-not-supported-in-this-environment`.
 *
 * The cost of installing it eagerly was invisible until it was measured. Handing a resolver to
 * `initializeAuth` makes auth check for a pending redirect result during startup, which
 * initialises the resolver, which loads Google's cross-origin auth iframe **on every page
 * load**: `/__/auth/iframe.js` (92.5 KiB) plus `apis.google.com` gapi (40 KiB + 5.8 KiB). A
 * Lighthouse run on `/groups` — an already-signed-in user who will never see a sign-in popup —
 * showed ~133 KiB and 17 third-party cookies bought for nothing. That is nearly twice what the
 * route split (`routes.tsx`) saved.
 *
 * It is safe to drop **only because FirebaseUI is the sole popup consumer**, and it reaches auth
 * through `firebase/compat`, which supplies its own resolver per call rather than relying on the
 * instance. Three links, each read off the installed packages rather than assumed:
 *
 * ```js
 * // 1. @firebase/auth-compat, Auth constructor. Our modular instance already exists, so compat
 * //    takes this branch and never installs a resolver of its own:
 * if (provider.isInitialized()) { this._delegate = provider.getImmediate(); return; }
 *
 * // 2. …but every compat popup/redirect call site passes one explicitly anyway:
 * exp.signInWithPopup(this._delegate, provider, CompatPopupRedirectResolver)
 *
 * // 3. …and @firebase/auth prefers that argument over the instance, so the assert that would
 * //    have thrown `operation-not-supported-in-this-environment` is never reached:
 * function _withDefaultResolver(auth, resolverOverride) {
 *   if (resolverOverride) { return _getInstance(resolverOverride); }
 *   _assert(auth._popupRedirectResolver, auth, AuthErrorCode.ARGUMENT_ERROR);
 * ```
 *
 * Measured after the change, on a production build served with Hosting's headers: `/login`
 * renders all three providers and makes **nine** requests, none of them to `apis.google.com`,
 * `gapi`, or `/__/auth/iframe`. So the iframe is not merely moved to the lazy `/login` chunk —
 * it is deferred to the moment someone actually clicks "Sign in with Google", which is the only
 * moment it is worth anything.
 *
 * ⚠️ **Put it back the moment anything calls modular `signInWithPopup`, `signInWithRedirect` or
 * `getRedirectResult` directly** — replacing FirebaseUI is exactly that change. There is no
 * compile error for this: the failure is a runtime auth error on a button nobody clicks in
 * development. `initFirebase()` still accepts the option; only this call site stopped passing it.
 */

import { setPlatformAdapter } from '@splitsutra/core';
// `src/firebase` is deliberately absent from the root barrel — a runtime Firebase import there
// would reach every consumer, Cloud Functions included. It has its own subpath export.
import { initFirebase } from '@splitsutra/core/firebase';

import { webAdapter } from './webAdapter';
import { EMULATOR, emulatorsEnabled, readFirebaseConfig } from './firebaseEnv';
import { initAppCheck, type AppCheckResult } from './appCheck';
import { installTokenCssVars } from '../styles/tokensCss';

/** What {@link startApp} decided. */
export type StartupResult =
  | { readonly ok: true; readonly emulators: boolean; readonly appCheck: AppCheckResult }
  | { readonly ok: false; readonly error: Error };

/**
 * Run the startup sequence. Safe to call twice — `initFirebase` is idempotent and
 * `installTokenCssVars` replaces its own style element — which matters under React 19
 * StrictMode and under Vite's HMR.
 */
export function startApp(): StartupResult {
  installTokenCssVars();
  setPlatformAdapter(webAdapter);

  try {
    const emulators = emulatorsEnabled();

    const { app } = initFirebase({
      config: readFirebaseConfig(),
      useEmulators: emulators,
      emulators: EMULATOR,
      /* 🔴 `popupRedirectResolver` is deliberately NOT passed here. See below. */
    });

    /* ── App Check ──────────────────────────────────────────────────────────────────────
     * 🔴 Immediately after `initFirebase` and before anything can issue a request: a token is
     *    only attached to Firestore, Auth and callable traffic that starts AFTER this runs.
     *
     * Deliberately NOT inside `initFirebase` — App Check is the one piece of setup where the
     * React Native port needs a different SDK entry point rather than a different argument.
     * `appCheck.ts` carries that reasoning in full.
     *
     * It never throws: an unset key or a blocked reCAPTCHA script returns a skip with a reason,
     * because nothing enforces App Check yet and taking the app down for it would be absurd.
     * That calculus changes when enforcement is on. */
    const appCheck = initAppCheck(app, emulators);

    // Said out loud, because a silently-unattested build is the failure this whole file keeps
    // guarding against: it looks identical to a working one right up until enforcement is
    // switched on, and then every request fails at once. `emulators` is excluded — that skip is
    // expected and would be noise on every local load.
    if (appCheck.status === 'skipped' && !emulators) {
      console.warn(`[splitsutra] App Check is not active: ${appCheck.reason}`);
    }

    return { ok: true, emulators, appCheck };
  } catch (cause: unknown) {
    return { ok: false, error: cause instanceof Error ? cause : new Error(String(cause)) };
  }
}
