/**
 * Domain-layer error type.
 *
 * Every validation failure in `domain/` throws a `DomainError` carrying a stable
 * machine-readable `code`. The UI maps codes to copy; tests assert on codes rather
 * than on message strings, so error wording can be improved without breaking the
 * suite.
 *
 * These are *validation* errors, not exceptional conditions: the domain refuses to
 * compute on input it cannot compute correctly, rather than returning a plausible
 * wrong number. Article I — a silently rounded amount is worse than a thrown error.
 */

export type DomainErrorCode =
  /** `total` is negative. The allocator only distributes non-negative amounts. */
  | 'NEGATIVE_TOTAL'
  /** `total` is not an integer, or exceeds `MAX_AMOUNT_MINOR`. */
  | 'INVALID_TOTAL'
  /** A weight is not an integer, is negative, or exceeds `MAX_WEIGHT`. */
  | 'INVALID_WEIGHT'
  /** No participants were supplied. */
  | 'NO_PARTICIPANTS'
  /** The same uid appears twice in one split. */
  | 'DUPLICATE_UID'
  /** Every weight is zero — there is nobody to allocate to. */
  | 'ZERO_TOTAL_WEIGHT'
  /** An exact split's amounts do not sum to the total. */
  | 'EXACT_SUM_MISMATCH'
  /** A percentage split's basis points do not sum to exactly 10 000. */
  | 'PERCENT_SUM_MISMATCH'
  /** A user-supplied amount is negative or not an integer. */
  | 'INVALID_AMOUNT'
  /** An unknown `splitMethod` reached the dispatcher. */
  | 'INVALID_SPLIT_METHOD'
  /** A balance is not an integer — money is never a float (Article I). */
  | 'NON_INTEGER_BALANCE'
  /** A set of balances does not sum to zero (AC-E1.3). */
  | 'ZERO_SUM_VIOLATION';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    // Restores the prototype chain so `instanceof DomainError` holds even if the
    // package is ever emitted with an ES5 target, where subclassing built-ins
    // silently breaks `instanceof`. Free insurance on ES2022.
    Object.setPrototypeOf(this, DomainError.prototype);
  }
}
