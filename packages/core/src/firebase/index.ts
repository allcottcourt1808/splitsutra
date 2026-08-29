/**
 * `@splitsutra/core` Firebase barrel — SDK initialisation and the shared app/Firestore/Auth handles.
 *
 * This is the **one folder in core that holds a runtime Firebase import**; the type layer takes
 * its Firestore shapes with `import type` (see `src/types/converters.ts`) and `src/domain/**`
 * may not import Firebase at all (Article VII, enforced by `.dependency-cruiser.cjs`).
 *
 * What lives here (checklists/phase-01-foundation.md §7):
 * - `init.ts` — `initializeApp` from injected config, and the `db` / `auth` / `functions`
 *   handles, reached through accessors so no config is ever read from a global (Article II).
 * - Emulator wiring behind the caller's `useEmulators` flag, connecting to **`127.0.0.1`, not
 *   `localhost`** — the Node/IPv6 gotcha in docs/08-firebase-setup.md, which `initFirebase`
 *   now refuses at startup rather than letting it fail as a phantom "emulator is down".
 * - Firestore offline persistence (`persistentLocalCache`), selectable so the React Native
 *   port — which has no IndexedDB — can ask for the memory cache without core knowing which
 *   platform it is on.
 *
 * 🔴 **Still not re-exported from the package root barrel**, and it must stay that way now
 * that it holds real code: a runtime Firebase import in the root barrel would reach every
 * consumer, Cloud Functions included, and those use the admin SDK. Consumers reach this
 * through the `@splitsutra/core/firebase` subpath export declared in `package.json`.
 *
 * Outside `src/repositories/**`, the only thing anything should import from here is
 * `initFirebase` — reaching for `getDb()` from a screen is Article VIII in a trench coat.
 */

export * from './init.js';
