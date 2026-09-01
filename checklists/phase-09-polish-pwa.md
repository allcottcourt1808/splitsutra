# Phase 09 — Polish, Accessibility & PWA

**Est. 2 days.** Depends on 07, 08.
This is where the app stops feeling like a prototype. It also produces an installable PWA,
which is a genuinely usable stopgap "mobile app" before Phase 12.

---

## 1. Loading & empty states

- [ ] 🟡 Skeleton loaders on every list screen — **not spinners**. `<Skeleton>` was never
      built (phase-04 §2); list screens currently render nothing while loading.
- [x] 🟡 Every empty state offers the next action; no dead ends — enforced by the type, not by
      discipline: `EmptyStateProps.action` is **required**, so an empty state with no way out
      does not compile. Used on 11 screens.
- [ ] 🟡 Error states with a real retry, not just an error string — **4 of 13** subscription
      hooks expose `retry` (`useExpenses`, `useGroup`, `useGroupMembers`, `useSettlements`).
      The rest surface the error with no way to re-subscribe, so the only recovery is a reload.
- [ ] 🟡 Offline banner from Firestore's connection state
- [ ] 🟢 Illustrations for the main empty states — `EmptyState.glyph` is a single character
      standing in for one, with the TODO recorded on the prop.

## 2. Interaction polish

- [ ] 🟡 Optimistic UI on every write
- [ ] 🟡 Undo toasts on destructive actions (5s window before commit) — there is no `<Toast>`
      host. Undo exists where it is a **server** operation (`undoDeclineFriendRequest`), not as
      a client-side hold-before-commit.
- [ ] 🟡 Confirmation dialogs only for genuinely destructive, non-undoable actions
- [ ] 🟡 Pull-to-refresh on list screens
- [ ] 🟡 Haptic-style press feedback (scale/opacity) on `<Pressable>`
- [x] 🟢 Page transition animations, respecting `prefers-reduced-motion` — no transitions to
      animate yet, but the global honouring of the query is in `styles/reset.css` and is
      held by a test, so anything added later inherits it.
- [ ] 🟢 Keyboard-aware scrolling on the Add Expense form

## 3. Accessibility audit (NFR-4/5/6)

- [x] 🔴 ⚠️ **Re-verify the palette.** Done in Phase 04, and **this item's own recommendation
      was wrong**: `primaryDark` `#159E82` measures **3.36:1**, which also fails AA for body
      text — it only clears the 3:1 bar for large text and non-text UI. The palette is instead
      split into two roles: `primary`/`positive`/`negative`/`neutral`/`danger` for fills, icons
      ≥24px and borders; `primaryText`/`positiveText`/… (e.g. `primaryText` `#0B7C63`, 5.15:1)
      as the **only** colours permitted for text. Every ratio is tabulated in
      `packages/core/src/theme/tokens.ts` against both `bg` and `bgSubtle`.
- [ ] 🔴 `axe-core` clean on every screen — wire it into the Playwright run.
      `@axe-core/playwright` and `playwright.config.ts` are both present, but **`e2e/` does not
      exist**, so `pnpm test:e2e` and `pnpm test:smoke` currently run against nothing. See §11.
- [x] 🔴 Colour is never the only signal — pair with "you owe" / "owes you" wording
- [ ] 🟡 Full keyboard-only journey: sign in → create group → add expense → settle up
- [ ] 🟡 Screen-reader pass on the core loop (NVDA or VoiceOver)
- [ ] 🟡 Balance changes announced via a polite live region
- [ ] 🟡 Every icon-only button has an accessible name — 94 `aria-label`s across the app, but
      this has not been audited screen by screen, so it is not ticked.
- [x] 🟡 Verify all touch targets are ≥ 44×44 — enforced in `controls.module.css` rather than
      per-screen: `.pressable` sets the minimum, and the one documented relaxation (a full-row
      target) relaxes **width only**, never height. Held by `Pressable.test.tsx`.

## 4. Responsive

- [ ] 🟡 Verify 320px (small phones), 390px (target), 768px, 1280px
- [ ] 🟡 No horizontal scroll at any width (NFR-3)
- [ ] 🟡 Sheets: full-screen under 640px, dialogs above
- [ ] 🟢 Desktop sidebar nav above 1024px — **layered on top of the phone layout**, never a
      separate layout tree

## 5. PWA

- [x] 🟡 `vite-plugin-pwa` with an app manifest: name, short name, icons (192/512),
      `display: standalone`, theme colour
      — `apps/web/vite.config.ts`. Icons are **generated** by `apps/web/scripts/make-icons.mjs`
      (a dependency-free PNG encoder), so the marks are reproducible from source instead of
      checked in as binaries nobody can regenerate.
- [x] 🟡 A **separate** `maskable` icon entry, never `purpose: 'any maskable'` on one file —
      Android crops a maskable icon to 80% diameter, so one image cannot be right for both.
- [x] 🟡 Service worker caching the **app shell only** — 13 precache entries, verified against
      a real `pnpm build`.
- [x] 🔴 ⚠️ **Do not cache Firestore data in the service worker.** Firestore's own
      persistence already does this correctly; two caching layers will disagree and produce
      stale balances.
      — verified: **zero** `firestore`/`googleapis` references in the emitted `sw.js`. There is
      no `runtimeCaching` block at all, and the config says why so nobody adds one.
- [x] 🟡 `apple-touch-icon` + `apple-mobile-web-app-*` meta tags — iOS ignores the manifest for
      Add to Home Screen, so these are not redundant with §5.1.
- [ ] 🟢 iOS splash screens (`apple-touch-startup-image`) — needs one PNG per device size;
      deferred, the app launches without them.
- [x] 🟡 Update prompt when a new service worker is waiting — `apps/web/src/pwa/UpdatePrompt.tsx`.
      `registerType: 'prompt'`, never `autoUpdate`: this app's central screen is a form, and a
      silent bundle swap mid-edit is the one update behaviour it must not have.
- [x] 🟡 ⚠️ Mount the prompt **above the router**, not inside `<AppShell>` — inside the shell it
      sits behind the auth guard, so the worker only registers after sign-in and a first-time
      visitor on `/login` (exactly the person most likely to install) never could. Found by
      inspection, fixed in `main.tsx`.
- [ ] 🟡 🔴 **Verify "Add to Home Screen" on a real iOS Safari and a real Android Chrome.**
      NOT DONE and not doable from here: service-worker registration fails inside the Browser
      pane with "An unknown error occurred when fetching the script." That was proven
      environmental — a one-line control worker fails identically — and everything reachable
      _was_ checked (manifest served with `display: standalone` and `start_url: /groups`, three
      icons including the maskable, `apple-touch-icon` 200, shell-only precache). **Activation
      on a real device is untested.** This is the item that decides whether §5 actually shipped.
- [ ] 🟢 Offline fallback page — `navigateFallback: '/index.html'` means a deep link opened
      offline reaches the shell and the router, which is most of the value. A dedicated
      "you're offline" page is still unwritten.

## 6. Performance (NFR-1, NFR-2)

- [x] 🔴 Route-level code splitting — **done, and deliberately only for `/login`.** Splitting
      every screen was tried and measured: initial load would be ~323 KB against 346 KB for the
      one split, because the screens are **2–7 KB gzipped each** and nearly all the weight is a
      shared vendor chunk every route needs. Seventeen more `<Suspense>` boundaries — five of
      them on the tab bar — to save ~23 KB is a bad trade. The numbers are recorded in
      `routes.tsx` so the next person does not re-run the experiment.
- [x] 🔴 Confirm `/login` (and therefore `firebase/compat` + `firebaseui`) is split out —
      **now split.** `firebaseui@6.1.0` is still a dependency and `auth/FirebaseUIMount.tsx`
      still imports `firebase/compat/app`, `firebase/compat/auth`, `firebaseui` and its
      stylesheet — but `SignInScreen` is `lazy()` in `routes.tsx`, so all of it moved into a
      **74.7 KB gzipped chunk fetched only by someone who visits `/login`**. Before this, every
      signed-in user downloaded the whole sign-in widget on every visit to render a screen they
      would never see again.
      ⚠️ The `vite.config.ts` `optimizeDeps` comment asserting FirebaseUI had been dropped was
      **wrong** — it described a removal that was reversed, and it is why this item read as
      already-answered. Corrected.
- [x] 🔴 ⚠️ Bundle analysis; main chunk under 350 KB gzipped — **now under: 346,051 B**
      (was 419,269 B; 1,428,731 B raw). Enforced by `node scripts/bundle-budget.mjs`, wired into
      CI **after** `pnpm build`, and its failure path was exercised before being trusted.
      🔴 The gap this closes is narrower than it first looked, and worth stating correctly:
      **CI has always run `pnpm build`.** What it never did was _measure the output_.
      `chunkSizeWarningLimit: 300` printed a warning, warnings do not fail a build, and it sat in
      the log of a green job. The fix is the assertion, not the build.
      ⚠️ Headroom is **10.6 KB**. Route splitting cannot buy more — see the item above.

- [ ] 🟡 Lighthouse: performance ≥ 90, accessibility ≥ 95
- [ ] 🟡 FCP < 1.8s on simulated 4G
- [ ] 🟢 Preconnect to Firebase origins
- [ ] 🟢 Virtualise expense lists if a group exceeds ~500 visible rows
- [ ] 🟡 **Statically prerender the public pages** — landing, privacy policy, terms.
      These are the only pages with no auth requirement, they're needed for Google sign-in
      branding and store submission anyway, and static HTML costs nothing.
      **Not SSR** (ADR-02b) — plain build-time generation; the app itself stays a SPA.

## 7. Ad slots (layout only — no real ads yet)

Reference: [../docs/14-monetization-ads.md](../docs/14-monetization-ads.md) §5.
Real ads ship in Phase 13; building the slots now means nothing gets re-laid-out later.

- [ ] 🟡 `<AdSlot>` component that **reserves its height whether or not content loads**
- [ ] 🟡 Fills with a **house promo** ("Invite friends", "Get the app") for v1
- [ ] 🟡 Labelled "Ad", visually distinct from app content
- [ ] 🔴 **48dp minimum clearance** from every interactive control
- [ ] 🔴 ⚠️ **Zero slots** in Add Expense, the split sheet, or Settle Up
- [ ] 🟡 Positions: group list every ~8 rows; activity feed every ~10 entries; anchored
      above the tab bar on list screens only
- [ ] 🟡 Verify **zero layout shift** when a slot fills

## 8. Usability testing 🔴 _The item that decides whether "intuitive" is real_

Protocol and targets: [../docs/15-usability.md](../docs/15-usability.md).

- [ ] 🔴 Recruit **5 people who have never seen the app** — ideally people who currently
      split costs over WhatsApp
- [ ] 🔴 Run the 5 tasks. **Watch silently; do not help.**
- [ ] 🔴 Time task 1 (log a $3,000 dinner split three ways)
- [ ] 🔴 Target: **5/5 unassisted, under 30s first attempt**
- [ ] 🔴 Target: 5/5 correctly read who owes whom, without help
- [ ] 🔴 ⚠️ **Fix anything 2+ of 5 users hit.** That's a design defect, not an outlier.
- [ ] 🟡 Verify the 3-tap expense path holds with real users
- [ ] 🟡 Verify nobody thinks settle-up moves real money
- [ ] 🟡 Verify the debt-simplification explanation actually lands

## 9. Analytics for the core funnel

- [ ] 🟡 `expense_add_started` → `expense_add_completed` — **the most important metric in
      the app.** If it's under ~90%, stop building features and fix that screen.
- [ ] 🟡 `time_to_add_expense`, `split_method_selected`, `settle_up_completed`
- [ ] 🟢 `balance_breakdown_opened`, `simplify_explanation_viewed`

## 10. Copy & content

- [ ] 🟡 Consistent, human error messages — never a raw Firebase error code. Substantially
      done and still not audited end to end. Landed so far: the HTTP status no longer leaks
      into callable errors (#44); a `ZodError`'s serialised issue array can no longer reach a
      screen, and validation now runs on the field while it is typed rather than on submit
      (#48); "E.164" was removed from both phone messages in favour of the instruction, since
      naming the standard tells the user nothing they can act on (#48).
- [ ] 🟡 ⚠️ Every settle-up surface makes clear **no real money moves**
- [ ] 🟡 Currency formatting verified for all eight supported currencies
- [ ] 🟢 First-run onboarding (2–3 screens)
- [ ] 🟢 Favicon, OG tags, page titles per route — favicon done (`favicon.svg`, generated with
      the app icons); OG tags and per-route titles still missing.

## 11. Discovered while building §5 — not in the original plan

Found by inspection or measurement during the PWA work, 2026-08-31. Each one is a real gap,
not a suspicion.

- [ ] 🔴 **`e2e/` does not exist.** `playwright.config.ts` names `./e2e/specs` and `./e2e/smoke`
      and both directories are absent, so `pnpm test:e2e` and `pnpm test:smoke` are green by
      vacuum. Every E2E item in phases 05–09, and the `axe-core` sweep in §3, is blocked on
      this. `@axe-core/playwright` and `@playwright/test` are already installed.
- [ ] 🔴 **`firebase/tests/integration/` does not exist.** `pnpm test:integration` matches no
      files. The rules suite is real (9 files under `firebase/tests/rules/`); the integration
      suite the trigger items in phase-06 §8 and phase-07 depend on was never started.
- [x] 🟡 ~~CI does not build the web app.~~ **That was wrong — CI has always run `pnpm build`.**
      The real gap was that nothing measured the result: Vite's size warning does not fail a
      build, so a 69 KB breach lived in the log of a green job. Closed by
      `scripts/bundle-budget.mjs`, which reads what `dist/index.html` tells the browser to fetch
      before first paint and exits non-zero over budget. `pnpm verify` still does not build —
      that is deliberate, it is the fast local gate — so this check lives in CI only.
- [ ] 🟡 **Service-worker activation cannot be verified in the Browser pane.** Registration
      fails there with "An unknown error occurred when fetching the script", and a one-line
      control worker fails identically, so it is the sandbox and not the app. Every static
      artefact was verified instead. Real-device confirmation is the outstanding half of §5.
- [ ] 🟢 `apps/web/scripts/make-icons.mjs` has no test. It is deterministic and its output is
      committed, so a silent regression is visible in `git diff` — but nothing asserts the PNGs
      it writes are decodable.

---

## Exit criteria

- [ ] Lighthouse ≥ 90 performance, ≥ 95 accessibility
- [ ] `axe-core` clean across all screens
- [ ] Installable as a PWA on iOS and Android, launches standalone
- [ ] No horizontal scroll from 320px to 1280px
- [ ] Bundle within budget
- [ ] Full keyboard journey passes
- [ ] **5-user usability test passed at target**, with fixes applied for anything 2+ users hit
- [ ] Ad slots reserve height with zero layout shift; none in money-entry flows
- [ ] `pnpm verify` green
