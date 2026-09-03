# SplitSutra

[![ci](https://github.com/allcottcourt1808/splitsutra/actions/workflows/ci.yml/badge.svg)](https://github.com/allcottcourt1808/splitsutra/actions/workflows/ci.yml)

> CI is **advisory** until v1.0 — nothing blocks a merge (see
> [docs/20-test-automation-pipeline.md](docs/20-test-automation-pipeline.md) §5a). This badge
> is the defence against that decaying into permanently-ignored: **a red `main` is a
> same-day fix.**

**SplitSutra** — square up, no awkwardness.

Expense-sharing web app on Firebase, structured so a React Native
mobile app can be added later without rewriting business logic.

> **Status: BUILDING — Phase 01.** Phase 00 is done: Node 24, pnpm 9.15.9, Firebase CLI
> 15.28.1 and JDK 21 are installed, and the monorepo scaffold is being assembled.
> **No Firebase project exists and no money has been spent** — billing stays on the free
> Spark plan until Phase 11.

## Decisions already locked in

| Area         | Choice                                                                        |
| ------------ | ----------------------------------------------------------------------------- |
| Structure    | pnpm monorepo — `packages/core` (no UI) + `apps/web` (React + Vite)           |
| Web UI       | React 19 + TypeScript + Vite, **mobile-first** (390px design target)          |
| Backend      | Firebase — Firestore, Auth, Cloud Functions, Hosting                          |
| Billing      | **Blaze** (pay-as-you-go); expected cost at personal scale ≈ $0/mo            |
| Auth         | **FirebaseUI** drop-in widget (email/password + phone OTP + Google)           |
| MVP scope    | Core expense-splitting set **+ debt simplification**                          |
| Currency     | **USD** default, **all ISO 4217** supported, one currency per group           |
| Region       | **`us-central1`** — ⚠️ permanent once Firestore is created                    |
| Editing      | Creator or group admin only; **anyone can open a discussion thread**          |
| Monetization | Free for users, ad-funded — **AdMob on mobile**, aggregate-category targeting |
| Cost         | **$0 through Phase 10** (emulators only). Billing linked at Phase 11          |
| Deferred     | Receipt uploads, recurring expenses, push notifications, multi-currency FX    |

## How to read this

Read in this order. Docs describe **what and why**; checklists are **what to actually do**.

### 0. The rules

- [CONSTITUTION.md](CONSTITUTION.md) — **14 non-negotiable principles.** Short. Read this first and re-read it each phase.

### 1. Understand the product

- [docs/00-overview.md](docs/00-overview.md) — what we're building, what we're not
- [docs/01-requirements.md](docs/01-requirements.md) — user stories + acceptance criteria

### 2. Understand the design

- [docs/02-architecture.md](docs/02-architecture.md) — monorepo layout, module boundaries, the mobile-portability contract
- [docs/03-data-model.md](docs/03-data-model.md) — Firestore collections, indexes, denormalization
- [docs/04-split-engine.md](docs/04-split-engine.md) — money math, split algorithms, debt simplification
- [docs/05-security-rules.md](docs/05-security-rules.md) — the threat model and rule design
- [docs/06-cloud-functions.md](docs/06-cloud-functions.md) — server-authoritative balance pipeline
- [docs/07-ui-ux-spec.md](docs/07-ui-ux-spec.md) — screen inventory, navigation, design tokens, component library
- [docs/08-firebase-setup.md](docs/08-firebase-setup.md) — console config, emulators, environments
- [docs/09-testing.md](docs/09-testing.md) — test **strategy**: what to test, where to spend effort
- [docs/16-testing-setup.md](docs/16-testing-setup.md) — test **setup**: packages, configs, harnesses
- [docs/20-test-automation-pipeline.md](docs/20-test-automation-pipeline.md) — **pipeline gates**: what blocks a merge and a promotion
- [docs/10-deployment.md](docs/10-deployment.md) — CI/CD, hosting, release process
- [docs/11-mobile-port.md](docs/11-mobile-port.md) — the React Native path
- [docs/12-decisions.md](docs/12-decisions.md) — **ADR log + open questions Q1–Q7**

### 3. Product & business

- [docs/14-monetization-ads.md](docs/14-monetization-ads.md) — **ad network choice, targeting design, compliance**
- [docs/15-usability.md](docs/15-usability.md) — what "intuitive" means concretely, plus a 5-user test protocol
- [docs/17-backlog.md](docs/17-backlog.md) — the wish list; everything deliberately not in v1
- [docs/18-cost-control.md](docs/18-cost-control.md) — **how this stays at ~$0**, and the hard kill switch

### 4. Process

- [docs/19-qa-log.md](docs/19-qa-log.md) — **every question, its answer, and revision history**
- [docs/13-spec-kit.md](docs/13-spec-kit.md) — whether to use GitHub Spec Kit (answer: partially)

### 5. Execute

- [checklists/README.md](checklists/README.md) — master progress tracker, then phases 00 → 13

## Open questions

Q1, Q2, Q4–Q8, Q11, Q13 are **answered** — see [docs/19-qa-log.md](docs/19-qa-log.md) for
the full register and revision history.

Still open, each with a recommendation attached:

| #      | Question                                 | Blocks                                                      |
| ------ | ---------------------------------------- | ----------------------------------------------------------- |
| **Q3** | **Project name**                         | 🔴 **Phase 01** — package names, repo, Firebase project IDs |
| Q9     | Also build a paid tier?                  | Phase 13                                                    |
| Q10    | Web ads in v1? _(rec: no)_               | Phase 13                                                    |
| Q12    | Ad category toggle default? _(rec: off)_ | Phase 13                                                    |

**Only Q3 blocks starting.**
