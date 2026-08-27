# Execution Checklists — Master Tracker

Work top to bottom. Each phase has an **exit criteria** section — do not start the next
phase until the current one's exit criteria are met, because later phases assume them.

Mark items with `[x]` as you go. These files are the working state of the project.

---

## Progress

| Phase                               | Name                          | Depends on | Est.     | Status        |
| ----------------------------------- | ----------------------------- | ---------- | -------- | ------------- |
| [00](phase-00-prerequisites.md)     | Prerequisites & tooling       | —          | 1–2 h    | ☐ Not started |
| [01](phase-01-foundation.md)        | Repo, monorepo, core scaffold | 00         | 1 day    | ☐ Not started |
| [02](phase-02-firebase-setup.md)    | Firebase projects & emulators | 00         | 0.5 day  | ☐ Not started |
| [02b](phase-02b-testing-setup.md)   | **Testing framework setup**   | 01, 02     | 1 day    | ☐ Not started |
| [03](phase-03-auth.md)              | Auth (FirebaseUI) & profiles  | 01, 02b    | 1.5 days | ☐ Not started |
| [04](phase-04-design-system.md)     | Tokens, components, app shell | 01         | 2 days   | ☐ Not started |
| [05](phase-05-friends-groups.md)    | Friends, groups, invites      | 03, 04     | 2.5 days | ☐ Not started |
| [06](phase-06-expenses-splits.md)   | Expenses & the split engine   | 05         | 4 days   | ☐ Not started |
| [07](phase-07-balances-settle.md)   | Balances, settle up, simplify | 06         | 2.5 days | ☐ Not started |
| [08](phase-08-activity-comments.md) | Activity feed & comments      | 06         | 1.5 days | ☐ Not started |
| [09](phase-09-polish-pwa.md)        | Polish, a11y, PWA             | 07, 08     | 2 days   | ☐ Not started |
| [10](phase-10-hardening.md)         | Rules tests, App Check, perf  | 09         | 2 days   | ☐ Not started |
| [11](phase-11-deploy.md)            | CI/CD, deploy, launch         | 10         | 1 day    | ☐ Not started |
| [12](phase-12-mobile-port.md)       | React Native app              | 11         | 3–4 wks  | ☐ Not started |
| [13](phase-13-monetization.md)      | Ads & monetization            | 12         | 1 wk     | ☐ Not started |

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
