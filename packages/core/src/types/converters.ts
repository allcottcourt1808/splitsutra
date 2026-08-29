/**
 * Firestore `withConverter` converters — the parse boundary between Firestore and the app.
 *
 * Every document read through one of these converters is parsed by the Zod schema that owns its
 * collection. A malformed document therefore throws a {@link DocumentParseError} naming the
 * document path, **at the boundary**, instead of surfacing three screens later as an amount that
 * is `undefined` or — far worse — a float that quietly poisons a balance (Article I).
 *
 * 🔴 **Only types are imported from `firebase/firestore`.** `packages/core/tsconfig.json` compiles
 * with `"lib": ["ES2022"]` and no DOM, and `types/**` must stay importable from Cloud Functions
 * (admin SDK) and the client (web SDK) alike, so this module — like `./primitives` — takes the
 * Firestore shapes with `import type` and adds no runtime Firebase dependency.
 *
 * ## Read is validated; write is not
 *
 * `fromFirestore` parses. `toFirestore` passes the model straight through, deliberately:
 *
 * - A write model is `WithFieldValue<T>`, which legitimately contains **`FieldValue` sentinels** —
 *   `serverTimestamp()`, `increment()`, `deleteField()`. `serverTimestamp()` is not a `Timestamp`,
 *   and no schema here could be made to accept it without accepting everything.
 * - Article IV: the write boundary that matters is Security Rules and the Cloud Function, not the
 *   client. Client-side write validation exists for UX and belongs in the form and repository
 *   layers, where the values are concrete.
 *
 * @see docs/03-data-model.md — the collection map, the schemas, and their invariants
 * @see checklists/phase-01-foundation.md §6
 */

// Type-only, both of them: this module must add no runtime dependency on Zod or on the Firebase
// SDK. The schemas it wires up are imported as values below, and they own the Zod dependency.
import type { z } from 'zod';

import type {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
} from 'firebase/firestore';

import { activitySchema, type Activity } from './activity.js';
import { commentSchema, type Comment } from './comment.js';
import { expenseSchema, type Expense } from './expense.js';
import { friendSchema, type Friend } from './friend.js';
import { friendRequestSchema, type FriendRequest } from './friendRequest.js';
import { groupMemberSchema, groupSchema, type Group, type GroupMember } from './group.js';
import { inviteSchema, type Invite } from './invite.js';
import { settlementSchema, type Settlement } from './settlement.js';
import { userSchema, usernameIndexSchema, type User, type UsernameIndex } from './user.js';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Failure
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Thrown when a Firestore document does not match the schema for its collection.
 *
 * Carries the document `path` — the single most useful thing to have when a production read
 * fails — and the raw Zod `issues`, so a caller can report the exact field rather than a generic
 * "something went wrong".
 *
 * A `DocumentParseError` means the *data* is wrong, not the user's input. It is a bug report, not
 * a validation message: never render `message` to a user.
 */
export class DocumentParseError extends Error {
  /** Full Firestore path of the offending document, e.g. `groups/abc/expenses/def`. */
  readonly path: string;

  /** The Zod issues, in schema order. */
  readonly issues: readonly z.ZodIssue[];

  constructor(path: string, issues: readonly z.ZodIssue[]) {
    super(`Malformed Firestore document at "${path}" — ${formatIssues(issues)}`);
    this.name = 'DocumentParseError';
    this.path = path;
    this.issues = issues;
    // Restores the prototype chain so `instanceof` holds even if the package is ever emitted
    // with an ES5 target, where subclassing built-ins silently breaks it. Matches `DomainError`.
    Object.setPrototypeOf(this, DocumentParseError.prototype);
  }
}

/** `field.subfield: message; other: message` — compact enough for one log line. */
function formatIssues(issues: readonly z.ZodIssue[]): string {
  if (issues.length === 0) return 'no issues reported';
  return issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Parsing
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Parse one document's data with `schema`, or throw {@link DocumentParseError}.
 *
 * Exported because the **admin SDK's `FirestoreDataConverter` is a different interface** to the
 * web SDK's: Cloud Functions cannot reuse the converters below, but they can — and should — reuse
 * this, so there is exactly one definition of "is this document well-formed" (Article VI).
 *
 * @param schema The Zod schema that owns the collection.
 * @param data   `snapshot.data()`, or anything document-shaped.
 * @param path   Full document path. Used only to make the error message actionable.
 */
export function parseDocument<Schema extends z.ZodTypeAny>(
  schema: Schema,
  data: unknown,
  path: string,
): z.infer<Schema> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new DocumentParseError(path, result.error.issues);
  }
  return result.data;
}

/**
 * Reconcile the document ID with the ID field stored inside the document.
 *
 * Most entities store their own ID as a field (`id`, `uid`, `friendUid`) because it is needed once
 * the document has been copied out of its snapshot. The **path is authoritative**; the field is a
 * denormalized copy of it.
 *
 * - Field absent → fill it in from the path, so a document written without it still parses.
 * - Field present and different → throw. Two disagreeing identities is corruption, and silently
 *   preferring one of them is how a later write lands on the wrong document.
 */
function withDocumentId(
  raw: DocumentData,
  documentId: string,
  idField: string | undefined,
  path: string,
): DocumentData {
  if (idField === undefined) return raw;

  const stored: unknown = raw[idField];
  if (stored === undefined || stored === null) {
    return { ...raw, [idField]: documentId };
  }
  if (stored !== documentId) {
    const message =
      `Stored ${idField} "${String(stored)}" does not match ` +
      `the document ID "${documentId}" it was read from`;
    throw new DocumentParseError(path, [{ code: 'custom', path: [idField], message }]);
  }
  return raw;
}

/**
 * Pending `serverTimestamp()` writes read back as `null` under Firestore's default
 * `serverTimestamps: 'none'`, which would fail every non-nullable `createdAt` in the schemas while
 * the write is still in flight — i.e. during exactly the optimistic local render that offline
 * persistence exists to provide.
 *
 * `'estimate'` substitutes the local clock until the server value lands. That estimate is a
 * *display* value only; nothing in `domain/**` computes with a clock (Article VII).
 */
const SNAPSHOT_OPTIONS = { serverTimestamps: 'estimate' } as const;

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Converter factory
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Build a `FirestoreDataConverter` that parses every read through `schema`.
 *
 * ```ts
 * const ref = doc(db, 'groups', groupId).withConverter(groupConverter);
 * const snap = await getDoc(ref);
 * const group = snap.data(); // Group | undefined — already validated
 * ```
 *
 * @param schema  The Zod schema for the collection. Its **output** type becomes the app model, so
 *                branded `MinorUnits` values and schema defaults are applied on read.
 * @param idField Name of the field that mirrors the document ID, when the entity has one. Omit it
 *                for a collection whose document ID is not one of its fields — `usernames/`,
 *                whose ID is a hash of a contact detail.
 */
export function zodConverter<Schema extends z.ZodTypeAny>(
  schema: Schema,
  idField?: string,
): FirestoreDataConverter<z.infer<Schema>, DocumentData> {
  return {
    /**
     * `unknown` rather than `WithFieldValue<z.infer<Schema>>`: the parameter type is invisible to
     * callers (they see the annotated `FirestoreDataConverter`), and accepting `unknown` keeps
     * this assignable to both `toFirestore` overloads without relying on method bivariance.
     */
    toFirestore(model: unknown): DocumentData {
      return model as DocumentData;
    },

    fromFirestore(snapshot: QueryDocumentSnapshot): z.infer<Schema> {
      const path = snapshot.ref.path;
      const raw = withDocumentId(snapshot.data(SNAPSHOT_OPTIONS), snapshot.id, idField, path);
      return parseDocument(schema, raw, path);
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Per-collection converters
 * ────────────────────────────────────────────────────────────────────────────────────────── *
 * One per collection in the map at the top of docs/03-data-model.md. The second argument is the
 * field that must equal the document ID — see the "Equals the document ID" note on each schema.
 */

/** `users/{uid}` — the document ID is the Firebase Auth UID. */
export const userConverter: FirestoreDataConverter<User, DocumentData> = zodConverter(
  userSchema,
  'uid',
);

/**
 * `usernames/{normalizedKey}` — **no ID field**.
 *
 * The document ID is `sha256(lowercase(email))` or `sha256(e164(phone))`; the `uid` inside is the
 * user the key resolves to, not a copy of the ID. Passing `'uid'` here would reject every
 * document in the collection.
 */
export const usernameIndexConverter: FirestoreDataConverter<UsernameIndex, DocumentData> =
  zodConverter(usernameIndexSchema);

/** `users/{uid}/friends/{friendUid}`. */
export const friendConverter: FirestoreDataConverter<Friend, DocumentData> = zodConverter(
  friendSchema,
  'friendUid',
);

/**
 * `friendRequests/{requestId}` — the document ID is `${fromUid}__${toUid}`, mirrored into `id`.
 *
 * Unlike `usernames/`, the ID here IS a field: `withDocumentId` therefore reconciles the two and
 * throws if a document's stored `id` disagrees with the path it was read from — which for this
 * collection would mean a request whose sender and recipient are not the pair the ID encodes.
 */
export const friendRequestConverter: FirestoreDataConverter<FriendRequest, DocumentData> =
  zodConverter(friendRequestSchema, 'id');

/** `groups/{groupId}`. */
export const groupConverter: FirestoreDataConverter<Group, DocumentData> = zodConverter(
  groupSchema,
  'id',
);

/** `groups/{groupId}/members/{uid}` — the document ID is the member's UID. */
export const groupMemberConverter: FirestoreDataConverter<GroupMember, DocumentData> = zodConverter(
  groupMemberSchema,
  'uid',
);

/** `groups/{groupId}/expenses/{expenseId}`. */
export const expenseConverter: FirestoreDataConverter<Expense, DocumentData> = zodConverter(
  expenseSchema,
  'id',
);

/** `groups/{groupId}/expenses/{expenseId}/comments/{commentId}`. */
export const commentConverter: FirestoreDataConverter<Comment, DocumentData> = zodConverter(
  commentSchema,
  'id',
);

/** `groups/{groupId}/settlements/{settlementId}`. */
export const settlementConverter: FirestoreDataConverter<Settlement, DocumentData> = zodConverter(
  settlementSchema,
  'id',
);

/** `groups/{groupId}/activity/{activityId}`. */
export const activityConverter: FirestoreDataConverter<Activity, DocumentData> = zodConverter(
  activitySchema,
  'id',
);

/** `invites/{inviteId}` — reachable from Cloud Functions only; Rules permit no client read. */
export const inviteConverter: FirestoreDataConverter<Invite, DocumentData> = zodConverter(
  inviteSchema,
  'id',
);
