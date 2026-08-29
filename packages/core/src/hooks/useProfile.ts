/**
 * `useProfile()` — the signed-in user's own `users/{uid}` document (phase-03 §3, 🟡).
 *
 * A thin selector over {@link useAuth}, not a second subscription. The profile is already
 * being watched by the session store the moment somebody signs in, because `upsertUserProfile`
 * has to run then anyway; opening another `onSnapshot` on the same document from here would
 * pay for the same data twice and give the two copies separate error states.
 *
 * ## The only thing this adds is an honest `loading`
 *
 * `useAuth().loading` answers "do we know who is signed in?" and goes false as soon as the
 * session resolves — which for a signed-in user is *before* their profile document has
 * arrived. A screen that renders `profile.displayName` needs the other question, and
 * distinguishing the two states by hand gets it wrong in the same way every time:
 *
 * - signed out                     → `profile === null`, and it is never going to be anything else
 * - signed in, snapshot in flight  → `profile === null`, for about half a second
 * - signed in, profile missing     → `profile === null`, until the upsert lands and the
 *                                    subscription reports it
 *
 * All three look identical at the call site. `loading` here is true for the second and third
 * and false for the first, so `!loading && profile === null` means "signed out", full stop.
 */

import { useMemo } from 'react';

import type { User } from '../types/index.js';
import { useAuth } from './useAuth.js';

/** What {@link useProfile} returns. */
export interface UseProfileResult {
  /** `users/{uid}`, or `null` while it is loading or while signed out. */
  readonly profile: User | null;
  /** `true` while the profile could still turn up. See the note above. */
  readonly loading: boolean;
  /** The session, subscription, or upsert failure — the same one {@link useAuth} reports. */
  readonly error: Error | null;
}

/** The signed-in user's own profile, with a `loading` that accounts for the document. */
export function useProfile(): UseProfileResult {
  const { user, profile, loading, error } = useAuth();

  return useMemo(
    () => ({
      profile,
      // Still loading while the session is unresolved, and while a signed-in user has no
      // profile yet — but not once an error has been reported, because after a permission
      // denial or a `DocumentParseError` the document is not coming and a spinner that never
      // stops is worse than a message.
      loading: loading || (user !== null && profile === null && error === null),
      error,
    }),
    [user, profile, loading, error],
  );
}
