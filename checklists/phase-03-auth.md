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
- [x] 🔴 **Nothing outside `apps/web/src/auth/FirebaseUIMount.tsx` may import `firebaseui` or
      `firebase/compat`** — `firebaseui-only-in-web-auth` in `.dependency-cruiser.cjs`
      enforces it, narrowed from a directory carve-out to a **single file** now that §2 is
      built. Proven: a probe importing `firebase/compat/app` from anywhere else goes red.

> The behaviour is not in the hook. `core/src/hooks/authStore.ts` holds it, and holds it
> without React — core cannot depend on `react-dom` (Article II) and the `unit` vitest
> project runs on `node`, so a hook here has no renderer to be driven by. The store carries
> 23 tests; `useAuth.ts` is a `useSyncExternalStore` binding with no branches left in it.

## 2. FirebaseUI mount (web only) — ✅ **BUILT.** (reverses the earlier drop)

> **This section was previously marked DROPPED. That decision was reversed** on request, and
> the widget now renders `/login` — sign-in and sign-up both. What follows is what was actually
> built and what it costs; the original reasoning for dropping it is preserved at the bottom,
> because none of it turned out to be wrong — it was just outweighed.

- [x] 🔴 `pnpm --filter web add firebaseui@6.1.0 --save-exact` — **pinned exactly**, it is
      low-maintenance upstream (last publish 2023-08-02)
- [x] 🔴 ⚠️ **`react-firebaseui` NOT installed.** Abandoned, React 16 peers, breaks under
      StrictMode. `no-react-firebaseui` in `.dependency-cruiser.cjs` bans it outright.
- [x] 🔴 `apps/web/src/auth/FirebaseUIMount.tsx`:
  - mounts the vanilla widget on a `ref` inside `useEffect`
  - `AuthUI.getInstance() ?? new AuthUI(auth)` — **StrictMode double-mounts in dev and a
    second `new AuthUI()` throws**
  - `ui.reset()` on cleanup **and again before `start()`** — see the bug below
- [x] 🔴 Providers configured: Email/Password (`requireDisplayName: true`), Phone, Google
- [x] 🔴 `signInFlow: 'popup'` for Google (redirect loses state on some mobile browsers, and
      loses the `/invite/:token` destination the guard is holding)
- [x] 🔴 `firebase/compat` imported in **exactly one file** — enforced by
      `firebaseui-only-in-web-auth`
- [x] 🟡 `signInSuccessWithAuthResult` → return `false`; `<RedirectIfAuthed>` handles routing
- [ ] 🟡 Code-split the whole `/login` route so compat never loads for signed-in users (NFR-2)
- [ ] 🟡 Account linking so email + Google with the same address is one account (AC-A1.4)
- [ ] 🟢 Terms of service and privacy policy URLs

### 🔴 The bug this flushed out: `reset()` before `start()`, not only on teardown

Sign in, then sign out. The widget came back **empty, with an error where the form should be**,
and stayed broken until a full page reload. The `AuthUI` instance deliberately survives the
unmount — that is what `getInstance()` is for — and `start()` on one still holding the previous
mount's state throws instead of re-rendering.

A page reload hid it completely, which is why it would have survived any amount of local
clicking that started from a fresh tab: **the only broken path was the one a real user takes.**

### ⚠️ What this costs, recorded rather than glossed

`firebaseui@6.1.0` declares `peerDependencies: firebase "^9.1.3 || ^10.0.0"`; this project is on
firebase **12.18.0**. pnpm reports it as an unmet peer and installs it anyway:

```
└─┬ firebaseui 6.1.0
  └── ✕ unmet peer firebase@"^9.1.3 || ^10.0.0": found 12.18.0
```

It works because firebase 12 still ships `firebase/compat`, and because compat is a _wrapper_:
`firebase.initializeApp(config)` with the same config resolves to the `[DEFAULT]` app core
already created, so the widget and the rest of the app share one session. That is what makes
`authStore` see the sign-in and run `upsertUserProfile`.

Two things remain true from the original drop, and are now accepted costs rather than blockers:

1. **It is unsupported by version range.** A firebase major that removes `compat` breaks it.
   The blast radius is one file, by construction and by lint rule.
2. **It does not port.** docs/02 says so, and Phase 12 (React Native) still needs its own auth
   screens. This bought a working `/login` now and will be deleted, not ported.

<details>
<summary>The original reasoning for dropping it (kept for the record)</summary>

> `firebaseui@6.1.0` declares `peerDependencies: firebase "^9.1.3 || ^10.0.0"` and this
> project is on firebase 12, so it installs as an unmet peer, and upstream has shipped
> nothing for SDK 11 or 12. The deciding argument is in docs/02 itself: FirebaseUI is
> web-only and "does not port", so Phase 12 needs custom auth screens regardless — it would
> have bought a day now and charged it back later.

</details>

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

- [x] Email/password sign-**up** and sign-**in** driven end to end against the emulator:
      account created → `<RedirectIfAuthed>` moved to `/groups` → `users/{uid}` written with
      `displayName: "Emulator Tester"`, `defaultCurrency: "USD"`. Google and phone render and
      are configured, but neither was completed by hand — Google needs a real consent screen
      and the emulator sends no SMS (both are §8 manual checks)
- [x] A `users/{uid}` document appears on first sign-in and is not duplicated on the second —
      verified against the emulator's REST API: exactly one document after sign-up, sign-out
      and sign-in again
- [x] Session survives a hard refresh (AC-A1.7) — reloaded on `/account`, stayed signed in,
      no bounce through `/login`
- [x] Route guards work in both directions with no login-screen flash
- [x] `firebaseui` appears in exactly one file — confirmed by `pnpm depcruise`.
      ⚠️ The rule catches it via its `firebase/compat` import, not by the `firebaseui`
      specifier: dependency-cruiser does not resolve that package (no `exports` field), so
      that half of the pattern is inert. Noted in the rule's own comment rather than assumed
- [ ] `pnpm verify` green
