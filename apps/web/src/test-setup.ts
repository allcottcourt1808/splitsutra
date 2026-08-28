/**
 * Vitest setup for the `component` project (see the root `vitest.config.ts`, docs/16 §7).
 *
 * docs/16 §7 sketches this file as three lines of `@testing-library` wiring. That package is
 * not a dependency of this workspace, so the two jobs it would have done are done directly
 * against `react-dom/client` instead:
 *
 *   1. **Declare an `act()` environment.** React only flushes `root.render()` synchronously
 *      — and only warns about updates made outside `act()` — when this flag is set. Without
 *      it a component test asserts against a DOM React has not committed yet.
 *
 *   2. **Leave the document empty between tests.** `src/__tests__/helpers/render.tsx` mounts
 *      each render into its own container and unmounts it afterwards; this is the backstop
 *      for a test that throws mid-render and never reaches that unmount, which would
 *      otherwise leak its markup into the next test's queries.
 *
 * Nothing here is app behaviour, so nothing here should ever need a component to change.
 */

import { afterEach } from 'vitest';

/**
 * React reads this off the global to decide whether `act()` is expected. It is not part of
 * React's published type surface, hence the narrow cast rather than a `declare global`.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});
