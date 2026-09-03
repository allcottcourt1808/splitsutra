# Phase 02 — Firebase Projects & Emulators

**Est. 0.5 day.** Depends on Phase 00. Can run in parallel with Phase 01.
Reference: [../docs/08-firebase-setup.md](../docs/08-firebase-setup.md)

---

## 1. Create projects

- [x] 🔴 Create `splitsutra-dev` in the Firebase console (Q3). ⚠️ Firebase project IDs are **globally unique** — if taken, try `splitsutra-app-dev` — created as **`splitsutra-dev-eac96`**; a failed CLI run had already consumed the bare name
- [x] 🔴 Create `splitsutra-prod` (matching suffix) — clean `-prod` suffix, which keeps guard.ts rule 1 (no-override) in force
- [ ] 🔴 Register a **Web app** in each; copy the config into `.env.local` / `.env.example` — **dev done** (`1:724928905429:web:e175f01035116cd8fc225c`), config in `.env.local`; **prod not registered** — not needed until Phase 11
- [x] 🔴 `firebase use --add` for both, aliased `dev` and `prod` — written directly into `.firebaserc`

## 2. Firestore

- [x] 🔴 Create the database in **Native mode**, in **both** projects — Standard edition, verified via `firestore:databases:get`
- [x] 🔴 ⚠️ Region: **`us-central1`** (Q4). **This is permanent.** Single-region, not `nam5` multi-region — cheaper, lower write latency, colocated with Functions.
- [x] 🔴 Start in **locked mode** — rules come from the repo, never the console — both created with default closed rules; repo rules not yet deployed
- [x] 🟡 Confirm both projects use the same region so latency behaves consistently

## 3. Authentication

- [ ] 🔴 Enable **Email/Password**
- [ ] 🔴 Enable **Phone**
- [ ] 🔴 Enable **Google** (set public name + support email)
- [ ] 🔴 Authorized domains: add `localhost` and both `*.web.app` domains
      — Google sign-in fails opaquely without this
- [ ] 🟡 Enable **email enumeration protection** (Auth → Settings)
- [x] 🔴 ⚠️ **SMS region policy: allow-list.** Authentication → Settings.
      SMS toll fraud is the largest realistic cost risk on this project — attackers drive
      phone-auth flows to premium-rate international numbers and take a cut. Restricting
      destinations removes nearly the whole attack surface.
      See [../docs/18-cost-control.md](../docs/18-cost-control.md) §5.
      **Done on `splitsutra-prod` 2026-09-02: Allow `US` + `IN`.** This item used to say
      "US only"; India is where the app is actually used (`auditBalances` runs on
      `Asia/Kolkata`), so US-only would have blocked its real users. Recorded rather than
      quietly satisfied — a checklist that says one thing while the project does another is
      how this file got reconciled once already.
      🔴 **Allow-list, never deny-list.** A deny-list permits every region nobody thought to
      name, which is exactly where premium-rate ranges live. An allow-list fails closed.
      **Set on `splitsutra-dev-eac96` too, 2026-09-02** — same allow-list, and it matters
      there for the same reason: dev is Blaze, has phone auth on, and now has a public URL
      of its own (<https://splitsutra-dev-eac96.web.app>). A non-production project is not
      a non-billable one.
      ⚠️ **Reported by the owner, not verified from here.** The public Identity Toolkit
      endpoint returns only `projectId` and `authorizedDomains`; reading `smsRegionConfig`
      needs an admin token. Anyone auditing this should re-read it in the console rather
      than trusting this tick.
- [ ] 🔴 **Phone auth quota limit: 50 SMS/day** to start
      ✅ **Partial mitigation now in place on BOTH projects, 2026-09-02:** enabling reCAPTCHA
      for the Phone provider (AUDIT) also turned on `useSmsTollFraudProtection`, which scores
      every request and refuses to send above a 0.5 risk threshold. That is a real defence
      against pumping and it is not the same as a ceiling — a run of legitimate-looking requests
      is still uncapped. Both are wanted.
      🔴 **Not in the Firebase console.** Authentication → Settings has no SMS-volume field —
      its "Sign-up quota" is new _account creations per hour_, a different control that caps
      no SMS at all. The daily cap is a GCP quota: Google Cloud → IAM & Admin → Quotas,
      service **Identity Toolkit API**. Mistaking the two leaves SMS spend uncapped while
      looking done.
- [ ] 🔴 **Add phone test numbers in the dev project** (e.g. `+1 650-555-3434` → `654321`).
      🔴 **Upgraded from 🟡: this is now the ONLY way to exercise phone auth locally.**
      `localhost` cannot do phone auth at all — Firebase documents it, it is not a
      misconfiguration to fix: "localhost is not allowed as a hosted domain for the purposes of
      phone auth". Real-SMS testing has to happen on a hosted domain
      (<https://splitsutra-dev-eac96.web.app> works). Fictional numbers also skip SMS cost,
      quota and throttling, and `appVerificationDisabledForTesting` makes them automatable.
      Use these for **all** development; real SMS costs money and is only needed for final
      device testing in Phase 11.
- [ ] 🔴 **Enable Apple** — the code is shipped and tested, and the button is **hidden** behind
      `APPLE_ENABLED` in `apps/web/src/auth/FirebaseUIMount.tsx`. Flip that to `true` and deploy
      once the console work below is done; it is one line and one deploy.
      It was briefly live on prod (2026-09-03) and pulled straight back: without configuration
      it ends in `auth/operation-not-allowed`, and as the third button on the sign-in screen it
      is the first thing a new tester taps. Honest error, useless to somebody who was invited to
      try the app.
      🔴 **Costs money and cannot be worked around: Sign In with Apple can only be configured
      by a member of the [Apple Developer Program](https://developer.apple.com/programs/)**
      ($99/year). Nothing in Firebase substitutes for it.
      On <https://developer.apple.com/account/resources>, per project: 1. Configure Sign In with Apple for the web and register the Return URL
      `https://splitsutra-prod.firebaseapp.com/__/auth/handler` — and the dev one,
      `https://splitsutra-dev-eac96.firebaseapp.com/__/auth/handler`. Note the **Services
      ID**.
      ⚠️ `firebaseapp.com`, **not** `web.app`. Hosting serves the app from `splitsutra.web.app`
      but `authDomain` in the Firebase config is the `firebaseapp.com` subdomain, and that is
      the origin Apple redirects back to. Registering the wrong one fails at the last step of
      a flow that looked like it was working. 2. Create a **Sign In with Apple private key**; note the key and the **Key ID**. 3. Only if Firebase Auth ever sends email: configure the private email relay service for
      `noreply@<project>.firebaseapp.com`. Not needed today — email/password is off.
      Then Firebase console → Authentication → Sign-in method → Apple, with the Services ID,
      Team ID, Key ID and private key.
      ⚠️ **Apple gives a display name on the FIRST sign-in only, and never a photo URL.** A
      user who hides their email arrives as `<token>@privaterelay.appleid.com`, whose local
      part is an opaque identifier — `deriveDisplayName` deliberately refuses to seed it as a
      name and falls through to "New user" (`packages/core/src/repositories/userRepo.ts`).
      🟢 Not needed for the web app: Apple's account-deletion requirement (App Store guideline
      5.1.1(v), and `revokeAccessToken`) applies to App Store submissions. It becomes real when
      the React Native app ships, and `deleteAccount` is where it will have to go.
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

- [x] 🔴 `firebase/firebase.json` with emulator ports (auth 9099, firestore 8080,
      functions 5001, hosting 5000, UI 4000) and the SPA rewrite `** → /index.html`
- [x] 🔴 `firebase/.firebaserc` with both aliases
- [x] 🔴 `firebase/firestore.rules` — start with **deny-all**, then build up in later phases
- [x] 🔴 `firebase/firestore.indexes.json` — empty array for now; indexes added in
      Phases 05–08 as queries appear
- [x] 🟡 `firebase/functions/` scaffolded as `@splitsutra/functions` (Node 24, TS, Gen 2),
      with `@splitsutra/core` as a workspace dependency

## 6. Emulators

- [ ] 🔴 `firebase emulators:start` runs clean (all four emulators up, UI on :4000)
- [ ] 🔴 Web app connects to the emulators when `VITE_USE_EMULATORS=true`
- [ ] 🔴 Confirm data persists across restarts:
  ```bash
  firebase emulators:start --import=./.emulator-data --export-on-exit
  ```
- [x] 🟡 `pnpm emulators` script wrapping the above
- [x] 🟡 Add `.emulator-data/` to `.gitignore`

## 7. Seed script 🟡 _30 minutes now, saved hundreds of times later_

- [x] 🟡 `firebase/seed.ts` creating — more than asked for, because the awkward cases are
      the ones worth having:
  - **5** test users (shared password, printed by the run; emulator-only, and the writer
    refuses to create them at all against a real project)
  - **5** groups — a home group, two trips (one in JPY, one in EUR), and two implicit 1:1
    friend groups, one of them deliberately empty
  - **10** expenses spanning **all four** split methods, including the remainder cases
  - **2** settlements
- [x] 🟡 `pnpm seed` runs it against the emulator:
      `firebase emulators:exec --only firestore,auth --project demo-splitsutra "pnpm seed"`
      → 76 documents across 10 collections, every group zero-sum.
- [ ] 🟢 A `pnpm reset` that wipes and reseeds

> 🔴 **`--only firestore,auth`. Never with `functions`.** The seed writes its own derived
> state — member balances (folded with the same `computeBalances` the Function calls, so a
> later recompute converges on these numbers rather than correcting them), the activity
> feed, comment counters, the `usernames` index. With the triggers running as well they
> append a _second_ copy of the feed under CloudEvent-derived `evt_*` ids the script cannot
> predict, so it cannot overwrite them on a re-run and the whole thing stops being
> idempotent.

> Re-running is safe and was verified: two runs in one emulator session wrote the same 76
> documents and reported `0 created, 5 refreshed` for Auth. Every id is deterministic and
> every write is a `set()` without `merge`, so a field removed from the fixture actually
> disappears instead of lingering.

> 🔴 The guard has now been **run**, not just asserted: `pnpm seed --project prod` resolves
> the `.firebaserc` alias to `splitsutra-prod` and refuses, and `--allow-real-project` does
> not get past it. Bare `pnpm seed` also refuses — the `.firebaserc` default is `splitsutra-dev`,
> which is not `demo-*`.

---

## Exit criteria

- [ ] Both Firebase projects exist, **on the free Spark plan** — no billing linked, $0 spent
- [ ] Firestore created in **`us-central1`** in both
- [x] SMS region policy set (prod: allow US + IN). 🔴 Phone SMS/day quota still uncapped —
      it is a GCP quota, not a Firebase setting; see §3.
- [ ] All three sign-in providers enabled; test phone numbers configured in dev
- [ ] `firebase emulators:start` runs clean and the web app talks to it
- [ ] Deny-all rules deploy successfully to dev
- [x] `pnpm seed` populates the emulator with usable data — verified against
      `demo-splitsutra`, twice in one session to prove idempotency
