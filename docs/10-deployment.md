# 10 — Deployment & CI/CD

GitHub account: **[@allcottcourt1808](https://github.com/allcottcourt1808)**
Target repo: `https://github.com/allcottcourt1808/splitsutra`

---

## Repository setup

- **Private** repo initially; flip to public once secrets hygiene is verified.
- Default branch `main`, protected:
  - Require a PR before merging
  - Require the `ci` status check to pass
  - No force-push to `main`
- Branch naming: `feat/`, `fix/`, `chore/` + short slug.
- Conventional Commits, so a changelog can be generated later for free.

`.gitignore` must cover: `node_modules/`, `dist/`, `.env*` (except `.env.example`),
`.emulator-data/`, `*-firebase-adminsdk-*.json`, `.firebase/`, `coverage/`,
`playwright-report/`.

> The service-account JSON pattern matters. Committing a Firebase Admin key to a public
> repo hands over full database access — it bypasses Security Rules entirely. Run
> `gitleaks` as a pre-commit hook (NFR-7).

---

## Hosting choice

**Firebase Hosting.** Same CLI, same project, global CDN, free tier is generous, and SPA
rewrites plus preview channels come built in. Vercel/Netlify would work but add a second
dashboard and a second deploy pipeline for no benefit here.

- `dev` → `splitsutra-dev.web.app`
- `prod` → `splitsutra-prod.web.app`, plus a custom domain later if wanted.

### Preview channels

```bash
firebase hosting:channel:deploy pr-42 --project dev --expires 7d
```

Every PR gets a live URL. This is the single highest-value CI feature for a UI project —
review the actual screen, not the diff.

---

## CI pipeline (GitHub Actions)

`.github/workflows/ci.yml` — runs on every push and PR.

```yaml
name: ci
on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - uses: actions/setup-java@v4 # REQUIRED for the Firestore emulator
        with: { distribution: temurin, java-version: 21 }

      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm depcruise # NFR-10: core stays platform-agnostic
      - run: pnpm test:unit # domain + property tests
      - run: pnpm test:rules # emulator-backed security rules
      - run: pnpm test:integration # emulator-backed functions
      - run: pnpm build
      - run: pnpm test:e2e # Playwright against emulators
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report/ }
```

Order matters: cheap checks first so a type error fails in 40 seconds rather than after a
six-minute E2E run.

### Deploy workflow

`.github/workflows/deploy.yml`:

- Push to `main` → deploy rules, indexes, functions, hosting to **dev**.
- Git tag `v*` → deploy to **prod**, gated on a GitHub Environment with required reviewers.

Auth via **Workload Identity Federation** (`google-github-actions/auth`) rather than a
long-lived service-account JSON in secrets. If that's too much setup initially, use
`FIREBASE_SERVICE_ACCOUNT` as a repo secret and plan to migrate — but never commit it.

### Deploy order (important)

```
1. firestore:indexes    ← indexes build asynchronously; start them first
2. firestore:rules
3. functions
4. hosting
```

Deploying hosting first means live users hit code whose rules and indexes don't exist yet:
permission-denied and failed-precondition errors in production.

---

## Release process

1. Merge to `main` → auto-deploys to dev.
2. Smoke-test dev on a real phone (the manual checklist in [09-testing.md](09-testing.md)).
3. Tag `vX.Y.Z` → approve the prod environment → deploys.
4. Watch Cloud Logging error rate for 15 minutes.

**Rollback:** `firebase hosting:rollback` restores the previous release instantly.
Functions have no one-command rollback — redeploy the previous tag. Firestore rules have
no rollback at all, so **rules changes deserve extra scrutiny in review**; a bad rules
deploy can lock every user out of their data.

---

## Schema migrations

Firestore is schemaless, which does **not** mean migration-free — it means nothing warns
you when documents disagree. Once prod holds real data, every model change needs a plan.

### The rule: expand → migrate → contract, never a breaking rename

```
1. EXPAND    Add the new field. Code writes BOTH old and new. Deploy.
2. BACKFILL  Script rewrites existing docs to populate the new field.
3. SWITCH    Code reads the new field, still writes both. Deploy.
4. CONTRACT  Stop writing the old field. Deploy. Optionally drop it later.
```

Four deploys, and at no point is a running client broken. A rename done in one step breaks
every session that hasn't reloaded — and in a PWA, sessions can be days old.

### Rules

- 🔴 **New fields are always nullable** with a sensible default. The multi-currency design
  in [03-data-model.md](03-data-model.md) is written this way deliberately.
- 🔴 **Zod schemas are the contract.** Parsing on read means a doc that predates a change
  fails loudly at the boundary rather than producing `undefined` deep in the UI.
- 🔴 **Never migrate money fields in place.** Write the new value alongside, verify the
  zero-sum invariant holds across every group, then cut over.
- 🟡 Backfills run as a **one-off script against the Admin SDK**, batched at 400 writes,
  idempotent, and resumable — not as a Cloud Function that can time out mid-collection.
- 🟡 **Rehearse every migration on `dev` with production-shaped data** before prod.
- 🟢 A `schemaVersion` field on documents is worth adding if changes get frequent.

## Backup & restore

The realistic disaster is not "Google lost my data" — it's **a bad Function or migration
corrupting balances across every group.**

- 🔴 **Before any prod migration or rules change: take an export.**
  ```bash
  gcloud firestore export gs://splitsutra-prod-backups/$(date +%F)
  ```
- 🟡 Schedule a **weekly export** to a Cloud Storage bucket with a lifecycle rule deleting
  objects after 30 days. Storage for a dataset this size is pennies.
- 🟡 ⚠️ **Test a restore once.** An untested backup is a hope, not a backup. Restore a prod
  export into `dev` and confirm the app runs against it.
- 🟡 `auditBalances` is the early-warning system — a log-based alert on drift tells you
  within 24 hours, while the backup window is still open.
- 🟢 Point-in-Time Recovery is available on Firestore and gives a 7-day rewind window. It
  carries a cost; worth enabling only once there's real user data.

## Seeding non-local environments

The `firebase/seed.ts` script from Phase 02 targets the emulator. It should also run
against **`dev`**, so deployed testing has realistic data:

```bash
pnpm seed --project dev
```

- 🔴 ⚠️ **Guard it so it can never point at prod.** Refuse to run if the project ID ends
  in `-prod`. This costs one line and prevents an unrecoverable mistake.
- 🟡 Seed users should use clearly fake emails (`@example.com`) so they're never confused
  for real accounts.

## Cost control on Blaze (do this on day one)

Blaze has no hard spending cap. Layered defences:

1. **Budget alert** in Google Cloud Billing at a low threshold ($5/mo), emailed. See [18-cost-control.md](18-cost-control.md) for the hard kill switch — alerts notify, they do not stop spending.
2. **`maxInstances`** on every Function (start at 10). Without it, a trigger loop can
   scale to thousands of instances.
3. **App Check enforcement** (Phase 10) — stops your public config being scripted against.
4. **Firestore usage alerts** on reads/writes.
5. Watch the balance-recompute read amplification specifically — it is the one operation
   whose cost scales with group size ([06-cloud-functions.md](06-cloud-functions.md)).

Realistic expectation: a personal-scale app with a few dozen users sits inside the free
tier and bills ~$0/month. The risk is not organic usage, it is a bug or an abuser.

---

## Monitoring

- **Cloud Logging** structured logs from every Function.
- **Log-based alert** on `auditBalances` reporting drift — this is the canary for silent
  money bugs.
- **Firebase Crashlytics** deferred to the mobile app; for web, add Sentry in Phase 09 if
  it proves needed.
- **Performance Monitoring** — optional; Lighthouse CI already covers the budget.

---

## PWA (Phase 09)

Installable web app, which also serves as a stopgap "mobile app" before Phase 12:

- Web app manifest: name, icons (192/512), `display: standalone`, theme colour.
- Service worker via `vite-plugin-pwa` for the app shell.
- **Do not cache Firestore data in the service worker** — Firestore's own persistence layer
  already does this correctly, and two caching layers will disagree.
- iOS: add `apple-touch-icon` and splash screens; "Add to Home Screen" gives a genuinely
  app-like result for a product shaped like this one.
