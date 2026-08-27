# 20 — Test Automation & Pipeline Gates

**Requirement:** the pipeline must run automated tests against the deployed test
environment and **block promotion** unless they pass.

[09-testing.md](09-testing.md) covers what to test. [16-testing-setup.md](16-testing-setup.md)
covers the harness. **This document covers enforcement** — which tests run where, and what
they are allowed to block.

---

## 1. The gap this closes

Everything in CI today runs against the **emulator suite**. That is fast, free, and
correct — and it is structurally incapable of catching the failures that actually take
production down.

Bugs that pass every emulator test and still break the deployed app:

| Failure                                | Why emulators miss it                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| Indexes not deployed                   | The emulator builds indexes implicitly; real Firestore returns `failed-precondition` |
| Authorized domains unset               | Google sign-in fails only on a real origin                                           |
| App Check enforcement misconfigured    | Emulator bypasses App Check entirely                                                 |
| Wrong `VITE_FIREBASE_*` in the build   | Emulator config is injected separately                                               |
| Function region mismatch / CORS        | Emulator serves everything from localhost                                            |
| Cold-start timeout on first invocation | Emulator functions are always warm                                                   |
| Rules deployed but stale vs code       | Emulator loads rules from the working tree                                           |
| SPA rewrite missing                    | Deep links 404 only on real Hosting                                                  |

**Every one of these is a deploy-day outage that CI reports as green.** That is precisely
what the deployed smoke suite exists to catch.

---

## 2. Environments and what runs where

`dev` **is** the test/staging environment. Three deployed tiers is right for a solo
project; a fourth adds ceremony without adding signal.

| Stage                | Runs against             | Suite                                                       | Blocks                     |
| -------------------- | ------------------------ | ----------------------------------------------------------- | -------------------------- |
| **Pre-merge**        | Emulators                | Full: types, lint, depcruise, unit, rules, integration, E2E | **Merge to `main`**        |
| **Post-deploy dev**  | `splitsutra-dev` (real)  | **Smoke** (§4)                                              | **Promotion to prod**      |
| **Post-deploy prod** | `splitsutra-prod` (real) | Smoke, read-mostly                                          | Triggers **auto-rollback** |

---

## 3. Framework: Playwright, no second tool

Playwright is already chosen for E2E and is the right tool for deployed smoke too — same
code, same assertions, different `baseURL`. Adding Cypress or Selenium alongside it would
mean two runners, two reporting formats, and two sets of flake to debug.

One config, two projects:

```ts
// playwright.config.ts
projects: [
  { name: 'e2e-mobile', use: { ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:5173' } },
  { name: 'e2e-desktop', use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5173' } },
  {
    name: 'smoke',
    testDir: './e2e/smoke',
    retries: 2, // real network; transient failure is not a bug
    use: { ...devices['Pixel 7'], baseURL: process.env.SMOKE_BASE_URL },
  },
];
```

```bash
pnpm test:e2e                                     # emulators, full suite
SMOKE_BASE_URL=https://splitsutra-dev.web.app pnpm test:smoke
```

---

## 4. The smoke suite

**Four checks. Under two minutes.** A smoke suite that grows into a second E2E suite gets
disabled the first time it's slow, and then it protects nothing.

| #      | Check                                                                                                      | Catches                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **S1** | App loads; `/login` renders; **zero console errors**; no failed network requests                           | Bad build, wrong env vars, missing assets, CSP breakage                      |
| **S2** | Sign in with the seeded canary account → lands on `/groups`                                                | Auth misconfig, unauthorized domain, App Check over-enforcement              |
| **S3** | Create a `[smoke]` group → add an equal-split expense → **assert the balance is exactly correct** → delete | **The whole stack**: rules, indexes, Function triggers, the balance pipeline |
| **S4** | Deep-link straight to `/groups/:id` on a fresh context                                                     | SPA rewrite missing (deep links 404)                                         |

**S3 is the one that matters.** It exercises Security Rules, composite indexes,
`onExpenseWritten`, the transactional recompute, and the realtime push — end to end, on
real infrastructure. If S3 passes, the system works.

### Data hygiene 🔴

Smoke tests write to a **real database**. Non-negotiable rules:

- **Dedicated canary account per environment** (`canary@splitsutra-test.example`), credentials
  in GitHub Secrets. Never a real user.
- **Namespace everything**: groups named `[smoke-${GITHUB_RUN_ID}]`. Instantly identifiable,
  never collides across concurrent runs.
- **Clean up in `afterAll`**, and treat cleanup failure as a test failure.
- **Scheduled reaper** — a weekly Function deleting `[smoke-*]` groups older than 24h,
  because a crashed run leaks data and `afterAll` will not always execute.
- 🔴 **Refuse to run if `SMOKE_BASE_URL` is unset.** A default that silently points at
  localhost turns a production gate into a no-op that always passes.

### Prod smoke is narrower

S1, S2, S4 plus **one** S3 write confined to the canary account's own group, deleted
immediately. This is synthetic monitoring: writing nothing to prod means never knowing
whether writes work, which defeats the point — but the blast radius stays one account.

---

## 5. Pipeline structure

**One workflow, sequential jobs chained with `needs:`.** Two separate workflows both
triggered by `push` race each other; `needs:` makes ordering a guarantee rather than a
hope.

```yaml
# .github/workflows/pipeline.yml
name: pipeline
on:
  push: { branches: [main] }
  pull_request:

jobs:
  verify: # emulators — the pre-merge gate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - uses: actions/setup-java@v4 # emulators are Java processes
        with: { distribution: temurin, java-version: 21 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm depcruise
      - run: pnpm test:unit --coverage
      - run: pnpm test:rules
      - run: pnpm test:integration
      - run: pnpm build
      - run: pnpm test:e2e

  deploy-dev:
    needs: verify # ← GATE 1: no green CI, no deploy
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      # order matters: indexes and rules before the code that needs them
      - run: firebase deploy --only firestore:indexes --project dev
      - run: firebase deploy --only firestore:rules   --project dev
      - run: firebase deploy --only functions         --project dev
      - run: firebase deploy --only hosting           --project dev

  smoke-dev:
    needs: deploy-dev # ← GATE 2: verify the REAL environment
    runs-on: ubuntu-latest
    env:
      SMOKE_BASE_URL: https://splitsutra-dev.web.app
      SMOKE_EMAIL: ${{ secrets.SMOKE_EMAIL }}
      SMOKE_PASSWORD: ${{ secrets.SMOKE_PASSWORD }}
    steps:
      - run: pnpm test:smoke
      - name: Mark this commit promotable
        if: success()
        run: |
          gh api repos/${{ github.repository }}/statuses/${{ github.sha }} \
            -f state=success -f context=dev-smoke \
            -f description="dev smoke passed"
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: smoke-dev-report, path: playwright-report/ }
```

### Promotion to prod

```yaml
# .github/workflows/deploy-prod.yml
on:
  push: { tags: ['v*'] }

jobs:
  guard: # ← GATE 3: automated, not just a human clicking approve
    runs-on: ubuntu-latest
    steps:
      - name: Require dev-smoke success on this exact commit
        run: |
          state=$(gh api repos/${{ github.repository }}/commits/${{ github.sha }}/status \
                  --jq '.statuses[] | select(.context=="dev-smoke") | .state')
          if [ "$state" != "success" ]; then
            echo "::error::This commit has not passed dev smoke. Refusing to deploy."
            exit 1
          fi

  deploy-prod:
    needs: guard
    environment: production # ← GATE 4: human approval, on top of the automated gate
    steps: # indexes → rules → functions → hosting

  smoke-prod:
    needs: deploy-prod
    env: { SMOKE_BASE_URL: https://splitsutra-prod.web.app }
    steps: [{ run: pnpm test:smoke }]

  rollback:
    needs: smoke-prod
    if: failure() # ← automatic recovery
    steps:
      - run: firebase hosting:rollback --project prod
      - run: gh issue create --title "Prod smoke failed — hosting rolled back" ...
```

### The four gates

| Gate                          | Enforces                                   | Bypassable?                   |
| ----------------------------- | ------------------------------------------ | ----------------------------- |
| 1 · `needs: verify`           | Emulator suite green before any deploy     | No                            |
| 2 · `needs: deploy-dev`       | **Deployed dev verified before promotion** | No                            |
| 3 · `guard` job               | Tagged commit provably passed dev smoke    | No                            |
| 4 · `environment: production` | Human approval                             | By the approver, deliberately |

Gates 1–3 are automated and cannot be clicked past. Gate 4 is intentionally human.

---

## 5a. Branch protection — two stages

The pipeline jobs above only _report_ status. **Branch protection is what makes a red check
actually block a merge.** Enforcement arrives in two stages.

> **Naming:** these docs use **`main`**, GitHub's default since 2020. If your repo uses
> `master`, substitute throughout — the settings are identical.

### Stage 1 — Advisory (now → v1.0)

**CI runs on every push and PR. Nothing blocks.**

| Setting                  | Value                     |
| ------------------------ | ------------------------- |
| CI workflow on push + PR | ✅ **On** — from Phase 01 |
| Branch protection        | ❌ **Off**                |
| Required status checks   | ❌ None                   |
| Approvals                | ❌ None                   |

Rationale: through Phases 01–10 the codebase is churning, tests are being written
alongside the code they cover, and **there is no deployed environment to protect** —
billing isn't even linked until Phase 11. A hard gate here costs momentum and protects
nothing. You still see red checks on every commit; you just aren't blocked by them.

PRs remain available and worth using for anything substantial (you get the diff and a
preview channel), but they aren't required.

> ### ⚠️ The failure mode to actively guard against
>
> **Advisory mode reliably degrades into permanently ignored.** Red CI becomes background
> noise, failures accumulate, and on flip day you inherit forty broken tests at once —
> exactly when you're trying to launch.
>
> Two cheap defences, both worth doing:
>
> - **Add the CI status badge to `README.md`.** Visible red is harder to ignore than a
>   green tick buried in the Actions tab.
> - **Treat a red `main` as a same-day fix.** The enforcement is social during Stage 1;
>   the habit is what makes Stage 2 a formality instead of a cleanup project.
>
> Phase 11 verifies the habit held before flipping: **`main` green for the last 10
> consecutive commits.** If it isn't, that's a signal to fix the suite before launching,
> not to skip the check.

> **One exception worth considering:** secret scanning (`gitleaks`). A committed
> service-account key is **permanently in git history** and gives full database access
> bypassing all Security Rules — irreversible in a way a failing test never is. It's
> already planned as a _pre-commit hook_ (local, Phase 01), so this is covered without a
> CI gate. Mentioning it only because "don't enforce anything yet" and "don't leak a
> credential" are different categories of risk. Your call.

### Stage 2 — Enforced (at v1.0, Phase 11) 🔴

**The moment the first version is published, every PR must be green to merge.**

This flip is a checklist item in [phase-11-deploy.md](../checklists/phase-11-deploy.md),
sequenced immediately before the launch tag. From here, the rest of this section applies.

### ⚠️ The solo-developer trap: you cannot approve your own PR

**GitHub does not permit self-approval on the standard review flow.** If you set
_Require approvals: 1_, you will be unable to merge your own pull requests — the only ways
out are adding a second account or disabling the rule.

So the correct configuration for a one-person repo is:

| Setting                                    | Value        | Why                                                                    |
| ------------------------------------------ | ------------ | ---------------------------------------------------------------------- |
| Require a pull request before merging      | ✅ **On**    | Forces the PR flow, so checks run and you see the diff                 |
| **Require approvals**                      | ❌ **0**     | ⚠️ **Not 1.** You cannot approve your own PR — setting 1 locks you out |
| **Require status checks to pass**          | ✅ **On**    | **This is the real gate**                                              |
| ↳ Required check                           | **`verify`** | Selected by name — see the gotcha below                                |
| Require branches up to date before merging | ✅ On        | Catches semantic conflicts between two individually-green PRs          |
| Require conversation resolution            | ✅ On        | Your own review comments still get addressed                           |
| Block force pushes                         | ✅ On        | History stays auditable                                                |
| Block deletions                            | ✅ On        | —                                                                      |
| Do not allow bypassing                     | ✅ **On**    | See below                                                              |

**Approval still happens — just not on the PR.** Gate 4 (`environment: production`) uses
GitHub **Environments**, where required reviewers **can** approve their own deployment.
That's where you sign off on a production release, and it works fine solo. The distinction
is worth internalising: _PR review_ forbids self-approval; _deployment approval_ allows it.

Net effect: you open a PR, CI runs, and **a red `verify` makes the Merge button
unclickable.** Which is exactly what you asked for.

### Three gotchas that silently disable the gate

1. 🔴 **Required checks are selected by name in settings — having the job in CI is not
   enough.** Until you tick `verify` under "Require status checks", it reports but blocks
   nothing.
2. 🔴 **Renaming the job breaks the rule silently.** GitHub waits for a check named
   `verify` that never arrives, so PRs hang as "Expected — waiting for status" forever.
   **If you rename a job, update branch protection in the same PR.**
3. 🔴 **Never make a required check conditional.** A job skipped by an `if:` reports as
   _pending_, not _success_ — the PR blocks indefinitely. Required checks must always run.

### On "Do not allow bypassing"

Enabling it applies the rules to **you**, as admin. That is the point — an enforcement rule
you can click past isn't enforcement.

The usual objection is being locked out during a GitHub Actions outage. In practice you are
not: unchecking the box is a ten-second settings change you control. **Enable it, and treat
disabling it as an incident worth noting** rather than a routine step.

### Setup — run this at v1.0, not before

```bash
gh api -X PUT repos/allcottcourt1808/splitsutra/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["verify"] },
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "enforce_admins": true,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
```

🔴 **Then verify it actually blocks:** open a PR with a deliberately failing test and
confirm Merge is disabled. An unverified rule is not a rule.

To confirm the state at any time:

```bash
gh api repos/allcottcourt1808/splitsutra/branches/main/protection --jq '.required_status_checks.contexts'
```

Stage 1 returns a 404 (no protection). Stage 2 returns `["verify"]`.

## 6. Rollback reality ⚠️

`smoke-prod` failing triggers `hosting:rollback`, which is instant. But **not everything
rolls back:**

| Component          | Rollback                                 |
| ------------------ | ---------------------------------------- |
| Hosting            | ✅ `firebase hosting:rollback` — instant |
| Functions          | ⚠️ Redeploy the previous tag — minutes   |
| Firestore indexes  | ⚠️ Additive; removing is manual          |
| **Security Rules** | ❌ **No rollback. None.**                |

**A bad rules deploy locks every user out of their own data and cannot be undone by a
button** — only by deploying corrected rules. Consequences:

- 🔴 Rules changes get **explicit reviewer sign-off**, separate from ordinary code review.
- 🔴 The rules test suite is the _only_ protection. Gate 1 running `pnpm test:rules` is
  therefore load-bearing, not a formality.
- 🟡 Keep the previous `firestore.rules` reachable in git history and know the one-command
  redeploy before you need it.

---

## 7. Flakiness policy 🔴

A smoke gate that cries wolf gets disabled, and then it protects nothing.

- **`retries: 2` on smoke only.** Real networks have transient failures; emulator tests do
  not, so `e2e` keeps `retries: 0` locally.
- **A failure surviving retries is a hard stop.** Never re-run to get green — investigate.
- **Never `test.skip` a smoke check.** Four checks means each one is load-bearing; skipping
  one silently removes a gate.
- **Track flake rate.** Above ~5%, fix the test or delete it. An unreliable gate is worse
  than no gate, because it teaches everyone to ignore red.
- Upload the Playwright trace on failure — CI-only failures are otherwise near-impossible
  to diagnose.

---

## 8. What this does _not_ cover

Deliberate limits, so the gate isn't mistaken for more than it is:

- **Not load testing.** No performance regression gate beyond Lighthouse CI.
- **Not a full E2E re-run against dev** — that's the emulator suite's job, and duplicating
  it would make deploys slow and flaky for little added signal.
- **Not cross-browser on deployed envs.** Smoke runs one mobile viewport. Cross-browser
  stays in the emulator E2E suite.
- **Not a substitute for the Phase 11 manual checklist** — real SMS OTP, real Google
  sign-in on a device, and two-device realtime sync still need a human.
