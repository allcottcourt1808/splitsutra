/**
 * `groups/{groupId}` and `groups/{groupId}/members/{uid}`.
 *
 * See docs/03-data-model.md.
 */

import { z } from 'zod';

import {
  MAX_GROUP_MEMBERS,
  allUnique,
  balanceMinorSchema,
  currencyCodeSchema,
  displayNameSchema,
  documentIdSchema,
  photoUrlSchema,
  timestampSchema,
  uidSchema,
} from './primitives.js';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Enums
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * `friend` is the implicit two-person group behind a 1:1 friend expense (D2). It is hidden from
 * the group list; every other type is user-visible.
 */
export const GROUP_TYPES = ['trip', 'home', 'couple', 'other', 'friend'] as const;
export const groupTypeSchema = z.enum(GROUP_TYPES);
export type GroupType = z.infer<typeof groupTypeSchema>;

/** Group types a user may pick when creating a group — `friend` is created by the system only. */
export const SELECTABLE_GROUP_TYPES = ['trip', 'home', 'couple', 'other'] as const;

export const GROUP_ROLES = ['admin', 'member'] as const;
export const groupRoleSchema = z.enum(GROUP_ROLES);
export type GroupRole = z.infer<typeof groupRoleSchema>;

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Group
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** The unrefined object shape. Exported so partial-update payloads can reuse `.shape`. */
export const groupBaseSchema = z.object({
  /** Equals the document ID. */
  id: documentIdSchema,
  name: z.string().trim().min(1).max(60),
  type: groupTypeSchema,
  /** `true` = the hidden 1:1 friend group (D2). Always paired with `type: 'friend'`. */
  isImplicit: z.boolean(),
  photoURL: photoUrlSchema,
  /**
   * 🔴 **Immutable after creation** (AC-C1.1, D6). Enforced in Security Rules; changing it would
   * silently reinterpret every stored `amountMinor` in the group.
   */
  currency: currencyCodeSchema,
  /**
   * Denormalized member list. Drives `where('memberIds', 'array-contains', uid)`, which is what
   * makes "my groups" a single query (D4).
   */
  memberIds: z.array(uidSchema).min(1).max(MAX_GROUP_MEMBERS),
  /**
   * Denormalized count. Maintained by a Cloud Function alongside `memberIds`; treated as a cache
   * (Article V) rather than a parse-time invariant, so transient fan-out lag never blocks a read.
   */
  memberCount: z.number().int().nonnegative(),
  /** Default `false`. When `true`, the simplified view becomes the primary settle-up screen. */
  simplifyDebts: z.boolean(),
  createdBy: uidSchema,
  createdAt: timestampSchema,
  /** Bumped on any activity; drives sort order. */
  updatedAt: timestampSchema,
  lastActivityAt: timestampSchema,
  /** Soft delete only — Article V. */
  deletedAt: timestampSchema.nullable(),

  /* ── Multi-currency forward design (v2, not built) ───────────────────────────────────────
   * docs/03-data-model.md, "Forward design: multi-currency".
   *
   * Recorded now so v2 is an **additive change rather than a migration**. Every forward field is
   * nullable and defaults to `null`, so a v1 document that simply lacks the field still parses
   * and no backfill is ever required.
   */

  /**
   * The group's reporting currency. v1 writes `null`; readers fall back to `currency`, i.e.
   * `group.baseCurrency ?? group.currency`.
   */
  baseCurrency: currencyCodeSchema.nullable().default(null),
  /** v1: always effectively `false`. Read as `group.allowMixedCurrency ?? false`. */
  allowMixedCurrency: z.boolean().nullable().default(null),
});

export const groupSchema = groupBaseSchema
  .refine((g) => allUnique(g.memberIds), {
    message: 'memberIds contains duplicates',
    path: ['memberIds'],
  })
  .refine((g) => !g.isImplicit || g.type === 'friend', {
    message: "An implicit group must have type 'friend' (D2)",
    path: ['type'],
  });

export type Group = z.infer<typeof groupSchema>;

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Group member
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * `groups/{groupId}/members/{uid}`.
 *
 * Membership doubles as the authorization primitive: Security Rules check
 * `exists(/groups/$(gid)/members/$(uid))` rather than reading the group document.
 */
export const groupMemberSchema = z.object({
  /** Equals the document ID. */
  uid: uidSchema,
  role: groupRoleSchema,
  /** Denormalized snapshot, refreshed by the profile fan-out Function (D4). */
  displayName: displayNameSchema,
  photoURL: photoUrlSchema,
  /**
   * Net balance in the **group currency**. Positive means this person is owed money.
   *
   * 🔴 **Function-write-only** (Article III). Security Rules reject every client write to this
   * field — a client that can write its own balance can erase its own debt.
   *
   * > **Invariant AC-E1.3:** across all member documents in a group, `sum(balanceMinor) === 0`,
   * > exactly. It cannot be checked from a single document, so it is asserted by the property
   * > test in `src/domain/**` and by the nightly audit job, not here.
   */
  balanceMinor: balanceMinorSchema,
  joinedAt: timestampSchema,
  /** Set when the member leaves; the document is kept so historical expenses still resolve. */
  leftAt: timestampSchema.nullable(),
});

export type GroupMember = z.infer<typeof groupMemberSchema>;
