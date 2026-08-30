/**
 * Start the local emulator suite.
 *
 * WHY THIS IS NOT JUST `firebase emulators:start --import=... --export-on-exit`:
 *
 * ── 1. The project id was missing, and it is a safety property, not a label ──
 *
 * Without `--project`, the CLI falls back to `default` in `.firebaserc` — which is
 * `splitsutra-dev-eac96`, a REAL project. `.firebaserc` says day-to-day work "runs on the local
 * emulator suite, which needs a 'demo-' project id and never reads this file", and that was not
 * true of this command: it read the file and took the real id.
 *
 * `demo-` is a mechanism rather than a convention. Every Firebase SDK and the CLI treat a
 * `demo-` project as offline-only — the CLI prints "attempts to access non-emulated services for
 * this project will fail" on startup. That is the property that makes a misconfigured host or a
 * stray SDK call physically unable to reach real data, and it is the same reasoning
 * `firebase/seed/src/guard.ts` is built on. Passing the id explicitly is what turns it on.
 *
 * 🔴 The id must match `VITE_FIREBASE_PROJECT_ID` in `apps/web/.env.local` when
 * `VITE_USE_EMULATORS=true`. `singleProjectMode` is on in `firebase.json`, so a mismatch is
 * refused rather than silently served from an empty namespace.
 *
 * ── 2. Function discovery times out on a cold start ──
 *
 * To find the exported functions, the CLI runs the built bundle and asks it for a manifest,
 * with a **10 second** default budget. Loading `lib/index.js` pulls in firebase-admin, zod and
 * the built `@splitsutra/core` — about 2.6s once the OS file cache is warm, and comfortably over
 * 10s on a cold Windows machine. It fails as:
 *
 *     !! functions: Failed to load function definition from source: FirebaseError:
 *        User code failed to load. Cannot determine backend specification. Timeout after 10000.
 *
 * which reads like broken code. It is not: the same bundle imports fine and the manifest
 * endpoint answers in full when the timeout is not in the way. The suite then comes up with
 * every other emulator green and **zero functions registered**, so callables 404 and triggers
 * never fire — the app looks like it has a permissions bug rather than a missing backend.
 *
 * 60s costs nothing on a warm start (discovery finishes as soon as the manifest is served) and
 * removes an error whose message points at the wrong thing.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/** Offline-only by construction. See note 1. */
const PROJECT_ID = 'demo-splitsutra';

/** Seconds. The CLI default is 10 — see note 2. */
const DISCOVERY_TIMEOUT = '60';

const DATA_DIR = './.emulator-data';

const args = ['emulators:start', '--project', PROJECT_ID, '--export-on-exit', DATA_DIR];

// `--import` on a directory that does not exist is a hard error, and it does not exist until the
// first `--export-on-exit` writes it. So the first run imports nothing and every later one
// resumes, without anyone having to know which run they are on.
if (existsSync(DATA_DIR)) {
  args.push('--import', DATA_DIR);
} else {
  console.log('emulators: no %s yet — starting empty, it will be written on exit.\n', DATA_DIR);
}

const result = spawnSync('firebase', [...args, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: DISCOVERY_TIMEOUT },
});

process.exit(result.status ?? 1);
