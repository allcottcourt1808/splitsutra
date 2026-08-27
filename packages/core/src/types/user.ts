/**
 * `users/{uid}` and the public projection in `usernames/{normalizedKey}`.
 *
 * See docs/03-data-model.md.
 */

import { z } from 'zod';

import {
  displayNameSchema,
  emailSchema,
  phoneNumberSchema,
  photoUrlSchema,
  timestampSchema,
  uidSchema,
  currencyCodeSchema,
} from './primitives.js';

/**
 * The user's own profile. Readable only by the owner — everyone else sees
 * {@link usernameIndexSchema} or the denormalized snapshot on a group member document.
 */
export const userSchema = z.object({
  /** Equals the document ID, which equals the Firebase Auth UID. */
  uid: uidSchema,
  displayName: displayNameSchema,
  email: emailSchema,
  /** E.164, e.g. `+919876543210`. */
  phoneNumber: phoneNumberSchema,
  photoURL: photoUrlSchema,
  /** Full ISO 4217; `USD` for new accounts. */
  defaultCurrency: currencyCodeSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  /** Anonymised-account tombstone. Soft delete only — Article V. */
  deletedAt: timestampSchema.nullable(),
});

export type User = z.infer<typeof userSchema>;

/**
 * `usernames/{normalizedKey}` — the friend-lookup index.
 *
 * The document ID is `sha256(lowercase(email))` or `sha256(e164(phone))` in hex, written only by
 * a Cloud Function. Rules allow `get` and **deny `list`**: a lookup can only resolve a contact
 * the caller already knows, and the collection cannot be enumerated to harvest emails and phone
 * numbers (docs/03-data-model.md).
 *
 * This is a **public projection**. Never widen it — every field here is visible to any signed-in
 * user who can guess the hash of a contact detail.
 */
export const usernameIndexSchema = z.object({
  uid: uidSchema,
  displayName: displayNameSchema,
  photoURL: photoUrlSchema,
});

export type UsernameIndex = z.infer<typeof usernameIndexSchema>;
