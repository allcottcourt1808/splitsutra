# Phase 03 — Authentication & Profiles

**Est. 1.5 days.** Depends on 01, 02.
Covers **AC-A1.1 → AC-A3.3**. Reference: ADR-03 in [../docs/12-decisions.md](../docs/12-decisions.md).

---

## 1. The auth abstraction 🔴 _Build this before touching FirebaseUI_

Getting the order right matters: define the contract first so FirebaseUI is plugged into
it, not the other way round.

- [ ] 🔴 `core/src/hooks/useAuth.ts` exposing exactly:
      `{ user, profile, loading, error, signOut }`
- [ ] 🔴 `core/src/repositories/authRepo.ts` — `onAuthStateChanged` wrapper, `signOut`,
      `getIdToken`
- [ ] 🔴 Auth persistence set via the `PlatformAdapter` (`browserLocalPersistence` on web)
- [ ] 🔴 **Nothing outside `apps/web/src/auth/` may import `firebaseui` or
      `firebase/compat`** — dependency-cruiser rule from Phase 01 enforces this

## 2. FirebaseUI mount (web only)

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

- [ ] 🔴 `core/src/repositories/userRepo.ts` → `upsertUserProfile()`
- [ ] 🔴 Called on **every** app launch when authed, not only first sign-in — makes a
      missing profile self-healing (AC-A1.2, AC-A1.3)
- [ ] 🔴 Defaults: `displayName` from the provider (fallback to email local-part or the
      masked phone number), `defaultCurrency` from Q4
- [ ] 🔴 Security rule: `users/{uid}` create/update only where `isSelf(uid)` (AC-A2.4)
- [ ] 🟡 `useProfile()` hook, subscribed via `onSnapshot`

## 4. Route guarding

- [ ] 🔴 `<RequireAuth>` wrapper → redirect to `/login` (AC-A1.5)
- [ ] 🔴 `<RedirectIfAuthed>` on `/login` → `/groups` (AC-A1.6)
- [ ] 🔴 A real loading state while auth resolves — **not a flash of the login screen**,
      which is the most common bug in this area
- [ ] 🟡 Preserve the intended destination through login (deep link to `/invite/:token`
      must survive, AC-B3.3)

## 5. Profile screens

- [ ] 🟡 `/account` — profile summary, default currency, sign out
- [ ] 🟡 `/account/profile` — edit display name (1–50 chars, trimmed, AC-A2.1)
- [ ] 🟡 Currency picker from the fixed list (AC-A2.2)
- [ ] 🟢 Avatar upload — **deferred**, requires Storage. Use initials avatars for now.

## 6. Cloud Function: `onUserProfileWritten`

- [ ] 🔴 Maintain the `usernames/{sha256(key)}` lookup index on create/update
- [ ] 🔴 Delete stale index docs when email or phone changes
- [ ] 🟡 Fan out `displayName`/`photoURL` to group member docs (AC-A2.3)
- [ ] 🔴 ⚠️ **Diff-guard the write-back** so the function cannot re-trigger itself into an
      infinite loop. Set `maxInstances`.

## 7. Sign out & account deletion

- [ ] 🟡 Sign out clears state and routes to `/login` (AC-A3.1)
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

- [ ] All three providers sign in successfully against the emulator
- [ ] A `users/{uid}` document appears on first sign-in and is not duplicated on the second
- [ ] Session survives a hard refresh (AC-A1.7)
- [ ] Route guards work in both directions with no login-screen flash
- [ ] `firebaseui` appears in exactly one file — confirmed by `pnpm depcruise`
- [ ] `pnpm verify` green
