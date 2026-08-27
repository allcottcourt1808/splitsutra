/**
 * `@splitsutra/core` stores barrel — Zustand stores for **ephemeral UI state only**.
 *
 * Skeleton only. Zustand was chosen for being tiny, context-free, and React Native compatible
 * (docs/02-architecture.md). Server state lives in Firestore and reaches the UI through the
 * repositories and hooks; nothing derived from the ledger belongs in a store.
 *
 * 🔴 Never mirror a balance here. Article III: the server owns the truth about balances, and a
 * cached copy in client state is a copy that goes stale silently.
 *
 * What lands here:
 * - **Phase 04** — the toast queue behind the global toast host
 *   (checklists/phase-04-design-system.md), and the colour-scheme preference.
 * - **Phase 06** — the in-progress expense draft, so the split editor survives a navigation.
 */

// populated in Phase 04
export {};
