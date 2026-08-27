import { createHash } from 'node:crypto';

import { adminAuth } from '../common/admin.js';

/**
 * ============================================================================
 * IDENTITY NORMALISATION AND THE usernames/ INDEX KEY
 * ============================================================================
 * docs/03 §"usernames": the document id is `sha256(lowercase(email))` or
 * `sha256(e164(phone))`, hex. `list` is denied in rules (T5), so a client can only
 * resolve a contact whose email or phone it already knows.
 *
 * ⚠️ CROSS-RUNTIME CONTRACT. `checklists/phase-05 §5` puts the client-side hash in
 *    `core/src/utils/` implemented with **Web Crypto**, because it must also run
 *    under React Native. This file uses `node:crypto` because it runs on the
 *    Functions runtime and Web Crypto's digest is async-only. The two are separate
 *    implementations ON PURPOSE, and they MUST agree byte for byte:
 *
 *        key = sha256_hex(normalized_identifier)
 *
 *    with normalisation exactly as below (trim, lowercase for email; trim and
 *    strip separators for phone). If they ever diverge, every friend lookup
 *    silently returns "not found" and nobody can explain why. This is not money
 *    math, so it is not an Article VI violation — but it is the same failure mode,
 *    so change the two together or not at all.
 * ============================================================================
 */

/** Hex SHA-256 of an already-normalised identifier. Never hash a raw user input. */
export function usernameKey(normalizedIdentifier: string): string {
  return createHash('sha256').update(normalizedIdentifier, 'utf8').digest('hex');
}

/**
 * Lowercased and trimmed, or `null` if the value is not a usable email.
 *
 * No attempt is made to canonicalise provider-specific rules (Gmail dots, `+tags`)
 * — those would make two different Auth users collide onto one index key.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (value.length === 0 || value.length > 320) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value)) return null;
  return value;
}

/**
 * E.164, or `null`. docs/03 stores `phoneNumber` already in E.164 (`+919876543210`)
 * and `firestore.rules` pins it to the `phone_number` auth-token claim, which
 * Firebase also emits in E.164 — so this is a validation, not a conversion. A real
 * conversion needs the user's region and belongs on the client.
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.replace(/[\s()\-.]/g, '');
  if (!/^\+[1-9]\d{6,14}$/.test(value)) return null;
  return value;
}

/** The identifiers a profile document claims, normalised. */
export interface ClaimedIdentity {
  email: string | null;
  phone: string | null;
}

export function claimedIdentity(profile: Record<string, unknown> | undefined): ClaimedIdentity {
  return {
    email: normalizeEmail(profile?.['email']),
    phone: normalizePhone(profile?.['phoneNumber']),
  };
}

/**
 * 🔴 LAYER 2 of the identity check — the authoritative half.
 *
 * `firestore.rules` (`users/{uid}.ownsClaimedIdentity`) compares the profile's
 * `email` / `phoneNumber` against the caller's ID-token claims. That is a real
 * check, but it is a check against a token the client presented, evaluated at one
 * instant, on a document the client controls. It cannot see the Auth record, and
 * it cannot re-check anything after the fact.
 *
 * This function re-reads the actual Firebase Auth user and returns only the
 * identifiers that user genuinely holds. `onUserProfileWritten` indexes ONLY what
 * comes back from here.
 *
 * Why it matters: the `usernames/` index is how one user finds another. If a user
 * could get someone else's email indexed against their own uid, every friend
 * lookup for that person would resolve to the attacker — a complete identity
 * takeover of the friend-add flow, invisible to both parties. Storing an email you
 * do not own is harmless; having it INDEXED is not.
 *
 * @returns the subset of `claimed` that the Auth record actually holds, plus the
 *   subset it does not (so the caller can log the discrepancy loudly).
 */
export async function verifyIdentityAgainstAuth(
  uid: string,
  claimed: ClaimedIdentity,
): Promise<{ verified: ClaimedIdentity; rejected: string[] }> {
  const rejected: string[] = [];

  // Declared without an initialiser on purpose. Both are assigned unconditionally at the
  // top of the `try`, and the `catch` returns rather than falling through — so a `= null`
  // seed here could never be read (ESLint `no-useless-assignment`). Leaving it in would
  // also imply "no Auth record" is a state this code proceeds from, which it is not: that
  // case returns early with every claim rejected.
  let authEmail: string | null;
  let authPhone: string | null;
  try {
    const user = await adminAuth.getUser(uid);
    authEmail = normalizeEmail(user.email);
    authPhone = normalizePhone(user.phoneNumber);
    // Federated providers (Google, and email linked after phone) carry the address
    // on the provider entry rather than the top-level record in some link orders.
    if (authEmail === null || authPhone === null) {
      for (const provider of user.providerData) {
        authEmail ??= normalizeEmail(provider.email);
        authPhone ??= normalizePhone(provider.phoneNumber);
      }
    }
  } catch {
    // No Auth user — the profile is an orphan (deleted account, or a document
    // written by a test). Index nothing; every claim is rejected.
    return {
      verified: { email: null, phone: null },
      rejected: [claimed.email, claimed.phone].filter((v): v is string => v !== null),
    };
  }

  const verified: ClaimedIdentity = { email: null, phone: null };

  if (claimed.email !== null) {
    if (claimed.email === authEmail) verified.email = claimed.email;
    else rejected.push(claimed.email);
  }
  if (claimed.phone !== null) {
    if (claimed.phone === authPhone) verified.phone = claimed.phone;
    else rejected.push(claimed.phone);
  }

  return { verified, rejected };
}

/** The `usernames/{key}` document ids implied by a verified identity. */
export function indexKeys(identity: ClaimedIdentity): string[] {
  const keys: string[] = [];
  if (identity.email !== null) keys.push(usernameKey(identity.email));
  if (identity.phone !== null) keys.push(usernameKey(identity.phone));
  return keys;
}
