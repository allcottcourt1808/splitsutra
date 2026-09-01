/**
 * Test stand-in for `virtual:pwa-register/react`.
 *
 * That module is synthesised by `vite-plugin-pwa` during a real build. Vitest runs without the
 * plugin, so the import is unresolvable and every test that mounts `<AppShell>` fails at
 * transform time — not on an assertion, but on the import graph.
 *
 * 🔴 Aliased in `vitest.config.ts` rather than mocked per file. A `vi.mock` in one test file
 *    would leave the next one that happens to render the shell failing for a reason that has
 *    nothing to do with what it is testing, and the fix would have to be rediscovered each
 *    time.
 *
 * `needRefresh: false` is the honest default: there is no service worker in a test run, so
 * there is never an update waiting, and `<UpdatePrompt>` renders nothing. A test that wants the
 * prompt on screen should mock this module itself and say so.
 */

export function useRegisterSW(): {
  needRefresh: [boolean, (value: boolean) => void];
  offlineReady: [boolean, (value: boolean) => void];
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
} {
  return {
    needRefresh: [false, () => undefined],
    offlineReady: [false, () => undefined],
    updateServiceWorker: () => Promise.resolve(),
  };
}
