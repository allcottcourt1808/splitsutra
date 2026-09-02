/**
 * Run the integration suite: the emulator-backed round-trip tests in
 * `firebase/tests/integration/`.
 *
 * WHY THIS IS NOT JUST `firebase emulators:exec ... "vitest run --project integration"`:
 *
 * ── 1. The functions bundle has to be built, and built LAST ──
 *
 * The Functions emulator loads `firebase/functions/lib/index.js`, which is whatever was
 * emitted there most recently. Two different things write that path:
 *
 *   - `pnpm build` (`-r --if-present build`) runs the package's own `tsc`, which emits a
 *     module that imports `@splitsutra/core` as a bare specifier. That specifier does not
 *     resolve at runtime, because core is deliberately absent from the package's
 *     dependencies (see the `//no-core-dependency` note in firebase/functions/package.json).
 *   - `scripts/build-functions.mjs` runs esbuild and INLINES core into the same file.
 *
 * Only the second one is loadable. They write the same path, so whichever ran last wins,
 * and `pnpm build` running afterwards silently replaces a working bundle with one the
 * emulator cannot load. Building here means the suite never depends on what the caller
 * happened to run before it.
 *
 * ── 2. Function discovery times out on a cold start ──
 *
 * The same trap `scripts/emulators.mjs` documents at length, which `test:integration` never
 * got because it called the CLI directly. To find the exported functions the CLI runs the
 * bundle and asks it for a manifest, with a **10 second** default budget. Measured on this
 * machine: 2.1s once the OS file cache is warm, and **65s cold** — pnpm's node_modules tree
 * is thousands of small files and Windows reads them one at a time the first time.
 *
 * It fails as:
 *
 *     !! functions: Failed to load function definition from source: FirebaseError:
 *        User code failed to load. Cannot determine backend specification. Timeout after 10000.
 *
 * 🔴 and then `emulators:exec` RUNS THE TESTS ANYWAY, against a suite with every other
 * emulator green and zero functions registered. Nothing waits, nothing fires, and all ten
 * tests fail on their own `waitFor` timeout 20 seconds apart — which reads as ten broken
 * tests rather than one missing backend. That is exactly what it looked like the first time,
 * and the tests were fine.
 *
 * 120s costs nothing on a warm start: discovery finishes the moment the manifest is served.
 */
import { spawnSync } from 'node:child_process';

/** Must match `PROJECT_ID` in firebase/tests/integration/helpers.ts. `demo-` forces SDKs offline. */
const PROJECT_ID = 'demo-integration';

/** Seconds. The CLI default is 10 — see note 2. Cold import measured at 65s. */
const DISCOVERY_TIMEOUT = '120';

/**
 * One command STRING, not a command plus an argv array.
 *
 * ⚠️ With `shell: true`, Node joins argv with spaces and hands the result to the shell, so an
 * argument that itself contains quotes — `"vitest run --project integration"`, which
 * `emulators:exec` requires as a single word — comes out mangled. The symptom is not an error:
 * `cmd` sits there, no emulator ever binds a port, and the run hangs with the last line of
 * output being this script's own build message. Passing the whole line through as written is
 * unambiguous in both `cmd` and `sh`.
 */
function run(commandLine, extraEnv = {}) {
  const result = spawnSync(commandLine, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...extraEnv },
  });
  return result.status ?? 1;
}

// Note 1 — must come before the emulator starts, and after any `pnpm build` the caller ran.
console.log('test-integration: building the functions bundle (esbuild, core inlined)\n');
const built = run('node scripts/build-functions.mjs');
if (built !== 0) process.exit(built);

const passthrough = process.argv.slice(2).join(' ');

const status = run(
  `firebase emulators:exec --only firestore,auth,functions --project ${PROJECT_ID} ` +
    `"vitest run --project integration ${passthrough}"`,
  { FUNCTIONS_DISCOVERY_TIMEOUT: DISCOVERY_TIMEOUT },
);

process.exit(status);
