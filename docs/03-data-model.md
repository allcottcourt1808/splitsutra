# 03 — Firestore Data Model

## Guiding decisions

**D1. The ledger is the truth; balances are a cache.**
`expenses` + `settlements` are the immutable-ish source of truth. Every `balance` field
is a materialized view maintained by Cloud Functions and rebuildable from scratch at any
time. If a balance is ever wrong, we recompute rather than patch.

**D2. A 1:1 friend expense is just a 2-person group.**
Expense splitters normally support expenses between two friends with no group. Rather than a second code
path, those live in an implicit group with `type: 'friend'` and `isImplicit: true`, hidden
from the group list. **One expense pipeline, one set of rules, one balance engine.** This
is the single highest-leverage simplification in the model.

**D3. Money is always an integer in minor units.**
`amountMinor: 12550` means $125.50. Field names always end in `Minor` so a float can
never sneak in unnoticed. See [04-split-engine.md](04-split-engine.md).

**D4. Denormalize aggressively for reads, and accept fan-out cost on writes.**
Reads outnumber writes ~20:1. Member display names and avatars are copied into member
docs so rendering a group needs one query, not N user lookups.

**D5. Soft delete only.** Nothing is ever hard-deleted from the ledger. `deletedAt` is set
and balances are reversed, preserving the audit trail.

**D6. All ISO 4217 currencies; one per group.** The currency set is the full ISO table
(~180). A group fixes its currency at creation. No conversion in v1 — see the forward
design at the end of this document.

**D7. Expenses are edited by their creator or a group admin only** (ADR-11). Everyone else
discusses them in a thread. This makes the comment subcollection load-bearing rather than
decorative.

---

## Collection map

```
users/{uid}
  └── friends/{friendUid}

groups/{groupId}
  ├── members/{uid}
  ├── expenses/{expenseId}
  │     └── comments/{commentId}
  ├── settlements/{settlementId}
  └── activity/{activityId}

invites/{inviteId}
usernames/{normalizedKey}          # lookup index for friend search
```

---

## `users/{uid}`

The user's own profile. Readable only by the owner. Other users see the **public
projection** in `usernames/` and in group member docs.

```ts
{
  uid: string; // == document ID == auth uid
  displayName: string; // 1..50
  email: string | null;
  phoneNumber: string | null; // E.164, e.g. "+919876543210"
  photoURL: string | null;
  defaultCurrency: CurrencyCode; // full ISO 4217; defaults to 'USD'
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null; // anonymised account tombstone
}
```

## `usernames/{normalizedKey}`

Friend lookup index. Doc ID is a normalized, **hashed** key so the collection cannot be
enumerated to harvest emails and phone numbers.

- Key: `sha256(lowercase(email))` or `sha256(e164(phone))`, hex.
- Written **only** by a Cloud Function on profile create/update.
- Rules: `get` allowed for signed-in users; `list` **denied** (this is the critical part —
  it blocks enumeration).

```ts
{
  uid: string;
  displayName: string; // public projection only
  photoURL: string | null;
}
```

> Lookup is `get(hash(input))`, so a client can only resolve a contact it already knows.
> A `list` would let anyone dump every user.

## `users/{uid}/friends/{friendUid}`

```ts
{
  friendUid: string;
  displayName: string; // denormalized snapshot
  photoURL: string | null;
  implicitGroupId: string; // the hidden 2-person group for 1:1 expenses
  balanceMinor: Record<CurrencyCode, number>; // net across ALL shared groups; + = they owe you
  updatedAt: Timestamp;
}
```

Written by Cloud Functions only. Always created reciprocally on both users.

---

## `groups/{groupId}`

```ts
{
  id: string;
  name: string;                    // 1..60
  type: 'trip' | 'home' | 'couple' | 'other' | 'friend';
  isImplicit: boolean;             // true = hidden 1:1 friend group (D2)
  photoURL: string | null;
  currency: CurrencyCode;          // IMMUTABLE after creation
  memberIds: string[];             // denormalized; drives the "my groups" query
  memberCount: number;
  simplifyDebts: boolean;          // new groups get true (ADR-12); no schema default
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;            // bumped on any activity; drives sort order
  lastActivityAt: Timestamp;
  deletedAt: Timestamp | null;
}
```

`memberIds` exists so `where('memberIds', 'array-contains', uid)` can list a user's
groups in one query. **Firestore caps `array-contains` arrays at practical sizes** — with
a 50-member limit this is safe.

## `groups/{groupId}/members/{uid}`

```ts
{
  uid: string;
  role: 'admin' | 'member';
  displayName: string; // denormalized snapshot
  photoURL: string | null;
  balanceMinor: number; // net in the GROUP currency. + = owed to them
  joinedAt: Timestamp;
  leftAt: Timestamp | null;
}
```

`balanceMinor` is **Function-write-only**. Rules explicitly reject any client write to it.

> **Invariant (AC-E1.3):** across all member docs in a group,
> `sum(balanceMinor) === 0`, exactly. This is the primary correctness check of the whole
> system and it is asserted in tests and in a nightly audit job.

Membership also doubles as the authorization primitive: rules check
`exists(/groups/$(gid)/members/$(uid))`.

---

## `groups/{groupId}/expenses/{expenseId}`

```ts
{
  id: string;
  groupId: string;
  description: string;             // 1..100
  amountMinor: number;             // integer > 0, group currency
  currency: CurrencyCode;          // must equal group currency
  category: ExpenseCategory;       // 'general' | 'food' | 'transport' | ...
  date: Timestamp;                 // user-chosen date of the expense
  paidBy: Array<{ uid: string; amountMinor: number }>;   // supports multiple payers
  splitMethod: 'equal' | 'exact' | 'percent' | 'shares';
  splits: Array<{
    uid: string;
    amountMinor: number;           // resolved owed amount — always the truth
    rawValue: number | null;       // as entered: percent bps, or share count. For re-editing
  }>;
  participantIds: string[];        // denormalized == splits.map(s => s.uid)
  createdBy: string;
  createdAt: Timestamp;
  updatedBy: string | null;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null;     // soft delete
}
```

### Validation invariants (enforced in 3 places: client, Rules, Function)

1. `amountMinor` is an integer and `> 0`
2. `sum(paidBy[].amountMinor) === amountMinor`
3. `sum(splits[].amountMinor) === amountMinor`
4. every `splits[].uid` and `paidBy[].uid` is a current group member
5. `uid` values within `splits` are unique; same within `paidBy`
6. `currency === group.currency`
7. `participantIds` matches `splits[].uid` exactly

Rules 2 and 3 are what guarantee the zero-sum invariant. **Do not skip them in Rules
just because the client checks them** — a hostile client is the threat model.

### Why `rawValue` exists

For a percentage split, `amountMinor` is the resolved value but `rawValue` (in basis
points, so 33.33% = 3333) lets the edit screen restore exactly what the user typed. Without
it, reopening a percentage split shows meaningless recomputed percentages.

## `groups/{groupId}/expenses/{expenseId}/comments/{commentId}`

The discussion thread on an expense. **Load-bearing under ADR-11** — since non-creators
can't edit an expense, this is how they raise "wasn't this $40?".

```ts
{
  id: string;
  uid: string;
  displayName: string; // denormalized snapshot
  photoURL: string | null;
  text: string; // 1..500
  createdAt: Timestamp;
  deletedAt: Timestamp | null;
}
```

**Flat and chronological — one thread per expense, no nested replies.** A 2–15 person group
discussing a single restaurant bill does not need a reply tree; threading adds structure
and ambiguity for no benefit at this scale.

Denormalized counters on the parent expense keep the list view cheap:

```ts
// on groups/{groupId}/expenses/{expenseId}
commentCount: number; // maintained by onCommentWritten
lastCommentAt: Timestamp | null; // drives an "active discussion" indicator
```

Any group member may post. A user may delete only their own comment. Nobody may edit a
comment — an edited comment in a dispute thread destroys the record of what was said.

---

## `groups/{groupId}/settlements/{settlementId}`

A recorded offline payment. **Not** a real money transfer.

```ts
{
  id: string;
  groupId: string;
  fromUid: string; // the payer
  toUid: string; // the receiver
  amountMinor: number; // integer > 0
  currency: CurrencyCode;
  date: Timestamp;
  note: string | null; // 0..200
  createdBy: string;
  createdAt: Timestamp;
  deletedAt: Timestamp | null;
}
```

Invariants: `fromUid !== toUid`; both are current members; `amountMinor > 0`.

**Balance effect:** `from.balanceMinor += amount`, `to.balanceMinor -= amount`.
(Paying down what you owe moves your negative balance toward zero.)

## `groups/{groupId}/activity/{activityId}`

Append-only. Written by Functions only.

```ts
{
  id: string;
  type: 'expense.created' |
    'expense.updated' |
    'expense.deleted' |
    'settlement.created' |
    'settlement.deleted' |
    'member.joined' |
    'member.left' |
    'member.removed' |
    'group.created' |
    'group.updated';
  actorUid: string;
  actorName: string;
  targetId: string | null;
  summary: string; // pre-rendered, e.g. "Neethu added \"Dinner\""
  amountMinor: number | null;
  currency: CurrencyCode | null;
  createdAt: Timestamp;
}
```

Pre-rendering `summary` server-side means the feed needs no joins to display.

## `friendRequests/{requestId}`

```ts
{
  id: string; // equals the document ID: `${fromUid}__${toUid}`
  fromUid: string;
  fromName: string; // snapshot at send time (D4)
  fromPhotoURL: string | null;
  toUid: string;
  toName: string;
  toPhotoURL: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  implicitGroupId: string | null; // set by the acceptance
  createdAt: Timestamp;
  updatedAt: Timestamp;
  respondedAt: Timestamp | null; // null exactly while pending
}
```

The consent step in front of a friendship (AC-B1.4). Function-written; both parties may read.

**The document ID is derived, not random.** A duplicate request is impossible by construction,
and both "have I asked them?" and "have they asked me?" are a `get` of a known path rather than
a query — which is what makes the mutual auto-accept free and race-free. The cost is that a pair
keeps only its latest state rather than a history; this is a consent record, not a ledger.

**Both names are denormalized**, not just the sender's. Rules allow a `users/{uid}` read only
where `isSelf(uid)`, so neither party can read the other's profile — an inbox row carrying only
`fromUid` would be a request from nobody.

There is still no `notifications` collection: a pending request **is** the in-app notification
(AC-B1.10). It is authoritative rather than a copy that can drift, and it clears itself on every
device the moment it is answered.

## `invites/{inviteId}`

```ts
{
  id: string;
  token: string; // 128-bit random, hex
  groupId: string;
  groupName: string; // shown on the join screen before joining
  createdBy: string;
  createdByName: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  acceptedBy: string | null;
  expiresAt: Timestamp; // createdAt + 14 days
  createdAt: Timestamp;
}
```

Rules: no client reads at all. The join screen and the redemption both go through the
`redeemInvite` **callable Function**, which is the only thing that can add a member.

---

## Required composite indexes

Add to `firestore.indexes.json`. Firestore will also print the exact index URL at runtime
when a query needs one.

| Collection                    | Fields                                             | Serves                                |
| ----------------------------- | -------------------------------------------------- | ------------------------------------- |
| `groups`                      | `memberIds` ARRAY, `lastActivityAt` DESC           | "My groups", sorted by recency        |
| `expenses` (collection group) | `participantIds` ARRAY, `date` DESC                | "All my expenses" across groups       |
| `expenses`                    | `deletedAt` ASC, `date` DESC                       | Group expense list, excluding deleted |
| `expenses` (collection group) | `groupId` ASC, `participantIds` ARRAY, `date` DESC | Friend detail: shared expenses        |
| `activity`                    | `createdAt` DESC                                   | Group feed pagination                 |
| `friendRequests`              | `toUid` ASC, `status` ASC, `createdAt` DESC        | Incoming requests (the inbox badge)   |
| `friendRequests`              | `fromUid` ASC, `status` ASC, `createdAt` DESC      | Outgoing requests, for withdrawing    |
| `settlements`                 | `deletedAt` ASC, `date` DESC                       | Settlement history                    |

> **Collection-group queries need collection-group indexes and their own Security Rules
> block** (`match /{path=**}/expenses/{id}`). This is a classic gotcha: rules written only
> for the nested path will **not** apply to collection-group queries. Covered in
> [05-security-rules.md](05-security-rules.md).

---

## Query patterns

| Screen          | Query                                                                                                                            | Cost                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Groups list     | `groups where memberIds array-contains uid orderBy lastActivityAt desc limit 50`                                                 | 1 query                  |
| Overall balance | Sum `balanceMinor` from the groups already fetched                                                                               | 0 extra reads            |
| Group detail    | `members` (all) + `expenses where deletedAt == null orderBy date desc limit 25`                                                  | 2 queries                |
| Expense detail  | 1 doc + `comments orderBy createdAt asc`                                                                                         | 2 queries                |
| Friends list    | `users/{uid}/friends orderBy updatedAt desc`                                                                                     | 1 query                  |
| Friend detail   | collection-group `expenses where participantIds array-contains-any [me, them]`, filtered client-side to expenses containing both | 1 query + client filter  |
| Activity feed   | `activity orderBy createdAt desc limit 25` per group, merged client-side                                                         | N queries — **see note** |

> **Note on the activity feed.** Fanning out per-group is N queries for N groups. If a user
> has many groups this gets expensive. **Deferred optimisation:** a per-user
> `users/{uid}/feed` collection written by the same Function that writes group activity.
> Build the simple version first; measure in Phase 10 before adding the fan-out.

---

## Forward design: multi-currency (v2, not built)

Recorded now so v2 is an **additive change rather than a migration**, and so v1 doesn't
accidentally foreclose it.

### The one rule that matters

> **An expense stores the FX rate that applied on its own date. Balances are never
> converted using today's rate.**

Converting on read means last month's settled group silently un-settles when the exchange
rate moves. That is the defining bug of naive multi-currency implementations, and it is
very hard to explain to a user.

### Additive schema changes

```ts
// groups/{groupId}
baseCurrency: CurrencyCode; // group's reporting currency (v1: == currency)
allowMixedCurrency: boolean; // v1: always false

// groups/{groupId}/expenses/{expenseId}
currency: CurrencyCode; // already exists — the currency actually paid in
fxRateToBase: number | null; // rate on THIS expense's date. v1: null (same currency)
amountInBaseMinor: number | null; // precomputed at write time. v1: null
```

Every new field is nullable, so v1 documents remain valid without a backfill.

### Consequences to respect in v1

- **Never sum across currencies** in the UI — list each on its own line. A v1 that
  incorrectly adds USD to EUR trains users to expect a number that v2 would have to change.
- Keep `amountMinor` and `currency` adjacent in every type. v2 adds a third field to that
  cluster.
- The rounding rules in [04-split-engine.md](04-split-engine.md) apply **after**
  conversion, not before, or the zero-sum invariant breaks.
- Rate source, refresh cadence, and staleness handling are v2 problems. Don't pick a
  provider now.

---

## What is deliberately NOT modelled

- No `balances/{pairId}` pairwise-debt collection. Net-per-member plus the simplification
  algorithm produces the same answer with far fewer documents to keep consistent.
- No FX rate storage or conversion in v1 — the forward design above is deliberately unbuilt.
- No `receipts` / Storage paths (deferred — see [17-backlog.md](17-backlog.md)).
- No `notifications` collection (deferred with push). In-app notification of a friend request
  is the pending `friendRequests` document itself — see that section.
