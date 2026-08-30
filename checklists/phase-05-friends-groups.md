# Phase 05 — Friends, Groups & Invites

**Est. 2.5 days.** Depends on 03, 04.
Covers **Epic B** and **Epic C**.

---

## 1. Groups — data layer

- [ ] 🔴 `core/src/repositories/groupRepo.ts`: `createGroup`, `updateGroup`,
      `watchMyGroups`, `watchGroup`, `watchMembers`
- [ ] 🔴 `watchMyGroups` = `where('memberIds','array-contains',uid)`,
      `orderBy('lastActivityAt','desc')` — **filter out `isImplicit`** so hidden 1:1 groups
      never appear in the group list (ADR-06)
- [ ] 🔴 Composite index: `groups` → `memberIds` ARRAY + `lastActivityAt` DESC
- [ ] 🔴 Group `currency` immutable after creation (AC-C1.1, threat T10)
- [ ] 🟡 `useMyGroups()`, `useGroup(gid)`, `useGroupMembers(gid)` hooks

## 2. Groups — rules

- [ ] 🔴 `isMember(gid)` helper via `exists()` on the member doc
- [ ] 🔴 `groups` create: `createdBy == auth.uid`, `memberIds == [auth.uid]`, name length,
      currency in the allowed set
- [ ] 🔴 `groups` update: member only, and **cannot** change `currency`, `createdBy`,
      `createdAt`, `memberIds`, `memberCount`, `isImplicit`
- [ ] 🔴 `groups/{gid}/members`: **read-only to clients, no writes at all** (threats T2, T4)
- [ ] 🔴 `groups` delete: `false` — deletion is a callable

## 3. Groups — Cloud Functions

- [ ] 🔴 `onGroupCreated` — seed the creator's `members/{uid}` doc as `admin` with
      `balanceMinor: 0`, write the `group.created` activity entry
- [ ] 🔴 `leaveGroup` callable — refuse unless the caller's balance is 0 (AC-C1.6); return
      the outstanding amount in the error so the UI can say "settle $X first"
- [ ] 🔴 `removeMember` callable — admin only, target balance must be 0 (AC-C1.7)
- [ ] 🟡 `deleteGroup` callable — admin only, **all** balances 0 (AC-C1.5)
- [ ] 🔴 Leaving sets `leftAt` and removes the uid from `memberIds`; it does **not** delete
      the member doc — historical expenses still reference that person
- [ ] 🔴 `maxInstances` set on every function

## 4. Groups — screens

- [ ] 🔴 `/groups` — group list with per-group balance and the overall summary header
      (AC-C1.8, AC-E1.1). Placeholder balances until Phase 07.
- [ ] 🔴 `/groups/new` — name, type (Trip/Home/Couple/Other), currency picker
- [ ] 🔴 `/groups/:gid` — header, member avatar stack, empty expense list for now
- [ ] 🟡 `/groups/:gid/settings` — rename, type, `simplifyDebts` toggle, leave, delete
- [ ] 🟡 `/groups/:gid/members` — member list, add member, remove (admin)
- [ ] 🟡 Empty state that offers "Create a group" and "Add a friend"
- [ ] 🟢 Group photo/emoji per type

## 5. Friends — `usernames` lookup index

- [ ] 🔴 `sha256` helper in `core/src/utils/` (Web Crypto — **must also work in RN**, so
      no Node `crypto` import)
- [ ] 🔴 Normalise before hashing: email lowercased and trimmed; phone to E.164
- [ ] 🔴 `usernames` rules: `get` allowed for signed-in users, **`list` denied** (threat T5)
- [ ] 🔴 Index maintained only by `onUserProfileWritten` (Phase 03)
- [ ] 🟡 `findUserByContact(input)` in `userRepo` — one `get`, returns
      `{ uid, displayName, photoURL }` only (AC-B1.2)

## 6. Friends — the request/accept callables

- [ ] 🔴 Reject self-friending (AC-B1.6)
- [ ] 🔴 Idempotent: already friends → return the existing `implicitGroupId` (AC-B1.5)
- [ ] 🔴 One transaction creating: the implicit 2-person group (`isImplicit: true`,
      `type: 'friend'`), both member docs, **and both** `users/{x}/friends/{y}` docs
      (AC-B1.4)
- [ ] 🔴 ⚠️ Both friend docs in the **same** transaction — a one-directional friendship is
      painful to detect later
- [ ] 🟡 `users/{uid}/friends` rules: owner reads, **no client writes**

## 7. Friends — screens

- [ ] 🟡 `/friends` — list with net balance per friend (AC-B2.1), separate line per
      currency (AC-B2.3)
- [ ] 🟡 `/friends/add` — search by email or phone, result card, "Add" action
- [ ] 🟡 Not-found state offering an invite link (AC-B1.3)
- [ ] 🟡 `/friends/:uid` — shared expenses, aggregate balance (fills in during Phase 06/07)

## 8. Invites

- [x] ✅ 🟡 `createInvite` callable — 128-bit random token, 14-day expiry (AC-B3.1)
- [x] ✅ 🔴 `invites` rules: **no client read or write at all** — fully mediated by callables
- [x] ✅ 🟡 `redeemInvite` callable, per [../docs/06-cloud-functions.md](../docs/06-cloud-functions.md):
      not-found → used/revoked → expired → **already a member returns success
      (idempotent)** → member cap → transactional join
- [x] ✅ 🟡 `/invite/:token` screen, working logged-out then resuming after sign-in (AC-B3.3) —
      `apps/web/src/screens/JoinGroupScreen.tsx`. The logged-out half needs nothing here:
      `JoinGroup` sits inside `<RequireAuth>`, which stashes the path and replays it after
      sign-in.
- [x] ✅ 🟡 Web Share API with clipboard fallback (AC-B3.2) — **via the `PlatformAdapter`**,
      not `navigator.share` directly
- [x] ✅ 🟡 Distinct error messages per failure case (AC-B3.5) — the four statuses `redeemInvite`
      throws deliberately are shown verbatim; every other `FirebaseError` is replaced, because
      an undeployed Function rejects with the message `internal [0]` and passing that through
      put a raw status code on screen.

> 🔴 **"showing group name before joining" was dropped, and the checklist was the thing that
> was wrong.** It cannot be built: `firestore.rules` denies every client read of
> `invites/{id}` — "a readable invite collection would leak group names and let tokens be
> brute-forced offline" — and the caller is not a member yet, so `groups/{gid}` denies them
> too. A `peekInvite` callable would trade that security property for one line of copy, and
> putting the name in the URL is worse, because a query parameter is forgeable: a link could
> claim any group name while adding you to a stranger's group. The name is returned by the
> join, where the server vouches for it. Article IV — if a change violates the boundary, the
> change is wrong.

> ⚠️ **None of §8 is exercised end to end yet.** `createInvite` and `redeemInvite` are not
> deployed, so both paths fail at the callable. The screens, the wrapper and the rules are in;
> the round trip is unverified until Functions deploy or the emulators run.

## 9. Tests

- [x] 🔴 Rules: non-member cannot read a group (T1) — covered by firebase/tests/rules/groups.test.ts
- [x] 🔴 Rules: client cannot write a member doc (T2, T4) — covered by firebase/tests/rules/groups.test.ts
- [x] 🔴 Rules: `list` on `usernames` denied (T5) — covered by firebase/tests/rules/usernames.test.ts
- [x] 🔴 Rules: client cannot change `group.currency` (T10) — covered by firebase/tests/rules/groups.test.ts
- [x] 🔴 Rules: **positive** cases — a member _can_ read the group and update its name — covered by firebase/tests/rules/groups.test.ts
- [ ] 🟡 Integration: accepting a request is idempotent and writes both sides
- [ ] 🟡 Integration: `redeemInvite` rejects expired/used tokens; double-redeem succeeds
- [ ] 🟡 Integration: `leaveGroup` refuses at non-zero balance
- [ ] 🟡 E2E **E2**: create group → invite link → second user joins → appears in member list

---

## Exit criteria

- [ ] Create a group, add a member by invite, see them in the list
- [ ] Add a friend by email; both sides see each other; an implicit group exists
- [ ] Leave/remove correctly blocked at non-zero balance (stub a balance to test)
- [ ] Implicit friend groups never appear in `/groups`
- [ ] All Phase 05 rules tests pass, denials **and** positives
- [ ] `pnpm verify` green
