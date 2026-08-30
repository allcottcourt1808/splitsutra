/**
 * Build the Cloud Functions bundle. Used as the `functions.predeploy` hook in `firebase.json`.
 *
 * WHY THIS EXISTS AND `pnpm --filter @splitsutra/functions build` DOES NOT WORK:
 *
 * As a predeploy hook, that command prints
 *
 *     Running command: pnpm --filter @splitsutra/functions build
 *     No projects matched the filters in "C:\...\splitsutra"
 *     +  functions: Finished running predeploy script.
 *
 * — and firebase-tools treats it as a **success**, because pnpm exits 0 when a filter matches
 * nothing. So the predeploy silently compiled nothing and the deploy shipped whatever happened
 * to be sitting in `lib/`: stale code, or on a clean checkout no code at all. A hook that cannot
 * fail is worse than no hook, because it reads as coverage — the same reasoning
 * `scripts/depcruise.mjs` was written for.
 *
 * The filter works from an interactive shell, from bash, through `cmd /c`, and from inside
 * `firebase/functions`. It fails only under the environment firebase-tools spawns hooks with, so
 * the cause is that environment rather than the cwd or the shell. Rather than chase which
 * variable does it, this sidesteps pnpm's workspace resolution altogether: two `tsc` invocations
 * against two explicit tsconfigs, which is all `build` ever expanded to.
 *
 * 🔴 Order matters. `firebase/functions` imports `@splitsutra/core` through its package entry
 * points, which name `dist/` — so core must be compiled first or the Functions build resolves
 * against a stale (or absent) `dist`. This is the same ordering `typecheck:seed` needs, for the
 * same reason (see CLAUDE.md, "Two resolvers").
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);

/**
 * Resolved rather than assumed to be on `PATH`. `tsc` reaches the shell via a `node_modules/.bin`
 * shim, and whether that directory is on `PATH` is exactly the sort of thing the hook environment
 * changes — which is the bug this file exists to route around.
 */
const TSC = require.resolve('typescript/bin/tsc');

/** Compiled in this order, for the reason in the header. */
const PROJECTS = [
  ['@splitsutra/core', 'packages/core/tsconfig.build.json'],
  ['@splitsutra/functions', 'firebase/functions/tsconfig.json'],
];

for (const [name, project] of PROJECTS) {
  if (!existsSync(project)) {
    // Loud, not skipped. A missing tsconfig here means the deploy would ship nothing, and that
    // is the failure mode this script was written to stop being silent.
    console.error(`build-functions: ${project} does not exist — cannot build ${name}.`);
    process.exit(1);
  }

  console.log('build-functions: compiling %s (%s)', name, project);
  const result = spawnSync(process.execPath, [TSC, '-p', project], { stdio: 'inherit' });

  if (result.status !== 0) {
    console.error(`build-functions: ${name} failed to compile — not deploying.`);
    process.exit(result.status ?? 1);
  }
}

console.log('build-functions: done.');
