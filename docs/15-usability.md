# 15 — Usability

> "Intuitive" is not a design style — it's a measurable property. This document turns it
> into specific rules and a test protocol, so it can be verified rather than asserted.

---

## The core insight

**The entire product is one 15-second task: add an expense.** Everything else — groups,
friends, balances, the activity feed — is scaffolding around that moment, which usually
happens standing at a restaurant table, one-handed, slightly drunk, with three people
waiting.

Optimise for that. If adding an expense is fast and unambiguous, the app is intuitive. If
it isn't, no amount of polish elsewhere will save it.

---

## Eight rules

### 1. Three taps to log an expense

From app open to saved, with default settings: **tap Add → type amount → tap Save.**
Everything else must be optional and pre-filled with the right default.

Defaults that make this work:

- Payer = you (true ~80% of the time)
- Split = equally across all group members (true ~85% of the time)
- Date = today
- Group = the one you were just looking at
- Currency = the group's

**Test:** time it. If the median is over 15 seconds, something is wrong.

### 2. The amount field is the hero

Autofocus it. Numeric keypad. Largest type on the screen. The user came here to type a
number — don't make them find it.

### 3. Never make the user do arithmetic

The app exists to do the maths. So:

- Every split screen shows a live **"$X left to assign"**, never just a validation error
  on save
- Show the resolved per-person amount next to every percentage and every share
- Show "you owe" / "you are owed" — never a raw signed number the user has to interpret
- On settle-up, prefill the exact outstanding amount

### 4. Use plain words, from the user's perspective

| ❌ Don't                   | ✅ Do                            |
| -------------------------- | -------------------------------- |
| "Net balance: −1500"       | "You owe Priya $1,500"           |
| "Settlement recorded"      | "Marked as paid"                 |
| "Split method: exact"      | "Enter exact amounts"            |
| "Participant"              | "Who's involved"                 |
| "Error: PERMISSION_DENIED" | "Only group members can do that" |

Always frame from _this_ user's point of view. "You owe" and "owes you", never "debtor".

### 5. Make the invisible visible

The two things users get most confused about in expense apps:

- **"Why does it say I owe $340 when I paid?"** → the balance strip must be tappable and
  lead to a breakdown showing which expenses produced it.
- **"Why am I paying Carol? I borrowed from Bob."** → debt simplification **must** carry an
  inline explanation. This is the single largest source of confusion this feature creates,
  and one sentence prevents it.

### 6. Forgiving, not interrogating

- Destructive actions get an **Undo toast**, not a confirmation dialog. Undo respects the
  user's time; a dialog taxes everyone to protect against a rare mistake.
- Confirmation dialogs only for genuinely irreversible things (delete group, delete account).
- Validation errors appear **inline and live**, next to the field, never as an alert on save.
- Never lose typed input. If a save fails, the form keeps its contents.

### 7. Never lie about money

- Settle-up says, every time: **"This records a payment you already made outside the app.
  No money will move."** The worst possible outcome for this product is a user believing
  they paid someone when they didn't.
- Never sum different currencies into one number.
- Never round for display in a way that disagrees with the stored value.

### 8. One-handed, thumb-first

- Primary actions in the bottom third of the screen.
- Nothing critical in the top corners.
- Minimum 44×44 targets, with 8px between adjacent ones.
- Destructive actions are never adjacent to common ones.

---

## First-run experience

A new user's first two minutes decide whether they come back.

1. **Sign in** — three obvious options, no forced choice between them
2. **Land somewhere useful**, never an empty screen with no direction. The empty state
   offers exactly two actions: _Create a group_ / _Add a friend_
3. **Guided first group** — name, add one person, done
4. **Guided first expense** — with a hint on the amount field
5. **See the payoff** — the balance appears, and the loop is understood

Do **not** build a 5-screen carousel tutorial. Nobody reads them. Teach through defaults
and empty states instead.

---

## Error messages

Every error answers three questions: **what happened, why, and what now.**

| Situation           | Message                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Splits don't sum    | "$200 still needs to be assigned." + the remaining amount inline                                   |
| Leave group blocked | "Settle your $450 balance with Rohan before leaving." + a Settle up button                         |
| Invite expired      | "This invite expired on 12 March. Ask Priya for a new one."                                        |
| Offline             | "You're offline. Your changes will sync when you reconnect." _(they will — Firestore queues them)_ |
| Friend not found    | "No account for that number yet — send them an invite instead." + the action                       |

Never surface a raw Firebase error code. Never say "Something went wrong."

---

## Testing that it's actually intuitive (Phase 09)

Opinions don't settle this. Five users does.

### Protocol

Recruit **5 people who have never seen the app** — Nielsen's finding that 5 users surface
~85% of usability problems has held up well in practice. Ideal recruits are people who
currently split costs on WhatsApp or in their head.

Give them tasks, say nothing, and **watch without helping**:

1. "You and two friends just split a $3,000 dinner. You paid. Record it."
2. "How much does Priya owe you?"
3. "Priya just paid you back $500. Record it."
4. "Split a $1,200 taxi where you pay half and the others split the rest."
5. "You're going on a trip with 4 people. Set that up."

### Measure

| Metric                                             | Target                            |
| -------------------------------------------------- | --------------------------------- |
| Task 1 completion, unassisted                      | 5/5                               |
| Task 1 time                                        | < 30s first attempt, < 15s second |
| Task 2 completion                                  | 5/5, under 10s                    |
| Task 4 (exact split) completion                    | 4/5                               |
| Times a user asks "what does this mean?"           | 0 on the core loop                |
| Users who understand the balance sign without help | 5/5                               |

### Watch for these specific failures

- Hesitating on the amount field → it isn't prominent enough
- Hunting for how to change the split → the affordance is too subtle
- Misreading who owes whom → sign/colour semantics are failing
- Trying to _send money_ at settle-up → the copy isn't clear enough
- Not finding their groups → navigation labels are wrong

**Fix anything 2+ of 5 users hit.** That's not an outlier, it's a design defect.

---

## Ads and usability

Ads are where "intuitive" usually dies. Binding constraints, from
[14-monetization-ads.md](14-monetization-ads.md) §5:

- 🔴 **Zero ads** in Add Expense, the split sheet, or Settle Up
- 🔴 **Reserve ad height in layout** — no content shifting when an ad loads
- 🔴 **48dp minimum** between any ad and any button
- 🔴 Never block an action on an ad load
- 🟡 Re-run the §"Testing" protocol **with ads enabled**. If task times regress by more
  than 20%, the placement is wrong — move the ad, don't accept the regression.

---

## Ongoing measurement (post-launch)

Firebase Analytics events worth having from day one:

| Event                                           | Tells you                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `expense_add_started` → `expense_add_completed` | **Funnel drop-off — the single most important metric in the app** |
| `time_to_add_expense`                           | Whether rule 1 is holding in the wild                             |
| `split_method_selected`                         | Whether the four methods are actually used, or just equal         |
| `balance_breakdown_opened`                      | How often balances confuse people                                 |
| `simplify_explanation_viewed`                   | Whether the explanation is doing its job                          |
| `settle_up_completed`                           | Whether the loop actually closes                                  |

If `expense_add_started` → `expense_add_completed` is below ~90%, stop building features
and fix that screen.
