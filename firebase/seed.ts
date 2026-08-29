/**
 * ============================================================================
 * `pnpm seed` — the entry point
 * ============================================================================
 *
 * Run it against the emulator suite:
 *
 * ```sh
 * firebase emulators:exec --only firestore,auth --project demo-splitsutra "pnpm seed"
 * ```
 *
 * ...or against a suite you already have running:
 *
 * ```sh
 * pnpm seed --project demo-splitsutra
 * ```
 *
 * ## 🔴 The import order in this file is the safety property
 *
 * `./seed/src/guard.js` is imported statically. **Nothing else is.** The writer, the
 * dataset and the Admin SDK are all reached through `await import(...)` further down,
 * *after* the guard has resolved a target and approved it.
 *
 * That is not stylistic. A static `import { runSeed } from './seed/src/writer.js'` at the
 * top of this file would pull in `admin.ts`, which loads `firebase-admin` and reads
 * `FIRESTORE_EMULATOR_HOST` at `initializeApp` time — so the SDK would be loaded, and the
 * emulator routing decided, before the guard had a chance to refuse anything. A refusal
 * that happens after a credential is loaded is a refusal that has already lost most of its
 * value.
 *
 * The guard also *mutates* the environment on success, defaulting the two emulator host
 * variables. Those have to be set before `admin.ts` is evaluated, and a dynamic import is
 * the only way to order the two.
 *
 * `guard.ts` itself is side-effect free — no socket, no SDK, no `initializeApp` — which is
 * what makes it safe to be the one thing loaded eagerly.
 *
 * ## Exit codes
 *
 * `0` success or `--help`; `1` refused or failed. A refusal prints its own boxed message and
 * no stack trace: it is an intended outcome, and a stack would bury the single line the
 * operator needs to read.
 *
 * @see firebase/seed/src/guard.ts — the allowlist, and why `*-prod` has no override
 * @see docs/10-seed-data.md
 * @see checklists/phase-02-firebase-setup.md §6
 */

import { parseArgs, resolveTarget, SeedRefusedError, USAGE } from './seed/src/guard.js';

/** `firebase/seed.ts` → the repository root. Both `.firebaserc` and `dist/` hang off it. */
const REPO_ROOT = new URL('../', import.meta.url);

/**
 * `packages/core/dist` has to exist before the dataset can be imported.
 *
 * `dataset.ts` reaches core by relative path into its **built output** — deliberately, and
 * its header explains why — so on a fresh clone the first `pnpm seed` fails with
 * `ERR_MODULE_NOT_FOUND` naming a path inside `packages/core/dist`. That error is accurate
 * and completely unhelpful: nothing about it says "run the build". This turns it into the
 * instruction.
 *
 * Checked by catching the failed import rather than by stat-ing the directory, so a `dist`
 * that exists but is stale or half-written is caught by the same branch.
 */
function isMissingCoreBuild(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code !== 'ERR_MODULE_NOT_FOUND') return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('packages/core/dist');
}

const MISSING_CORE_BUILD = [
  '',
  '  🔴 SEED FAILED — @splitsutra/core has not been built.',
  '',
  "  The fixture is built from core's split engine and its Zod schemas, and it reaches them",
  "  through packages/core/dist — the package's published entry points — not through its",
  '  source. On a fresh clone that directory does not exist yet.',
  '',
  '  Run this first:',
  '',
  '      pnpm --filter @splitsutra/core build',
  '',
].join('\n');

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  // 🔴 Before any import that can open a connection. See the header.
  const target = resolveTarget(args, process.env, REPO_ROOT);

  // A forced real-project run is the one path that can reach a deployed backend. Say so
  // while it is still possible to hit Ctrl-C.
  if (target.realProject) {
    process.stdout.write(
      [
        '',
        `  ⚠️  --allow-real-project: writing to ${target.projectId}, which is NOT a demo-* project.`,
        '     Only demo-* ids force the Firebase SDKs offline, so this run may reach a live backend.',
        '',
      ].join('\n'),
    );
  }

  const { closeSeed, formatSummary, runSeed } = await import('./seed/src/writer.js');

  try {
    const report = await runSeed(target);
    process.stdout.write(`${formatSummary(target, report)}\n`);
  } finally {
    // Always: the Admin SDK holds gRPC handles that keep the event loop alive, so skipping
    // this on the failure path turns a seed error into a hung terminal.
    await closeSeed();
  }

  return 0;
}

try {
  process.exitCode = await main();
} catch (error: unknown) {
  if (error instanceof SeedRefusedError) {
    // The guard's message is already formatted, and already says what to run instead.
    process.stderr.write(`${error.message}\n`);
  } else if (isMissingCoreBuild(error)) {
    process.stderr.write(`${MISSING_CORE_BUILD}\n`);
  } else {
    process.stderr.write(`\n  🔴 SEED FAILED\n\n`);
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n\n`,
    );
  }
  process.exitCode = 1;
}
