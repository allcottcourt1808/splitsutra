/**
 * Deterministic string hashing for split tie-breaks.
 *
 * Article VII forbids randomness that is not seeded from stored data. The split
 * engine still needs to vary *which* participant absorbs a leftover minor unit —
 * otherwise whoever's uid sorts first pays the extra cent on every expense, forever.
 *
 * The resolution (doc 04 §2.1) is a rotation seeded by the expense id: reproducible
 * from stored data alone, identical across edits of the same expense and across
 * client and Cloud Function, but different from one expense to the next.
 */

/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET_BASIS_32 = 0x811c9dc5;

/** FNV-1a 32-bit prime (16 777 619). */
const FNV_PRIME_32 = 0x01000193;

/**
 * FNV-1a, 32-bit. Maps an arbitrary string to an integer in `[0, 2^32)`.
 *
 * Chosen because it is tiny, dependency-free, and — critically — specified purely
 * in terms of integer bit operations, so it produces byte-identical results on
 * every JavaScript engine. `String.prototype.localeCompare`, `Intl`, and anything
 * else ICU-backed would not: doc 04 §1 explains why Hermes' trimmed ICU makes
 * locale-dependent behaviour unusable anywhere near the money math.
 *
 * This is a *distribution* hash, not a cryptographic one. It is used only to pick
 * a rotation offset; collisions cost nothing.
 *
 * @param seed Any string. In practice the expense id.
 * @returns An unsigned 32-bit integer.
 */
export function hashToInt(seed: string): number {
  let hash = FNV_OFFSET_BASIS_32;
  for (let index = 0; index < seed.length; index += 1) {
    // `^=` reinterprets `hash` as a signed int32; `Math.imul` performs the
    // multiply on the same 32-bit representation and `>>> 0` converts back to
    // unsigned. The bit pattern — and therefore the FNV result — is exact at
    // every step. A plain `hash * FNV_PRIME_32` would overflow into a float and
    // lose low bits, which is precisely the class of bug Article I exists for.
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME_32) >>> 0;
  }
  return hash >>> 0;
}
