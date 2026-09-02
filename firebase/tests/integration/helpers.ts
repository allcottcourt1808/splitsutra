// Shared harness for the integration suite — the round-trip tests that exercise REAL Cloud
// Functions against a REAL Firestore emulator.
//
// ── How this differs from tests/rules ────────────────────────────────────────────────────────
// The rules suite asks one question: does `firestore.rules` allow this write? It runs entirely
// inside `@firebase/rules-unit-testing`, no Functions, no Auth.
//
// This suite asks the question rules cannot answer: **what does the server do afterwards.**
// `balanceMinor` is `allow write: if false` for every client (Article III), so the only way to
// observe the balance pipeline at all is to write a ledger document and wait for
// `onExpenseWritten` to land. That needs the real client SDK, real ID tokens from the Auth
// emulator, and the Functions emulator — which is why the `test:integration` script boots
// `--only firestore,auth,functions` while `test:rules` boots `--only firestore`.
//
// Deliberately NOT duplicated here: allow/deny assertions. Every one of those belongs in
// tests/rules, which is faster and does not need three emulators. The two exceptions below are
// there because they are *pipeline* claims rather than rule claims — that a denied client write
// leaves the Function-written value untouched, and that `invites/{id}` is unreachable even to
// somebody holding a real invite id handed back by `createInvite`.
//
// ── Conventions borrowed from tests/rules/helpers.ts ─────────────────────────────────────────
// Same shape: a `createTestEnv()` that reads the real `firestore.rules`, uid constants, and
// builder functions that return a document which PASSES its rule, so a test overrides only the
// field it is exercising.
//
// ── 🔴 Traps this file exists to route around ────────────────────────────────────────────────
//   * Hosts are `127.0.0.1`, NEVER `localhost`. Node resolves `localhost` to `::1` first and the
//     emulators bind IPv4 only — the failure is a 30s timeout with no error text.
//   * The project id must be `demo-` prefixed (and must match `--project` in the test script).
//     The prefix forces every SDK offline, so a misconfigured test physically cannot reach a
//     real project.
//   * `rules` and `integration` share one emulator and both run with `fileParallelism: false`.
//     A parallel `clearFirestore()` wipes another file's fixtures.
//   * Auth users are NOT cleared between tests — only Firestore is. Every actor therefore takes a
//     file-unique email, and `signIn` tolerates an account that already exists.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  Timestamp,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  collection,
  getFirestore,
  serverTimestamp,
  setDoc,
  terminate,
  type FieldValue,
  type Firestore,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from 'firebase/functions';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Emulator wiring
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** Must match `--project` in the `test:integration` script. `demo-` forces the SDKs offline. */
export const PROJECT_ID = 'demo-integration';

/** 🔴 Never `localhost` — see the header. Ports mirror `firebase.json` → `emulators`. */
export const EMULATOR_HOST = '127.0.0.1';
export const FIRESTORE_PORT = 8080;
export const AUTH_PORT = 9099;
export const FUNCTIONS_PORT = 5001;

/** `firebase/functions/src/common/config.ts` → REGION. A mismatch here is a 404 on every call. */
export const REGION = 'us-central1';

/** The Auth emulator accepts any key; the SDK only needs one to build a request URL. */
const FAKE_API_KEY = 'demo-integration-api-key';

/** Emulator accounts are not secrets — this exists because the API requires a password. */
const PASSWORD = 'integration-suite-password';

const RULES_PATH = fileURLToPath(new URL('../../../firestore.rules', import.meta.url));

export const GROUP_CURRENCY = 'USD';

/**
 * The privileged context, used exactly as `tests/rules/helpers.ts` uses it: to set up or inspect
 * state a client is not allowed to touch. Loading the real `firestore.rules` also means the
 * client paths below are judged by the same ruleset the rules suite tests.
 */
let sharedEnv: RulesTestEnvironment | null = null;

export async function createTestEnv(): Promise<RulesTestEnvironment> {
  sharedEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host: EMULATOR_HOST,
      port: FIRESTORE_PORT,
    },
  });
  return sharedEnv;
}

function requireEnv(): RulesTestEnvironment {
  if (sharedEnv === null) {
    throw new Error('createTestEnv() must be awaited in beforeAll before using this helper.');
  }
  return sharedEnv;
}

/** Seed or inspect with rules off. Same helper, same reasoning, as the rules suite. */
export async function withAdmin(
  env: RulesTestEnvironment,
  fn: (ctx: RulesTestContext) => Promise<unknown>,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx);
  });
}

/**
 * Reads a document with rules off — the read a *wait* uses.
 *
 * 🔴 WHY WAITS DO NOT POLL THROUGH A CLIENT. "Has the trigger landed yet?" is usually a question
 * about a document the client cannot read until it HAS landed: `isMember()` is `exists()` on
 * `groups/{gid}/members/{uid}`, so polling for the creator's own member document means a burst
 * of `permission-denied` reads on the client's single gRPC channel. The Web SDK treats those as
 * permanent stream errors and backs off exponentially — so the poll that eventually succeeds is
 * sitting in a 20–60s retry delay by the time the document appears, and the test times out on a
 * trigger that actually finished in under two seconds. It cost an afternoon; do not "simplify"
 * a wait back onto an authenticated read.
 *
 * Assertions still read as the client. This is for setup and for waiting only.
 */
export async function serverDoc(path: string): Promise<Record<string, unknown> | null> {
  let data: Record<string, unknown> | null = null;
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), path));
    data = snap.exists() ? snap.data() : null;
  });
  return data;
}

/** Every member's `balanceMinor` read with rules off — the shape a wait polls. */
export async function serverBalances(gid: string): Promise<Record<string, number>> {
  const balances: Record<string, number> = {};
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDocs(collection(ctx.firestore(), `groups/${gid}/members`));
    for (const member of snap.docs) {
      balances[member.id] = (member.data() as { balanceMinor: number }).balanceMinor;
    }
  });
  return balances;
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Actors — a signed-in client with its own Firebase app
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * One signed-in user, holding its own `FirebaseApp`.
 *
 * A separate app per actor rather than one app that signs in and out: `getFirestore(app)` and
 * `httpsCallable` both read whoever is currently signed in on that app, so a shared app makes
 * "Alice creates, Bob redeems" a race rather than a sequence.
 */
export interface Actor {
  readonly uid: string;
  readonly email: string;
  readonly displayName: string;
  readonly db: Firestore;
  /** Invoke a callable Cloud Function as this user. Rejects with a `FunctionsError`. */
  call<Res = unknown>(name: string, data?: unknown): Promise<Res>;
  dispose(): Promise<void>;
}

let appSeq = 0;

interface Wired {
  app: FirebaseApp;
  db: Firestore;
  functions: Functions;
}

function wire(): Wired {
  appSeq += 1;
  const app = initializeApp(
    { projectId: PROJECT_ID, apiKey: FAKE_API_KEY },
    `integration-${String(appSeq)}`,
  );
  const db = getFirestore(app);
  connectFirestoreEmulator(db, EMULATOR_HOST, FIRESTORE_PORT);
  const functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, EMULATOR_HOST, FUNCTIONS_PORT);
  return { app, db, functions };
}

async function dispose(app: FirebaseApp, db: Firestore): Promise<void> {
  // `terminate` first: deleting an app with a live gRPC channel leaves vitest hanging on an
  // open handle rather than failing, which reads as a slow suite instead of a leak.
  await terminate(db);
  await deleteApp(app);
}

function callable(functions: Functions) {
  return async <Res>(name: string, data?: unknown): Promise<Res> => {
    const result = await httpsCallable<unknown, Res>(functions, name)(data);
    return result.data;
  };
}

/**
 * Signs in (creating the account on first use) and returns an actor.
 *
 * `email` doubles as the account identifier and as the value `sendFriendRequest` resolves
 * through the hashed `usernames/` index, so it must be a real address shape.
 */
export async function signIn(email: string, displayName: string): Promise<Actor> {
  const { app, db, functions } = wire();
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${String(AUTH_PORT)}`, {
    disableWarnings: true,
  });

  // Firestore is cleared between tests; the Auth emulator is not. Whether this run is the first
  // to claim the address is not something a test should have to know.
  let uid: string;
  try {
    const created = await createUserWithEmailAndPassword(auth, email, PASSWORD);
    uid = created.user.uid;
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/email-already-in-use') throw error;
    const signedIn = await signInWithEmailAndPassword(auth, email, PASSWORD);
    uid = signedIn.user.uid;
  }

  return {
    uid,
    email,
    displayName,
    db,
    call: callable(functions),
    dispose: () => dispose(app, db),
  };
}

/** A client with no ID token at all — for the `unauthenticated` half of a callable's preamble. */
export interface AnonymousActor {
  readonly db: Firestore;
  call<Res = unknown>(name: string, data?: unknown): Promise<Res>;
  dispose(): Promise<void>;
}

export function signedOut(): AnonymousActor {
  const { app, db, functions } = wire();
  return { db, call: callable(functions), dispose: () => dispose(app, db) };
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Waiting for a trigger
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Polls until `ready` holds, or fails with the last value seen.
 *
 * A trigger round-trip is asynchronous and has no completion signal a client can await, so
 * every assertion about a Function's output has to be a poll. The failure message carries the
 * last observed value because "timed out" alone cannot distinguish "the trigger never fired"
 * from "it fired and computed the wrong number".
 */
export async function waitFor<T>(
  label: string,
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await read();
  while (!ready(last)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${String(timeoutMs)}ms waiting for ${label}. ` +
          `Last value: ${JSON.stringify(last)}`,
      );
    }
    await sleep(200);
    last = await read();
  }
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A negative wait: proves a value is still what it was after the pipeline has had time to run.
 *
 * `waitFor` cannot express "nothing happened" — it returns immediately on the first read. Used
 * for the claims that matter most here: a denied client write did not move the balance, and a
 * quarantined expense did not enter the money.
 */
export async function staysAt<T>(
  label: string,
  read: () => Promise<T>,
  expected: T,
  forMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + forMs;
  while (Date.now() < deadline) {
    const actual = await read();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `${label} changed to ${JSON.stringify(actual)}; expected it to stay ` +
          `${JSON.stringify(expected)}`,
      );
    }
    await sleep(200);
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Failure assertions
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Awaits a rejection and returns its code, so a test asserts the exact status rather than "it
 * threw". A callable that fails for the wrong reason is a passing test that proves nothing.
 *
 * Codes come back from the SDK prefixed: `permission-denied` reaches the client as
 * `functions/permission-denied`.
 */
export async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : String(error);
  }
  throw new Error('Expected a rejection, but the call resolved.');
}

/** True when a Firestore write was refused by `firestore.rules`. */
export async function isPermissionDenied(promise: Promise<unknown>): Promise<boolean> {
  const code = await rejectionCode(promise);
  return code === 'permission-denied';
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Document builders — each returns a document that PASSES its rule
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** Client-chosen `date` fields are not pinned to `request.time`, unlike `createdAt`. */
export const PAST = Timestamp.fromDate(new Date('2026-01-15T12:00:00Z'));

export function userDoc(actor: Actor, overrides: Record<string, unknown> = {}) {
  return {
    uid: actor.uid,
    displayName: actor.displayName,
    // Pinned to the Auth record on purpose. `firestore.rules` compares it to the ID token
    // (layer 1) and `onUserProfileWritten` re-checks it against the Auth user before indexing
    // (layer 2) — claiming an address you do not hold is indexed by neither.
    email: actor.email,
    defaultCurrency: GROUP_CURRENCY,
    photoURL: null,
    createdAt: serverTimestamp() as FieldValue,
    ...overrides,
  };
}

export function groupDoc(creator: Actor, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Lisbon trip',
    type: 'trip',
    isImplicit: false,
    currency: GROUP_CURRENCY,
    createdBy: creator.uid,
    // Rules pin this to `request.time`; a literal is refused.
    createdAt: serverTimestamp() as FieldValue,
    memberIds: [creator.uid],
    memberCount: 1,
    lastActivityAt: serverTimestamp() as FieldValue,
    deletedAt: null,
    ...overrides,
  };
}

export interface Share {
  uid: string;
  amountMinor: number;
}

/**
 * An expense whose checksums agree with its arrays.
 *
 * `splitsTotalMinor` / `paidTotalMinor` are Q1 Option A: rules have no `reduce()`, so the client
 * supplies them and the rule asserts they equal `amountMinor`. `onExpenseWritten` recomputes the
 * REAL sums — which is why a test that forges an expense overrides the arrays and leaves these
 * alone.
 */
export function expenseDoc(
  gid: string,
  creator: Actor,
  splits: Share[],
  paidBy: Share[],
  overrides: Record<string, unknown> = {},
) {
  const amountMinor = paidBy.reduce((total, entry) => total + entry.amountMinor, 0);
  return {
    groupId: gid,
    description: 'Dinner at Ramiro',
    amountMinor,
    currency: GROUP_CURRENCY,
    splitMethod: 'equal',
    date: PAST,
    splits,
    paidBy,
    participantIds: splits.map((split) => split.uid),
    splitsTotalMinor: amountMinor,
    paidTotalMinor: amountMinor,
    createdBy: creator.uid,
    createdAt: serverTimestamp() as FieldValue,
    deletedAt: null,
    ...overrides,
  };
}

export function settlementDoc(
  gid: string,
  creator: Actor,
  fromUid: string,
  toUid: string,
  amountMinor: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    groupId: gid,
    fromUid,
    toUid,
    amountMinor,
    currency: GROUP_CURRENCY,
    date: PAST,
    note: 'Sent by bank transfer',
    createdBy: creator.uid,
    createdAt: serverTimestamp() as FieldValue,
    deletedAt: null,
    ...overrides,
  };
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Flows — the client paths the app itself takes
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** Upserts `users/{uid}` the way the app does, then waits for the profile trigger to settle. */
export async function createProfile(actor: Actor): Promise<void> {
  await setDoc(doc(actor.db, `users/${actor.uid}`), userDoc(actor));
}

/**
 * Creates a group through the ordinary client path and waits for `onGroupCreated` to seed the
 * creator's member document.
 *
 * The wait is not politeness: `groups/{gid}/members/{uid}` is `allow write: if false`, so until
 * the Function has written it the creator is not an `isActiveMember` and cannot add an expense
 * to their own group.
 */
export async function createGroup(
  creator: Actor,
  gid: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await setDoc(doc(creator.db, `groups/${gid}`), groupDoc(creator, overrides));
  await waitFor(
    `onGroupCreated to seed members/${creator.uid}`,
    () => serverDoc(`groups/${gid}/members/${creator.uid}`),
    (member) => member !== null,
  );
}

/** The whole invite round-trip: the creator mints a link, the joiner redeems it. */
export async function joinViaInvite(host: Actor, joiner: Actor, gid: string): Promise<void> {
  const invite = await host.call<{ token: string }>('createInvite', { groupId: gid });
  await joiner.call('redeemInvite', { token: invite.token });
  await waitFor(
    `${joiner.displayName} to appear in members/`,
    () => serverDoc(`groups/${gid}/members/${joiner.uid}`),
    (member) => member !== null,
  );
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Reads
 * ────────────────────────────────────────────────────────────────────────────────────────── */

export interface MemberDoc {
  uid: string;
  role: string;
  displayName: string;
  balanceMinor: number;
  leftAt: unknown;
  [key: string]: unknown;
}

/**
 * The member document as the reader sees it. Throws if the reader may not see it — denial is a
 * result here, never something to swallow.
 *
 * (Worth knowing when reading a denial's text: the emulator reports a false `exists()` as
 * `evaluation error at L280` rather than as a plain `false`. Same `permission-denied` code
 * either way — but it does mean `assertFails` cannot tell a considered deny from a rule that
 * blew up.)
 */
export async function memberDocOf(
  reader: Actor,
  gid: string,
  uid: string,
): Promise<MemberDoc | null> {
  const snap = await getDoc(doc(reader.db, `groups/${gid}/members/${uid}`));
  return snap.exists() ? (snap.data() as MemberDoc) : null;
}

/**
 * Every member's `balanceMinor`, keyed by uid — the shape `computeBalances` returns, so the two
 * can be compared directly in the Article VI drift test.
 */
export async function balancesOf(reader: Actor, gid: string): Promise<Record<string, number>> {
  const snap = await getDocs(collection(reader.db, `groups/${gid}/members`));
  const balances: Record<string, number> = {};
  for (const member of snap.docs) {
    balances[member.id] = (member.data() as { balanceMinor: number }).balanceMinor;
  }
  return balances;
}

/** The group document as the reader sees it. Throws if the reader may not see it. */
export async function groupOf(reader: Actor, gid: string): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(reader.db, `groups/${gid}`));
  return snap.exists() ? snap.data() : null;
}

/** AC-E1.3 — across all member docs in a group, `sum(balanceMinor) === 0`, exactly. */
export function sumOf(balances: Record<string, number>): number {
  return Object.values(balances).reduce((total, balance) => total + balance, 0);
}
