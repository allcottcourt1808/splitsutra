/**
 * Shared Zod building blocks used by every entity schema in this folder.
 *
 * 🔴 **Nothing in `src/types/**` may import a runtime value from `firebase/firestore`.**
 * `Timestamp` is pulled in with `import type` and validated *structurally*, so the type layer
 * stays free of a runtime Firebase dependency and can be imported from Cloud Functions
 * (admin SDK) and the client (web SDK) alike.
 */

import { z } from 'zod';

import type { Timestamp } from 'firebase/firestore';

import { type CurrencyCode, isCurrencyCode } from './currency.js';
import { MAX_AMOUNT_MINOR, type MinorUnits } from './money.js';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Timestamps
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The structural minimum shared by the web SDK `Timestamp`, the admin SDK `Timestamp`, and the
 * emulator's wire representation.
 *
 * Core reads timestamps through this shape rather than through the concrete class, because
 * importing the class would be a runtime Firebase dependency in the type layer.
 */
export interface TimestampLike {
  readonly seconds: number;
  readonly nanoseconds: number;
  toDate(): Date;
}

/** Structural guard for {@link TimestampLike}. */
export function isTimestampLike(v: unknown): v is TimestampLike {
  if (typeof v !== 'object' || v === null) return false;
  const candidate = v as { seconds?: unknown; nanoseconds?: unknown; toDate?: unknown };
  return (
    typeof candidate.seconds === 'number' &&
    Number.isFinite(candidate.seconds) &&
    typeof candidate.nanoseconds === 'number' &&
    Number.isFinite(candidate.nanoseconds) &&
    typeof candidate.toDate === 'function'
  );
}

/**
 * A Firestore `Timestamp`, validated structurally.
 *
 * Typed as the web SDK's `Timestamp` so consumers get the full class surface (`toDate()`,
 * `toMillis()`, …) — every object that reaches this schema from a real `DocumentSnapshot` is one.
 */
export const timestampSchema = z.custom<Timestamp>(isTimestampLike, {
  message: 'Expected a Firestore Timestamp',
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Identifiers and short strings
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** A Firebase Auth UID. Firebase caps these at 128 characters. */
export const uidSchema = z.string().min(1).max(128);

/** A Firestore document ID. May not contain `/`, and may not be `.` or `..`. */
export const documentIdSchema = z
  .string()
  .min(1)
  .max(1500)
  .refine((s) => !s.includes('/') && s !== '.' && s !== '..', {
    message: 'Not a valid Firestore document ID',
  });

/** `displayName` — 1..50, trimmed, non-empty (AC-A2.1, docs/03-data-model.md). */
export const displayNameSchema = z.string().trim().min(1).max(50);

/**
 * A photo URL, or `null`.
 *
 * Deliberately permissive about scheme: Firebase hands back `https://` for provider avatars and
 * `gs://` for Storage objects, and both must survive a read.
 */
export const photoUrlSchema = z.string().url().nullable();

/** An email address, or `null`. 320 is the RFC 3696 maximum. */
export const emailSchema = z.string().email().max(320).nullable();

/** An E.164 phone number, e.g. `+919876543210`, or `null`. */
export const phoneNumberSchema = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, 'Phone number must be in E.164 format, e.g. +919876543210')
  .nullable();

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Currency
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * An ISO 4217 code SplitSutra supports.
 *
 * Validated against the hardcoded table in `./currency` — never against `Intl`.
 */
export const currencyCodeSchema = z
  .string()
  .refine(isCurrencyCode, { message: 'Not a supported ISO 4217 currency code' })
  .transform((v): CurrencyCode => v as CurrencyCode);

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Money — Constitution Article I
 * ────────────────────────────────────────────────────────────────────────────────────────── */

const NOT_AN_INTEGER = 'Money must be a whole number of minor units — never a float (Article I)';
const OUT_OF_BOUNDS = `Amount must be within ±${String(MAX_AMOUNT_MINOR)} minor units`;

/**
 * A signed minor-unit amount inside the safe bound. Use for amounts the user can type.
 *
 * @see MAX_AMOUNT_MINOR for why the bound is what it is.
 */
export const minorUnitsSchema = z
  .number()
  .int(NOT_AN_INTEGER)
  .refine((n) => Math.abs(n) <= MAX_AMOUNT_MINOR, { message: OUT_OF_BOUNDS })
  .transform((n): MinorUnits => n as MinorUnits);

/** A minor-unit amount that must be strictly positive — expense totals, settlement amounts. */
export const positiveMinorUnitsSchema = z
  .number()
  .int(NOT_AN_INTEGER)
  .positive('Amount must be greater than zero')
  .refine((n) => n <= MAX_AMOUNT_MINOR, { message: OUT_OF_BOUNDS })
  .transform((n): MinorUnits => n as MinorUnits);

/**
 * A minor-unit amount that may be zero but never negative — an individual split share.
 *
 * Zero is legitimate: AC-D2.6 allows a participant to carry a zero share and still be listed.
 */
export const nonNegativeMinorUnitsSchema = z
  .number()
  .int(NOT_AN_INTEGER)
  .nonnegative('A split share cannot be negative')
  .refine((n) => n <= MAX_AMOUNT_MINOR, { message: OUT_OF_BOUNDS })
  .transform((n): MinorUnits => n as MinorUnits);

/**
 * A net balance.
 *
 * Bounded by `Number.MAX_SAFE_INTEGER` rather than by `MAX_AMOUNT_MINOR`, because a balance is an
 * *accumulation* of many amounts and can legitimately exceed the per-amount input bound. Sign is
 * meaningful: `> 0` means this person is owed money, `< 0` means they owe it
 * (docs/04-split-engine.md §3).
 */
export const balanceMinorSchema = z
  .number()
  .int(NOT_AN_INTEGER)
  .refine((n) => Number.isSafeInteger(n), {
    message: 'Balance has exceeded the exact-integer range',
  })
  .transform((n): MinorUnits => n as MinorUnits);

/**
 * A sparse map of currency code → net balance.
 *
 * A currency appears only once the user actually has a balance in it, so this is a *partial*
 * record. Modelled with a plain string key plus an explicit key check rather than an enum key,
 * so it behaves identically whether the resolved Zod major treats enum-keyed records as
 * exhaustive or not.
 *
 * 🔴 **Never sum across the entries of this map.** Adding USD to EUR produces a number that means
 * nothing, and it trains users to expect a figure that v2's multi-currency work would have to
 * take away (docs/03-data-model.md, "Consequences to respect in v1").
 */
export const balanceByCurrencySchema = z
  .record(z.string(), z.number())
  .superRefine((record, ctx) => {
    for (const [key, value] of Object.entries(record)) {
      if (!isCurrencyCode(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `Not a supported ISO 4217 currency code: "${key}"`,
        });
      }
      if (!Number.isSafeInteger(value)) {
        ctx.addIssue({ code: 'custom', path: [key], message: NOT_AN_INTEGER });
      }
    }
  })
  .transform((record) => record as Partial<Record<CurrencyCode, MinorUnits>>);

/** The inferred shape of {@link balanceByCurrencySchema}. */
export type BalanceByCurrency = z.infer<typeof balanceByCurrencySchema>;

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Collection limits
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Hard cap on group size (docs/12-decisions.md Q2, docs/00-overview.md).
 *
 * It is also what keeps `memberIds` safe as an `array-contains` field: `groups` are listed with
 * `where('memberIds', 'array-contains', uid)`, and Firestore's practical array limits make 50
 * comfortable (docs/03-data-model.md).
 */
export const MAX_GROUP_MEMBERS = 50;

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Shared refinement helpers
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** `true` when every element of `values` is distinct. */
export function allUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/** `true` when `a` and `b` contain exactly the same elements, ignoring order and duplicates. */
export function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

/**
 * Exact integer sum.
 *
 * Every input is an integer inside `MAX_AMOUNT_MINOR`, and a group holds at most
 * {@link MAX_GROUP_MEMBERS} entries, so the running total stays far below
 * `Number.MAX_SAFE_INTEGER` and the addition is exact.
 */
export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
