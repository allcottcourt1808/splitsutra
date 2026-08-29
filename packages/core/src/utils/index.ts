/**
 * `@splitsutra/core` utils barrel — formatting and hashing helpers shared by both apps and by
 * the Cloud Functions.
 *
 * `packages/core/package.json` publishes this as `@splitsutra/core/utils`, and the root barrel
 * re-exports it, so everything below is on the package's public surface.
 *
 * What lives here, and why it lives *here* rather than in the app that first needed it:
 *
 * - `sha256` — the `usernames/{normalizedKey}` lookup key. Web Crypto with a checked fallback,
 *   never `node:crypto`, because core must run under React Native
 *   (checklists/phase-05-friends-groups.md §5).
 * - `formatMoney(minorUnits, currency, locale)` — moved down from
 *   `apps/web/src/components/Money.tsx`. Cloud Functions render the same amounts into activity
 *   `summary` strings, and Article VI forbids a second implementation
 *   (checklists/phase-06-expenses-splits.md §1).
 * - `formatRelativeTime()` — "2h ago", "Yesterday", "12 Mar"
 *   (checklists/phase-08-activity-comments.md §4).
 *
 * 🔴 Everything here is platform-agnostic: no `window`, no `document`, no `navigator`. A locale
 * is an argument, never something this layer reads off a global (Article II). The one platform
 * capability that is genuinely unavoidable — Web Crypto — is probed at the point of use and
 * fails loudly rather than being assumed.
 *
 * 🔴 And nothing here asks ICU for an answer that affects a number. See `./money.js` for what
 * `Intl.NumberFormat` does to JPY on a trimmed Hermes build.
 *
 * Re-exported with `export *` rather than named lists, matching `../types/index.ts`, so the
 * barrel cannot silently fall behind a module that grows a new export.
 */

/** `sha256` — hex digest for the `usernames/` index. Async; Web Crypto has no sync digest. */
export * from './crypto.js';

/** `formatMoney` — the ONLY currency formatter (Article VI). Exponent from the ISO table. */
export * from './money.js';

/** `formatRelativeTime` — "Just now" / "42m ago" / "5h ago" / "Yesterday" / "12 Mar". */
export * from './time.js';
