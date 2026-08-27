/**
 * The platform adapter — the ONLY escape hatch out of `packages/core`.
 *
 * Article II: core imports no DOM, no `react-dom`, no `react-native`, no `window`,
 * no `document`, no `localStorage`. Where core genuinely needs a platform capability
 * it takes an injected adapter rather than reaching for a global.
 *
 * There should be very few of these. Every method added here is a method that has to
 * be written twice — once for web, once for React Native — so the bar for adding one
 * is "core cannot do its job without it", not "this would be convenient".
 *
 * Implementations:
 *   - web:    apps/web/src/platform/webAdapter.ts
 *   - mobile: apps/mobile/src/platform/nativeAdapter.ts   (Phase 12)
 *
 * @see docs/02-architecture.md §Platform adapter pattern
 * @see checklists/phase-01-foundation.md §7
 *
 * NOTE ON LOCATION: docs/02 sketches this interface at `core/src/firebase/adapter.ts`.
 * It lives at `core/src/platform/` instead because only one of its three members is
 * Firebase-related — `share` and `openUrl` have nothing to do with Firebase, and a
 * `firebase/` path would imply the wrong dependency direction for them.
 */

// Type-only import: erased at compile time (`verbatimModuleSyntax`), so this adds no
// runtime dependency on the Firebase SDK. `Persistence` is the auth-storage strategy —
// `browserLocalPersistence` on web, an AsyncStorage-backed one on React Native.
import type { Persistence } from 'firebase/auth';

/** Payload for the platform share sheet. */
export interface SharePayload {
  readonly title: string;
  readonly url: string;
  /** Optional body text. Web Share API `text`; RN `Share.share({ message })`. */
  readonly text?: string | undefined;
}

/**
 * Capabilities core needs that only the host platform can provide.
 *
 * Deliberately NOT on this interface yet — add them when a feature actually needs them,
 * not before (Article XII):
 *   - image picker      (deferred with receipt attachments)
 *   - push token registration (deferred with notifications)
 *   - biometric unlock  (not planned for v1)
 */
export interface PlatformAdapter {
  /**
   * How Firebase Auth should persist the session on this platform.
   * Web: `browserLocalPersistence`. RN: `getReactNativePersistence(AsyncStorage)`.
   */
  getAuthPersistence(): Persistence;

  /**
   * Open the platform share sheet. Used for group invite links.
   * Resolves when the sheet closes; resolves (does not reject) if the user cancels.
   * Rejects only when sharing is genuinely unavailable.
   */
  share(payload: SharePayload): Promise<void>;

  /**
   * Open a URL outside the app — terms, privacy policy, "how simplification works".
   * Web: a new tab. RN: `Linking.openURL`.
   */
  openUrl(url: string): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */
/**
 * Set once at app startup, before anything in core runs.
 *
 * This is module state rather than React context on purpose: repositories are plain
 * functions and must be callable from outside the React tree (and from tests), so the
 * adapter cannot live in a provider.
 */

let current: PlatformAdapter | null = null;

/** Install the host platform's adapter. Call this first thing at app startup. */
export function setPlatformAdapter(adapter: PlatformAdapter): void {
  current = adapter;
}

/**
 * The installed adapter.
 *
 * Throws rather than returning null: a missing adapter is a startup wiring bug, and
 * failing loudly at the boundary beats a confusing `undefined` deep inside a repository.
 */
export function getPlatformAdapter(): PlatformAdapter {
  if (current === null) {
    throw new Error(
      '[splitsutra] No PlatformAdapter installed. Call setPlatformAdapter() at app startup ' +
        '(apps/web/src/main.tsx installs the web adapter).',
    );
  }
  return current;
}

/** Test helper — clears the installed adapter between test cases. */
export function resetPlatformAdapter(): void {
  current = null;
}
