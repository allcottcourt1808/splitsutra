/**
 * `groups/{groupId}` and `groups/{groupId}/members/{uid}` — checklists/phase-05 §1.
 *
 * ## Reads are subscriptions, membership writes are callables
 *
 * `createGroup` and `updateGroup` are direct client writes because Security Rules can validate
 * them from the request alone. Everything that touches **membership or a balance** — joining,
 * leaving, removing, deleting, repairing — is a callable: those preconditions require reading
 * other members' documents, which Rules cannot do within their access budget, and a client that
 * could write a member document could write its own `balanceMinor` (Article III, threat T2).
 *
 * ## `watchMyGroups` filters in memory, on purpose
 *
 * The only composite index declared for this collection is `memberIds` ARRAY + `lastActivityAt`
 * DESC (docs/03 §Required composite indexes). Adding `where('isImplicit','==',false)` or
 * `where('deletedAt','==',null)` to the query would need two more indexes to serve one screen,
 * so both are applied to the result instead. The page is capped at {@link MY_GROUPS_PAGE_SIZE},
 * which bounds what that costs.
 *
 * ## This file owns the "my groups" query, and there is only one of it
 *
 * Article VI. {@link watchGroupsForUser} is the single `memberIds array-contains` subscription in
 * the product; the Groups tab, the activity feed and the Add Expense picker are three option sets
 * over it, not three queries. `activityRepo.watchActivityGroups` and
 * `expenseRepo.watchExpenseGroups` are thin calls into it and hold no query of their own.
 * The same holds for membership: {@link watchMembers} is the only `members` subscription, and
 * {@link watchActiveMembers} is a filter over it.
 */

import {
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
  DEFAULT_CURRENCY,
  createInviteSchema,
  deleteGroupSchema,
  groupBaseSchema,
  groupTypeSchema,
  leaveGroupSchema,
  recomputeGroupBalancesSchema,
  repairGroupMembershipSchema,
  redeemInviteSchema,
  removeMemberSchema,
  // Type-only: referenced solely as `typeof SELECTABLE_GROUP_TYPES` to derive CreatableGroupType.
  type SELECTABLE_GROUP_TYPES,
  type CreateInviteInput,
  type CurrencyCode,
  type DeleteGroupInput,
  type Group,
  type GroupMember,
  type LeaveGroupInput,
  type RecomputeGroupBalancesInput,
  type RepairGroupMembershipInput,
  type RedeemInviteInput,
  type RemoveMemberInput,
} from '../types/index.js';
import { CALLABLE, callFunction } from './callables.js';
import { groupDoc, groupsCollection, memberDoc, membersCollection } from './refs.js';
import { watchDoc, watchQuery, type OnError, type OnNext, type Unsubscribe } from './subscribe.js';

/** docs/03 §Query patterns: `… orderBy lastActivityAt desc limit 50`. */
export const MY_GROUPS_PAGE_SIZE = 50;

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Reads
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * `true` for a group that belongs on the Groups tab.
 *
 * ADR-06 / D2: an implicit group is the hidden two-person container behind a 1:1 friend
 * expense. It is a real group with real expenses, but showing it here would present every
 * friendship as a group the user never created.
 */
function isVisibleGroup(group: Group): boolean {
  return !group.isImplicit && group.deletedAt === null;
}

/** The two axes on which the callers of {@link watchGroupsForUser} legitimately differ. */
export interface WatchGroupsOptions {
  /**
   * Include the hidden 1:1 friend groups (ADR-06 / D2). Default `false` — D2's "remembering to
   * filter `isImplicit` out of the group list".
   *
   * The activity feed and the Add Expense picker pass `true`: AC-F1.1 lists "group **and friend**
   * events", and a friend group is a group you may add an expense to. It is only the Groups tab
   * that must not present every friendship as a group the user never created.
   */
  readonly includeImplicit?: boolean | undefined;
  /**
   * Order by `lastActivityAt` desc and stop at this many groups (docs/03 §Query patterns), or
   * `null` for every group the user is in, unordered.
   *
   * `null` is not a shortcut: the activity feed must cover **every** group the user is currently
   * in (AC-F1.4), which a 50-group page cannot promise, and it needs no ordering because its rows
   * are re-sorted after the per-group merge. Unordered, the query is served by the automatic
   * single-field index; ordered, by the declared `memberIds` CONTAINS + `lastActivityAt` DESC
   * composite index. There is no third shape, and adding one means adding an index.
   */
  readonly pageSize?: number | null | undefined;
}

/**
 * 🔴 The one "groups I am in" subscription. Everything that lists a user's groups comes here.
 *
 * `deletedAt` is always dropped client-side — a soft-deleted group belongs on no screen, and
 * `where('deletedAt','==',null)` beside the `array-contains` would cost a composite index per
 * caller for a handful of documents.
 */
export function watchGroupsForUser(
  uid: string,
  onNext: OnNext<readonly Group[]>,
  onError: OnError,
  options: WatchGroupsOptions = {},
): Unsubscribe {
  const { includeImplicit = false, pageSize = MY_GROUPS_PAGE_SIZE } = options;

  const membership = query(groupsCollection(), where('memberIds', 'array-contains', uid));
  const scoped =
    pageSize === null
      ? membership
      : query(membership, orderBy('lastActivityAt', 'desc'), limit(pageSize));

  return watchQuery(
    scoped,
    (groups) => {
      onNext(
        groups.filter((group) =>
          includeImplicit ? group.deletedAt === null : isVisibleGroup(group),
        ),
      );
    },
    onError,
  );
}

/** The signed-in user's groups, most recently active first. Implicit and deleted ones removed. */
export function watchMyGroups(
  uid: string,
  onNext: OnNext<readonly Group[]>,
  onError: OnError,
): Unsubscribe {
  return watchGroupsForUser(uid, onNext, onError);
}

/** Subscribe to one group. Emits `null` when it does not exist or the caller cannot read it. */
export function watchGroup(
  groupId: string,
  onNext: OnNext<Group | null>,
  onError: OnError,
): Unsubscribe {
  return watchDoc(groupDoc(groupId), onNext, onError);
}

/**
 * Current members first, then departed ones, each block ordered by display name.
 *
 * Sorted client-side because `displayName` is a denormalized snapshot the profile fan-out
 * rewrites, so ordering by it server-side would need an index Firestore keeps re-writing.
 *
 * 🔴 This used to say "a group is capped at 50 members (Q2), so this is not where the cost is".
 *    That is false, and it is the reason `watchMembers` below has no `limit()`. `MAX_GROUP_MEMBERS`
 *    is enforced against `group.memberIds.length` — CURRENT members — in `createInvite` and
 *    `redeemInvite`. `leaveGroup` sets `leftAt` and deliberately keeps the member document, so
 *    this subcollection grows with every departure and is bounded by nothing.
 *    See checklists/phase-10-hardening.md §5b.
 */
function byMembership(a: GroupMember, b: GroupMember): number {
  const left = a.leftAt === null ? 0 : 1;
  const right = b.leftAt === null ? 0 : 1;
  if (left !== right) return left - right;
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
}

/** Every member document in the group, including people who have left. */
export function watchMembers(
  groupId: string,
  onNext: OnNext<readonly GroupMember[]>,
  onError: OnError,
): Unsubscribe {
  return watchQuery(
    membersCollection(groupId),
    (members) => {
      onNext([...members].sort(byMembership));
    },
    onError,
  );
}

/**
 * Only the people still in the group, ordered by display name — who an expense or a settlement
 * may name.
 *
 * A filter over {@link watchMembers} rather than a second query: it is the same subscription
 * either way, and `allow write: if false` makes `members` read-only in every direction, so the
 * only difference is which rows the caller wants.
 *
 * 🔴 This too used to justify itself with "capped at 50 documents (Q2)". It is not — departed
 *    members are tombstoned, not deleted. See {@link watchMembers}.
 * `byMembership` already places current members before departed ones, so the filtered list is
 * exactly name order.
 */
export function watchActiveMembers(
  groupId: string,
  onNext: OnNext<readonly GroupMember[]>,
  onError: OnError,
): Unsubscribe {
  return watchMembers(
    groupId,
    (members) => {
      onNext(members.filter((member) => member.leftAt === null));
    },
    onError,
  );
}

/**
 * One member document — the caller's own, on the group list.
 *
 * `balanceMinor` lives here and nowhere else that a client can read, so the per-group balance on
 * the Groups tab is one listener per group rather than a field on the group document.
 */
export function watchMember(
  groupId: string,
  uid: string,
  onNext: OnNext<GroupMember | null>,
  onError: OnError,
): Unsubscribe {
  return watchDoc(memberDoc(groupId, uid), onNext, onError);
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Writes — direct
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * What a user may choose when creating or editing a group.
 *
 * Derived from `SELECTABLE_GROUP_TYPES` rather than by excluding `friend` from `GroupType`:
 * `GroupType` also carries the retired `couple`, which only exists so old documents still decode,
 * and subtracting one system value from it would quietly let new code write `couple` again.
 */
export type CreatableGroupType = (typeof SELECTABLE_GROUP_TYPES)[number];

export interface CreateGroupInput {
  /** 1–60 characters after trimming. */
  readonly name: string;
  readonly type: CreatableGroupType;
  /** 🔴 Immutable once written (AC-C1.1, threat T10). */
  readonly currency?: CurrencyCode | undefined;
  /**
   * Default **`true`**; the settle-up view is a display choice, not a ledger change (AC-E3.3).
   *
   * On by default because the thing it optimises — how many separate payments a group has to
   * make — is what people actually want help with, and a setting that has to be found before it
   * helps is a setting most groups never turn on. Nothing about the ledger changes either way:
   * simplification is a pure function over balances that writes nothing (Article VII), so this
   * only decides which tab opens first and can be reversed per group at any time.
   */
  readonly simplifyDebts?: boolean | undefined;
  readonly photoURL?: string | null | undefined;
}

/**
 * Create a group. Returns the new group id.
 *
 * Every field Rules pin is set here and none of them is a caller's choice: `createdBy` is the
 * signed-in uid, `memberIds` is exactly `[uid]` and `memberCount` is 1 (threat T4 — a client
 * that could seed a wider member list could add itself to a stranger's group). The creator's
 * `members/{uid}` document is written by `onGroupCreated`, not from here.
 *
 * `createdAt`, `updatedAt` and `lastActivityAt` are all `serverTimestamp()`: Rules require
 * `createdAt == request.time`, and a client-chosen `lastActivityAt` would let a group pin itself
 * to the top of everyone's list for ever.
 */
export async function createGroup(uid: string, input: CreateGroupInput): Promise<string> {
  const name = groupBaseSchema.shape.name.parse(input.name);
  const type = groupTypeSchema.parse(input.type);
  const currency = groupBaseSchema.shape.currency.parse(input.currency ?? DEFAULT_CURRENCY);
  const photoURL = groupBaseSchema.shape.photoURL.parse(input.photoURL ?? null);

  const reference = doc(groupsCollection());

  await setDoc(reference, {
    id: reference.id,
    name,
    type,
    isImplicit: false,
    photoURL,
    currency,
    memberIds: [uid],
    memberCount: 1,
    simplifyDebts: input.simplifyDebts ?? true,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastActivityAt: serverTimestamp(),
    deletedAt: null,
    // v2 forward design (docs/03). Written explicitly so a v1 document is complete rather
    // than relying on a schema default to fill a missing key on every read.
    baseCurrency: null,
    allowMixedCurrency: null,
  });

  return reference.id;
}

/** The fields a member may edit. Everything absent from this type is immutable to a client. */
export interface GroupPatch {
  readonly name?: string | undefined;
  readonly type?: CreatableGroupType | undefined;
  readonly simplifyDebts?: boolean | undefined;
  readonly photoURL?: string | null | undefined;
}

/**
 * Update a group's editable fields.
 *
 * 🔴 `currency` is not here and must never be added. Changing it after an expense exists would
 * reinterpret every stored `amountMinor` in the group (AC-C1.1, T10); Rules reject it, and a
 * caller reaching for it wants a new group.
 */
export async function updateGroup(groupId: string, patch: GroupPatch): Promise<void> {
  const update: Record<string, unknown> = {};

  if (patch.name !== undefined) update['name'] = groupBaseSchema.shape.name.parse(patch.name);
  if (patch.type !== undefined) update['type'] = groupTypeSchema.parse(patch.type);
  if (patch.simplifyDebts !== undefined) update['simplifyDebts'] = patch.simplifyDebts;
  if (patch.photoURL !== undefined) {
    update['photoURL'] = groupBaseSchema.shape.photoURL.parse(patch.photoURL);
  }

  if (Object.keys(update).length === 0) return;

  await updateDoc(groupDoc(groupId), { ...update, updatedAt: serverTimestamp() });
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Writes — callables
 * ────────────────────────────────────────────────────────────────────────────────────────── *
 * Each one enforces a precondition that reads other members' documents, which Rules cannot do.
 * The `HttpsError` messages these throw are written to be shown to a user — `leaveGroup` names
 * the outstanding amount — so callers should surface `error.message` rather than replace it.
 */

export interface LeaveGroupResult {
  readonly groupId: string;
  readonly left: true;
}

/** Leave a group. Refused while the caller's balance is not zero (AC-C1.6). */
export async function leaveGroup(input: LeaveGroupInput): Promise<LeaveGroupResult> {
  const payload = leaveGroupSchema.parse(input);
  return callFunction<LeaveGroupInput, LeaveGroupResult>(CALLABLE.leaveGroup, payload);
}

export interface RemoveMemberResult {
  readonly groupId: string;
  readonly uid: string;
  readonly removed: true;
}

/** Remove someone else. Admin only, and only at a zero balance (AC-C1.7). */
export async function removeMember(input: RemoveMemberInput): Promise<RemoveMemberResult> {
  const payload = removeMemberSchema.parse(input);
  return callFunction<RemoveMemberInput, RemoveMemberResult>(CALLABLE.removeMember, payload);
}

export interface DeleteGroupResult {
  readonly groupId: string;
  readonly deleted: true;
  /** `true` when the group was already soft-deleted — the call is idempotent. */
  readonly alreadyDeleted: boolean;
}

/** Soft-delete a group. Admin only, and only when every balance is zero (AC-C1.5, Article V). */
export async function deleteGroup(input: DeleteGroupInput): Promise<DeleteGroupResult> {
  const payload = deleteGroupSchema.parse(input);
  return callFunction<DeleteGroupInput, DeleteGroupResult>(CALLABLE.deleteGroup, payload);
}

export interface RecomputeGroupBalancesResult {
  readonly groupId: string;
  readonly currency: CurrencyCode;
  /** `true` when the stored balances disagreed with the ledger and were corrected. */
  readonly repaired: boolean;
  readonly driftCount: number;
}

/**
 * Rebuild every balance in the group from the ledger — the "Balances look wrong?" repair valve.
 *
 * Article V: the ledger is the truth and a balance is a cache, so this is always safe to run and
 * is idempotent. It deliberately returns counts rather than amounts; the caller already has a
 * live listener on the member documents, and a second copy of a balance in a response payload is
 * exactly the drift Article III exists to prevent.
 */
export async function recomputeGroupBalances(
  input: RecomputeGroupBalancesInput,
): Promise<RecomputeGroupBalancesResult> {
  const payload = recomputeGroupBalancesSchema.parse(input);
  return callFunction<RecomputeGroupBalancesInput, RecomputeGroupBalancesResult>(
    CALLABLE.recomputeGroupBalances,
    payload,
  );
}

export interface RepairGroupMembershipResult {
  readonly groupId: string;
  /** `false` when the member document was already there — the call is idempotent. */
  readonly repaired: boolean;
  readonly role: 'admin' | 'member';
  /** `false` when the membership was fixed but the follow-up balance rebuild failed. */
  readonly balancesRebuilt: boolean;
}

/**
 * Write the caller's own `members/{uid}` document when it is missing.
 *
 * The membership counterpart to {@link recomputeGroupBalances}. `onGroupCreated` is the only
 * writer of a creator's member document, and Rules gate every read inside a group on that
 * document existing — so a group whose trigger never fired is one its own creator cannot open,
 * with no way back. This is the way back.
 *
 * It grants nothing: the Function refuses unless `group.memberIds` already names the caller,
 * which is the same field `allow list` on `/groups/{gid}` already trusts on its own. Idempotent.
 */
export async function repairGroupMembership(
  input: RepairGroupMembershipInput,
): Promise<RepairGroupMembershipResult> {
  const payload = repairGroupMembershipSchema.parse(input);
  return callFunction<RepairGroupMembershipInput, RepairGroupMembershipResult>(
    CALLABLE.repairGroupMembership,
    payload,
  );
}

export interface CreateInviteResult {
  readonly inviteId: string;
  /** 128 bits of lowercase hex. Never readable from Firestore — this response is the only copy. */
  readonly token: string;
  readonly groupName: string;
  /** When the link stops working. */
  readonly expiresAtMillis: number;
  /** How many people have already joined through this link. */
  readonly redeemedCount: number;
  /** `false` when an existing active link was returned rather than a new one minted. */
  readonly created: boolean;
}

/**
 * The group's current invite link, minting one only if there is none (AC-B3.1).
 *
 * Not "mint a new token" despite the name — see {@link createInviteSchema}. Pass
 * `reset: true` to revoke the current link and issue a fresh one.
 */
export async function createInvite(input: CreateInviteInput): Promise<CreateInviteResult> {
  const payload = createInviteSchema.parse(input);
  return callFunction<CreateInviteInput, CreateInviteResult>(CALLABLE.createInvite, payload);
}

/**
 * What `redeemInvite` answers with.
 *
 * `groupName` comes back from the Function because the client has no other way to learn it:
 * `invites/{id}` denies every client read, and the caller is not yet a member of the group, so
 * `groups/{gid}` denies them too. Until the join commits there is nothing about the group this
 * device is allowed to know.
 */
export interface RedeemInviteResult {
  readonly groupId: string;
  readonly groupName: string;
  /**
   * `true` when the caller was already an active member and nothing changed.
   *
   * 🔴 A success, not an error — docs/06 is explicit that double-tapping join must not fail.
   * The screen still needs to tell the two apart, because "You joined X" is a lie when nothing
   * happened, so it is reported rather than flattened away.
   */
  readonly alreadyMember: boolean;
}

/**
 * Join a group by invite token (AC-B3.4) — the only path by which anybody becomes a member.
 *
 * Rules cannot authorise this: the caller cannot add themselves to `groups/{gid}/members` (T4)
 * and cannot read the group to check the invite in the first place. So every authorisation
 * decision lives in the Function, and the token is the entire credential.
 *
 * The schema parse here is the same one the Function runs, and it earns its place: a malformed
 * token fails on this device instead of spending a callable invocation and a Firestore query to
 * be told the same thing.
 */
export async function redeemInvite(input: RedeemInviteInput): Promise<RedeemInviteResult> {
  const payload = redeemInviteSchema.parse(input);
  return callFunction<RedeemInviteInput, RedeemInviteResult>(CALLABLE.redeemInvite, payload);
}
