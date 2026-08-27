# 00 — Project Overview

## Problem

A group of people share costs (a trip, a flat, a couple's expenses). Someone pays for
something on behalf of others. Over time everyone loses track of who owes whom. The app
records every shared expense, keeps a running net balance per person, and tells each
person the minimum set of payments needed to square up.

## Core value loop

```
Add expense  →  balances update for everyone  →  see "you owe / you are owed"
     ↑                                                        │
     └──────────────  settle up (record payment)  ←───────────┘
```

Everything else in the product exists to serve that loop.

## Target user

Individuals splitting costs with friends, flatmates, or a partner. Small groups (2–15
people). Not accounting software, not a payments processor.

## MVP scope (agreed)

| #   | Capability              | Notes                                                          |
| --- | ----------------------- | -------------------------------------------------------------- |
| 1   | Sign up / sign in       | FirebaseUI widget: email+password, phone OTP, Google           |
| 2   | User profile            | Display name, avatar, default currency                         |
| 3   | Friends                 | Add by email/phone, see net balance per friend                 |
| 4   | Groups                  | Create, rename, add/remove members, leave, delete              |
| 5   | Expenses                | Add/edit/delete, description, amount, date, category, payer(s) |
| 6   | Split methods           | Equal, exact amounts, percentages, shares                      |
| 7   | Balances                | Per-group, per-friend, and one overall summary                 |
| 8   | Settle up               | Record a payment, which zeroes out (part of) a debt            |
| 9   | **Debt simplification** | Minimise number of payments to settle a group                  |
| 10  | Activity feed           | Chronological log of what changed and who did it               |
| 11  | Comments                | Threaded discussion on a single expense                        |

## Explicit non-goals for v1

These are **deliberately excluded** so the MVP can actually ship. Each is tracked in the
backlog, not in the phase checklists.

- ❌ **Real money movement.** No UPI/Stripe/PayPal. "Settle up" records that a payment
  happened offline; it does not move funds. This keeps us out of regulated territory.
- ❌ Receipt photo upload / OCR (needs Firebase Storage + rules + thumbnailing).
- ❌ Recurring expenses and scheduled reminders (needs scheduled Functions).
- ❌ Push notifications (needs FCM + per-platform setup).
- ❌ Multi-currency conversion. **One currency per group**, chosen at creation. A user's
  overall summary lists each currency separately rather than converting. No FX rates.
- ❌ Offline-first write queue. Firestore's built-in local cache is enabled and gives us
  read-offline plus optimistic writes, but we do not build conflict resolution.
- ❌ Export to CSV/PDF, spending charts, budgets.
- ❌ Web push, email digests, dark mode toggle (system preference is respected instead).

## Success criteria for "v1 done"

1. Two real users on two real devices can sign up, join a group, add expenses with all
   four split methods, and see identical balances.
2. Balances are **never** wrong by even one cent — verified by a property-based test
   asserting that the sum of every member's net balance in a group is exactly zero.
3. A logged-out or non-member user cannot read or write any group data — verified by an
   automated Security Rules test suite, not by manual clicking.
4. The web app is usable one-handed on a 390×844 phone screen without zooming.
5. Deployed to a public URL with CI running tests on every push.

## Scale assumptions

These shape the data model. If any is badly wrong, revisit [03-data-model.md](03-data-model.md).

- ≤ 50 members per group
- ≤ 10,000 expenses per group
- ≤ 500 groups per user
- Reads dominate writes roughly 20:1
- No requirement for cross-group analytical queries
