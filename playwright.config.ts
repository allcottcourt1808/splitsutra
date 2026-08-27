/**
 * Playwright config — docs/16-testing-setup.md §6 and docs/20-test-automation-pipeline.md §3.
 *
 * One config, three projects, two very different jobs:
 *   e2e-mobile / e2e-desktop  → the local emulator suite, driven by `pnpm test:e2e`
 *   smoke                     → a DEPLOYED environment, driven by `pnpm test:smoke`
 *
 * The phone viewport is the design target (NFR-3, docs/07), so `e2e-mobile` runs first.
 */
import { defineConfig, devices } from '@playwright/test';

/**
 * 🔴 docs/20 §4: refuse to run smoke without an explicit target. A default that silently
 * points at localhost turns a production gate into a no-op that always passes.
 */
const SMOKE_BASE_URL = process.env.SMOKE_BASE_URL ?? '';

const isSmokeRun = process.argv.some((arg) => arg === 'smoke' || arg.endsWith('=smoke'));

if (isSmokeRun && !SMOKE_BASE_URL) {
  throw new Error(
    'SMOKE_BASE_URL is not set. The smoke suite must be pointed at a real deployed ' +
      'environment (e.g. https://splitsutra-dev.web.app). Refusing to run — see ' +
      'docs/20-test-automation-pipeline.md §4.',
  );
}

const LOCAL_BASE_URL = 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './e2e/specs',
  timeout: 30_000,
  fullyParallel: false, // one shared emulator
  retries: process.env.CI ? 2 : 0, // locally a flake must fail loudly
  reporter: process.env.CI ? [['html'], ['github']] : 'list',
  use: {
    baseURL: LOCAL_BASE_URL,
    trace: 'on-first-retry', // traces are how you debug CI-only failures
    video: 'retain-on-failure',
  },

  // The emulator harness is meaningless when the target is a deployed environment, so the
  // seed/global-setup step and the local dev server are both skipped on a smoke run.
  ...(isSmokeRun
    ? {}
    : {
        globalSetup: './e2e/global-setup.ts',
        webServer: {
          command: 'pnpm --filter @splitsutra/web dev',
          url: LOCAL_BASE_URL,
          reuseExistingServer: !process.env.CI,
          env: { VITE_USE_EMULATORS: 'true' },
        },
      }),

  projects: [
    { name: 'e2e-mobile', use: { ...devices['Pixel 7'], baseURL: LOCAL_BASE_URL } },
    { name: 'e2e-desktop', use: { ...devices['Desktop Chrome'], baseURL: LOCAL_BASE_URL } },
    {
      // Four checks, under two minutes, against real infrastructure. docs/20 §4.
      name: 'smoke',
      testDir: './e2e/smoke',
      retries: 2, // real network; a transient failure is not a bug
      use: { ...devices['Pixel 7'], baseURL: SMOKE_BASE_URL },
    },
  ],
});
