import { CURRENCIES } from './contracts.js';
import { FieldValue, db } from './admin.js';
import { MAX_GROUP_MEMBERS, MAX_AMOUNT_MINOR } from './config.js';
import { logError, logWarn } from './logging.js';

/**
 * ============================================================================
 * LAYER 2 — the authoritative half of every two-layer check
 * ============================================================================
 *
 * firestore.rules can shape-check but cannot loop, cannot reduce an array, and
 * cannot hold the ~180-entry ISO 4217 table. Q1 (docs/12) resolved that with
 * Option A: the client writes redundant `splitsTotalMinor` / `paidTotalMinor`
 * checksums, rules assert they equal `amountMinor`, and THIS CODE recomputes the
 * real sums and quarantines the document when they disagree.
 *
 * 🔴 "The Function-side check is MANDATORY, not optional — without it, Option A is
 *    theatre." (docs/12 Q1.) Everything in this file is that check. Deleting or
 *    weakening it silently re-opens T3 and T6.
 *
 * What rules genuinely cannot see, and this file therefore owns outright:
 *   - the actual sum of splits[] and paidBy[]            (T3)
 *   - paidBy[].uid membership — those uids live inside
 *     maps in an array, unreachable from a rule           (T6)
 *   - participantIds really equalling splits[].uid        (inv 7)
 *   - whether a 3-letter uppercase string is a REAL
 *     ISO 4217 code                                       (Q4)
 *
 * Quarantine, not deletion: Article V says nothing leaves the ledger.
 * `recomputeBalances` excludes quarantined documents, so a forged expense stops
 * affecting anyone's money without destroying the evidence.
 * ============================================================================
 */

/** The real ISO 4217 set, from the single source of truth in @splitsutra/core (Article VI). */
const ISO_4217: ReadonlySet<string> = new Set(Object.keys(CURRENCIES));

export interface IntegrityFailure {
  ok: false;
  reason: string;
}

export type IntegrityResult = { ok: true } | IntegrityFailure;

const OK: IntegrityResult = { ok: true };
const fail = (reason: string): IntegrityFailure => ({ ok: false, reason });

export interface ExpenseCheckContext {
  groupCurrency: string;
  /** Members with leftAt == null. A NEW expense may only reference these. */
  activeMemberIds: ReadonlySet<string>;
  /**
   * Every member doc id in the group, including people who have left. An EDIT to a
   * historical expense may still reference them — docs/06 keeps the member doc on
   * leave precisely so old expenses stay renderable and editable.
   */
  everMemberIds: ReadonlySet<string>;
  isCreate: boolean;
}

/**
 * Full validation of the 7 invariants in docs/03 §"Validation invariants", against
 * data that arrived from a hostile client and has only been shape-checked.
 * Everything is treated as `unknown` until proven otherwise.
 */
export function checkExpense(raw: unknown, ctx: ExpenseCheckContext): IntegrityResult {
  if (!isRecord(raw)) return fail('expense is not an object');

  // --- invariant 1: amountMinor is a positive integer within bounds -------------
  const amountMinor = raw['amountMinor'];
  if (!isMinorAmount(amountMinor) || amountMinor <= 0) {
    return fail('amountMinor must be an integer in (0, MAX_AMOUNT_MINOR]');
  }

  // --- invariant 6 + Q4 layer 2: currency is REAL and matches the group ---------
  const currency = raw['currency'];
  if (typeof currency !== 'string' || !ISO_4217.has(currency)) {
    return fail(`currency ${String(currency)} is not a valid ISO 4217 code`);
  }
  if (currency !== ctx.groupCurrency) {
    return fail(`currency ${currency} does not match group currency ${ctx.groupCurrency}`);
  }

  const description = raw['description'];
  if (typeof description !== 'string' || description.length < 1 || description.length > 100) {
    return fail('description must be 1..100 characters');
  }

  // --- splits ------------------------------------------------------------------
  const splits = raw['splits'];
  if (!Array.isArray(splits) || splits.length < 1 || splits.length > MAX_GROUP_MEMBERS) {
    return fail(`splits must be an array of 1..${MAX_GROUP_MEMBERS} entries`);
  }
  const splitParse = parseEntries(splits, 'splits');
  if (!splitParse.ok) return splitParse;

  // --- paidBy ------------------------------------------------------------------
  const paidBy = raw['paidBy'];
  if (!Array.isArray(paidBy) || paidBy.length < 1 || paidBy.length > MAX_GROUP_MEMBERS) {
    return fail(`paidBy must be an array of 1..${MAX_GROUP_MEMBERS} entries`);
  }
  const paidParse = parseEntries(paidBy, 'paidBy');
  if (!paidParse.ok) return paidParse;

  // --- invariant 4 + T6 (layer 2): every uid is a member -----------------------
  // This is the half rules cannot do: paidBy uids are inside maps, and rules cannot
  // project a field out of an array of maps.
  const allowed = ctx.isCreate ? ctx.activeMemberIds : ctx.everMemberIds;
  for (const uid of [...splitParse.uids, ...paidParse.uids]) {
    if (!allowed.has(uid)) {
      return fail(`uid ${uid} is not a member of this group`);
    }
  }

  // --- invariants 2 + 3 + T3 (layer 2): the sums are REALLY the total ----------
  if (splitParse.total !== amountMinor) {
    return fail(`splits sum to ${splitParse.total}, expected ${amountMinor}`);
  }
  if (paidParse.total !== amountMinor) {
    return fail(`paidBy sums to ${paidParse.total}, expected ${amountMinor}`);
  }

  // --- Q1 Option A: the client checksum must match the COMPUTED sum -------------
  // Rules only proved checksum == amountMinor. An attacker who writes a correct
  // checksum alongside a wrong array passes layer 1 and is caught precisely here.
  if (raw['splitsTotalMinor'] !== splitParse.total) {
    return fail(
      `splitsTotalMinor ${String(raw['splitsTotalMinor'])} disagrees with the actual ` +
        `splits sum ${splitParse.total}`,
    );
  }
  if (raw['paidTotalMinor'] !== paidParse.total) {
    return fail(
      `paidTotalMinor ${String(raw['paidTotalMinor'])} disagrees with the actual ` +
        `paidBy sum ${paidParse.total}`,
    );
  }

  // --- invariant 7: participantIds matches splits[].uid exactly -----------------
  const participantIds = raw['participantIds'];
  if (!Array.isArray(participantIds) || participantIds.length !== splitParse.uids.length) {
    return fail('participantIds length does not match splits length');
  }
  const participantSet = new Set<string>();
  for (const p of participantIds) {
    if (typeof p !== 'string') return fail('participantIds must contain strings');
    if (participantSet.has(p)) return fail(`participantIds contains duplicate ${p}`);
    participantSet.add(p);
  }
  for (const uid of splitParse.uids) {
    if (!participantSet.has(uid)) {
      return fail(`participantIds is missing split uid ${uid}`);
    }
  }

  return OK;
}

interface ParsedEntries {
  ok: true;
  uids: string[];
  total: number;
}

/**
 * Parses an array of `{ uid, amountMinor }`, enforcing invariant 5 (uids unique
 * within the array) and Article I (integers only — a float here is a money bug).
 */
function parseEntries(entries: unknown[], label: string): ParsedEntries | IntegrityFailure {
  const uids: string[] = [];
  const seen = new Set<string>();
  let total = 0;

  for (const entry of entries) {
    if (!isRecord(entry)) return fail(`${label} entry is not an object`);
    // No cast: `isRecord` has already narrowed `entry` to Record<string, unknown>, so both
    // fields destructure as `unknown` — which is what the guards below expect. Asserting a
    // shape here would claim these keys exist before anything has checked that they do.
    const { uid, amountMinor } = entry;

    if (typeof uid !== 'string' || uid.length === 0) {
      return fail(`${label} entry has a missing or non-string uid`);
    }
    if (seen.has(uid)) {
      return fail(`${label} contains duplicate uid ${uid}`);
    }
    seen.add(uid);
    uids.push(uid);

    // Article I — money is never a float. `12.5` here would corrupt the ledger.
    if (!isMinorAmount(amountMinor) || amountMinor < 0) {
      return fail(`${label} entry for ${uid} has a non-integer or out-of-range amountMinor`);
    }
    total += amountMinor;
  }

  return { ok: true, uids, total };
}

export interface SettlementCheckContext {
  groupCurrency: string;
  everMemberIds: ReadonlySet<string>;
}

/** docs/03 §"settlements": fromUid !== toUid, both members, amountMinor > 0. */
export function checkSettlement(raw: unknown, ctx: SettlementCheckContext): IntegrityResult {
  if (!isRecord(raw)) return fail('settlement is not an object');

  const amountMinor = raw['amountMinor'];
  if (!isMinorAmount(amountMinor) || amountMinor <= 0) {
    return fail('amountMinor must be an integer in (0, MAX_AMOUNT_MINOR]');
  }

  const currency = raw['currency'];
  if (typeof currency !== 'string' || !ISO_4217.has(currency)) {
    return fail(`currency ${String(currency)} is not a valid ISO 4217 code`);
  }
  if (currency !== ctx.groupCurrency) {
    return fail(`currency ${currency} does not match group currency ${ctx.groupCurrency}`);
  }

  const fromUid = raw['fromUid'];
  const toUid = raw['toUid'];
  if (typeof fromUid !== 'string' || typeof toUid !== 'string') {
    return fail('fromUid and toUid must be strings');
  }
  if (fromUid === toUid) return fail('fromUid and toUid must differ');
  if (!ctx.everMemberIds.has(fromUid)) return fail(`fromUid ${fromUid} is not a member`);
  if (!ctx.everMemberIds.has(toUid)) return fail(`toUid ${toUid} is not a member`);

  const note = raw['note'];
  if (note !== null && note !== undefined && (typeof note !== 'string' || note.length > 200)) {
    return fail('note must be null or a string of at most 200 characters');
  }

  return OK;
}

/**
 * Applies a check result to the stored document.
 *
 * 🔴 Article XI — "No function writes back to its own trigger path without a diff
 *    guard." This writes to the exact path that triggered it, so the guard below is
 *    load-bearing: it writes ONLY when the quarantine state actually changes.
 *    Stamping a `checkedAt` timestamp on every pass would re-trigger the function
 *    forever and turn a validation routine into a billing incident.
 */
export async function applyIntegrityResult(
  path: string,
  current: Record<string, unknown>,
  result: IntegrityResult,
  ctx: { fn: string; gid: string; docId: string },
): Promise<void> {
  const wasQuarantined = current['integrityStatus'] === 'quarantined';
  const previousReason = current['integrityReason'] ?? null;

  if (result.ok) {
    if (!wasQuarantined) return; // no state change -> no write -> no loop
    await db.doc(path).update({
      integrityStatus: null,
      integrityReason: null,
      integrityClearedAt: FieldValue.serverTimestamp(),
    });
    logWarn(ctx, 'integrity restored; document released from quarantine');
    return;
  }

  if (wasQuarantined && previousReason === result.reason) {
    return; // already quarantined for this exact reason -> no write -> no loop
  }

  await db.doc(path).update({
    integrityStatus: 'quarantined',
    integrityReason: result.reason,
    integrityQuarantinedAt: FieldValue.serverTimestamp(),
  });

  // ERROR, not WARN: a document reaching here got past firestore.rules, which means
  // either a client bug or an actual attack. Both are worth an alert (docs/10).
  logError({ ...ctx, reason: result.reason }, 'INTEGRITY VIOLATION — document quarantined');
}

/** Members of a group, split into "currently in" and "ever in". */
export async function loadMemberSets(gid: string): Promise<{
  activeMemberIds: Set<string>;
  everMemberIds: Set<string>;
}> {
  const snap = await db.collection(`groups/${gid}/members`).get();
  const activeMemberIds = new Set<string>();
  const everMemberIds = new Set<string>();
  for (const doc of snap.docs) {
    everMemberIds.add(doc.id);
    if ((doc.data() as { leftAt?: unknown }).leftAt == null) {
      activeMemberIds.add(doc.id);
    }
  }
  return { activeMemberIds, everMemberIds };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Article I: integers in minor units only, inside the docs/04 safe bound. */
function isMinorAmount(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && Math.abs(v) <= MAX_AMOUNT_MINOR;
}
