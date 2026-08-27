# Phase 04 — Design System & App Shell

**Est. 2 days.** Depends on 01. Can overlap Phase 03.
Reference: [../docs/07-ui-ux-spec.md](../docs/07-ui-ux-spec.md)

Every item here is written to satisfy the mobile-portability contract. Shortcuts taken in
this phase are paid back with interest in Phase 12.

---

## 1. Tokens

- [ ] 🔴 `core/src/theme/tokens.ts` — the full object from the UI spec (colour, space,
      radius, font, size, z). **Plain TS, no CSS.**
- [ ] 🔴 `darkTokens` with identical keys
- [ ] 🔴 Build step emitting tokens as CSS custom properties on `:root`
- [ ] 🔴 System theme via `prefers-color-scheme` — **no in-app toggle in v1**
- [ ] 🟡 ESLint rule (or review discipline) banning hard-coded colours/px in components
- [ ] 🟡 ⚠️ **Verify contrast before committing to the palette.** `#1CC29F` on white is
      ~2.3:1 and **fails WCAG AA for body text** (NFR-5). Use `primaryDark` `#159E82` for
      text, and reserve the bright teal for large text, icons, and fills.

## 2. Primitives 🔴 _Platform-neutral names — this is what makes screens portable_

- [ ] 🔴 `<Screen>` — safe-area padding, flex column
- [ ] 🔴 `<Stack>` / `<Row>` — the **only** layout primitives. Flexbox only, no Grid.
- [ ] 🔴 `<Text>` — variants `title`/`body`/`caption`/`amount`
- [ ] 🔴 `<Pressable>` — enforces the 44×44 minimum (NFR-4)
- [ ] 🔴 `<Button>` — `primary`/`secondary`/`ghost`/`danger`, loading + disabled states
- [ ] 🔴 `<Input>` — label, error, helper text
- [ ] 🔴 `<AmountInput>` — 🔴 **outputs `MinorUnits`, never a float.** `inputMode="decimal"`,
      currency prefix, rejects excess decimal places
- [ ] 🔴 `<Money>` — 🔴 **the only place currency is formatted.** Takes minor units +
      currency, applies positive/negative colour and tabular figures
- [ ] 🔴 `<List>` — **every list renders through this** so it can become `FlatList`
- [ ] 🔴 `<ListRow>` — leading / title / subtitle / trailing / chevron
- [ ] 🟡 `<Avatar>` — initials fallback, deterministic colour from uid
- [ ] 🟡 `<AvatarStack>` — overlapping with "+N"
- [ ] 🟡 `<Sheet>` — bottom sheet under 640px, centred dialog above
- [ ] 🟡 `<SegmentedControl>` — for the split-method picker
- [ ] 🟡 `<Chip>`, `<EmptyState>`, `<Skeleton>`, `<Toast>`
- [ ] 🟢 A `/dev/components` gallery route to eyeball every state at once

## 3. App shell & navigation

- [ ] 🔴 `apps/web/src/navigation/routes.ts` — **one typed route table**, the full set from
      the UI spec
- [ ] 🔴 `<AppShell>` — header + `flex: 1` content + bottom tab bar
- [ ] 🔴 Bottom tab bar: Groups · Friends · **Add (raised)** · Activity · Account
- [ ] 🔴 ⚠️ Layout uses **`100dvh` or a flex column shell, never `100vh`** — `vh` lies on
      mobile browsers with dynamic chrome
- [ ] 🔴 Modal routes are real routes (back button and deep links must work)
- [ ] 🟡 Max-width 640px centred column above the phone breakpoint
- [ ] 🟡 Safe-area insets via `env(safe-area-inset-*)` behind a token
- [ ] 🟡 Scroll restoration per route
- [ ] 🟢 Route-level code splitting

## 4. Cross-cutting states

- [ ] 🟡 `<ErrorBoundary>` with a real recovery action
- [ ] 🟡 Skeleton loaders for list screens — **not spinners** (UI spec interaction rule 2)
- [ ] 🟡 Global toast host
- [ ] 🟡 Offline banner driven by Firestore's connection state
- [ ] 🟡 404 screen

## 5. Portability audit 🔴 _Do this now, not in Phase 12_

- [ ] 🔴 Grep the codebase: **zero** `display: grid`, `float`, `100vh`
- [ ] 🔴 Zero hover-only affordances — everything reachable by tap
- [ ] 🔴 Zero hard-coded colours or spacing outside `tokens.ts`
- [ ] 🔴 No `window`/`document`/`localStorage` outside `apps/web`
- [ ] 🟡 Every component maps to a documented RN equivalent
      ([../docs/11-mobile-port.md](../docs/11-mobile-port.md))

## 6. Accessibility baseline

- [ ] 🟡 Every interactive element has an accessible name
- [ ] 🟡 Visible focus rings; full keyboard navigation (NFR-6)
- [ ] 🟡 `prefers-reduced-motion` respected
- [ ] 🟡 Colour is never the only signal — always pair with "you owe" / "owes you"
- [ ] 🟡 `axe-core` wired into the test setup (NFR-5)

---

## Exit criteria

- [ ] Component gallery renders every primitive in every state, light and dark
- [ ] App shell navigates between all five tabs with placeholder screens
- [ ] No horizontal scroll at 390×844 (NFR-3)
- [ ] Portability audit (§5) is clean
- [ ] `axe-core` reports no critical violations on the gallery
- [ ] `pnpm verify` green
