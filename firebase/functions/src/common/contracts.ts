/**
 * ============================================================================
 * THE @splitsutra/core SEAM — the one file that knows what core exports
 * ============================================================================
 *
 * CONSTITUTION Article VI: "The split engine and balance computation exist once,
 * in core/src/domain/, imported by both the client and Cloud Functions. A second
 * implementation — even a 'quick' one for validation, previews, or a rule — is
 * forbidden."
 *
 * So this package never reimplements money math. It imports it. Every symbol this
 * codebase borrows from @splitsutra/core is re-exported from here and nowhere else, so
 * if core's naming turns out to differ, exactly one file needs fixing rather than
 * a dozen.
 *
 * ⚠️ @splitsutra/core is authored by a different workstream (Phase 01 / Phase 06). Until
 *    it lands, this package will not typecheck — that is expected and correct: the
 *    alternative is a second copy of the balance engine, which Article VI forbids.
 *
 * ---------------------------------------------------------------------------
 * CONTRACT — what @splitsutra/core must export for this package to build
 * ---------------------------------------------------------------------------
 * Domain (docs/04-split-engine.md):
 *   computeBalances({ expenses, settlements, memberIds }) => Record<uid, number>
 *   assertZeroSum(balances)                                => throws on violation
 *   CURRENCIES                                             => full ISO 4217 table,
 *                                                             keyed by code, each
 *                                                             entry { code, exponent, name }
 *
 * Types (docs/03-data-model.md):
 *   CurrencyCode, Expense, Settlement, GroupMember, Group, ActivityType
 *
 * Callable input schemas (docs/02: one Zod definition shared client/server;
 * docs/06 names RedeemInviteSchema explicitly, the rest follow the same shape):
 *   RedeemInviteSchema            { token: string }
 *   CreateInviteSchema            { groupId: string }
 *   SendFriendRequestSchema       { email?: string; phoneNumber?: string }
 *   RespondToFriendRequestSchema  { requestId: string; accept: boolean }
 *   CancelFriendRequestSchema     { requestId: string }
 *   RemoveMemberSchema            { groupId: string; uid: string }
 *   LeaveGroupSchema              { groupId: string }
 *   DeleteGroupSchema             { groupId: string }
 *   RecomputeGroupBalancesSchema  { groupId: string }
 *   RepairGroupMembershipSchema   { groupId: string }
 *   DeleteAccountSchema           { confirm: true }
 * ============================================================================
 */

export { CURRENCIES, assertZeroSum, computeBalances } from '@splitsutra/core';

export type {
  ActivityType,
  CurrencyCode,
  Expense,
  Group,
  GroupMember,
  Settlement,
} from '@splitsutra/core';

/*
 * Core names its schemas camelCase, like every other schema in types/. This package was
 * written expecting PascalCase. Rather than churn eleven files in core or a dozen here,
 * the mismatch is absorbed by aliasing — which is precisely the job this seam file was
 * created to do (see the header).
 */
export {
  cancelFriendRequestSchema as CancelFriendRequestSchema,
  createInviteSchema as CreateInviteSchema,
  deleteAccountSchema as DeleteAccountSchema,
  deleteGroupSchema as DeleteGroupSchema,
  leaveGroupSchema as LeaveGroupSchema,
  recomputeGroupBalancesSchema as RecomputeGroupBalancesSchema,
  redeemInviteSchema as RedeemInviteSchema,
  removeMemberSchema as RemoveMemberSchema,
  repairGroupMembershipSchema as RepairGroupMembershipSchema,
  respondToFriendRequestSchema as RespondToFriendRequestSchema,
  sendFriendRequestSchema as SendFriendRequestSchema,
} from '@splitsutra/core';
