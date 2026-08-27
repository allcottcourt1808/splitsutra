# 19 — Question & Answer Register

**The single authoritative record of every decision question, its answer, and what changed
as a result.** Maintained across revisions so a future reader — or a future you — can see
not just _what_ was decided but _when it changed and why_.

Detailed rationale lives in [12-decisions.md](12-decisions.md) (technical) and
[14-monetization-ads.md](14-monetization-ads.md) (commercial). This document is the index
and the history.

---

## Register

| #   | Question                                   | Answer                                                                   | Status      | Decided    |
| --- | ------------------------------------------ | ------------------------------------------------------------------------ | ----------- | ---------- |
| Q1  | How do Rules validate splits sum to total? | **Option A** — checksum field in rules + real sum verified in Function   | ✅          | 2026-08-24 |
| Q2  | Group size / recompute limits?             | **50 members**, `RECOMPUTE_THRESHOLD = 1000` (provisional)               | ✅          | 2026-08-24 |
| Q3  | Project name?                              | **SplitSutra** — one word, ownable, keeps the "settle up" instinct            | ✅          | 2026-08-24 |
| Q4  | Currency & region?                         | **USD**, `us-central1`, all ISO 4217, one per group                      | ✅          | 2026-08-24 |
| Q5  | Phone auth supported?                      | **Yes**, confirmed. Test numbers in dev; SMS region allowlist            | ✅          | 2026-08-24 |
| Q6  | Anyone can edit any expense?               | **No** — creator/admin only; anyone can open a thread                    | ✅          | 2026-08-24 |
| Q7  | Keep the backlog?                          | **Yes** — maintained in [17-backlog.md](17-backlog.md)                   | ✅          | 2026-08-24 |
| Q8  | Ad targeting approach?                     | **Aggregate spending category**, on-device, one enum                     | ✅          | 2026-08-24 |
| Q9  | Also build a paid tier?                    | — _(rec: yes, plan for it)_                                              | 🟡 **Open** | —          |
| Q10 | Web ads in v1?                             | — _(rec: no)_                                                            | 🟡 **Open** | —          |
| Q11 | Primary market?                            | **US** — implied by Q4                                                   | ✅          | 2026-08-24 |
| Q12 | Ad category toggle default?                | — _(rec: off)_                                                           | 🟡 **Open** | —          |
| Q13 | Billing exposure at start?                 | **Spark until Phase 11**, then Blaze with a kill switch                  | ✅          | 2026-08-24 |
| Q14 | When do CI checks start blocking?          | **Advisory until v1.0**, enforced at the Phase 11 launch flip            | ✅          | 2026-08-24 |
| Q15 | Which Node runtime?                        | **Node 24** — Active LTS. Node 20 is EOL, Node 22 is Maintenance-only    | ✅          | 2026-08-24 |
| Q16 | Is the name **SplitSutra** actually available?  | — _(rec: **rename** — three live expense-splitting apps already use it)_ | 🔴 **Open** | —          |
| Q17 | Keep FirebaseUI for auth?                  | **No** — dropped. Custom auth screens on the modular `firebase/auth` SDK | ✅          | 2026-08-24 |

**Open: Q9, Q10, Q12** — all Phase 13 (ads/revenue), none blocking. **Q16 — the name — is open and does block Phase 02**, because Firebase project IDs are globally unique and permanent once claimed.

**Nothing blocks Phase 00 or Phase 01.** Phase 02 should not begin until Q16 (the name) is settled.

---

## Revision history

The point of this document. When an earlier decision is overturned, it is recorded here
rather than silently overwritten.

### R1 — Ad targeting widened from screen-context to aggregate category

**Date:** 2026-08-24 · **Supersedes:** original Q8 recommendation

**Was:** contextual only — ad category derived from the current screen, never from expense
history. Chosen out of caution about financial data feeding ad profiles.

**Now:** aggregate spending category — the user's top category over a rolling 90 days,
derived **on-device**, transmitted as one value from a six-member enum.

**Why it changed:** the user clarified the intent was _"the category where they are
spending more, not specifics."_ That is a materially different and much more defensible
design than shipping transaction detail. The original objection largely dissolves once the
payload is a single coarse enum computed locally and never persisted server-side.

**Guardrails added with it:** sensitive categories excluded from the enum; minimum evidence
threshold; never persisted server-side; opt-in defaulting off.

**Changed:** [14-monetization-ads.md](14-monetization-ads.md) §1 and §4,
[CONSTITUTION.md](../CONSTITUTION.md) Article XIII,
[phase-13-monetization.md](../checklists/phase-13-monetization.md) §4.

---

### R2 — Expense editing restricted; discussion threads promoted

**Date:** 2026-08-24 · **Supersedes:** Q6 recommendation, `AC-D3.1`

**Was:** any group member can edit any expense (matching Splitwise's permissive model).
Recommended on the grounds that the group is socially trusted and the activity feed
provides accountability.

**Now:** only `createdBy` or a group admin can edit or soft-delete an expense. Any member
can open a **flat, chronological discussion thread** on any expense.

**Why it changed:** the user answered "No" and proposed the thread as the alternative. On
reflection this is the better model — the permissive version lets someone silently rewrite
your record of what you paid, and "ask, don't overwrite" keeps the disagreement attached to
the expense as context.

**Consequence:** comments moved from decorative to **load-bearing**. Phase 08 rises in
priority; the thread is a primary action on expense detail, not a footer. Non-creators see
**Discuss** where creators see **Edit**.

**Changed:** [12-decisions.md](12-decisions.md) ADR-11, [03-data-model.md](03-data-model.md)
D7 + comments schema, [05-security-rules.md](05-security-rules.md) expense update rule,
[01-requirements.md](01-requirements.md) `AC-D3.1`, phases 06 and 08.

---

### R3 — Billing deferred from Phase 02 to Phase 11

**Date:** 2026-08-24 · **Supersedes:** ADR-04 timing, phase-02 checklist

**Was:** upgrade both Firebase projects to Blaze in Phase 02, before writing any Cloud
Function.

**Now:** create projects on **free Spark** in Phase 02; develop entirely against the local
emulator suite through Phase 10; **link billing only at Phase 11**, together with a hard
kill switch.

**Why it changed:** the user set a constraint of no-to-low financial impact at the start.
Reviewing it, there was **no reason to link billing early** — nothing before the first
deploy touches a cloud resource. This defers all financial exposure by ~3 weeks and makes
the entire build cost exactly $0.

**Note:** the _choice_ of Blaze is unchanged (ADR-04 stands) — Spark has no Cloud
Functions, which would break server-authoritative balances. Only the timing moved.

**Added with it:** the billing kill-switch pattern, SMS toll-fraud controls, and a modelled
cost ladder — [18-cost-control.md](18-cost-control.md).

**Changed:** [12-decisions.md](12-decisions.md) ADR-04, phases 02, 03, 11.

---

### R4 — Currency scope widened from 8 to all of ISO 4217

**Date:** 2026-08-24 · **Supersedes:** ADR-08 original scope

**Was:** eight hardcoded currencies (INR, USD, EUR, GBP, AUD, CAD, SGD, AED), default INR,
region `asia-south1`.

**Now:** the full ISO 4217 set (~180), default **USD**, region **`us-central1`**. Still one
currency per group, still no conversion in v1.

**Why it changed:** the user specified USD/US and asked for all currencies to be supported,
with multi-currency conversion as a future step handled gracefully.

**Technical consequence — the important one:** not every currency has 2 decimal places
(JPY/KRW have 0; KWD/BHD have 3). The exponent determines how a stored integer is
_interpreted_, so it must come from a **hardcoded ISO table, never from `Intl`** — ICU data
varies between runtimes, and a trimmed Hermes build on React Native could read every amount
wrong by 100×. `Intl` is now display-only.

**Also:** Rules can't enumerate 180 currencies, so currency validation adopts the same
two-layer shape as Q1 — shallow check in rules, authoritative check in the Function.

**Changed:** [04-split-engine.md](04-split-engine.md) §1, [03-data-model.md](03-data-model.md)
D6 + the multi-currency forward design, [05-security-rules.md](05-security-rules.md),
[07-ui-ux-spec.md](07-ui-ux-spec.md) currency picker, [08-firebase-setup.md](08-firebase-setup.md).

---

### R5 — Node runtime moved from 20 to 24

**Date:** 2026-08-24 · **Supersedes:** the Node 20 pin in Phase 00/01 and the Functions runtime

**Was:** Node 20 LTS locally, `nodejs20` Cloud Functions runtime, `.nvmrc` = 20.

**Now:** **Node 24** everywhere — local, `.nvmrc`, CI `setup-node`, and the `nodejs24`
Cloud Functions Gen 2 runtime. Installed version: 24.19.0.

**Why it changed:** the plan was written against a Node 20 that has since died. Node 20
reached **end-of-life on 2026-04-30** — four months before this project started — so it
receives no security patches. Node 22 is already **Maintenance-only** (EOL 2027-04-30),
which would force a second migration inside a year. Node 24 is the current **Active LTS**
(EOL 2028-04-30) and is a supported Cloud Functions Gen 2 runtime.

**Secondary benefit:** the emulator runs functions on the _local_ Node binary, so pinning
local and deploy runtimes to the same major removes a dev/prod divergence rather than
papering over one.

**Changed:** `.nvmrc`, root `package.json` engines, `.github/workflows/ci.yml`,
`firebase/functions/package.json`, `firebase.json`, `@types/node`,
[../checklists/phase-00-prerequisites.md](../checklists/phase-00-prerequisites.md).

---

### R6 — Name clearance for "SplitSutra" failed _(open — awaiting decision)_

**Date:** 2026-08-24 · **Contests:** Q3

**Was:** Q3 concluded **SplitSutra**, on the reasoning that dropping the `e` moved the name out
of the crowded "debt settlement" trademark space.

**Finding:** that reasoning does not survive contact with the market. The dropped-`e`
spelling is itself crowded — and crowded specifically by _expense-splitting apps_, which is
a direct category collision rather than a distant one:

| Product                                        | Evidence                                        |
| ---------------------------------------------- | ----------------------------------------------- |
| **SplitSutra: Split** — SplitSutra Financial Corporation | live on the iOS App Store; `settl.company`      |
| **SplitSutra** — AI expense-splitting agent         | live on iOS + Android; `settl.fyi`              |
| **SplitSutra** — UPI expense splitter (India)       | `settlapp.in`, markets itself against Splitwise |

**Why it matters now rather than later:** the name is load-bearing in places that get
expensive to change — `@splitsutra/*` package names, the **globally-unique and permanent**
Firebase project IDs, the domain, and the app-store listing. Phase 00 already flagged this
as _"ten minutes now beats renaming after publish."_ The ten minutes have now been spent
and they returned a bad answer.

**Recommendation:** rename before Phase 02 reserves any Firebase project ID. Runners-up
recorded in [12-decisions.md](12-decisions.md) Q3 were **Dutch**, **Reckon**, **Parity**.

**Not yet propagated** — the code currently in flight uses `@splitsutra/*`. A rename is a
find-and-replace plus a directory rename while nothing is published; it is not a migration.

---

### R7 — FirebaseUI is two SDK majors behind _(open — awaiting decision)_

**Date:** 2026-08-24 · **Contests:** the drop-in-auth decision (ADR / Phase 03)

**Was:** use FirebaseUI, Firebase's drop-in auth widget, to get email + phone + Google
sign-in without hand-building screens. Quarantined to `apps/web/src/auth/**` because it
needs `firebase/compat` and is web-only.

**Finding — this is no longer hypothetical.** `pnpm install` reports it directly:

```
WARN Issues with peer dependencies found
  └── ✕ unmet peer firebase@"^9.1.3 || ^10.0.0": found 11.10.0
```

`firebaseui@6.1.0` supports Firebase JS SDK **9 or 10**. The project is on **11.10.0**, and
the current SDK is **12.18.0**. FirebaseUI has not shipped a release supporting either.
So the day-one state is an unsupported combination, and the library pins the entire
Firebase SDK line to a version two majors stale.

**The risk was already logged** in [02-architecture.md](02-architecture.md) — _"FirebaseUI
abandoned / breaks on a React major → quarantined to one file; fallback is ~1 day of custom
auth screens."_ The mitigation was designed correctly. The risk has now materialised.

**Recommendation: drop FirebaseUI and build the auth screens.** The deciding argument is
not the peer warning — it is that **doc 02 already states FirebaseUI "does not port" to
React Native.** Phase 12 has to build custom auth screens regardless. Keeping FirebaseUI
buys roughly a day now, costs that day back at the mobile port, and carries an unsupported
dependency in between.

Dropping it also deletes `firebase/compat` from the tree, one dependency-cruiser rule, the
quarantine boundary, and unblocks Firebase SDK 12+. It gives full control of the sign-in
UI, which matters given the explicit requirement that the UI be intuitive.

**Counter-argument, stated fairly:** phone-OTP flows with reCAPTCHA are the fiddliest part
of Firebase Auth, and FirebaseUI does handle them. The ~1 day estimate is optimistic for
phone auth specifically; ~2 days is more honest.

**Decision: dropped** (owner, 2026-08-24). Propagated: `firebaseui` removed from
`apps/web/package.json`; the dependency-cruiser rule `firebaseui-is-quarantined` became
`no-firebaseui-or-compat` — a **blanket ban** rather than a carve-out, which is a strictly
stronger guarantee; `apps/web/src/auth/**` now builds real screens on the modular SDK.
Because the
quarantine already exists, swapping it touches one directory either way.

---

## Convention for future questions

When a new decision point appears:

1. **Add a row to the register** with the next `Q` number and status 🟡 Open.
2. **Write the question with a recommendation** in
   [12-decisions.md](12-decisions.md) (technical) or the relevant domain doc. Always
   include a recommendation — an open question with no default is a stall.
3. On answer: flip the row to ✅, record the date, and note which docs changed.
4. **If it overturns an earlier decision, add an `R` entry above** — was / now / why /
   what changed. Never silently overwrite a decision; the reasoning is the valuable part.
5. If it establishes a durable principle, consider whether it belongs in
   [CONSTITUTION.md](../CONSTITUTION.md) as an article.

### Status legend

- ✅ Answered and propagated into the docs
- 🟡 Open — has a recommendation, awaiting a decision
- 🔴 Blocking — work cannot start until it's answered
- ♻️ Superseded — see the corresponding `R` entry
