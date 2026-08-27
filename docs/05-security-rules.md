# 05 — Firestore Security Rules

## Threat model

Assume a hostile client. The Firebase web config is public, the Firestore REST API is
public, and anyone can craft arbitrary writes with a valid ID token. **Client-side
validation is a UX nicety; Security Rules are the actual security boundary.**

Concretely, defend against a signed-in user who:

| #   | Attack                                                      | Defence                                                                 |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| T1  | Reads a group they're not in                                | Membership check via `exists()` on the member doc                       |
| T2  | Writes `balanceMinor` to zero out their own debt            | `balanceMinor` is Function-write-only; all client writes to it rejected |
| T3  | Creates an expense where splits don't sum to the total      | Sum validated **in rules**, not just the client                         |
| T4  | Adds themselves to someone else's group                     | `members` create is Function-only; joins go through `redeemInvite`      |
| T5  | Enumerates `usernames/` to harvest emails and phone numbers | `list` denied; only `get` by hashed key                                 |
| T6  | Assigns a split to a non-member                             | Every split uid checked against group membership                        |
| T7  | Backdates or forges `createdBy` / `createdAt`               | Pinned to `request.auth.uid` and `request.time`                         |
| T8  | Edits the activity feed to hide what they did               | `activity` is Function-write-only, read-only to clients                 |
| T9  | Reaches nested data via a collection-group query            | Separate `{path=**}` rule blocks (see below)                            |
| T10 | Changes a group's currency after expenses exist             | `currency` immutable in rules                                           |
| T11 | Edits someone else's expense to rewrite what they paid      | Update requires `createdBy == uid` or admin (ADR-11)                    |
| T12 | Edits a comment after the fact to alter a dispute record    | Comment update denied outright                                          |

---

## The collection-group trap

**This is the most commonly missed rule in Firestore apps and it is a real data leak.**

A rule written at `/groups/{gid}/expenses/{eid}` does **not** govern a collection-group
query like `collectionGroup('expenses')`. Collection-group queries are matched by
`/{path=**}/expenses/{eid}` instead. If you only write the nested rule, the collection
group query is denied — but if you write a permissive `{path=**}` rule to "fix" it, you can
accidentally expose every expense in the database.

Since the friend-detail screen and "all my expenses" need collection-group queries
([03-data-model.md](03-data-model.md)), the rule must be written deliberately:

```
match /{path=**}/expenses/{expenseId} {
  // Only expenses this user actually participates in. The query MUST also carry
  // an array-contains on participantIds or it will be rejected wholesale.
  allow read: if isSignedIn()
              && request.auth.uid in resource.data.participantIds;
  allow write: if false;   // writes only via the nested path rule
}
```

> Firestore evaluates rules against each **candidate document**, and rejects a _query_
> unless the rules can be satisfied by the query's constraints. So the client query must
> include `where('participantIds', 'array-contains', uid)` — otherwise the whole query
> fails. Bake that into the repository function so a screen can't get it wrong.

---

## Helper functions

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }
    function isSelf(uid) {
      return isSignedIn() && request.auth.uid == uid;
    }
    function isMember(groupId) {
      return isSignedIn() &&
        exists(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid));
    }
    function isAdmin(groupId) {
      return isSignedIn() &&
        get(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid))
          .data.role == 'admin';
    }
    function groupCurrency(groupId) {
      return get(/databases/$(database)/documents/groups/$(groupId)).data.currency;
    }
    // fields that changed between the existing and incoming doc
    function changed(fields) {
      return request.resource.data.diff(resource.data).affectedKeys().hasAny(fields);
    }
    function isPositiveInt(v) {
      return v is int && v > 0 && v <= 1000000000;
    }
    // Q4: ~180 ISO 4217 codes cannot be enumerated in a rule. Shallow check here;
    // the Cloud Function validates against the real ISO table. Same two-layer
    // shape as the split-sum validation (Q1 / Option A).
    function isCurrencyCode(v) {
      return v is string && v.size() == 3 && v.matches('^[A-Z]{3}$');
    }
```

> **Cost note.** `exists()` and `get()` each bill as a document read, and rules allow at
> most **10** such calls per single-document request (20 for a query). Keeping membership
> in a dedicated `members/{uid}` doc makes `isMember` a single cheap `exists()`. Do not
> nest helpers that each perform a `get()` — that limit is reached faster than expected.

---

## Rules by collection

### `users`

```js
    match /users/{uid} {
      allow get: if isSelf(uid);
      allow list: if false;                       // never enumerate users
      allow create: if isSelf(uid)
                    && request.resource.data.uid == uid
                    && request.resource.data.displayName is string
                    && request.resource.data.displayName.size() >= 1
                    && request.resource.data.displayName.size() <= 50
                    && request.resource.data.createdAt == request.time;
      allow update: if isSelf(uid)
                    && !changed(['uid', 'createdAt'])
                    && request.resource.data.updatedAt == request.time;
      allow delete: if false;                     // account deletion is a Function

      match /friends/{friendUid} {
        allow read: if isSelf(uid);
        allow write: if false;                    // reciprocal writes are Function-only
      }
    }
```

Friend records are Function-written because they must be created **reciprocally and
atomically** on two different users' documents — a client can only write its own.

### `usernames` (friend lookup index)

```js
    match /usernames/{key} {
      allow get: if isSignedIn();     // resolve a contact you already know
      allow list: if false;           // T5 — the whole point
      allow write: if false;          // Function-only
    }
```

### `groups`

```js
    match /groups/{groupId} {
      allow get, list: if isMember(groupId);

      allow create: if isSignedIn()
                    && request.resource.data.createdBy == request.auth.uid
                    && request.resource.data.memberIds == [request.auth.uid]
                    && request.resource.data.name.size() >= 1
                    && request.resource.data.name.size() <= 60
                    && isCurrencyCode(request.resource.data.currency)
                    && request.resource.data.createdAt == request.time;

      allow update: if isMember(groupId)
                    && !changed(['currency', 'createdBy', 'createdAt', 'memberIds',
                                 'memberCount', 'isImplicit']);
      allow delete: if false;         // deletion is a Function (checks zero balances)
```

`memberIds` is excluded from client updates (T4) — membership changes only through
Functions. `currency` is immutable (T10). Group creation seeds `memberIds` with exactly
the creator; the creator's `members/{uid}` doc is written by the `onGroupCreated` trigger.

### `groups/{gid}/members`

```js
      match /members/{memberUid} {
        allow read: if isMember(groupId);
        allow write: if false;        // T2 + T4: balances and membership are Function-only
      }
```

Blanket-denying client writes here is what makes T2 impossible. There is no legitimate
reason for a client to write a member doc — role changes, joins, and leaves all run as
callables that can validate preconditions (zero balance, admin rights) atomically.

### `groups/{gid}/expenses` — the important one

```js
      match /expenses/{expenseId} {
        allow read: if isMember(groupId);

        allow create: if isMember(groupId)
          && validExpense()
          && request.resource.data.createdBy == request.auth.uid
          && request.resource.data.createdAt == request.time
          && request.resource.data.deletedAt == null;

        // ADR-11: only the creator or a group admin may edit. Everyone else discusses.
        allow update: if isMember(groupId)
          && (resource.data.createdBy == request.auth.uid || isAdmin(groupId))
          && validExpense()
          && !changed(['createdBy', 'createdAt', 'groupId', 'currency'])
          && request.resource.data.updatedBy == request.auth.uid;

        allow delete: if false;       // soft delete only: set deletedAt via update

        function validExpense() {
          let d = request.resource.data;
          return isPositiveInt(d.amountMinor)
            && d.currency == groupCurrency(groupId)
            && d.description is string
            && d.description.size() >= 1 && d.description.size() <= 100
            && d.splits.size() >= 1
            && d.paidBy.size() >= 1
            && sumMinor(d.paidBy) == d.amountMinor      // T3
            && sumMinor(d.splits) == d.amountMinor      // T3
            && d.participantIds.size() == d.splits.size();
        }

        function sumMinor(arr) {
          // Rules have no reduce(). See the note below.
          return arr.size() == 1 ? arr[0].amountMinor
               : arr.size() == 2 ? arr[0].amountMinor + arr[1].amountMinor
               : /* ... */ -1;
        }
```

> ### ⚠️ Open implementation problem: summing arrays in Rules
>
> Firestore Rules have **no loops and no `reduce`**. There is no clean way to sum an
> arbitrary-length array. Three options, to be decided in Phase 06:
>
> **Option A — client supplies a checksum field.** Store a redundant
> `splitsTotalMinor` and require `splitsTotalMinor == amountMinor` in rules, then have the
> Cloud Function verify the _actual_ sum and quarantine the expense if it disagrees.
> Rules catch the naive attack; the Function catches the sophisticated one.
> _Cheap, but there is a window where a bad doc exists._
>
> **Option B — unrolled sum up to N participants.** Hand-write the sum for group sizes
> 1..15 with a hard cap. Fully validated at write time, but ugly and caps group size.
>
> **Option C — writes go exclusively through a callable Function.** Deny all direct
> client writes to `expenses`; `createExpense` / `updateExpense` callables do full
> validation with real code. Strongest guarantee and the simplest rules, at the cost of
> ~200-400 ms added latency per write and losing Firestore's offline write queue.
>
> **Recommendation: Option A for the MVP, with the Function-side verification treated as
> mandatory, not optional.** It preserves optimistic offline writes and realtime feel.
> Revisit if abuse ever becomes real. This is listed as an open question in
> [12-decisions.md](12-decisions.md).

### Comments, settlements, activity

```js
        match /comments/{commentId} {
          allow read: if isMember(groupId);
          allow create: if isMember(groupId)
                        && request.resource.data.uid == request.auth.uid
                        && request.resource.data.text.size() >= 1
                        && request.resource.data.text.size() <= 500;
          allow update: if false;
          allow delete: if isMember(groupId) && resource.data.uid == request.auth.uid;
        }
      }

      match /settlements/{settlementId} {
        allow read: if isMember(groupId);
        allow create: if isMember(groupId)
                      && isPositiveInt(request.resource.data.amountMinor)
                      && request.resource.data.fromUid != request.resource.data.toUid
                      && request.resource.data.createdBy == request.auth.uid
                      && request.resource.data.currency == groupCurrency(groupId);
        allow update: if isMember(groupId) && !changed(['createdBy','createdAt','amountMinor']);
        allow delete: if false;       // soft delete
      }

      match /activity/{activityId} {
        allow read: if isMember(groupId);
        allow write: if false;        // T8 — append-only, Function-written
      }
    }
```

### `invites`

```js
    match /invites/{inviteId} {
      allow read, write: if false;    // entirely mediated by the redeemInvite callable
    }
  }
}
```

### Default deny

Rules deny by default, but add an explicit catch-all at the end of the top-level match as
documentation of intent:

```js
    match /{document=**} {
      allow read, write: if false;
    }
```

---

## Testing the rules (NFR-9)

Non-negotiable: every threat T1–T10 gets a test that asserts **denial**. Use
`@firebase/rules-unit-testing` against the emulator (requires Java — see
[08-firebase-setup.md](08-firebase-setup.md)).

Structure:

```ts
// firebase/tests/rules/expenses.test.ts
describe('expenses', () => {
  it('T1: non-member cannot read a group expense', async () => {
    await assertFails(getDoc(doc(outsiderDb, 'groups/g1/expenses/e1')));
  });
  it('T2: member cannot write their own balanceMinor', async () => {
    await assertFails(updateDoc(doc(memberDb, 'groups/g1/members/u1'), { balanceMinor: 0 }));
  });
  it('T3: splits not summing to total are rejected', async () => {
    /* ... */
  });
  it('T6: split assigned to a non-member is rejected', async () => {
    /* ... */
  });
  // ... one per threat, plus a positive case per rule
});
```

Rule of thumb: **for every `allow`, write one test that passes and one that fails.** A
rules suite with only happy-path tests provides approximately zero security value.

Run in CI on every push, against the emulator, before any deploy.

---

## App Check (Phase 10)

Security Rules stop _unauthorised users_. They do not stop a _legitimate user's token_
being driven by a script to run up your bill. Enable **App Check** with reCAPTCHA
Enterprise on web to bind requests to your real app. Enforce it on Firestore and
Functions. This is the main defence against cost-abuse on the Blaze plan and should be
paired with a billing budget alert.
