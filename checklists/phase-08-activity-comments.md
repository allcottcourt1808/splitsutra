# Phase 08 — Activity Feed & Comments

**Est. 1.5 days.** Depends on 06.
Covers **Epic F** and **D4**.

> **Status 2026-08-31 — shipped; the boxes below lag the code.** The Activity tab landed in
> PR #31, and comments are implemented once in `packages/core/src/repositories/commentRepo.ts`
> (Article VI — `expenseRepo`'s `watchExpenseComments` / `addExpenseComment` /
> `deleteExpenseComment` are aliases onto it, holding no Firestore call of their own).
>
> Two open items, one of them the user's call:
>
> - 🟡 **`watchComments` is unbounded** — `orderBy('createdAt', 'asc')` with no `limit()`, so a
>   long thread is re-delivered in full on every new comment, oldest-first. phase-10 §5b.
> - ❓ **Comment tombstones vs `allow update: if false`** is still undecided. Rules deny `update`
>   outright today (AC-D4.4, threat T12: an editable comment in a dispute thread destroys the
>   record of what was said). Whether a _deleted_ comment leaves a visible tombstone is the part
>   nobody has ruled on.

---

## 1. Activity writing (Cloud Functions)

- [ ] 🔴 `writeActivity(gid, event)` helper shared by every trigger
- [ ] 🔴 Event types: `expense.created/updated/deleted`, `settlement.created/deleted`,
      `member.joined/left/removed`, `group.created/updated`
- [ ] 🔴 **Pre-render the `summary` string server-side** (e.g. `Neethu added "Dinner"`) so
      the feed needs no joins to display
- [ ] 🔴 Include `actorUid`, `actorName`, `targetId`, `amountMinor`, `currency`
- [ ] 🔴 Rules: `activity` is **read-only to clients, no writes at all** (threat T8)
- [ ] 🟡 For `expense.updated`, describe **what** changed ("changed the amount to $500"),
      not just that something did (AC-D3.4)

## 2. Activity feed screen

- [ ] 🟡 `/activity` — merged across the user's groups, reverse-chronological
- [ ] 🟡 25 per page, infinite scroll (AC-F1.3)
- [ ] 🟡 Row: actor avatar, summary, amount, relative timestamp
- [ ] 🟡 Tapping navigates to the referenced expense or group
- [ ] 🟡 Index: `activity` → `createdAt` DESC
- [ ] 🟡 Only groups the user is currently in (AC-F1.4)
- [ ] 🟢 Per-group activity tab inside group detail
- [ ] 🟢 Empty state

### ⚠️ The N-query problem

The naive implementation runs one query **per group** and merges client-side. For a user in
many groups this is expensive and the pagination is awkward (merging N paginated streams).

- [ ] 🟡 Build the naive version first
- [ ] 🟡 **Measure it** in Phase 10 with a realistic group count
- [ ] 🟢 Only if it's actually slow: add a per-user `users/{uid}/feed` collection written by
      the same Function that writes group activity. Trades write amplification for one
      cheap read. **Do not build this pre-emptively.**

## 3. Discussion threads 🔴 _Load-bearing under ADR-11_

> Since Phase 06 restricted editing to the creator or an admin, **this is how everyone else
> raises a correction.** If threads are hard to find or feel like an afterthought,
> restricted editing reads as "the app is broken". Treat this as a primary feature, not a
> comment box.

- [ ] 🔴 `commentRepo.ts`: `addComment`, `deleteComment`, `watchComments`
- [ ] 🔴 Rules: any member can create with `uid == auth.uid`, text 1–500 chars
- [ ] 🔴 Rules: **delete only your own** (AC-D4.3)
- [ ] 🔴 ⚠️ **Rules: update always denied** (AC-D4.4, threat T12). An editable comment in a
      dispute thread destroys the record of what was actually said.
- [ ] 🔴 `<CommentThread>` on expense detail — **flat, chronological**, no nested replies
      (AC-D4.5)
- [ ] 🔴 **Discuss** is a primary action for non-creators; tapping it focuses the composer
- [ ] 🔴 Empty-thread copy explains the permission model at the moment it's needed
- [ ] 🟡 Author name, avatar, relative timestamp (AC-D4.2)
- [ ] 🟡 Composer with optimistic append
- [ ] 🟡 Deleting your own comment leaves a **"comment deleted" tombstone** so the thread
      doesn't silently lose a turn
- [ ] 🟡 `onCommentWritten` maintains `commentCount` and `lastCommentAt` on the parent
      expense (AC-D4.7) — keeps list views free of extra reads
- [ ] 🟡 Comment count on the expense row (AC-D4.6)
- [ ] 🟢 @mentions — backlogged; pairs with push notifications

## 4. Shared utilities

- [ ] 🟡 `formatRelativeTime()` in `core/src/utils/` — "2h ago", "Yesterday", "12 Mar".
      **Must work on RN** (avoid DOM-only APIs)
- [ ] 🟢 Group feed entries by day with date headers

## 5. Tests

- [ ] 🔴 Rules: client cannot write `activity` (T8)
- [ ] 🔴 Rules: user cannot delete someone else's comment
- [ ] 🔴 Rules: positive — a member can post and delete their own comment
- [ ] 🟡 Integration: each trigger writes exactly one activity entry (no duplicates on retry)
- [ ] 🟡 Unit: `formatRelativeTime` boundaries (just now / 1h / yesterday / last year)

---

## Exit criteria

- [ ] Every mutating action produces exactly one accurate activity entry
- [ ] Feed paginates smoothly and links to the right target
- [ ] Comments post, display, and delete under the right permissions
- [ ] Non-members see no activity from groups they aren't in
- [ ] `pnpm verify` green
