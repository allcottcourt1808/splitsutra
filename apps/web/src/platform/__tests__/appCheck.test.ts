/**
 * App Check registration — and above all, the one branch that must never reach production.
 *
 * ## What this file is actually protecting
 *
 * A debug token is a **complete App Check bypass** for whoever holds it, registered against the
 * real project. `initAppCheck` reads one only under `import.meta.env.DEV`, which is statically
 * `false` in a production build so the branch is dead-code-eliminated — but "the bundler will
 * remove it" is a claim, and the third test is what makes it an assertion.
 *
 * The rest is failure behaviour. Nothing enforces App Check yet, so every failure path has to
 * be a reported skip rather than a throw: a thrown error here lands before `createRoot` and the
 * symptom is a blank white page, which is the exact trap `startApp` already exists to avoid for
 * a missing `.env.local`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FirebaseApp } from 'firebase/app';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Seams
 * ────────────────────────────────────────────────────────────────────────────────────────── */

const seam = vi.hoisted(() => ({
  /** Every `initializeAppCheck` call, with the debug global AS IT WAS at that moment. */
  calls: [] as { provider: unknown; autoRefresh: unknown; debugGlobalAtCallTime: unknown }[],
  /** Site keys handed to the provider constructor. */
  providerKeys: [] as string[],
  /** Swappable so one test can make the SDK throw. */
  fail: null as Error | null,
}));

vi.mock('firebase/app-check', () => ({
  ReCaptchaEnterpriseProvider: class {
    constructor(key: string) {
      seam.providerKeys.push(key);
    }
  },
  initializeAppCheck: (_app: unknown, options: Record<string, unknown>) => {
    if (seam.fail !== null) throw seam.fail;
    seam.calls.push({
      provider: options['provider'],
      autoRefresh: options['isTokenAutoRefreshEnabled'],
      // 🔴 Captured HERE, not read afterwards. The SDK reads the global during
      //    initialisation, so "was it set eventually" is not the property that matters.
      debugGlobalAtCallTime: (self as unknown as Record<string, unknown>)[DEBUG_GLOBAL],
    });
    return { app: _app } as unknown;
  },
}));

const DEBUG_GLOBAL = 'FIREBASE_APPCHECK_DEBUG_TOKEN';

const { initAppCheck } = await import('../appCheck');

const APP = { name: '[DEFAULT]' } as FirebaseApp;
const KEY = '6LfAPPCHECKkeyNOTanIdentityPlatformOne';

function debugGlobal(): unknown {
  return (self as unknown as Record<string, unknown>)[DEBUG_GLOBAL];
}

beforeEach(() => {
  seam.calls = [];
  seam.providerKeys = [];
  seam.fail = null;
  delete (self as unknown as Record<string, unknown>)[DEBUG_GLOBAL];
  vi.stubEnv('VITE_APPCHECK_SITE_KEY', '');
  vi.stubEnv('VITE_APPCHECK_DEBUG_TOKEN', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete (self as unknown as Record<string, unknown>)[DEBUG_GLOBAL];
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Tests
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('initAppCheck', () => {
  it('registers with a reCAPTCHA Enterprise provider and background refresh', () => {
    vi.stubEnv('VITE_APPCHECK_SITE_KEY', KEY);

    const result = initAppCheck(APP, false);

    expect(result.status).toBe('active');
    expect(seam.providerKeys).toEqual([KEY]);
    // A long-lived tab must not start failing an hour in, once enforcement is on.
    expect(seam.calls[0]?.autoRefresh).toBe(true);
  });

  it('trims the key, so a stray newline in .env.local is not a mystery failure', () => {
    vi.stubEnv('VITE_APPCHECK_SITE_KEY', `  ${KEY}\n`);

    initAppCheck(APP, false);

    expect(seam.providerKeys).toEqual([KEY]);
  });

  it('🔴 never installs a debug token outside a dev build', () => {
    // The security-critical branch. A production bundle carrying a debug token is a permanent
    // App Check bypass for anyone who reads the JS — which is everyone.
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_APPCHECK_SITE_KEY', KEY);
    vi.stubEnv('VITE_APPCHECK_DEBUG_TOKEN', 'a-real-looking-token');

    const result = initAppCheck(APP, false);

    expect(result).toMatchObject({ status: 'active', debug: false });
    expect(debugGlobal()).toBeUndefined();
    expect(seam.calls[0]?.debugGlobalAtCallTime).toBeUndefined();
  });

  it('🔴 installs the debug token BEFORE initialising, or it is silently ignored', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_APPCHECK_SITE_KEY', KEY);
    vi.stubEnv('VITE_APPCHECK_DEBUG_TOKEN', 'dev-machine-token');

    const result = initAppCheck(APP, false);

    expect(result).toMatchObject({ status: 'active', debug: true });
    // The SDK reads the global during initialisation. Setting it afterwards type-checks,
    // runs, reports success, and never attests — the worst kind of green.
    expect(seam.calls[0]?.debugGlobalAtCallTime).toBe('dev-machine-token');
  });

  it('passes `true` through as a boolean, because that is what asks the SDK to mint one', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_APPCHECK_SITE_KEY', KEY);
    vi.stubEnv('VITE_APPCHECK_DEBUG_TOKEN', 'true');

    initAppCheck(APP, false);

    // The string "true" is not the same instruction: the SDK treats a string as a token to USE
    // and a boolean as "generate one and log it".
    expect(seam.calls[0]?.debugGlobalAtCallTime).toBe(true);
  });

  it('does nothing at all when the emulators are on', () => {
    vi.stubEnv('VITE_APPCHECK_SITE_KEY', KEY);

    const result = initAppCheck(APP, true);

    expect(result.status).toBe('skipped');
    // Not merely "returns skipped": the SDK must not be touched, because a real key pointed at
    // 127.0.0.1 buys nothing but console noise.
    expect(seam.calls).toEqual([]);
    expect(seam.providerKeys).toEqual([]);
  });

  it('skips with a reason when no site key is configured', () => {
    const result = initAppCheck(APP, false);

    expect(result.status).toBe('skipped');
    expect(result.status === 'skipped' && result.reason).toContain('VITE_APPCHECK_SITE_KEY');
    expect(seam.calls).toEqual([]);
  });

  it('🔴 turns an SDK failure into a skip rather than a blank white page', () => {
    // A blocked reCAPTCHA script, a corporate proxy, a rejected key. `startApp` runs before
    // `createRoot`, so a throw here mounts nothing at all — and nothing is enforcing App Check
    // yet, which makes taking the app down for it strictly worse than running unattested.
    vi.stubEnv('VITE_APPCHECK_SITE_KEY', KEY);
    seam.fail = new Error('recaptcha script blocked');

    const result = initAppCheck(APP, false);

    expect(result.status).toBe('skipped');
    expect(result.status === 'skipped' && result.reason).toContain('recaptcha script blocked');
  });
});
