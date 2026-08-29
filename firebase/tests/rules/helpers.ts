// Shared harness for the Security Rules suite (CONSTITUTION.md Article IV).
// Runs the real firestore.rules against the emulator's evaluator — nothing here re-implements
// rule semantics.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { Timestamp, doc, serverTimestamp, setDoc, type FieldValue } from 'firebase/firestore';

// Must match --project in the test:rules script. The demo- prefix forces the SDKs offline.
export const PROJECT_ID = 'demo-rules';

const RULES_PATH = fileURLToPath(new URL('../../../firestore.rules', import.meta.url));

export const ALICE = 'uid_alice';
export const BOB = 'uid_bob';
export const CAROL = 'uid_carol';
/** Departed member: doc still exists, leftAt set. Distinguishes isActiveMember from isMember. */
export const DAN = 'uid_dan';

export const ALICE_EMAIL = 'alice@example.com';
export const ALICE_PHONE = '+15550100001';
export const BOB_EMAIL = 'bob@example.com';

export const GROUP = 'grp_trip';
export const OTHER_GROUP = 'grp_other';
export const GROUP_CURRENCY = 'USD';

export async function createTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(RULES_PATH, 'utf8') },
  });
}

export function as(
  env: RulesTestEnvironment,
  uid: string,
  claims: Record<string, unknown> = {},
): RulesTestContext {
  return env.authenticatedContext(uid, claims);
}

export function asAnon(env: RulesTestEnvironment): RulesTestContext {
  return env.unauthenticatedContext();
}

// Seed with rules off, so read tests don't depend on the create rule being correct.
export async function seed(
  env: RulesTestEnvironment,
  fn: (ctx: RulesTestContext) => Promise<unknown>,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx);
  });
}

/** Client-chosen `date` fields are not pinned to request.time, unlike createdAt. */
export const PAST = Timestamp.fromDate(new Date('2026-01-15T12:00:00Z'));

// A distinct instant, for testing immutable-field rules. changed() is
// diff().affectedKeys(), which is value-based: rewriting a field with the value it already
// holds is not a change and is correctly allowed, so an immutability test must write a
// DIFFERENT value or it silently asserts nothing.
export const OTHER_PAST = Timestamp.fromDate(new Date('2020-06-01T00:00:00Z'));

// Builders return a document that PASSES its rule, so a test overrides only the field it is
// subverting. createdAt uses serverTimestamp() because the rules pin it to request.time.

export function groupDoc(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Lisbon trip',
    type: 'trip',
    isImplicit: false,
    currency: GROUP_CURRENCY,
    createdBy: ALICE,
    createdAt: PAST,
    memberIds: [ALICE, BOB],
    memberCount: 2,
    lastActivityAt: PAST,
    deletedAt: null,
    ...overrides,
  };
}

export function memberDoc(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    uid,
    role: uid === ALICE ? 'admin' : 'member',
    displayName: uid,
    balanceMinor: {},
    joinedAt: PAST,
    leftAt: null,
    ...overrides,
  };
}

export function expenseDoc(overrides: Record<string, unknown> = {}) {
  return {
    groupId: GROUP,
    description: 'Dinner at Ramiro',
    amountMinor: 5000,
    currency: GROUP_CURRENCY,
    splitMethod: 'equal',
    date: PAST,
    splits: [
      { uid: ALICE, amountMinor: 2500 },
      { uid: BOB, amountMinor: 2500 },
    ],
    paidBy: [{ uid: ALICE, amountMinor: 5000 }],
    participantIds: [ALICE, BOB],
    // Q1 Option A: rules have no reduce(), so the client supplies these and the rule asserts
    // they equal amountMinor. onExpenseWritten recomputes the real sums.
    splitsTotalMinor: 5000,
    paidTotalMinor: 5000,
    createdBy: ALICE,
    createdAt: serverTimestamp() as FieldValue,
    deletedAt: null,
    ...overrides,
  };
}

export function seededExpenseDoc(overrides: Record<string, unknown> = {}) {
  return expenseDoc({ createdAt: PAST, ...overrides });
}

export function settlementDoc(overrides: Record<string, unknown> = {}) {
  return {
    groupId: GROUP,
    fromUid: BOB,
    toUid: ALICE,
    amountMinor: 2500,
    currency: GROUP_CURRENCY,
    date: PAST,
    note: 'Sent by bank transfer',
    createdBy: ALICE,
    createdAt: serverTimestamp() as FieldValue,
    deletedAt: null,
    ...overrides,
  };
}

export function seededSettlementDoc(overrides: Record<string, unknown> = {}) {
  return settlementDoc({ createdAt: PAST, ...overrides });
}

export function commentDoc(overrides: Record<string, unknown> = {}) {
  return {
    uid: ALICE,
    text: 'Wasn’t this 40?',
    createdAt: serverTimestamp() as FieldValue,
    deletedAt: null,
    ...overrides,
  };
}

export function seededCommentDoc(overrides: Record<string, unknown> = {}) {
  return commentDoc({ createdAt: PAST, ...overrides });
}

export function userDoc(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    uid,
    displayName: 'Alice Example',
    defaultCurrency: GROUP_CURRENCY,
    createdAt: serverTimestamp() as FieldValue,
    ...overrides,
  };
}

export function seededUserDoc(uid: string, overrides: Record<string, unknown> = {}) {
  return userDoc(uid, { createdAt: PAST, ...overrides });
}

export async function seedWorld(env: RulesTestEnvironment): Promise<void> {
  await seed(env, async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `groups/${GROUP}`), groupDoc());
    await setDoc(doc(db, `groups/${GROUP}/members/${ALICE}`), memberDoc(ALICE));
    await setDoc(doc(db, `groups/${GROUP}/members/${BOB}`), memberDoc(BOB));
    await setDoc(doc(db, `groups/${GROUP}/members/${DAN}`), memberDoc(DAN, { leftAt: PAST }));
  });
}
