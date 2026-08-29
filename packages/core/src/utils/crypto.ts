/**
 * SHA-256, for the `usernames/{normalizedKey}` lookup index.
 *
 * docs/03 §"usernames": the document id is `sha256(lowercase(email))` or `sha256(e164(phone))`,
 * hex. `list` is denied in `firestore.rules` (threat T5), so a client can only resolve a contact
 * whose email or phone it already knows — which is exactly why the key is a hash and not the
 * identifier itself.
 *
 * ╔══════════════════════════════════════════════════════════════════════════════════════════╗
 * ║ ⚠️ CROSS-RUNTIME CONTRACT with `firebase/functions/src/lib/identity.ts`.                   ║
 * ╚══════════════════════════════════════════════════════════════════════════════════════════╝
 *
 * That file computes the same key with `node:crypto`, because it runs on the Functions runtime
 * and Web Crypto's digest is async-only. This file cannot use `node:crypto`: core is
 * platform-agnostic (Article II) and must run under Hermes in Phase 12, where there is no Node
 * `crypto` module and `core/tsconfig.json` sets `"types": []` so `node:*` is not even declared.
 *
 * The two implementations are separate ON PURPOSE and MUST agree byte for byte:
 *
 *     key = sha256_hex(utf8(normalized_identifier))
 *
 * If they ever diverge, every friend lookup silently returns "not found" and nobody can explain
 * why — there is no error to see, just an app that claims your friend has not signed up. That is
 * why {@link sha256} hashes bytes this module encodes itself (see {@link utf8Bytes}) rather than
 * trusting a `TextEncoder` global that Hermes may or may not ship: one fewer thing that can
 * differ between the two runtimes, and one fewer global to hope for.
 *
 * 🔴 Normalisation is NOT done here. Hash only an already-normalised identifier — trimmed and
 *    lowercased for email, E.164 for phone. One stray character produces a different digest and
 *    the lookup misses silently.
 *
 * @see checklists/phase-05-friends-groups.md §5
 * @see firebase/functions/src/lib/identity.ts — the Node half of the contract
 */

/* -------------------------------------------------------------------------- */
/* Web Crypto, structurally                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The sliver of the Web Crypto API this module uses.
 *
 * Declared by hand because core compiles with `"lib": ["ES2022"]` and `"types": []` (Article II),
 * so `Crypto` and `SubtleCrypto` are not in scope — the same tsconfig that makes `document` a
 * compile error also withholds every other platform global. Writing the shape out is not a
 * workaround for that rule; it is the rule working. It keeps the dependency to "a `subtle.digest`
 * exists at runtime", which is checkable, instead of a compile-time assumption that a DOM
 * typing was telling the truth about Hermes.
 */
interface WebCryptoLike {
  readonly subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  };
}

/**
 * The host's Web Crypto, or `undefined` if this runtime does not have a usable one.
 *
 * Every level is probed rather than assumed, because there are three genuinely different
 * "missing" states and only one of them is exotic:
 *
 *  1. **No `crypto` at all** — Hermes without a polyfill. React Native ships no Web Crypto;
 *     Phase 12 has to install `react-native-quick-crypto` or `expo-crypto`.
 *  2. **`crypto` present, `crypto.subtle` undefined** — *any browser on a non-secure origin*.
 *     `SubtleCrypto` is gated on secure contexts, so a page served over plain `http://` (an
 *     IP-address dev build on a phone, say) has `crypto.getRandomValues` but no `subtle`. This
 *     is the one that will actually bite someone.
 *  3. **`subtle` present, `digest` not callable** — a partial polyfill.
 *
 * The cast through `unknown` is deliberate: `typeof globalThis` genuinely does not declare
 * `crypto` under this tsconfig, and pretending otherwise with an ambient declaration would
 * assert the very thing this function exists to check.
 */
function hostCrypto(): WebCryptoLike | undefined {
  const host = globalThis as unknown as { readonly crypto?: unknown };

  const candidate = host.crypto;
  if (typeof candidate !== 'object' || candidate === null) return undefined;

  const subtle = (candidate as { readonly subtle?: unknown }).subtle;
  if (typeof subtle !== 'object' || subtle === null) return undefined;

  if (typeof (subtle as { readonly digest?: unknown }).digest !== 'function') return undefined;

  return candidate as WebCryptoLike;
}

/* -------------------------------------------------------------------------- */
/* UTF-8                                                                      */
/* -------------------------------------------------------------------------- */

/** Unicode replacement character. What an unpaired surrogate encodes as. */
const REPLACEMENT = 0xfffd;

/**
 * UTF-8 encode a string, matching `TextEncoder#encode` and Node's `Buffer.from(s, 'utf8')`
 * byte for byte — including their handling of unpaired surrogates, which both replace with
 * U+FFFD rather than throwing.
 *
 * Hand-written for the reason in the file header: this is the half of the hash that must agree
 * with `node:crypto` on the server, and an implementation that is present on every runtime is
 * worth more than one that is faster on some of them. The digest hides any disagreement, so it
 * is tested through known vectors for ASCII, accented Latin, Devanagari and an astral emoji.
 */
function utf8Bytes(input: string): Uint8Array {
  const bytes: number[] = [];

  for (let index = 0; index < input.length; index += 1) {
    let code = input.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate. Pair it with the low surrogate that must follow, or replace it.
      const low = index + 1 < input.length ? input.charCodeAt(index + 1) : 0;
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      } else {
        code = REPLACEMENT;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // A low surrogate reached on its own — the pair was broken, e.g. by a `.slice()`
      // that cut an emoji in half.
      code = REPLACEMENT;
    }

    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }

  return Uint8Array.from(bytes);
}

/** Lowercase hex, two characters per byte — the spelling `node:crypto`'s `digest('hex')` emits. */
function toHex(digest: ArrayBuffer): string {
  let hex = '';
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/* -------------------------------------------------------------------------- */
/* The public API                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Lowercase hex SHA-256 of `input`, encoded as UTF-8.
 *
 * ```ts
 * await sha256('') // 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
 * ```
 *
 * Asynchronous because `SubtleCrypto#digest` is — there is no synchronous Web Crypto digest,
 * which is the whole reason the Cloud Functions half of this contract uses `node:crypto`
 * instead of sharing this function.
 *
 * @param input An **already-normalised** identifier. See the 🔴 note in the file header.
 * @throws {Error} (as a rejection) if this runtime has no usable Web Crypto. Failing loudly is
 *   deliberate: the alternative is a silent fallback to some weaker digest, which would produce
 *   a plausible-looking key that no `usernames/` document has ever been written under, and turn
 *   "this runtime is missing a capability" into "friend lookup is quietly broken forever".
 */
export async function sha256(input: string): Promise<string> {
  const webCrypto = hostCrypto();
  if (webCrypto === undefined) {
    throw new Error(
      '[splitsutra] Web Crypto is unavailable, so sha256() cannot compute the usernames/ ' +
        'lookup key. On the web this usually means the page is served over plain http:// — ' +
        'crypto.subtle only exists in a secure context (https:// or localhost). On React ' +
        'Native it means no Web Crypto polyfill is installed (react-native-quick-crypto or ' +
        'expo-crypto). Core must not fall back to node:crypto (Article II).',
    );
  }

  return toHex(await webCrypto.subtle.digest('SHA-256', utf8Bytes(input)));
}
