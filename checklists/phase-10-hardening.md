# Phase 10 — Security Hardening, Cost Control & Measurement

**Est. 2 days.** Depends on 09.
**Do not deploy to real users before this phase is complete.** Reference:
[../docs/05-security-rules.md](../docs/05-security-rules.md)

---

## 1. Security rules — complete coverage (NFR-9) 🔴

The rule: **for every `allow` in `firestore.rules`, one test that passes and one that fails.**
A rules suite with only happy paths provides approximately zero security value.

- [ ] 🔴 Audit `firestore.rules` line by line against the threat table
- [ ] 🔴 Confirm a denial test exists for **every** threat:

|     | Threat                                                | Test exists |
| --- | ----------------------------------------------------- | ----------- |
| T1  | Non-member reads group data                           | ☐           |
| T2  | Client writes `balanceMinor`                          | ☐           |
| T3  | Splits don't sum to total                             | ☐           |
| T4  | Client adds itself to a group                         | ☐           |
| T5  | `list` on `usernames` (enumeration)                   | ☐           |
| T6  | Split assigned to a non-member                        | ☐           |
| T7  | Forged `createdBy` / `createdAt`                      | ☐           |
| T8  | Client writes `activity`                              | ☐           |
| T9  | Collection-group query without the participant filter | ☐           |
| T10 | Group currency changed after creation                 | ☐           |
| T11 | Non-creator edits someone else's expense              | ☐           |
| T12 | Comment edited after posting                          | ☐           |
| —   | Unauthenticated read of anything                      | ☐           |

- [ ] 🔴 Positive tests for every allowed path
- [ ] 🔴 Explicit catch-all `match /{document=**} { allow read, write: if false; }`
- [ ] 🔴 Rules tests run in CI on every push, before any deploy
- [ ] 🟡 Verify no rules path exceeds the `get()`/`exists()` limit (10 per doc request,
      20 per query)

## 2. Adversarial testing 🔴 _Bypass your own UI_

Write a script using the raw SDK — no UI — and confirm each of these **fails**:

- [ ] 🔴 Create an expense in a group you're not in
- [ ] 🔴 Set your own `balanceMinor` to 0
- [ ] 🔴 Create an expense whose splits sum to less than the total
- [ ] 🔴 Add yourself to someone else's group
- [ ] 🔴 Read another user's profile document
- [ ] 🔴 List the `usernames` collection
- [ ] 🔴 Write an activity entry
- [ ] 🔴 Read an invite document directly
- [ ] 🔴 Hard-delete an expense
- [ ] 🔴 Change a group's currency

## 3. App Check

**Client is shipped and silent.** `apps/web/src/platform/appCheck.ts` registers the web app and
`startApp()` reports what it did. With `VITE_APPCHECK_SITE_KEY` unset it skips with a reason and
the app runs unattested — which is the correct state until the console steps below are done.
Upgraded 🟡 → 🔴: two public URLs on Blaze, and Rules are currently the only boundary.

- [ ] 🔴 **Create a reCAPTCHA Enterprise key for App Check**, score-based, with
      `splitsutra.web.app` + `splitsutra-prod.firebaseapp.com` (and the dev pair) as domains.
      🔴 **A NEW key.** Not one of the "Key for Identity Platform reCAPTCHA integration" keys the
      phone-auth work provisioned — each project already carries three or four under that single
      name, which cost real time to untangle on 2026-09-02. Using one here fails as
      `appCheck/recaptcha-error` with nothing naming the key.
- [ ] 🔴 Firebase console → App Check → Apps → register the web app with that key
- [ ] 🔴 Put the key in `apps/web/.env.local` (dev) and `.env.production.local` (prod) as
      `VITE_APPCHECK_SITE_KEY`, then rebuild — it is inlined at build time, so a deployed bundle
      built before the key existed stays unattested however the console is configured.
- [ ] 🔴 **Debug token for local development.** reCAPTCHA cannot attest `localhost`, so a dev
      machine gets no token at all without one. Set `VITE_APPCHECK_DEBUG_TOKEN=true`, read the
      generated token out of the console log, register it under App Check → Apps → Manage debug
      tokens.
      🔴 A debug token is a **complete App Check bypass** against the real project. It is read
      only under `import.meta.env.DEV`; a canary build with the variable set confirmed the value
      appears nowhere in `dist/` (the site key does, as it must). One token per developer, and
      revoke it in the console when that machine is done.
- [ ] 🔴 ⚠️ **Monitoring mode first, for long enough to mean something.** App Check → Metrics
      shows verified vs unverified per service. Enforcing before real traffic shows green locks
      you out of your own app — and with `signInWithPopup`, phone auth and callables all in play,
      "real traffic" is more paths than one session exercises.
- [ ] 🔴 Then enforce, in this order, checking metrics between each: Authentication → Firestore →
      Cloud Functions. Functions is the one that also needs a code change and a deploy:
      `ENFORCE_APP_CHECK` in `firebase/functions/src/common/config.ts` — one constant, one deploy.
- [ ] 🟡 Debug token for CI, once E2E exists — `e2e/` does not exist yet, so there is nothing to
      attest.

## 4. Cost control (Blaze) 🔴

- [ ] 🔴 **`maxInstances` set on every single Function** — the primary guard against a
      trigger loop billing you
- [ ] 🔴 Budget alert confirmed working (trigger a test notification)
- [ ] 🔴 Verify no Function can trigger itself: audit every write-back for a diff guard
- [ ] 🟡 Firestore read/write usage alerts
- [ ] 🟡 Phone-auth quota limit set in the console (caps SMS abuse)
- [ ] 🟡 Rate-limit profile renames (the fan-out is the most expensive user action)

## 5. Measure before optimising 🟡 _Answers open questions Q2 and the feed design_

- [ ] 🟡 Instrument reads per `recomputeBalances` invocation; log it
- [ ] 🟡 Seed a group with 500 and then 2,000 expenses; measure recompute latency and cost
- [ ] 🟡 **Decide Q2** (`RECOMPUTE_THRESHOLD`) from real numbers, not guesses
- [ ] 🟡 Measure the activity feed with a user in 20+ groups; decide whether the per-user
      feed collection is actually needed
- [ ] 🟡 Confirm no unindexed queries (watch the console for index warnings)

## 5b. Unbounded reads found by audit, 2026-08-31 🔴 _Not measured — read off the code_

These are not "might be slow one day". Each one is a query with no ceiling, or a list rendered
more times than it is needed, and all four were found by reading the repositories rather than
by profiling. They are listed worst first.

- [x] 🔴 **`watchMembers` has no `limit()`, and the `members` subcollection is unbounded.**
      Two comments in `packages/core/src/repositories/groupRepo.ts` (above `byMembership`, and
      above the filtered-members subscription) assert the collection is "capped at 50 documents
      (Q2)" and use that to justify sorting and filtering client-side. **The comments are
      wrong.** `MAX_GROUP_MEMBERS` is enforced against `group.memberIds.length` — _current_
      members — in `createInvite` and `redeemInvite`, while `leaveGroup` sets `leftAt` and
      deliberately **does not delete the member document**. So a group that has churned through
      200 people holds 200 documents, all of them fetched and re-sorted on every snapshot, and
      the cap that is supposed to bound this bounds something else. Fix the comments first, then
      the query — a wrong comment is what stops the next person looking.
      **Done, #53.** Comments corrected first, then `orderBy('leftAt','asc'), limit(100)`
      (`MAX_GROUP_MEMBERS * 2`, written as the expression so the two cannot drift). The
      ordering is the actual fix: Firestore sorts `null` before every other value and
      `leftAt` is `null` for exactly the current members, so no current member can be the
      row that falls off the end. ⚠️ That invariant depends on `leftAt` being written
      **explicitly** on every member document — `orderBy` silently excludes docs where the
      field is absent. Verified closed: clients cannot write `members` at all
      (`allow write: if false`, both the nested and collection-group paths), and the only
      creation factory (`firebase/functions/src/lib/groups.ts`) writes `leftAt: null`.
      Accepted cost: the tombstones the cap drops are the _most recent_ departures.
- [x] 🔴 **`watchComments` is unbounded** — `orderBy('createdAt', 'asc')` with no `limit()`, so
      a long dispute thread is re-delivered in full on every new comment. It also loads
      oldest-first, which is the wrong end to page from.
      **Done, #53** — `limitToLast(50)`, not `limit()`: `limit()` would keep the _opening_
      of an argument and never show how it ended, and an unacknowledged `serverTimestamp()`
      sorts after every resolved one locally, so an optimistic post would fall outside a
      `limit()` page on a thread at the cap. 🔴 Still owed: comments older than the page are
      not delivered and nothing says so — that wants an `endBefore` "load earlier" control.
- [x] 🟡 **`SettleUpScreen` renders the member list twice** — up to 99 rows for a 50-person
      group, where 50 would do. **Done, #53** — the payer collapses to the one row that
      answers it, and reopening that picker hides the payee list.
- [ ] 🟡 **Split rows are rebuilt one-per-participant on every add and edit** in the expense
      composer.
- [ ] 🟡 `useComposerGroups` and `useComposerMembers` expose no `retry()`, so a failed composer
      subscription has no recovery short of a reload. (9 of 13 core hooks are in the same
      position — phase-09 §1.)

## 6. Data integrity

- [x] 🔴 `auditBalances` — **listed in the function inventory and never written.** The inventory
      names it; `firebase/functions/src/` has no such file and nothing schedules one. Promoted
      from 🟡 because the item below calls it "the canary for silent money bugs", and there is
      currently no canary. **Written in #51** as `firebase/functions/src/scheduled/`
      `auditBalances.ts`: logs drift at ERROR with per-uid deltas, then repairs (docs/06,
      `common/logging.ts` and §6 below all say repair). It is a thin orchestrator over the
      existing `findBalanceDrift` + `recomputeBalances` — no second money path (Article VI).
      🔴 Written is not running: the two items below still need a deploy and a schedule.
      ⚠️ Scope deliberately excludes `users/{uid}/friends/{fid}.balanceMinor`, which
      `establishFriendship` seeds to `{}` and nothing ever writes again — auditing it would
      fire the canary every night. Those maps have no maintainer at all; that is its own
      open item.
- [ ] 🟡 `auditBalances` scheduled function running daily
- [ ] 🟡 Log-based alert on drift — **this is the canary for silent money bugs**
- [ ] 🟡 Verify auto-repair works: corrupt a balance by hand, confirm the audit fixes it
- [ ] 🟡 `recomputeGroupBalances` surfaced in the UI behind "Balances look wrong?"

## 7. Privacy & compliance

- [ ] 🟡 Confirm no PII in URLs or query strings
- [ ] 🟡 `gitleaks` clean across full git history, not just the working tree — still owed,
      and `gitleaks` is right for _this_ job even though the pre-commit hook is not: a
      one-off history sweep is installed once by one person, not by every clone. The hook
      (`scripts/scan-secrets.mjs`) only ever saw commits made after it landed, and cannot
      see past a `--no-verify`.
- [ ] 🟡 Confirm no service-account JSON was ever committed
- [ ] 🟡 Privacy policy and terms pages (required for Google sign-in branding, and for the
      app stores later)
- [ ] 🟢 Data export / deletion path documented (GDPR-style, even if manual)

---

## Exit criteria

- [ ] Every threat T1–T10 has a passing denial test
- [ ] The adversarial script fails on all 10 attempts
- [ ] App Check enforced with legitimate traffic verified
- [ ] `maxInstances` set everywhere; budget alert verified live
- [ ] `auditBalances` running and proven to self-repair
- [ ] Q2 answered with measured numbers
- [ ] `pnpm verify` green, CI fully passing
