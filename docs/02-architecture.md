# 02 — Architecture

## The one rule that matters

> **`packages/core` contains every line of logic that is not a pixel.
> `apps/*` contain every pixel and nothing else.**

This single boundary is what makes the future React Native app cheap. When you build
`apps/mobile`, you reuse `packages/core` unchanged and only rewrite views. Estimated
reuse: ~70% of total lines, and ~100% of the parts that are hard to get right (money
math, Firestore queries, balance logic).

NFR-10 enforces this mechanically in CI so it can't rot.

---

## Repository layout

```
splitsutra/
├── pnpm-workspace.yaml
├── package.json                 # workspace root, shared scripts
├── tsconfig.base.json           # shared strict TS config
├── .github/workflows/ci.yml
│
├── packages/
│   └── core/                    # @splitsutra/core — PLATFORM AGNOSTIC, NO DOM
│       ├── src/
│       │   ├── types/           # Zod schemas + inferred TS types (single source of truth)
│       │   ├── firebase/        # app init, injectable adapter
│       │   ├── repositories/    # all Firestore reads/writes live here, nowhere else
│       │   ├── domain/          # split engine, debt simplification, money — PURE
│       │   ├── hooks/           # React hooks (React runs on RN too — safe)
│       │   ├── stores/          # Zustand stores for ephemeral UI state
│       │   ├── theme/           # design tokens as plain TS objects
│       │   └── utils/           # date, currency formatting, validation
│       └── package.json
│
├── apps/
│   ├── web/                     # @splitsutra/web — React 19 + Vite + TS
│   │   ├── src/
│   │   │   ├── screens/         # one folder per screen in 07-ui-ux-spec.md
│   │   │   ├── components/      # design-system primitives
│   │   │   ├── navigation/      # React Router config + AppShell
│   │   │   └── auth/            # FirebaseUI mount — WEB ONLY, does not port
│   │   └── vite.config.ts
│   └── mobile/                  # Phase 12 — does not exist yet
│
└── firebase/
    ├── firebase.json
    ├── .firebaserc
    ├── firestore.rules
    ├── firestore.indexes.json
    └── functions/               # @splitsutra/functions — Node 24, TS, Gen 2
        └── src/
```

---

## Layer responsibilities

| Layer            | Location                            | May import                    | May NOT import                           |
| ---------------- | ----------------------------------- | ----------------------------- | ---------------------------------------- |
| **Domain**       | `core/src/domain`                   | nothing but its own types     | Firebase, React, anything I/O            |
| **Repositories** | `core/src/repositories`             | Firebase SDK, domain, types   | React, any UI                            |
| **Hooks/Stores** | `core/src/hooks`, `core/src/stores` | repositories, domain, `react` | `react-dom`, `react-native`, DOM globals |
| **Screens**      | `apps/web/src/screens`              | core hooks, components        | Firebase SDK **directly**                |
| **Components**   | `apps/web/src/components`           | core theme tokens             | repositories, Firebase                   |

**Screens never call Firestore directly.** If a screen imports `firebase/firestore`, that
is a bug — it means logic escaped into the UI layer and won't port to mobile.

The domain layer being pure and I/O-free is what makes the money math trivially testable:
no emulator, no mocks, just functions.

---

## Data flow

```
  UI event  →  hook (core)  →  repository (core)  →  Firestore write
                                                          │
                                                          ▼
                                              Cloud Function trigger
                                                          │
                                              recompute balances (txn)
                                                          │
                                                          ▼
  UI re-renders  ←  hook onSnapshot  ←──────────  Firestore realtime push
```

Balances are **derived server-side, pushed to clients, and read-only to clients.** The
client never computes an authoritative balance. It may compute an optimistic one for
instant feedback, which the server value then overwrites.

---

## Technology choices

| Concern         | Choice                                             | Why this and not the alternative                                                                                                                             |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package manager | **pnpm**                                           | Real workspace support; strict linking catches phantom deps that would break the mobile build                                                                |
| Build (web)     | **Vite**                                           | Fast HMR, first-class TS, trivial env handling                                                                                                               |
| Language        | **TypeScript, `strict: true`**                     | Money bugs are type bugs; non-negotiable                                                                                                                     |
| UI framework    | **React 19**                                       | Shares the mental model and hook code with React Native                                                                                                      |
| Routing         | **React Router v7** (declarative)                  | Route table maps 1:1 onto React Navigation later                                                                                                             |
| Server state    | **Firestore `onSnapshot` + custom hooks**          | Firestore already _is_ a realtime sync engine. Wrapping it in TanStack Query fights that. Custom `useDoc`/`useCollection` hooks are ~80 lines and work on RN |
| Client state    | **Zustand**                                        | Tiny, no context tree, RN-compatible                                                                                                                         |
| Forms           | **react-hook-form + Zod**                          | Both RN-compatible; Zod schemas are shared with Functions for one validation source                                                                          |
| Styling (web)   | **CSS Modules + CSS custom properties**            | Tokens are one TS object, emitted as CSS vars for web and consumed directly by RN `StyleSheet` later. Tailwind would not port                                |
| Money           | **`bigint`-free integer minor units**              | See [04-split-engine.md](04-split-engine.md)                                                                                                                 |
| Testing         | Vitest, `@firebase/rules-unit-testing`, Playwright | See [09-testing.md](09-testing.md)                                                                                                                           |

### Why not Tailwind

Tailwind class strings are meaningless to React Native. A token object
(`theme/tokens.ts`) consumed two ways — as CSS variables on web, as a `StyleSheet`
factory on mobile — keeps the two apps visually identical for free. This is the main
styling constraint and it is deliberate.

---

## The mobile-portability contract

Everything below is a hard rule in `apps/web`, enforced by lint where possible. Each one
exists because violating it creates rework in Phase 12.

1. **Layout with flexbox only.** No CSS Grid, no `float`, no `position: absolute` for
   layout (fine for badges/overlays). Yoga (RN's layout engine) only implements flexbox.
2. **No hover-only affordances.** Anything reachable by hover must also be reachable by
   tap. Hover is a progressive enhancement.
3. **No `100vh`.** Use `100dvh`, or better, a flex column shell — mobile browser chrome
   makes `vh` lie.
4. **Design tokens only.** No hard-coded colours, spacings, radii, or font sizes in
   components. If it isn't in `tokens.ts`, it doesn't exist.
5. **Navigation via a route table.** All routes declared in one file with typed params.
   React Navigation consumes the same shape.
6. **Touch targets at least 44x44 px**, always.
7. **No DOM APIs in shared code.** `window`, `document`, `localStorage` may appear in
   `apps/web` only. Core uses injected adapters for anything platform-specific.
8. **Semantic component names, not web names.** `<Screen>`, `<Row>`, `<Stack>`,
   `<Text>`, `<Pressable>` — not `<div>` soup. Each maps to an RN primitive.
9. **Lists render through one `<List>` abstraction** so it can become `FlatList`.
10. **Safe-area padding via a token**, not a magic number.

---

## Platform adapter pattern

Where core genuinely needs a platform capability, it takes an injected adapter rather
than reaching for a global. Set once at app startup.

```ts
// packages/core/src/firebase/adapter.ts
export interface PlatformAdapter {
  getAuthPersistence(): Persistence; // browserLocal on web, AsyncStorage on RN
  share(payload: { title: string; url: string }): Promise<void>;
  openUrl(url: string): Promise<void>;
}
```

Known platform-specific surfaces (there should be very few):

- Auth persistence mechanism
- Share sheet (Web Share API vs RN `Share`)
- Image picker (deferred with receipts)
- Push token registration (deferred)

---

## Authentication architecture

**FirebaseUI was evaluated and dropped** — see [19-qa-log.md](19-qa-log.md) Q17 / R7.
`firebaseui@6.1.0` supports Firebase JS SDK 9–10 only; `pnpm install` reports it as an
unmet peer against SDK 11. It is also web-only, so Phase 12 would have needed hand-written
native screens regardless. Auth uses the **modular `firebase/auth` SDK** throughout.

```
apps/web/src/auth/**                      ← the ONLY place firebase/auth is called
        │  email+password · phone (SMS OTP) · Google
        ▼
packages/core/src/hooks/useAuth.ts        ← platform-agnostic: user, loading, signOut
        │
        ▼
Every other screen in the app
```

The rest of the app knows only `useAuth()`. Consequences:

- Phase 12 writes native login screens against the **same `useAuth` contract** — the
  contract is what ports, not the screens, and that was always true.
- No `firebase/compat` anywhere. The dependency-cruiser rule `no-firebaseui-or-compat`
  is a **blanket ban**, not a carve-out, so the shim cannot re-enter through any path.
- Phone OTP needs a `RecaptchaVerifier`, which is modular-SDK API, not compat. It stays
  inside `apps/web/src/auth/` and is code-split behind `/login`.
- Cost of the decision: roughly two days of screen work, most of it the phone-OTP flow.
  Benefit: the Firebase SDK line is no longer pinned two majors back, and sign-in UI is
  fully ours — which the "intuitive UI" requirement wanted anyway.

---

## Environments

| Env     | Firebase project  | Purpose                                    |
| ------- | ----------------- | ------------------------------------------ |
| `local` | emulator suite    | Day-to-day dev. No cloud cost, no real SMS |
| `dev`   | `splitsutra-dev`  | Deployed integration testing, real devices |
| `prod`  | `splitsutra-prod` | Real users                                 |

Config is injected via Vite env vars (`VITE_FIREBASE_*`). Firebase web config is **not
secret** — it is a public identifier. Security comes from Security Rules and App Check,
never from hiding the config.

---

## Known architectural risks

| Risk                                                      | Impact                      | Mitigation                                                                                                                       |
| --------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| ~~FirebaseUI abandoned~~ — **materialised, and resolved** | —                           | Dropped in Q17/R7. Auth is hand-written on the modular SDK; no third-party auth widget remains to abandon us                     |
| Cloud Function balance recompute lags under load          | Stale balances              | Recompute is transactional and idempotent; a callable `recomputeGroupBalances` repairs drift; nightly audit job flags mismatches |
| Firestore rules `get()` calls cost reads                  | Bill creep                  | Membership checked via `exists()` on a member doc; rules kept shallow; measured in Phase 10                                      |
| Denormalized display names drift                          | Stale names in UI           | Fan-out Function on profile update; names are cosmetic, never used for identity                                                  |
| Float creeping into money math                            | Wrong balances              | Integers everywhere + property test asserting balances sum to zero                                                               |
| Core accidentally imports DOM                             | Mobile port breaks silently | `dependency-cruiser` rule fails CI (NFR-10)                                                                                      |
