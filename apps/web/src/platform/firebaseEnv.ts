/**
 * The Firebase web config, read out of Vite's `import.meta.env`.
 *
 * WHY THIS LIVES IN `platform/` AND NOT IN `@splitsutra/core`
 * `import.meta.env` is a bundler feature. Vite has it, Metro does not, so a core module
 * that read it would break the Phase 12 port (Article II / docs/02 §contract rule 7).
 * Reading the environment is a *platform* capability, so the web app reads it here and
 * hands the resulting plain object to whatever needs it.
 *
 * NOT SECRET. Every value below is a public identifier that Google ships in the client
 * bundle by design. Security comes from Security Rules and App Check (Article IV; see the
 * long note at the top of `.env.example`). Nothing that IS a secret may ever be given a
 * `VITE_` prefix, because every `VITE_` variable is inlined into the public bundle.
 *
 * ⚠️ Each variable is read by LITERAL member access — `import.meta.env.VITE_FIREBASE_API_KEY`
 * — never `import.meta.env[name]`. Vite performs a static text substitution at build time
 * and a computed lookup is not substituted, so a dynamic version works in `pnpm dev` and
 * silently yields `undefined` in a production build.
 *
 * TODO(phase-02): `@splitsutra/core` gains `src/firebase/` (app init + the injectable adapter).
 *   When it does, `main.tsx` calls `initFirebase(readFirebaseConfig())` and this module
 *   stays exactly as it is — the config still has to be read on the platform side.
 */

/** The subset of `FirebaseOptions` this app supplies. Structural, so core never has to import it. */
export interface FirebaseWebConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly storageBucket: string;
  readonly messagingSenderId: string;
  readonly appId: string;
  /**
   * Only present once Analytics is enabled (Phase 09).
   *
   * Deliberately `?: string` and NOT `?: string | undefined`. Under
   * `exactOptionalPropertyTypes` those mean different things: the latter permits the key
   * to be present holding `undefined`, which the SDK's own `FirebaseOptions` rejects.
   * `readFirebaseConfig` spreads the key in conditionally and never assigns `undefined`,
   * so this is the type that matches the implementation.
   */
  readonly measurementId?: string;
}

/** `import.meta.env` values are typed `any` through an index signature; narrow before use. */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read and validate the Firebase web config.
 *
 * Throws on a missing required value rather than letting the SDK fail later with
 * `auth/invalid-api-key`, which sends people hunting through the Firebase console instead
 * of at their `.env.local`.
 */
export function readFirebaseConfig(): FirebaseWebConfig {
  const base = {
    apiKey: str(import.meta.env.VITE_FIREBASE_API_KEY),
    authDomain: str(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: str(import.meta.env.VITE_FIREBASE_PROJECT_ID),
    storageBucket: str(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: str(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
    appId: str(import.meta.env.VITE_FIREBASE_APP_ID),
  } as const;

  const missing = Object.entries(base)
    .filter(([, value]) => value.length === 0)
    .map(([key]) => `VITE_FIREBASE_${key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`);

  if (missing.length > 0) {
    throw new Error(
      `[splitsutra] Firebase config is incomplete. Missing: ${missing.join(', ')}. ` +
        'Copy apps/web/.env.example to apps/web/.env.local and fill it in ' +
        '(Firebase console -> Project settings -> General -> Your apps).',
    );
  }

  const measurementId = str(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID);
  // Spread rather than assigning `undefined`: `exactOptionalPropertyTypes` treats an
  // explicit `undefined` as different from an absent key, and the SDK checks for absence.
  return measurementId.length > 0 ? { ...base, measurementId } : base;
}

/**
 * `true` when this build should talk to the local emulator suite instead of a real project.
 *
 * Driven by `VITE_USE_EMULATORS`; blank or `false` in `dev` and `prod` builds.
 *
 * ⚠️ Not named `useEmulators`, which is what it reads as. `react-hooks/rules-of-hooks` matches
 * on the `use` prefix alone and treats any such call as a hook — so the old name made calling
 * it from `startApp()` a lint error, and would have made calling it from a conditional inside a
 * component one too. The option it feeds is still spelled `useEmulators` because that is core's
 * field name, and core has no React in it.
 */
export function emulatorsEnabled(): boolean {
  return str(import.meta.env.VITE_USE_EMULATORS).toLowerCase() === 'true';
}

/**
 * Emulator endpoints, matching the `emulators` block in `firebase.json`.
 *
 * 🔴 `127.0.0.1`, never `localhost`. On Node 18+ `localhost` can resolve to `::1` first and
 * the emulators bind IPv4 only, which fails with a confusing timeout rather than a refusal
 * (docs/08-firebase-setup.md).
 */
export const EMULATOR = {
  authUrl: 'http://127.0.0.1:9099',
  firestoreHost: '127.0.0.1',
  firestorePort: 8080,
  functionsHost: '127.0.0.1',
  functionsPort: 5001,
} as const;
