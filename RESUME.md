# Resume here

**Last updated:** 2026-08-28, end of session. Project: **SplitSutra**.
Repo: <https://github.com/allcottcourt1808/splitsutra> (public).
Checkout: `C:\Users\neeth\coding\splitsutra`.

## State: PRs #1–#11 merged. Five PRs are open and waiting.

`main` carries the workspace, the core domain with 171 tests, the design system, the
navigation shell, the Firestore rules and triggers, and all twelve Cloud Functions.

### Open PRs — start here next session

| PR                                                            | What                                         | Ready?                   |
| ------------------------------------------------------------- | -------------------------------------------- | ------------------------ |
| [#12](https://github.com/allcottcourt1808/splitsutra/pull/12) | `format:check` in CI                         | ✅ merge it              |
| [#13](https://github.com/allcottcourt1808/splitsutra/pull/13) | `formatMoney` moved into core, + crypto/time | ✅ merge it              |
| [#14](https://github.com/allcottcourt1808/splitsutra/pull/14) | Component + navigation tests (238 pass)      | ✅ merge it              |
| [#15](https://github.com/allcottcourt1808/splitsutra/pull/15) | Firebase init + first repositories           | 🚧 **draft, incomplete** |
| [#16](https://github.com/allcottcourt1808/splitsutra/pull/16) | Seed dataset + writer                        | 🚧 **draft, incomplete** |

#12/#13/#14 are complete and pass every gate locally. #15 and #16 are agent work that was
stopped mid-task; they are drafts on purpose, each with a "still to do" checklist in the PR
body. Nothing in either is imported by anything yet, so neither can break `main`.

### 🪤 Trap that cost real time — never stack PRs on each other again

PRs #8, #9 and #10 were opened as a **stack**: #9 based on #8's branch, #10 based on #9's.
All three reported MERGED, and **two of them never reached `main`** — #9 merged into
`test/domain-money-math` and #10 into `feat/missing-callables`. GitHub only retargets a
stacked PR onto `main` after its base branch is deleted, and all three were merged within
about thirty seconds, so that never happened. `main` silently lost 1,673 lines: the four
callables, the seed guard, the clearance record and this file. PR #11 restored it.

**Open every PR against `main`.** If two changes genuinely depend on each other, merge the
first before opening the second. A stack makes merge ORDER load-bearing, and nothing warns
you when it goes wrong — every PR still shows a green MERGED badge.

The five PRs above are all based on `main` directly. They touch disjoint files, so they can
be merged in any order.

## ✅ Fixed earlier: `packages/core` could not be loaded by Node

Core named its **TypeScript source** as its entry points with no build step, so the explicit
`.js` specifiers its imports carry pointed at files nothing ever emitted. `apps/web` never
noticed because Vite transpiles core; `firebase/functions` runs real Node and died with
`ERR_MODULE_NOT_FOUND`.

Core now builds via `packages/core/tsconfig.build.json`, emitting `dist/` with `.js`, `.d.ts`
and declaration maps. **It compiles under `NodeNext`, not the base config's `bundler`** — the
output has to be loadable by the Node resolver, so the compiler producing it uses the Node
resolver. `tsconfig.json` stays on `bundler`, so core is checked under **both** resolvers on
every verify and a specifier only one of them accepts cannot land.

Every `tsc` script in `firebase/functions` builds core first, declared in the functions
package rather than left to `pnpm -r`'s topological ordering, so a cold
`pnpm --filter @splitsutra/functions typecheck` and `firebase.json`'s `predeploy` both work.

> Node 24 **does** strip types from `.ts` natively, so it loaded `index.ts` fine and died
> resolving the children. The fix is the same either way.

## Done this session

1. **PR #11 merged** — restored the 1,673 lines the stacked merge lost.
2. **`format:check` added to CI** (#12). It earned its keep on the first run: 8 unformatted
   files in this session's own work.
3. **`formatMoney` moved down into core** (#13), closing an Article VI violation.
   `Money.tsx` is now a thin wrapper. Still no `Intl.NumberFormat` — Hermes' trimmed ICU
   mis-scales JPY and KWD, a 100x error nothing on this platform would catch.
4. **238 unit/component tests pass** (#14), up from 171.
5. Partial data layer (#15) and seed dataset (#16), both drafted.

### Vitest gotcha found while fixing #14

`?raw` on a `.css` import **does not work under Vitest**. It routes every `.css` specifier
through CSS-modules handling and returns the class-name proxy whatever query you append, so
you get `Cannot convert a Symbol value to a string`, not source text. Read the file off disk
instead — and note `import.meta.url` is an _http_ URL under Vitest, so `fileURLToPath` throws
`The URL must be of scheme file`. Use the pathname, minus the leading slash before a Windows
drive letter. `apps/web/src/components/__tests__/Pressable.test.tsx` has the working helper.

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
`--project demo-splitsutra` to emulator commands so nothing resolves to it. Reserving
`splitsutra-dev` and `splitsutra-prod` is unblocked now the name is settled — but see the
trademark caveat above before spending money on the strength of it.

### 🪟 Windows PATH gotcha

`pnpm`, `npm` and `firebase` all fail in the owner's PowerShell, for two _different_ reasons:

- **`pnpm` / `firebase` — not on PATH.** Both live in `C:\Users\neeth\AppData\Roaming\npm\`,
  which is absent from the PowerShell PATH. Error is `ObjectNotFound`.
- **`npm` — blocked by execution policy.** It _is_ on PATH, but PowerShell resolves it to
  `npm.ps1` and the policy is Restricted. Error is `SecurityError` — a different failure
  wearing similar clothes.

Workaround that needs no setting changed: call the `.cmd` shim by full path, e.g.
`C:\Users\neeth\AppData\Roaming\npm\firebase.cmd login`. Batch files are not subject to the
PowerShell script policy. A global `firebase-tools` **is already installed** at 15.28.1.

Permanent fixes, both the owner's call and neither yet applied: add that directory to the user
PATH, and/or `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Still missing

1. **The seed script still does not run.** `guard.ts` and `admin.ts` are on `main`;
   `dataset.ts` and `writer.ts` are in draft #16. **`firebase/seed.ts` does not exist**, so
   `pnpm seed` fails and nothing imports the guard yet.
   ⚠️ `firebase/seed/` is covered by **no tsconfig**, so `pnpm typecheck` does not check it.
2. **Screens.** Every route still renders `PendingScreen`. Delete that file when the last real
   screen lands. Blocked on `core/src/repositories` (draft #15) and `core/src/hooks`, which is
   still an `export {}` skeleton — **the hooks are the real unblocker**.
3. **`e2e/specs/` does not exist**, so `pnpm test:e2e` finds nothing. Playwright and its
   Chromium are installed and ready.
4. **No rules tests or integration tests** — the emulator-backed suites are still commented
   out in `.github/workflows/ci.yml`.
5. **Hosting serves nothing** until a build output reaches CI; `apps/web/dist` is local-only.

## Environment — ready, nothing to redo

Node 24.19.0 · pnpm 9.15.9 · Firebase CLI 15.28.1 (both global and repo-pinned) · JDK 21 · gh
authenticated · Playwright Chromium + ffmpeg installed · emulator JARs cached.

Gotcha: `emulators:exec` does **not** start the UI unless you pass `--ui`. It is a standalone
flag, not an `--only` value.

Gotcha: vitest projects are defined at the **root**, so `pnpm --filter @splitsutra/web exec
vitest --project component` fails. Run vitest from the repo root.

## Dependency policy — latest, with two forced exceptions

- **Node stays 24** though 26 exists: Firebase caps Cloud Functions Gen 2 at `nodejs24`.
- **TypeScript is 6.0.3, not 7.0.2**: `typescript-eslint@8` declares `typescript <6.1.0`, so TS
  7 would silently stop linting the whole repo.

Everything else current: vite 8, vitest 4, eslint 10, zod 4, firebase 12, firebase-admin 14,
firebase-functions 7, dependency-cruiser 18, react-router 8.

## Traps already hit — do not re-introduce

- **Never stack PRs.** See above. Cost more time than any bug this project has had.
- **Unanchored ignore patterns, now three times.** A bare `lib/` in `.gitignore` silently kept
  `firebase/functions/src/lib/` — including `identity.ts` — out of the repo entirely. The
  ESLint ignore hit the same trap. `.prettierignore` hit the inverse by having no entry at
  all. All three are anchored to `firebase/functions/lib/` now. **A bare `lib/` is always
  wrong in this repo.**
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

1. **Merge #12, #13, #14** — all three are green and independent.
2. **Finish #15's hooks** (`useAuth` first). This is the single thing blocking screens.
3. **Finish #16** — write `firebase/seed.ts`, wire `firebase/seed/` into a tsconfig, run it
   against `--project demo-splitsutra`, and **watch the `-prod` refusal actually fire**.
4. **Screens**, replacing `PendingScreen` one route at a time.
5. Rules tests, then `e2e/specs/`.
