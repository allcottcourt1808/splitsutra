/**
 * The session state machine, driven directly.
 *
 * This is the whole of `useAuth`'s behaviour. The hook itself is a `useSyncExternalStore`
 * binding with no branches in it, and core cannot render one anyway — `react-dom` is forbidden
 * here (Article II) and the `unit` project runs on `node` with no DOM. Putting the logic in a
 * plain module is what makes it reachable from a test at all; see the note at the top of
 * `../authStore.ts`.
 *
 * The repositories barrel is mocked wholesale rather than stubbed one export at a time, which
 * also keeps `firebase/firestore` and `firebase/auth` out of this process entirely: `refs.ts`
 * calls `getDb()` at module scope of every reference builder, and the real barrel would drag
 * the SDK in behind it for a test that has no Firebase to talk to.
 *
 * `vi.hoisted` is not decoration. `vi.mock` is hoisted above the imports, so a factory that
 * closed over a plain `const` above would run before that `const` was initialised.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { User } from '../../types/index.js';
import type { AuthUser } from '../../repositories/authRepo.js';

const repo = vi.hoisted(() => ({
  watchAuthState: vi.fn(),
  watchUserProfile: vi.fn(),
  upsertUserProfile: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../../repositories/index.js', () => repo);

const { getAuthState, resetAuthStore, subscribeAuthState } = await import('../authStore.js');

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Test doubles
 * ────────────────────────────────────────────────────────────────────────────────────────── */

type Emit<T> = (value: T) => void;
type Fail = (error: Error) => void;

/** The callbacks the store handed to `watchAuthState`, plus its unsubscribe spy. */
interface AuthChannel {
  emit: Emit<AuthUser | null>;
  fail: Fail;
  unsubscribe: ReturnType<typeof vi.fn>;
}

/** The same, for one `watchUserProfile` call. Several may exist across an account switch. */
interface ProfileChannel {
  uid: string;
  emit: Emit<User | null>;
  fail: Fail;
  unsubscribe: ReturnType<typeof vi.fn>;
}

let authChannel: AuthChannel;
let profileChannels: ProfileChannel[];

/** The most recent profile subscription — the one the store is actually listening to. */
function currentProfileChannel(): ProfileChannel {
  const channel = profileChannels.at(-1);
  if (channel === undefined) throw new Error('no profile subscription was opened');
  return channel;
}

function authUser(uid: string, overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    uid,
    displayName: 'Asha Menon',
    email: `${uid}@example.com`,
    phoneNumber: null,
    photoURL: null,
    emailVerified: true,
    isAnonymous: false,
    ...overrides,
  };
}

/**
 * A profile document, shaped enough for identity assertions.
 *
 * Not parsed through `userSchema`: the store never inspects a profile, it only holds whatever
 * the converter produced, and building a schema-valid `Timestamp` here would test the schema
 * rather than the store.
 */
function profileDoc(uid: string, displayName: string): User {
  return { uid, displayName } as unknown as User;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthStore();
  profileChannels = [];

  repo.watchAuthState.mockImplementation((emit: Emit<AuthUser | null>, fail: Fail) => {
    const unsubscribe = vi.fn();
    authChannel = { emit, fail, unsubscribe };
    return unsubscribe;
  });

  repo.watchUserProfile.mockImplementation((uid: string, emit: Emit<User | null>, fail: Fail) => {
    const unsubscribe = vi.fn();
    profileChannels.push({ uid, emit, fail, unsubscribe });
    return unsubscribe;
  });

  repo.upsertUserProfile.mockResolvedValue(undefined);
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Tests
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('subscribeAuthState', () => {
  it('does not open a session subscription until something subscribes', () => {
    expect(repo.watchAuthState).not.toHaveBeenCalled();

    subscribeAuthState(vi.fn());

    expect(repo.watchAuthState).toHaveBeenCalledTimes(1);
  });

  it('opens exactly one session subscription however many subscribers there are', () => {
    subscribeAuthState(vi.fn());
    subscribeAuthState(vi.fn());
    subscribeAuthState(vi.fn());

    expect(repo.watchAuthState).toHaveBeenCalledTimes(1);
  });

  it('stops notifying a listener that has unsubscribed, without ending the subscription', () => {
    const staying = vi.fn();
    const leaving = vi.fn();
    subscribeAuthState(staying);
    const unsubscribe = subscribeAuthState(leaving);

    unsubscribe();
    authChannel.emit(null);

    expect(leaving).not.toHaveBeenCalled();
    expect(staying).toHaveBeenCalledTimes(1);
    // The session listener itself is app-lifetime — see the note in ../authStore.ts.
    expect(authChannel.unsubscribe).not.toHaveBeenCalled();
  });

  it('surfaces a startup wiring error instead of throwing out of subscribe', () => {
    repo.watchAuthState.mockImplementation(() => {
      throw new Error('[splitsutra] Firebase is not initialised.');
    });

    expect(() => subscribeAuthState(vi.fn())).not.toThrow();
    expect(getAuthState().loading).toBe(false);
    expect(getAuthState().error?.message).toContain('not initialised');
  });
});

describe('resolving the session', () => {
  it('starts loading, and knows nothing yet', () => {
    subscribeAuthState(vi.fn());

    expect(getAuthState()).toEqual({ user: null, profile: null, loading: true, error: null });
  });

  it('resolves to signed out on the first emission, and opens no profile subscription', () => {
    const listener = vi.fn();
    subscribeAuthState(listener);

    authChannel.emit(null);

    expect(getAuthState()).toEqual({ user: null, profile: null, loading: false, error: null });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(repo.watchUserProfile).not.toHaveBeenCalled();
  });

  it('resolves to signed in, and watches that user profile', () => {
    subscribeAuthState(vi.fn());

    authChannel.emit(authUser('u1'));

    expect(getAuthState().user?.uid).toBe('u1');
    expect(getAuthState().loading).toBe(false);
    expect(repo.watchUserProfile).toHaveBeenCalledTimes(1);
    expect(currentProfileChannel().uid).toBe('u1');
  });

  it('reports a session failure and stops loading', () => {
    subscribeAuthState(vi.fn());

    authChannel.fail(new Error('network down'));

    expect(getAuthState().loading).toBe(false);
    expect(getAuthState().error?.message).toBe('network down');
  });
});

describe('the profile subscription', () => {
  it('publishes each snapshot', () => {
    subscribeAuthState(vi.fn());
    authChannel.emit(authUser('u1'));

    currentProfileChannel().emit(profileDoc('u1', 'Asha'));
    expect(getAuthState().profile?.displayName).toBe('Asha');

    currentProfileChannel().emit(profileDoc('u1', 'Asha M'));
    expect(getAuthState().profile?.displayName).toBe('Asha M');
  });

  it('publishes a missing document as null without inventing an error', () => {
    subscribeAuthState(vi.fn());
    authChannel.emit(authUser('u1'));

    currentProfileChannel().emit(null);

    expect(getAuthState().profile).toBeNull();
    expect(getAuthState().error).toBeNull();
  });

  it('surfaces a permission denial or a DocumentParseError', () => {
    subscribeAuthState(vi.fn());
    authChannel.emit(authUser('u1'));

    currentProfileChannel().fail(new Error('Missing or insufficient permissions.'));

    expect(getAuthState().error?.message).toContain('insufficient permissions');
  });
});

describe('the self-healing upsert', () => {
  it('runs once per account, not once per emission', async () => {
    subscribeAuthState(vi.fn());

    authChannel.emit(authUser('u1'));
    authChannel.emit(authUser('u1'));
    await vi.waitFor(() => expect(repo.upsertUserProfile).toHaveBeenCalledTimes(1));
  });

  it('reports a failed upsert, and retries on the next emission', async () => {
    subscribeAuthState(vi.fn());
    repo.upsertUserProfile.mockRejectedValueOnce(new Error('backend unavailable'));

    authChannel.emit(authUser('u1'));
    await vi.waitFor(() => expect(getAuthState().error?.message).toBe('backend unavailable'));

    // The retry is what stops a create lost to a dropped connection leaving the user
    // permanently profile-less.
    authChannel.emit(authUser('u1'));
    await vi.waitFor(() => expect(repo.upsertUserProfile).toHaveBeenCalledTimes(2));
  });

  it('discards a failure that belongs to a session the user has already left', async () => {
    subscribeAuthState(vi.fn());
    let reject: (reason: Error) => void = () => undefined;
    repo.upsertUserProfile.mockReturnValueOnce(
      new Promise<void>((_resolve, rejectWrite) => {
        reject = rejectWrite;
      }),
    );

    authChannel.emit(authUser('u1'));
    authChannel.emit(null);
    reject(new Error('backend unavailable'));
    await Promise.resolve();

    expect(getAuthState().error).toBeNull();
  });
});

describe('switching accounts', () => {
  it('drops the previous profile and its subscription in the same tick as the user', () => {
    subscribeAuthState(vi.fn());
    authChannel.emit(authUser('u1'));
    const first = currentProfileChannel();
    first.emit(profileDoc('u1', 'Asha'));

    authChannel.emit(authUser('u2'));

    expect(getAuthState().user?.uid).toBe('u2');
    // Not 'Asha': rendering the previous account's name under the new session, even for the
    // half-second before the first snapshot lands, is one person's data on another's screen.
    expect(getAuthState().profile).toBeNull();
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(currentProfileChannel().uid).toBe('u2');
  });

  it('ignores a late emission from the subscription it already tore down', () => {
    subscribeAuthState(vi.fn());
    authChannel.emit(authUser('u1'));
    const stale = currentProfileChannel();

    authChannel.emit(authUser('u2'));
    stale.emit(profileDoc('u1', 'Asha'));
    stale.fail(new Error('too late'));

    expect(getAuthState().profile).toBeNull();
    expect(getAuthState().error).toBeNull();
  });

  it('clears a stale error along with the account it came from', () => {
    subscribeAuthState(vi.fn());
    authChannel.emit(authUser('u1'));
    currentProfileChannel().fail(new Error('Missing or insufficient permissions.'));

    authChannel.emit(authUser('u2'));

    expect(getAuthState().error).toBeNull();
  });

  it('keeps the profile when the same account arrives with a refreshed session object', () => {
    subscribeAuthState(vi.fn());
    authChannel.emit(authUser('u1'));
    currentProfileChannel().emit(profileDoc('u1', 'Asha'));

    authChannel.emit(authUser('u1', { emailVerified: false }));

    expect(getAuthState().profile?.displayName).toBe('Asha');
    expect(repo.watchUserProfile).toHaveBeenCalledTimes(1);
  });
});

describe('signing out', () => {
  it('clears the session, the profile, and the subscription', () => {
    subscribeAuthState(vi.fn());
    authChannel.emit(authUser('u1'));
    const channel = currentProfileChannel();
    channel.emit(profileDoc('u1', 'Asha'));

    authChannel.emit(null);

    expect(getAuthState()).toEqual({ user: null, profile: null, loading: false, error: null });
    expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('re-runs the upsert on the next sign-in of the same account', async () => {
    subscribeAuthState(vi.fn());

    authChannel.emit(authUser('u1'));
    await vi.waitFor(() => expect(repo.upsertUserProfile).toHaveBeenCalledTimes(1));

    authChannel.emit(null);
    authChannel.emit(authUser('u1'));

    // A profile deleted while signed out has to heal on the next launch (AC-A1.3), so the
    // per-account memo cannot survive a sign-out.
    await vi.waitFor(() => expect(repo.upsertUserProfile).toHaveBeenCalledTimes(2));
  });
});

describe('the useSyncExternalStore contract', () => {
  it('keeps the snapshot referentially stable when nothing changed', () => {
    const listener = vi.fn();
    subscribeAuthState(listener);
    authChannel.emit(null);
    const snapshot = getAuthState();

    // The signed-out state re-emitted: same values, so the same object and no notification.
    // A fresh object here is a re-render for nothing, and a fresh object from every
    // getSnapshot call is the infinite loop React warns about by name.
    authChannel.emit(null);

    expect(getAuthState()).toBe(snapshot);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('hands out a new snapshot on every real change', () => {
    subscribeAuthState(vi.fn());
    authChannel.emit(null);
    const signedOut = getAuthState();

    authChannel.emit(authUser('u1'));

    expect(getAuthState()).not.toBe(signedOut);
    expect(signedOut.user).toBeNull();
  });

  it('lets a listener unsubscribe from inside its own notification', () => {
    const second = vi.fn();
    let unsubscribeFirst: () => void = () => undefined;
    const first = vi.fn(() => {
      unsubscribeFirst();
    });

    unsubscribeFirst = subscribeAuthState(first);
    subscribeAuthState(second);

    authChannel.emit(null);

    // Mutating the Set mid-iteration would silently skip whatever followed the entry removed.
    expect(second).toHaveBeenCalledTimes(1);
  });
});
