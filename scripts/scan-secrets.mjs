/**
 * Refuse to let a credential into git history, at the last moment it is still reversible.
 *
 * WHY .gitignore IS NOT THIS:
 *
 * `.gitignore` matches **filenames**. It stops `my-project-firebase-adminsdk-abc12.json`
 * and nothing else. A service-account key saved as `config.json`, pasted into a `.ts`
 * fixture, or force-added with `git add -f` walks straight past every pattern in there.
 * The patterns are a backstop; this is the guard (docs/10-deployment.md, NFR-7).
 *
 * WHY IT MATTERS MORE THAN A FAILING TEST:
 *
 * A Firebase Admin service-account key grants full read/write on the whole database and
 * **bypasses Security Rules entirely** — every invariant in firestore.rules stops applying
 * to whoever holds it. Once it is in a public repo's history it is permanently compromised:
 * rotating the key is the only remedy, because the object is still there in every clone and
 * every fork. That is a different category of risk from a red test, which is why this runs
 * before the commit object exists rather than in CI after it does.
 *
 * WHY NOT gitleaks, WHICH THE DOCS NAME:
 *
 * gitleaks is a Go binary that every contributor and every CI image has to install before
 * the hook does anything; a hook that silently no-ops when the binary is missing is worse
 * than no hook, because it reads as coverage. This is ~200 lines of Node — the runtime the
 * repo already requires — so it works on a fresh clone with zero setup. It scans far less
 * than gitleaks does, which is the trade: it catches the credentials this project can
 * actually leak. Layering gitleaks on top later is additive, not a rewrite.
 *
 * WHAT IT DELIBERATELY DOES NOT FLAG:
 *
 * `VITE_FIREBASE_API_KEY` and the rest of the Firebase web config. Those are public
 * identifiers by design — they ship in the bundle to every visitor and are meaningless
 * without Security Rules to authorise the request. Flagging them would fire on `.env.example`
 * and on every developer's real `.env.local`, and a hook that cries wolf is a hook people
 * learn to `--no-verify` past. The rule that DOES apply to `VITE_` is below: anything that
 * is genuinely secret must never wear that prefix, because Vite inlines every `VITE_*`
 * variable into the public bundle at build time.
 */
import { execFileSync } from 'node:child_process';

/**
 * Above this, skip the file. Bundles, lockfiles and source maps are megabytes of
 * high-entropy text that this scanner has nothing useful to say about, and reading them on
 * every commit is what turns a hook into something people disable.
 */
const MAX_BYTES = 512 * 1024;

/**
 * Fixture strings are assembled from fragments on purpose, so that no rule below matches
 * this file's own source. The alternative — exempting `scripts/scan-secrets.mjs` from the
 * scan — would carve out exactly one file in the repo where a secret could be hidden with
 * the scanner's blessing. There is no exemption list, and there should not be one.
 *
 * This is self-enforcing rather than a convention to remember: the hook scans this file
 * along with every other, so a fixture written as a plain literal blocks the commit that
 * adds it. Three of the samples below were caught that way on the hook's first run.
 */
const frag = (...parts) => parts.join('');

/* ── Content rules ─────────────────────────────────────────────────────────────────────── */

const CONTENT_RULES = [
  {
    name: 'Firebase/GCP service-account key',
    why: 'Full database access, bypassing every Security Rule. Permanently compromised once pushed.',
    re: /"type"\s*:\s*"service_account"/,
  },
  {
    name: 'PEM private key',
    why: 'A private key block — service-account, SSH or TLS.',
    re: /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/,
  },
  {
    name: 'Google OAuth client secret',
    why: 'Impersonates this app to Google sign-in.',
    re: /GOCSPX-[\w-]{20,}/,
  },
  {
    name: 'GitHub token',
    why: 'Repository access as you, including force-push and secrets.',
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/,
  },
  {
    name: 'AWS access key id',
    why: 'Paired with a secret it is account access; alone it identifies the account.',
    re: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    name: 'Slack token',
    why: 'Reads and posts as the installing user or bot.',
    re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  },
  {
    // Project-specific, and the one most likely to be tripped by accident. Vite inlines
    // every VITE_* variable into the bundle at build time, so a secret behind this prefix
    // is published to every visitor the moment it deploys — no leak of the repo required.
    name: 'Secret behind a VITE_ prefix',
    why: 'Vite inlines every VITE_* variable into the public bundle. Move it to a Function.',
    re: /\bVITE_[A-Z0-9_]*(?:SECRET|PASSWORD|PRIVATE|CREDENTIAL|SERVICE_ACCOUNT)[A-Z0-9_]*\s*=\s*\S/,
  },
];

/* ── Path rules ────────────────────────────────────────────────────────────────────────── */

/**
 * These restate `.gitignore`, on purpose: `git add -f` ignores `.gitignore` and nothing
 * else in the repo notices. Staging one of these files is never accidental, so the message
 * says so rather than suggesting a fix.
 */
const PATH_RULES = [
  {
    name: 'service-account key filename',
    why: 'Matches a .gitignore pattern, so this file was force-added.',
    re: /(?:-firebase-adminsdk-|\.serviceaccount\.|serviceaccount|service-account|gcp-credentials)[^/]*\.json$/i,
  },
  {
    name: 'environment file',
    why: '.env files hold whatever you last pasted into them. Only .env.example is committed.',
    re: /(?:^|\/)\.env(?:\.|$)/,
    unless: /(?:^|\/)\.env\.example$/,
  },
];

/* ── Scanning ──────────────────────────────────────────────────────────────────────────── */

/**
 * Scan text, returning one finding per rule — not per match. A leaked key file trips the
 * same rule on hundreds of lines, and burying the one useful line under that is how a
 * developer ends up skipping the output and rerunning with --no-verify.
 */
export function scanText(text) {
  const findings = [];
  const lines = text.split('\n');

  for (const rule of CONTENT_RULES) {
    const index = lines.findIndex((line) => rule.re.test(line));
    if (index !== -1) {
      findings.push({ rule: rule.name, why: rule.why, line: index + 1 });
    }
  }
  return findings;
}

export function scanPath(path) {
  return PATH_RULES.filter((rule) => rule.re.test(path) && !rule.unless?.test(path)).map(
    (rule) => ({ rule: rule.name, why: rule.why, line: null }),
  );
}

/**
 * The staged blob, not the file on disk. `git add -p` and an edit made after staging both
 * leave the working tree different from what is about to be committed, and it is the latter
 * that enters history. Reading `:path` asks the index directly.
 */
function stagedBytes(path) {
  return execFileSync('git', ['show', `:${path}`], { maxBuffer: MAX_BYTES * 4 });
}

function stagedPaths() {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'], {
    encoding: 'utf8',
  });
  return out.split('\0').filter(Boolean);
}

function run() {
  const problems = [];

  for (const path of stagedPaths()) {
    for (const finding of scanPath(path)) {
      problems.push({ path, ...finding });
    }

    let bytes;
    try {
      bytes = stagedBytes(path);
    } catch {
      // Unreadable from the index (a submodule gitlink, or a blob larger than maxBuffer).
      // Nothing to scan, and failing the commit over it would block work for no benefit.
      continue;
    }

    // A NUL byte means binary. Images and fonts are not where a key hides, and decoding
    // them as UTF-8 produces noise that matches nothing.
    if (bytes.length > MAX_BYTES || bytes.includes(0)) continue;

    for (const finding of scanText(bytes.toString('utf8'))) {
      problems.push({ path, ...finding });
    }
  }

  if (problems.length === 0) return 0;

  // The matched text is never printed. Echoing a live credential into a terminal
  // scrollback — or a CI log, if this ever runs there — is its own small leak.
  console.error('\n  ✖ Possible credential in staged changes — commit blocked.\n');
  for (const p of problems) {
    const where = p.line === null ? p.path : `${p.path}:${p.line}`;
    console.error(`    ${where}\n      ${p.rule} — ${p.why}\n`);
  }
  console.error('  Unstage it, then rotate the credential if it was ever real:');
  console.error('    git restore --staged <file>\n');
  console.error('  A false positive can be committed with `git commit --no-verify`.');
  console.error('  If you have to do that twice for the same reason, fix the rule instead:');
  console.error('    scripts/scan-secrets.mjs\n');
  return 1;
}

/* ── Self-test ─────────────────────────────────────────────────────────────────────────── */

/**
 * No Vitest project covers `scripts/` — the four in vitest.config.ts are rooted at
 * packages/core, apps/web and firebase — and adding a fifth for one file is more machinery
 * than the file is worth. So the samples live here and CI runs `--self-test`.
 *
 * The negative cases are the half that matters. A scanner that flags `.env.example` or the
 * public Firebase web config gets muted within a week, and a muted scanner catches nothing.
 */
const SAMPLES = {
  positive: [
    ['service account', frag('{ "type": "service_', 'account", "project_id": "x" }')],
    ['pem block', frag('-----BEGIN RSA PRIVATE', ' KEY-----')],
    ['oauth secret', frag('GOCSPX', '-abcdefghijklmnopqrstuvwx')],
    ['github pat', frag('ghp_', 'A'.repeat(36))],
    ['aws key id', frag('AKIA', 'ABCDEFGHIJKLMNOP')],
    ['slack token', frag('xoxb', '-123456789012-abcdefghij')],
    ['secret behind VITE_', frag('VITE_ADMIN_', 'SECRET=hunter2')],
    ['password behind VITE_', frag('VITE_DB_', 'PASSWORD=hunter2')],
  ],
  negative: [
    ['the public web api key', 'VITE_FIREBASE_API_KEY=AIzaSyDummyValueForTheExampleFile'],
    ['the rest of the web config', 'VITE_FIREBASE_APP_ID=1:123:web:abc'],
    ['an empty placeholder', frag('VITE_ADMIN_', 'SECRET=')],
    ['prose about service accounts', 'Never commit a service-account key to this repo.'],
    ['a type field that is not one', '{ "type": "service" }'],
    ['a public key block', frag('-----BEGIN PUBLIC', ' KEY-----')],
    ['an ordinary constant', 'const AKIAS_PER_PAGE = 20;'],
  ],
};

function selfTest() {
  const failures = [];

  for (const [label, text] of SAMPLES.positive) {
    if (scanText(text).length === 0) failures.push(`missed: ${label}`);
  }
  for (const [label, text] of SAMPLES.negative) {
    const hits = scanText(text);
    if (hits.length > 0) failures.push(`false positive on ${label}: ${hits[0].rule}`);
  }

  const paths = [
    ['x-firebase-adminsdk-a1b2c.json', true],
    ['config/serviceAccount.json', true],
    ['apps/web/.env.local', true],
    ['apps/web/.env.example', false],
    ['apps/web/src/services/account.json', false],
  ];
  for (const [path, shouldFlag] of paths) {
    if (scanPath(path).length > 0 !== shouldFlag) {
      failures.push(`path rule wrong for ${path} (expected ${shouldFlag ? 'flag' : 'pass'})`);
    }
  }

  const total = SAMPLES.positive.length + SAMPLES.negative.length + paths.length;

  if (failures.length > 0) {
    console.error(`scan-secrets self-test: ${failures.length}/${total} FAILED`);
    for (const f of failures) console.error(`  ✖ ${f}`);
    return 1;
  }
  console.log(`scan-secrets self-test: ${total} cases passed`);
  return 0;
}

process.exit(process.argv.includes('--self-test') ? selfTest() : run());
