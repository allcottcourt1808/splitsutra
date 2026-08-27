/**
 * Application entry point. `index.html` loads exactly this file and nothing else.
 *
 * The order of the three setup calls below is not arbitrary, and getting it wrong produces
 * failures that look unrelated to startup:
 *
 *   1. `installTokenCssVars()` writes the design tokens onto `:root` as CSS custom
 *      properties. Every stylesheet in the app reads `var(--…)`, so this has to run before
 *      the first paint or the first frame renders unstyled.
 *   2. `setPlatformAdapter(webAdapter)` hands core the one thing it refuses to decide for
 *      itself (Article II). Core throws if something reaches for the adapter before it is
 *      set, so this belongs here — above React — rather than inside a component.
 *   3. `createRoot(...).render(...)` last, once the two above are true for every component
 *      that is about to mount.
 *
 * StrictMode is on deliberately, even though it double-invokes effects in development. That
 * double-invocation is what surfaces the setup bugs this app is most exposed to — a second
 * `initializeApp`, or auth persistence applied twice — and `getAuthClient` memoises a
 * promise specifically so that it survives it. Turning StrictMode off would hide the class
 * of bug it exists to reveal.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { setPlatformAdapter } from '@splitsutra/core';

import './styles/reset.css';
import './styles/global.css';

import { webAdapter } from './platform/webAdapter';
import { router } from './routes';
import { installTokenCssVars } from './styles/tokensCss';

installTokenCssVars();
setPlatformAdapter(webAdapter);

const container = document.getElementById('root');

if (container === null) {
  // Not a recoverable condition: index.html ships with this element, so its absence means
  // the HTML shell was replaced or the script was loaded into the wrong page. Failing loudly
  // beats rendering nothing and leaving a blank screen to diagnose.
  throw new Error('[splitsutra] #root is missing from index.html — cannot mount the app.');
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
