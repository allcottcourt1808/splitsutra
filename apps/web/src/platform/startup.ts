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
 *
 * ## Why a missing config returns a result instead of throwing
 *
 * `readFirebaseConfig()` throws when `.env.local` is absent or incomplete. At module scope in
 * `main.tsx` that throw happens before `createRoot`, so nothing renders at all: the symptom is
 * a blank page with a console message, which reads exactly like a broken build. Returning the
 * failure lets `main.tsx` mount a panel that says which variables are missing and where to put
 * them — the same information, in the place the person is actually looking.
 */

import { browserPopupRedirectResolver } from 'firebase/auth';

import { setPlatformAdapter } from '@splitsutra/core';
// `src/firebase` is deliberately absent from the root barrel — a runtime Firebase import there
// would reach every consumer, Cloud Functions included. It has its own subpath export.
import { initFirebase } from '@splitsutra/core/firebase';

import { webAdapter } from './webAdapter';
import { EMULATOR, emulatorsEnabled, readFirebaseConfig } from './firebaseEnv';
import { installTokenCssVars } from '../styles/tokensCss';

/** What {@link startApp} decided. */
export type StartupResult =
  | { readonly ok: true; readonly emulators: boolean }
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

    initFirebase({
      config: readFirebaseConfig(),
      useEmulators: emulators,
      emulators: EMULATOR,
      /**
       * 🔴 Required, and easy to miss. Core calls `initializeAuth()` rather than `getAuth()`
       * because it is the only entry point that accepts a persistence strategy — but
       * `initializeAuth` does NOT install a popup/redirect resolver, where `getAuth` does.
       * Without this, Google sign-in fails at runtime with
       * `auth/operation-not-supported-in-this-environment` and nothing earlier complains.
       *
       * It is passed from here rather than imported inside core because it is a DOM
       * implementation, and importing it there would put `window` in the mobile bundle's
       * dependency graph (Article II).
       */
      popupRedirectResolver: browserPopupRedirectResolver,
    });

    return { ok: true, emulators };
  } catch (cause: unknown) {
    return { ok: false, error: cause instanceof Error ? cause : new Error(String(cause)) };
  }
}
