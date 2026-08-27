# Phase 11 — CI/CD, Deployment & Launch

**Est. 1 day.** Depends on 10.
Reference: [../docs/10-deployment.md](../docs/10-deployment.md)
Repo: [github.com/allcottcourt1808/splitsutra](https://github.com/allcottcourt1808)

---

## 1. CI pipeline

- [ ] 🔴 `.github/workflows/ci.yml` runs on every push and PR
- [ ] 🔴 `actions/setup-java` included — **the rules tests need it**
- [ ] 🔴 Ordered cheap-to-expensive: typecheck → lint → depcruise → unit → rules →
      integration → build → e2e. A type error should fail in 40s, not after a 6-minute E2E run.
- [ ] 🔴 CI green on `main`
- [ ] 🟢 CI has been **advisory** since Phase 01 (Stage 1). Enforcement flips on in **§5a**
      below, immediately before the launch tag — not here.
- [ ] 🟡 Playwright report uploaded as an artifact on failure
- [ ] 🟡 Lighthouse CI with the NFR-1/NFR-2 budgets
- [ ] 🟡 pnpm store cached

## 2. Deploy pipeline with enforced gates 🔴

Full design: [../docs/20-test-automation-pipeline.md](../docs/20-test-automation-pipeline.md)

- [ ] 🔴 ⚠️ **One workflow, jobs chained with `needs:`** — not two workflows both triggered
      by push. Separate workflows race; `needs:` makes ordering a guarantee.
- [ ] 🔴 **Gate 1** — `deploy-dev` has `needs: verify`. A red emulator suite must make a
      deploy impossible, not merely inadvisable.
- [ ] 🔴 **Gate 2** — `smoke-dev` has `needs: deploy-dev`, running the smoke suite against
      **the real `splitsutra-dev`**
- [ ] 🔴 **Gate 3** — `smoke-dev` sets a `dev-smoke` commit status; the prod workflow's
      `guard` job **refuses to deploy** a tag whose commit lacks it
- [ ] 🔴 **Gate 4** — `environment: production` with **you** as required reviewer, _on top of_
      Gate 3. ✅ GitHub Environments **do** permit self-approving your own deployment —
      unlike PR review, which does not. This is your production sign-off.
- [ ] 🔴 ⚠️ **Deploy order: indexes → rules → functions → hosting.** Hosting first means
      live users hit code whose rules and indexes don't exist yet.
- [ ] 🔴 `rollback` job with `if: failure()` after `smoke-prod` → `hosting:rollback` +
      auto-file an issue
- [ ] 🟡 Auth via Workload Identity Federation, not a long-lived service-account JSON.
      If using a secret initially, plan the migration — and **never commit it**.
- [ ] 🟡 Preview channel per PR (`hosting:channel:deploy pr-N`)
- [ ] 🔴 **Verify the gates actually block.** Push a deliberately failing test, confirm the
      deploy job does not run. Tag an unverified commit, confirm `guard` rejects it.
      **An untested gate is not a gate.**

## 2a. Smoke suite 🔴

- [ ] 🔴 `e2e/smoke/` with a `smoke` Playwright project, `baseURL` from `SMOKE_BASE_URL`
- [ ] 🔴 ⚠️ **Fail immediately if `SMOKE_BASE_URL` is unset.** A localhost default turns a
      production gate into a no-op that always passes.
- [ ] 🔴 **S1** — app loads, `/login` renders, **zero console errors**, no failed requests
- [ ] 🔴 **S2** — sign in with the canary account → lands on `/groups`
- [ ] 🔴 **S3** — create `[smoke-${GITHUB_RUN_ID}]` group → add equal-split expense →
      **assert the balance is exactly right** → delete.
      _This is the one that matters — it exercises rules, indexes, the Function trigger,
      the transactional recompute, and realtime push on real infrastructure._
- [ ] 🔴 **S4** — deep-link to `/groups/:id` in a fresh context (catches a missing SPA rewrite)
- [ ] 🔴 Canary accounts per environment; credentials in GitHub Secrets. **Never a real user.**
- [ ] 🔴 Namespace all test data `[smoke-${RUN_ID}]`; clean up in `afterAll`; treat cleanup
      failure as test failure
- [ ] 🟡 **Weekly reaper Function** deleting orphaned `[smoke-*]` groups older than 24h —
      a crashed run leaks data and `afterAll` will not always execute
- [ ] 🟡 Prod smoke: S1/S2/S4 plus **one** canary-scoped write, deleted immediately
- [ ] 🟡 `retries: 2` on smoke only; upload the Playwright trace on failure
- [ ] 🔴 Keep it to **four checks, under two minutes**. A smoke suite that grows into a
      second E2E suite gets disabled the first time it's slow.

## 2b. Blaze upgrade & cost guardrails 🔴 _The first money you spend_

Everything so far has cost $0. This is the moment billing gets linked. Full reasoning and
the modelled cost ladder: [../docs/18-cost-control.md](../docs/18-cost-control.md).

- [ ] 🔴 Upgrade **both** projects to Blaze
- [ ] 🔴 **Budget alerts at $1, $5, $10**, each emailed
- [ ] 🔴 ⚠️ **Build the hard kill switch.** Budget alerts _notify_; they do not stop
      spending. Wire: Cloud Billing budget → Pub/Sub → Function that detaches the billing
      account at **$5**. This is the only true hard stop Google provides.
- [ ] 🔴 **Test the kill switch once**, deliberately, with a $0.01 threshold. An untested
      kill switch is not a kill switch.
- [ ] 🔴 **`maxInstances` on every Function** (start at 10) — bounds a runaway trigger loop
- [ ] 🔴 Audit every Function that writes back to its own trigger path for a **diff guard**
      — an unguarded `onUserProfileWritten` loops forever and bills for it
- [ ] 🔴 **SMS region policy: US only**; phone auth quota capped at 50/day
- [ ] 🔴 **App Check enforced** on Firestore, Functions, and Auth
- [ ] 🟡 **Artifact Registry cleanup policy** — delete function images older than 30 days.
      Gen 2 deploys accumulate container images against a 0.5 GB free tier; this is the
      source of the classic mystery $0.10 charge.
- [ ] 🟡 Firestore usage alerts on reads and writes
- [ ] 🟡 Confirm Firestore is `us-central1` single-region, not `nam5`

## 2c. Backup, restore & migration readiness 🔴 _Before the first real user_

Reference: [../docs/10-deployment.md](../docs/10-deployment.md).

- [ ] 🔴 Create the backup bucket `gs://splitsutra-prod-backups` with a 30-day lifecycle rule
- [ ] 🔴 Run one manual export and confirm it lands
- [ ] 🔴 ⚠️ **Test a restore.** Restore a prod export into `dev` and confirm the app runs
      against it. An untested backup is a hope, not a backup.
- [ ] 🟡 Schedule a weekly export
- [ ] 🟡 Write the migration runbook into the repo (expand → backfill → switch → contract)
- [ ] 🔴 ⚠️ **Guard the seed script against prod** — refuse to run if the project ID ends
      in `-prod`. One line; prevents an unrecoverable mistake.
- [ ] 🟡 `pnpm seed --project dev` works, so deployed testing has realistic data
- [ ] 🟢 Consider Point-in-Time Recovery once there's real user data

## 3. Production readiness

- [ ] 🔴 Rules and indexes deployed to prod **before** hosting
- [ ] 🔴 All three auth providers enabled and tested on the prod project
- [ ] 🔴 Authorized domains include the prod hosting domain
- [ ] 🔴 App Check enforced on prod
- [ ] 🔴 Budget alerts active on prod
- [ ] 🔴 `maxInstances` on all prod functions
- [ ] 🟡 Custom domain + SSL (optional)
- [ ] 🟡 `auditBalances` scheduled in prod

## 4. Manual pre-launch checklist

Automation can't catch these. Reference: [../docs/09-testing.md](../docs/09-testing.md).

- [ ] 🔴 **Real SMS OTP on a real phone** — the emulator's test numbers never exercise this path
- [ ] 🔴 Google sign-in on a real device
- [ ] 🔴 Account linking: email first, then Google, same address → one account
- [ ] 🔴 **Two devices side by side**: add an expense on A, appears on B within 5s
- [ ] 🔴 Full loop on a real phone: sign up → group → invite → expense → settle
- [ ] 🟡 iOS Safari: safe areas, viewport, no rubber-band jank
- [ ] 🟡 Android Chrome: back button through modals
- [ ] 🟡 Airplane mode: reads from cache, writes queue and flush on reconnect
- [ ] 🟡 Deep link `/invite/:token` while logged out, then after signing in
- [ ] 🟡 Large group (10+ members) split-sheet usability
- [ ] 🟡 PWA install on both platforms

## 5. Monitoring

- [ ] 🟡 Cloud Logging structured logs confirmed flowing
- [ ] 🟡 **Log-based alert on `auditBalances` drift** — the canary for silent money bugs
- [ ] 🟡 Error-rate alert on Functions
- [ ] 🟢 Sentry for the web client, if the log noise justifies it
- [ ] 🟢 Uptime check on the hosting URL

## 5a. Flip enforcement on 🔴 _Stage 1 → Stage 2 — do this immediately before the launch tag_

CI has been advisory since Phase 01. **This is where it starts blocking.** Full settings
and gotchas: [../docs/20-test-automation-pipeline.md](../docs/20-test-automation-pipeline.md) §5a

- [ ] 🔴 ⚠️ **Precondition: `main` green for the last 10 consecutive commits.**
      If it isn't, the suite needs fixing _before_ launch — don't flip on top of a red
      baseline and don't skip the check.
- [ ] 🔴 Enable branch protection on `main`:
  - [ ] 🔴 Require a pull request before merging
  - [ ] 🔴 ⚠️ **Required approvals: 0 — NOT 1.** GitHub forbids approving your own PR;
        setting 1 locks you out of your own repo with no way to merge.
        _(Production sign-off lives at Gate 4 via GitHub Environments, where self-approval
        **is** permitted.)_
  - [ ] 🔴 **Require status checks**, with **`verify`** ticked **by name** —
        ⚠️ the job existing in CI is not enough; it must be selected in settings
  - [ ] 🔴 Require branches up to date before merging
  - [ ] 🔴 Enable **"Do not allow bypassing"** — a rule you can click past isn't enforcement
  - [ ] 🔴 Block force pushes and deletions; require conversation resolution
- [ ] 🔴 ⚠️ **Prove it blocks:** open a PR with a deliberately failing test, confirm the
      Merge button is disabled, then close it. **An unverified rule is not a rule.**
- [ ] 🔴 Confirm the state:
      `gh api repos/allcottcourt1808/splitsutra/branches/main/protection --jq '.required_status_checks.contexts'`
      → must return `["verify"]`
- [ ] 🟡 Record the flip in [../docs/19-qa-log.md](../docs/19-qa-log.md) with the date
- [ ] 🟡 Note for later: **renaming the `verify` job silently breaks this** — GitHub waits
      forever for a check that never arrives and PRs hang as "Expected". Update branch
      protection in the same PR as any rename.

## 6. Launch

- [ ] 🟡 Tag `v1.0.0` and deploy to prod
- [ ] 🟡 Watch the error rate for 15 minutes
- [ ] 🟡 Invite 2–3 real users and split something real
- [ ] 🟡 **Verify balances against a hand calculation** on a real group — the ultimate test
- [ ] 🟢 Repo README with screenshots
- [ ] 🟢 Flip the repo public once secrets hygiene is verified

## 7. Rollback readiness

- [ ] 🔴 Know the commands **before** you need them:
      `firebase hosting:rollback` is instant; Functions require redeploying the previous
      tag; **Firestore rules have no rollback at all.**
- [ ] 🔴 Consequence: rules changes deserve extra scrutiny in review — a bad rules deploy
      locks every user out of their own data
- [ ] 🟡 Emulator export retained as a data snapshot before the first prod deploy

---

## Exit criteria

- [ ] CI green; every PR gets a preview URL
- [ ] **Branch protection flipped to enforced** (§5a) and proven to block a red PR
- [ ] **All four pipeline gates proven to block** — a failing test stops the deploy; an unverified tag is rejected by `guard`
- [ ] Smoke suite passes against deployed `splitsutra-dev` in under 2 minutes
- [ ] Prod smoke failure demonstrated to trigger auto-rollback
- [ ] Prod deployed in the correct order and reachable
- [ ] Full manual checklist passed on real devices
- [ ] Real users have successfully split a real expense
- [ ] Monitoring and alerts confirmed firing
- [ ] **v1 is done.**
