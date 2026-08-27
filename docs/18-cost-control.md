# 18 — Cost Control

**Constraint: no-to-low financial impact at the start; fund incrementally if usage grows.**

This document is the plan for that. Short version: **the entire build costs $0**, and
steady-state at realistic personal scale is **also $0** — but that's only true with
guardrails, because Blaze has no hard spending cap by default.

---

## 1. The staged-billing plan 🔴

The single most effective thing: **don't link a billing account until you actually deploy.**

| Phases      | What runs                                   | Billing account          | Cost             |
| ----------- | ------------------------------------------- | ------------------------ | ---------------- |
| **00 – 10** | Everything, on the **local emulator suite** | ❌ Not linked            | **$0.00**        |
| **11**      | First real deploy                           | ✅ Upgrade to Blaze here | ~$0.00           |
| **12 – 13** | Mobile + ads                                | ✅ Blaze                 | ~$0.00, ads earn |

Phases 00–10 are roughly **three weeks of work that touches no cloud resource at all**.
Firestore, Auth, and Functions all run locally. You can build, test, and demo the entire
app before deciding whether to spend anything.

This is a change from the original plan, which upgraded to Blaze in Phase 02. There was no
reason to — nothing before Phase 11 needs a deployed backend.

> ⚠️ Create the Firebase project on the **free Spark plan** in Phase 02. It costs nothing,
> and gives you the real project IDs and auth provider config. Upgrade at Phase 11.

---

## 2. Why still Blaze at all, rather than staying on Spark

Spark has a hard $0 ceiling, which sounds ideal. It also has **no Cloud Functions**, and
that breaks the core correctness guarantee.

Without Functions, balance computation runs client-side, protected only by Security Rules
— and rules cannot express "recompute the sum of a subcollection". A user could set their
own balance to zero. ADR-04 chose Blaze specifically to close that hole.

The relevant fact: **Blaze _includes_ the entire Spark free tier.** You are not paying for
the first N of anything; you pay only for what exceeds the free allowance. At the scale
this app will plausibly reach, that's nothing.

---

## 3. What the free tier actually covers

Blaze's included free allowances:

| Service           | Free allowance                           |
| ----------------- | ---------------------------------------- |
| Firestore reads   | **50,000 / day**                         |
| Firestore writes  | **20,000 / day**                         |
| Firestore storage | 1 GiB                                    |
| Cloud Functions   | **2,000,000 invocations / month**        |
| Functions compute | 400,000 GB-sec + 200,000 GHz-sec / month |
| Hosting           | 10 GB stored, 360 MB / day transfer      |
| Authentication    | **50,000 monthly active users**          |
| Cloud Scheduler   | 3 jobs                                   |

### Modelled at 500 daily active users

| Activity                                   | Volume            | Against limit |
| ------------------------------------------ | ----------------- | ------------- |
| App opens (2/user/day, ~30 doc reads each) | ~30,000 reads/day | 60% of free   |
| Expenses added (~2/user/day)               | ~1,000 writes/day | 5% of free    |
| Balance recomputes (~5 member writes each) | ~5,000 writes/day | 25% of free   |
| Function invocations                       | ~60,000/month     | 3% of free    |
| Storage                                    | well under 1 GiB  | —             |

**500 DAU lands inside the free tier: $0/month.**

Past that, growth is gentle — Firestore reads cost about **$0.06 per 100,000**. Even
3,000,000 reads/month works out to roughly **$1.80/month**. Organic usage is not the
financial risk here.

---

## 4. The actual risks (all tail events, none organic)

| #   | Risk                                 | Realistic cost  | Control                      |
| --- | ------------------------------------ | --------------- | ---------------------------- |
| R1  | **SMS toll fraud** via phone auth    | **$100s–1000s** | §5 — the big one             |
| R2  | Cloud Function trigger loop          | $10s–100s       | `maxInstances` + diff guards |
| R3  | Scripted abuse of your public config | $10s            | App Check                    |
| R4  | Artifact Registry image creep        | ~$0.10/mo       | Cleanup policy               |
| R5  | Runaway recompute on a huge group    | $1s             | `RECOMPUTE_THRESHOLD` (Q2)   |

Note the ordering. **R1 is not in the same league as the others** and deserves
disproportionate attention.

---

## 5. 🔴 SMS toll fraud — the one that can actually hurt

**How it works:** an attacker repeatedly triggers your phone-auth flow against premium-rate
numbers in high-fraud regions. They receive a cut of the carrier termination fee. You
receive the bill. Firebase bills SMS per message with **large regional price variation** —
some destinations cost multiples of a US message.

This is the single most common way a hobby Firebase project receives a shocking invoice.

### Controls, in order of effectiveness

1. 🔴 **SMS region policy — allowlist United States only.**
   Firebase Console → Authentication → Settings → SMS region policy. Deny everything, allow
   `US`. This alone removes essentially the entire attack surface, because the profitable
   destinations are the ones you're now blocking. Add countries as you actually get users
   there.
2. 🔴 **App Check enforced on Auth** before phone auth goes live to real users.
3. 🔴 **Phone-auth quota limit** set low in the console (e.g. 50 SMS/day to start).
4. 🔴 **Emulator test numbers for all development.** Real SMS only for final device testing
   in Phase 11. See [08-firebase-setup.md](08-firebase-setup.md).
5. 🟡 Consider launching with **Email + Google only**, adding phone once App Check is
   proven in production. Phone stays in FirebaseUI's config; it's a one-line toggle.

---

## 6. 🔴 The hard kill switch

**Budget alerts notify. They do not stop spending.** The only true hard stop Google
provides is programmatically disabling billing on the project.

```
Cloud Billing budget  →  Pub/Sub topic  →  Cloud Function  →  disable project billing
```

The Function receives the budget notification and calls the Cloud Billing API to detach
the billing account when spend crosses your threshold. The project immediately falls back
to free-tier behaviour.

- Set the trigger at **$5**. If you cross $5 on a personal app, something is wrong, and
  you want it stopped rather than explained.
- ⚠️ **This is genuinely destructive** — the app goes down until you re-link billing.
  That's the correct trade at this stage: an outage is recoverable, a $2,000 SMS bill is
  an argument with a support queue.
- Test it once, deliberately, in Phase 11 by setting a $0.01 threshold.

Google publishes this pattern in the Cloud Billing docs; it's a well-trodden path, not a
hack.

---

## 7. Standing guardrails

Set all of these at Phase 11, before the first real user:

- [ ] **Budget alert at $1, $5, $10** — email at each
- [ ] **Kill-switch function** wired to the $5 budget, tested once
- [ ] **`maxInstances` on every Function** (start at 10) — bounds R2
- [ ] **Diff-guard every function that writes back to its own trigger path** — an
      unguarded `onUserProfileWritten` writing to `users/{uid}` loops forever
- [ ] **SMS region policy: US only**
- [ ] **Phone auth quota: 50/day**
- [ ] **App Check enforced** on Firestore, Functions, and Auth
- [ ] **Artifact Registry cleanup policy** — delete function images older than 30 days;
      Gen 2 deploys accumulate container images against a 0.5 GB free tier
- [ ] **Firestore usage alerts** on reads and writes
- [ ] **`us-central1` single region**, not `nam5` multi-region — multi-region roughly
      doubles storage cost for durability this app doesn't need

---

## 8. Design choices that were already cost-aware

Worth noting these were chosen for correctness and happen to also be cheap:

- **Balances read from member docs** ([07-balances-settle.md](../checklists/phase-07-balances-settle.md))
  — the overall summary costs **0 extra reads** because it aggregates groups already fetched.
- **Denormalized display names** — rendering a group needs 1 query, not N user lookups.
- **`isMember` via `exists()` on a member doc** — 1 rule read, not a nested chain.
- **Naive activity feed first** — the per-user fan-out collection trades write
  amplification for read savings and is deliberately deferred until measured (Article XII).

The one deliberately read-heavy choice is **full balance recompute** (ADR-07): ~25 reads
per expense write in a typical group. At 1,000 expense writes/day that's 25,000 reads —
half the free tier, and worth it for an idempotent, self-healing balance engine.
`RECOMPUTE_THRESHOLD` bounds the worst case.

---

## 9. If it does grow

Rough cost ladder, so scaling is a decision rather than a surprise:

| Scale      | Expected monthly cost | What changes                                        |
| ---------- | --------------------- | --------------------------------------------------- |
| < 500 DAU  | **$0**                | Nothing — free tier absorbs it                      |
| 1,000 DAU  | **~$1–3**             | Firestore reads start metering                      |
| 5,000 DAU  | **~$15–30**           | Consider the per-user activity feed; tune recompute |
| 20,000 DAU | **~$100–200**         | Ads (Phase 13) should now more than cover it        |

At around 5,000 DAU the ad revenue modelled in
[14-monetization-ads.md](14-monetization-ads.md) crosses the infrastructure cost. Below
that, this is a hobby project that costs approximately nothing; above it, it pays for
itself.

---

## 10. Development-time cost: exactly zero

Reiterating, because it's the main reassurance:

- The **emulator suite** runs Firestore, Auth, Functions, and Hosting locally.
- **CI runs against emulators too** — GitHub Actions is free for public repos and has a
  generous free allowance for private ones.
- No billing account is linked until Phase 11.
- If you build the whole thing and decide not to deploy, **total spend is $0.00**.
