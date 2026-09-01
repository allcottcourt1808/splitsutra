/**
 * Application entry point. `index.html` loads exactly this file and nothing else.
 *
 * Startup itself lives in `platform/startup.ts` — tokens, the platform adapter, and
 * `initFirebase`, in that order, because each needs the one before it. This file does the two
 * things that genuinely belong to the entry point: find the root element, and decide what to
 * render into it.
 *
 * 🔴 **A failed startup renders a screen, it does not throw.** `readFirebaseConfig()` throws on
 * a missing `.env.local`, and at module scope that lands before `createRoot` — so the app
 * mounts nothing and the symptom is a blank white page that reads like a broken build. That is
 * the first thing anyone cloning this repo hits, so it gets a real screen naming the missing
 * variables (`SetupRequiredScreen`).
 *
 * StrictMode is on deliberately, even though it double-invokes effects in development. That
 * double-invocation is what surfaces the setup bugs this app is most exposed to — a second
 * `initializeApp`, a second `onAuthStateChanged` subscription, auth persistence applied
 * twice — and every one of those paths is written to survive it: `initFirebase()` returns its
 * existing handles instead of re-initialising, and `authStore` starts its listener once and
 * never tears it down on refcount zero. Turning StrictMode off would hide the class of bug it
 * exists to reveal.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import './styles/reset.css';
import './styles/global.css';

import { startApp } from './platform/startup';
import { router } from './routes';
import { SetupRequiredScreen } from './screens/SetupRequiredScreen';
import { UpdatePrompt } from './pwa/UpdatePrompt';

const startup = startApp();

const container = document.getElementById('root');

if (container === null) {
  // Not a recoverable condition: index.html ships with this element, so its absence means
  // the HTML shell was replaced or the script was loaded into the wrong page. Failing loudly
  // beats rendering nothing and leaving a blank screen to diagnose.
  throw new Error('[splitsutra] #root is missing from index.html — cannot mount the app.');
}

createRoot(container).render(
  <StrictMode>
    {startup.ok ? (
      <RouterProvider router={router} />
    ) : (
      <SetupRequiredScreen error={startup.error} />
    )}
    {/* 🔴 ABOVE the router, and that placement is load-bearing rather than tidy.
        Mounting this component is what REGISTERS the service worker (it is the only caller of
        `useRegisterSW`). Inside `AppShell` — where it started — the shell sits behind the auth
        guard, so the worker registered only after sign-in: a first-time visitor sitting on
        /login could never install the app, and the shell was never cached. Here it runs on
        every route, signed in or not.

        It renders nothing until an update is waiting, and uses `onPress` rather than `to`, so
        it needs no router context. */}
    <UpdatePrompt />
  </StrictMode>,
);
