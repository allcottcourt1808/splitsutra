/**
 * The web implementation of `PlatformAdapter` — Phase 12 writes the React Native twin at
 * `apps/mobile/src/platform/nativeAdapter.ts` against this same interface.
 *
 * This file is one half of the Article II escape hatch: `packages/core` never touches
 * `window`, `navigator` or `document`, so every capability core needs that only the host
 * can provide arrives through here.
 *
 * `main.tsx` installs it with `setPlatformAdapter(webAdapter)` BEFORE `createRoot().render()`,
 * because repositories are plain functions that can run outside the React tree.
 *
 * @see packages/core/src/platform/index.ts
 * @see docs/02-architecture.md §Platform adapter pattern
 * @see checklists/phase-01-foundation.md §7
 */

import { browserLocalPersistence, type Persistence } from 'firebase/auth';
import type { PlatformAdapter, SharePayload } from '@splitsutra/core';

/* -------------------------------------------------------------------------- */
/* share                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `navigator.share` is not on every browser (desktop Firefox and Safari < 16 have no
 * general implementation), so the clipboard is the documented fallback for invite links
 * — AC-B3.2, checklists/phase-05-friends-groups.md §8.
 *
 * Screens must call `getPlatformAdapter().share(...)`, never `navigator.share` directly:
 * the native build has no `navigator` at all.
 */
async function shareViaWebShare(payload: SharePayload): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;

  try {
    await navigator.share(
      payload.text === undefined
        ? { title: payload.title, url: payload.url }
        : { title: payload.title, text: payload.text, url: payload.url },
    );
    return true;
  } catch (error: unknown) {
    // The user closing the sheet is a normal outcome, not a failure. The contract says
    // `share()` resolves on cancel — a screen that showed "sharing failed" here would be
    // telling the user something untrue about an action they deliberately took.
    if (error instanceof DOMException && error.name === 'AbortError') return true;
    return false;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* The adapter                                                                */
/* -------------------------------------------------------------------------- */

export const webAdapter: PlatformAdapter = {
  /**
   * `browserLocalPersistence` keeps the session across a hard refresh and a browser
   * restart (AC-A1.7). The RN adapter returns `getReactNativePersistence(AsyncStorage)`.
   */
  getAuthPersistence(): Persistence {
    return browserLocalPersistence;
  },

  async share(payload: SharePayload): Promise<void> {
    if (await shareViaWebShare(payload)) return;
    if (await copyToClipboard(payload.url)) return;

    // Rejects only when sharing is genuinely unavailable, per the interface contract.
    // The caller turns this into copy the user can act on — never a raw error string
    // (docs/15 §Error messages: what happened, why, and what now).
    throw new Error(
      'This browser cannot share or copy links. Select the link and copy it manually.',
    );
  },

  async openUrl(url: string): Promise<void> {
    // `noopener,noreferrer` so the opened page cannot reach back through `window.opener`.
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (opened !== null) return;

    // Popup blocked. Deliberately NOT falling back to `location.assign()`: that would
    // navigate away from whatever half-finished expense form the user was on, and
    // "never lose typed input" (docs/15 rule 6) outranks opening the link.
    throw new Error('Your browser blocked the new tab. Allow popups for this site to open it.');
  },
};
