import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { recomputeBalances } from '../common/balances.js';
import { MAX_INSTANCES, REGION } from '../common/config.js';
import { applyIntegrityResult, checkSettlement, loadMemberSets } from '../common/integrity.js';
import { logError, logWarn, withLogging } from '../common/logging.js';
import { activityIdFromEvent, summaries, writeActivity } from '../lib/activity.js';
import { isIntegrityEcho } from '../lib/diff.js';
import { memberName, readGroup } from '../lib/groups.js';

/**
 * ============================================================================
 * onSettlementWritten — the other half of the ledger
 * ============================================================================
 * Same three steps as `onExpenseWritten`, same order, same reasons. A settlement
 * moves balances exactly as an expense does (docs/03: `from.balanceMinor +=
 * amount`, `to.balanceMinor -= amount`), so it gets the same treatment — treating
 * settlements as "just a note" is how the other half of the ledger ends up
 * unvalidated.
 *
 * 🔴 LAYER 2 of the currency check (Q4). `firestore.rules` can only assert
 *    `^[A-Z]{3}$` and equality with the group currency; it cannot hold the ~180-
 *    entry ISO 4217 table. `checkSettlement` tests membership of the real table
 *    from `@splitsutra/core`, and also re-checks `fromUid !== toUid` and that both are
 *    known members against data rules can only see one document at a time.
 * ============================================================================
 */
export const onSettlementWritten = onDocumentWritten(
  {
    document: 'groups/{gid}/settlements/{sid}',
    region: REGION,
    maxInstances: MAX_INSTANCES, // Article XI
  },
  async (event) => {
    const gid = event.params.gid;
    const sid = event.params.sid;
    const ctx = { fn: 'onSettlementWritten', gid, sid };

    await withLogging(ctx, async () => {
      const beforeData = event.data?.before.exists === true ? event.data.before.data() : undefined;
      const afterData = event.data?.after.exists === true ? event.data.after.data() : undefined;

      if (afterData === undefined) {
        logWarn(ctx, 'settlement hard-deleted outside the client path — rebuilding balances');
        await recomputeBalances(gid);
        return;
      }

      const group = await readGroup(gid);
      if (group === null) {
        logError(ctx, 'settlement written into a group that does not exist');
        return;
      }

      // ---- LAYER 2 -------------------------------------------------------------
      const { everMemberIds } = await loadMemberSets(gid);
      const result = checkSettlement(afterData, {
        groupCurrency: group.currency,
        everMemberIds,
      });
      await applyIntegrityResult(`groups/${gid}/settlements/${sid}`, afterData, result, {
        ...ctx,
        docId: sid,
      });

      // ---- BALANCES ------------------------------------------------------------
      await recomputeBalances(gid);

      // ---- ACTIVITY ------------------------------------------------------------
      if (isIntegrityEcho(beforeData, afterData)) return;

      const fromUid = typeof afterData['fromUid'] === 'string' ? afterData['fromUid'] : '';
      const toUid = typeof afterData['toUid'] === 'string' ? afterData['toUid'] : '';
      const amountMinor =
        typeof afterData['amountMinor'] === 'number' ? afterData['amountMinor'] : null;
      const createdBy = typeof afterData['createdBy'] === 'string' ? afterData['createdBy'] : '';

      const isCreate = beforeData === undefined;
      const becameDeleted = beforeData?.['deletedAt'] == null && afterData['deletedAt'] != null;

      // core's ACTIVITY_TYPES has `settlement.created` and `settlement.deleted` and
      // deliberately no `settlement.updated` (docs/03). An edit that is not a soft
      // delete therefore has no representable feed entry — balances are still
      // recomputed above, and the amount/parties are immutable in rules, so the
      // only editable fields are `date` and `note`. Recorded rather than invented:
      // adding `settlement.updated` is a docs/03 change, not a Function change.
      if (!isCreate && !becameDeleted) return;

      // Settlements carry no `updatedBy` (docs/03), so a soft delete is attributed
      // to `createdBy`. Rules permit the creator OR a group admin to soft-delete
      // one, so this attribution can be wrong for the admin case. Fixing it means
      // adding `updatedBy` to the settlement schema and to the rules' immutable
      // list — a docs/03 change, flagged rather than guessed at here.
      const actorUid = createdBy;
      if (actorUid.length === 0 || fromUid.length === 0 || toUid.length === 0) {
        logError(ctx, 'settlement is missing fromUid/toUid/createdBy — cannot attribute activity');
        return;
      }

      const [actorName, fromName, toName] = await Promise.all([
        memberName(gid, actorUid),
        memberName(gid, fromUid),
        memberName(gid, toUid),
      ]);

      await writeActivity(gid, activityIdFromEvent(event.id), {
        type: becameDeleted ? 'settlement.deleted' : 'settlement.created',
        actorUid,
        actorName,
        targetId: sid,
        summary: becameDeleted
          ? summaries.settlementDeleted(actorName)
          : summaries.settlementCreated(fromName, toName),
        amountMinor,
        currency: group.currency,
      });
    });
  },
);
