# Phase 04 — Design System & App Shell

**Est. 2 days.** Depends on 01. Can overlap Phase 03.
Reference: [../docs/07-ui-ux-spec.md](../docs/07-ui-ux-spec.md)

Every item here is written to satisfy the mobile-portability contract. Shortcuts taken in
this phase are paid back with interest in Phase 12.

---

## 1. Tokens

- [x] 🔴 `core/src/theme/tokens.ts` — the full object from the UI spec (colour, space,
      radius, font, size, z). **Plain TS, no CSS.**
- [x] 🔴 `darkTokens` with identical keys
- [x] 🔴 Build step emitting tokens as CSS custom properties on `:root`
- [x] 🔴 System theme via `prefers-color-scheme` — **no in-app toggle in v1**
- [ ] 🟡 ESLint rule (or review discipline) banning hard-coded colours/px in components
- [x] 🟡 ⚠️ **Verify contrast before committing to the palette.** `#1CC29F` on white is
      ~2.3:1 and **fails WCAG AA for body text** (NFR-5). Use `primaryDark` `#159E82` for
      text, and reserve the bright teal for large text, icons, and fills.

## 2. Primitives 🔴 _Platform-neutral names — this is what makes screens portable_

- [x] 🔴 `<Screen>` — safe-area padding, flex column
- [x] 🔴 `<Stack>` / `<Row>` — the **only** layout primitives. Flexbox only, no Grid.
- [x] 🔴 `<Text>` — variants `title`/`body`/`caption`/`amount`
- [x] 🔴 `<Pressable>` — enforces the 44×44 minimum (NFR-4)
- [x] 🔴 `<Button>` — `primary`/`secondary`/`ghost`/`danger`, loading + disabled states
- [x] 🔴 `<Input>` — label, error, helper text
- [ ] 🔴 `<AmountInput>` — 🔴 **outputs `MinorUnits`, never a float.** `inputMode="decimal"`,
      currency prefix, rejects excess decimal places
      — **the behaviour exists, the primitive does not.** `apps/web/src/screens/expense/amount.ts`
      does the work correctly (digit strings only, no `parseFloat`, no `× 100`, a documented
      grammar for `,` vs `.`, and a throw rather than a round on excess decimals), but it is a
      helper an ordinary `<Input>` is wired to, in a screen folder. Two consequences: nothing
      stops the next amount field being wired up differently, and the parser is unreachable
      from Cloud Functions and the mobile app. Its own header records the intended home —
      `parseAmount` in `packages/core/src/utils/money.ts`, per docs/04 §1.
- [x] 🔴 `<Money>` — 🔴 **the only place currency is formatted.** Takes minor units +
      currency, applies positive/negative colour and tabular figures
- [x] 🔴 `<List>` — **every list renders through this** so it can become `FlatList`
- [x] 🔴 `<ListRow>` — leading / title / subtitle / trailing / chevron
- [x] 🟡 `<Avatar>` — initials fallback, deterministic colour from uid
- [x] 🟡 `<AvatarStack>` — overlapping with "+N"
- [x] 🟡 `<Sheet>` — bottom sheet under 640px, centred dialog above
      — shipped as a **layout route** (`navigation/ModalLayout.tsx`) rather than a component,
      because docs/07 also requires modals to be real routes so back and deep links work. It
      carries `role="dialog"` + `aria-modal`. One deliberate gap, recorded on the file: no
      scrim over the previous screen, since React Router's background-location trick has no
      React Navigation equivalent and would be discarded in Phase 12.
- [x] 🟡 `<SegmentedControl>` — for the split-method picker
- [ ] 🟡 `<Chip>`, `<EmptyState>`, `<Skeleton>`, `<Toast>` — **`<Chip>` and `<EmptyState>` done;
      `<Skeleton>` and `<Toast>` were never built.** Both absences are load-bearing further on:
      no `<Skeleton>` means phase-09 §1 cannot have skeleton loaders, and no `<Toast>` host
      means phase-09 §2's 5-second undo-before-commit has nowhere to live.
- [ ] 🟢 A `/dev/components` gallery route to eyeball every state at once — not built, and it is
      the missing half of two exit criteria below.

> 🔴 **Every primitive that merges a caller's `className` goes in `@layer primitives`.
> Consumer rules stay unlayered.** The layer order is declared once at the top of
> `apps/web/src/styles/reset.css`, and `styles/__tests__/cascadeLayers.test.tsx` holds it.
>
> This is not a style preference. A primitive's base class and the class a caller passes it
> land on the same element with identical specificity, so before layers the cascade fell
> back to **source order — which is CSS-module import order, something nobody chose**.
> `layout.module.css` happened to load last, so `.stack` beat every class ever passed to a
> `<Stack>`. Measured on the running app: **41 declarations silently dropped.** The tab bar
> put its icons beside the labels so every label wrapped mid-word, the active tab was the
> same colour as the inactive ones, the raised Add button lost its pill and its fill, and
> every empty state was top-aligned with no gap and no padding.
>
> None of it was visible to a test — happy-dom applies no stylesheet and computes no layout —
> and none of it was a mistake in any individual rule.
>
> ⚠️ Watch the **shorthand/longhand** trap too: `.stack` declares `padding`, which overrides
> a consumer's `padding-block`/`padding-inline` even though the property names differ.

## 3. App shell & navigation

- [x] 🔴 `apps/web/src/navigation/routes.ts` — **one typed route table**, the full set from
      the UI spec
- [x] 🔴 `<AppShell>` — header + `flex: 1` content + bottom tab bar
- [x] 🔴 Bottom tab bar: Groups · Friends · **Add (raised)** · Activity · Account
- [x] 🔴 ⚠️ Layout uses **`100dvh` or a flex column shell, never `100vh`** — `vh` lies on
      mobile browsers with dynamic chrome
- [x] 🔴 Modal routes are real routes (back button and deep links must work)
- [x] 🟡 Max-width 640px centred column above the phone breakpoint
- [x] 🟡 Safe-area insets via `env(safe-area-inset-*)` behind a token
- [ ] 🟡 Scroll restoration per route — React Router's `<ScrollRestoration />` is deliberately
      **not** used (this app scrolls inside `.screenBody`, not the document, so there is nothing
      at document level to restore). The per-route equivalent on the screen body is still owed;
      the TODO is on `AppShell.tsx`.
- [ ] 🔴 Route-level code splitting — **not done, and it stopped being 🟢.** Nothing in
      `routes.tsx` is `lazy()`, so `firebaseui` + `firebase/compat` ship to every user on every
      visit and the main chunk measures **418 KB gzipped against a 350 KB budget** (NFR-2).
      See checklists/phase-09-polish-pwa.md §6.

## 4. Cross-cutting states

- [ ] 🟡 `<ErrorBoundary>` with a real recovery action
- [ ] 🟡 Skeleton loaders for list screens — **not spinners** (UI spec interaction rule 2)
- [ ] 🟡 Global toast host
- [ ] 🟡 Offline banner driven by Firestore's connection state
- [ ] 🟡 404 screen

## 5. Portability audit 🔴 _Do this now, not in Phase 12_

- [x] 🔴 Grep the codebase: **zero** `display: grid`, `float`, `100vh`
- [ ] 🔴 Zero hover-only affordances — everything reachable by tap
- [x] 🔴 Zero hard-coded colours or spacing outside `tokens.ts`
- [x] 🔴 No `window`/`document`/`localStorage` outside `apps/web`
- [ ] 🟡 Every component maps to a documented RN equivalent
      ([../docs/11-mobile-port.md](../docs/11-mobile-port.md))

## 6. Accessibility baseline

- [ ] 🟡 Every interactive element has an accessible name
- [ ] 🟡 Visible focus rings; full keyboard navigation (NFR-6)
- [x] 🟡 `prefers-reduced-motion` respected
- [x] 🟡 Colour is never the only signal — always pair with "you owe" / "owes you"
- [ ] 🟡 `axe-core` wired into the test setup (NFR-5)

---

## Exit criteria

- [ ] Component gallery renders every primitive in every state, light and dark
- [ ] App shell navigates between all five tabs with placeholder screens
- [ ] No horizontal scroll at 390×844 (NFR-3)
- [ ] Portability audit (§5) is clean
- [ ] `axe-core` reports no critical violations on the gallery
- [x] `pnpm verify` green
