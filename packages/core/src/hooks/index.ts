/**
 * `@splitsutra/core` hooks barrel — React hooks over the repositories.
 *
 * Skeleton only. Hooks live in core rather than in `apps/web` because React itself runs on React
 * Native: a hook here is ~95% portable, while the same logic inside a screen is not
 * (docs/11-mobile-port.md). `react` is an optional peer dependency of this package; `react-dom`
 * and `react-native` are forbidden (Article II).
 *
 * A hook may import repositories, domain, and types. It must never call Firestore directly.
 *
 * What lands here:
 * - **Phase 03** — `useAuth.ts` — checklists/phase-03-auth.md.
 * - **Phases 05–08** — the subscription hooks over each repository (`useGroups`, `useGroup`,
 *   `useExpenses`, `useBalances`, `useActivity`).
 */

// populated in Phase 03
export {};
