/**
 * `@splitsutra/core` hooks barrel — React hooks over the repositories.
 *
 * Hooks live in core rather than in `apps/web` because React itself runs on React Native: a
 * hook here is ~95% portable, while the same logic inside a screen is not
 * (docs/11-mobile-port.md). `react` is an optional peer dependency of this package; `react-dom`
 * and `react-native` are forbidden (Article II, enforced by `core-is-platform-agnostic`).
 *
 * A hook may import repositories, domain, and types. It must never call Firestore directly.
 *
 * 🔴 Like `../repositories/index.ts`, this is **not** re-exported from the package root barrel.
 * It reaches Firebase through the repositories, and it imports `react` — neither of which
 * belongs in the path of a Cloud Function that imports `@splitsutra/core` for the split engine.
 * Consumers reach it through the `@splitsutra/core/hooks` subpath declared in `package.json`.
 *
 * What lands here next:
 * - **Phases 05–08** — the remaining subscription hooks (`useGroups`, `useGroup`,
 *   `useExpenses`, `useBalances`, `useActivity`).
 */

/**
 * The session state machine — plain TypeScript, no React, and where the tests are.
 *
 * Exported because route guards and other non-component callers legitimately need
 * `getAuthState()` outside the tree, and because `resetAuthStore()` is how a test starts from
 * a known session.
 */
export * from './authStore.js';

/** `useAuth()` — `{ user, profile, loading, error, signOut }` (phase-03 §1). */
export * from './useAuth.js';

/** `useProfile()` — the same profile, with a `loading` that accounts for the document. */
export * from './useProfile.js';

/** `useFriends()` — the established friendships, ordered by name (phase-05 §7). */
export * from './useFriends.js';

/** `useFriend()` — one friendship, or `null` once resolved as not-a-friend. */
export * from './useFriend.js';

/**
 * `useFriendRequests()` — the pending inbox and outbox.
 *
 * Also the in-app notification: `incomingCount` is what the Friends tab badges. docs/03 defers a
 * `notifications` collection with push, and this feature does not need one — the pending request
 * IS the notification, and it clears itself on every device the moment it is answered.
 */
export * from './useFriendRequests.js';
