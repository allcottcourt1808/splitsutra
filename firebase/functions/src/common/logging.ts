import { logger } from 'firebase-functions';

/**
 * Structured logging. docs/06 §"Error handling and observability":
 * every function logs structured JSON ({ fn, gid, uid, err }) so Cloud Logging can
 * be filtered and alerted on. A free-text log line cannot carry an alert.
 *
 * 🔴 Never swallow an error in the balance path. Fail loudly; auditBalances repairs.
 */

export interface LogContext {
  /** Function name — always present so a log filter can scope to one function. */
  fn: string;
  gid?: string;
  uid?: string;
  eid?: string;
  [key: string]: unknown;
}

export function logInfo(ctx: LogContext, message: string): void {
  logger.info(message, ctx);
}

export function logWarn(ctx: LogContext, message: string): void {
  logger.warn(message, ctx);
}

/**
 * ERROR level is what the log-based alerts in docs/10 §"Monitoring" watch. In
 * particular, any drift reported by auditBalances is the canary for silent money
 * bugs — do not downgrade those to warnings to quieten a dashboard.
 */
export function logError(ctx: LogContext, message: string, err?: unknown): void {
  logger.error(message, { ...ctx, err: serializeError(err) });
}

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return err;
}

/**
 * Wraps a trigger body so a thrown error is logged with context before it
 * propagates. It deliberately RE-THROWS: a Firestore trigger that swallows its
 * error is reported as a success and never retried.
 */
export async function withLogging<T>(ctx: LogContext, body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (err) {
    logError(ctx, 'unhandled error', err);
    throw err;
  }
}
