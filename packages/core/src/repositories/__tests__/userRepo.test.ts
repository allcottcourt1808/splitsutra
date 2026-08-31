/**
 * `upsertUserProfile` — and specifically the repair it performs when it decides to do nothing.
 *
 * ## What this file is actually protecting
 *
 * The `usernames/` index is written only by `onUserProfileWritten`, which fires only on a write
 * to `users/{uid}`. A profile whose trigger never ran therefore has no index entry, and the
 * early return here meant it never got one — that person stayed permanently unfindable while
 * everyone searching for them was told "No SplitSutra account is registered with that email",
 * which is false. Reproduced against the live dev backend before this was written.
 *
 * 🔴 The repair has a failure mode worse than the bug. If the key this computes disagrees with
 *    the one the SERVER computes by even one character, the lookup below always misses, the
 *    repair always fires, and every user pays a profile write on every launch — which re-fans
 *    the display name across every group they are in. The third test is the one that catches
 *    that, and it is why the healthy-index case asserts ZERO writes rather than "not many".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../authRepo.js';
import type * as CryptoModule from '../../utils/crypto.js';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Seams
 * ────────────────────────────────────────────────────────────────────────────────────────── */

interface Docs {
  readonly [path: string]: Record<string, unknown> | undefined;
}

const seam = vi.hoisted(() => ({
  docs: {} as Docs,
  updates: [] as { path: string; data: Record<string, unknown> }[],
  creates: [] as { path: string; data: Record<string, unknown> }[],
  /** Every `usernames/*` id read, so a test can assert WHICH key was derived. */
  readKeys: [] as string[],
  /** Swappable so one test can make the digest fail. Reset to the real one in beforeEach. */
  sha256Impl: null as ((input: string) => Promise<string>) | null,
}));

vi.mock('firebase/firestore', () => ({
  getDoc: (ref: { path: string }) => {
    if (ref.path.startsWith('usernames/')) seam.readKeys.push(ref.path.slice('usernames/'.length));
    const data = seam.docs[ref.path];
    return Promise.resolve({
      exists: () => data !== undefined,
      data: () => data,
    });
  },
  setDoc: (ref: { path: string }, data: Record<string, unknown>) => {
    seam.creates.push({ path: ref.path, data });
    return Promise.resolve();
  },
  updateDoc: (ref: { path: string }, data: Record<string, unknown>) => {
    seam.updates.push({ path: ref.path, data });
    return Promise.resolve();
  },
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  doc: () => ({}),
}));

vi.mock('../refs.js', () => ({
  userDoc: (uid: string) => ({ path: `users/${uid}` }),
  usernameDoc: (key: string) => ({ path: `usernames/${key}` }),
}));

vi.mock('../subscribe.js', () => ({ watchDoc: () => () => undefined }));

/**
 * `utils/crypto.ts`'s real `sha256` runs unmocked — it is platform-agnostic by construction and
 * works fine under Vitest. Only the failure case is injected.
 *
 * 🔴 The digest is NOT stubbed, because the property under test is that the client derives the
 *    same key the SERVER does, and a stub agrees with itself no matter how wrong it is.
 *    `KNOWN_KEY` below is the independent half: a vector produced by Node's `createHash`,
 *    exactly as `firebase/functions/src/lib/identity.ts` produces it.
 */
vi.mock('../../utils/crypto.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CryptoModule>();
  return {
    ...actual,
    sha256: (input: string) => seam.sha256Impl?.(input) ?? actual.sha256(input),
  };
});

const { upsertUserProfile } = await import('../userRepo.js');

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Fixtures
 * ────────────────────────────────────────────────────────────────────────────────────────── */

const UID = 'u_alice';
const EMAIL = 'alice@example.com';

/**
 * `sha256('alice@example.com')`, lowercase hex — produced by Node exactly as the server does:
 *
 *     createHash('sha256').update('alice@example.com', 'utf8').digest('hex')
 *
 * This literal is the only value in the file that comes from outside it, and it is what ties
 * the client key to the server key.
 */
const KNOWN_KEY = 'ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976';

function authUser(over: Partial<AuthUser> = {}): AuthUser {
  return {
    uid: UID,
    displayName: 'Alice',
    email: EMAIL,
    phoneNumber: null,
    photoURL: null,
    ...over,
  } as AuthUser;
}

/** An existing profile that matches Auth exactly, so nothing needs re-syncing. */
function storedProfile(): Record<string, unknown> {
  return { uid: UID, displayName: 'Alice', email: EMAIL, phoneNumber: null };
}

beforeEach(() => {
  seam.docs = {};
  seam.updates = [];
  seam.creates = [];
  seam.readKeys = [];
  seam.sha256Impl = null;
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Tests
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('upsertUserProfile — the usernames self-heal', () => {
  it('🔴 writes NOTHING when the index entry is already correct', async () => {
    seam.docs = {
      [`users/${UID}`]: storedProfile(),
      [`usernames/${KNOWN_KEY}`]: { uid: UID },
    };

    await upsertUserProfile(authUser());

    // The whole cost model. A write here would fan the display name out to every group this
    // user is in, on every launch, for everyone.
    expect(seam.updates).toEqual([]);
    expect(seam.creates).toEqual([]);
  });

  it('🔴 derives the SAME key the server derives', async () => {
    seam.docs = { [`users/${UID}`]: storedProfile() };

    await upsertUserProfile(authUser());

    // Against the Node-computed literal, not against a recomputation of the same logic. If
    // this drifts, the healthy case above stops being reachable and every launch writes.
    expect(seam.readKeys).toEqual([KNOWN_KEY]);
  });

  it('touches the profile when the index entry is missing, so the trigger runs', async () => {
    seam.docs = { [`users/${UID}`]: storedProfile() };

    await upsertUserProfile(authUser());

    expect(seam.updates).toEqual([
      { path: `users/${UID}`, data: { updatedAt: 'SERVER_TIMESTAMP' } },
    ]);
  });

  it('touches the profile when the entry points at somebody else', async () => {
    seam.docs = {
      [`users/${UID}`]: storedProfile(),
      // An email released and re-registered. The stale entry would resolve every lookup for
      // this address to the previous holder.
      [`usernames/${KNOWN_KEY}`]: { uid: 'u_previous_owner' },
    };

    await upsertUserProfile(authUser());

    expect(seam.updates).toHaveLength(1);
  });

  it('normalises before hashing, so a capitalised address finds its own entry', async () => {
    seam.docs = {
      [`users/${UID}`]: { ...storedProfile(), email: '  Alice@Example.COM  ' },
      [`usernames/${KNOWN_KEY}`]: { uid: UID },
    };

    // Auth hands back the address as typed; the index was built from the normalised form.
    await upsertUserProfile(authUser({ email: '  Alice@Example.COM  ' }));

    expect(seam.readKeys).toEqual([KNOWN_KEY]);
    expect(seam.updates).toEqual([]);
  });

  it('does not look anything up for a phone-only account', async () => {
    seam.docs = {
      [`users/${UID}`]: {
        uid: UID,
        displayName: 'Alice',
        email: null,
        phoneNumber: '+14155550123',
      },
    };

    await upsertUserProfile(authUser({ email: null, phoneNumber: '+14155550123' }));

    expect(seam.readKeys).toEqual([]);
    expect(seam.updates).toEqual([]);
  });

  it('never lets a failed repair break signing in', async () => {
    seam.docs = { [`users/${UID}`]: storedProfile() };
    seam.sha256Impl = () => Promise.reject(new Error('permission denied'));

    // Resolves. The user reaches their groups; the index stays broken until the next launch.
    await expect(upsertUserProfile(authUser())).resolves.toBeUndefined();
  });

  it('still re-syncs a changed email, and does not double-write', async () => {
    seam.docs = { [`users/${UID}`]: { ...storedProfile(), email: 'old@example.com' } };

    await upsertUserProfile(authUser());

    // The ordinary path is untouched by the repair: one write carrying the new email, and no
    // index read, because a changed email fires the trigger anyway.
    expect(seam.updates).toEqual([
      { path: `users/${UID}`, data: { email: EMAIL, updatedAt: 'SERVER_TIMESTAMP' } },
    ]);
    expect(seam.readKeys).toEqual([]);
  });
});
