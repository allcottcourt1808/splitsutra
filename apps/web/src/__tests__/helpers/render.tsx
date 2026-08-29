/**
 * A ~40-line stand-in for `@testing-library/react`, which this workspace does not depend on.
 *
 * docs/16 §7 names `@testing-library/react` as the component-test tool, but it is not in any
 * `package.json` here and adding a dependency is not this file's call. Everything the tests
 * in `src/**\/__tests__` actually use from it is `render`, `unmount` and "give me the DOM" —
 * all of which `react-dom/client` provides directly once `act()` is wired up.
 *
 * Queries are deliberately plain `querySelector` / `textContent`: the accessibility contract
 * these tests protect (docs/07 §Accessibility, NFR-4) is spelled in ARIA attributes and
 * element roles, so asserting on those attributes directly is both the clearest statement of
 * the contract and the one that does not need a query library to explain itself.
 */

import { act } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach } from 'vitest';

interface Mounted {
  readonly root: Root;
  readonly container: HTMLElement;
}

/** Everything mounted by the current test file, so nothing outlives its test. */
const mounted: Mounted[] = [];

export interface RenderResult {
  /** The element the tree was mounted into. */
  readonly container: HTMLElement;
  /** Unmount early — e.g. to assert on teardown. Safe to call twice. */
  readonly unmount: () => void;
}

/**
 * Mount `ui` into a fresh container attached to `document.body`.
 *
 * Attached rather than detached: focus, `:focus-visible` and anything reading
 * `document.activeElement` only behave for elements that are in the document.
 */
export function render(ui: ReactNode): RenderResult {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(ui);
  });

  const entry: Mounted = { root, container };
  mounted.push(entry);

  return {
    container,
    unmount: () => {
      unmount(entry);
    },
  };
}

/**
 * Mount `ui` inside a router sitting at `pathname`.
 *
 * `MemoryRouter` rather than the real `createBrowserRouter`: the components under test read
 * the location through `useLocation` and render `<Link>`s, and neither cares which history
 * implementation is underneath. A memory history also lets one test file visit a dozen
 * paths without touching `window.history`.
 */
export function renderAt(ui: ReactElement, pathname: string): RenderResult {
  return render(<MemoryRouter initialEntries={[pathname]}>{ui}</MemoryRouter>);
}

function unmount(entry: Mounted): void {
  const index = mounted.indexOf(entry);
  if (index === -1) return;
  mounted.splice(index, 1);
  act(() => {
    entry.root.unmount();
  });
  entry.container.remove();
}

/** Registered once per test file, when a test file imports this module. */
afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted[mounted.length - 1];
    if (entry === undefined) break;
    unmount(entry);
  }
});
