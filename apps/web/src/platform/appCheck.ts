/**
 * App Check — attesting that a request came from *this app*, not from a script holding the
 * public config.
 *
 * docs/18 §4 R3. Every `VITE_FIREBASE_*` value is a public identifier that ships in the bundle
 * by design (see `.env.example`), so anyone can point their own client at this project. Security
 * Rules stop them reading other people's data; they do **not** stop them creating accounts,
 * driving phone-auth SMS, or hammering callables — which on Blaze is a bill. App Check is the
 * layer that answers "is this our app", which Rules never claimed to answer.
 *
 * ## 🔴 Why this is platform code, and NOT another argument to `initFirebase`
 *
 * `initFirebase` already takes one browser implementation it cannot construct itself
 * (`popupRedirectResolver`), so the obvious move is a second: core takes an `appCheckProvider`
 * and makes the one `initializeAppCheck` call. That is wrong here, and the reason is worth
 * writing down because the shape looks so similar.
 *
 * A resolver is the *same* function with a different argument on every platform. App Check is
 * not: React Native attests with **App Attest / DeviceCheck** (iOS) and **Play Integrity**
 * (Android), through `@react-native-firebase/app-check` — a different package with a different
 * entry point, not a different provider object handed to this one. So a shared call in core
 * would serve exactly one platform while pulling reCAPTCHA's browser code into the mobile
 * bundle's dependency graph (Article II). Phase 12 writes its own attestation next to this file;
 * it does not reuse it.
 *
 * ## Monitoring first, enforcement later
 *
 * This registers the client so it *sends* tokens. Nothing rejects a request without one until
 * somebody enforces App Check per service in the console, and until
 * `ENFORCE_APP_CHECK` flips in `firebase/functions/src/common/config.ts`. That order is
 * deliberate (checklists/phase-10): enforcing on day one locks you out of your own app, and the
 * console's metrics page is the only way to find out whether real traffic is passing first.
 *
 * ## Failure is a skip, never a throw
 *
 * An unset key, a blocked reCAPTCHA script, a corporate proxy — none of those should take the
 * app down for a feature that nothing is enforcing yet. Every path here returns a reason, and
 * `startApp` reports it; the app runs either way. That flips the day enforcement is on, and
 * `checklists/phase-10` says so at the point where it flips.
 */

import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import type { FirebaseApp } from 'firebase/app';

/** What {@link initAppCheck} did, so startup can report it rather than swallow it. */
export type AppCheckResult =
  | { readonly status: 'active'; readonly appCheck: AppCheck; readonly debug: boolean }
  | { readonly status: 'skipped'; readonly reason: string };

/**
 * `import.meta.env` values are typed `any` through an index signature; narrow before use.
 *
 * ⚠️ Read by LITERAL member access, never `import.meta.env[name]` — Vite performs a static text
 * substitution at build time and a computed lookup is not substituted, so a dynamic version
 * works in `pnpm dev` and silently yields `undefined` in a production build. Same rule, and the
 * same reason, as `firebaseEnv.ts`.
 */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The reCAPTCHA site key App Check attests with.
 *
 * Public by design, exactly like the Firebase config beside it — a site key is meant to be read
 * out of the page; the matching secret lives in Google's console and never comes near a build.
 *
 * 🔴 **This is a NEW key, created for App Check.** It is not, and must not be, one of the
 *    "Key for Identity Platform reCAPTCHA integration" keys this project already has for phone
 *    auth. Those are minted and owned by Identity Platform. Each project already carries three
 *    or four of them under that one name, which cost real time to untangle once — putting an
 *    unrelated key here is how that happens again, and it fails as `appCheck/recaptcha-error`
 *    with nothing naming the key.
 */
function siteKey(): string {
  return str(import.meta.env.VITE_APPCHECK_SITE_KEY);
}

/**
 * Register a debug token so a developer machine can obtain App Check tokens.
 *
 * reCAPTCHA cannot attest `localhost`, so without this every local request is unattested — which
 * is invisible today and a hard block the moment enforcement is on.
 *
 * 🔴 **A debug token is a permanent, complete App Check bypass for whoever holds it**, and it is
 *    registered against the real project. Two guards, and both are needed:
 *
 *    1. `import.meta.env.DEV` — statically `false` in any production build, so this branch is
 *       removed by dead-code elimination and the string cannot reach a deployed bundle even if
 *       the variable is set in CI.
 *
 *       ✅ **Measured, not assumed.** A production build run with
 *       `VITE_APPCHECK_DEBUG_TOKEN=CANARY-TOKEN-9f3a VITE_APPCHECK_SITE_KEY=CANARY-SITEKEY-7b2c`
 *       put the site key in `dist/assets/index-*.js` — as it must, it is public — and the debug
 *       token **nowhere in `dist/` at all**. Re-run that canary if this guard is ever
 *       restructured; "the bundler will strip it" is a claim until something greps for it.
 *    2. An explicit opt-in variable — being in dev mode is not on its own a reason to mint one.
 *
 *    `true` asks the SDK to generate a token and log it; paste that into the Firebase console
 *    (App Check → Apps → Manage debug tokens) to register it. Prefer a per-developer token over
 *    a shared one, and revoke it in the console when the machine is done with it.
 */
function installDebugToken(): boolean {
  if (!import.meta.env.DEV) return false;

  const token = str(import.meta.env.VITE_APPCHECK_DEBUG_TOKEN);
  if (token.length === 0) return false;

  // `self` rather than `window`: the SDK reads it off the global scope, and this is the spelling
  // that also works in the service worker context the PWA registers.
  (self as unknown as Record<string, unknown>)['FIREBASE_APPCHECK_DEBUG_TOKEN'] =
    token === 'true' ? true : token;

  return true;
}

/**
 * Initialise App Check for the web app. Call once, immediately after `initFirebase`.
 *
 * Order matters: a token is attached to Firestore, Auth and callable requests only if App Check
 * was initialised before those requests are made. `startApp()` runs before React mounts, so
 * calling it there covers everything.
 *
 * @param app the `FirebaseApp` from `initFirebase`.
 * @param useEmulators skip entirely — the emulator suite does not verify tokens, and pointing a
 *   real reCAPTCHA key at `127.0.0.1` buys nothing but console noise.
 */
export function initAppCheck(app: FirebaseApp, useEmulators: boolean): AppCheckResult {
  if (useEmulators) {
    return { status: 'skipped', reason: 'emulators are on — the suite does not verify tokens' };
  }

  const key = siteKey();
  if (key.length === 0) {
    return {
      status: 'skipped',
      reason:
        'VITE_APPCHECK_SITE_KEY is not set. App Check is not registered and no token is sent ' +
        '(checklists/phase-10 §App Check).',
    };
  }

  // 🔴 Before `initializeAppCheck`. The SDK reads the global once, during initialisation — set
  //    afterwards it is simply ignored, and the symptom is a local machine that never attests.
  const debug = installDebugToken();

  try {
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(key),
      // Refresh in the background so a long-lived tab does not start failing an hour in. The
      // cost is one assessment per refresh, which tracks sessions rather than requests.
      isTokenAutoRefreshEnabled: true,
    });

    return { status: 'active', appCheck, debug };
  } catch (cause: unknown) {
    // Reached when the reCAPTCHA script is blocked, or the key is rejected. Not fatal while
    // nothing enforces App Check — see the header.
    return {
      status: 'skipped',
      reason: `App Check failed to initialise: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}
