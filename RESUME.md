# Resume here

**Last updated:** 2026-08-27, end of session. Project: **SplitSutra**.
Repo: <https://github.com/allcottcourt1808/splitsutra> (public).
Checkout: `C:\Users\neeth\coding\splitsutra`.

## State: the runtime blocker is fixed. Four branches stacked.

`main` is untouched this session. Everything below sits on a stack, each branch based on the
one above it, because the callables need core's build to exist before they compile.

| Order | Branch                     | Contents                                  |
| ----- | -------------------------- | ----------------------------------------- |
| 1     | `fix/core-build-step`      | core emits `dist/`; `.prettierignore` fix |
| 2     | `test/domain-money-math`   | 171 domain tests, 100% coverage           |
| 3     | `feat/missing-callables`   | the four remaining callables              |
| 4     | `chore/session-checkpoint` | clearance outcome, seed WIP, this file    |

**Merge them in that order.** Rebase each onto `main` after the one before it lands.

All gates pass on the full stack: `pnpm verify` ✅ · `pnpm build` ✅ · `pnpm format:check` ✅.

## ✅ Fixed: `packages/core` could not be loaded by Node

Last session's headline blocker. Core named its **TypeScript source** as its entry points
with no build step, so the explicit `.js` specifiers its imports carry pointed at files
nothing ever emitted. `apps/web` never noticed because Vite transpiles core;
`firebase/functions` runs real Node and died with `ERR_MODULE_NOT_FOUND`.

Core now builds via `packages/core/tsconfig.build.json`, emitting `dist/` with `.js`, `.d.ts`
and declaration maps. **It compiles under `NodeNext`, not the base config's `bundler`** — the
output has to be loadable by the Node resolver, so the compiler producing it uses the Node
resolver. `tsconfig.json` stays on `bundler`, so core is now checked under **both** resolvers
on every verify and a specifier only one of them accepts cannot land.

Every `tsc` script in `firebase/functions` builds core first. That is declared in the
functions package rather than left to `pnpm -r`'s topological ordering, so a cold
`pnpm --filter @splitsutra/functions typecheck` and `firebase.json`'s `predeploy` both work
without the caller knowing to build core.

Verified the way the bug demanded — by loading the compiled entry point in real Node, not by
reading a green build. All twelve functions resolve.

> Correction to last session's note: Node 24 **does** strip types from `.ts` natively, so it
> loaded `index.ts` fine and died resolving the children. The fix is the same either way.

## Done this session

1. **171 domain tests, 100% coverage** on `packages/core/src/domain/**` — property-based for
   the invariants, example-based for the traps (largest-remainder, JPY zero-decimal,
   three-decimal currencies, every error path). Closes the Article X violation. The generators
   still share no arithmetic with the allocator.
2. **All four missing callables** — `addFriend`, `deleteGroup`, `recomputeGroupBalances`,
   `deleteAccount`. `index.ts` now exports twelve functions. `deleteGroup` and `deleteAccount`
   both refuse while any non-zero balance exists.
3. **Name clearance run and recorded** in `docs/21-name-clearance.md`.
4. **`.prettierignore` gap** — it covered `dist/` but not `firebase/functions/lib/`, so
   `format:check` passed or failed depending on whether you had built recently.

## ⚠️ The name is decided — but one step is still outstanding

**The owner chose to KEEP SplitSutra on 2026-08-27**, having seen the clearance result.
Verdict was 🟡 CLEAR WITH CAVEATS. Do not reopen this; it is settled.

No collision anywhere — App Store, Play, Product Hunt, npm, GitHub all clean, and
`splitsutra.com`/`.app`/`.io`/`.in` are **all four available** (checked by RDAP with control
queries). Accepted knowingly: `sutra` means "tomorrow" in Serbian/Croatian/Bosnian and Split
is a Croatian city; a mild Kama Sutra overtone in English; and the name sits on doc 21's own
exclusion list as `split*` plus a stock suffix.

🔴 **Trademark is NOT cleared.** EUIPO and WIPO were unreachable and the USPTO evidence is
Justia-indexed, not authoritative. Live `SUTRA` marks exist in **class 9** and **class 42**,
both of which this project touches. Step 1 of doc 21's checklist needs a professional before
money goes on a listing. Full detail in `docs/21-name-clearance.md` §Outcome.

## Firebase — nothing is set up, and that is fine

The CLI is **not logged in** (`firebase login:list` → no authorized accounts). Nothing needs
it: Phases 00–10 run entirely on the local emulator suite with `demo-*` project IDs, which
force the SDKs offline.

⚠️ `.firebaserc` still points at `splitsutra-dev`, an **unreserved placeholder**. Always pass
`--project demo-splitsutra` to emulator commands so nothing resolves to it. Now that the name
is settled, reserving `splitsutra-dev` and `splitsutra-prod` in one sitting is unblocked — but
see the trademark caveat above before spending money on the strength of it.

### 🪟 Windows PATH gotcha — cost real time this session

`pnpm`, `npm` and `firebase` all fail in the owner's PowerShell, for two _different_ reasons:

- **`pnpm` / `firebase` — not on PATH.** Both live in `C:\Users\neeth\AppData\Roaming\npm\`,
  which is absent from the PowerShell PATH. Error is `ObjectNotFound`.
- **`npm` — blocked by execution policy.** It _is_ on PATH, but PowerShell resolves it to
  `npm.ps1` and the policy is Restricted. Error is `SecurityError` — a different failure
  wearing similar clothes.

Workaround that needs no setting changed: call the `.cmd` shim by full path, e.g.
`C:\Users\neeth\AppData\Roaming\npm\firebase.cmd login`. Batch files are not subject to the
PowerShell script policy. A global `firebase-tools` **is already installed** at 15.28.1 — the
same version the repo pins.

Permanent fixes, both the owner's call and neither yet applied: add that directory to the user
PATH, and/or `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Still missing

1. **The seed script is INCOMPLETE.** `firebase/seed/src/guard.ts` and `admin.ts` are written
   and good — the guard is an allowlist (`demo-*` only, `*-prod` refused with no override at
   all, anything else needs `--allow-real-project`). But **`firebase/seed.ts` does not exist**,
   so `pnpm seed` still fails, and no data writer was written. Nothing imports the guard yet,
   so it cannot break anything meanwhile.
   ⚠️ `firebase/seed/` is covered by **no tsconfig**, so `pnpm typecheck` does not check it. It
   compiles standalone; that was verified by hand. Wire it into a project when finishing.
2. **Screens.** Every route still renders `PendingScreen`. Delete that file when the last real
   screen lands. Blocked in practice on `core/src/repositories` and `core/src/hooks`, which are
   still `export {}` skeletons.
3. **`e2e/specs/` does not exist**, so `pnpm test:e2e` finds nothing. Playwright and its
   Chromium are installed and ready.
4. **Hosting serves nothing** until a build output reaches CI; `apps/web/dist` is local-only.
5. **CI does not run `format:check`** — which is why the `.prettierignore` gap survived. Worth
   adding.

## Environment — ready, nothing to redo

Node 24.19.0 · pnpm 9.15.9 · Firebase CLI 15.28.1 (both global and repo-pinned) · JDK 21 · gh
authenticated · Playwright Chromium + ffmpeg installed · emulator JARs cached.

Gotcha: `emulators:exec` does **not** start the UI unless you pass `--ui`. It is a standalone
flag, not an `--only` value.

## Dependency policy — latest, with two forced exceptions

- **Node stays 24** though 26 exists: Firebase caps Cloud Functions Gen 2 at `nodejs24`.
- **TypeScript is 6.0.3, not 7.0.2**: `typescript-eslint@8` declares `typescript <6.1.0`, so TS
  7 would silently stop linting the whole repo.

Everything else current: vite 8, vitest 4, eslint 10, zod 4, firebase 12, firebase-admin 14,
firebase-functions 7, dependency-cruiser 18, react-router 8.

## Traps already hit — do not re-introduce

- **Unanchored ignore patterns, now three times.** A bare `lib/` in `.gitignore` silently kept
  `firebase/functions/src/lib/` — including `identity.ts` — out of the repo entirely. The
  ESLint ignore hit the same trap. `.prettierignore` hit the inverse this session by having no
  entry at all. All three are anchored to `firebase/functions/lib/` now. **A bare `lib/` is
  always wrong in this repo.**
- **A green build is not evidence the thing runs.** Five gates passed while core was
  unloadable. Load the artefact in the real runtime.
- **Renaming the brand sweeps too far.** It once rewrote the competitor table in `docs/19` into
  a claim about ourselves. `docs/21-name-clearance.md` is excluded on purpose — it records
  which names were _rejected_, so "Settl" must stay spelled that way there.
- **Run the whole gate before pushing.** A push after only `pnpm depcruise` broke CI on four
  PRs at once.
- **`pnpm install` on a partial branch** prunes lockfile importers for workspace packages that
  branch lacks. If it happens, `git checkout -- pnpm-lock.yaml`.

## Next session, in order

1. **Merge the stack** — `fix/core-build-step` first, then tests, callables, this checkpoint.
   Rebase each in turn.
2. **Finish the seed script** — write `firebase/seed.ts` and the data writer, wire
   `firebase/seed/` into a tsconfig, then actually run it against `--project demo-splitsutra`
   and confirm the `-prod` refusal fires.
3. **Fill `core/src/repositories` and `core/src/hooks`**, which is what actually unblocks
   screens.
4. **Screens**, replacing `PendingScreen` one route at a time.
5. Add `pnpm format:check` to CI.
