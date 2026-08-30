/**
 * `groups/{groupId}/settlements/{settlementId}` — checklists/phase-07 §4.
 *
 * A settlement records a payment that **already happened outside the app**. SplitSutra never
 * moves money, and the settle-up screen says so in as many words (AC-E2.3).
 *
 * ## Creating one is a direct client write; its balance effect is not
 *
 * Rules can validate a settlement from the request alone — positive integer amount, two
 * different current members, the group's own currency — so `createSettlement` writes straight to
 * Firestore. What it must never do is touch a balance: `onSettlementWritten` recomputes those
 * from the ledger (Article III/V). `from.balanceMinor += amount`, `to.balanceMinor -= amount` is
 * the server's arithmetic, not the client's.
 *
 * ## Deletion is a soft delete
 *
 * Article V. `allow delete: if false` in Rules; removing a settlement is an update that sets
 * `deletedAt`, and the same Function reverses its effect on the next recompute (AC-E2.5).
 */

import {
  Timestamp,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

import {
  getExponent,
  settlementBaseSchema,
  type CurrencyCode,
  type MinorUnits,
  type Settlement,
} from '../types/index.js';
import { settlementDoc, settlementsCollection } from './refs.js';
import { watchQuery, type OnError, type OnNext, type Unsubscribe } from './subscribe.js';

/** Matches the expense list page size (docs/03 §Query patterns). */
export const SETTLEMENTS_PAGE_SIZE = 50;

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Amount parsing
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Parse a typed amount — `"25"`, `"25.5"`, `"1,250.00"` — into minor units for `currency`.
 *
 * Returns `null` for anything that is not a well-formed non-negative amount with no more
 * fractional digits than the currency has, so a caller can render an inline message instead of
 * catching. Zero parses; "greater than zero" is the settlement's rule, not the number's.
 *
 * 🔴 **No `parseFloat`, no multiplication by 100** (Article I). The fraction is padded to the
 * currency's exponent as a *string* and the two halves are concatenated, so `"0.1"` in USD is
 * exactly `10` rather than whatever `0.1 * 100` rounds to. The exponent comes from the
 * hardcoded ISO 4217 table, never from `Intl` (docs/04 §1).
 *
 * TODO: this belongs beside `formatMoney` in `src/utils/money.ts` — it is the inverse of it, and
 *   Add Expense needs the same function. Left here because that file was owned by another change
 *   in flight; move it, do not copy it (Article VI).
 */
export function parseAmountToMinor(input: string, currency: CurrencyCode): MinorUnits | null {
  const cleaned = input.trim().replace(/[\s,]/g, '');
  if (!/^\d*(\.\d*)?$/.test(cleaned) || cleaned === '' || cleaned === '.') return null;

  const exponent = getExponent(currency);
  const [whole = '', fraction = ''] = cleaned.split('.');
  if (fraction.length > exponent) return null;

  const digits = `${whole === '' ? '0' : whole}${fraction.padEnd(exponent, '0')}`;
  const value = Number(digits);
  if (!Number.isSafeInteger(value)) return null;

  return value as MinorUnits;
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Reads
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The group's settlement history, newest first, soft-deleted ones excluded.
 *
 * `deletedAt == null` plus `orderBy('date')` needs the `deletedAt` ASC + `date` DESC composite
 * index declared in `firestore.indexes.json`; without it the query fails at runtime with a
 * `failed-precondition` carrying the URL that creates it.
 */
export function watchSettlements(
  groupId: string,
  onNext: OnNext<readonly Settlement[]>,
  onError: OnError,
): Unsubscribe {
  return watchQuery(
    query(
      settlementsCollection(groupId),
      where('deletedAt', '==', null),
      orderBy('date', 'desc'),
      limit(SETTLEMENTS_PAGE_SIZE),
    ),
    onNext,
    onError,
  );
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Writes
 * ────────────────────────────────────────────────────────────────────────────────────────── */

export interface CreateSettlementInput {
  readonly groupId: string;
  /** The payer. Their balance moves up toward zero. */
  readonly fromUid: string;
  /** The receiver. */
  readonly toUid: string;
  readonly amountMinor: MinorUnits;
  /** Must equal the group's currency — Rules check it against the group document. */
  readonly currency: CurrencyCode;
  /** When the payment actually happened. Defaults to now. */
  readonly date?: Date | undefined;
  /** 0–200 characters, or `null`. */
  readonly note?: string | null | undefined;
}

/**
 * Record a payment. Returns the new settlement id.
 *
 * Parsed against the same shapes Rules enforce so a zero amount or a self-payment fails here
 * with a message that names the field rather than arriving as a flat permission-denied. Article
 * IV: that parse is UX; Rules re-check all of it, and the Function re-checks it again.
 */
export async function createSettlement(uid: string, input: CreateSettlementInput): Promise<string> {
  const amountMinor = settlementBaseSchema.shape.amountMinor.parse(input.amountMinor);
  const currency = settlementBaseSchema.shape.currency.parse(input.currency);
  const note = settlementBaseSchema.shape.note.parse(input.note ?? null);

  if (input.fromUid === input.toUid) {
    throw new Error('A settlement cannot be from someone to themselves.');
  }

  const reference = doc(settlementsCollection(input.groupId));

  await setDoc(reference, {
    id: reference.id,
    groupId: input.groupId,
    fromUid: input.fromUid,
    toUid: input.toUid,
    amountMinor,
    currency,
    // A user-chosen date, so NOT `serverTimestamp()`. `createdAt` is the pinned one (T7);
    // `date` is what the payment is filed under and the user may backdate it.
    date: Timestamp.fromDate(input.date ?? new Date()),
    note,
    createdBy: uid,
    createdAt: serverTimestamp(),
    deletedAt: null,
  });

  return reference.id;
}

/**
 * Soft-delete a settlement (AC-E2.5).
 *
 * Article V — the row stays in the ledger with `deletedAt` set, and the recompute reverses its
 * effect exactly. Rules permit this only for the creator or a group admin, the same ADR-11 gate
 * expenses get: a settlement moves balances just as an expense does.
 */
export async function softDeleteSettlement(groupId: string, settlementId: string): Promise<void> {
  await updateDoc(settlementDoc(groupId, settlementId), { deletedAt: serverTimestamp() });
}
