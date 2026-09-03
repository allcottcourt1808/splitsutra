/**
 * The FirebaseUI drop-in auth widget — <https://firebase.google.com/docs/auth/web/firebaseui>.
 *
 * checklists/phase-03-auth.md §2. Email/password (with sign-up), phone OTP and Google, all
 * three rendered by Google's own widget rather than by hand.
 *
 * ── 🔴 THE COMPAT BRIDGE, WHICH IS THE WHOLE TRICK ───────────────────────────────────────
 * FirebaseUI predates the modular SDK. Its ESM build's first two lines are
 * `import firebase from 'firebase/compat/app'` and `import 'firebase/compat/auth'`, and
 * `new firebaseui.auth.AuthUI(auth)` wants a **compat** `firebase.auth.Auth`, not the modular
 * `Auth` that `getAuthClient()` returns. Handing it the modular one fails.
 *
 * The bridge is that compat is a *wrapper*, not a second SDK: `firebase.initializeApp(config)`
 * with the same config resolves to the same underlying `[DEFAULT]` app core already created,
 * and `firebase.auth()` wraps the same auth instance. So the widget and the rest of the app
 * share one session — a sign-in here fires the `onAuthStateChanged` that `authStore` is already
 * listening on, which is what makes the route guard notice and `upsertUserProfile` run.
 *
 * ⚠️ `initializeApp` is called here with the config read from the environment, NOT with a
 * second config. Passing a different one throws `app/duplicate-app`.
 *
 * ── ⚠️ WHAT THIS COSTS, RECORDED HONESTLY ────────────────────────────────────────────────
 * `firebaseui@6.1.0` was published in August 2023 and declares
 * `peerDependencies: firebase "^9.1.3 || ^10.0.0"`. This project is on firebase 12, so pnpm
 * reports it as an unmet peer and installs it anyway. It works — the compat layer it depends on
 * is still shipped in firebase 12 — but it is **unsupported by version range**, and a future
 * firebase major that drops `firebase/compat` breaks this file and nothing else.
 *
 * It is also web-only: `docs/02-architecture.md` notes FirebaseUI "does not port", so the React
 * Native build in Phase 12 needs its own auth screens regardless. That is the trade this file
 * represents, and it was made deliberately.
 *
 * ── StrictMode ───────────────────────────────────────────────────────────────────────────
 * 🔴 `new firebaseui.auth.AuthUI(auth)` **throws** if an instance already exists for that app,
 * and React 19 StrictMode double-invokes every effect in development. `getInstance()` first,
 * then construct, and `reset()` on teardown. Without this, `/login` is broken in dev and works
 * in production.
 */

import { useEffect, useRef } from 'react';
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import * as firebaseui from 'firebaseui';
import 'firebaseui/dist/firebaseui.css';

import { EMULATOR, emulatorsEnabled, readFirebaseConfig } from '../platform/firebaseEnv';

/**
 * 🔴 **Sign in with Apple: built and working, deliberately not shown.**
 *
 * Flip to `true` — one line, one deploy — the moment the provider is configured in the Firebase
 * console. Steps are in `checklists/phase-02` §3, and the blocker is an Apple Developer Program
 * membership ($99/year) rather than anything in this repo.
 *
 * Why it is a flag rather than a deleted block: without console configuration the button ends in
 * `auth/operation-not-allowed`, and it is the THIRD button on the sign-in screen — the first
 * thing a new tester taps. `describeAuthError` renders that honestly ("That sign-in method is not
 * switched on for this project yet"), which is right for us and useless to somebody who was
 * invited to try the app. A visible control that cannot work is worse than an absent one.
 *
 * ⚠️ This is a build-time constant, not an env var, precisely so the two projects cannot drift:
 *    a provider enabled on dev but not prod would put the same broken button in front of real
 *    users. Turn it on for both, or neither.
 */
const APPLE_ENABLED = false;

/**
 * The compat `Auth` the widget needs, wrapping the app core already initialised.
 *
 * Memoised because `firebase.auth()` is cheap but `useEmulator()` is not idempotent — calling
 * it twice on the same instance throws once a request has gone out.
 */
let compatAuth: firebase.auth.Auth | null = null;

function getCompatAuth(): firebase.auth.Auth {
  if (compatAuth !== null) return compatAuth;

  // Same config, so this resolves to the existing `[DEFAULT]` app rather than creating a
  // second one. `initFirebase()` in `platform/startup.ts` has already run by the time any
  // screen mounts.
  if (firebase.apps.length === 0) {
    firebase.initializeApp(readFirebaseConfig());
  }

  const auth = firebase.auth();
  if (emulatorsEnabled()) {
    // The modular side is pointed at the emulator by `initFirebase`; the compat wrapper needs
    // telling separately or the widget talks to production while everything else does not.
    auth.useEmulator(EMULATOR.authUrl);
  }

  compatAuth = auth;
  return auth;
}

export interface FirebaseUIMountProps {
  /** Surfaced to the screen so a failure renders as copy rather than a blank panel. */
  onError: (cause: unknown) => void;
}

/**
 * Mount the widget. Renders nothing of its own — FirebaseUI owns the container's contents.
 *
 * Routing after a successful sign-in is **not** done here. `signInSuccessWithAuthResult`
 * returns `false`, which tells FirebaseUI not to redirect: the session changes,
 * `<RedirectIfAuthed>` notices, and the app moves. One path, shared with every other way a
 * session can appear.
 */
export function FirebaseUIMount({ onError }: FirebaseUIMountProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    let ui: firebaseui.auth.AuthUI;
    try {
      const auth = getCompatAuth();
      // 🔴 `getInstance()` first — see the StrictMode note above.
      ui = firebaseui.auth.AuthUI.getInstance() ?? new firebaseui.auth.AuthUI(auth);
      // 🔴 And reset BEFORE starting, not only on teardown.
      //
      // Found by signing out: the widget rendered on a fresh page load and then came back
      // empty — with an error where the form should be — after sign-out re-mounted this
      // screen inside the same page session. The instance survives the unmount (that is what
      // `getInstance()` is for), and `start()` on one that still holds the previous mount's
      // state throws instead of re-rendering. A page reload hid it, which is exactly why it
      // survived the first pass: the only broken path is the one a real user takes.
      ui.reset();
    } catch (cause: unknown) {
      onError(cause);
      return;
    }

    ui.start(host, {
      signInFlow: 'popup',
      signInOptions: [
        // 🔴 EMAIL/PASSWORD IS DELIBERATELY ABSENT, and must not be added back without also
        //    changing the console. It is disabled as a provider on the project, so listing it
        //    here would render a button that fails with `auth/operation-not-allowed`.
        //
        //    Why it went: FirebaseUI's email flow decides between sign-in and sign-up by asking
        //    the server whether the account exists. Firebase's **email enumeration protection**
        //    — on by default since 2023, and the same principle as T5, which is why
        //    `usernames/` denies `list` and every failed friend lookup returns one identical
        //    "not found" — makes the server refuse to answer. Verified against this project:
        //    `accounts:createAuthUri` returns a byte-identical response for a known account and
        //    for one that does not exist.
        //
        //    So the widget took the SIGN-UP branch every time, including for people who already
        //    had an account, and its own handler for the resulting collision is
        //    `if ("auth/email-already-in-use" == g.code) return` — it swallows the error and
        //    shows nothing. A returning user filled in a name and a password and the button did
        //    nothing at all.
        //
        //    The three ways out all cost something: a magic link is fiddly on mobile,
        //    disabling enumeration protection undoes T5 at a different door, and hand-built
        //    email screens are real work against a FirebaseUI-only rule. Google already
        //    supplies an email address as the identity, so removing it costs nothing that
        //    Google does not already provide.
        {
          provider: firebase.auth.PhoneAuthProvider.PROVIDER_ID,
          // ⚠️ SMS costs money per attempt and is the standard toll-fraud target; docs/18
          // restricts the SMS region policy to match.
          defaultCountry: 'US',
        },
        {
          provider: firebase.auth.GoogleAuthProvider.PROVIDER_ID,
          // Always show the chooser: a shared laptop that silently reuses the last Google
          // account is how one person's expenses end up in another person's group.
          customParameters: { prompt: 'select_account' },
        },
        // 🔴 Apple — BUILT, TESTED, AND HIDDEN. Flip `APPLE_ENABLED` above to ship it.
        //
        // No `providerName`, `buttonColor` or `iconUrl`: firebaseui 6.1.0 already carries
        // defaults for `apple.com` — "Apple", `#000000`, and its own hosted logo — so spelling
        // them out here would be a second source of truth for Apple's brand rules. Verified
        // rendering correctly on the dev deploy before it was hidden.
        //
        // ⚠️ That logo is fetched from `www.gstatic.com`. There is no CSP on hosting today, so
        //    it loads; adding one has to allow that origin or the button loses its mark.
        //
        // `email` and `name` are the default scopes when "One account per email address" is on,
        // which it is. Named anyway, because switching that setting to multiple accounts
        // silently stops Firebase requesting ANY scope — and then Apple returns no name at all,
        // which `deriveDisplayName` can only answer with "New user".
        ...(APPLE_ENABLED ? [{ provider: 'apple.com', scopes: ['email', 'name'] }] : []),
      ],
      // accountchooser.com was shut down; leaving this on shows a broken interstitial.
      credentialHelper: firebaseui.auth.CredentialHelper.NONE,
      callbacks: {
        signInSuccessWithAuthResult: () => false,
        signInFailure: (error) => {
          onError(error);
          return Promise.resolve();
        },
      },
    });

    return () => {
      // Not `delete()`: `reset()` leaves the instance reusable, which is what the
      // `getInstance()` branch above depends on across a StrictMode remount.
      ui.reset();
    };
  }, [onError]);

  return <div ref={hostRef} />;
}
