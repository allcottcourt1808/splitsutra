/**
 * `users/{uid}` — the private profile. checklists/phase-03-auth.md §3.
 *
 * ## `upsertUserProfile` runs on every launch, not only on first sign-in
 *
 * AC-A1.2 / AC-A1.3: a user whose profile document is missing — an interrupted first sign-in,
 * a manual deletion in the console, a failed migration — must heal on their next launch rather
 * than land in an app that half works. So the call is unconditional and the *function* decides
 * whether there is anything to do.
 *
 * ## Why it is not one `setDoc(…, { merge: true })`
 *
 * Because create and update are different operations to Security Rules, and the same payload
 * cannot satisfy both:
 *
 * - create demands `createdAt == request.time`
 * - update demands `!changed(['uid', 'createdAt'])` and `updatedAt == request.time`
 *
 * A merge write carrying `createdAt: serverTimestamp()` is a create that works and an update
 * that is denied. Hence: read first, then take the branch that matches.
 *
 * ## Why an update never touches `displayName`
 *
 * The provider's display name is a *seed*, used once. AC-A2.1 lets the user edit theirs, and
 * refreshing it from the provider on every launch would silently revert that edit every time
 * they reopened the app — a bug that looks like the save button not working. Only the identity
 * fields Auth owns (`email`, `phoneNumber`) are re-synced, and only when they actually differ,
 * so a normal launch performs one read and zero writes.
 */

import {
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentReference,
} from 'firebase/firestore';

import {
  DEFAULT_CURRENCY,
  displayNameSchema,
  photoUrlSchema,
  type CurrencyCode,
  type User,
} from '../types/index.js';
import type { AuthUser } from './authRepo.js';
import { sha256 } from '../utils/crypto.js';
import { userDoc, usernameDoc } from './refs.js';
import { watchDoc, type OnError, type OnNext, type Unsubscribe } from './subscribe.js';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Display-name derivation
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** Shown when a provider gives us nothing at all to work with — rare, but `''` is not valid. */
const DISPLAY_NAME_FALLBACK = 'New user';

/** `displayNameSchema` caps at 50 (AC-A2.1); derived names are truncated to fit rather than fail. */
const DISPLAY_NAME_MAX = 50;

/**
 * A phone number reduced to its last four digits.
 *
 * Deliberately does not try to preserve the country code: dialling codes are one to three
 * digits and nothing in the number says which, so any "keep the prefix" rule mangles some
 * country's numbers. The last four are the digits people recognise their own number by.
 */
export function maskPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '');
  const tail = digits.slice(-4);
  return tail.length === 0 ? DISPLAY_NAME_FALLBACK : `•••• ${tail}`;
}

/**
 * Apple's anonymised relay domain, used when somebody chooses "Hide My Email".
 *
 * 🔴 The local part of one of these is an opaque token like `k8s2mn4qpz`. It is not a name, it
 * is not chosen, and it is not even stable across apps — but it IS an identifier Apple issued
 * for this user. Seeding it as a display name would put it in every group member document and
 * every friend document (D4), where it is both meaningless to read and a relay address handed
 * to people the user never gave it to.
 *
 * Apple only supplies a real name on the FIRST sign-in ever, so the nameless case here is
 * ordinary rather than exotic: anyone who signed in once before Firebase was involved, or whose
 * first attempt failed after Apple had already recorded the grant, arrives with nothing.
 */
const APPLE_PRIVATE_RELAY_DOMAIN = 'privaterelay.appleid.com';

/**
 * The display name to seed a new profile with (phase-03 §3).
 *
 * Order: the provider's name, then the email local-part, then the masked phone number. A
 * phone-only sign-up has no name and no email, and `+919876543210` as a display name is both
 * ugly and a privacy leak into every group member list — hence the mask.
 *
 * An Apple relay address is skipped for the same reason the phone number is masked: see
 * {@link APPLE_PRIVATE_RELAY_DOMAIN}. Such a user falls through to "New user" and is prompted
 * to set a real one, which is the honest outcome — there was never a name to derive.
 */
export function deriveDisplayName(user: AuthUser): string {
  const provided = user.displayName?.trim() ?? '';
  if (provided.length > 0) return provided.slice(0, DISPLAY_NAME_MAX);

  const email = user.email ?? '';
  if (!email.toLowerCase().endsWith(`@${APPLE_PRIVATE_RELAY_DOMAIN}`)) {
    const localPart = email.split('@')[0]?.trim() ?? '';
    if (localPart.length > 0) return localPart.slice(0, DISPLAY_NAME_MAX);
  }

  if (user.phoneNumber !== null) return maskPhoneNumber(user.phoneNumber);

  return DISPLAY_NAME_FALLBACK;
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Reads
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** One-shot read of a profile. `null` when the document does not exist. */
export async function getUserProfile(uid: string): Promise<User | null> {
  const snapshot = await getDoc(userDoc(uid));
  return snapshot.exists() ? snapshot.data() : null;
}

/**
 * Subscribe to a profile (`useProfile`, phase-03 §3).
 *
 * Rules allow `get` only where `isSelf(uid)`, so this works for the signed-in user and nobody
 * else. Another person's name and avatar come from the denormalized snapshot on their group
 * member or friend document, which is what those fields exist for (D4).
 */
export function watchUserProfile(
  uid: string,
  onNext: OnNext<User | null>,
  onError: OnError,
): Unsubscribe {
  return watchDoc(userDoc(uid), onNext, onError);
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Writes
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** Options for {@link upsertUserProfile}. */
export interface UpsertUserProfileOptions {
  /**
   * Currency for a brand-new profile. Defaults to `DEFAULT_CURRENCY` (`USD`, Q4).
   *
   * Only ever applied on create — a launch must never silently rewrite the currency a user
   * chose in Account settings.
   */
  readonly defaultCurrency?: CurrencyCode | undefined;
}

/**
 * Create the profile if it is missing; otherwise re-sync only the identity fields Auth owns.
 *
 * Call it on every launch while signed in, and after every successful sign-in.
 *
 * A `DocumentParseError` from an existing but malformed profile is **not** swallowed. Repairing
 * it here would mean guessing which of the stored fields is the wrong one and overwriting the
 * user's real data on a guess; the error names the document and the offending field, which is
 * what a repair actually needs.
 */
export async function upsertUserProfile(
  user: AuthUser,
  options: UpsertUserProfileOptions = {},
): Promise<void> {
  const reference = userDoc(user.uid);
  const snapshot = await getDoc(reference);

  if (!snapshot.exists()) {
    // `createdAt` and `updatedAt` are both `serverTimestamp()`: Rules require
    // `createdAt == request.time` (threat T7 — a client-chosen creation time is a client that
    // can backdate itself into an older invite window).
    await setDoc(reference, {
      uid: user.uid,
      displayName: deriveDisplayName(user),
      email: user.email,
      phoneNumber: user.phoneNumber,
      photoURL: user.photoURL,
      defaultCurrency: options.defaultCurrency ?? DEFAULT_CURRENCY,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      deletedAt: null,
    });
    return;
  }

  const existing = snapshot.data();
  const patch: Record<string, unknown> = {};
  if (existing.email !== user.email) patch['email'] = user.email;
  if (existing.phoneNumber !== user.phoneNumber) patch['phoneNumber'] = user.phoneNumber;

  // Nothing changed — and the common case is that nothing ever changes. Writing anyway would
  // re-fire `onUserProfileWritten` (which rebuilds the `usernames/` index and fans display
  // names out to every group member document) on every launch, for every user, for nothing.
  //
  // 🔴 But "nothing changed" is not the same as "everything is correct", and the difference
  //    was a real bug: a profile whose trigger never ran — created before the Functions were
  //    deployed, or during a failed invocation — has NO `usernames/` entry, and this early
  //    return meant it never got one. Not on launch, not on sign-in, not ever. That person is
  //    permanently unfindable, and the searcher is told "No SplitSutra account is registered
  //    with that email", which is FALSE and unactionable for both of them.
  if (Object.keys(patch).length === 0) {
    await healUsernameIndex(user, reference);
    return;
  }

  await updateDoc(reference, { ...patch, updatedAt: serverTimestamp() });
}

/**
 * Give the trigger a reason to run when — and only when — this user's index entry is wrong.
 *
 * Costs one document READ per launch and, in the broken case only, one write. That write is a
 * no-op patch whose whole purpose is to fire `onUserProfileWritten`, which owns the index
 * (Article III: the client cannot write `usernames/` itself, and must not be able to — a client
 * that could would point any lookup at itself).
 *
 * 🔴 THE KEY MUST BE DERIVED EXACTLY AS THE SERVER DERIVES IT. `sha256` from `utils/crypto.ts`
 *    is the client half of the cross-runtime contract that file documents; the normalisation
 *    below is the same `trim().toLowerCase()` as `normalizeEmail` in
 *    `firebase/functions/src/lib/identity.ts`. Disagree by one character and this reads a key
 *    that never exists, concludes the index is broken, and writes on EVERY launch for EVERY
 *    user — turning a repair into permanent per-launch write amplification that also re-fans
 *    the display name across every group. That is the failure mode to test for, and
 *    `__tests__/userRepo.test.ts` pins it against a digest computed by Node.
 *
 * Failures are swallowed. This is a background repair on a path whose actual job is signing in;
 * a user who cannot read the index should still reach their groups.
 */
async function healUsernameIndex(user: AuthUser, reference: DocumentReference): Promise<void> {
  const email = user.email?.trim().toLowerCase();
  // Only email is checked. A phone-only account has the same hazard, but `phoneNumber` is
  // already E.164 from Auth and needs no normalisation, so it is folded in the same way the
  // moment there is a second key to check — see `indexKeys` on the server.
  if (email === undefined || email.length === 0) return;

  try {
    const key = await sha256(email);
    const indexed = await getDoc(usernameDoc(key));

    // Present and pointing here: nothing to do, which is the overwhelmingly common case and
    // the reason this costs a read rather than a write.
    if (indexed.exists() && indexed.data()?.['uid'] === user.uid) return;

    // Missing, or pointing at somebody else. Either way the trigger is the only thing that can
    // put it right, and only a write to this profile wakes it.
    await updateDoc(reference, { updatedAt: serverTimestamp() });
  } catch {
    // Deliberately silent. See the doc comment.
  }
}

/** The fields a user may edit on their own profile (phase-03 §5). */
export interface UserProfilePatch {
  /** 1–50 characters, trimmed (AC-A2.1). */
  readonly displayName?: string | undefined;
  /** From the fixed table in `types/currency.ts` — never from `Intl` (AC-A2.2). */
  readonly defaultCurrency?: CurrencyCode | undefined;
  /** `null` clears it. Avatar upload is deferred; initials avatars until then. */
  readonly photoURL?: string | null | undefined;
}

/**
 * Update the signed-in user's own profile.
 *
 * `displayName` and `photoURL` are parsed with the same schemas the read boundary uses, so an
 * over-long name is refused here with a field-level message instead of arriving at Rules as a
 * flat permission-denied. Article IV: that parse is UX, and Rules re-check it regardless.
 */
export async function updateUserProfile(uid: string, patch: UserProfilePatch): Promise<void> {
  const update: Record<string, unknown> = {};

  if (patch.displayName !== undefined) {
    update['displayName'] = displayNameSchema.parse(patch.displayName);
  }
  if (patch.defaultCurrency !== undefined) {
    update['defaultCurrency'] = patch.defaultCurrency;
  }
  if (patch.photoURL !== undefined) {
    update['photoURL'] = photoUrlSchema.parse(patch.photoURL);
  }

  if (Object.keys(update).length === 0) return;

  // Rules require `updatedAt == request.time` on every profile update, so this is not optional
  // bookkeeping — omitting it is a permission-denied.
  await updateDoc(userDoc(uid), { ...update, updatedAt: serverTimestamp() });
}
