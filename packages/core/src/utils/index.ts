/**
 * `@splitsutra/core` utils barrel — formatting and validation helpers shared by both apps.
 *
 * The folder exists now because `packages/core/package.json` publishes `@splitsutra/core/utils` and
 * the root barrel re-exports it. It is deliberately empty: nothing in the type or domain layers
 * needs a helper yet, and a utility written before it has a caller is a utility written against
 * a guessed signature (Article XII — measure before optimising).
 *
 * What lands here, and when:
 *
 * - **Phase 05** — `sha256` for the `usernames/{normalizedKey}` lookup key. Must work under
 *   React Native too, so Web Crypto with a checked fallback, not `node:crypto`
 *   (checklists/phase-05-friends-groups.md).
 * - **Phase 06** — `formatMoney(minorUnits, currency, locale)`, moved down from
 *   `apps/web/src/components/Money.tsx`. Cloud Functions render the same amounts into activity
 *   `summary` strings, and Article VI forbids a second implementation
 *   (checklists/phase-06-expenses-splits.md).
 * - **Phase 08** — `formatRelativeTime()` — "2h ago", "Yesterday", "12 Mar"
 *   (checklists/phase-08-activity-comments.md).
 *
 * 🔴 Whatever arrives here stays platform-agnostic: no `window`, no `document`, no `navigator`.
 * A locale is an argument, never something this layer reads off a global (Article II).
 */

// populated in Phase 05
export {};
