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
        {
          provider: firebase.auth.EmailAuthProvider.PROVIDER_ID,
          // This is what makes it a sign-up page as well as a sign-in one: the widget asks for
          // a name on account creation, which seeds `displayName` so the first
          // `upsertUserProfile` has a real name rather than the email local-part — and that
          // function never rewrites the name later, so the seed is the only chance.
          requireDisplayName: true,
        },
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
