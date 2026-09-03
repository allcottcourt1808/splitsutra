import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { recomputeBalances } from '../common/balances.js';
import { MAX_INSTANCES, REGION } from '../common/config.js';
import { applyIntegrityResult, checkExpense, loadMemberSets } from '../common/integrity.js';
import { logError, logInfo, logWarn, withLogging } from '../common/logging.js';
import { activityIdFromEvent, summaries, writeActivity } from '../lib/activity.js';
import { isIntegrityEcho } from '../lib/diff.js';
import { memberName, promoteFriendshipIfNeeded, readGroup } from '../lib/groups.js';

/**
 * ============================================================================
 * onExpenseWritten — the critical path (docs/06 §"The balance pipeline")
 * ============================================================================
 *
 *     verifyExpenseIntegrity(event)   ← LAYER 2. The real check.
 *     recomputeBalances(gid)          ← Article III: the server owns balance truth
 *     writeActivity(gid, event)       ← T8: append-only, Function-written
 *
 * 🔴 THE ORDER IS LOAD-BEARING. The integrity check runs FIRST so that a document
 *    which fails it is already flagged `integrityStatus: 'quarantined'` by the time
 *    `recomputeBalances` reads the ledger — `common/balances.ts` filters quarantined
 *    documents out of the money. Recomputing first would briefly persist balances
 *    that include a forged expense.
 *
 * 🔴 THIS FUNCTION IS THE AUTHORITATIVE HALF OF TWO CHECKS RULES CANNOT MAKE
 *    (docs/12 Q1, docs/05 §"TWO-LAYER CHECKS"):
 *
 *      - the ACTUAL sum of `splits[]` and `paidBy[]` (T3). Rules have no `reduce()`,
 *        so they can only assert the client's own `splitsTotalMinor` /
 *        `paidTotalMinor` checksums equal `amountMinor`. An attacker who writes a
 *        correct checksum next to a wrong array sails through layer 1 and is caught
 *        here, by `checkExpense` recomputing both sums in real code.
 *      - every `paidBy[].uid` being a member (T6). Those uids live inside maps in an
 *        array; rules cannot project a field out of an array of maps at all.
 *      - the currency being a REAL ISO 4217 code (Q4). Rules match `^[A-Z]{3}$`;
 *        `ZZZ` passes that and is not a currency.
 *
 *    Without this function, Option A is theatre. Do not weaken it, and do not
 *    "optimise" it into a shape check.
 *
 * Quarantine, not deletion (Article V): a failing document stays in the ledger with
 * a flag and stops moving anyone's balance. The evidence survives.
 * ============================================================================
 */
export const onExpenseWritten = onDocumentWritten(
  {
    document: 'groups/{gid}/expenses/{eid}',
    region: REGION,
    // Article XI. Also in setGlobalOptions; repeated here so it survives someone
    // deleting the global call and so a reviewer can grep for it (docs/18 §7).
    maxInstances: MAX_INSTANCES,
  },
  async (event) => {
    const gid = event.params.gid;
    const eid = event.params.eid;
    const ctx = { fn: 'onExpenseWritten', gid, eid };

    await withLogging(ctx, async () => {
      const beforeData = event.data?.before.exists === true ? event.data.before.data() : undefined;
      const afterData = event.data?.after.exists === true ? event.data.after.data() : undefined;

      if (afterData === undefined) {
        // `firestore.rules` denies `delete` outright (Article V — soft delete only),
        // so reaching here means a console or Admin SDK deletion. The ledger changed
        // regardless, so the cache must be rebuilt from what remains.
        logWarn(ctx, 'expense hard-deleted outside the client path — rebuilding balances');
        await recomputeBalances(gid);
        return;
      }

      const group = await readGroup(gid);
      if (group === null) {
        // An expense whose group is gone cannot be validated against a group
        // currency or a member list. Loud, and no write.
        logError(ctx, 'expense written into a group that does not exist');
        return;
      }

      // ---- LAYER 2 -------------------------------------------------------------
      const { activeMemberIds, everMemberIds } = await loadMemberSets(gid);
      const result = checkExpense(afterData, {
        groupCurrency: group.currency,
        activeMemberIds,
        everMemberIds,
        // A NEW expense may only reference current members; an EDIT to a historical
        // one may still reference someone who has since left (docs/06 §"leaveGroup").
        isCreate: beforeData === undefined,
      });
      await applyIntegrityResult(`groups/${gid}/expenses/${eid}`, afterData, result, {
        ...ctx,
        docId: eid,
      });

      // ---- PROMOTION (ADR-13) --------------------------------------------------
      // A friendship with money in it becomes an ordinary group, so it inherits every group
      // feature instead of needing a friend-shaped copy of each one. Diff-guarded inside:
      // it writes only when the group is still implicit, so this is a single read on every
      // subsequent expense and no write at all.
      //
      // Before the balances on purpose. Both are idempotent, but a reader who sees the new
      // expense should not find a group that is still hidden.
      if (await promoteFriendshipIfNeeded(gid)) {
        logInfo(ctx, 'friendship promoted to a group by its first expense (ADR-13)');
      }

      // ---- BALANCES ------------------------------------------------------------
      // Runs even on an integrity echo: flipping the quarantine flag changes which
      // documents count, so the cache has to follow. `recomputeBalances` is a full
      // idempotent rebuild, so running it more often than strictly necessary is
      // wasteful, never wrong (ADR-07).
      await recomputeBalances(gid);

      // ---- ACTIVITY ------------------------------------------------------------
      // `applyIntegrityResult` writes to this very document, which re-fires this
      // trigger. The diff guard in `common/integrity.ts` stops that after one round
      // (it only writes when the quarantine state actually changes); this guard
      // stops the echo from also producing a phantom "X updated ..." feed entry.
      if (isIntegrityEcho(beforeData, afterData)) return;

      const description = asDisplayString(afterData['description'], 'an expense');
      const amountMinor =
        typeof afterData['amountMinor'] === 'number' ? afterData['amountMinor'] : null;
      const createdBy = asDisplayString(afterData['createdBy'], '');
      const updatedBy = asDisplayString(afterData['updatedBy'], '');

      const isCreate = beforeData === undefined;
      const becameDeleted = beforeData?.['deletedAt'] == null && afterData['deletedAt'] != null;
      const actorUid = isCreate ? createdBy : updatedBy.length > 0 ? updatedBy : createdBy;
      if (actorUid.length === 0) {
        logError(ctx, 'expense has no createdBy/updatedBy — cannot attribute activity');
        return;
      }
      const actorName = await memberName(gid, actorUid);

      await writeActivity(gid, activityIdFromEvent(event.id), {
        type: isCreate ? 'expense.created' : becameDeleted ? 'expense.deleted' : 'expense.updated',
        actorUid,
        actorName,
        targetId: eid,
        summary: isCreate
          ? summaries.expenseCreated(actorName, description)
          : becameDeleted
            ? summaries.expenseDeleted(actorName, description)
            : summaries.expenseUpdated(actorName, description),
        amountMinor,
        currency: group.currency,
      });
    });
  },
);

/** Hostile data reaches the feed too — never interpolate an unchecked value. */
function asDisplayString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 100) : fallback;
}
