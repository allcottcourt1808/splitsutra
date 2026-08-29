# Phase 03 — Authentication & Profiles

**Est. 1.5 days.** Depends on 01, 02.
Covers **AC-A1.1 → AC-A3.3**. Reference: ADR-03 in [../docs/12-decisions.md](../docs/12-decisions.md).

---

## 1. The auth abstraction 🔴 _Build this before touching FirebaseUI_

Getting the order right matters: define the contract first so FirebaseUI is plugged into
it, not the other way round.

- [x] 🔴 `core/src/hooks/useAuth.ts` exposing exactly:
      `{ user, profile, loading, error, signOut }` (PR #15)
- [x] 🔴 `core/src/repositories/authRepo.ts` — `onAuthStateChanged` wrapper, `signOut`,
      `getIdToken`
- [x] 🔴 Auth persistence set via the `PlatformAdapter` (`browserLocalPersistence` on web)
- [x] 🔴 **Nothing outside `apps/web/src/auth/` may import `firebaseui` or
      `firebase/compat`** — dependency-cruiser rule from Phase 01 enforces this. It is a
      **blanket ban** now rather than a carve-out for that directory: FirebaseUI was
      dropped entirely (§2), so nothing anywhere may import either.

> The behaviour is not in the hook. `core/src/hooks/authStore.ts` holds it, and holds it
> without React — core cannot depend on `react-dom` (Article II) and the `unit` vitest
> project runs on `node`, so a hook here has no renderer to be driven by. The store carries
> 23 tests; `useAuth.ts` is a `useSyncExternalStore` binding with no branches left in it.

## 2. FirebaseUI mount (web only) — 🔴 **DROPPED. Do not build this.** (Q17 / R7)

> `firebaseui@6.1.0` declares `peerDependencies: firebase "^9.1.3 || ^10.0.0"` and this
> project is on firebase 12, so it installs as an unmet peer, and upstream has shipped
> nothing for SDK 11 or 12. The deciding argument is in docs/02 itself: FirebaseUI is
> web-only and "does not port", so Phase 12 needs custom auth screens regardless — it would
> have bought a day now and charged it back later. Auth uses the **modular** `firebase/auth`
> SDK, in `apps/web/src/auth/`. The section below is kept only as the record of what was
> decided against; `no-firebaseui-or-compat` in `.dependency-cruiser.cjs` enforces it.

- [ ] 🔴 `pnpm --filter web add firebaseui` — **pin the exact version**, it is
      low-maintenance upstream
- [ ] 🔴 ⚠️ **Do NOT install `react-firebaseui`.** It's abandoned, declares React 16 peers,
      and breaks under React 18/19 StrictMode.
- [ ] 🔴 `apps/web/src/auth/FirebaseUIMount.tsx`:
  - Mount the vanilla widget on a `ref` inside `useEffect`
  - Use `firebaseui.auth.AuthUI.getInstance() ?? new firebaseui.auth.AuthUI(auth)` —
    **StrictMode double-mounts in dev and a second `new AuthUI()` throws**
  - Call `ui.reset()` on cleanup
- [ ] 🔴 Configure providers: Email/Password, Phone, Google
- [ ] 🔴 `signInFlow: 'popup'` for Google (redirect loses state on some mobile browsers)
- [ ] 🔴 Import `firebase/compat/*` **only** in this file
- [ ] 🟡 Code-split the whole `/login` route so compat never loads for signed-in users (NFR-2)
- [ ] 🟡 `signInSuccessWithAuthResult` → upsert profile → return `false` (we handle routing)
- [ ] 🟡 Enable account linking so email + Google with the same address is one account (AC-A1.4)
- [ ] 🟢 Terms of service and privacy policy URLs

## 3. Profile creation

- [x] 🔴 `core/src/repositories/userRepo.ts` → `upsertUserProfile()` (PR #15)
- [x] 🔴 Called on **every** app launch when authed, not only first sign-in — makes a
      missing profile self-healing (AC-A1.2, AC-A1.3). `authStore` runs it on every session
      emission, memoised per account, so a normal launch is one read and zero writes.
- [x] 🔴 Defaults: `displayName` from the provider (fallback to email local-part or the
      masked phone number), `defaultCurrency` from Q4
- [x] 🔴 Security rule: `users/{uid}` create/update only where `isSelf(uid)` (AC-A2.4) —
      `firestore.rules`, plus `ownsClaimedIdentity()` so a user cannot claim an email or
      phone they do not hold and hijack the friend-lookup entry for that person
- [x] 🟡 `useProfile()` hook, subscribed via `onSnapshot` — a selector over `useAuth`, not a
      second subscription. What it adds is a `loading` that separates "signed out" from
      "signed in, document still in flight", which look identical at the call site.

> 🔴 It is **not** one `setDoc(…, { merge: true })`. Create and update are different
> operations to Rules and no single payload satisfies both — create demands
> `createdAt == request.time`, update demands `!changed(['uid','createdAt'])`. A merge
> carrying `serverTimestamp()` is a create that works and an update that is denied.

## 4. Route guarding

- [x] 🔴 `<RequireAuth>` wrapper → redirect to `/login` (AC-A1.5)
- [x] 🔴 `<RedirectIfAuthed>` on `/login` → `/groups` (AC-A1.6)
- [x] 🔴 A real loading state while auth resolves — **not a flash of the login screen**,
      which is the most common bug in this area
- [x] 🟡 Preserve the intended destination through login (deep link to `/invite/:token`
      must survive, AC-B3.3)

> Both guards are **layout routes** in `apps/web/src/routes.tsx`, so membership is structural
> rather than a wrapper somebody has to remember: a screen is nested under `<RequireAuth>` or it
> is not, and `routes.test.tsx` asserts that every URL except `/login` is.
>
> 🔴 The flash comes from collapsing `useAuth`'s **three** states into two. `loading: true` with
> `user: null` means "nobody knows yet", and it is what every hard refresh looks like for its
> first tick while Firebase rehydrates from persistence. A guard that redirects then has already
> destroyed the destination by the time the answer arrives.
>
> The destination rides in `location.state`, not a `?next=` query parameter — an invite path
> carries a token, and a query parameter is editable, shareable and logged by anything that
> records URLs. It is `safeDestination()`-checked before use: `//evil.example` and
> `/\evil.example` both start with `/` and both resolve to another origin, so a
> `startsWith('/')` check turns our own sign-in into an open redirector.

## 5. Profile screens

- [x] 🟡 `/account` — profile summary, default currency, sign out
- [x] 🟡 `/account/profile` — edit display name (1–50 chars, trimmed, AC-A2.1)
- [x] 🟡 Currency picker from the fixed list (AC-A2.2) — a filter field over a list, not a
      `<select>`: 157 entries in a phone's scroll wheel has no search, and the list is built
      from `CURRENCIES` in core, never from `Intl.supportedValuesOf`
- [ ] 🟢 Avatar upload — **deferred**, requires Storage. Use initials avatars for now.

## 6. Cloud Function: `onUserProfileWritten`

- [ ] 🔴 Maintain the `usernames/{sha256(key)}` lookup index on create/update
- [ ] 🔴 Delete stale index docs when email or phone changes
- [ ] 🟡 Fan out `displayName`/`photoURL` to group member docs (AC-A2.3)
- [ ] 🔴 ⚠️ **Diff-guard the write-back** so the function cannot re-trigger itself into an
      infinite loop. Set `maxInstances`.

## 7. Sign out & account deletion

- [x] 🟡 Sign out clears state and routes to `/login` (AC-A3.1)

> `AccountScreen` calls `signOut()` and does **not** navigate. `<RequireAuth>` is watching the
> session, so clearing it un-renders every guarded route and the redirect happens for free. A
> `navigate()` there would be a second path to the same place that could disagree with the
> first, and it would race the session listener — on a slow tick the router lands on `/login`
> while the user is still technically signed in, and `<RedirectIfAuthed>` bounces them back.

- [ ] 🟢 `deleteAccount` callable — blocks on non-zero balances (AC-A3.2), anonymises the
      profile (AC-A3.3). **Can slip to Phase 10** if time is tight; nothing depends on it.

## 8. Tests

- [ ] 🔴 Rules test: a user cannot write another user's profile
- [ ] 🔴 Rules test: `list` on `usernames` is denied (threat T5)
- [ ] 🟡 Integration: `onUserProfileWritten` creates the right index entries
- [ ] 🟡 E2E **E1**: sign up with email → profile created → lands on `/groups`
- [ ] 🟡 Manual: real Google sign-in on a device
- [ ] 🟡 Manual: phone OTP with a test number, then once with a real number
- [ ] 🟡 Manual: account linking — email first, then Google, same address → one account

---

## Exit criteria

- [ ] All three providers sign in successfully against the emulator — **not yet driven by
      hand.** What is confirmed: the app boots against the emulator suite with no
      `auth/already-initialized`, and `/groups` redirects to `/login` for a signed-out
      visitor. Signing in through each of the three forms is still an unticked box
- [ ] A `users/{uid}` document appears on first sign-in and is not duplicated on the second
- [ ] Session survives a hard refresh (AC-A1.7)
- [x] Route guards work in both directions with no login-screen flash
- [x] `firebaseui` appears in **no** file — it was dropped (§2), and `no-firebaseui-or-compat`
      in `.dependency-cruiser.cjs` is now a blanket ban rather than a carve-out
- [ ] `pnpm verify` green
