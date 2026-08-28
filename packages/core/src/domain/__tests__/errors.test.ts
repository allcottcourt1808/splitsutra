/**
 * `DomainError` — the one error type the money math throws.
 *
 * The UI maps `code` to copy and the Cloud Functions map it to a callable error, so
 * the code is the stable contract and the message is free to change. The table below
 * is typed as `Record<DomainErrorCode, ...>`, which makes it a **compile error** to
 * add a code to `errors.ts` without also proving something can actually throw it —
 * a code nobody throws is dead copy in the UI waiting to be written.
 */

import { describe, expect, it } from 'vitest';

import { allocate, allocateToUids } from '../allocate.js';
import { assertZeroSum } from '../balances.js';
import { DomainError, type DomainErrorCode } from '../errors.js';
import { simplifyDebts } from '../simplify.js';
import { computeSplits, splitExact, splitPercent, type SplitInput } from '../splits.js';
import { domainErrorFrom, minor, unsafeMinor } from './arbitraries.js';

/** One call per error code, each the shortest realistic route to it. */
const TRIGGERS: Record<DomainErrorCode, () => unknown> = {
  NEGATIVE_TOTAL: () => allocate(unsafeMinor(-1), [1], 'expense-1'),
  INVALID_TOTAL: () => allocate(unsafeMinor(1.5), [1], 'expense-1'),
  INVALID_WEIGHT: () => allocate(minor(100), [1.5], 'expense-1'),
  NO_PARTICIPANTS: () => allocateToUids(minor(100), [], 'expense-1'),
  DUPLICATE_UID: () =>
    allocateToUids(
      minor(100),
      [
        { uid: 'u0001', weight: 1 },
        { uid: 'u0001', weight: 1 },
      ],
      'expense-1',
    ),
  ZERO_TOTAL_WEIGHT: () => allocate(minor(100), [0, 0], 'expense-1'),
  EXACT_SUM_MISMATCH: () => splitExact(minor(100), [{ uid: 'u0001', amountMinor: 99 }]),
  PERCENT_SUM_MISMATCH: () => splitPercent(minor(100), [{ uid: 'u0001', bps: 9999 }], 'expense-1'),
  INVALID_AMOUNT: () => splitExact(minor(100), [{ uid: 'u0001', amountMinor: -1 }]),
  INVALID_SPLIT_METHOD: () => computeSplits({ method: 'barter' } as unknown as SplitInput),
  NON_INTEGER_BALANCE: () => simplifyDebts([{ uid: 'u0001', balanceMinor: 0.5 }]),
  ZERO_SUM_VIOLATION: () => assertZeroSum({ u0001: 1 }),
};

describe('DomainError', () => {
  it('is a real Error, so it survives being caught, logged and rethrown', () => {
    const error = new DomainError('INVALID_TOTAL', 'boom');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.name).toBe('DomainError');
    expect(error.message).toBe('boom');
    expect(error.code).toBe('INVALID_TOTAL');
  });

  it('keeps `instanceof` working after the prototype chain is restored', () => {
    // Subclassing a built-in silently breaks `instanceof` under an ES5 target. The
    // explicit `setPrototypeOf` is what stops every `catch (e) { if (e instanceof
    // DomainError) }` in the app from turning into a generic 500.
    const caught: unknown = domainErrorFrom(() => {
      throw new DomainError('NO_PARTICIPANTS', 'boom');
    });
    expect(caught instanceof DomainError).toBe(true);
    expect(Object.getPrototypeOf(caught)).toBe(DomainError.prototype);
  });

  it('carries a stack trace pointing at the throw site', () => {
    expect(new DomainError('INVALID_TOTAL', 'boom').stack).toBeTruthy();
  });
});

describe('every documented error code is reachable from real input', () => {
  const codes = Object.keys(TRIGGERS) as DomainErrorCode[];

  it.each(codes)('throws %s', (code) => {
    // Codes, never message strings — `errors.ts` says the wording is free to improve.
    expect(domainErrorFrom(TRIGGERS[code]).code).toBe(code);
  });

  it('carries a message a human can act on for every code', () => {
    for (const code of codes) {
      expect(domainErrorFrom(TRIGGERS[code]).message.length).toBeGreaterThan(10);
    }
  });
});
