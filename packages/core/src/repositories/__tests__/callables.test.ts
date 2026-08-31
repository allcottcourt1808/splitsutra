/**
 * The callable seam's error handling.
 *
 * A Function's `HttpsError` message is written to be read by a person — `leaveGroup` names the
 * amount still outstanding — and screens are right to display it verbatim. The Functions SDK
 * then appends the HTTP status to it, so those sentences reached users with `[400]` on the end.
 *
 * Two things are under test, and the second is the one that would break quietly: that the suffix
 * goes, and that **`code` survives**. Screens branch on `code` — `AddFriendScreen` singles out
 * `functions/not-found` to offer an invite instead — so a fix that rewrapped the error in a
 * fresh `Error` would tidy the message and silently disable that branch.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const callable = vi.hoisted(() => ({ impl: vi.fn() }));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => callable.impl,
}));

vi.mock('../../firebase/index.js', () => ({
  getFunctionsClient: () => ({}),
}));

const { CALLABLE, callFunction, withoutStatusSuffix } = await import('../callables.js');

beforeEach(() => {
  callable.impl = vi.fn();
});

describe('withoutStatusSuffix', () => {
  it('removes the status the SDK appended', () => {
    expect(withoutStatusSuffix('That request was already answered. [400]')).toBe(
      'That request was already answered.',
    );
  });

  it('removes a single-digit status, which is what a Cloud Run rejection produces', () => {
    // A call refused by IAM never reaches the Function and arrives as `internal [0]`.
    expect(withoutStatusSuffix('internal [0]')).toBe('internal');
  });

  it('leaves a message that has no suffix exactly as it was', () => {
    expect(withoutStatusSuffix('Settle $12.50 first.')).toBe('Settle $12.50 first.');
    expect(withoutStatusSuffix('')).toBe('');
  });

  it('only strips at the end, so a bracketed number inside a sentence survives', () => {
    expect(withoutStatusSuffix('Group [404] could not be opened.')).toBe(
      'Group [404] could not be opened.',
    );
  });

  it('leaves brackets that are not a number', () => {
    expect(withoutStatusSuffix('Could not reach the server [offline]')).toBe(
      'Could not reach the server [offline]',
    );
  });
});

describe('callFunction', () => {
  it('returns the data a successful call produced', async () => {
    callable.impl = vi.fn().mockResolvedValue({ data: { requestId: 'r1' } });

    await expect(
      callFunction(CALLABLE.cancelFriendRequest, { requestId: 'a__b' }),
    ).resolves.toEqual({ requestId: 'r1' });
  });

  it('cleans the message a failed call threw', async () => {
    const thrown = Object.assign(new Error('That request was already answered. [400]'), {
      code: 'functions/failed-precondition',
    });
    callable.impl = vi.fn().mockRejectedValue(thrown);

    await expect(
      callFunction(CALLABLE.sendFriendRequest, { email: 'them@example.com' }),
    ).rejects.toThrow('That request was already answered.');
  });

  it('🔴 keeps `code`, which screens branch on', async () => {
    // AddFriendScreen offers to invite someone when this is `functions/not-found`. Rewrapping the
    // error in a fresh Error would clean the message and turn that branch off with no test failing
    // anywhere else.
    const thrown = Object.assign(new Error('No SplitSutra account. [404]'), {
      code: 'functions/not-found',
    });
    callable.impl = vi.fn().mockRejectedValue(thrown);

    const caught = await callFunction(CALLABLE.sendFriendRequest, {
      email: 'them@example.com',
    }).catch((error: unknown) => error);

    expect(Reflect.get(caught as object, 'code')).toBe('functions/not-found');
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('No SplitSutra account.');
  });

  it('rethrows something that is not an Error untouched', async () => {
    callable.impl = vi.fn().mockRejectedValue('a string, somehow');

    await expect(callFunction(CALLABLE.leaveGroup, { groupId: 'g1' })).rejects.toBe(
      'a string, somehow',
    );
  });
});
