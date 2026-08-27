/**
 * `@splitsutra/core` — the platform-agnostic heart of SplitSutra.
 *
 * Everything here compiles with `"lib": ["ES2022"]` and no DOM (Article II), so the same code
 * runs in the web app today and in the React Native app in Phase 12. Platform capabilities arrive
 * through the injected `PlatformAdapter`, never through a global.
 *
 * This root barrel is what `apps/web` and `firebase/functions` import:
 *
 * ```ts
 * import { computeBalances, expenseSchema, tokens, type Expense } from '@splitsutra/core';
 * ```
 *
 * Subpath entries exist for the same modules (`@splitsutra/core/types`, `/domain`, `/theme`, …) — see
 * the `exports` map in `packages/core/package.json`. Prefer them in code that only needs one
 * layer; the root barrel is the convenience surface.
 *
 * `src/firebase`, `src/repositories`, `src/hooks`, and `src/stores` are deliberately **not**
 * re-exported yet: they are empty skeletons until the phases that fill them. Adding them here
 * before they hold anything would put a runtime Firebase import in the path of every consumer,
 * including Cloud Functions, which use the admin SDK instead.
 *
 * @see CONSTITUTION.md
 * @see docs/02-architecture.md
 */

/* ── Schemas, inferred types, and the Firestore read boundary ─────────────────────────────── */
export * from './types/index.js';

/* ── The money math: split engine, balances, debt simplification. Pure (Article VII). ─────── */
export * from './domain/index.js';

/* ── Design tokens as plain objects — no CSS, no StyleSheet (Article IX). ─────────────────── */
export * from './theme/index.js';

/* ── The one escape hatch out of core: the injected platform adapter (Article II). ────────── */
export * from './platform/index.js';

/* ── Formatting and validation helpers shared by both apps. ───────────────────────────────── */
export * from './utils/index.js';

/**
 * `SplitMethod` is declared twice on purpose, and the two declarations are identical unions of
 * `'equal' | 'exact' | 'percent' | 'shares'`:
 *
 * - `types/expense.ts` infers it from `splitMethodSchema`, the storage contract.
 * - `domain/splits.ts` declares it as a bare union, because the domain layer must not depend on
 *   Zod to stay pure and dependency-free (Article VII).
 *
 * Two `export *`s exporting the same name is ambiguous, so it is re-exported explicitly here —
 * the schema-backed one wins, since that is the one a consumer parsing a document gets back.
 */
export type { SplitMethod } from './types/index.js';
