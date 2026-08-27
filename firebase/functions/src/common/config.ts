import { setGlobalOptions } from 'firebase-functions/v2/options';

/**
 * Shared runtime configuration for every function in this codebase.
 *
 * Spec: docs/06-cloud-functions.md, docs/18-cost-control.md, CONSTITUTION Article XI.
 */

/**
 * Iowa. Colocated with Firestore (docs/08 §5: the database location is permanent
 * and was created in us-central1 deliberately). If that assumption is ever wrong,
 * this is the one constant to change.
 */
export const REGION = 'us-central1' as const;

/**
 * 🔴 Article XI — "Every Cloud Function sets maxInstances."
 *
 * Blaze has no hard spending cap. A trigger loop without a ceiling is a bill, not
 * an error (docs/18 §4 R2). docs/18 §7 says start at 10 and revisit with real
 * numbers in Phase 10 (Article XII).
 *
 * This is applied twice on purpose: once globally below, and once explicitly on
 * every function definition. The explicit copy is what a reviewer greps for, and
 * it survives someone deleting the global call.
 */
export const MAX_INSTANCES = 10;

/** A daily audit job has no reason to fan out. One instance, ever. */
export const SCHEDULED_MAX_INSTANCES = 1;

/**
 * App Check enforcement. docs/08 §7 and checklists/phase-10-hardening: run App
 * Check in MONITORING mode first and only then enforce — enforcing on day one
 * locks you out of your own app.
 *
 * TODO(phase-10): flip to true after reCAPTCHA Enterprise has been in monitoring
 * mode long enough to confirm legitimate traffic passes. One constant, one deploy.
 */
export const ENFORCE_APP_CHECK = false;

/**
 * Article VI — one implementation of the money math, and one source for its bounds.
 *
 * Both of these were previously re-declared in this file with the same values, and the
 * member cap under a different name than core uses (GROUP_MAX_MEMBERS here vs
 * MAX_GROUP_MEMBERS there). Two declarations that agree today are two declarations that
 * can disagree tomorrow, and an amount ceiling that has silently diverged between client
 * validation and server verification is precisely how a bad expense gets written.
 *
 * MAX_GROUP_MEMBERS — Q2 (docs/12): 50 members per group. Also mirrored by the array-size
 *   caps in firestore.rules, which cannot import anything and must be kept in step by hand.
 * MAX_AMOUNT_MINOR — docs/04 §"Safe bound": keeps amount x weight inside
 *   Number.MAX_SAFE_INTEGER.
 */
export { MAX_AMOUNT_MINOR, MAX_GROUP_MEMBERS } from '@splitsutra/core';

/**
 * Q2 (docs/12): above this many live expenses in one group, full recompute stops
 * being cheap (ADR-07 trades reads for idempotence). Provisional — Phase 10
 * instruments real read counts and sets it from measurement, not from this guess.
 */
export const RECOMPUTE_THRESHOLD = 1000;

/** Firestore batched writes cap at 500; docs/10 uses 400 for headroom. */
export const BATCH_SIZE = 400;

/** docs/06: auditBalances runs daily at 03:00 IST. */
export const AUDIT_SCHEDULE = '0 3 * * *';
export const AUDIT_TIMEZONE = 'Asia/Kolkata';

/**
 * Applied before any function is defined. Module side effects run at import time
 * and this module is imported by every function module, so the global options are
 * always set first regardless of the order index.ts re-exports things in.
 */
setGlobalOptions({ region: REGION, maxInstances: MAX_INSTANCES });
