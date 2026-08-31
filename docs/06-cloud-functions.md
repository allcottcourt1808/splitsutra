# 06 — Cloud Functions

Runtime: **Node 24, TypeScript, Firebase Functions Gen 2**, region `us-central1`
(Iowa — colocated with Firestore; change in one constant if that assumption is wrong).

Functions import `@splitsutra/core` so the balance and split logic is **literally the same
code** the client runs. There is never a second implementation of the money math.

---

## Function inventory

| Name                       | Kind      | Trigger                                | Purpose                                              |
| -------------------------- | --------- | -------------------------------------- | ---------------------------------------------------- |
| `onGroupCreated`           | Firestore | `groups/{gid}` create                  | Seed creator's member doc, write activity            |
| `onExpenseWritten`         | Firestore | `groups/{gid}/expenses/{eid}` write    | **Recompute balances**, verify sums, write activity  |
| `onSettlementWritten`      | Firestore | `groups/{gid}/settlements/{sid}` write | Recompute balances, write activity                   |
| `onUserProfileWritten`     | Firestore | `users/{uid}` write                    | Maintain `usernames/` index, fan out name/photo      |
| `redeemInvite`             | Callable  | client call                            | Validate token, add member — the link stays reusable |
| `createInvite`             | Callable  | client call                            | The group's one active link; `reset` mints a new one |
| `sendFriendRequest`        | Callable  | client call                            | Resolve a contact, write one `pending` request       |
| `respondToFriendRequest`   | Callable  | client call                            | Accept (friend docs + implicit group) or decline     |
| `cancelFriendRequest`      | Callable  | client call                            | Sender withdraws an unanswered request               |
| `undoDeclineFriendRequest` | Callable  | client call                            | Recipient takes back an accidental decline, briefly  |
| `removeMember`             | Callable  | client call                            | Admin removes a member (blocks if balance ≠ 0)       |
| `leaveGroup`               | Callable  | client call                            | Self-removal (blocks if balance ≠ 0)                 |
| `deleteGroup`              | Callable  | client call                            | Admin delete (blocks unless all balances = 0)        |
| `recomputeGroupBalances`   | Callable  | client/admin call                      | Self-heal: rebuild balances from the ledger          |
| `repairGroupMembership`    | Callable  | client call                            | Self-heal: reseed a member doc a trigger never wrote |
| `deleteAccount`            | Callable  | client call                            | Anonymise profile, remove memberships                |
| `auditBalances`            | Scheduled | daily 03:00 IST                        | ⚠️ **NOT IMPLEMENTED** — see the section below       |

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
2. status === 'pending'             → failed-precondition if revoked/expired/legacy-spent
3. expiresAt > now                  → deadline-exceeded if expired
4. Already a member?                → return success (idempotent, not an error)
5. Group memberCount < 50           → resource-exhausted if full
6. Transaction:
     create groups/{gid}/members/{uid}  (role: 'member', balanceMinor: 0)
     update group.memberIds arrayUnion(uid), memberCount++
     append uid to invite.redeemedBy   ← the link stays pending
     write activity 'member.joined'
```

Step 4 matters: double-tapping the join button must not error.

#### 🔴 An invite is not consumed by being used

Step 6 used to set `invite.status = 'accepted'`, which made a link a single ticket. The second
person to click a shared link was told it **"has already been used"** — for the most obvious
way anyone would ever use one, which is pasting it into a group chat with four people in it.
The link now stays `pending` and the redeemer is appended to `redeemedBy`.

Stated plainly, because it is a real widening: **a leaked token is now good for everyone who
sees it**, not for one person. Three things bound it, and none of them is the click count.

| Bound                                                                   | Where          |
| ----------------------------------------------------------------------- | -------------- |
| The group ceiling — the 51st person is refused whichever link they hold | step 5         |
| `expiresAt`, 14 days from minting                                       | step 3         |
| Revocation — `createInvite({ reset: true })`                            | `createInvite` |

The third is why the reset shipped in the same change. A standing credential nobody can revoke
is a worse design than a single-use one, and shipping the reusable half without it would have
traded one bad shape for another.

Concurrency got **simpler**. The old in-transaction re-read existed so that only one of two
simultaneous redemptions could consume the token; there is nothing to consume now, so both may
proceed. The re-read stays for a different reason — the link may have been revoked or reset
between the check and the write, and a credential has to be judged on the value being acted on.

`status` keeps the word `pending` for a link that three people have walked through. `active`
would be the better word and renaming it is a live-data migration: `parseDocument` throws on an
enum member it does not know, so every invite written before the rename would fail to decode.
`accepted` stays in the enum as **legacy only** — nothing writes it, and the invites that carry
it stay dead, because a link that was already spent does not come back to life when the rules
around it change.

### `createInvite`

Despite the name, it does **not** mint one every time. A group has one active link and this
returns it, creating one only when there is none.

That follows from the link being reusable. The token is returned by this call and by nothing
else — `invites/{id}` is unreadable to every client — so a caller who lost the string cannot
ask for it again. Minting a second link would leave the first live and unreachable beside it:
two standing doors into the group, one of which nobody can see, revoke, or account for.
Read-or-create keeps the number of live doors equal to the number the group can see, which is
one.

`reset: true` revokes **every** live link for the group and issues a fresh token — every one,
not just the newest, because the point of a reset is that no string anybody holds still opens
the group. Groups minted before this change may legitimately hold several. Nobody who already
joined is affected: a membership is not held open by the invite that created it.

The name is a slight lie and is kept anyway. A Cloud Function export name **is** its deployed
name (Article XI), so renaming this to `getInviteLink` is a delete plus a create, and every
client in flight during the swap gets `functions/not-found`.

The read-or-create query (`groupId` + `status` + `createdAt`) needs the `invites` composite
index in `firestore.indexes.json`.

### `sendFriendRequest` / `respondToFriendRequest` / `cancelFriendRequest` / `undoDeclineFriendRequest`

Replaces `addFriend`, which did the lookup and the write in one call with no consent step.
Split either side of the recipient's answer (AC-B1.4). `friendRequests/{fromUid}__{toUid}`
is the document; the derived id makes a duplicate request impossible by construction.

```
sendFriendRequest
1. Reject self-friending                        (AC-B1.6)
2. Resolve target via usernames/{sha256(key)}   → not-found if unregistered
3. Tombstoned target?                           → the SAME not-found message
4. Transaction:
     they already asked me (pending)?  → accept it now         (AC-B1.9)
     I already asked, pending?         → idempotent no-op      (AC-B1.5)
     I already asked, accepted?        → return implicitGroupId
     I already asked, declined?        → failed-precondition   (AC-B1.8)
     already friends?                  → return implicitGroupId
     otherwise                         → write one 'pending' doc

respondToFriendRequest   (recipient only; toUid read from the doc, never the payload)
     decline → status 'declined', nothing else written
     accept  → one transaction: implicit group + both member docs + BOTH friend docs,
               then status 'accepted' with the group id     (AC-B1.7)

cancelFriendRequest      (sender only) → status 'cancelled', which CAN be re-sent

undoDeclineFriendRequest (RECIPIENT only; toUid read from the doc)
1. toUid === caller                             → not-found otherwise
2. status === 'declined'                        → failed-precondition otherwise
3. now - respondedAt <= UNDO_DECLINE_WINDOW_MS  → failed-precondition otherwise
4. status back to 'pending', respondedAt back to null
```

Both sides of a friendship are written in one transaction — a one-directional friendship
is a bug that is painful to detect later. `lib/friendship.ts` owns that transaction and is
shared by the accept path and the mutual auto-accept.

🔴 The group's **currency is the sender's default**, because the sender is the group's
creator and admin. Accepting must not silently redenominate a group around the accepter's
preference, and the currency is immutable after creation (T10, AC-C1.1).

🔴 A decline is terminal rather than rate-limited. See AC-B1.8 for why.

**The escape hatch, concretely:** the guard reads only the caller's OWN outgoing document, and
the auto-accept in step 4a fires only on an incoming request that is `pending`. So a `declined`
document blocks nothing in the other direction — `friendRequests/{from}__{to}` is derived from
the pair _in order_, and `{to}__{from}` is a different document. **The person who declined can
ask.** That is the only route back, and it is the right one: consent flows from whoever said no.

This is not a theoretical path. It is what a real user hit on the dev backend — a decline made
while testing left them unable to re-send, reading an accurate but unactionable error as a
broken app. `ALREADY_DECLINED` now names the way out.

#### 🔴 `undoDeclineFriendRequest` is not a second chance for the sender

Decline sits directly beside Accept and a thumb is not a decision, so an accidental tap has a
way back. The distinction that keeps this safe is **who** may call it:

|                            | Undoes               | Authorised on           |
| -------------------------- | -------------------- | ----------------------- |
| `cancelFriendRequest`      | your own **request** | `fromUid` — the sender  |
| `undoDeclineFriendRequest` | your own **answer**  | `toUid` — the recipient |

A sender able to reach this could clear their own refusal and ask again, and again — which is
exactly the thing the terminal decline exists to prevent. The recipient withdrawing an answer
they did not mean to give is the opposite act, and grants the sender nothing they did not
already have: the request returns to `pending`, where it was before the tap. The sender is told
none of it, because they were never told it was declined in the first place.

**Time-boxed** by `UNDO_DECLINE_WINDOW_MS` (core), measured against `respondedAt` — written
with `serverTimestamp()` and compared to the Function's own clock, so a client cannot widen
the window by lying about its time. An accident is noticed immediately; a week later it is a
change of mind, and a change of mind should mean asking the person again rather than silently
reviving a request they were never told had died.

The timing decision itself is `declineUndoState()` in `core/src/types/friendRequest.ts`, pulled
out so the one part of this Function that computes anything is unit-tested at its boundary —
Cloud Functions still have no test harness in this repository. **The `toUid` check is not in
there and must not be**: it is the load-bearing half, and it is enforced against the stored
document inside the transaction.

`respondedAt` returns to `null` with the status. The schema refines
`(status === 'pending') === (respondedAt === null)`, so writing one without the other produces
a document that stops decoding on the next read.

**There is no undo for Accept.** Accepting creates a group, two member documents and two
`friends` documents carrying `balanceMinor`; taking that back is a teardown with money state
hanging off it, not a status flip. `leaveGroup` covers the reachable half.

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

### `repairGroupMembership`

The repair valve for the one failure `recomputeGroupBalances` cannot fix: **a group whose
`onGroupCreated` never ran.**

Every `/groups/{gid}/**` read is gated on `isMember(gid)`, which is
`exists(/groups/$(gid)/members/$(uid))`. That member document is written by `onGroupCreated`
and by nothing else — the members subcollection is `allow write: if false` unconditionally
(threats T2 and T4). But `allow list` on `/groups/{gid}` reads `memberIds` and performs **zero
document reads**, deliberately, because 50 candidate groups against a 20-access-call query limit
does not fit. So a group whose trigger was dropped **appears in its creator's list and cannot be
opened by anyone**, and there was no way back:

- `recomputeGroupBalances` calls `requireActiveMember(gid, uid)` first, which reads the very
  document that is missing. The existing valve is locked behind the thing that is broken.
- Loosening `allow get` to trust `memberIds` would not help — members, expenses, settlements and
  activity all gate on `isMember()` too — and it would break `leaveGroup`, since `leftAt` is only
  representable in the member document.

**Authorisation is `uid ∈ group.memberIds`, and that grants nothing new.** The rules pin
`memberIds == [creator]` at create and list it among the immutable fields on update, and
`allow list` already trusts it alone. A caller who is in `memberIds` is someone the system has
already decided is a member; the missing document is the bug, not the boundary.

Notes on the shape:

- **Self-repair only.** There is no `uid` parameter — you repair your own membership or nobody's.
- **Balances are rebuilt, not assumed zero.** `recomputeBalances` derives its member set from the
  member _documents_, so the doc is seeded inside a transaction first and the recompute runs
  after. A failed rebuild is reported as `balancesRebuilt: false` rather than swallowed, and
  logged at ERROR (docs/10 alerts on ERROR).
- **No activity entry is written.** Backfilling a `group.created` row would stamp today's
  timestamp on something that happened days ago — a false record in the log T8 exists to keep
  honest.
- Every repair logs at ERROR whether or not the user noticed, because a repair means a trigger
  was dropped and that is worth an alert.

The client side is automatic: a `permission-denied` from `useGroup` **terminates** the snapshot
listener (Firestore does not retry it), so `GroupDetailScreen` calls this once per group id, then
calls `retry()` on both hooks to open fresh subscriptions. The user sees "Finishing setting up
this group…" and then the group.

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

🔴 **This does not exist yet.** There is no `scheduled/` directory and nothing exports it, so it
is not deployed and the drift check is not running. It was listed in the inventory above as
though it were live, which it never was — corrected. By this file's own rule, restated in
`index.ts` ("export it when it works, not before"), an entry here is a claim about the deployed
system and this one was wrong.

The two hard parts are already built and unused:

- `findBalanceDrift(gid)` in `common/balances.ts` — a read-only recompute that _reports_ drift
  rather than repairing it, so the discrepancy can be logged before the evidence is overwritten,
  and which calls `assertZeroSum` independently of the write path.
- `AUDIT_SCHEDULE` (`'0 3 * * *'`) and `AUDIT_TIMEZONE` (`'Asia/Kolkata'`) in `common/config.ts`.

What remains is the `onSchedule` wrapper, the iteration over active groups, and the decision
below about repairing versus only reporting.

---

Intended behaviour, daily at 03:00 IST. For every active group, recompute from the ledger and compare to
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
