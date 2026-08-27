import {
  HttpsError,
  type CallableOptions,
  type CallableRequest,
} from 'firebase-functions/v2/https';
import type { TypeOf, ZodTypeAny } from 'zod';

import { db } from './admin.js';
import { ENFORCE_APP_CHECK, MAX_INSTANCES, REGION } from './config.js';

/**
 * The shared callable preamble. docs/06 §"Callable functions":
 *
 *   export const redeemInvite = onCall(CALLABLE_OPTS, async (req) => {
 *     const uid = requireAuth(req);
 *     const { token } = parseInput(RedeemInviteSchema, req.data);
 *     ...
 *   });
 *
 * 🔴 Callables run with Admin SDK privileges and are therefore NOT subject to
 *    firestore.rules. Every authorization check a rule would have made has to be
 *    made here, in code. That is the whole reason these exist: redeemInvite adds a
 *    member precisely because rules forbid a client from doing it (T4).
 */

export const CALLABLE_OPTS: CallableOptions = {
  region: REGION,
  maxInstances: MAX_INSTANCES,
  // TODO(phase-10): ENFORCE_APP_CHECK flips to true once App Check has run in
  // monitoring mode. docs/18 §4 R3 — this is what stops the public web config
  // being scripted against to run up a bill.
  enforceAppCheck: ENFORCE_APP_CHECK,
};

/** Throws `unauthenticated` unless a verified Firebase ID token was presented. */
export function requireAuth(req: CallableRequest<unknown>): string {
  if (!req.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  return req.auth.uid;
}

/**
 * Validates input against the shared Zod schema from @splitsutra/core (docs/02: one
 * validation definition for client and server).
 *
 * Throws `invalid-argument` with the field paths so the UI can show a real message
 * rather than "something went wrong" (docs/06 §"Shared conventions").
 */
export function parseInput<S extends ZodTypeAny>(schema: S, data: unknown): TypeOf<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw new HttpsError('invalid-argument', 'Invalid request.', { issues });
  }
  return result.data as TypeOf<S>;
}

export interface MemberRecord {
  uid: string;
  role: 'admin' | 'member';
  displayName: string;
  balanceMinor: number;
  leftAt: FirebaseFirestore.Timestamp | null;
}

/**
 * Server-side equivalent of the `isActiveMember()` rule. Mirrors firestore.rules
 * deliberately: a member doc survives a departure (only `leftAt` is set) so that
 * historical expenses still render, which means "the doc exists" is NOT the same
 * as "is in the group".
 */
export async function requireActiveMember(groupId: string, uid: string): Promise<MemberRecord> {
  const snap = await db.doc(`groups/${groupId}/members/${uid}`).get();
  const data = snap.data() as MemberRecord | undefined;
  if (!snap.exists || !data || data.leftAt !== null) {
    throw new HttpsError('permission-denied', 'You are not a member of this group.');
  }
  return data;
}

/** Server-side equivalent of the `isAdmin()` rule. */
export async function requireGroupAdmin(groupId: string, uid: string): Promise<MemberRecord> {
  const member = await requireActiveMember(groupId, uid);
  if (member.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only a group admin can do this.');
  }
  return member;
}

/**
 * The precondition that CANNOT live in Security Rules — it requires reading other
 * members' documents (docs/06 §"leaveGroup / removeMember / deleteGroup").
 *
 * The outstanding amount goes in the error detail so the UI can say
 * "settle $12.50 first" rather than "operation failed".
 */
export function requireZeroBalance(member: MemberRecord, currency: string): void {
  if (member.balanceMinor !== 0) {
    throw new HttpsError('failed-precondition', 'Settle up before leaving or removing a member.', {
      balanceMinor: member.balanceMinor,
      currency,
      uid: member.uid,
    });
  }
}
