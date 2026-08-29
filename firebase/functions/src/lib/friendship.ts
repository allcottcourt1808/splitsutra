import { FieldValue, db, type Transaction } from '../common/admin.js';
import { CURRENCIES } from '../common/contracts.js';
import { newMemberDoc, type ProfileSnapshot } from './groups.js';

/**
 * ============================================================================
 * ESTABLISHING A FRIENDSHIP — the one place a friendship is actually written
 * ============================================================================
 * Extracted from the old `addFriend`, which did the lookup and this write in one
 * function. Consent now sits between the two halves (see
 * `packages/core/src/types/friendRequest.ts`), so the lookup lives in
 * `sendFriendRequest` and this half runs when the recipient accepts.
 *
 * 🔴 BOTH SIDES IN ONE TRANSACTION. checklists/phase-05 §6: "a one-directional
 *    friendship is painful to detect later". The group, both member documents and
 *    both `users/{x}/friends/{y}` documents commit together or not at all — a
 *    friendship that exists on one side only is a corrupt state no screen checks
 *    for, and nothing would ever repair it.
 *
 * 🔴 THE CALLER ALLOCATES THE GROUP REF, OUTSIDE THE TRANSACTION. `runTransaction`
 *    retries its callback on contention, and a `.doc()` called inside would mint a
 *    DIFFERENT id on the retry — turning one friendship into two implicit groups.
 *    That is why {@link establishFriendship} takes a ref rather than creating one.
 * ============================================================================
 */

/**
 * Fallback when the deciding profile carries no usable `defaultCurrency`.
 *
 * ⚠️ Mirrors `DEFAULT_CURRENCY` in `@splitsutra/core` (`types/currency.ts`), which
 *    `common/contracts.ts` — the seam file listing every borrowed core symbol —
 *    does not re-export. Re-declared here rather than reached for through a second,
 *    undocumented import path. This is not money math (Article VI is not in play);
 *    it is a default. Delete this constant and import it the next time the seam
 *    file is revised.
 */
const FALLBACK_CURRENCY = 'USD';

/** One participant in a new friendship. */
export interface FriendshipParty {
  readonly uid: string;
  readonly profile: ProfileSnapshot;
}

/** What {@link establishFriendship} needs to write both sides at once. */
export interface EstablishFriendshipInput {
  /**
   * The group's `createdBy`, and its `admin`.
   *
   * Roles are asymmetric — creator `admin`, the other `member` — matching every other
   * group and `onGroupCreated`'s convention. Symmetric admin would read as fairer and
   * is worse: `removeMember` is admin-gated, so two admins in a two-person group means
   * either friend can evict the other from their shared history.
   */
  readonly creator: FriendshipParty;
  readonly other: FriendshipParty;
  /**
   * Allocated by the caller, OUTSIDE the transaction. See the header.
   *
   * If the transaction takes the "already friends" path this ref is simply never written;
   * an unwritten reference costs nothing.
   */
  readonly groupRef: FirebaseFirestore.DocumentReference;
  /**
   * Raw `defaultCurrency` from whichever profile decides it, validated below.
   *
   * 🔴 IMMUTABLE once the group is created (T10, AC-C1.1) — changing a group's currency
   *    later reinterprets every amount already stored in it.
   */
  readonly currencyHint: unknown;
}

/** What {@link establishFriendship} did. */
export interface FriendshipOutcome {
  readonly implicitGroupId: string;
  /** `true` when the pair was already friends and this call only found the existing group. */
  readonly alreadyFriends: boolean;
  /** `true` when a one-directional friendship was found and the missing half rewritten. */
  readonly repaired: boolean;
}

/**
 * Create the implicit group and both friend documents, inside `tx`.
 *
 * **Must be called before any other write in the transaction and after no other read**, because
 * it issues reads itself and Firestore requires every read in a transaction to precede every
 * write. Callers that need their own reads should perform them here too, or before invoking it.
 *
 * Idempotent: if the pair are already friends it returns the existing group untouched, which is
 * what makes a retried acceptance safe.
 */
export async function establishFriendship(
  tx: Transaction,
  input: EstablishFriendshipInput,
): Promise<FriendshipOutcome> {
  const { creator, other, groupRef, currencyHint } = input;

  const creatorFriendRef = db.doc(`users/${creator.uid}/friends/${other.uid}`);
  const otherFriendRef = db.doc(`users/${other.uid}/friends/${creator.uid}`);

  /* ---- reads, all of them, before any write ---------------------------------------------- */
  const [mine, theirs] = await Promise.all([tx.get(creatorFriendRef), tx.get(otherFriendRef)]);

  const myGid = mine.data()?.['implicitGroupId'];
  const theirGid = theirs.data()?.['implicitGroupId'];
  const existingGid =
    typeof myGid === 'string' && myGid.length > 0
      ? myGid
      : typeof theirGid === 'string' && theirGid.length > 0
        ? theirGid
        : null;

  /* ---- already friends: idempotent, and repair a half-written pair ----------------------- */
  if (existingGid !== null) {
    // A friendship that exists on ONE side only is the corruption the single transaction
    // below is designed to prevent, so finding one means an older write was interrupted.
    // Repair the missing half against the group that already exists rather than minting a
    // second implicit group for the same pair — two groups would split the same pair's
    // history across both.
    if (!mine.exists) {
      tx.set(creatorFriendRef, friendDoc(other.uid, other.profile, existingGid));
    }
    if (!theirs.exists) {
      tx.set(otherFriendRef, friendDoc(creator.uid, creator.profile, existingGid));
    }
    return {
      implicitGroupId: existingGid,
      alreadyFriends: true,
      repaired: !mine.exists || !theirs.exists,
    };
  }

  /* ---- writes ---------------------------------------------------------------------------- */
  // D2 / docs/03: a 1:1 friendship is not a second code path — it is a normal group flagged
  // `isImplicit` and hidden from the group list, so every expense, balance and settlement
  // code path works on it unchanged.
  tx.set(groupRef, {
    id: groupRef.id,
    name: implicitGroupName(creator.profile.displayName, other.profile.displayName),
    type: 'friend',
    isImplicit: true,
    photoURL: null,
    // 🔴 IMMUTABLE after this line (T10, AC-C1.1). Whoever's default decides it fixes the
    //    currency for the pair. docs/03 §"Forward design: multi-currency" is where that stops
    //    being a wrinkle; until then it is one, deliberately.
    currency: resolveCurrency(currencyHint),
    memberIds: [creator.uid, other.uid],
    memberCount: 2,
    simplifyDebts: false,
    createdBy: creator.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastActivityAt: FieldValue.serverTimestamp(),
    deletedAt: null,
    // v1 writes null for both; readers fall back to `currency` (docs/03).
    baseCurrency: null,
    allowMixedCurrency: null,
  });

  // Both member documents are written HERE rather than left to `onGroupCreated`. That trigger
  // seeds only the creator and reads-before-writing precisely because this code gets there
  // first (see its IDEMPOTENCE note); it would never seed the other party at all.
  tx.set(
    db.doc(`groups/${groupRef.id}/members/${creator.uid}`),
    newMemberDoc(creator.uid, 'admin', creator.profile),
  );
  tx.set(
    db.doc(`groups/${groupRef.id}/members/${other.uid}`),
    newMemberDoc(other.uid, 'member', other.profile),
  );

  // 🔴 Both directions, same transaction. See the header.
  tx.set(creatorFriendRef, friendDoc(other.uid, other.profile, groupRef.id));
  tx.set(otherFriendRef, friendDoc(creator.uid, creator.profile, groupRef.id));

  return { implicitGroupId: groupRef.id, alreadyFriends: false, repaired: false };
}

/**
 * A `users/{uid}/friends/{friendUid}` document (docs/03).
 *
 * 🔴 `balanceMinor` starts as an EMPTY map, not `{ USD: 0 }`. Core's
 *    `balanceByCurrencySchema` is a sparse record — a currency appears only once the pair
 *    actually has a balance in it, and D6 forbids ever summing across the entries. Seeding a
 *    zero would assert a currency relationship that does not exist yet.
 */
function friendDoc(
  friendUid: string,
  profile: ProfileSnapshot,
  implicitGroupId: string,
): Record<string, unknown> {
  return {
    friendUid,
    displayName: profile.displayName,
    photoURL: profile.photoURL,
    implicitGroupId,
    balanceMinor: {},
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * A `defaultCurrency`, validated against the real ISO 4217 table.
 *
 * `CURRENCIES` comes from `@splitsutra/core` through `common/contracts.ts` — the same table
 * `onExpenseWritten` validates against (Q4: a rule can only match `^[A-Z]{3}$`, and `ZZZ` passes
 * that). A group created with a code that is not a currency has an unrenderable exponent and
 * every amount in it is undisplayable.
 */
function resolveCurrency(raw: unknown): string {
  return typeof raw === 'string' && Object.hasOwn(CURRENCIES, raw) ? raw : FALLBACK_CURRENCY;
}

/**
 * `"Neethu & Sandeep"`, clamped to the 1..60 core's `groupSchema` allows.
 *
 * Cosmetic only: the group is `isImplicit` and hidden from the group list (D2), so this name is
 * seen in exports and support tooling rather than in the app. It is a snapshot and is not
 * refreshed on a rename — `onUserProfileWritten` fans out to member documents, not to group
 * names.
 */
function implicitGroupName(mine: string, theirs: string): string {
  const joined = `${mine} & ${theirs}`.trim();
  return joined.length <= 60 ? joined : joined.slice(0, 60).trim();
}
