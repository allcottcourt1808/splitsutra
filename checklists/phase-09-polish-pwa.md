# Phase 09 — Polish, Accessibility & PWA

**Est. 2 days.** Depends on 07, 08.
This is where the app stops feeling like a prototype. It also produces an installable PWA,
which is a genuinely usable stopgap "mobile app" before Phase 12.

---

## 1. Loading & empty states

- [ ] 🟡 Skeleton loaders on every list screen — **not spinners**
- [ ] 🟡 Every empty state offers the next action; no dead ends
- [ ] 🟡 Error states with a real retry, not just an error string
- [ ] 🟡 Offline banner from Firestore's connection state
- [ ] 🟢 Illustrations for the main empty states

## 2. Interaction polish

- [ ] 🟡 Optimistic UI on every write
- [ ] 🟡 Undo toasts on destructive actions (5s window before commit)
- [ ] 🟡 Confirmation dialogs only for genuinely destructive, non-undoable actions
- [ ] 🟡 Pull-to-refresh on list screens
- [ ] 🟡 Haptic-style press feedback (scale/opacity) on `<Pressable>`
- [ ] 🟢 Page transition animations, respecting `prefers-reduced-motion`
- [ ] 🟢 Keyboard-aware scrolling on the Add Expense form

## 3. Accessibility audit (NFR-4/5/6)

- [ ] 🔴 ⚠️ **Re-verify the palette.** `#1CC29F` on white is ~2.3:1 and fails AA for body
      text. Confirm `primaryDark` (`#159E82`) is used for text-sized elements.
- [ ] 🔴 `axe-core` clean on every screen — wire it into the Playwright run
- [ ] 🔴 Colour is never the only signal — pair with "you owe" / "owes you" wording
- [ ] 🟡 Full keyboard-only journey: sign in → create group → add expense → settle up
- [ ] 🟡 Screen-reader pass on the core loop (NVDA or VoiceOver)
- [ ] 🟡 Balance changes announced via a polite live region
- [ ] 🟡 Every icon-only button has an accessible name
- [ ] 🟡 Verify all touch targets are ≥ 44×44

## 4. Responsive

- [ ] 🟡 Verify 320px (small phones), 390px (target), 768px, 1280px
- [ ] 🟡 No horizontal scroll at any width (NFR-3)
- [ ] 🟡 Sheets: full-screen under 640px, dialogs above
- [ ] 🟢 Desktop sidebar nav above 1024px — **layered on top of the phone layout**, never a
      separate layout tree

## 5. PWA

- [ ] 🟡 `vite-plugin-pwa` with an app manifest: name, short name, icons (192/512),
      `display: standalone`, theme colour
- [ ] 🟡 Service worker caching the **app shell only**
- [ ] 🔴 ⚠️ **Do not cache Firestore data in the service worker.** Firestore's own
      persistence already does this correctly; two caching layers will disagree and produce
      stale balances.
- [ ] 🟡 `apple-touch-icon` + iOS splash screens
- [ ] 🟡 Verify "Add to Home Screen" on iOS Safari and Android Chrome
- [ ] 🟡 Update prompt when a new service worker is waiting
- [ ] 🟢 Offline fallback page

## 6. Performance (NFR-1, NFR-2)

- [ ] 🟡 Route-level code splitting
- [ ] 🟡 Confirm `/login` (and therefore `firebase/compat` + `firebaseui`) is split out
- [ ] 🟡 Bundle analysis; main chunk under 350 KB gzipped
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

- [ ] 🟡 Consistent, human error messages — never a raw Firebase error code
- [ ] 🟡 ⚠️ Every settle-up surface makes clear **no real money moves**
- [ ] 🟡 Currency formatting verified for all eight supported currencies
- [ ] 🟢 First-run onboarding (2–3 screens)
- [ ] 🟢 Favicon, OG tags, page titles per route

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
