# 07 — UI / UX Specification

## Design principle

**Design the phone screen first, then let it grow.** The web app is built at a 390×844
target and centred in a max-640px column on desktop, exactly like a phone app. This is not
a compromise for the future mobile port — it is the right shape for this product, because
expense-splitting happens at a restaurant table, not at a desk.

Every layout decision must satisfy the mobile-portability contract in
[02-architecture.md](02-architecture.md).

---

## Navigation model

Five destinations, bottom tab bar — mirrors Splitwise and maps 1:1 onto React Navigation's
`createBottomTabNavigator` later.

```
┌────────────────────────────────┐
│  Header (contextual)           │
├────────────────────────────────┤
│                                │
│  Screen content                │
│  (scrollable, flex: 1)         │
│                                │
├────────────────────────────────┤
│ 👥      🧑‍🤝‍🧑     ➕      🔔      ⚙️  │
│ Groups Friends  Add  Activity Account│
└────────────────────────────────┘
```

The centre **Add** tab is a raised FAB-style button that opens the Add Expense flow as a
modal — it is an action, not a destination.

### Route table

One file, typed params. React Router consumes it now; React Navigation consumes the same
shape in Phase 12.

| Route                     | Screen        | Tab      | Notes                          |
| ------------------------- | ------------- | -------- | ------------------------------ |
| `/login`                  | SignIn        | —        | FirebaseUI widget, no tab bar  |
| `/invite/:token`          | JoinGroup     | —        | Works logged-out, then resumes |
| `/groups`                 | GroupList     | Groups   | **Home**                       |
| `/groups/new`             | CreateGroup   | Groups   | Modal                          |
| `/groups/:gid`            | GroupDetail   | Groups   |                                |
| `/groups/:gid/settings`   | GroupSettings | Groups   |                                |
| `/groups/:gid/members`    | GroupMembers  | Groups   |                                |
| `/groups/:gid/settle`     | SettleUp      | Groups   | Modal                          |
| `/groups/:gid/balances`   | GroupBalances | Groups   | Includes simplify toggle       |
| `/expense/new`            | AddExpense    | Add      | Modal                          |
| `/expense/:gid/:eid`      | ExpenseDetail | —        |                                |
| `/expense/:gid/:eid/edit` | EditExpense   | —        | Modal                          |
| `/friends`                | FriendList    | Friends  |                                |
| `/friends/add`            | AddFriend     | Friends  | Modal                          |
| `/friends/:uid`           | FriendDetail  | Friends  |                                |
| `/activity`               | ActivityFeed  | Activity |                                |
| `/account`                | Account       | Account  |                                |
| `/account/profile`        | EditProfile   | Account  |                                |

**Modals** are full-screen sheets on mobile widths and centred dialogs ≥ 768px. On web they
are real routes so back/forward and deep links work; React Navigation models them as a
modal stack.

---

## Screen specifications

### SignIn (`/login`)

- App logo, one-line value proposition.
- FirebaseUI widget container (email / phone / Google).
- Terms + privacy links.
- **Web-only file.** See the auth quarantine in [02-architecture.md](02-architecture.md).

### GroupList (`/groups`) — home

- **Header summary card:** "Overall, you are owed $X" / "you owe $Y", one line per
  currency (AC-B2.3). Zero state: "You are all settled up".
- List of group rows: avatar/emoji by type, name, and the user's balance in that group
  rendered green (owed) / orange (owe) / grey (settled).
- Sorted by `lastActivityAt` desc.
- **Empty state** is a first-run moment, not an error: illustration + "Create a group" and
  "Add a friend" as primary actions.
- Pull-to-refresh on mobile; `onSnapshot` means it is rarely needed.

### GroupDetail (`/groups/:gid`)

- Header: group name, member avatar stack, settings icon.
- Balance strip: "You are owed $X in this group" + a **Settle up** button.
- Expense list grouped by month, newest first, infinite scroll at 25/page.
- Row: category icon, description, date, "you paid $X" / "you owe $Y", subtitle for payer.
- Settlement rows are visually distinct (different icon, muted, "Carol paid Alice $1500").
- FAB: add expense pre-scoped to this group.

### AddExpense (`/expense/new`) — the most important screen

This is where the product lives or dies. Optimise it ruthlessly for speed.

```
┌─────────────────────────────────┐
│ ✕            Add expense    Save│
├─────────────────────────────────┤
│  With you and: [ Goa Trip  ▾ ]  │
│                                 │
│      🍽   [ Dinner at Olive   ]  │
│                                 │
│           $ [ 3,000.00       ]  │  ← large, numeric keypad, autofocus
│                                 │
│  Paid by [ you ▾ ]  split       │
│           [ equally ▾ ]         │
│                                 │
│  📅 Today          🏷 Food       │
└─────────────────────────────────┘
```

Behaviour:

- Amount field autofocuses with a numeric keypad (`inputMode="decimal"`); typing is the
  first thing that happens.
- Sensible defaults: payer = you, split = equally across all group members, date = today.
  **A user should be able to add an expense in 3 taps.**
- "Paid by" opens a sheet: single payer list + a "multiple people" mode (AC-D1.4).
- "Split" opens the split sheet (below).
- Save is disabled until valid; validation errors appear inline, never as an alert.

### Split sheet

Segmented control: **Equally | Exactly | Percentages | Shares**

| Method      | Per-row control     | Live footer                             |
| ----------- | ------------------- | --------------------------------------- |
| Equally     | checkbox per member | "$1,000.00 per person (3 people)"       |
| Exactly     | amount input        | "$500.00 left to assign" — red when ≠ 0 |
| Percentages | percent input       | "100% assigned" / "3% remaining"        |
| Shares      | stepper (−/+)       | "4 shares · A pays $1,500.00"           |

- Footer is the primary feedback mechanism. Save is blocked unless it reads exactly zero
  remaining (AC-D2.2, AC-D2.3).
- Switching methods preserves participants and total (AC-D2.5).
- Amounts shown per row are computed by the **real split engine**, not a UI approximation —
  the preview must equal what gets stored, including the remainder-unit distribution.

### ExpenseDetail (`/expense/:gid/:eid`)

Full breakdown plus the discussion thread. Under ADR-11 the primary action **depends on
who you are**:

| Viewer                  | Primary action                                       |
| ----------------------- | ---------------------------------------------------- |
| Creator, or group admin | **Edit** (and Delete)                                |
| Any other member        | **Discuss** — opens the thread, focuses the composer |

- Breakdown: who paid what, each person's share, category, date, who created it and when.
- **Discussion thread**: flat, chronological, avatar + name + relative time. Composer
  pinned at the bottom.
- Comments are **not editable** (AC-D4.4) — deleting your own leaves a "comment deleted"
  tombstone so the thread doesn't silently lose a turn.
- Empty thread state does real work here: _"Something look wrong? Start a discussion —
  only Priya or a group admin can edit this expense."_ That one sentence explains the
  permission model at exactly the moment the user needs it.

> This screen carries the weight of ADR-11. If **Discuss** is hard to find, restricted
> editing reads as "the app is broken" rather than "ask them about it."

### GroupBalances (`/groups/:gid/balances`)

- Two tabs: **Balances** (every member's net) and **Suggested payments** (simplified).
- Simplify toggle with an inline explanation (AC-E3.4): "Instead of 5 payments, settle up
  in 2. Amounts owed do not change."
- Each suggested payment row has a **Settle up** action that prefills the settle screen.

### SettleUp (`/groups/:gid/settle`)

- Pick who paid whom (prefilled from context).
- Amount prefilled with the full outstanding debt; editable for partial payment (AC-E2.2).
- Optional note, date.
- Confirmation copy is explicit: **"This records a payment you have already made outside
  the app. No money will move."** This prevents the single worst possible misunderstanding.

### FriendList / FriendDetail

- Rows with avatar, name, net balance across all shared groups.
- Detail: aggregated balance, shared expenses list, "Settle up" and "Add expense".

### ActivityFeed (`/activity`)

- Merged, reverse-chronological entries, 25/page.
- Row: actor avatar, pre-rendered `summary` string, amount, relative time.
- Tapping navigates to the referenced expense or group.

### Account (`/account`)

- Profile row (avatar, name, email/phone) → EditProfile.
- Default currency, appearance (system/light/dark), notifications (disabled, "coming soon").
- **Balances look wrong?** → calls `recomputeGroupBalances`.
- Sign out, Delete account (with the balance-check guard from AC-A3.2).

---

## Design tokens

Single source of truth: `packages/core/src/theme/tokens.ts`. **Plain TS objects, no CSS.**
Web emits them as CSS custom properties at build time; RN consumes the same object in
`StyleSheet.create`. This is what keeps the two apps visually identical for free.

```ts
export const tokens = {
  color: {
    // brand
    primary: '#1CC29F', // teal — "you are owed"
    primaryDark: '#159E82',
    // semantic money colours — NEVER used for anything else
    positive: '#1CC29F', // you are owed
    negative: '#FF652F', // you owe
    neutral: '#8A8A8E', // settled up
    // surfaces
    bg: '#FFFFFF',
    bgSubtle: '#F7F7F9',
    surface: '#FFFFFF',
    border: '#E5E5EA',
    // text
    text: '#1C1C1E',
    textSecondary: '#6E6E73',
    textInverse: '#FFFFFF',
    danger: '#D93025',
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }, // 4pt grid
  radius: { sm: 6, md: 10, lg: 16, pill: 999 },
  font: {
    size: { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, xxl: 32 },
    weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
    lineHeight: { tight: 1.2, normal: 1.5 },
  },
  size: { touchTarget: 44, avatarSm: 32, avatarMd: 40, avatarLg: 64, tabBar: 56 },
  z: { base: 0, sticky: 10, overlay: 100, modal: 200, toast: 300 },
} as const;
```

Dark theme is a second token object with identical keys. **Respect the system preference;
no in-app toggle in v1** (a toggle is in the backlog).

### Colour semantics — a hard rule

`positive` / `negative` communicate money direction only. Never use the money green for a
generic success toast or the money orange for a warning; that trains the user to misread
balances at a glance. Use `primary` and `danger` for UI chrome.

Green/orange must also never be the _only_ signal (WCAG, NFR-5) — always pair with a
sign or the words "you owe" / "owes you".

---

## Component library

Built in `apps/web/src/components/`. Names are **platform-neutral** so the RN versions
are drop-in.

| Component            | Maps to (RN)            | Notes                                                       |
| -------------------- | ----------------------- | ----------------------------------------------------------- |
| `<Screen>`           | `SafeAreaView` + `View` | Handles safe-area padding                                   |
| `<Stack>` / `<Row>`  | `View` with flex        | The only layout primitives                                  |
| `<Text>`             | `Text`                  | Variant prop: `title`/`body`/`caption`/`amount`             |
| `<Pressable>`        | `Pressable`             | Enforces the 44px touch target                              |
| `<Button>`           | —                       | `primary`/`secondary`/`ghost`/`danger`, loading state       |
| `<Input>`            | `TextInput`             | Label, error, helper text                                   |
| `<AmountInput>`      | —                       | Numeric keypad, currency prefix, **outputs minor units**    |
| `<Avatar>`           | `Image`                 | Initials fallback, deterministic colour from uid            |
| `<AvatarStack>`      | —                       | Overlapping avatars with "+N"                               |
| `<ListRow>`          | —                       | Leading/title/subtitle/trailing/chevron                     |
| `<List>`             | `FlatList`              | **All lists go through this** so it can become FlatList     |
| `<Sheet>`            | modal stack             | Bottom sheet on mobile, dialog on desktop                   |
| `<SegmentedControl>` | —                       | Split-method picker                                         |
| `<Chip>`             | —                       | Category/filter                                             |
| `<EmptyState>`       | —                       | Icon + title + body + action                                |
| `<Skeleton>`         | —                       | Loading placeholders — **never** a spinner for list content |
| `<Money>`            | —                       | Formats minor units; applies positive/negative colour       |
| `<CurrencyPicker>`   | —                       | **~180 ISO currencies** — searchable, common ones pinned    |
| `<CommentThread>`    | —                       | Flat chronological thread + composer (ADR-11)               |
| `<Toast>`            | —                       | Transient confirmation                                      |

`<CurrencyPicker>` deserves a note: a raw 180-item dropdown is unusable. It must have a
**search field, `COMMON_CURRENCIES` pinned to the top** (USD, EUR, GBP, INR, CAD, AUD, JPY,
CNY), and each row showing code + name + symbol. It appears in group creation (where the
choice is **permanent**, so say so inline) and in profile settings.

`<Money>` is worth calling out: **no screen formats currency by hand.** One component owns
the minor-units→string conversion and the colour semantics, so a formatting bug is fixed
in one place.

---

## Interaction rules

1. **Optimistic UI on every write.** Show the change immediately, reconcile from the
   server snapshot. Firestore's local cache makes this nearly free.
2. **Skeletons, not spinners,** for content that has a known shape.
3. **Inline errors, not alerts.** Alerts only for destructive confirmation.
4. **Every destructive action is confirmable and, where possible, undoable** — deleting an
   expense shows a toast with Undo for 5 seconds before the write commits.
5. **Never block the UI on a network write.** Firestore queues offline writes; trust it.
6. **Empty states always offer the next action.** No dead ends.
7. **Amounts are always right-aligned** in lists and use tabular figures
   (`font-variant-numeric: tabular-nums`) so columns line up.

---

## Accessibility (NFR-4/5/6)

- Contrast ≥ 4.5:1 for body text — **verify `#1CC29F` on white**; at ~2.3:1 it fails as
  text and must be darkened to `primaryDark` (`#159E82`) or used only for large text and
  non-text elements. Audit in Phase 09.
- Every interactive element has an accessible name (`aria-label` → `accessibilityLabel`).
- Full keyboard navigation with visible focus rings on web.
- Respect `prefers-reduced-motion`.
- Announce balance changes to screen readers via a polite live region.
- Minimum 44×44 px targets, enforced by `<Pressable>`.

---

## Responsive behaviour

| Width      | Layout                                                           |
| ---------- | ---------------------------------------------------------------- |
| < 640px    | Full-bleed phone layout, bottom tab bar, sheets full-screen      |
| 640–1024px | Centred 640px column, bottom tab bar retained, sheets as dialogs |
| > 1024px   | Centred column, **optional** left sidebar nav replacing tabs     |

The desktop sidebar is a **progressive enhancement layered on top**, never a separate
layout tree — the phone layout is always the base case. Deferred to Phase 09; the tab bar
is perfectly acceptable on desktop until then.
