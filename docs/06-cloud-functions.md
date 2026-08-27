# 06 — Cloud Functions

Runtime: **Node 24, TypeScript, Firebase Functions Gen 2**, region `us-central1`
(Iowa — colocated with Firestore; change in one constant if that assumption is wrong).

Functions import `@splitsutra/core` so the balance and split logic is **literally the same
code** the client runs. There is never a second implementation of the money math.

---

## Function inventory

| Name                     | Kind      | Trigger                                | Purpose                                             |
| ------------------------ | --------- | -------------------------------------- | --------------------------------------------------- |
| `onGroupCreated`         | Firestore | `groups/{gid}` create                  | Seed creator's member doc, write activity           |
| `onExpenseWritten`       | Firestore | `groups/{gid}/expenses/{eid}` write    | **Recompute balances**, verify sums, write activity |
| `onSettlementWritten`    | Firestore | `groups/{gid}/settlements/{sid}` write | Recompute balances, write activity                  |
| `onUserProfileWritten`   | Firestore | `users/{uid}` write                    | Maintain `usernames/` index, fan out name/photo     |
| `redeemInvite`           | Callable  | client call                            | Validate token, add member atomically               |
| `createInvite`           | Callable  | client call                            | Mint an invite token for a group                    |
| `addFriend`              | Callable  | client call                            | Reciprocal friend docs + implicit 1:1 group         |
| `removeMember`           | Callable  | client call                            | Admin removes a member (blocks if balance ≠ 0)      |
| `leaveGroup`             | Callable  | client call                            | Self-removal (blocks if balance ≠ 0)                |
| `deleteGroup`            | Callable  | client call                            | Admin delete (blocks unless all balances = 0)       |
| `recomputeGroupBalances` | Callable  | client/admin call                      | Self-heal: rebuild balances from the ledger         |
| `deleteAccount`          | Callable  | client call                            | Anonymise profile, remove memberships               |
| `auditBalances`          | Scheduled | daily 03:00 IST                        | Assert zero-sum invariant, log/alert on drift       |

---

## The balance pipeline (the critical path)

### Design constraints

1. **Idempotent.** Firestore triggers deliver _at least once_. The same event may fire
   twice. Recomputation must converge to the same answer.
2. **Transactional.** Concurrent expense writes in one group must not interleave into a
   lost update.
3. **Self-healing.** If a trigger is ever dropped, a recompute repairs it fully.

### Chosen approach: full recompute from the ledger

```ts
export const onExpenseWritten = onDocumentWritten(
  { document: 'groups/{gid}/expenses/{eid}', region: 'us-central1' },
  async (event) => {
    const { gid } = event.params;
    await verifyExpenseIntegrity(event); // Option A backstop from 05-security-rules
    await recomputeBalances(gid);
    await writeActivity(gid, event);
  },
);

async function recomputeBalances(gid: string) {
  await db.runTransaction(async (tx) => {
    const expenses = await tx.get(
      db.collection(`groups/${gid}/expenses`).where('deletedAt', '==', null),
    );
    const settlements = await tx.get(
      db.collection(`groups/${gid}/settlements`).where('deletedAt', '==', null),
    );
    const members = await tx.get(db.collection(`groups/${gid}/members`));

    // ← the SAME pure function the client uses for optimistic UI
    const balances = computeBalances({
      expenses: expenses.docs.map((d) => d.data()),
      settlements: settlements.docs.map((d) => d.data()),
      memberIds: members.docs.map((d) => d.id),
    });

    assertZeroSum(balances); // fail loudly rather than write bad data

    for (const m of members.docs) {
      tx.update(m.ref, { balanceMinor: balances[m.id] ?? 0 });
    }
  });
}
```

### Why full recompute instead of incremental deltas

Incremental (`balance += delta`) is O(1) but drifts permanently the moment a single event
is missed or double-applied. Full recompute is O(expenses-in-group) but is **idempotent and
self-correcting by construction** — any inconsistency is erased on the next write.

Cost at our scale assumptions ([00-overview.md](00-overview.md)): a 10,000-expense group
costs 10,000 reads per write, which is genuinely too much. Mitigation:

- Typical groups have far fewer than 500 expenses; that is a ~500-read write, well inside
  Blaze free tier for personal use.
- **Threshold escape hatch:** if a group exceeds `RECOMPUTE_THRESHOLD = 1000` expenses,
  switch to incremental deltas _plus_ a nightly full recompute via `auditBalances`.
- Instrument the read count per invocation in Phase 10 and revisit with real numbers
  rather than guessing now.

This trade is deliberate: **correctness first, optimise on measurement.** It is listed as
an open question in [12-decisions.md](12-decisions.md).

### Transaction limits to respect

- A Firestore transaction can touch at most **500 documents** for writes. Member writes
  are ≤ 50 (group cap), so writes are fine.
- Transaction _reads_ are not capped at 500, but large reads risk contention aborts.
  The threshold above keeps this bounded.
- Transactions retry on contention; keep the function body free of side effects outside
  the transaction (no emails, no external calls inside `runTransaction`).

---

## Callable functions

All callables follow one shape and share a preamble:

```ts
export const redeemInvite = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const { token } = RedeemInviteSchema.parse(req.data); // Zod, shared with client
    // ...
  },
);
```

Shared conventions:

- **Zod schemas imported from `@splitsutra/core`** — one validation definition for client and
  server (architecture rule from [02-architecture.md](02-architecture.md)).
- `enforceAppCheck: true` once App Check is on (Phase 10).
- Throw `HttpsError` with specific codes so the UI can show a real message rather than
  "something went wrong".

### `redeemInvite`

Why this must be server-side: a client cannot add itself to `groups/{gid}/members` because
rules deny it (T4), and it cannot even read the group to check the invite. Only the Admin
SDK can bridge that gap.

```
1. Look up invite by token          → not-found if absent
2. status === 'pending'             → failed-precondition if used/revoked
3. expiresAt > now                  → deadline-exceeded if expired
4. Already a member?                → return success (idempotent, not an error)
5. Group memberCount < 50           → resource-exhausted if full
6. Transaction:
     create groups/{gid}/members/{uid}  (role: 'member', balanceMinor: 0)
     update group.memberIds arrayUnion(uid), memberCount++
     update invite.status = 'accepted', acceptedBy = uid
     write activity 'member.joined'
```

Step 4 matters: double-tapping the join button must not error.

### `addFriend`

```
1. Reject self-friending (AC-B1.6)
2. Resolve target via usernames/{sha256(key)}   → not-found if unregistered
3. Already friends?  → return existing implicitGroupId (idempotent, AC-B1.5)
4. Transaction:
     create implicit group (type 'friend', isImplicit true, both members)
     create users/{me}/friends/{them}
     create users/{them}/friends/{me}
     create both member docs
```

Both sides written in one transaction — a one-directional friendship is a bug that is
painful to detect later.

### `leaveGroup` / `removeMember` / `deleteGroup`

Each enforces a balance precondition that **cannot** be checked in Security Rules (it
requires reading other members' docs):

- `leaveGroup`: caller's `balanceMinor === 0`, else `failed-precondition` with the amount
  in the error detail so the UI can say "settle $X first".
- `removeMember`: caller is admin **and** target's balance is 0.
- `deleteGroup`: caller is admin **and** every member's balance is 0.

Leaving sets `leftAt` and removes the uid from `memberIds` rather than deleting the member
doc — historical expenses still reference that person and the group must still render.

### `deleteAccount` (AC-A3.2, AC-A3.3)

```
1. Check every group membership for a non-zero balance → refuse with the list
2. Remove from all groups' memberIds
3. Anonymise users/{uid}: displayName = 'Deleted user', clear email/phone/photo,
   set deletedAt
4. Delete usernames/{hash} index entries
5. Leave expenses intact — the ledger must stay auditable and zero-sum
6. Delete the Firebase Auth user last
```

### `recomputeGroupBalances`

Manual repair valve, callable by any group member. Runs the same `recomputeBalances`.
Surfaced in the UI behind a "Balances look wrong?" affordance in group settings — cheap
insurance that turns a support incident into a button press.

---

## `onUserProfileWritten` — the fan-out

Maintains the `usernames/` lookup index and propagates display name/photo changes
(AC-A2.3).

```
On create/update of users/{uid}:
  - upsert usernames/{sha256(lower(email))}  → { uid, displayName, photoURL }
  - upsert usernames/{sha256(e164(phone))}   → same
  - delete stale index docs if email/phone changed
  - if displayName or photoURL changed:
      query groups where memberIds array-contains uid
      batch-update each groups/{gid}/members/{uid} snapshot   (batches of 400)
```

**Cost warning:** a user in 500 groups triggers 500 writes on a rename. Guard it:

- Only fan out when `displayName` or `photoURL` **actually** changed (diff first).
- Rate-limit renames to once per hour per user.
- Names are cosmetic only — never used for identity or authorization — so eventual
  consistency here is acceptable.

---

## `auditBalances` (scheduled)

Daily at 03:00 IST. For every active group, recompute from the ledger and compare to
stored member balances.

- Mismatch → log at `ERROR` with the group ID and delta, and auto-repair.
- Also asserts the zero-sum invariant independently of the write path.

This is the safety net that turns "balances are silently wrong" into "we found out within
24 hours". Wire a log-based alert to it in Phase 11.

---

## User profile creation — the decision

Two options for creating `users/{uid}` on first sign-in:

|                           | Blocking Function (`beforeUserCreated`) | Client-side upsert                               |
| ------------------------- | --------------------------------------- | ------------------------------------------------ |
| Guarantees profile exists | Yes                                     | No — a crash mid-flow leaves an authless profile |
| Requires                  | Identity Platform upgrade               | Nothing                                          |
| Works with FirebaseUI     | Yes                                     | Yes                                              |
| Complexity                | Higher                                  | Lower                                            |

**Decision: client-side upsert, guarded by rules** (`isSelf(uid)` on create), because
FirebaseUI already owns the post-sign-in callback and it is the natural place to hook.
`onUserProfileWritten` then builds the index. A missing profile is self-healing — the app
shell upserts on every launch, not just first sign-in.

---

## Error handling and observability

- Every function wrapped in try/catch that logs **structured** JSON (`{ fn, gid, uid,
err }`) — Cloud Logging can then be filtered and alerted on.
- Never swallow an error silently in the balance path. Fail loudly; the audit job repairs.
- `assertZeroSum` throws before writing, so a bug can never persist a broken balance set.
- Set `maxInstances` on every function (start at 10) — **this is the primary guard against
  a runaway loop billing you on Blaze.**
- Watch for **trigger loops**: `onUserProfileWritten` must not write back to `users/{uid}`,
  or it re-triggers itself forever. Any write-back must be diff-guarded.

---

## Local development

Everything runs in the emulator suite (Firestore + Auth + Functions). Functions hot-reload
via `pnpm --filter functions build --watch`. Seed data is scripted so a fresh emulator has
a realistic group in seconds — see [08-firebase-setup.md](08-firebase-setup.md).
