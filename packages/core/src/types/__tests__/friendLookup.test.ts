/**
 * `describeFriendLookup` — the sentence shown under the field instead of a Zod dump.
 *
 * The bug this replaces: `AddFriendScreen` sent the raw value, `sendFriendRequestSchema.parse()`
 * threw, and the screen rendered `error.message` — which for a `ZodError` is the JSON-encoded
 * issue array. A user typing a local phone number saw this, only after pressing Send:
 *
 *     [ { "origin": "string", "code": "invalid_format", "format": "regex",
 *         "pattern": "/^\\+[1-9]\\d{7,14}$/", "path": ["phoneNumber"], ... } ]
 */

import { describe, expect, it } from 'vitest';

import { describeFriendLookup } from '../callables.js';

/** Nothing this function returns may ever look like serialised validator output. */
function isHumanReadable(message: string): boolean {
  return (
    !message.includes('{') &&
    !message.includes('"code"') &&
    !message.includes('\\d') &&
    message.trim().length > 0
  );
}

describe('describeFriendLookup', () => {
  it('says nothing about a field that is still empty', () => {
    // Not yet wrong. Marking an untouched field invalid is nagging, not validation.
    expect(describeFriendLookup('phone', '')).toBeNull();
    expect(describeFriendLookup('email', '   ')).toBeNull();
  });

  it('accepts what the Function accepts', () => {
    expect(describeFriendLookup('email', 'them@example.com')).toBeNull();
    expect(describeFriendLookup('phone', '+14155550123')).toBeNull();
    // Trimmed and lowercased by the schema before matching, so these are fine too.
    expect(describeFriendLookup('email', '  Them@Example.COM ')).toBeNull();
  });

  it('🔴 tells a phone user about the country code, in words', () => {
    // The exact input from the bug report: a local US number, no `+1`.
    const message = describeFriendLookup('phone', '2242004406');

    expect(message).not.toBeNull();
    expect(isHumanReadable(message ?? '')).toBe(true);
    // It has to say what to DO, not merely that something is wrong.
    expect(message).toContain('+14155550123');
  });

  it('🔴 never returns serialised validator output, whatever it is given', () => {
    const nasty = ['2242004406', 'not-an-email', '@@@', '+', '++1234', 'a'.repeat(400), '  x  '];
    for (const mode of ['email', 'phone'] as const) {
      for (const value of nasty) {
        const message = describeFriendLookup(mode, value);
        if (message === null) continue;
        expect(isHumanReadable(message), `${mode} / ${value} -> ${message}`).toBe(true);
      }
    }
  });

  it('does not lecture an email user with a regex', () => {
    const message = describeFriendLookup('email', 'not-an-email');
    expect(message).toBe('That does not look like an email address.');
  });
});
