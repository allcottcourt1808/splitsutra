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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';

const require = createRequire(import.meta.url);

/**
 * Resolved from inside `firebase/functions`, not from here. pnpm's strict layout only puts a
 * package under the `node_modules` of whichever workspace project declares it, and esbuild is a
 * devDependency of the functions package — so resolving it relative to `scripts/` finds nothing.
 */
const requireFromFunctions = createRequire(
  new URL('../firebase/functions/package.json', import.meta.url),
);

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

/* ── Inline @splitsutra/core ─────────────────────────────────────────────────────────────── */

/**
 * 🔴 WHY THE OUTPUT IS BUNDLED, AND A DEPLOY FAILS WITHOUT IT:
 *
 * `firebase deploy` uploads **only** `firebase/functions` and Cloud Build then runs `npm install`
 * inside it. There is no workspace up there and no `packages/core`, so the manifest's
 * `"@splitsutra/core": "workspace:*"` is a protocol npm has never heard of:
 *
 *     npm error code EUNSUPPORTEDPROTOCOL
 *     npm error Unsupported URL Type "workspace:": workspace:*
 *
 * — and all 14 functions fail to build. Hit against the real dev project.
 *
 * So core is inlined here instead of shipped as a dependency. Only the **root barrel** is
 * imported by `firebase/functions` (all 16 import sites), and that barrel deliberately excludes
 * `./firebase`, `./repositories`, `./hooks` and `./stores` — see CLAUDE.md — so nothing drags the
 * client Firestore SDK into a process running the Admin SDK. That exclusion is what makes
 * bundling safe rather than a way to smuggle the wrong SDK into Functions.
 *
 * Everything npm genuinely installs on the server stays external. Bundling `firebase-functions`
 * in particular would break deployment outright: the CLI discovers the exported functions by
 * loading this file and reading the SDK's own registry, which only works when the SDK is the
 * same instance the runtime later loads.
 */
const ENTRY = 'firebase/functions/lib/index.js';
const BUNDLE = 'firebase/functions/lib/index.bundle.js';

/** Core's compiled root barrel, written by the first tsc pass above. */
const CORE_ENTRY = fileURLToPath(new URL('../packages/core/dist/index.js', import.meta.url));

if (!existsSync(CORE_ENTRY)) {
  console.error('build-functions: %s missing — core did not emit. Not deploying.', CORE_ENTRY);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync('firebase/functions/package.json', 'utf8'));

// Read from the manifest rather than listed literally: whatever npm installs up there must not
// also be baked in here, and a dependency added later would otherwise be silently duplicated.
const external = Object.keys(manifest.dependencies ?? {}).filter(
  (name) => name !== '@splitsutra/core',
);

console.log('build-functions: bundling core into %s (external: %s)', ENTRY, external.join(', '));

/**
 * esbuild is driven through its JS API, NOT by spawning `node esbuild/bin/esbuild`.
 *
 * 🔴 That path is not the same kind of file on every platform. On Windows it is a JavaScript
 * shim that re-execs the real `.exe`, so handing it to `node` works. On Linux it is the
 * **native binary itself**, and `node` tries to parse an ELF header as JavaScript:
 *
 *     node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/bin/esbuild:1
 *     ELF^B^A^A^@ ...
 *     SyntaxError: Invalid or unexpected token
 *
 * This script only ever ran on Windows — it is the `firebase.json` predeploy hook, and every
 * deploy so far has been by hand from this machine — so the assumption held for months and
 * broke the first time CI ran it. The JS API has no bin file and no platform branch.
 *
 * Resolved from the functions package rather than the root: esbuild is ITS devDependency, and
 * under pnpm a package is only reachable from the workspace project that declares it.
 */
const esbuildEntry = requireFromFunctions.resolve('esbuild');
const esbuildModule = await import(pathToFileURL(esbuildEntry).href);
// esbuild's entry is CJS. Node's named-export detection usually finds `build`, but the
// interop shape is not something to bet a deploy on, so both are accepted.
const esbuild = esbuildModule.build === undefined ? esbuildModule.default : esbuildModule;

try {
  await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    outfile: BUNDLE,
    logLevel: 'info',
    // Explicit, because `@splitsutra/core` is no longer a declared dependency of the functions
    // package (see "//no-core-dependency" in its package.json), so pnpm creates no node_modules
    // symlink for esbuild to follow. This is the runtime half of the tsconfig `paths` mapping.
    alias: { '@splitsutra/core': CORE_ENTRY },
    // `node:*` because `--platform=node` already externalises the built-ins, but a bare `node:`
    // specifier reaching esbuild unresolved is the failure that would otherwise surface at cold
    // start rather than here.
    external: [...external, 'node:*'],
  });
} catch {
  // esbuild has already printed the diagnostic at logLevel 'info'.
  console.error('build-functions: bundling failed — not deploying.');
  process.exit(1);
}

// Replace the entry point in place, so `main` in package.json keeps pointing at lib/index.js and
// nothing downstream has to know this step happened.
rmSync(ENTRY, { force: true });
renameSync(BUNDLE, ENTRY);

console.log('build-functions: done.');
