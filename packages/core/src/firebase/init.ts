/**
 * Firebase SDK initialisation — the single place `initializeApp` is ever called.
 *
 * ## The config is an argument, never a global
 *
 * `import.meta.env` is a bundler feature. Vite has it, Metro does not, so a core module that
 * read it would break the Phase 12 port (Article II, docs/02 §contract rule 7). Reading the
 * environment is a *platform* capability: `apps/web/src/platform/firebaseEnv.ts` reads it and
 * hands the resulting plain object to {@link initFirebase}. The mobile app will read it from
 * `expo-constants` and call the same function with the same shape.
 *
 * ```ts
 * // apps/web/src/main.tsx, before createRoot().render()
 * setPlatformAdapter(webAdapter);
 * initFirebase({ config: readFirebaseConfig(), useEmulators: useEmulators() });
 * ```
 *
 * ## Handles are accessors, not module constants
 *
 * `export const db = getFirestore()` would run `initializeApp` as an import side effect, which
 * means the config would have to be a global — the thing this module exists to avoid. So the
 * handles are reached through {@link getDb}, {@link getAuthClient} and
 * {@link getFunctionsClient}, each of which throws a wiring error rather than returning
 * `undefined` if startup forgot to call {@link initFirebase}.
 *
 * @see checklists/phase-01-foundation.md §7
 * @see docs/08-firebase-setup.md
 */

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  initializeAuth,
  type Auth,
  type Persistence,
  type PopupRedirectResolver,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
  type FirestoreSettings,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';

import { getPlatformAdapter } from '../platform/index.js';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Config
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The Firebase web config, structurally.
 *
 * Declared here rather than imported as `FirebaseOptions` so the *required* fields are
 * required: `FirebaseOptions` marks every one of them optional, which would let a caller
 * hand over `{}` and fail later inside the SDK with `auth/invalid-api-key`.
 *
 * **Not secret.** Every value is a public identifier Google ships in the client bundle by
 * design; security comes from Security Rules and App Check (Article IV).
 *
 * `measurementId` is deliberately `?: string` and **not** `?: string | undefined`. Under
 * `exactOptionalPropertyTypes` those differ, and `FirebaseOptions` rejects a present key
 * holding `undefined` — so a caller must spread the key in conditionally, exactly as
 * `apps/web/src/platform/firebaseEnv.ts` already does.
 */
export interface FirebaseClientConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly storageBucket: string;
  readonly messagingSenderId: string;
  readonly appId: string;
  readonly measurementId?: string;
}

/**
 * Emulator endpoints, matching the `emulators` block in `firebase.json`.
 *
 * 🔴 **`127.0.0.1`, never `localhost`.** Node 18+ resolves `localhost` to IPv6 `::1` first and
 * the emulators bind IPv4, so `localhost` produces an `ECONNREFUSED` that reads exactly like a
 * suite that failed to start. This has cost people hours; {@link assertNotLocalhost} makes it
 * fail with an explanation instead (docs/08-firebase-setup.md).
 */
export interface EmulatorEndpoints {
  readonly authUrl: string;
  readonly firestoreHost: string;
  readonly firestorePort: number;
  readonly functionsHost: string;
  readonly functionsPort: number;
}

/** The endpoints declared in `firebase.json`. */
export const DEFAULT_EMULATORS: EmulatorEndpoints = {
  authUrl: 'http://127.0.0.1:9099',
  firestoreHost: '127.0.0.1',
  firestorePort: 8080,
  functionsHost: '127.0.0.1',
  functionsPort: 5001,
};

/**
 * How Firestore should cache documents locally.
 *
 * - `persistent` (default) — IndexedDB-backed, multi-tab. This is what makes the app usable
 *   offline and what lets a pending `serverTimestamp()` render optimistically (see the
 *   `SNAPSHOT_OPTIONS` note in `types/converters.ts`).
 * - `memory` — no durable cache. Correct for tests, for a Node process, and for any platform
 *   without IndexedDB.
 *
 * It is an option rather than a hardcoded call because `persistentLocalCache` needs IndexedDB,
 * which React Native does not have. Phase 12 passes `'memory'` (or whatever the SDK offers by
 * then) without core needing to know which platform it is on (Article II).
 */
export type LocalCacheMode = 'persistent' | 'memory';

/** Arguments to {@link initFirebase}. */
export interface InitFirebaseOptions {
  readonly config: FirebaseClientConfig;

  /**
   * Point Auth, Firestore and Functions at the local emulator suite.
   *
   * Driven by `VITE_USE_EMULATORS` on web — but read on the platform side and passed in, not
   * read here.
   */
  readonly useEmulators?: boolean | undefined;

  /** Override the emulator endpoints. Defaults to {@link DEFAULT_EMULATORS}. */
  readonly emulators?: EmulatorEndpoints | undefined;

  /** Firestore local cache strategy. Defaults to `'persistent'`. */
  readonly localCache?: LocalCacheMode | undefined;

  /**
   * Auth session persistence. Defaults to the installed `PlatformAdapter`'s
   * `getAuthPersistence()` — `browserLocalPersistence` on web, AsyncStorage-backed on RN
   * (AC-A1.7). Pass it explicitly only in tests, where installing an adapter is overkill.
   */
  readonly authPersistence?: Persistence | Persistence[] | undefined;

  /**
   * Required for `signInWithPopup` / `signInWithRedirect`.
   *
   * 🔴 `getAuth()` installs `browserPopupRedirectResolver` for you; `initializeAuth()` — which
   * is what this module calls, because it is the only entry point that accepts a persistence
   * strategy — does not. Without a resolver, Google sign-in fails at runtime with
   * `auth/operation-not-supported-in-this-environment`.
   *
   * Core cannot import the browser resolver itself: it is a DOM implementation, and importing
   * it here would put `window` in the mobile bundle's dependency graph. So `apps/web` passes
   * `browserPopupRedirectResolver` in, alongside the adapter.
   */
  readonly popupRedirectResolver?: PopupRedirectResolver | undefined;

  /**
   * Firebase app name. Defaults to the SDK's `[DEFAULT]`. Only useful for tests that need two
   * isolated apps in one process.
   */
  readonly name?: string | undefined;
}

/** The initialised SDK handles. */
export interface FirebaseHandles {
  readonly app: FirebaseApp;
  readonly db: Firestore;
  readonly auth: Auth;
  readonly functions: Functions;
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Initialisation
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Module state rather than a React context, for the same reason the platform adapter is:
 * repositories are plain functions that must be callable from outside the React tree.
 */
let handles: FirebaseHandles | null = null;

const DEFAULT_APP_NAME = '[DEFAULT]';

/**
 * Fail loudly on `localhost` instead of letting it fail confusingly later.
 *
 * The symptom `localhost` produces — a connection refused against a suite that is running
 * perfectly — is indistinguishable from "you forgot to start the emulators", which is where
 * everybody looks first.
 */
function assertNotLocalhost(where: string, value: string): void {
  if (value.includes('localhost')) {
    throw new Error(
      `[splitsutra] Emulator ${where} is "${value}". Use 127.0.0.1, not localhost: Node ` +
        'resolves localhost to IPv6 ::1 first and the emulators bind IPv4, so the connection ' +
        'is refused and it looks like the suite is down (docs/08-firebase-setup.md).',
    );
  }
}

/**
 * Initialise the Firebase SDKs. Call once, at app startup, **after**
 * `setPlatformAdapter()` and **before** anything reaches a repository.
 *
 * Idempotent: calling it again returns the handles from the first call and touches nothing.
 * That matters under React 19 StrictMode, which double-invokes effects in development —
 * `initializeFirestore` and `connectFirestoreEmulator` both throw when called twice on one app.
 *
 * @throws if no `PlatformAdapter` is installed and no `authPersistence` was supplied.
 * @throws if an emulator endpoint names `localhost`.
 */
export function initFirebase(options: InitFirebaseOptions): FirebaseHandles {
  if (handles !== null) return handles;

  const name = options.name ?? DEFAULT_APP_NAME;
  const existing = getApps().find((candidate) => candidate.name === name);
  const app =
    existing ??
    (options.name === undefined
      ? initializeApp(options.config)
      : initializeApp(options.config, options.name));

  /* ── Firestore ─────────────────────────────────────────────────────────────────────────
   * `initializeFirestore` rather than `getFirestore`: the cache strategy is a *settings*
   * argument, and settings can only be supplied before the instance exists. The deprecated
   * `enableIndexedDbPersistence()` path is not used — it races with the first query. */
  const settings: FirestoreSettings = {
    localCache:
      options.localCache === 'memory'
        ? memoryLocalCache()
        : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  };
  const db = initializeFirestore(app, settings);

  /* ── Auth ──────────────────────────────────────────────────────────────────────────────
   * `initializeAuth` rather than `getAuth`, because persistence is platform-specific and
   * arrives through the adapter (Article II, checklists/phase-03-auth.md §1). */
  const persistence = options.authPersistence ?? getPlatformAdapter().getAuthPersistence();
  const auth = initializeAuth(
    app,
    options.popupRedirectResolver === undefined
      ? { persistence }
      : { persistence, popupRedirectResolver: options.popupRedirectResolver },
  );

  /* ── Functions ─────────────────────────────────────────────────────────────────────────
   * No region argument: the callables set `us-central1` globally
   * (firebase/functions/src/common/config.ts), which is the SDK default. */
  const functions = getFunctions(app);

  if (options.useEmulators === true) {
    const endpoints = options.emulators ?? DEFAULT_EMULATORS;
    assertNotLocalhost('auth URL', endpoints.authUrl);
    assertNotLocalhost('Firestore host', endpoints.firestoreHost);
    assertNotLocalhost('Functions host', endpoints.functionsHost);

    // Order matters only in that every connect must happen before the first read or write.
    connectAuthEmulator(auth, endpoints.authUrl, { disableWarnings: true });
    connectFirestoreEmulator(db, endpoints.firestoreHost, endpoints.firestorePort);
    connectFunctionsEmulator(functions, endpoints.functionsHost, endpoints.functionsPort);
  }

  handles = { app, db, auth, functions };
  return handles;
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Accessors
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The initialised handles.
 *
 * Throws rather than returning null: a missing init is a startup wiring bug, and failing at
 * the boundary with an actionable message beats a `Cannot read properties of undefined` three
 * frames inside the SDK. Matches `getPlatformAdapter()`.
 */
export function getFirebase(): FirebaseHandles {
  if (handles === null) {
    throw new Error(
      '[splitsutra] Firebase is not initialised. Call initFirebase({ config }) at app startup, ' +
        'after setPlatformAdapter() and before rendering (apps/web/src/main.tsx).',
    );
  }
  return handles;
}

/** `true` once {@link initFirebase} has run. Lets a caller branch without catching. */
export function isFirebaseInitialized(): boolean {
  return handles !== null;
}

/** The `FirebaseApp`. */
export function getFirebaseApp(): FirebaseApp {
  return getFirebase().app;
}

/**
 * The Firestore handle.
 *
 * 🔴 Only `src/repositories/**` may call this. Article VIII: a screen that reaches Firestore
 * directly is logic that will not port to React Native.
 */
export function getDb(): Firestore {
  return getFirebase().db;
}

/**
 * The Auth handle.
 *
 * Named `getAuthClient` rather than `getAuth` on purpose: `apps/web/src/auth/**` imports the
 * SDK's own `getAuth` alongside this, and two imports with one name is a merge conflict
 * waiting to happen.
 */
export function getAuthClient(): Auth {
  return getFirebase().auth;
}

/** The Cloud Functions handle, for `httpsCallable`. */
export function getFunctionsClient(): Functions {
  return getFirebase().functions;
}

/**
 * Test helper — forgets the handles so the next {@link initFirebase} runs for real.
 *
 * Deliberately does **not** call `deleteApp()`: that is async, and a sync reset is what a
 * test's `afterEach` can actually use. A test needing genuine isolation should pass a distinct
 * `name` instead.
 */
export function resetFirebase(): void {
  handles = null;
}
