/**
 * Root Vitest config — docs/16-testing-setup.md §1, checklists/phase-02b-testing-setup.md §2.
 *
 * Four test kinds, four environments, one config. `test.projects` is the current API; older
 * Vitest versions used a separate `vitest.workspace.ts` file for the same concept. This repo
 * pins Vitest 3.2+, which documents `test.projects`.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Pure domain logic — no I/O, milliseconds
        test: {
          name: 'unit',
          root: './packages/core',
          environment: 'node',
          include: ['src/**/__tests__/**/*.test.ts'],
        },
      },
      {
        // Web components — sparse by design (docs/16 §7)
        test: {
          name: 'component',
          root: './apps/web',
          environment: 'happy-dom',
          setupFiles: ['./src/test-setup.ts'],
          // Both extensions: the `unit` project is rooted at packages/core, so a `.test.ts`
          // under apps/web was previously collected by neither project and never ran.
          include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
        },
      },
      {
        // Security rules — shared emulator state
        test: {
          name: 'rules',
          root: './firebase',
          environment: 'node',
          include: ['tests/rules/**/*.test.ts'],
          testTimeout: 15_000,
          // ⚠️ Rules and integration tests share one emulator. Running files in parallel
          // means one test's clearFirestore() wipes another's fixtures — failures that do
          // not reproduce locally. See docs/16 §3 for the faster per-project-ID alternative.
          fileParallelism: false,
        },
      },
      {
        // Cloud Functions against the emulator
        test: {
          name: 'integration',
          root: './firebase',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 30_000, // trigger round-trips take seconds
          hookTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        // NFR-8 + Article VII: the money math must be exhaustively covered.
        'packages/core/src/domain/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  },
});
