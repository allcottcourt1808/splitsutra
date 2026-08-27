/**
 * `groups/{groupId}/settlements/{settlementId}`.
 *
 * A **recorded offline payment**, not a real money transfer. SplitSutra never moves money.
 * See docs/03-data-model.md.
 */

import { z } from 'zod';

import {
  currencyCodeSchema,
  documentIdSchema,
  positiveMinorUnitsSchema,
  timestampSchema,
  uidSchema,
} from './primitives.js';

/** The unrefined object shape. Exported so partial-update payloads can reuse `.shape`. */
export const settlementBaseSchema = z.object({
  /** Equals the document ID. */
  id: documentIdSchema,
  groupId: documentIdSchema,
  /** The payer. */
  fromUid: uidSchema,
  /** The receiver. */
  toUid: uidSchema,
  amountMinor: positiveMinorUnitsSchema,
  currency: currencyCodeSchema,
  date: timestampSchema,
  note: z.string().trim().max(200).nullable(),
  createdBy: uidSchema,
  createdAt: timestampSchema,
  /** Soft delete only — Article V. Deleting reverses the balance effect (AC-E2.5). */
  deletedAt: timestampSchema.nullable(),
});

/**
 * **Balance effect:** `from.balanceMinor += amount`, `to.balanceMinor -= amount`. Paying down what
 * you owe moves your negative balance toward zero (docs/04-split-engine.md §3).
 *
 * "Both parties are current members of the group" is cross-document and is enforced in Security
 * Rules and the Cloud Function, not here.
 */
export const settlementSchema = settlementBaseSchema.refine((s) => s.fromUid !== s.toUid, {
  message: 'A settlement cannot be from someone to themselves',
  path: ['toUid'],
});

export type Settlement = z.infer<typeof settlementSchema>;
