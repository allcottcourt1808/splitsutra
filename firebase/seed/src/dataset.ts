/**
 * ============================================================================
 * THE SEED FIXTURE — every document this script writes, built and validated here
 * ============================================================================
 *
 * Nothing in this module touches Firestore. It builds a complete, self-consistent
 * world in memory, parses **every document through the Zod schema that owns its
 * collection**, and hands the result to `writer.ts` as a flat list of paths and
 * payloads. A malformed fixture therefore fails here — in the script, with a
 * `DocumentParseError` naming the field — rather than three screens later as an
 * `undefined` amount or, far worse, a float in somebody's balance (Article I).
 *
 * ----------------------------------------------------------------------------
 * ⚠️ HOW `@splitsutra/core` IS REACHED, AND WHY IT IS THE BUILT OUTPUT
 * ----------------------------------------------------------------------------
 * The root `package.json` runs this script (`"seed": "tsx firebase/seed.ts"`) and
 * does not declare `@splitsutra/core`. Under pnpm's strict, non-hoisted
 * `node_modules` a bare `import '@splitsutra/core/domain'` from `firebase/`
 * resolves nowhere — only `apps/web` and `firebase/functions` have it linked.
 *
 * So it is imported by **relative path into `packages/core/dist`**, which needs no
 * manifest entry at all. Two things make that the right target rather than `src`:
 *
 *   1. `dist` is what core actually publishes now. `packages/core/package.json`
 *      points every entry point at `./dist/*`, and `tsconfig.build.json` explains
 *      at length why: core's source carries explicit `.js` specifiers that nothing
 *      emitted until that build existed, and `firebase/functions` died with
 *      ERR_MODULE_NOT_FOUND on them. Consuming `src` from here would re-create the
 *      shape of that bug in a second place.
 *   2. `dist` is a *frozen artefact*. Reading `src` would make this script's output
 *      depend on whatever half-finished edit is currently in core's source tree.
 *
 * 🔴 Consequence, and the one thing that will bite you:
 *
 *        pnpm --filter @splitsutra/core build
 *
 *    must have been run at least once, or this import fails with
 *    ERR_MODULE_NOT_FOUND on `packages/core/dist/...`. `firebase/seed.ts` turns
 *    that into a readable instruction rather than a stack trace.
 *
 * Bare specifiers *inside* core (`zod`) still resolve correctly, because Node
 * resolves them relative to the importing file — which lives inside
 * `packages/core`, which declares zod.
 *
 * Only the two leaf barrels are imported, never `dist/index.js`: the package root
 * also re-exports `stores/` and `hooks/`, which reach for zustand and React. A seed
 * script has no business loading either.
 *
 * ----------------------------------------------------------------------------
 * 🔴 ARTICLE VI — THERE IS EXACTLY ONE IMPLEMENTATION OF THE MONEY MATH
 * ----------------------------------------------------------------------------
 * Not one number below is divided, rounded, or apportioned by this file. Every
 * split goes through `computeSplits`, and every balance through `computeBalances`
 * + `assertZeroSum` — the same functions the Cloud Function calls for the
 * authoritative write and the client calls for optimistic display. A seed script
 * that hand-computed "$127.51 ÷ 3" would be a second implementation, and the first
 * thing it would produce is fixture data the real app can never reproduce.
 *
 * The expense id doubles as the split tie-break seed, which is exactly what
 * `splitEqual` documents: the rotation that decides who absorbs the leftover minor
 * unit is reproducible from stored data alone.
 */

import { createHash } from 'node:crypto';

import { Timestamp, type DocumentData } from './admin.js';

import {
  assertZeroSum,
  computeBalances,
  computeSplits,
  type ExactEntry,
  type PercentEntry,
  type ShareEntry,
  type SplitAllocation,
} from '../../../packages/core/dist/domain/index.js';

/**
 * The ONE currency formatter (Article VI). `utils` is a leaf barrel like the two above —
 * no zustand, no React — so importing it here costs nothing a seed script should not pay.
 */
import { formatMoney } from '../../../packages/core/dist/utils/index.js';

import {
  activitySchema,
  commentSchema,
  expenseSchema,
  friendSchema,
  groupMemberSchema,
  groupSchema,
  inviteSchema,
  parseDocument,
  settlementSchema,
  toMinorUnits,
  userSchema,
  usernameIndexSchema,
  type ActivityType,
  type CurrencyCode,
  type ExpenseCategory,
  type GroupType,
} from '../../../packages/core/dist/types/index.js';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Determinism
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * 🔴 EVERY ID BELOW IS DETERMINISTIC, AND THAT IS WHAT MAKES `pnpm seed` IDEMPOTENT.
 *
 * The writer uses `set()`, so re-running overwrites the same document rather than
 * appending a second one. `collection.add()` or `crypto.randomUUID()` anywhere in
 * this file would double the data on every run, and the duplicate would be
 * indistinguishable from a real second expense.
 *
 * The prefix is not decoration either: it is how a human staring at the emulator UI
 * can tell fabricated data from anything they typed themselves.
 */
const PREFIX = 'seed';

/**
 * Timestamps are pinned to a fixed instant, not to `Date.now()`.
 *
 * A clock-relative fixture writes different bytes on every run, which makes "did
 * the second run change anything?" impossible to answer by inspection — and
 * `serverTimestamp()` would be worse still, since it is resolved by the server and
 * cannot be compared to anything the script knows. The cost is that the feed does
 * not drift forward over time; that is a fair trade for a fixture whose whole
 * value is being the same every time.
 */
const EPOCH_ISO = '2026-08-01T09:00:00.000Z';
const EPOCH_MS = Date.parse(EPOCH_ISO);
const DAY_MS = 86_400_000;

/** `at(3.5)` is three and a half days after {@link EPOCH_ISO}. Ordering inside a day matters. */
function at(dayOffset: number): Timestamp {
  return Timestamp.fromMillis(Math.round(EPOCH_MS + dayOffset * DAY_MS));
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * What the writer consumes
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** One Firestore write. `kind` exists only so the final summary can count by collection. */
export interface SeedDocument {
  readonly path: string;
  readonly kind: SeedDocumentKind;
  readonly data: DocumentData;
}

export type SeedDocumentKind =
  | 'user'
  | 'username'
  | 'friend'
  | 'group'
  | 'member'
  | 'expense'
  | 'comment'
  | 'settlement'
  | 'activity'
  | 'invite';

/**
 * A seeded account.
 *
 * The password is a **fixture constant, printed in the final summary**. That is
 * safe for `demo-*` (the Auth emulator is a local process holding throwaway state)
 * and is exactly why `writer.ts` refuses to create Auth users against a real
 * project — see the note there.
 */
export interface SeededUser {
  readonly uid: string;
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
  readonly phoneNumber: string | null;
  readonly defaultCurrency: CurrencyCode;
}

/** One line of the per-group report the summary prints. */
export interface SeededGroupSummary {
  readonly id: string;
  readonly name: string;
  readonly type: GroupType;
  readonly currency: CurrencyCode;
  readonly isImplicit: boolean;
  readonly expenseCount: number;
  readonly settlementCount: number;
  /** Final member balances, uid-ascending, already formatted for display. */
  readonly balances: readonly { readonly displayName: string; readonly formatted: string }[];
}

export interface SeedDataset {
  readonly users: readonly SeededUser[];
  readonly documents: readonly SeedDocument[];
  readonly groups: readonly SeededGroupSummary[];
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * People
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** Shared by every seeded account. Six characters is Firebase Auth's minimum. */
const SEED_PASSWORD = 'seed-password';

/**
 * `.test` is reserved by RFC 2606 and can never be registered, so none of these
 * addresses can reach a real mailbox even if a seeded document escapes the
 * emulator.
 */
const uid = (name: string): string => `${PREFIX}_${name}`;

/**
 * 🔴 `photoURL` is `null` for everyone, deliberately.
 *
 * There is no image URL that resolves offline, and a fixture full of 404s makes an
 * avatar-fallback bug look identical to a working fallback. The nullable branch is
 * the one every screen must handle anyway.
 */
const USERS: readonly SeededUser[] = [
  {
    uid: uid('ava'),
    displayName: 'Ava Sharma',
    email: 'ava@seed.splitsutra.test',
    password: SEED_PASSWORD,
    phoneNumber: null,
    defaultCurrency: 'USD',
  },
  {
    uid: uid('ben'),
    displayName: 'Ben Okafor',
    email: 'ben@seed.splitsutra.test',
    password: SEED_PASSWORD,
    // The one seeded account with a phone number, so the phone half of the
    // `usernames/` lookup index has something in it to resolve.
    phoneNumber: '+919876543210',
    defaultCurrency: 'USD',
  },
  {
    uid: uid('cleo'),
    displayName: 'Cleo Marín',
    email: 'cleo@seed.splitsutra.test',
    password: SEED_PASSWORD,
    phoneNumber: null,
    defaultCurrency: 'EUR',
  },
  {
    uid: uid('dan'),
    displayName: 'Dan Tanaka',
    email: 'dan@seed.splitsutra.test',
    password: SEED_PASSWORD,
    phoneNumber: null,
    defaultCurrency: 'JPY',
  },
  {
    uid: uid('eve'),
    displayName: 'Eve Lindqvist',
    email: 'eve@seed.splitsutra.test',
    password: SEED_PASSWORD,
    phoneNumber: null,
    defaultCurrency: 'EUR',
  },
] as const;

const AVA = uid('ava');
const BEN = uid('ben');
const CLEO = uid('cleo');
const DAN = uid('dan');
const EVE = uid('eve');

const displayNameOf = (id: string): string =>
  USERS.find((user) => user.uid === id)?.displayName ?? 'Member';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Groups
 * ────────────────────────────────────────────────────────────────────────────────────────── */

interface GroupSpec {
  readonly id: string;
  readonly name: string;
  readonly type: GroupType;
  readonly isImplicit: boolean;
  readonly currency: CurrencyCode;
  /** First entry is the creator and becomes the `admin` member. */
  readonly memberIds: readonly string[];
  readonly simplifyDebts: boolean;
  readonly createdOnDay: number;
}

/**
 * 🔴 MULTI-CURRENCY, THE WAY v1 ACTUALLY MODELS IT.
 *
 * `group.currency` is immutable and every expense in the group must match it
 * (invariant 6, T10), so a *single* group is never mixed. The multi-currency
 * hazard lives one level up: **Ava is in a USD group, a JPY group and a EUR
 * group at once**, so any screen that aggregates across her groups sees three
 * currencies and must never add them together (D6 — "never sum across the entries
 * of this map"). That cross-group spread is the case seeded here, because it is
 * the one that produces a wrong number rather than an obviously wrong screen.
 *
 * The JPY group is the zero-decimal case. `getExponent('JPY')` is 0, so
 * `amountMinor: 58000` is ¥58,000 and not ¥580.00 — the single most common
 * formatting bug in an expense app, and the reason the exponent table is
 * hardcoded rather than taken from `Intl`.
 */
const GROUPS: readonly GroupSpec[] = [
  {
    id: `${PREFIX}_group_flat`,
    name: 'Apartment 4B',
    type: 'home',
    isImplicit: false,
    currency: 'USD',
    memberIds: [AVA, BEN, CLEO],
    simplifyDebts: false,
    createdOnDay: 0,
  },
  {
    id: `${PREFIX}_group_kyoto`,
    name: 'Kyoto Trip',
    type: 'trip',
    isImplicit: false,
    // Zero-decimal. See the block comment above.
    currency: 'JPY',
    memberIds: [BEN, AVA, DAN],
    // On, so the settle-up screen has a group where the simplified view is primary.
    simplifyDebts: true,
    createdOnDay: 2,
  },
  {
    id: `${PREFIX}_group_berlin`,
    name: 'Berlin Weekend',
    type: 'trip',
    isImplicit: false,
    currency: 'EUR',
    memberIds: [CLEO, AVA, EVE],
    simplifyDebts: false,
    createdOnDay: 4,
  },
  {
    // D2: a 1:1 friendship is not a second code path — it is a normal group flagged
    // `isImplicit` and hidden from the group list, so every expense, balance and
    // settlement path works on it unchanged. Seeded so those paths have a two-person
    // group to run against.
    id: `${PREFIX}_group_ava_ben`,
    name: 'Ava Sharma & Ben Okafor',
    type: 'friend',
    isImplicit: true,
    currency: 'USD',
    memberIds: [AVA, BEN],
    simplifyDebts: false,
    createdOnDay: 1,
  },
  {
    // The empty-state counterpart: a friendship with no expenses yet. Screens need
    // a "you are settled up" case that is genuinely settled, not merely netting to
    // zero by coincidence.
    id: `${PREFIX}_group_ava_cleo`,
    name: 'Ava Sharma & Cleo Marín',
    type: 'friend',
    isImplicit: true,
    currency: 'USD',
    memberIds: [AVA, CLEO],
    simplifyDebts: false,
    createdOnDay: 5,
  },
] as const;

const groupById = (id: string): GroupSpec => {
  const group = GROUPS.find((candidate) => candidate.id === id);
  if (group === undefined) throw new Error(`Seed fixture references unknown group "${id}"`);
  return group;
};

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Expenses
 * ────────────────────────────────────────────────────────────────────────────────────────── */

type SplitSpec =
  | { readonly method: 'equal'; readonly uids: readonly string[] }
  | { readonly method: 'exact'; readonly amounts: readonly ExactEntry[] }
  | { readonly method: 'percent'; readonly percentages: readonly PercentEntry[] }
  | { readonly method: 'shares'; readonly shares: readonly ShareEntry[] };

interface ExpenseSpec {
  readonly id: string;
  readonly groupId: string;
  readonly description: string;
  /** Minor units of the group's currency. Integer only — Article I. */
  readonly amountMinor: number;
  readonly category: ExpenseCategory;
  readonly day: number;
  readonly paidBy: readonly { readonly uid: string; readonly amountMinor: number }[];
  readonly split: SplitSpec;
  readonly createdBy: string;
  /** Article V — soft delete. The document survives; it stops moving anyone's balance. */
  readonly deletedOnDay: number | null;
}

/**
 * All four split methods appear below, each on a total that does **not** divide
 * evenly, because an evenly-divisible fixture proves nothing: it is identical
 * whether the allocator uses largest-remainder or a naive `Math.round`, and the
 * bug only shows up on the awkward totals.
 */
const EXPENSES: readonly ExpenseSpec[] = [
  /* ── Apartment 4B (USD, exponent 2) ─────────────────────────────────────────── */
  {
    id: `${PREFIX}_exp_flat_01`,
    groupId: `${PREFIX}_group_flat`,
    description: 'Groceries and household run',
    // $127.51 over three people: 12751 / 3 does not divide. The allocator gives one
    // participant 4251 and the other two 4250, chosen by the seeded rotation.
    amountMinor: 12751,
    category: 'groceries',
    day: 0.5,
    paidBy: [{ uid: AVA, amountMinor: 12751 }],
    split: { method: 'equal', uids: [AVA, BEN, CLEO] },
    createdBy: AVA,
    deletedOnDay: null,
  },
  {
    id: `${PREFIX}_exp_flat_02`,
    groupId: `${PREFIX}_group_flat`,
    description: 'Internet + electricity, August',
    amountMinor: 18000,
    category: 'utilities',
    day: 1.5,
    paidBy: [{ uid: BEN, amountMinor: 18000 }],
    // EXACT: the user typed every figure, so nothing is computed. `splitExact`
    // refuses to adjust the last participant to force a match — a typo must fail
    // loudly rather than be silently absorbed.
    split: {
      method: 'exact',
      amounts: [
        { uid: AVA, amountMinor: 7500 },
        { uid: BEN, amountMinor: 6000 },
        { uid: CLEO, amountMinor: 4500 },
      ],
    },
    createdBy: BEN,
    deletedOnDay: null,
  },
  {
    id: `${PREFIX}_exp_flat_03`,
    groupId: `${PREFIX}_group_flat`,
    description: 'Sofa, delivered',
    amountMinor: 45000,
    category: 'household',
    day: 3,
    // AC-D1.4 — more than one payer. The contributions must sum to the total, which
    // is invariant 2 and is re-checked by `expenseSchema` below.
    paidBy: [
      { uid: AVA, amountMinor: 30000 },
      { uid: CLEO, amountMinor: 15000 },
    ],
    split: {
      method: 'shares',
      shares: [
        { uid: AVA, shares: 2 },
        { uid: BEN, shares: 1 },
        { uid: CLEO, shares: 1 },
      ],
    },
    createdBy: AVA,
    deletedOnDay: null,
  },
  {
    id: `${PREFIX}_exp_flat_04`,
    groupId: `${PREFIX}_group_flat`,
    description: 'Pizza (entered twice by mistake)',
    amountMinor: 3200,
    category: 'food',
    day: 3.5,
    paidBy: [{ uid: BEN, amountMinor: 3200 }],
    split: { method: 'equal', uids: [AVA, BEN, CLEO] },
    createdBy: BEN,
    // Article V. `computeBalances` skips it, so it must contribute exactly nothing
    // to the member balances written below — while remaining in the ledger, which is
    // what any screen filtering `where('deletedAt','==',null)` needs to be tested on.
    deletedOnDay: 3.6,
  },

  /* ── Kyoto Trip (JPY, exponent 0 — amountMinor IS the yen figure) ────────────── */
  {
    id: `${PREFIX}_exp_kyoto_01`,
    groupId: `${PREFIX}_group_kyoto`,
    description: 'Ryokan, two nights',
    // ¥58,000, not ¥580.00. Over three people it is 19334 / 19333 / 19333 — a
    // one-yen remainder, which at exponent 0 is a whole visible unit rather than a
    // rounding crumb.
    amountMinor: 58000,
    category: 'accommodation',
    day: 2.5,
    paidBy: [{ uid: DAN, amountMinor: 58000 }],
    split: { method: 'equal', uids: [AVA, BEN, DAN] },
    createdBy: DAN,
    deletedOnDay: null,
  },
  {
    id: `${PREFIX}_exp_kyoto_02`,
    groupId: `${PREFIX}_group_kyoto`,
    description: 'Kaiseki dinner',
    amountMinor: 27000,
    category: 'food',
    day: 3.25,
    paidBy: [{ uid: AVA, amountMinor: 27000 }],
    // PERCENT, carried as integer basis points: 33.33% is 3333. Floats would make
    // `33.33 + 33.33 + 33.34 === 100` false in binary, i.e. a validation rule that
    // cannot be satisfied.
    split: {
      method: 'percent',
      percentages: [
        { uid: AVA, bps: 3333 },
        { uid: BEN, bps: 3333 },
        { uid: DAN, bps: 3334 },
      ],
    },
    createdBy: AVA,
    deletedOnDay: null,
  },
  {
    id: `${PREFIX}_exp_kyoto_03`,
    groupId: `${PREFIX}_group_kyoto`,
    description: 'JR rail passes',
    amountMinor: 150000,
    category: 'transport',
    day: 4.25,
    paidBy: [{ uid: BEN, amountMinor: 150000 }],
    // AC-D2.6 — Dan already had a pass, so he holds ZERO shares and is still listed
    // as a participant. A zero weight has a zero remainder and can therefore never
    // pick up a leftover unit, which is the property that makes this safe.
    split: {
      method: 'shares',
      shares: [
        { uid: AVA, shares: 1 },
        { uid: BEN, shares: 1 },
        { uid: DAN, shares: 0 },
      ],
    },
    createdBy: BEN,
    deletedOnDay: null,
  },

  /* ── Berlin Weekend (EUR, exponent 2) ───────────────────────────────────────── */
  {
    id: `${PREFIX}_exp_berlin_01`,
    groupId: `${PREFIX}_group_berlin`,
    description: 'Apartment, three nights',
    amountMinor: 34500,
    category: 'accommodation',
    day: 4.5,
    paidBy: [{ uid: CLEO, amountMinor: 34500 }],
    split: { method: 'equal', uids: [AVA, CLEO, EVE] },
    createdBy: CLEO,
    deletedOnDay: null,
  },
  {
    id: `${PREFIX}_exp_berlin_02`,
    groupId: `${PREFIX}_group_berlin`,
    description: 'Club night and late dinner',
    // €89.05 at 50/25/25 lands on half- and quarter-cents in all three shares, so
    // the largest-remainder pass has real work to do.
    amountMinor: 8905,
    category: 'entertainment',
    day: 5.5,
    paidBy: [{ uid: EVE, amountMinor: 8905 }],
    split: {
      method: 'percent',
      percentages: [
        { uid: AVA, bps: 5000 },
        { uid: CLEO, bps: 2500 },
        { uid: EVE, bps: 2500 },
      ],
    },
    createdBy: EVE,
    deletedOnDay: null,
  },

  /* ── The implicit 1:1 group (USD) ───────────────────────────────────────────── */
  {
    id: `${PREFIX}_exp_pair_01`,
    groupId: `${PREFIX}_group_ava_ben`,
    description: 'Concert tickets',
    amountMinor: 17000,
    category: 'entertainment',
    day: 1.25,
    paidBy: [{ uid: AVA, amountMinor: 17000 }],
    split: { method: 'equal', uids: [AVA, BEN] },
    createdBy: AVA,
    deletedOnDay: null,
  },
] as const;

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Settlements — recorded offline payments. SplitSutra never moves money.
 * ────────────────────────────────────────────────────────────────────────────────────────── */

interface SettlementSpec {
  readonly id: string;
  readonly groupId: string;
  readonly fromUid: string;
  readonly toUid: string;
  readonly amountMinor: number;
  readonly note: string | null;
  readonly day: number;
}

const SETTLEMENTS: readonly SettlementSpec[] = [
  {
    id: `${PREFIX}_stl_flat_01`,
    groupId: `${PREFIX}_group_flat`,
    fromUid: CLEO,
    toUid: AVA,
    amountMinor: 5000,
    note: 'Sent over on Venmo',
    day: 4,
  },
  {
    id: `${PREFIX}_stl_kyoto_01`,
    groupId: `${PREFIX}_group_kyoto`,
    fromUid: AVA,
    toUid: DAN,
    amountMinor: 10000,
    // Exercises the nullable note, and a JPY amount: ¥10,000, not ¥100.00.
    note: null,
    day: 5,
  },
] as const;

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Comments — load-bearing under ADR-11
 * ────────────────────────────────────────────────────────────────────────────────────────── */

interface CommentSpec {
  readonly id: string;
  readonly groupId: string;
  readonly expenseId: string;
  readonly uid: string;
  readonly text: string;
  readonly day: number;
  readonly deletedOnDay: number | null;
}

/**
 * Only the expense's creator or a group admin may edit it (ADR-11 / T11), so this
 * thread is how everyone else raises "wasn't this $40?". The fixture therefore
 * stages exactly that: Cleo did not write the utilities expense and cannot correct
 * it, so she asks in the thread.
 */
const COMMENTS: readonly CommentSpec[] = [
  {
    id: `${PREFIX}_cmt_flat_02_01`,
    groupId: `${PREFIX}_group_flat`,
    expenseId: `${PREFIX}_exp_flat_02`,
    uid: CLEO,
    text: "Wasn't the internet only $65 this month? My share looks high.",
    day: 1.7,
    deletedOnDay: null,
  },
  {
    id: `${PREFIX}_cmt_flat_02_02`,
    groupId: `${PREFIX}_group_flat`,
    expenseId: `${PREFIX}_exp_flat_02`,
    uid: BEN,
    text: 'Electricity was up — the AC ran all month. Photo of the bill is in the chat.',
    day: 1.8,
    deletedOnDay: null,
  },
  {
    id: `${PREFIX}_cmt_flat_02_03`,
    groupId: `${PREFIX}_group_flat`,
    expenseId: `${PREFIX}_exp_flat_02`,
    uid: CLEO,
    text: 'Ah, ignore me — I was looking at July.',
    day: 1.9,
    // AC-D4.3: a user may delete their OWN comment. Nobody may ever edit one
    // (AC-D4.4, T12), which is why `commentSchema` has no `updatedAt` at all.
    deletedOnDay: 2.0,
  },
  {
    id: `${PREFIX}_cmt_kyoto_02_01`,
    groupId: `${PREFIX}_group_kyoto`,
    expenseId: `${PREFIX}_exp_kyoto_02`,
    uid: DAN,
    text: 'Worth every yen.',
    day: 3.4,
    deletedOnDay: null,
  },
] as const;

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Document builders
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Casts a validated model to the Admin SDK's write type.
 *
 * `DocumentData` is an index-signature type and the Zod-inferred models are not, so
 * the assignment needs an explicit widening. It is safe precisely because every
 * caller has already been through `parseDocument`.
 */
function asDocumentData(model: object): DocumentData {
  return model as DocumentData;
}

/** Resolves a split spec through core. Never computes a share locally — Article VI. */
function resolveSplits(spec: ExpenseSpec): SplitAllocation[] {
  // `toMinorUnits` throws on a non-integer rather than rounding, so a fixture typo
  // like `127.51` fails here with the offending value in the message.
  const totalMinor = toMinorUnits(spec.amountMinor);
  const split = spec.split;

  switch (split.method) {
    case 'equal':
      return computeSplits({
        method: 'equal',
        totalMinor,
        uids: split.uids,
        // The expense id IS the tie-break seed (doc 04 §2.1): the rotation that
        // decides who absorbs the extra minor unit is then reproducible from stored
        // data alone and stays stable across edits of the same expense.
        tieBreakSeed: spec.id,
      });
    case 'exact':
      return computeSplits({ method: 'exact', totalMinor, amounts: split.amounts });
    case 'percent':
      return computeSplits({
        method: 'percent',
        totalMinor,
        percentages: split.percentages,
        tieBreakSeed: spec.id,
      });
    case 'shares':
      return computeSplits({
        method: 'shares',
        totalMinor,
        shares: split.shares,
        tieBreakSeed: spec.id,
      });
  }
}

/**
 * Builds one `groups/{gid}/expenses/{eid}` document.
 *
 * 🔴 `splitsTotalMinor` and `paidTotalMinor` are added AFTER the schema parse, on
 *    purpose. `firestore.rules` requires both (Q1 Option A — rules have no
 *    `reduce()`, so the writer supplies redundant checksums and the rule asserts
 *    they equal `amountMinor`), and `firebase/functions` re-derives the real sums
 *    and quarantines the document when they disagree. But core's `expenseSchema`
 *    does not declare either field, and a Zod object strips what it does not
 *    declare — so parsing first and adding them second is the only order that keeps
 *    both the schema and the rules satisfied. See the report note: this is a real
 *    gap between core's model and the security rules, not a seed-script quirk.
 */
function buildExpense(spec: ExpenseSpec): { document: SeedDocument; splits: SplitAllocation[] } {
  const group = groupById(spec.groupId);
  const splits = resolveSplits(spec);
  const path = `groups/${spec.groupId}/expenses/${spec.id}`;

  // Comment counters. `types/expense.ts` says these are "maintained by
  // onCommentWritten" — a trigger that does not exist in firebase/functions/src.
  // The seed therefore derives them itself, counting only comments that are not
  // soft-deleted, so the number matches what a thread actually renders.
  const liveComments = COMMENTS.filter(
    (comment) => comment.expenseId === spec.id && comment.deletedOnDay === null,
  );
  const lastCommentDay = liveComments.reduce<number | null>(
    (latest, comment) => (latest === null || comment.day > latest ? comment.day : latest),
    null,
  );

  const expense = parseDocument(
    expenseSchema,
    {
      id: spec.id,
      groupId: spec.groupId,
      description: spec.description,
      amountMinor: spec.amountMinor,
      // Invariant 6: an expense's currency always equals its group's. Cross-document,
      // so neither the schema nor this file can prove it — it is taken from the group
      // rather than restated, which is the only way it cannot drift.
      currency: group.currency,
      category: spec.category,
      date: at(spec.day),
      paidBy: spec.paidBy.map((payer) => ({ uid: payer.uid, amountMinor: payer.amountMinor })),
      splitMethod: spec.split.method,
      splits: splits.map((split) => ({
        uid: split.uid,
        amountMinor: split.amountMinor,
        rawValue: split.rawValue,
      })),
      // Invariant 7 — denormalized, and derived from the same array it must match.
      participantIds: splits.map((split) => split.uid),
      createdBy: spec.createdBy,
      createdAt: at(spec.day),
      updatedBy: null,
      updatedAt: at(spec.deletedOnDay ?? spec.day),
      deletedAt: spec.deletedOnDay === null ? null : at(spec.deletedOnDay),
      commentCount: liveComments.length,
      lastCommentAt: lastCommentDay === null ? null : at(lastCommentDay),
      // v1 writes null for both; readers fall back to the group currency.
      fxRateToBase: null,
      amountInBaseMinor: null,
    },
    path,
  );

  const splitsTotalMinor = splits.reduce((sum, split) => sum + split.amountMinor, 0);
  const paidTotalMinor = spec.paidBy.reduce((sum, payer) => sum + payer.amountMinor, 0);

  return {
    document: {
      path,
      kind: 'expense',
      data: { ...asDocumentData(expense), splitsTotalMinor, paidTotalMinor },
    },
    splits,
  };
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * The activity feed
 * ────────────────────────────────────────────────────────────────────────────────────────── */

interface ActivitySpec {
  readonly groupId: string;
  readonly type: ActivityType;
  readonly actorUid: string;
  readonly targetId: string | null;
  readonly summary: string;
  readonly amountMinor: number | null;
  readonly day: number;
}

/**
 * ⚠️ These summary strings duplicate `summaries` in
 * `firebase/functions/src/lib/activity.ts`, and the duplication is forced rather
 * than chosen: that module imports the Admin SDK singleton and `firebase-functions`,
 * neither of which a seed script may load, and its compiled form under
 * `firebase/functions/lib/` is a build artefact this script must not depend on.
 *
 * This is prose, not money math, so Article VI is not in play — but the failure
 * mode is the same shape, so if the wording changes there, change it here too. The
 * right long-term home is a shared, dependency-free module.
 */
const summaries = {
  groupCreated: (actor: string, name: string): string => `${actor} created "${name}"`,
  memberJoined: (actor: string): string => `${actor} joined the group`,
  expenseCreated: (actor: string, description: string): string => `${actor} added "${description}"`,
  expenseDeleted: (actor: string, description: string): string =>
    `${actor} deleted "${description}"`,
  settlementCreated: (from: string, to: string): string => `${from} paid ${to}`,
} as const;

/**
 * Reconstructs the feed the triggers would have produced.
 *
 * 🔴 THE DOCUMENT IDS DIFFER FROM THE TRIGGERS' ON PURPOSE. `lib/activity.ts` keys
 *    a trigger-sourced entry off the CloudEvent id (`evt_<id>`), which is stable
 *    across redeliveries of one event but is unknowable ahead of time. A seed needs
 *    an id it can reproduce, so these are `seed_act_<group>_<nn>`. The consequence
 *    is worth stating plainly: if the **functions emulator is running** while this
 *    script writes, the triggers will fire and add their own `evt_*` entries
 *    alongside these, and the feed will show each event twice. Seed against
 *    `--only firestore,auth`.
 */
function buildActivity(): ActivitySpec[] {
  const entries: ActivitySpec[] = [];

  for (const group of GROUPS) {
    const [creator, ...joiners] = group.memberIds;
    if (creator === undefined) continue;

    entries.push({
      groupId: group.id,
      type: 'group.created',
      actorUid: creator,
      targetId: group.id,
      summary: summaries.groupCreated(displayNameOf(creator), group.name),
      amountMinor: null,
      day: group.createdOnDay,
    });

    joiners.forEach((member, index) => {
      entries.push({
        groupId: group.id,
        type: 'member.joined',
        actorUid: member,
        targetId: member,
        summary: summaries.memberJoined(displayNameOf(member)),
        amountMinor: null,
        // Fractions of a day, so joins order deterministically after the creation
        // and before the first expense.
        day: group.createdOnDay + 0.01 * (index + 1),
      });
    });
  }

  for (const expense of EXPENSES) {
    entries.push({
      groupId: expense.groupId,
      type: 'expense.created',
      actorUid: expense.createdBy,
      targetId: expense.id,
      summary: summaries.expenseCreated(displayNameOf(expense.createdBy), expense.description),
      amountMinor: expense.amountMinor,
      day: expense.day,
    });

    if (expense.deletedOnDay !== null) {
      entries.push({
        groupId: expense.groupId,
        type: 'expense.deleted',
        actorUid: expense.createdBy,
        targetId: expense.id,
        summary: summaries.expenseDeleted(displayNameOf(expense.createdBy), expense.description),
        amountMinor: expense.amountMinor,
        day: expense.deletedOnDay,
      });
    }
  }

  for (const settlement of SETTLEMENTS) {
    entries.push({
      groupId: settlement.groupId,
      type: 'settlement.created',
      actorUid: settlement.fromUid,
      targetId: settlement.id,
      summary: summaries.settlementCreated(
        displayNameOf(settlement.fromUid),
        displayNameOf(settlement.toUid),
      ),
      amountMinor: settlement.amountMinor,
      day: settlement.day,
    });
  }

  return entries.sort((a, b) => a.day - b.day || a.groupId.localeCompare(b.groupId));
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Friendships and the lookup index
 * ────────────────────────────────────────────────────────────────────────────────────────── */

interface FriendshipSpec {
  readonly a: string;
  readonly b: string;
  readonly implicitGroupId: string;
  readonly day: number;
}

const FRIENDSHIPS: readonly FriendshipSpec[] = [
  { a: AVA, b: BEN, implicitGroupId: `${PREFIX}_group_ava_ben`, day: 1 },
  { a: AVA, b: CLEO, implicitGroupId: `${PREFIX}_group_ava_cleo`, day: 5 },
] as const;

/**
 * 🔴 THE HASH HERE MUST AGREE BYTE FOR BYTE WITH
 *    `firebase/functions/src/lib/identity.ts` — `sha256_hex(lowercase(trim(email)))`.
 *
 * It is re-derived rather than imported for the same reason the activity summaries
 * are: that module pulls in the Admin SDK singleton. `identity.ts` already carries a
 * "CROSS-RUNTIME CONTRACT" warning because a *third* implementation lives in
 * `core/src/utils` for React Native. This is the fourth. If any of them disagrees by
 * a single character, every friend lookup silently returns "not found" with no error
 * anywhere — which is exactly the failure that warning describes.
 */
function usernameKey(normalizedIdentifier: string): string {
  return createHash('sha256').update(normalizedIdentifier, 'utf8').digest('hex');
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Display
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Minor units → a readable amount, through core's `formatMoney` and nothing else.
 *
 * 🔴 Article VI: one implementation of the money math, and formatting is part of it. This
 * function used to divide by an exponent scale itself — a second implementation, written
 * before `formatMoney` moved down into core, and the first thing a second implementation
 * produces is a summary that disagrees with what the app renders for the same document.
 *
 * Core's formatter is also the one that gets JPY right: the exponent comes from a hardcoded
 * ISO 4217 table, never from `Intl`, because a trimmed Hermes ICU build reports the wrong
 * one and every amount is then wrong by 100× in both directions with no error anywhere. At
 * exponent 0 the integer already is the amount — `¥58,000`, never `¥580.00`, which is the
 * whole point of seeding a JPY group.
 */
export function formatMinor(amountMinor: number, currency: CurrencyCode): string {
  // `number`, not `MinorUnits`, because that is what `computeBalances` returns: `BalanceMap`
  // is deliberately unbranded so callers can write `balances[uid] ?? 0` (domain/balances.ts).
  // `toMinorUnits` is therefore doing real work here rather than satisfying the compiler — it
  // throws on anything that is not a whole minor-unit amount in range, which is the assertion
  // you want between a folded ledger and a printed number (Article I).
  return formatMoney(toMinorUnits(amountMinor), currency);
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Assembly
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Builds and validates the entire fixture.
 *
 * Throws `DocumentParseError` (from core) on a malformed document and `DomainError`
 * on impossible money — a split that does not sum to its total, balances that do
 * not sum to zero. Both are bugs in this file, and both are meant to stop the run
 * before a single write is attempted.
 */
export function buildDataset(): SeedDataset {
  const documents: SeedDocument[] = [];

  /* ── users/{uid} and the usernames/ lookup index ─────────────────────────────── */
  for (const user of USERS) {
    documents.push({
      path: `users/${user.uid}`,
      kind: 'user',
      data: asDocumentData(
        parseDocument(
          userSchema,
          {
            uid: user.uid,
            displayName: user.displayName,
            email: user.email,
            phoneNumber: user.phoneNumber,
            photoURL: null,
            defaultCurrency: user.defaultCurrency,
            createdAt: at(-1),
            updatedAt: at(-1),
            deletedAt: null,
          },
          `users/${user.uid}`,
        ),
      ),
    });

    // The public projection. It is readable by any signed-in user who can guess the
    // hash of a contact detail, so it must never carry more than these three fields.
    const projection = {
      uid: user.uid,
      displayName: user.displayName,
      photoURL: null,
    };
    const identifiers = [user.email.trim().toLowerCase()];
    if (user.phoneNumber !== null) identifiers.push(user.phoneNumber);

    for (const identifier of identifiers) {
      const key = usernameKey(identifier);
      documents.push({
        path: `usernames/${key}`,
        kind: 'username',
        data: asDocumentData(parseDocument(usernameIndexSchema, projection, `usernames/${key}`)),
      });
    }
  }

  /* ── users/{uid}/friends/{friendUid} — always reciprocal ─────────────────────── */
  for (const friendship of FRIENDSHIPS) {
    for (const [self, other] of [
      [friendship.a, friendship.b],
      [friendship.b, friendship.a],
    ] as const) {
      const path = `users/${self}/friends/${other}`;
      documents.push({
        path,
        kind: 'friend',
        data: asDocumentData(
          parseDocument(
            friendSchema,
            {
              friendUid: other,
              displayName: displayNameOf(other),
              photoURL: null,
              implicitGroupId: friendship.implicitGroupId,
              /**
               * 🔴 EMPTY, NOT FABRICATED — and this is the honest answer, not a
               * shortcut.
               *
               * The field is documented as "net balance across ALL shared groups,
               * keyed by currency". Nothing in this repository computes that:
               * `addFriend` writes `{}` and no trigger ever updates it. Worse, the
               * quantity is not well defined — a group of three has no pairwise
               * debts at all (that is precisely what `simplifyDebts` exists to
               * invent, as a display-only heuristic), so "what Ben owes Ava" inside
               * Apartment 4B has no single answer to store.
               *
               * Deriving something plausible here would be a second implementation
               * of the money math (Article VI) producing numbers the real app can
               * never reproduce — the worst possible thing to hand someone building
               * a screen. `{}` is what production actually contains today, so it is
               * what a screen must render correctly.
               */
              balanceMinor: {},
              updatedAt: at(friendship.day),
            },
            path,
          ),
        ),
      });
    }
  }

  /* ── expenses, grouped so balances can be folded per group ───────────────────── */
  const expensesByGroup = new Map<string, ReturnType<typeof buildExpense>[]>();
  for (const spec of EXPENSES) {
    const built = buildExpense(spec);
    documents.push(built.document);
    const bucket = expensesByGroup.get(spec.groupId) ?? [];
    bucket.push(built);
    expensesByGroup.set(spec.groupId, bucket);
  }

  /* ── comments ────────────────────────────────────────────────────────────────── */
  for (const comment of COMMENTS) {
    const path = `groups/${comment.groupId}/expenses/${comment.expenseId}/comments/${comment.id}`;
    documents.push({
      path,
      kind: 'comment',
      data: asDocumentData(
        parseDocument(
          commentSchema,
          {
            id: comment.id,
            uid: comment.uid,
            displayName: displayNameOf(comment.uid),
            photoURL: null,
            text: comment.text,
            createdAt: at(comment.day),
            deletedAt: comment.deletedOnDay === null ? null : at(comment.deletedOnDay),
          },
          path,
        ),
      ),
    });
  }

  /* ── settlements ─────────────────────────────────────────────────────────────── */
  for (const settlement of SETTLEMENTS) {
    const group = groupById(settlement.groupId);
    const path = `groups/${settlement.groupId}/settlements/${settlement.id}`;
    documents.push({
      path,
      kind: 'settlement',
      data: asDocumentData(
        parseDocument(
          settlementSchema,
          {
            id: settlement.id,
            groupId: settlement.groupId,
            fromUid: settlement.fromUid,
            toUid: settlement.toUid,
            amountMinor: settlement.amountMinor,
            currency: group.currency,
            date: at(settlement.day),
            note: settlement.note,
            createdBy: settlement.fromUid,
            createdAt: at(settlement.day),
            deletedAt: null,
          },
          path,
        ),
      ),
    });
  }

  /* ── the activity feed ───────────────────────────────────────────────────────── */
  const activityCounters = new Map<string, number>();
  const lastActivityDay = new Map<string, number>();

  for (const entry of buildActivity()) {
    const group = groupById(entry.groupId);
    const sequence = (activityCounters.get(entry.groupId) ?? 0) + 1;
    activityCounters.set(entry.groupId, sequence);
    lastActivityDay.set(
      entry.groupId,
      Math.max(lastActivityDay.get(entry.groupId) ?? 0, entry.day),
    );

    // `seed_group_flat` → `seed_act_flat_01`. Short, ordered, and greppable next to
    // the trigger-written `evt_*` ids it deliberately does not imitate.
    const shortGroup = entry.groupId.replace(`${PREFIX}_group_`, '');
    const id = `${PREFIX}_act_${shortGroup}_${String(sequence).padStart(2, '0')}`;
    const path = `groups/${entry.groupId}/activity/${id}`;

    documents.push({
      path,
      kind: 'activity',
      data: asDocumentData(
        parseDocument(
          activitySchema,
          {
            id,
            type: entry.type,
            actorUid: entry.actorUid,
            actorName: displayNameOf(entry.actorUid),
            targetId: entry.targetId,
            summary: entry.summary,
            amountMinor: entry.amountMinor,
            // An amount without its currency cannot be rendered, and `activitySchema`
            // refuses the combination — the two always travel together (D6).
            currency: entry.amountMinor === null ? null : group.currency,
            createdAt: at(entry.day),
          },
          path,
        ),
      ),
    });
  }

  /* ── groups, members, and the balances derived from the ledger ───────────────── */
  const groupSummaries: SeededGroupSummary[] = [];

  for (const group of GROUPS) {
    const built = expensesByGroup.get(group.id) ?? [];
    const settlements = SETTLEMENTS.filter((settlement) => settlement.groupId === group.id);

    /**
     * 🔴 THE ONE PLACE BALANCES COME FROM.
     *
     * Article V: the ledger is the truth and `members/{uid}.balanceMinor` is a
     * cache of it. The seed writes that cache itself, using the SAME pure fold the
     * Cloud Function calls inside its transaction — so if the functions emulator
     * is also running, `recomputeBalances` converges on exactly these numbers
     * instead of correcting them.
     *
     * Soft-deleted documents are passed in rather than filtered out: `isDeleted`
     * inside `computeBalances` is what must skip them, and handing it the deleted
     * pizza expense is how this fixture proves that it does.
     */
    const balances = computeBalances({
      expenses: built.map((entry) => ({
        paidBy: entry.document.data['paidBy'] as { uid: string; amountMinor: number }[],
        splits: entry.splits.map((split) => ({
          uid: split.uid,
          amountMinor: split.amountMinor,
        })),
        deletedAt: entry.document.data['deletedAt'],
      })),
      settlements: settlements.map((settlement) => ({
        fromUid: settlement.fromUid,
        toUid: settlement.toUid,
        amountMinor: settlement.amountMinor,
        deletedAt: null,
      })),
      memberIds: [...group.memberIds],
    });

    // AC-E1.3 — across all member documents in a group, sum(balanceMinor) === 0,
    // exactly. Failing here beats writing a group that can never settle up.
    assertZeroSum(balances);

    const lastDay = lastActivityDay.get(group.id) ?? group.createdOnDay;

    documents.push({
      path: `groups/${group.id}`,
      kind: 'group',
      data: asDocumentData(
        parseDocument(
          groupSchema,
          {
            id: group.id,
            name: group.name,
            type: group.type,
            isImplicit: group.isImplicit,
            photoURL: null,
            currency: group.currency,
            memberIds: [...group.memberIds],
            memberCount: group.memberIds.length,
            simplifyDebts: group.simplifyDebts,
            createdBy: group.memberIds[0],
            createdAt: at(group.createdOnDay),
            updatedAt: at(lastDay),
            // Drives the group-list sort order, so it tracks the newest feed entry.
            lastActivityAt: at(lastDay),
            deletedAt: null,
            baseCurrency: null,
            allowMixedCurrency: null,
          },
          `groups/${group.id}`,
        ),
      ),
    });

    const memberBalances: { displayName: string; formatted: string }[] = [];

    group.memberIds.forEach((memberUid, index) => {
      const path = `groups/${group.id}/members/${memberUid}`;
      const balanceMinor = balances[memberUid] ?? 0;

      documents.push({
        path,
        kind: 'member',
        data: asDocumentData(
          parseDocument(
            groupMemberSchema,
            {
              uid: memberUid,
              // The creator is the admin; everyone else joined afterwards.
              role: index === 0 ? 'admin' : 'member',
              displayName: displayNameOf(memberUid),
              photoURL: null,
              balanceMinor,
              joinedAt: at(group.createdOnDay + 0.01 * index),
              leftAt: null,
            },
            path,
          ),
        ),
      });

      memberBalances.push({
        displayName: displayNameOf(memberUid),
        formatted: formatMinor(balanceMinor, group.currency),
      });
    });

    groupSummaries.push({
      id: group.id,
      name: group.name,
      type: group.type,
      currency: group.currency,
      isImplicit: group.isImplicit,
      expenseCount: built.length,
      settlementCount: settlements.length,
      balances: memberBalances,
    });
  }

  /* ── one pending invite, so the join screen has something to redeem ──────────── */
  const inviteId = `${PREFIX}_invite_flat`;
  const invitePath = `invites/${inviteId}`;
  documents.push({
    path: invitePath,
    kind: 'invite',
    data: asDocumentData(
      parseDocument(
        inviteSchema,
        {
          id: inviteId,
          // 128 bits of lowercase hex, as the schema's regex requires. Fixed rather
          // than random: an invite whose token changed on every seed run could not be
          // pasted into a test or a bookmark.
          token: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
          groupId: `${PREFIX}_group_flat`,
          groupName: 'Apartment 4B',
          createdBy: AVA,
          createdByName: displayNameOf(AVA),
          status: 'pending',
          acceptedBy: null,
          createdAt: at(6),
          // createdAt + INVITE_TTL_DAYS (14).
          expiresAt: at(20),
        },
        invitePath,
      ),
    ),
  });

  return { users: USERS, documents, groups: groupSummaries };
}
