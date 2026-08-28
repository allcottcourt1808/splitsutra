/**
 * ============================================================================
 * 🔴 THE SEED GUARD — the only thing standing between this script and a real ledger
 * ============================================================================
 *
 * `.firebaserc` names this file by path and says: "The seed script hard-refuses any
 * project ID ending in '-prod'. Keep the '-prod' suffix on the production alias or
 * that guard stops protecting you." checklists/phase-11 §2 and docs/10 §"Seeding
 * non-local environments" say the same thing. This module is that promise, in code.
 *
 * ## Why the guard is wider than the rule it was given
 *
 * The recorded constraint is one line: refuse `*-prod`. Taken literally it is a
 * blocklist, and a blocklist protects you only against the mistake somebody already
 * thought of. `splitsutra-live`, `splitsutra-app-prod-eu`, a personal project that
 * happens to hold a friend's real expenses — none of those end in `-prod`, and every
 * one of them is a ledger this script would happily overwrite with fabricated dinners.
 *
 * So the guard is an **allowlist with a blocklist nailed shut inside it**:
 *
 *   1. `*-prod`            → REFUSED. No flag, no env var, no override. Ever.
 *   2. not `demo-*`        → refused unless `--allow-real-project` is passed.
 *   3. `demo-*`            → allowed, and the emulator hosts are defaulted for you.
 *
 * `demo-` is not a naming convention here, it is a mechanism. The Firebase CLI and
 * every Firebase SDK treat a `demo-` project id as offline-only: "attempts to access
 * non-emulated services for this project will fail" (the CLI prints exactly that on
 * startup). A `demo-*` run therefore *cannot* reach a real project even if every
 * emulator host variable were wrong — which is precisely the property you want from
 * the default path of a script that writes fake money.
 *
 * Rule 2 has an escape hatch because docs/10 asks for `pnpm seed --project dev` to
 * work against the deployed dev project. Rule 1 does not, and must not: an override
 * that can be passed is an override that gets pasted into a shell at 2am.
 *
 * ## Kept free of side effects on purpose
 *
 * Nothing here initialises the Admin SDK, opens a socket, or writes a document. The
 * entry point resolves the target first and only then imports the writer, so a
 * refusal happens before any credential is loaded or any connection is attempted.
 */

import { readFileSync } from 'node:fs';

/** Emulator ports, from `firebase.json` → `emulators`. Keep the two in step. */
const DEFAULT_FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const DEFAULT_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

/**
 * 🔴 `127.0.0.1`, never `localhost` (docs/08 §"Connecting the client to emulators").
 * Node resolves `localhost` to the IPv6 `::1` first and the emulators bind IPv4, so
 * `localhost` produces an ECONNREFUSED that looks like the emulator is not running.
 */
const LOOPBACK_LITERAL = '127.0.0.1';

/** The suffix that can never be seeded, under any flag. */
const PRODUCTION_SUFFIX = '-prod';

/** The prefix that forces every Firebase SDK offline. See the header. */
const OFFLINE_PROJECT_PREFIX = 'demo-';

/** The project id used by every example command this module prints. */
export const EMULATOR_PROJECT_ID = 'demo-splitsutra';

/** How a host variable ended up with the value it has — reported in the summary. */
export type HostOrigin = 'inherited from the environment' | 'defaulted by the seed script';

export interface EmulatorHost {
  readonly variable: 'FIRESTORE_EMULATOR_HOST' | 'FIREBASE_AUTH_EMULATOR_HOST';
  readonly value: string;
  readonly origin: HostOrigin;
}

export interface SeedTarget {
  /** The fully resolved Firebase project id — aliases from `.firebaserc` already applied. */
  readonly projectId: string;
  /** Human-readable provenance, e.g. `--project prod → splitsutra-prod (.firebaserc alias)`. */
  readonly projectSource: string;
  /** `true` when the operator forced a non-`demo-` project with `--allow-real-project`. */
  readonly realProject: boolean;
  /** Firestore then Auth. Empty only when a forced real-project run talks to the cloud. */
  readonly emulatorHosts: readonly EmulatorHost[];
}

/**
 * A refusal, or any other reason the seed cannot start.
 *
 * Separate from a generic `Error` so the entry point can print the message on its own
 * — a guard refusal is an intended outcome and a stack trace would bury the one line
 * the operator needs to read.
 */
export class SeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedRefusedError';
    // Matches `DocumentParseError` in core: restores the prototype chain so
    // `instanceof` holds regardless of emit target.
    Object.setPrototypeOf(this, SeedRefusedError.prototype);
  }
}

export interface SeedArgs {
  readonly project: string | null;
  readonly allowRealProject: boolean;
  readonly help: boolean;
}

export const USAGE = `
  pnpm seed                                  seed the running emulator suite
  pnpm seed --project <id|alias>             target a specific project or .firebaserc alias
  pnpm seed --allow-real-project             required for any project id that is not demo-*
  pnpm seed --help                           this message

  Note: pnpm forwards flags after the script name. If your pnpm version does not,
  use the explicit form:  pnpm seed -- --project ${EMULATOR_PROJECT_ID}
`.trimEnd();

/**
 * Parses the flags this script understands, and rejects the ones it does not.
 *
 * Unknown flags are a hard error rather than a warning. A typo'd `--allow-real-prject`
 * that is silently ignored would only ever be noticed as a refusal — but a typo'd
 * `--project` would silently fall through to whatever the environment happens to
 * name, which is the failure mode this whole module exists to prevent.
 */
export function parseArgs(argv: readonly string[]): SeedArgs {
  let project: string | null = null;
  let allowRealProject = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;

    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--allow-real-project') {
      allowRealProject = true;
    } else if (arg.startsWith('--project=')) {
      project = arg.slice('--project='.length);
    } else if (arg === '--project' || arg === '-P') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new SeedRefusedError(`${arg} needs a project id or .firebaserc alias.\n${USAGE}`);
      }
      project = value;
      index += 1;
    } else {
      throw new SeedRefusedError(`Unknown argument "${arg}".\n${USAGE}`);
    }
  }

  if (project !== null && project.trim().length === 0) {
    throw new SeedRefusedError(`--project was given an empty value.\n${USAGE}`);
  }

  return { project, allowRealProject, help };
}

/** `.firebaserc` → `projects`, or an empty map when the file is absent or unreadable. */
function readFirebaseRcProjects(repoRoot: URL): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(new URL('.firebaserc', repoRoot), 'utf8');
  } catch {
    // Absent `.firebaserc` is survivable: the project id can still come from a flag
    // or from the environment the Firebase CLI sets. Only alias resolution is lost.
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const projects = (parsed as { projects?: unknown }).projects;
    if (typeof projects !== 'object' || projects === null) return {};

    const out: Record<string, string> = {};
    for (const [alias, id] of Object.entries(projects)) {
      if (typeof id === 'string' && id.length > 0) out[alias] = id;
    }
    return out;
  } catch {
    return {};
  }
}

/** `FIREBASE_CONFIG` is JSON when the Firebase CLI sets it; anything else is ignored. */
function projectIdFromFirebaseConfig(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const projectId = (parsed as { projectId?: unknown }).projectId;
    return typeof projectId === 'string' && projectId.length > 0 ? projectId : null;
  } catch {
    return null;
  }
}

interface ResolvedProject {
  readonly projectId: string;
  readonly source: string;
}

/**
 * Works out which project this run would touch, in the order the operator expects.
 *
 * An explicit flag beats the ambient environment, and the ambient environment beats
 * the `.firebaserc` default — because `firebase emulators:exec --project X` sets
 * `GCLOUD_PROJECT`, and a run inside that wrapper must agree with the emulator it was
 * handed rather than with whatever `.firebaserc` calls "default".
 */
function resolveProject(
  args: SeedArgs,
  env: NodeJS.ProcessEnv,
  repoRoot: URL,
): ResolvedProject | null {
  const aliases = readFirebaseRcProjects(repoRoot);

  /** `dev` → `splitsutra-dev`. A literal id passes through untouched. */
  const applyAlias = (value: string, label: string): ResolvedProject => {
    const target = aliases[value];
    return target === undefined
      ? { projectId: value, source: label }
      : { projectId: target, source: `${label} → ${target} (.firebaserc alias "${value}")` };
  };

  if (args.project !== null) {
    return applyAlias(args.project, `--project ${args.project}`);
  }

  for (const variable of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT'] as const) {
    const value = env[variable];
    if (value !== undefined && value.length > 0) {
      return applyAlias(value, `$${variable}=${value}`);
    }
  }

  const fromConfig = projectIdFromFirebaseConfig(env['FIREBASE_CONFIG']);
  if (fromConfig !== null) {
    return applyAlias(fromConfig, `$FIREBASE_CONFIG.projectId=${fromConfig}`);
  }

  const fallback = aliases['default'];
  return fallback === undefined
    ? null
    : { projectId: fallback, source: `.firebaserc "default" → ${fallback}` };
}

/** The one message an operator who pointed this at prod should see. Say what to run instead. */
function refusalMessage(projectId: string, source: string, reason: string, remedy: string): string {
  return [
    '',
    '  ╔════════════════════════════════════════════════════════════════════════════╗',
    '  ║  🔴 SEED REFUSED                                                           ║',
    '  ╚════════════════════════════════════════════════════════════════════════════╝',
    '',
    `  Target project : ${projectId}`,
    `  Resolved from  : ${source}`,
    `  Reason         : ${reason}`,
    '',
    '  Nothing was written. No connection was opened.',
    '',
    '  Run this instead:',
    remedy,
    '',
  ].join('\n');
}

/**
 * Resolves the target project and applies the guard. Throws {@link SeedRefusedError}
 * rather than returning a failure, so a caller cannot forget to check the result.
 *
 * Mutates `env` on success — setting `FIRESTORE_EMULATOR_HOST` /
 * `FIREBASE_AUTH_EMULATOR_HOST` when they are absent — because the Admin SDK reads
 * those at `initializeApp` time and there is no other way to point it at the
 * emulators. That is why this must run before the writer module is imported.
 */
export function resolveTarget(args: SeedArgs, env: NodeJS.ProcessEnv, repoRoot: URL): SeedTarget {
  const resolved = resolveProject(args, env, repoRoot);

  if (resolved === null) {
    throw new SeedRefusedError(
      refusalMessage(
        '(none)',
        'nothing — no --project flag, no GCLOUD_PROJECT, no .firebaserc default',
        'the seed script will not guess which project to write to',
        `      firebase emulators:exec --only firestore,auth --project ${EMULATOR_PROJECT_ID} "pnpm seed"`,
      ),
    );
  }

  const { projectId, source } = resolved;

  // ── Rule 1 ────────────────────────────────────────────────────────────────────
  // 🔴 NOT OVERRIDABLE. This script writes fabricated expenses, settlements and
  // balances. In a production ledger those are indistinguishable from real records
  // of what people actually owe each other, and Article V means nothing here is ever
  // hard-deleted — so there is no clean undo, only a restore from backup.
  // `--allow-real-project` is deliberately not consulted.
  if (projectId.endsWith(PRODUCTION_SUFFIX)) {
    throw new SeedRefusedError(
      refusalMessage(
        projectId,
        source,
        `project id ends in "${PRODUCTION_SUFFIX}" — this is a production ledger, and ` +
          'seeding it would mix fabricated money records into real ones.\n' +
          '                   There is no override flag for this. There is not meant to be one.',
        `      firebase emulators:exec --only firestore,auth --project ${EMULATOR_PROJECT_ID} "pnpm seed"`,
      ),
    );
  }

  // ── Rule 2 ────────────────────────────────────────────────────────────────────
  // Everything that is not `demo-*` might be somebody's real data, whatever it is
  // called. docs/10 wants `pnpm seed --project dev` to work, so this one is
  // overridable — but only by an operator who typed the words out.
  if (!projectId.startsWith(OFFLINE_PROJECT_PREFIX) && !args.allowRealProject) {
    throw new SeedRefusedError(
      refusalMessage(
        projectId,
        source,
        `not a "${OFFLINE_PROJECT_PREFIX}*" project. Only ${OFFLINE_PROJECT_PREFIX}* project ids ` +
          'force the Firebase SDKs offline, so anything else may reach a live backend.',
        [
          `      firebase emulators:exec --only firestore,auth --project ${EMULATOR_PROJECT_ID} "pnpm seed"`,
          '',
          '  ...or, if you really did mean to seed a deployed non-production project',
          '  (docs/10 §"Seeding non-local environments"):',
          '',
          `      pnpm seed --project ${projectId} --allow-real-project`,
        ].join('\n'),
      ),
    );
  }

  const emulatorHosts: EmulatorHost[] = [];

  /**
   * Point the Admin SDK at the emulator unless the caller already did.
   *
   * Only for `demo-*`. A forced real-project run must NOT be silently redirected to
   * a local emulator — the operator asked for the deployed project and would
   * otherwise watch a "seeded successfully" summary describing writes that went
   * nowhere near it.
   */
  const applyHost = (variable: EmulatorHost['variable'], fallback: string): void => {
    const existing = env[variable];
    if (existing !== undefined && existing.length > 0) {
      emulatorHosts.push({ variable, value: existing, origin: 'inherited from the environment' });
      return;
    }
    env[variable] = fallback;
    emulatorHosts.push({ variable, value: fallback, origin: 'defaulted by the seed script' });
  };

  if (projectId.startsWith(OFFLINE_PROJECT_PREFIX)) {
    applyHost('FIRESTORE_EMULATOR_HOST', DEFAULT_FIRESTORE_EMULATOR_HOST);
    applyHost('FIREBASE_AUTH_EMULATOR_HOST', DEFAULT_AUTH_EMULATOR_HOST);
  } else {
    // Forced real project: report the emulator variables only if the operator set
    // them, and never invent them. If both are absent this run talks to the cloud,
    // which is exactly what `--allow-real-project` asked for.
    for (const variable of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'] as const) {
      const existing = env[variable];
      if (existing !== undefined && existing.length > 0) {
        emulatorHosts.push({ variable, value: existing, origin: 'inherited from the environment' });
      }
    }
  }

  return {
    projectId,
    projectSource: source,
    realProject: !projectId.startsWith(OFFLINE_PROJECT_PREFIX),
    emulatorHosts,
  };
}

/** Exported for the summary line and for tests that assert the IPv4 literal is used. */
export const EMULATOR_DEFAULTS = {
  loopback: LOOPBACK_LITERAL,
  firestore: DEFAULT_FIRESTORE_EMULATOR_HOST,
  auth: DEFAULT_AUTH_EMULATOR_HOST,
} as const;
