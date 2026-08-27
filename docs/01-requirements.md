# 01 — Requirements

User stories with testable acceptance criteria. Each `AC-*` should map to at least one
automated test. IDs are referenced from the phase checklists.

---

## Epic A — Authentication & Profile

### A1. Sign up / sign in

> As a new user, I want to sign in with email, phone, or Google so I can start using the app.

- **AC-A1.1** The sign-in screen renders the FirebaseUI widget offering: Email/Password, Phone (SMS OTP), and Google.
- **AC-A1.2** On first successful sign-in, a `users/{uid}` document is created with `displayName`, `email` and/or `phoneNumber`, `photoURL`, `defaultCurrency`, `createdAt`.
- **AC-A1.3** On subsequent sign-ins, the existing profile is loaded — no duplicate document is created.
- **AC-A1.4** Signing in with email then later with Google using the _same email_ results in **one** account (FirebaseUI account-linking flow), not two.
- **AC-A1.5** An unauthenticated user hitting any route other than `/login` is redirected to `/login`.
- **AC-A1.6** An authenticated user hitting `/login` is redirected to `/groups`.
- **AC-A1.7** Session survives a full page reload (Firebase local persistence).

### A2. Profile management

> As a user, I want to set my name, photo, and default currency.

- **AC-A2.1** User can edit `displayName` (1–50 chars, trimmed, non-empty).
- **AC-A2.2** User can set `defaultCurrency` from the **full ISO 4217 set**, defaulting to **USD**. The picker is searchable with common currencies pinned to the top.
- **AC-A2.3** Changing `displayName` updates the name shown to other members in every group within 60s (Cloud Function fan-out).
- **AC-A2.4** A user can only write their own `users/{uid}` doc — enforced by rules and covered by a rules test.

### A3. Sign out / delete account

- **AC-A3.1** Sign out clears the session and returns to `/login`.
- **AC-A3.2** Account deletion is blocked with a clear message if the user has any non-zero balance in any group.
- **AC-A3.3** Account deletion removes the user from all groups and anonymises their `users/{uid}` doc; historical expenses retain a tombstone name ("Deleted user") so past balances stay auditable.

---

## Epic B — Friends

### B1. Add a friend

> As a user, I want to add someone by email or phone so we can split expenses.

- **AC-B1.1** User can search for an existing user by exact email or exact E.164 phone number.
- **AC-B1.2** Search returns at most one result, exposing only `displayName` and `photoURL` — never the full user document.
- **AC-B1.3** If no user exists, the app offers to send an invite link (see B3).
- **AC-B1.4** Adding a friend creates a reciprocal entry: `users/{me}/friends/{them}` **and** `users/{them}/friends/{me}`.
- **AC-B1.5** Adding an existing friend is idempotent — no duplicate, no error.
- **AC-B1.6** A user cannot add themselves as a friend.

### B2. Friend list & balances

- **AC-B2.1** Friends list shows each friend with net balance: "owes you X" (positive), "you owe X" (negative), or "settled up" (zero).
- **AC-B2.2** The net balance aggregates across **all** shared groups plus the implicit 1:1 group.
- **AC-B2.3** Balances in different currencies are listed on separate lines, never summed together.
- **AC-B2.4** Tapping a friend opens a detail view listing every shared expense, newest first.

### B3. Invites

- **AC-B3.1** Generating an invite creates an `invites/{inviteId}` doc with a random 128-bit token and a 14-day expiry.
- **AC-B3.2** The invite link is shareable via the Web Share API on mobile, with copy-to-clipboard fallback.
- **AC-B3.3** Opening an invite while logged out routes to sign-in, then completes the join afterwards.
- **AC-B3.4** Redeeming an invite is handled by a **Cloud Function** (a client cannot add itself to a group it cannot yet read).
- **AC-B3.5** An expired, already-used, or unknown token shows a specific, non-generic error.

---

## Epic C — Groups

### C1. Create & manage

- **AC-C1.1** Create a group with a name (1–60 chars), type (Trip / Home / Couple / Other), and currency (immutable after creation).
- **AC-C1.2** Creator becomes `admin`; everyone else is `member`.
- **AC-C1.3** Admin can add members from the friend list or by invite link.
- **AC-C1.4** Admin can rename the group and change its type/photo.
- **AC-C1.5** Only an admin can delete a group, and only when **all** member balances are zero.
- **AC-C1.6** A member can leave a group only when their own balance is zero.
- **AC-C1.7** Removing a member with a non-zero balance is blocked with an explanatory message.
- **AC-C1.8** Group list is sorted by most recent activity and shows the user's net balance per group.

---

## Epic D — Expenses

### D1. Add an expense

- **AC-D1.1** Required fields: description (1–100 chars), amount (> 0), date (defaults to today, not more than 1 day in the future), payer(s), split method, participants (at least 1).
- **AC-D1.2** Amount is entered in major units but stored as an **integer in minor units** (see [04-split-engine.md](04-split-engine.md)).
- **AC-D1.3** Default payer is the current user; default split is Equal across all group members.
- **AC-D1.4** **Multiple payers** are supported; the sum of payer contributions must equal the total.
- **AC-D1.5** The sum of all split shares must equal the total exactly — validated client-side, in Security Rules, **and** in the Cloud Function.
- **AC-D1.6** A category can be selected from a fixed list; defaults to "General".
- **AC-D1.7** After saving, every participant's balance updates within 5 seconds without a manual refresh.

### D2. Split methods

- **AC-D2.1 Equal** — total split evenly; leftover minor units distributed deterministically (never dropped, never duplicated).
- **AC-D2.2 Exact** — user types each participant's amount; UI shows a live "X left to assign" indicator and blocks save unless it is exactly 0.
- **AC-D2.3 Percentage** — percentages must total exactly 100%; the resulting minor units must total the expense amount.
- **AC-D2.4 Shares** — integer shares (e.g. 2:1:1); amounts derived proportionally, remainder distributed deterministically.
- **AC-D2.5** Switching split method preserves the participant set and the total, and recomputes shares.
- **AC-D2.6** A participant can be assigned a zero share and still remain a listed participant.

### D3. Edit / delete

- **AC-D3.1** Only the expense **creator** or a **group admin** may edit or delete an expense (ADR-11). Everyone else sees a **Discuss** action opening the comment thread instead of **Edit**.
- **AC-D3.1a** A non-creator, non-admin attempting an edit via the API is rejected by Security Rules (threat T11).
- **AC-D3.1b** Admin override exists so an expense remains editable after its creator leaves the group.
- **AC-D3.2** Editing recalculates balances for the union of old and new participants.
- **AC-D3.3** Delete is a **soft delete** (`deletedAt` set); balances are reversed but the record survives for the audit trail.
- **AC-D3.4** Every edit appends an entry to the activity feed naming the editor and what changed.

### D4. Discussion threads

Load-bearing under ADR-11 — this is how a non-creator raises a correction.

- **AC-D4.1** Any group member can post to an expense's thread (1–500 chars).
- **AC-D4.2** Comments display author name, avatar, and relative timestamp.
- **AC-D4.3** A user can delete only their own comment.
- **AC-D4.4** **Nobody can edit a comment** — an edited comment in a dispute thread destroys the record of what was said (threat T12).
- **AC-D4.5** The thread is **flat and chronological**; no nested replies.
- **AC-D4.6** Expense rows show a comment count, and the expense detail screen surfaces **Discuss** as a primary action.
- **AC-D4.7** `commentCount` and `lastCommentAt` on the expense are maintained server-side, so list views need no extra reads.

---

## Epic E — Balances & Settle Up

### E1. Balance display

- **AC-E1.1** Home shows an overall summary: total you are owed, total you owe, per currency.
- **AC-E1.2** Group detail shows every member's net balance for that group.
- **AC-E1.3** **Invariant:** the sum of all member net balances in a group is exactly `0`. Enforced by a property-based test over randomly generated expense sets.
- **AC-E1.4** Balances are computed server-side by Cloud Functions and are **not** writable by clients.

### E2. Settle up

- **AC-E2.1** "Settle up" suggests a payment amount and direction derived from current balances.
- **AC-E2.2** Partial settlements are allowed (pay less than the full amount owed).
- **AC-E2.3** A settlement records `fromUid`, `toUid`, `amountMinor`, `currency`, `date`, optional note.
- **AC-E2.4** Settlements appear in the activity feed and in the group's expense list, visually distinct from expenses.
- **AC-E2.5** A settlement can be deleted, which reverses its balance effect.
- **AC-E2.6** Settlement amount must be > 0 and may not exceed the outstanding debt by more than a configured tolerance.

### E3. Debt simplification

- **AC-E3.1** Given net balances, the algorithm outputs a payment list of at most `n-1` transactions.
- **AC-E3.2** After applying every suggested payment, all balances are exactly zero.
- **AC-E3.3** Simplification is **display-only by default**; a group setting `simplifyDebts` makes it the canonical settle-up view.
- **AC-E3.4** The UI explains what simplification did, e.g. "A pays C directly instead of A to B to C".
- **AC-E3.5** Simplification never changes the underlying ledger — expenses are untouched.

---

## Epic F — Activity Feed

- **AC-F1.1** The feed lists group and friend events newest-first: expense added/edited/deleted, settlement recorded, member joined/left, group created/renamed.
- **AC-F1.2** Each entry shows actor, action, target, amount where relevant, and a relative timestamp.
- **AC-F1.3** Feed is paginated at 25 entries with infinite scroll.
- **AC-F1.4** A user sees only activity for groups they are currently a member of.

---

## Non-functional requirements

| ID     | Requirement                                                   | How it's verified                                        |
| ------ | ------------------------------------------------------------- | -------------------------------------------------------- |
| NFR-1  | First Contentful Paint < 1.8s on simulated 4G                 | Lighthouse CI in the pipeline                            |
| NFR-2  | Main JS bundle < 350 KB gzipped                               | `rollup-plugin-visualizer` + a CI size budget            |
| NFR-3  | Usable at 390x844 with no horizontal scroll                   | Playwright viewport assertion                            |
| NFR-4  | All interactive targets at least 44x44 px                     | Component-level lint rule + manual audit                 |
| NFR-5  | WCAG 2.1 AA colour contrast                                   | `axe-core` in Playwright                                 |
| NFR-6  | Full keyboard navigability on web                             | Playwright keyboard-only journey                         |
| NFR-7  | No secrets in the client bundle beyond public Firebase config | Pre-commit secret scan                                   |
| NFR-8  | All money handled as integers; **zero** float arithmetic      | ESLint ban on `parseFloat` in money paths + review       |
| NFR-9  | Every write path covered by a Security Rules test             | `@firebase/rules-unit-testing` suite in CI               |
| NFR-10 | `packages/core` imports nothing from `react-dom` or the DOM   | Dependency-cruiser rule in CI (protects the mobile port) |
