# Phase 02 — Firebase Projects & Emulators

**Est. 0.5 day.** Depends on Phase 00. Can run in parallel with Phase 01.
Reference: [../docs/08-firebase-setup.md](../docs/08-firebase-setup.md)

---

## 1. Create projects

- [ ] 🔴 Create `splitsutra-dev` in the Firebase console (Q3). ⚠️ Firebase project IDs are **globally unique** — if taken, try `splitsutra-app-dev`
- [ ] 🔴 Create `splitsutra-prod` (matching suffix)
- [ ] 🔴 Register a **Web app** in each; copy the config into `.env.local` / `.env.example`
- [ ] 🔴 `firebase use --add` for both, aliased `dev` and `prod`

## 2. Firestore

- [ ] 🔴 Create the database in **Native mode**, in **both** projects
- [ ] 🔴 ⚠️ Region: **`us-central1`** (Q4). **This is permanent.** Single-region, not `nam5` multi-region — cheaper, lower write latency, colocated with Functions.
- [ ] 🔴 Start in **locked mode** — rules come from the repo, never the console
- [ ] 🟡 Confirm both projects use the same region so latency behaves consistently

## 3. Authentication

- [ ] 🔴 Enable **Email/Password**
- [ ] 🔴 Enable **Phone**
- [ ] 🔴 Enable **Google** (set public name + support email)
- [ ] 🔴 Authorized domains: add `localhost` and both `*.web.app` domains
      — Google sign-in fails opaquely without this
- [ ] 🟡 Enable **email enumeration protection** (Auth → Settings)
- [ ] 🔴 ⚠️ **SMS region policy: deny all, allow `US` only.** Authentication → Settings.
      SMS toll fraud is the largest realistic cost risk on this project — attackers drive
      phone-auth flows to premium-rate international numbers and take a cut. Restricting
      destinations removes nearly the whole attack surface.
      See [../docs/18-cost-control.md](../docs/18-cost-control.md) §5.
- [ ] 🔴 **Phone auth quota limit: 50 SMS/day** to start
- [ ] 🟡 **Add phone test numbers in the dev project** (e.g. `+1 5555555555` → `123456`).
      Use these for **all** development; real SMS costs money and is only needed for final
      device testing in Phase 11.
- [ ] 🟢 Customise the verification and password-reset email templates

## 4. Billing — ⚠️ deliberately NOT yet 🔴

> **Leave both projects on the free Spark plan.** Everything through Phase 10 runs on the
> local emulator suite and touches no cloud resource. Linking billing now creates exposure
> for zero benefit. The Blaze upgrade happens in
> [phase-11-deploy.md](phase-11-deploy.md), together with a hard kill switch.
>
> ADR-04's _choice_ of Blaze is unchanged — Spark has no Cloud Functions, which would break
> server-authoritative balances. Only the timing moved (revision R3).

- [x] ✅ **Do nothing here.** Both projects stay on Spark.
- [ ] 🔴 Read [../docs/18-cost-control.md](../docs/18-cost-control.md) so the Phase 11
      guardrails aren't a surprise
- [ ] 🟢 Note for later: budget alerts at $1/$5/$10, kill switch at $5, `maxInstances` on
      every Function, SMS region allowlist

## 5. Local repo config

- [ ] 🔴 `firebase/firebase.json` with emulator ports (auth 9099, firestore 8080,
      functions 5001, hosting 5000, UI 4000) and the SPA rewrite `** → /index.html`
- [ ] 🔴 `firebase/.firebaserc` with both aliases
- [ ] 🔴 `firebase/firestore.rules` — start with **deny-all**, then build up in later phases
- [ ] 🔴 `firebase/firestore.indexes.json` — empty array for now; indexes added in
      Phases 05–08 as queries appear
- [ ] 🟡 `firebase/functions/` scaffolded as `@splitsutra/functions` (Node 24, TS, Gen 2),
      with `@splitsutra/core` as a workspace dependency

## 6. Emulators

- [ ] 🔴 `firebase emulators:start` runs clean (all four emulators up, UI on :4000)
- [ ] 🔴 Web app connects to the emulators when `VITE_USE_EMULATORS=true`
- [ ] 🔴 Confirm data persists across restarts:
  ```bash
  firebase emulators:start --import=./.emulator-data --export-on-exit
  ```
- [ ] 🟡 `pnpm emulators` script wrapping the above
- [ ] 🟡 Add `.emulator-data/` to `.gitignore`

## 7. Seed script 🟡 _30 minutes now, saved hundreds of times later_

- [ ] 🟡 `firebase/seed.ts` creating:
  - 3 test users (with known credentials for E2E)
  - 2 groups — one multi-member trip, one implicit 1:1 friend group
  - ~10 expenses spanning **all four** split methods, including awkward
    remainder cases ($100 / 3, 33.33% thrice)
  - 1 settlement
- [ ] 🟡 `pnpm seed` runs it against the emulator
- [ ] 🟢 A `pnpm reset` that wipes and reseeds

---

## Exit criteria

- [ ] Both Firebase projects exist, **on the free Spark plan** — no billing linked, $0 spent
- [ ] Firestore created in **`us-central1`** in both
- [ ] SMS region policy set to US-only; phone quota capped
- [ ] All three sign-in providers enabled; test phone numbers configured in dev
- [ ] `firebase emulators:start` runs clean and the web app talks to it
- [ ] Deny-all rules deploy successfully to dev
- [ ] `pnpm seed` populates the emulator with usable data
