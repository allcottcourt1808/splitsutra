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

- [ ] 🟡 Register the web app with reCAPTCHA Enterprise
- [ ] 🟡 ⚠️ Run in **monitoring mode first** and confirm legitimate traffic passes.
      Enforcing immediately will lock you out of your own app.
- [ ] 🟡 Then enforce on Firestore and on Functions (`enforceAppCheck: true`)
- [ ] 🟡 Add debug tokens for local development and CI

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

- [ ] 🔴 **`watchMembers` has no `limit()`, and the `members` subcollection is unbounded.**
      Two comments in `packages/core/src/repositories/groupRepo.ts` (above `byMembership`, and
      above the filtered-members subscription) assert the collection is "capped at 50 documents
      (Q2)" and use that to justify sorting and filtering client-side. **The comments are
      wrong.** `MAX_GROUP_MEMBERS` is enforced against `group.memberIds.length` — _current_
      members — in `createInvite` and `redeemInvite`, while `leaveGroup` sets `leftAt` and
      deliberately **does not delete the member document**. So a group that has churned through
      200 people holds 200 documents, all of them fetched and re-sorted on every snapshot, and
      the cap that is supposed to bound this bounds something else. Fix the comments first, then
      the query — a wrong comment is what stops the next person looking.
- [ ] 🔴 **`watchComments` is unbounded** — `orderBy('createdAt', 'asc')` with no `limit()`, so
      a long dispute thread is re-delivered in full on every new comment. It also loads
      oldest-first, which is the wrong end to page from.
- [ ] 🟡 **`SettleUpScreen` renders the member list twice** — up to 99 rows for a 50-person
      group, where 50 would do.
- [ ] 🟡 **Split rows are rebuilt one-per-participant on every add and edit** in the expense
      composer.
- [ ] 🟡 `useComposerGroups` and `useComposerMembers` expose no `retry()`, so a failed composer
      subscription has no recovery short of a reload. (9 of 13 core hooks are in the same
      position — phase-09 §1.)

## 6. Data integrity

- [ ] 🔴 `auditBalances` — **listed in the function inventory and never written.** The inventory
      names it; `firebase/functions/src/` has no such file and nothing schedules one. Promoted
      from 🟡 because the item below calls it "the canary for silent money bugs", and there is
      currently no canary.
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
