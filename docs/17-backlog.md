# 17 — Backlog / Wish List

Everything deliberately excluded from v1, kept as a living list rather than scattered
"deferred" notes (Q7).

**Nothing here is scheduled.** Re-rank from real usage after launch — Article XII applies
to features as much as to optimisations. My guess at the top two once you've actually used
the app: **push notifications** and **receipt photos**.

Status: 🔵 Wanted · ⚪ Maybe · ⛔ Deliberately never

---

## Near-term — the obvious next things

### 🔵 Push notifications

Someone added an expense you're in; someone commented on your expense; a nudge for an
outstanding debt.
**Needs:** FCM, per-platform setup, a `notifications` collection, permission flows.
**Note:** naturally bundles with Phase 12 — the mobile app is where push actually matters,
and the setup cost is mostly paid there anyway. Comment notifications become more valuable
under ADR-11, since discussion is now how corrections happen.

### 🔵 Receipt photos

Attach a photo of the bill to an expense.
**Needs:** Firebase Storage, Storage rules, thumbnailing (a Function or an extension),
image picker via the `PlatformAdapter`, upload progress + retry.
**Cost note:** Storage is the first service that meaningfully leaves the free tier — 5 GB
free, then per-GB. Worth a look at [18-cost-control.md](18-cost-control.md) first.

### 🔵 Recurring expenses

Rent, subscriptions, standing splits.
**Needs:** a schedule model, a scheduled Function to materialise instances, edit-this-vs-all
semantics (the genuinely fiddly part), pause/skip.

### 🔵 Expense search & filters

By description, category, member, date range, amount range.
**Needs:** a composite index or two; Firestore has no full-text search, so description
search means either client-side filtering over a fetched window or an external index
(Algolia/Typesense — both add cost).

---

## Multi-currency (the big one)

### 🔵 Currency conversion

Mixed-currency groups, converted to a group base currency.
**Design already recorded** in [03-data-model.md](03-data-model.md) — the schema changes are
additive, so this is a feature, not a migration.
**The rule that must not be broken:** an expense stores the FX rate from **its own date**.
Converting on read with today's rate silently un-settles last month's settled groups.
**Needs:** a rate provider, historical rate lookup, staleness handling, and a UI that makes
clear which number is converted.

---

## Product depth

### 🔵 Spending charts & insights

Category breakdowns, month-over-month, per-group totals.
**Note:** this is also what makes the ad-category signal ([14-monetization-ads.md](14-monetization-ads.md))
genuinely useful to the _user_, not just to advertisers — worth pairing.

### 🔵 CSV / PDF export

Export a group's ledger. Frequently requested in expense apps; straightforward.

### ⚪ Expense templates

Save a common split ("Friday dinner, these 4 people, equal") for one-tap reuse.

### ⚪ Budgets

Per-category monthly limits with warnings. Drifts toward being a different product.

### ⚪ Itemised bill splitting

Assign individual line items to people rather than splitting the total. Powerful, and a
substantial UI project on its own.

### ⚪ Receipt OCR

Auto-extract total and line items. Only sensible after receipt photos exist, and accuracy
disappointment is common.

---

## Social & collaboration

### 🔵 @mentions in comment threads

Pull a specific person into a discussion. Pairs directly with push notifications and with
ADR-11's discussion-first model.

### ⚪ Reactions on expenses

Lightweight acknowledgement ("👍 seen") without a comment.

### ⚪ Group chat

A thread per _group_, not just per expense. Threads already exist at the expense level —
see whether people actually want the group-level one before building it.

### ⚪ Abuse reporting & moderation

Group names, expense descriptions, and comment threads are all free text visible to other
people. v1 has **no reporting path and no moderation**.

Low priority while the app is used among friends who already know each other — but it stops
being optional the moment invite links spread beyond that. Minimum viable version: a
"report" action that flags a document for review, plus the ability to remove a member.

### ⚪ In-app support / feedback channel

There is no way for a user to tell you something is wrong. The **"Balances look wrong?"**
button in `/account` covers the single most likely complaint by letting them self-heal, but
everything else has no route back to you. A mailto link or a simple feedback form would do.

### ⚪ Per-user rate limiting on callables

App Check and `maxInstances` bound _aggregate_ abuse; nothing limits a single authenticated
user hammering `redeemInvite` or `addFriend`. Not a cost risk at v1 scale, but the hook to
add later is the callable preamble in [06-cloud-functions.md](06-cloud-functions.md).

### ⚪ Nested comment replies

Deliberately excluded from v1: a 2–15 person group discussing one restaurant bill doesn't
need a reply tree. Revisit only if flat threads visibly strain.

---

## Payments

### ⚪ Payment integration (Venmo / PayPal / UPI deep links)

**Deep links only** — hand off to the payment app, then record the settlement. Low
complexity, genuinely useful.

### ⛔ In-app money movement

Holding, transferring, or processing funds. This makes you a regulated money transmitter.
**Not a feature decision — a company decision.** v1's settle-up deliberately records
offline payments only.

---

## Platform & polish

### 🔵 Dark mode toggle

System preference is respected in v1; an explicit override is a small addition.

### ⚪ Widgets / watch app

"You owe $X" at a glance. Fun, low value.

### ⚪ Biometric app lock

Face ID / fingerprint before opening. Reasonable for a money app.

### ⚪ Offline-first write queue with conflict resolution

Firestore's built-in persistence already covers the realistic cases. True conflict
resolution is a large project for a rare problem.

### ⚪ i18n / localisation

The currency layer is already ISO-complete; UI strings are not externalised. Doing this
before there's demand is speculative work.

---

## Monetization

### 🔵 Paid "Pro" tier _(Q9 — open)_

No ads, receipts, export, charts, unlimited groups.
**Worth noting: the category leader is freemium, not ad-funded.** That's a strong signal about
what actually monetises in this category — see
[14-monetization-ads.md](14-monetization-ads.md) §7.

### ⚪ AdMob mediation

AppLovin / Unity / Meta via AdMob Mediation for higher fill. Only once DAU justifies it;
adding it early is pure overhead.

### ⛔ Selling user data

Not now, not later. See [CONSTITUTION.md](../CONSTITUTION.md) Article XIII.

---

## Explicitly rejected

| Item                                          | Why                                                     |
| --------------------------------------------- | ------------------------------------------------------- |
| ⛔ In-app money movement                      | Regulatory exposure — a company decision, not a feature |
| ⛔ Selling or brokering user data             | Article XIII                                            |
| ⛔ Behavioural ad profiles stored server-side | Article XIII; breach + SAR + deletion liability         |
| ⛔ Ads in money-entry flows                   | Article XIV                                             |
| ⛔ Float arithmetic anywhere near money       | Article I                                               |

---

## How to use this list

When something graduates:

1. Move it into a phase checklist with real, checkable items.
2. If it changes an existing decision, add an **`R` entry** to
   [19-qa-log.md](19-qa-log.md) — never silently overwrite.
3. If it introduces a durable constraint, consider a new
   [CONSTITUTION.md](../CONSTITUTION.md) article.
4. Re-check [18-cost-control.md](18-cost-control.md) — Storage, search indexes, and FX
   providers all have real per-unit costs that the current design avoids.
