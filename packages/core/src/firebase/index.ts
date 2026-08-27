/**
 * `@splitsutra/core` Firebase barrel — SDK initialisation and the shared app/Firestore/Auth handles.
 *
 * Skeleton only. This is the **one folder in core that holds a runtime Firebase import**; the
 * type layer takes its Firestore shapes with `import type` (see `src/types/converters.ts`) and
 * `src/domain/**` may not import Firebase at all (Article VII, enforced by
 * `.dependency-cruiser.cjs`).
 *
 * What lands here (checklists/phase-01-foundation.md §7):
 * - `init.ts` — `initializeApp` from env config, and the exported `db` / `auth` handles.
 * - Emulator wiring behind `VITE_USE_EMULATORS`, connecting to **`127.0.0.1`, not `localhost`**
 *   — the Node/IPv6 gotcha in docs/08-firebase-setup.md.
 * - Firestore offline persistence (`persistentLocalCache`).
 *
 * Not re-exported from the package root barrel until it holds something: a runtime Firebase
 * import in the root barrel would reach every consumer, Cloud Functions included, and those use
 * the admin SDK.
 */

// populated in Phase 01
export {};
