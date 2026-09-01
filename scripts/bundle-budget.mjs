/**
 * NFR-2: the JavaScript a first paint waits on must stay under 350 KB gzipped.
 *
 * ## Why this script exists at all
 *
 * The budget was breached by 69,269 B and nothing noticed. CI **does** run `pnpm build` — it
 * always has — so the bundle was rebuilt on every push. What it never did was **measure the
 * output**. `chunkSizeWarningLimit: 300` in `vite.config.ts` printed a warning, and a warning
 * does not fail a build; it goes into the log of a green job, which nobody opens.
 *
 * That is the narrow, boring gap this closes: not "build the app" but "assert something about
 * what the build produced". A budget nothing asserts is a comment.
 *
 * ## What it measures, and why that is the honest number
 *
 * Every `.js` file `dist/index.html` tells the browser to fetch **before it can render**: the
 * entry `<script type="module">` plus any `<link rel="modulepreload">` Vite emits for the entry's
 * static imports. Summed, gzipped.
 *
 * That is deliberately not "the biggest chunk" and not "everything in dist/". A lazily imported
 * route (today: `/login`, which carries `firebaseui` + `firebase/compat`) is fetched only by
 * someone who visits it, so counting it would punish the very split that fixed this. And the
 * service worker precaches all of it eventually — but *after* load, off the critical path,
 * which is exactly the distinction the budget is about.
 *
 * ⚠️ Gzip, not brotli. Hosting negotiates brotli with most modern browsers and it would report a
 * smaller, friendlier number — which is why gzip is the one used here. NFR-2 is a ceiling, and a
 * ceiling should be measured with the pessimistic tool.
 *
 * Usage — needs a build to already exist:
 *   pnpm --filter @splitsutra/web build && node scripts/bundle-budget.mjs
 */

import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** NFR-2. Binary KB, the stricter of the two readings of "350 KB". */
const BUDGET_BYTES = 350 * 1024;

const distDir = resolve(import.meta.dirname, '../apps/web/dist');
const indexHtml = join(distDir, 'index.html');

function fail(message) {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

let html;
try {
  html = readFileSync(indexHtml, 'utf8');
} catch {
  fail(`No build found at ${indexHtml}.\n    Run: pnpm --filter @splitsutra/web build`);
}

/**
 * The entry script and any module preloaded alongside it.
 *
 * Matching on the emitted HTML rather than on a glob of `dist/assets` is the whole point: the
 * HTML is the browser's own answer to "what do I need before I can paint", so this cannot drift
 * from reality the way a hand-maintained file list would.
 */
const CRITICAL_JS =
  /<(?:script[^>]*\ssrc|link[^>]*\brel="modulepreload"[^>]*\shref)="([^"]+\.js)"/g;

const files = [...html.matchAll(CRITICAL_JS)].map((match) => match[1]);
if (files.length === 0) {
  fail('Parsed dist/index.html but found no entry script. Has the build output changed shape?');
}

let total = 0;
const rows = files.map((href) => {
  // Vite writes root-absolute hrefs (`/assets/index-abc.js`); `dist/` is the web root.
  const bytes = gzipSync(readFileSync(join(distDir, href.replace(/^\//, '')))).length;
  total += bytes;
  return { href, bytes };
});

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

console.log('\n  Critical-path JavaScript (gzipped)\n');
for (const row of rows) console.log(`    ${row.href.padEnd(46)} ${kb(row.bytes).padStart(10)}`);
console.log(`    ${'─'.repeat(46)} ${'─'.repeat(10)}`);
console.log(`    ${'total'.padEnd(46)} ${kb(total).padStart(10)}`);
console.log(`    ${'NFR-2 budget'.padEnd(46)} ${kb(BUDGET_BYTES).padStart(10)}`);

if (total > BUDGET_BYTES) {
  fail(
    `Over the NFR-2 budget by ${kb(total - BUDGET_BYTES)}.\n` +
      '    Route splitting will NOT fix this — the screens are 2-7 KB each and the weight is\n' +
      '    one shared vendor chunk. See the measurements in apps/web/src/routes.tsx.',
  );
}

const headroom = BUDGET_BYTES - total;
console.log(`\n  ✔ Under budget, ${kb(headroom)} to spare.`);

// The margin is genuinely thin, and a check that only ever says "pass" trains people to skip
// reading it. Say so while it is still cheap to act on.
if (headroom < 32 * 1024) {
  console.log(
    '    ⚠ Under 32 KB of headroom. The next dependency bump may well breach this;\n' +
      '      the lever is the vendor chunk (Firebase entry points, firebaseui), not routes.',
  );
}
console.log('');
