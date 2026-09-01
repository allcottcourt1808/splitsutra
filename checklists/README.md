# Execution Checklists — Master Tracker

Work top to bottom. Each phase has an **exit criteria** section — do not start the next
phase until the current one's exit criteria are met, because later phases assume them.

Mark items with `[x]` as you go. These files are the working state of the project.

---

## Progress

**Reconciled against the codebase on 2026-08-31**, at PR #48. Before that the table said
"Not started" for all fifteen phases while the app had five working tabs and 801 tests, which
made it worse than no table — it was the reason nobody could tell what was actually left.

Status is **what the code does**, not what the boxes say. A ticked box is a claim someone
verified; several phases below are further along than their tick counts, and those counts are
being brought up file by file as each phase is re-read.

| Phase                               | Name                          | Est.     | Status                                                        |
| ----------------------------------- | ----------------------------- | -------- | ------------------------------------------------------------- |
| [00](phase-00-prerequisites.md)     | Prerequisites & tooling       | 1–2 h    | 🟨 Mostly — trademark/domain clearance never run              |
| [01](phase-01-foundation.md)        | Repo, monorepo, core scaffold | 1 day    | ✅ Done                                                       |
| [02](phase-02-firebase-setup.md)    | Firebase projects & emulators | 0.5 day  | 🟨 Mostly — 🔴 **SMS region policy + 50/day cap still unset** |
| [02b](phase-02b-testing-setup.md)   | **Testing framework setup**   | 1 day    | 🟨 Partial — unit + rules real; **e2e and integration empty** |
| [03](phase-03-auth.md)              | Auth (FirebaseUI) & profiles  | 1.5 days | ✅ Done                                                       |
| [04](phase-04-design-system.md)     | Tokens, components, app shell | 2 days   | 🟨 Mostly — no Skeleton/Toast/ErrorBoundary/404/gallery       |
| [05](phase-05-friends-groups.md)    | Friends, groups, invites      | 2.5 days | ✅ Done                                                       |
| [06](phase-06-expenses-splits.md)   | Expenses & the split engine   | 4 days   | ✅ Done — domain at 100% branch coverage, gated               |
| [07](phase-07-balances-settle.md)   | Balances, settle up, simplify | 2.5 days | ✅ Done — simplification on by default (ADR-12)               |
| [08](phase-08-activity-comments.md) | Activity feed & comments      | 1.5 days | ✅ Done                                                       |
| [09](phase-09-polish-pwa.md)        | Polish, a11y, PWA             | 2 days   | 🟦 In progress — installable; 🔴 bundle 418 KB vs 350 KB      |
| [10](phase-10-hardening.md)         | Rules tests, App Check, perf  | 2 days   | 🟦 Started early — rules suite exists; App Check does not     |
| [11](phase-11-deploy.md)            | CI/CD, deploy, launch         | 1 day    | 🟦 Partial — CI verifies; functions deployed to dev by hand   |
| [12](phase-12-mobile-port.md)       | React Native app              | 3–4 wks  | ☐ Not started                                                 |
| [13](phase-13-monetization.md)      | Ads & monetization            | 1 wk     | ☐ Not started — ad **slots** are Phase 09 §7, also not built  |

### The things actually blocking "v1 is done"

Worst first. Each is written up where it lives.

1. 🔴 **SMS region policy and the 50/day phone quota are still unset, with Blaze live.**
   phase-02 §3. This is the only item on the list that can cost real money to an attacker's
   schedule rather than ours, and it is a console setting, not code.
2. 🔴 **`e2e/` and `firebase/tests/integration/` do not exist.** `playwright.config.ts` points
   at two directories that were never created, so `pnpm test:e2e`, `pnpm test:smoke` and
   `pnpm test:integration` all pass by matching nothing. Every E2E item in phases 05–09 and the
   `axe-core` sweep are blocked on this. phase-09 §11.
3. ✅ ~~**Main chunk is 418 KB gzipped against a 350 KB budget (NFR-2).**~~ **Fixed.** `/login`
   is now the one code-split route, which takes `firebaseui` + `firebase/compat` off the
   critical path: **419,269 B → 346,051 B gzipped.** `node scripts/bundle-budget.mjs` runs in
   CI and fails the build on a breach.
   ⚠️ Only **10.6 KB** of headroom, and route splitting cannot buy more — measured, the screens
   are 2–7 KB each and the rest is one shared vendor chunk. The next lever is Firebase entry
   points or dropping `firebaseui`. phase-09 §6.
4. ✅ **Unbounded reads — fixed in #53.** `watchMembers` is now `orderBy('leftAt','asc')` +
   `limit(100)` and the wrong "capped at 50" comments are corrected; `watchComments` is
   `limitToLast(50)`; `SettleUpScreen` renders the member list once. Still open in phase-10 §5b:
   composer split rows, and `retry()` missing on 9 of 13 core hooks.
5. 🟡 **`auditBalances` was written in #51 but is not running.** It needs a deploy, a Cloud
   Scheduler job, and the log-based drift alert before it is actually a canary. phase-10 §6.
6. 🟡 **Add-to-Home-Screen is unverified on a real device** — the only part of the PWA work
   that could not be checked from here. phase-09 §5.

**Phases 00–11 (web v1): roughly 22 working days** of focused solo work. Treat that as a
sequencing guide, not a commitment — the first Firebase project of your life absorbs time
in places nobody predicts.

> **Phase 02b is not optional and does not move later.** Article X requires tests before UI
> for anything that computes, and Phase 06 (the split engine) is unbuildable to standard
> without property testing and a coverage gate already wired. Retrofitting a test harness
> after three phases of code is a bad week.

> **Ads are Phase 13, but the ad _slots_ are built in Phase 09.** AdMob is a mobile SDK and
> the revenue lives in the mobile app; building the reserved-height slots early means
> nothing gets re-laid-out later. See [../docs/14-monetization-ads.md](../docs/14-monetization-ads.md).

---

## Suggested order for a first vertical slice

If you'd rather see something working end-to-end before building breadth, do this subset
first — it produces a running app you can actually use:

```
00 → 01 → 02 → 02b → 03 → 04(minimal) → 05(groups only) → 06(equal split only) → 07(balances only)
```

Then loop back and fill in: exact/percent/shares splits, friends, invites, simplification,
activity, comments, polish.

I'd recommend this. A working slice tells you more about the design than another week of
building components does.

---

## Conventions

- **One PR per phase** (or per major section within a long phase).
- **Do not skip the test items.** In this project the money tests are the product; a phase
  is not done when the screen renders, it's done when the balances are provably right.
- Every phase ends with `pnpm verify` green (typecheck + lint + depcruise + tests).
- Commit messages: Conventional Commits (`feat(expenses): add percentage split`).

## Legend

- 🔴 Blocking — later phases genuinely cannot proceed without it
- 🟡 Important — skipping creates rework
- 🟢 Nice to have — can slip to the backlog without harm

---

## Before you start

Answer the **open questions** in [../docs/12-decisions.md](../docs/12-decisions.md).
Q1 (rules validation) and Q3 (project name) are the two that are expensive to change later.
