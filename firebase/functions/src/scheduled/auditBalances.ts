import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FieldPath, db, type QueryDocumentSnapshot } from '../common/admin.js';
import {
  findBalanceDrift,
  hasFriendProjectionDrift,
  recomputeBalances,
  type BalanceDrift,
} from '../common/balances.js';
import {
  AUDIT_SCHEDULE,
  AUDIT_TIMEZONE,
  REGION,
  SCHEDULED_MAX_INSTANCES,
} from '../common/config.js';
import { logError, logInfo, logWarn, withLogging } from '../common/logging.js';

/**
 * ============================================================================
 * auditBalances — the nightly correctness backstop (docs/06 §"auditBalances")
 * ============================================================================
 * "Intended behaviour, daily at 03:00 IST. For every active group, recompute
 *  from the ledger and compare to stored member balances.
 *    - Mismatch → log at ERROR with the group ID and delta, and auto-repair.
 *    - Also asserts the zero-sum invariant independently of the write path.
 *  This is the safety net that turns 'balances are silently wrong' into 'we
 *  found out within 24 hours'."
 *
 * 🔴 IT REPAIRS. It does not only report.
 *
 *    Three documents say so and none disagrees: docs/06 §"auditBalances"
 *    ("log at ERROR … and auto-repair"), `common/logging.ts` ("Never swallow an
 *    error in the balance path. Fail loudly; auditBalances repairs"), and
 *    checklists/phase-10-hardening §6 ("corrupt a balance by hand, confirm the
 *    audit fixes it"). `findBalanceDrift`'s own comment — "reports drift instead
 *    of repairing it" — describes the HELPER, not this job: it is read-only so
 *    that its caller can log the discrepancy before overwriting the evidence,
 *    which is exactly the two-step below.
 *
 * 🔴 WHY IT EXISTS AT ALL. docs/12 Q2 permits a group above
 *    `RECOMPUTE_THRESHOLD` to switch from full recompute to incremental deltas
 *    "with the nightly `auditBalances` job as the correctness backstop". That
 *    permission is only safe while this function actually runs — an incremental
 *    delta drifts permanently the first time an event is missed, and nothing
 *    else in the system would ever notice. Deleting or disabling this therefore
 *    withdraws the decision that allows deltas; it is not a cost saving.
 *
 * 🔴 IT REUSES `common/balances.ts`. IT DOES NOT REIMPLEMENT ANYTHING.
 *    Article VI: the money math exists once, in `core/src/domain/`. A second
 *    "quick" recompute written here would be the one that decides, once a night,
 *    that everybody's balance is wrong — and then writes its own answer over the
 *    right one. The temptation is strongest in an audit; the answer is the same.
 *
 * ── Article XI ──────────────────────────────────────────────────────────────
 * `maxInstances` is `SCHEDULED_MAX_INSTANCES` (1). A daily audit has no reason
 * to fan out, and one instance also means two runs can never race each other
 * onto the same group's member documents.
 *
 * There is no trigger path to write back to — Cloud Scheduler invokes this, not
 * Firestore — so this function cannot loop. The write it does make (member
 * `balanceMinor`, through `recomputeBalances`) is diff-guarded regardless: it
 * happens only for a group `findBalanceDrift` reported drift on. A clean group
 * costs reads and no writes.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 * One run reads every live expense and settlement in every active group, so its
 * cost is the whole dataset once per night. That is the price of the guarantee
 * and it is bounded by the data rather than by traffic. The summary log at the
 * end carries the group counts so Phase 10 can set `RECOMPUTE_THRESHOLD` and the
 * shard/skip strategy from measurement rather than from a guess (Article XII).
 * ============================================================================
 */

/**
 * Groups per query page. Only the group IDs are fetched here (see the projection
 * below); the expensive reads are per-group and happen one group at a time, so
 * this bounds memory, not cost.
 */
const AUDIT_PAGE_SIZE = 200;

/**
 * 9 minutes. The default 60s would kill a real run partway through, and a
 * half-finished audit that reports nothing is indistinguishable from a clean
 * one — the worst possible failure for a canary. If a run ever approaches this,
 * the fix is sharding the group scan across several nightly windows, not a
 * bigger number: read the `groupsScanned` count in the summary log first.
 */
const AUDIT_TIMEOUT_SECONDS = 540;

interface AuditTally {
  /** Active groups that were actually audited. */
  groupsScanned: number;
  /** Soft-deleted groups skipped without reading their ledgers. */
  groupsSkipped: number;
  /** Groups where stored balances disagreed with the ledger. */
  groupsWithDrift: number;
  /** Member documents rewritten from the ledger. */
  membersRepaired: number;
  /** Groups the audit could not complete or could not repair. */
  groupsFailed: number;
}

export const auditBalances = onSchedule(
  {
    schedule: AUDIT_SCHEDULE,
    timeZone: AUDIT_TIMEZONE,
    region: REGION,
    maxInstances: SCHEDULED_MAX_INSTANCES, // Article XI
    timeoutSeconds: AUDIT_TIMEOUT_SECONDS,
    // A retry re-reads the entire dataset to redo work that is already logged,
    // and the next run is only 24 hours away. The ERROR logs are the alert
    // channel (docs/10 §"Monitoring"), not the retry count.
    retryCount: 0,
  },
  async () => {
    const ctx = { fn: 'auditBalances' };

    // `withLogging` re-throws, which is right for the scan itself: failing to
    // even list the groups is an infrastructure failure and must be visible as a
    // failed execution. Per-GROUP failures are caught inside `auditGroup` and do
    // not abort the run — one group with a broken ledger must not stop every
    // other group from being audited, which is the whole point of running this.
    await withLogging(ctx, async () => {
      const tally: AuditTally = {
        groupsScanned: 0,
        groupsSkipped: 0,
        groupsWithDrift: 0,
        membersRepaired: 0,
        groupsFailed: 0,
      };

      let cursor: QueryDocumentSnapshot | undefined;
      for (;;) {
        // 🔴 Every group is LISTED and soft-deleted ones are skipped in code,
        //    rather than filtered with `where('deletedAt', '==', null)`.
        //
        //    A Firestore equality filter on a field a document does not have
        //    excludes that document entirely — and `firestore.rules` accepts a
        //    group create where `deletedAt` is absent, because in Rules
        //    `data.deletedAt == null` is true for a missing field as well as an
        //    explicit null. A filtered scan would therefore make exactly the
        //    malformed groups invisible to the audit that most needs auditing.
        //    A projection of one field costs the same read as the filter would.
        const page = db
          .collection('groups')
          .select('deletedAt')
          .orderBy(FieldPath.documentId())
          .limit(AUDIT_PAGE_SIZE);
        const snap = await (cursor === undefined ? page : page.startAfter(cursor)).get();
        if (snap.empty) break;

        // One group at a time, not `Promise.all`: the audit is a background job
        // with all night to finish, and fanning it out would put it in
        // contention with whatever the live triggers are doing to the same
        // documents — and would multiply the read rate against `maxInstances: 1`.
        for (const doc of snap.docs) {
          // `!= null` on purpose (eqeqeq allows it for null): absent and null
          // both mean "not deleted". Any timestamp means deleted, and a deleted
          // group's balances are frozen — `deleteGroup` already proved they were
          // all zero — so auditing one would spend reads to learn nothing.
          if (doc.get('deletedAt') != null) {
            tally.groupsSkipped++;
            continue;
          }
          await auditGroup(doc.id, tally);
        }

        // Paged rather than read in one go, so a large `groups` collection never
        // has to fit in this instance's memory at once.
        cursor = snap.docs.at(-1);
        if (cursor === undefined || snap.size < AUDIT_PAGE_SIZE) break;
      }

      const summary =
        `audited ${tally.groupsScanned} active groups ` +
        `(${tally.groupsSkipped} soft-deleted skipped): ` +
        `${tally.groupsWithDrift} drifted, ${tally.membersRepaired} member balances repaired, ` +
        `${tally.groupsFailed} failed`;

      if (tally.groupsWithDrift > 0 || tally.groupsFailed > 0) {
        // ERROR so that one log filter — `fn=auditBalances severity=ERROR` —
        // catches both the per-group detail and the fact that the run as a whole
        // found something. docs/10: this is the canary for silent money bugs.
        logError({ ...ctx, ...tally }, `BALANCE AUDIT FOUND PROBLEMS — ${summary}`);
      } else {
        logInfo({ ...ctx, ...tally }, `balance audit clean — ${summary}`);
      }
    });
  },
);

/**
 * Audits one group: report, then repair.
 *
 * Never throws. A failure here is recorded in `tally` and logged at ERROR, and
 * the caller moves on to the next group.
 */
async function auditGroup(gid: string, tally: AuditTally): Promise<void> {
  const ctx = { fn: 'auditBalances', gid };
  tally.groupsScanned++;

  // ⚠️ Two passes over the ledger, at roughly double the read cost, and only for
  //    a group that actually drifted. `findBalanceDrift` is read-only so the
  //    discrepancy is in Cloud Logging BEFORE `recomputeBalances` overwrites the
  //    evidence. A silent self-heal is how a real money bug stays invisible: the
  //    numbers would be right again every morning and nobody would ever learn
  //    that a trigger is being dropped.
  //
  //    Comparison is by uid, and an ABSENT balance equals a stored 0 —
  //    `findBalanceDrift` reads `balanceMinor ?? 0` on the member document and
  //    `computed[uid] ?? 0` from the ledger, so a member document written
  //    without the field, and a member with no ledger activity, both compare
  //    equal to zero rather than registering as drift. Getting that wrong would
  //    fire this alert every night on healthy data, which is the same as having
  //    no alert at all.
  let drift: BalanceDrift[];
  try {
    drift = await findBalanceDrift(gid);
  } catch (err) {
    // `findBalanceDrift` calls `assertZeroSum` on what it COMPUTED. If that
    // throws, the ledger itself does not sum to zero (AC-E1.3) and no recompute
    // can fix it — `recomputeBalances` asserts the same thing and would refuse
    // too. Repairing is not attempted: writing a set that cannot settle up is
    // worse than leaving the last good values in place for a human to look at.
    tally.groupsFailed++;
    logError(
      ctx,
      'LEDGER AUDIT FAILED — the ledger does not sum to zero; balances NOT repaired',
      err,
    );
    return;
  }

  if (drift.length === 0) {
    // 🔴 Member balances agreeing is NOT the whole answer for a friendship.
    //
    // `users/{uid}/friends/{fid}.balanceMinor` is projected from these same numbers so the
    // Friends LIST can show them — rules deny a collection-group read on `members`, so there
    // is no other way to ask. The projection is written in the same transaction, so it cannot
    // be lost independently; what it CAN be is historical. Every friendship last computed
    // before the projection existed still holds an empty map, and its member balances are
    // perfectly correct — so without this check the audit would call the system clean while
    // the list told someone they were settled up with a person who owes them money.
    //
    // This is therefore both the ongoing check and the one-time migration: the first nightly
    // run after the deploy repairs every friendship that predates it.
    if (await hasFriendProjectionDrift(gid)) {
      tally.groupsWithDrift++;
      logWarn(
        ctx,
        'FRIEND BALANCE PROJECTION STALE — member balances are correct; refreshing the ' +
          'friends/{fid}.balanceMinor the Friends list reads',
      );
      try {
        // Idempotent (ADR-07). The member balances it rewrites are the values already
        // there; the projection is the part that actually changes.
        await recomputeBalances(gid);
      } catch (err) {
        tally.groupsFailed++;
        logError(ctx, 'friend projection refresh failed — the Friends list stays stale', err);
      }
    }
    // Otherwise deliberately silent. An INFO line per clean group would be one log
    // entry per group per night, which buries the entries that mean something.
    return;
  }

  tally.groupsWithDrift++;

  // The canary (docs/10 §"Monitoring": "Log-based alert on `auditBalances`
  // reporting drift"). docs/06 asks for the group ID and the delta; `drift`
  // carries the uid, the stored value, the computed value and the difference for
  // every member that disagreed. 🔴 Do not downgrade this to a warning to
  // quieten a dashboard (`common/logging.ts`) — drift means an event was lost or
  // double-applied somewhere upstream, and the repair below hides the symptom.
  logError(
    { ...ctx, driftCount: drift.length, drift },
    'BALANCE DRIFT — stored balances disagreed with the ledger; repairing',
  );

  try {
    // Article V: rebuilt FROM THE LEDGER, never from the cache. The stored
    // balances are an output of this call and never an input to it, so a
    // corrupt value cannot be carried forward by a "fix only what looks wrong"
    // reconciliation. Idempotent (ADR-07), so a group that was already repaired
    // by a live trigger between the two passes just gets the same answer again.
    await recomputeBalances(gid);
  } catch (err) {
    tally.groupsFailed++;
    logError(ctx, 'repair failed — stored balances left at their last good value', err);
    return;
  }

  tally.membersRepaired += drift.length;
  logWarn({ ...ctx, driftCount: drift.length }, 'balance drift repaired from the ledger');
}
