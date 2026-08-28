/**
 * `hashToInt` — the seeded rotation behind every tie-break in the split engine.
 *
 * This function is the only source of "randomness" the domain layer has (Article VII),
 * and it has to produce **byte-identical** results in the browser, in Node inside a
 * Cloud Function, and in Hermes on React Native. If it ever drifts between runtimes,
 * the web client and the server hand the leftover cent to different people and the
 * group's balances stop agreeing with each other.
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { hashToInt } from '../hash.js';
import { arbSeed } from './arbitraries.js';

/** 2^32 — the exclusive upper bound of an unsigned 32-bit integer. */
const TWO_POW_32 = 4_294_967_296;

describe('hashToInt', () => {
  /**
   * These are the published FNV-1a 32-bit vectors. Pinning them is what proves the
   * `Math.imul` / `>>> 0` dance still implements the real algorithm rather than some
   * accidental variant of it — and an accidental variant would still look "random",
   * still be deterministic, and still pass every other test in this file.
   */
  it.each<[seed: string, expected: number]>([
    ['', 0x811c9dc5],
    ['a', 0xe40c292c],
    ['b', 0xe70c2de5],
    ['c', 0xe60c2c52],
    ['foobar', 0xbf9cf968],
    ['hello', 0x4f9f2cab],
  ])('matches the published FNV-1a 32-bit vector for %o', (seed, expected) => {
    expect(hashToInt(seed)).toBe(expected);
  });

  it('returns the FNV offset basis for the empty seed, hashing nothing', () => {
    // Also the only input that skips the loop body entirely.
    expect(hashToInt('')).toBe(0x811c9dc5);
  });

  it('always returns an unsigned 32-bit integer, so `% count` is never negative', () => {
    // A negative hash would make `rank` negative in the allocator and silently
    // corrupt the tie-break ordering rather than throwing anywhere visible.
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const hash = hashToInt(seed);
        expect(Number.isInteger(hash)).toBe(true);
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(hash).toBeLessThan(TWO_POW_32);
      }),
    );
  });

  it('returns the same value for the same seed every time', () => {
    fc.assert(
      fc.property(arbSeed, (seed) => {
        expect(hashToInt(seed)).toBe(hashToInt(seed));
      }),
    );
  });

  it('hashes non-ASCII seeds without collapsing them onto their ASCII lookalikes', () => {
    // `charCodeAt` reads UTF-16 code units, so a seed is hashed by its code points
    // rather than its bytes. That is fine — the only requirement is that every
    // runtime agrees — but it must not silently fold accented characters together.
    expect(hashToInt('é')).toBe(0x6c0b6c44);
    expect(hashToInt('é')).not.toBe(hashToInt('e'));
  });

  it('spreads adjacent expense ids across different rotation offsets', () => {
    // The whole point of the seed: consecutive expenses must not keep taxing the
    // same participant with the leftover minor unit.
    const offsets = ['expense-1', 'expense-2', 'expense-3'].map((seed) => hashToInt(seed) % 3);
    expect(new Set(offsets).size).toBe(3);
  });
});
