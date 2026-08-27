import { FieldValue, db, type Transaction } from '../common/admin.js';
import type { ActivityType } from '../common/contracts.js';

/**
 * ============================================================================
 * THE ACTIVITY FEED WRITER — docs/03 §"groups/{gid}/activity", docs/06 §T8
 * ============================================================================
 *
 * Why this lives in `lib/` and not `common/`: `common/` is the shared
 * infrastructure layer (admin handle, callable preamble, balance pipeline,
 * integrity checks) and is owned by a different workstream. `lib/` is helper code
 * that only the function implementations in this package use. If the seam between
 * them ever stops being useful, fold this into `common/` — but do not scatter a
 * second copy of the summary rendering anywhere else.
 *
 * 🔴 T8 — the feed is append-only and Function-written. `firestore.rules` denies
 *    every client write to `groups/{gid}/activity/{id}`, so this file is the ONLY
 *    thing that can produce an activity entry. That is the whole point: a member
 *    who could edit the feed could hide what they did.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCE — read this before changing how the document id is chosen
 * ---------------------------------------------------------------------------
 * Firestore triggers deliver AT LEAST ONCE (docs/06 §"Design constraints"). A
 * feed writer that calls `.add()` produces a duplicate entry every time an event
 * is redelivered, and the duplicate is indistinguishable from a real second edit.
 *
 * So every entry gets a DETERMINISTIC document id:
 *   - trigger-sourced entries key off the CloudEvent id, which is stable across
 *     redeliveries of the same event (`activityIdFromEvent`);
 *   - callable-sourced entries key off the mutation they describe, e.g.
 *     `member.joined__<uid>__<inviteId>`.
 * `set()` on the same id twice is a no-op rewrite rather than a second row.
 */

/** `summary` is pre-rendered server-side so the feed needs no joins (docs/03). */
export interface ActivityInput {
  type: ActivityType;
  actorUid: string;
  actorName: string;
  /** The expense, settlement, member, or group the event is about. */
  targetId: string | null;
  summary: string;
  /**
   * An amount without its currency cannot be rendered — core's `activitySchema`
   * refuses that combination, so the two always travel together (D6).
   */
  amountMinor?: number | null;
  currency?: string | null;
}

/**
 * Firestore document ids may not contain `/`, may not be `.` or `..`, and may not
 * match `__.*__`. CloudEvent ids are opaque strings and are not guaranteed to
 * respect any of that, so they are sanitised rather than trusted.
 *
 * The mapping is deliberately many-to-one-safe: two DIFFERENT event ids must not
 * collapse onto the same key, so only characters outside the safe set are
 * replaced, and the (already short) id is not truncated below its entropy.
 */
export function activityIdFromEvent(eventId: string): string {
  const safe = eventId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 400);
  return safe.length > 0 ? `evt_${safe}` : `evt_unknown_${Date.now()}`;
}

function buildPayload(id: string, input: ActivityInput): Record<string, unknown> {
  const amountMinor = input.amountMinor ?? null;
  const currency = input.currency ?? null;
  return {
    id,
    type: input.type,
    actorUid: input.actorUid,
    actorName: input.actorName,
    targetId: input.targetId,
    summary: input.summary,
    // Never write an amount without its currency; core's schema rejects it and a
    // feed row that cannot be rendered is worse than one that is missing.
    amountMinor: currency === null ? null : amountMinor,
    currency,
    createdAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Writes one feed entry and bumps the group's `lastActivityAt` / `updatedAt`, which
 * drive the group-list sort order (docs/03 §"groups").
 *
 * ⚠️ This touches `groups/{gid}` from triggers on `groups/{gid}/expenses/**` and
 *    `groups/{gid}/settlements/**` — different paths, so no trigger loop. It is
 *    also called from `onGroupCreated`, which is an `onDocumentCreated` trigger:
 *    an update does not re-fire a create trigger. If anyone ever adds an
 *    `onGroupWritten`, this write becomes a loop source and needs a diff guard
 *    (Article XI / docs/18 §7).
 */
export async function writeActivity(
  gid: string,
  activityId: string,
  input: ActivityInput,
): Promise<void> {
  const batch = db.batch();
  batch.set(db.doc(`groups/${gid}/activity/${activityId}`), buildPayload(activityId, input));
  batch.update(db.doc(`groups/${gid}`), {
    lastActivityAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}

/**
 * Transaction-scoped variant, for callables that must write the feed entry in the
 * SAME transaction as the mutation it describes (`redeemInvite`, `leaveGroup`,
 * `removeMember`). A separate write could commit while the mutation rolled back,
 * leaving the feed asserting something that never happened.
 *
 * Firestore requires all reads before any write inside a transaction, so call this
 * only after the caller has finished reading.
 */
export function writeActivityInTransaction(
  tx: Transaction,
  gid: string,
  activityId: string,
  input: ActivityInput,
): void {
  tx.set(db.doc(`groups/${gid}/activity/${activityId}`), buildPayload(activityId, input));
  tx.update(db.doc(`groups/${gid}`), {
    lastActivityAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/** `Neethu added "Dinner"` — the pre-rendered forms the feed displays verbatim. */
export const summaries = {
  expenseCreated: (actor: string, description: string): string => `${actor} added "${description}"`,
  expenseUpdated: (actor: string, description: string): string =>
    `${actor} updated "${description}"`,
  expenseDeleted: (actor: string, description: string): string =>
    `${actor} deleted "${description}"`,
  settlementCreated: (from: string, to: string): string => `${from} paid ${to}`,
  settlementDeleted: (actor: string): string => `${actor} deleted a payment record`,
  memberJoined: (actor: string): string => `${actor} joined the group`,
  memberLeft: (actor: string): string => `${actor} left the group`,
  memberRemoved: (actor: string, target: string): string => `${actor} removed ${target}`,
  groupCreated: (actor: string, name: string): string => `${actor} created "${name}"`,
  groupDeleted: (actor: string, name: string): string => `${actor} deleted "${name}"`,
} as const;
