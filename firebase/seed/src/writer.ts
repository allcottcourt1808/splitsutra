/**
 * ============================================================================
 * THE WRITER — the only module here that opens a connection
 * ============================================================================
 *
 * `firebase/seed.ts` imports this **after** the guard has resolved and approved the
 * target, never before. That import order is the whole reason `guard.ts` is free of
 * side effects: a refusal must happen before any credential is loaded or any socket
 * is opened, and the surest way to guarantee that is for the code that opens
 * sockets to not have been loaded yet.
 *
 * Everything written here is already validated. `dataset.ts` parses each document
 * through the Zod schema that owns its collection before this module sees it, so
 * this file is concerned only with *how* the writes happen: idempotently, in
 * batches, and with the derived state that the Cloud Functions would otherwise
 * produce.
 *
 * ----------------------------------------------------------------------------
 * DOES THIS NEED THE FUNCTIONS EMULATOR? NO — AND IT SHOULD NOT BE RUNNING.
 * ----------------------------------------------------------------------------
 * The seed writes every piece of derived state itself:
 *
 *   - `groups/{gid}/members/{uid}.balanceMinor`, folded from the ledger with core's
 *     `computeBalances` and checked with `assertZeroSum` — the same functions
 *     `firebase/functions/src/common/balances.ts` calls inside its transaction, so
 *     a later `recomputeBalances` converges on these exact numbers rather than
 *     correcting them (ADR-07: a full recompute is idempotent by construction).
 *   - `groups/{gid}/activity/*`, which is otherwise Function-written (T8).
 *   - `groups/{gid}.lastActivityAt` / `updatedAt`, which drive the group-list sort.
 *   - `usernames/*`, otherwise built by `onUserProfileWritten`.
 *   - the expense comment counters, which `types/expense.ts` attributes to an
 *     `onCommentWritten` trigger that does not exist in this repository.
 *
 * 🔴 Running the functions emulator during a seed makes the result WORSE, not
 *    better. `onExpenseWritten` and friends would fire on every document this
 *    script writes and append their own activity entries under CloudEvent-derived
 *    ids (`evt_*`) that this script cannot predict and therefore cannot overwrite
 *    on a second run — so the feed would both double up and stop being idempotent.
 *    Seed with `--only firestore,auth`.
 */

import { initAdmin, shutdownAdmin, type Auth } from './admin.js';
import {
  buildDataset,
  type SeedDataset,
  type SeedDocumentKind,
  type SeededGroupSummary,
  type SeededUser,
} from './dataset.js';
import { type SeedTarget } from './guard.js';

/**
 * Firestore caps a batch at 500 operations. 400 leaves room for the fixture to grow
 * without anyone having to remember why the number matters.
 */
const BATCH_SIZE = 400;

/** Every collection the seed touches, in the order the summary lists them. */
const KIND_ORDER: readonly SeedDocumentKind[] = [
  'user',
  'username',
  'friend',
  'group',
  'member',
  'expense',
  'comment',
  'settlement',
  'activity',
  'invite',
];

const KIND_LABELS: Readonly<Record<SeedDocumentKind, string>> = {
  user: 'users/{uid}',
  username: 'usernames/{key}',
  friend: 'users/{uid}/friends/{uid}',
  group: 'groups/{gid}',
  member: 'groups/{gid}/members/{uid}',
  expense: 'groups/{gid}/expenses/{eid}',
  comment: '…/expenses/{eid}/comments/{cid}',
  settlement: 'groups/{gid}/settlements/{sid}',
  activity: 'groups/{gid}/activity/{aid}',
  invite: 'invites/{iid}',
};

export interface AuthReport {
  readonly created: number;
  readonly updated: number;
  /** Set when a forced real-project run declined to create accounts. See {@link seedAuthUsers}. */
  readonly skippedReason: string | null;
}

export interface SeedReport {
  readonly documentsWritten: number;
  readonly byKind: ReadonlyMap<SeedDocumentKind, number>;
  readonly auth: AuthReport;
  readonly users: readonly SeededUser[];
  readonly groups: readonly SeededGroupSummary[];
}

/**
 * Creates or refreshes the seeded Auth accounts.
 *
 * Idempotent by uid: `getUser` first, then `updateUser` or `createUser`. A blind
 * `createUser` throws `auth/uid-already-exists` on the second run, which would make
 * `pnpm seed` fail exactly once — after the first run — which is the most confusing
 * possible time for it to fail.
 *
 * 🔴 SKIPPED ENTIRELY ON A FORCED REAL PROJECT, and this is not an oversight.
 *    Every seeded account shares one fixed password that this script then prints to
 *    the terminal. On a `demo-*` project that is harmless: the Auth emulator is a
 *    local process holding throwaway state that vanishes when it stops. On a
 *    deployed project — which is what `--allow-real-project` unlocks — it is five
 *    live accounts with a published password, reachable by anyone, sitting in the
 *    same user pool as real people. The Firestore fixture still lands; only the
 *    credentials are withheld, and the summary says so.
 */
async function seedAuthUsers(
  auth: Auth,
  users: readonly SeededUser[],
  target: SeedTarget,
): Promise<AuthReport> {
  if (target.realProject) {
    return {
      created: 0,
      updated: 0,
      skippedReason:
        'target is a real project — seeded accounts share one printed password and ' +
        'must not exist in a reachable user pool',
    };
  }

  let created = 0;
  let updated = 0;

  for (const user of users) {
    // `phoneNumber` is built conditionally rather than passed as `undefined`:
    // `exactOptionalPropertyTypes` makes those two different things, and the Auth
    // emulator rejects an explicit `undefined` phone number.
    const properties: {
      email: string;
      emailVerified: boolean;
      password: string;
      displayName: string;
      phoneNumber?: string;
    } = {
      email: user.email,
      emailVerified: true,
      password: user.password,
      displayName: user.displayName,
    };
    if (user.phoneNumber !== null) properties.phoneNumber = user.phoneNumber;

    let exists = true;
    try {
      await auth.getUser(user.uid);
    } catch {
      // The Admin SDK signals a missing user with `auth/user-not-found`. Any other
      // failure re-surfaces from the create/update call below with a better message
      // than a re-thrown lookup error would carry.
      exists = false;
    }

    if (exists) {
      await auth.updateUser(user.uid, properties);
      updated += 1;
    } else {
      await auth.createUser({ uid: user.uid, ...properties });
      created += 1;
    }
  }

  return { created, updated, skippedReason: null };
}

/**
 * Writes the whole fixture.
 *
 * `set()` without `merge`, on deterministic ids: re-running replaces each document
 * rather than appending a second one, and a field removed from the fixture actually
 * disappears instead of lingering from an earlier run. That combination is what
 * "running `pnpm seed` twice must not double the data" actually requires — merge
 * semantics would leave stale fields behind and look idempotent while not being it.
 */
export async function runSeed(target: SeedTarget): Promise<SeedReport> {
  // Built and validated BEFORE the SDK is initialised, so a broken fixture fails
  // without ever having opened a connection.
  const dataset: SeedDataset = buildDataset();

  const { db, auth } = initAdmin(target.projectId);

  const authReport = await seedAuthUsers(auth, dataset.users, target);

  const byKind = new Map<SeedDocumentKind, number>();
  let batch = db.batch();
  let pending = 0;

  for (const document of dataset.documents) {
    batch.set(db.doc(document.path), document.data);
    byKind.set(document.kind, (byKind.get(document.kind) ?? 0) + 1);
    pending += 1;

    if (pending === BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  return {
    documentsWritten: dataset.documents.length,
    byKind,
    auth: authReport,
    users: dataset.users,
    groups: dataset.groups,
  };
}

/** Releases the SDK's handles so the process exits instead of hanging on gRPC. */
export async function closeSeed(): Promise<void> {
  await shutdownAdmin();
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * The summary
 * ────────────────────────────────────────────────────────────────────────────────────────── */

const pad = (value: string, width: number): string => value.padEnd(width, ' ');

/**
 * The report an operator reads instead of opening the emulator UI.
 *
 * It names the project and the emulator hosts a second time — after the writes
 * rather than before — because "where did that data actually go?" is the question
 * a seed script most often leaves unanswered.
 */
export function formatSummary(target: SeedTarget, report: SeedReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('  ╔════════════════════════════════════════════════════════════════════════════╗');
  lines.push('  ║  ✅ SEED COMPLETE                                                          ║');
  lines.push('  ╚════════════════════════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`  Project        : ${target.projectId}`);
  lines.push(`  Resolved from  : ${target.projectSource}`);
  for (const host of target.emulatorHosts) {
    lines.push(`  ${pad(host.variable, 15)}: ${host.value}  (${host.origin})`);
  }
  if (target.emulatorHosts.length === 0) {
    lines.push('  Emulator hosts : none set — this run talked to the deployed project');
  }

  lines.push('');
  lines.push(`  Wrote ${String(report.documentsWritten)} documents.`);
  lines.push('');
  for (const kind of KIND_ORDER) {
    const count = report.byKind.get(kind);
    if (count === undefined) continue;
    lines.push(`    ${pad(String(count), 4)} ${KIND_LABELS[kind]}`);
  }

  lines.push('');
  lines.push('  Groups');
  for (const group of report.groups) {
    // Annotated: inference narrows this to GroupType | CurrencyCode from the two seed
    // values, and the note pushed below is neither of those — it is display text.
    const tags: string[] = [group.type, group.currency];
    if (group.isImplicit) tags.push('implicit 1:1 — hidden from the group list');
    lines.push('');
    lines.push(`    ${group.name}  [${tags.join(' · ')}]`);
    lines.push(
      `      ${String(group.expenseCount)} expense(s), ` +
        `${String(group.settlementCount)} settlement(s)`,
    );
    for (const balance of group.balances) {
      // Positive means this person is OWED money; negative means they owe it.
      lines.push(`      ${pad(balance.displayName, 16)} ${balance.formatted}`);
    }
  }

  lines.push('');
  if (report.auth.skippedReason === null) {
    lines.push(
      `  Sign-in — EMULATOR ONLY (${String(report.auth.created)} created, ` +
        `${String(report.auth.updated)} refreshed)`,
    );
    lines.push('  These accounts exist only in the local Auth emulator and vanish with it.');
    lines.push('');
    for (const user of report.users) {
      const phone = user.phoneNumber === null ? '' : `   ${user.phoneNumber}`;
      lines.push(
        `    ${pad(user.email, 30)} ${pad(user.password, 15)} ${user.displayName}${phone}`,
      );
    }
  } else {
    lines.push('  Sign-in — NO AUTH ACCOUNTS WERE CREATED');
    lines.push(`  ${report.auth.skippedReason}.`);
    lines.push('  Create accounts for these uids yourself if you need to sign in:');
    lines.push('');
    for (const user of report.users) {
      lines.push(`    ${pad(user.uid, 16)} ${user.displayName}`);
    }
  }

  lines.push('');
  lines.push('  Derived state (member balances, activity feed, comment counters, the');
  lines.push('  usernames index) was written by this script. The functions emulator is');
  lines.push('  NOT required — and should NOT be running, or its triggers will append a');
  lines.push('  second, non-reproducible copy of the activity feed.');
  lines.push('');
  lines.push('  Emulator UI (start the suite with --ui):  http://127.0.0.1:4000/firestore');
  lines.push('');

  return lines.join('\n');
}
