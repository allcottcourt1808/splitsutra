import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Admin SDK singleton.
 *
 * 🔴 NO SERVICE-ACCOUNT KEY FILE. Ever. `initializeApp()` with no argument uses
 * Application Default Credentials: in Cloud Functions that is the built-in runtime
 * service identity, and under the emulator suite it is no credential at all
 * (FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST short-circuit auth).
 *
 * A committed Admin SDK JSON key bypasses every rule in firestore.rules — including
 * the T2 balance protections that Article III depends on — and is permanently
 * recoverable from git history even after a "fix" commit. docs/10 puts gitleaks in
 * a pre-commit hook for exactly this reason. If you ever find yourself wanting one
 * here, you want ADC instead.
 *
 * NOTE: everything reached through `db` runs with full admin privileges and is NOT
 * subject to Security Rules. Rules protect the client path; this path is protected
 * only by the checks written in these functions.
 */
if (getApps().length === 0) {
  initializeApp();
}

export const db = getFirestore();
export const adminAuth = getAuth();

export {
  // `FieldPath.documentId()` is the only way to order a query by document ID:
  // the string '__name__' is a reserved name the SDK rejects as a field path.
  // Paging a collection scan needs it (see scheduled/auditBalances.ts).
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
