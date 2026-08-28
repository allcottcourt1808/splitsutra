/**
 * The Firebase Admin SDK handles the seed writes through, plus the one piece of
 * module-resolution ugliness this script needs and the reason for it.
 *
 * ============================================================================
 * ⚠️ WHY `firebase-admin` IS NOT IMPORTED BY ITS BARE NAME
 * ============================================================================
 * `package.json` at the repo root runs this script (`"seed": "tsx firebase/seed.ts"`)
 * but declares neither `firebase-admin` nor `@splitsutra/core`. Under pnpm's strict
 * (non-hoisted) `node_modules`, a bare `import 'firebase-admin/app'` from `firebase/`
 * resolves nowhere: the only workspace package that declares the dependency is
 * `firebase/functions`, and its `node_modules` is not on this file's resolution path.
 *
 * So the runtime binding is taken through a `createRequire` anchored at
 * `firebase/functions/package.json` — the package that *does* declare it. That goes
 * through firebase-admin's own `exports` map, so the resolution is the real one and
 * not a guess at its internal layout.
 *
 * The **types** come from a type-only import of the deep path, because the `.d.ts`
 * files sit beside the CommonJS build that `require` resolves to and describe it
 * exactly. `import type` is erased, so it costs nothing at runtime.
 *
 * 🔴 This is a workaround for a missing dependency declaration, not a pattern.
 *    The fix is one line in the root `package.json`:
 *
 *        "devDependencies": { "firebase-admin": "^14.3.0", ... }
 *
 *    …after which the two casts below collapse into ordinary imports and this
 *    comment can be deleted. It was not made here because the seed script does not
 *    own the root manifest.
 *
 * `@splitsutra/core` is handled differently — see `dataset.ts`. It is imported by
 * **relative path into `packages/core/src`**, which needs no manifest entry, keeps
 * `pnpm seed` working on a clone where `packages/core/dist` has not been built yet,
 * and still resolves `zod` correctly (bare specifiers resolve relative to the
 * importing file, which is inside `packages/core`, which declares zod).
 */

import { createRequire } from 'node:module';

import type * as AdminApp from '../../functions/node_modules/firebase-admin/lib/app/index.js';
import type * as AdminAuth from '../../functions/node_modules/firebase-admin/lib/auth/index.js';
import type * as AdminFirestore from '../../functions/node_modules/firebase-admin/lib/firestore/index.js';

const requireFromFunctions = createRequire(
  new URL('../../functions/package.json', import.meta.url).href,
);

const appModule = requireFromFunctions('firebase-admin/app') as typeof AdminApp;
const authModule = requireFromFunctions('firebase-admin/auth') as typeof AdminAuth;
const firestoreModule = requireFromFunctions('firebase-admin/firestore') as typeof AdminFirestore;

/**
 * The admin `Timestamp` class.
 *
 * Structurally compatible with `timestampSchema` in core (`{ seconds, nanoseconds,
 * toDate() }`, checked structurally on purpose so the type layer stays free of a
 * runtime Firebase dependency), so documents built here parse through the same Zod
 * schemas the client reads them back with.
 */
export const Timestamp = firestoreModule.Timestamp;
export type Timestamp = AdminFirestore.Timestamp;

export type Firestore = AdminFirestore.Firestore;
export type Auth = AdminAuth.Auth;
export type DocumentData = AdminFirestore.DocumentData;
export type UserRecord = AdminAuth.UserRecord;

export interface AdminHandles {
  readonly db: Firestore;
  readonly auth: Auth;
}

/**
 * Initialises the Admin SDK against `projectId`.
 *
 * No credential is supplied. Against an emulator none is needed — the emulator host
 * environment variables are what route the traffic, and they are set by the guard
 * before this module is ever imported. Against a real project (`--allow-real-project`)
 * the SDK falls back to Application Default Credentials, which is the correct
 * behaviour: a seed script must never carry a service-account key of its own.
 */
export function initAdmin(projectId: string): AdminHandles {
  const existing = appModule.getApps();
  const app = existing[0] ?? appModule.initializeApp({ projectId });
  return { db: firestoreModule.getFirestore(app), auth: authModule.getAuth(app) };
}

/** Releases the SDK's gRPC/HTTP handles so `pnpm seed` exits instead of hanging. */
export async function shutdownAdmin(): Promise<void> {
  await Promise.all(appModule.getApps().map((app) => appModule.deleteApp(app)));
}
