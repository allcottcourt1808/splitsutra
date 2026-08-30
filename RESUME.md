# Resume here

**Last updated:** 2026-08-30. Project: **SplitSutra**.
Repo: <https://github.com/allcottcourt1808/splitsutra> (public).
Checkout: `C:\Users\neeth\coding\splitsutra`.

## State: PRs #1–#36 merged except #23. Dev backend is DEPLOYED.

**#34** (profile currency picker + layout audit) and **#35** (Couple → Friends group type) are
merged. **#36** merged. **#37** (invite join screen) and **#38** (deploy fixes) are open.
**#23** (shadcn docs) is still open and should probably become an ADR instead; see below.

### The five tabs

| Tab      | State                                  |
| -------- | -------------------------------------- |
| Groups   | ✅ in #32 — 7 screens, 90 screen tests |
| Friends  | ✅ shipped (#20, #21, #25)             |
| Add      | ✅ in #32 — Add/Detail/Edit, 105 tests |
| Activity | ✅ merged (#31)                        |
| Account  | ✅ shipped                             |

Gate on #32: typecheck (both resolvers) · lint · depcruise (262 modules, 922 deps) ·
format:check · **650 tests across 42 files**.

### 2026-08-30 — #35: `friend` did not belong in the rules allowlist

`establishFriendship` writes the implicit 1:1 group through the **Admin SDK**, which does not
consult Security Rules at all. So `'friend'` in the client group-create allowlist authorised
nothing legitimate — it only let a client forge a group presenting as the hidden container
behind a friendship. Dropped.

The same reasoning caught the line next to it: `isImplicit is bool` was too loose. Implicit
groups are **filtered out of the group list** (`groupRepo.ts:80`), so a client that can set the
flag can create a group hidden from the person it belongs to. Now `== false`, which costs
nothing — `createGroup` writes `false` unconditionally. Two rules tests added; 227 passing.

🔴 **Still owed:** `couple` remains in `GROUP_TYPES` purely so old documents keep decoding.
For a pre-launch app that history is probably not worth carrying — but deleting it is a
**live-data** question, not a cleanup one: `parseDocument` throws on an unknown enum member,
so one stored `couple` document takes down the whole `memberIds array-contains` group list,
not just that group. Confirm nothing stores it first. Needs the emulator or a deploy.

### 2026-08-30 — dev is DEPLOYED and live (#38)

🟢 **splitsutra-dev-eac96 now has rules, indexes and all 14 Cloud Functions deployed.**
Project is on **Blaze**. This is the first time the app has had a working backend.

Three real bugs were in the way, all found by actually deploying:

1. **The functions predeploy compiled nothing and the deploy called it a success.**
   `pnpm --filter @splitsutra/functions build` printed `No projects matched the filters`
   and exited 0 — pnpm does that when a filter matches nothing — so firebase-tools
   would have shipped whatever stale `lib/` existed. It fails only under the env
   firebase-tools spawns hooks with; it works from bash, cmd, and inside the package.
   Replaced by `scripts/build-functions.mjs`, which can actually fail.

2. 🔴 **`"@splitsutra/core": "workspace:*"` made every function fail to build.**
   `firebase deploy` uploads ONLY `firebase/functions`, and Cloud Build runs `npm install`
   in it — no workspace, no packages/core, and npm does not know the `workspace:` protocol
   (`EUNSUPPORTEDPROTOCOL`). Verified npm rejects it even from `devDependencies` under
   `--omit=dev`, so it had to leave the manifest entirely. Core is now **inlined** into
   `lib/index.js` by esbuild; tsc resolves it via a `paths` mapping, esbuild via an alias.
   Safe because functions import only the root barrel, which excludes `./firebase` and
   `./repositories` — so no client SDK reaches an Admin-SDK process.

3. **`pnpm emulators` ran against the REAL dev project** — no `--project`, so it took
   `default` from `.firebaserc`. Also raised `FUNCTIONS_DISCOVERY_TIMEOUT` to 60s; the 10s
   default fails cold on Windows and the suite then comes up green with **zero functions
   registered**, which looks like a permissions bug rather than a missing backend.

⚠️ **Owed next:**

- 🔴 **SMS region policy + 50/day quota (phase-02 §3) is STILL UNDONE, and Blaze is now on.**
  Phone sign-in is live and unrestricted. This is the largest cost/abuse exposure on the
  project by docs/18's own assessment. Do this first.
- Groups created before this deploy will NOT self-heal — `onGroupCreated` is
  `onDocumentCreated` and there is no backfill callable. A one-off repair script is owed.
- Nothing on dev has been exercised end to end by a signed-in user yet.

### 2026-08-30 — #36: the pre-commit hook that was never installed

husky was installed, `prepare` ran it, `lint-staged` was configured — and `.husky/pre-commit`
did not exist, so **neither had ever run on a commit**. `.gitignore` was the only guard, and it
matches filenames: a service-account key saved as `config.json` or force-added with `git add -f`
walked straight past it. Verified, then fixed.

`.husky/pre-commit` now runs `lint-staged` (first — it rewrites and re-stages) then
`scripts/scan-secrets.mjs`, which reads the **staged blob** (`git show :path`), not the working
tree. Not gitleaks: a Go binary every clone must install, and a hook that no-ops when it is
missing reads as coverage. phase-10's full-history sweep still wants gitleaks and still says so.

⚠️ `--no-verify` bypasses all of it and no local hook can close that — needs a server-side scan,
left as a Phase 10 item.

The scanner exempts no file, including itself; its fixtures are string fragments so no rule
matches its own source. That proved itself immediately — **three fixtures written as literals
blocked the hook's own first commit.**

### 2026-08-29 — currency picker + a design-system clipping bug

- New-group currency default is **USD** already: `draftCurrency ?? profile.defaultCurrency ?? DEFAULT_CURRENCY`,
  and `DEFAULT_CURRENCY` is USD. The profile field is fully wired (EditProfile writes it, Account
  shows it), so it is asked once, not per group. No change was needed there.
- The picker on `CreateGroupScreen` is now **collapsed by default** — a summary row that expands on
  tap and collapses again on pick. AC-C1.1s "fixed at creation" warning stays visible in both states.
- 🔴 **Found and fixed a content-eating layout bug in the design system.** `.stack` and `.card`
  defaulted to `flex: 0 1 auto`; combined with `min-height: 0` and `.cardFlush { overflow: hidden }`
  they collapsed under their own content, so `.screenBody.scrollHeight` never exceeded its
  `clientHeight` and the overflow was **unreachable rather than scrolled to** — the currency list
  lost JPY and CNY with no scrollbar to hint at it. Both are now `flex: 0 0 auto`; `<Stack flex>`
  remains the opt-in for shrinking. Verified in the browser: card 410.6px vs list 409px, not
  clipped, screenBody 902 > 711, all 8 rows reachable.
- ⚠️ **happy-dom computes no layout, so no test can catch a regression of this.** Other screens were
  not visually re-checked after the CSS change; the gate is green but it is blind here.

### 2026-08-30 — the same collapse on the profile screen, and the audit PR #33 could not do

Three agents in parallel on disjoint files. All three landed; one needed correcting.

**`EditProfileScreen` picker collapsed**, mirroring `CreateGroupScreen`. Deliberately WITHOUT
the AC-C1.1 warning: a group's currency is immutable, `users/{uid}.defaultCurrency` is not, so
copying that card across would have been a false statement. There is a test asserting the
string is absent.

🔴 **The helper copy on that screen was wrong twice.** It originally said the default is used
"for new groups **and expenses**" — expenses take their currency from the group, not the
profile. The replacement said it seeds "groups you create" and nothing else, which was also
wrong: `sendFriendRequest.ts:185` and `respondToFriendRequest.ts:112` read `defaultCurrency`
as `currencyHint` and pass it to `establishFriendship`, so it also fixes the currency of the
implicit group behind a friendship — immutable under the same T10. If you send the request,
YOUR default fixes that ledger. The copy now names both readers. **The mistake both times was
grepping `apps/web` only; `defaultCurrency` has consumers in `firebase/functions`.**

**A regression guard for the flex fix** — `apps/web/src/components/__tests__/layoutPrimitives.css.test.ts`.
It reads `layout.module.css` as TEXT and pins four declarations: `.stack` fallback is `0 0 auto`,
`.card` is `0 0 auto`, `.cardFlush` still clips, and `.screenBody` is the ONLY rule in the file
with `overflow: auto|scroll`. It would NOT have caught the original bug — `0 1 auto` was valid
CSS and only a browser could show it was wrong — it catches the second occurrence.

**The browser audit came back clean, and is worth trusting further than a screenshot pass.**
It A/B-tested the actual CSS delta live by injecting the old values _inside `@layer primitives`_
so the cascade matched pre-fix exactly, then diffed `top/height/width` of every DOM node:
`diffCount: 0` on all eight reachable screens at rest. Under synthetic 3× overflow the pre-fix
build collapsed nine `.cardFlush` cards to **literally zero height** while they held 59px of
content; post-fix, zero clipped. The feared opposite failure cannot occur: the change moved
`flex-shrink` 1→0 and never touched `flex-grow`, and centring is a grow behaviour, so every
`<Stack flex="1" justify="center">` is untouched.

⚠️ **The real gap is data, not layout.** The signed-in account has no groups and no friends, so
every list rendered empty and group detail / members / balances / settle-up / group settings /
expense detail were never reachable at all. Those hold the longest lists. Creating one would
have written to the live Firestore project. **Re-run the audit against the emulators with
`VITE_USE_EMULATORS=true` and a seeded account** — that is the outstanding piece.

### 🔴 Open decisions, none of them mine

1. **Comment tombstones are impossible under the current rules.** Phase-08 wants a "comment
   deleted" marker; the rules set `allow update: if false` (T12) while `delete` is a hard
   delete. Both cannot hold, and it cuts against Article V. Documented in `deleteComment`.
2. **AC-E3.4 counts the wrong quantity** — `owing` counts debtors, not payments. The test
   pins the current string so a change fails loudly.
3. **Two delete affordances for an expense** — the detail screen's 5-second undo and a
   two-step confirm on the edit screen. Pick one.
4. **shadcn (#23)** — recommended against: Article IX is tokens-only and `docs/11` prices
   component reuse at 0%, so anything DOM-bound is discarded at Phase 12. Fold the doc into
   `docs/12-decisions.md` as a rejected option and close the PR.
5. **Console-only Firebase Auth setup (phase-02 §3) is still entirely undone**, and it is the
   part that costs money: the three providers, authorized domains, and 🔴 the **US-only SMS
   region policy + 50/day quota**. `apps/web/.env.local` still has
   `VITE_USE_EMULATORS=false`, so phone sign-in sends real SMS at real cost right now.

### Smaller things owed

- `canEdit` is duplicated between `ExpenseDetailScreen` and `EditExpenseScreen`; it
  restates a Security Rule and belongs in core beside it.
- `SettleUp` prefill round-trips through a formatted string instead of inverting
  `parseAmountToMinor` — safe only because the locale is hardcoded `en-US`.
- A successful `leaveGroup` leaves you on the members screen with the button still live.
- `apps/web/package.json` still depends on `firebaseui`, which its own notes say was dropped.
- `firebase/tests/integration/` still does not exist; `pnpm test:integration` matches zero files.
- ~~No pre-commit hook.~~ Done in #36.

---

<details>
<summary>Older checkpoint notes</summary>

### 🧪 What #24 adds — the rules tests that were owed since #20

Commit `85ce8f5`, **8 files under `firebase/tests/rules/`** plus a `helpers.ts` and
`firebase/tests/tsconfig.json`, covering all 37 `allow` statements in `firestore.rules` with
both denial **and** positive cases:

| File                      | Covers                                                            |
| ------------------------- | ----------------------------------------------------------------- |
| `groups.test.ts`          | group get/list/create/update/delete + the `members` subcollection |
| `users.test.ts`           | profile CRUD, `ownsClaimedIdentity`, `users/{uid}/friends`        |
| `usernames.test.ts`       | get, the **T5** `list` denials, write                             |
| `expenses.test.ts`        | create invariants, update, Article V no-hard-delete               |
| `settlements.test.ts`     | create invariants, update, delete                                 |
| `comments.test.ts`        | read, create, update, delete                                      |
| `friendRequests.test.ts`  | get, list, write                                                  |
| `collectionGroup.test.ts` | the constrained expenses query, `activity`, `invites`             |

**224 test cases** — 220 literal `it(` calls, four more because `collectionGroup.test.ts`
generates one per subcollection in a `for` loop. Reported passing on the branch; **not re-run
in this session**, so verify against the emulator before treating that as current.

🔴 **#24 is still OPEN, so `firebase/tests/rules/` does NOT exist on `main` or on any branch
cut from it.** Read the files with `git show test/firestore-rules:firebase/tests/rules/<f>.ts`
until it merges. The checklist boxes in `checklists/phase-03-auth.md` §8 and
`checklists/phase-05-friends-groups.md` §9 are ticked against those tests with a
`— covered by ...` note naming the file.

⚠️ One thing #24 deliberately does **not** catch: `expenses.test.ts` asserts that a **forged
checksum is accepted** by the rules. That is correct — layer 2 (`onExpenseWritten`) is what
catches it, and no rules test can. Do not "fix" that test.

### Current branch: `feat/friend-detail`

⚠️ **Uncommitted work in progress by other agents — `feat/friend-detail` is still at `8b4efc8`,
byte-identical to `main` with zero commits ahead.** Everything below is working-tree only:

- `packages/core/src/hooks/useFriend.ts` (new, 51 lines) — one friendship, or `null` once
  resolved as not-a-friend. Exported from the `hooks` barrel.
- `apps/web/src/screens/FriendDetailScreen.tsx` (new, 146 lines) and its component test
  `apps/web/src/screens/__tests__/FriendDetailScreen.test.tsx`.
- `apps/web/src/routes.tsx` — wires `FriendDetail` into the route table. The pattern
  `/friends/:uid` was already declared in `navigation/paths.ts`.

🔴 **None of it is verified from here.** This checkpoint did not run `pnpm verify`, did not read
those files for correctness, and did not commit them — they were landing on disk while this doc
was being written. Confirm the state yourself before building on it; the count of files above
may already be stale.

### 🔴 What #19 found: the design system was not reaching the page

Asked whether the app runs locally, it did — and then the tab bar turned out to be laying its
icons _beside_ the labels, so every label wrapped mid-word ("Group / s", "Accou / nt").

The cause was not a typo. `<Pressable>`, `<Text>`, `<Stack>`, `<Row>`, `<Card>`, `<List>` and
`<Avatar>` each merge a caller's `className` onto the element that carries their own base
class. Both are single classes, so specificity ties and **the cascade falls back to source
order — which here is CSS-module import order, something nobody chose**.
`layout.module.css` happened to load last, so `.stack` beat every class ever passed into a
`<Stack>`; `controls.module.css` loaded after `navigation.module.css`, so `.pressable` beat
`.tab`.

Measured on the running app: **41 declarations silently dropped.**

|             | Intended                  | Was rendering                     |
| ----------- | ------------------------- | --------------------------------- |
| Tab bar     | icon above label          | icon beside label, labels wrapped |
| Active tab  | primary teal              | identical to the inactive tabs    |
| Raised "+"  | teal pill                 | transparent, 10px radius          |
| Empty state | centred, gap `md`, padded | top-aligned, gap 0, padding 0     |

The fix is `@layer reset, primitives;` declared at the top of `styles/reset.css`, with every
primitive base rule layered and **every consumer rule left unlayered** — unlayered beats
layered, so a caller now wins by construction rather than by being lucky about import order.

⚠️ A specificity bump (`.tab.tab`) would have fixed the same 41 lines and left the trap for
the next component. `styles/__tests__/cascadeLayers.test.tsx` holds the invariant instead;
mutation-tested by un-layering `.pressable`, which fails 6 of its 26 assertions.

## 🪤 Trap that cost real time — never stack PRs on each other again

PRs #8, #9 and #10 were opened as a **stack**: #9 based on #8's branch, #10 based on #9's.
All three reported MERGED, and **two of them never reached `main`** — #9 merged into
`test/domain-money-math` and #10 into `feat/missing-callables`. GitHub only retargets a
stacked PR onto `main` after its base branch is deleted, and all three were merged within
about thirty seconds, so that never happened. `main` silently lost 1,673 lines. PR #11
restored it.

**Open every PR against `main`.** If two changes genuinely depend on each other, merge the
first before opening the second. A stack makes merge ORDER load-bearing, and nothing warns
you when it goes wrong — every PR still shows a green MERGED badge.

## What landed this session

1. **#15 — the auth data layer, finished.** The repositories had been written, but
   `repositories/index.ts` and `hooks/index.ts` were both still `export {}`, so
   `@splitsutra/core/repositories` and `/hooks` resolved to an empty object and **none of it
   was reachable from either app**. That, not the repositories, was what screens were waiting
   on. Both barrels are populated; `refs.ts` stays unexported on purpose.
2. **`useAuth` / `useProfile`,** with the whole state machine in `hooks/authStore.ts` — plain
   TypeScript, no React, 23 tests. See the note below on why.
3. **#16 — `pnpm seed` runs.** `firebase/seed.ts` had never existed, so nothing imported the
   guard and the script had never been executed once. Merged.
4. **`firebase/seed/` is typechecked now**, via a new `firebase/tsconfig.json` chained from
   the root `typecheck` script. Its first run found two real errors.
5. **An Article VI violation removed** — `dataset.ts` had its own exponent-scaling formatter,
   written before `formatMoney` moved into core in #13.

### 🔴 The `-prod` refusal has now actually fired

Not asserted — run. `pnpm seed --project prod` resolves the `.firebaserc` alias to
`splitsutra-prod` and refuses, printing the target, where it resolved from, and what to run
instead. `--allow-real-project` does **not** get past it, by design. Bare `pnpm seed` also
refuses, because `.firebaserc`'s default is `splitsutra-dev`, which is not `demo-*`.

Against `demo-splitsutra`: 76 documents, every group zero-sum, JPY as `¥46,667` with no
decimal places. Run twice in one emulator session: 76 again, `0 created, 5 refreshed`.

### Why the session logic is in a store and not in the hook

Core cannot depend on `react-dom` (Article II, enforced by `core-is-platform-agnostic`) and
the `unit` vitest project runs on `node`, so **a hook in core has no renderer to be driven
by**. Putting the logic in `hooks/authStore.ts` is what makes it testable at all. `useAuth.ts`
is then a `useSyncExternalStore` binding with no branches in it.

If you add hooks in Phase 05+, follow the same shape: logic in a plain module, hook as binding.

## Traps already hit — do not re-introduce

- **Never stack PRs.** See above. Cost more time than any bug this project has had.
- **A green build is not evidence the thing runs.** Five gates passed while core was
  unloadable. Load the artefact in the real runtime — `node -e "await import('@splitsutra/core/hooks')"`
  from `packages/core` is the check that caught it.
- **A directory covered by no tsconfig is checked by nothing.** `firebase/seed/` sat outside
  the workspace, so `pnpm -r --if-present typecheck` never reached it: 2,100 lines that build
  money records, unchecked. Fixed in #16. **Anything added outside `packages/*`, `apps/*` or
  `firebase/functions` needs a tsconfig and a script that runs it.**
- **Unanchored ignore patterns, three times now.** A bare `lib/` in `.gitignore` silently kept
  `firebase/functions/src/lib/` — `identity.ts` included — out of the repo entirely. ESLint hit
  the same trap; `.prettierignore` hit the inverse by having no entry at all. All three are
  anchored to `firebase/functions/lib/` now. **A bare `lib/` is always wrong in this repo.**
- **Renaming the brand sweeps too far.** It once rewrote the competitor table in `docs/19` into
  a claim about ourselves. `docs/21-name-clearance.md` is excluded on purpose — it records
  which names were _rejected_, so "Settl" must stay spelled that way there.
- **Run the whole gate before pushing.** A push after only `pnpm depcruise` broke CI on four
  PRs at once.
- **`pnpm install` on a partial branch** prunes lockfile importers for workspace packages that
  branch lacks. If it happens, `git checkout -- pnpm-lock.yaml`.

### Testing gotchas found the hard way

- **`?raw` on a `.css` import does not work under Vitest.** It routes every `.css` specifier
  through CSS-modules handling and returns the class-name proxy whatever query you append, so
  you get `Cannot convert a Symbol value to a string`, not source text. Read the file off disk
  — and note `import.meta.url` is an _http_ URL under Vitest, so `fileURLToPath` throws
  `The URL must be of scheme file`. Use the pathname, minus the leading slash before a Windows
  drive letter. `apps/web/src/components/__tests__/Pressable.test.tsx` has the working helper.
- **Vitest projects are defined at the root.** `pnpm --filter @splitsutra/web exec vitest
--project component` fails. Run vitest from the repo root.
- **`vi.mock`'s factory is hoisted above the imports.** Closing over a plain `const` declared
  above it throws "cannot access before initialization". Use `vi.hoisted` — see
  `packages/core/src/hooks/__tests__/authStore.test.ts`.
- **Long heredocs through the shell mangle backslashes and quotes.** A regex written that way
  arrived as `[PARSE_ERROR]`. Write the script to a file and run it.
- 🔴 **happy-dom replaces the global `URL`, and its polyfill resolves RELATIVE references
  wrongly against a `file:` base.** `new URL('../../components/x.css', import.meta.url)` came
  back as `/src/x.css` — leading directories silently dropped — so `readFileSync` failed on a
  path that looked plausible in the error. Parsing an _absolute_ url is fine. Send
  `import.meta.url` through `URL` once, then do every join with `node:path`.
  `apps/web/src/__tests__/helpers/cssSource.ts` is the working version, and
  `Pressable.test.tsx` now uses it too.
- **A component test cannot see a style at all.** happy-dom applies no stylesheet and
  computes no layout, so all 41 dropped declarations above were invisible to a green suite.
  Anything that depends on the cascade has to be asserted against the CSS **source**, or
  measured in a real browser.

## ✅ Fixed earlier: `packages/core` could not be loaded by Node

Core named its **TypeScript source** as its entry points with no build step, so the explicit
`.js` specifiers its imports carry pointed at files nothing ever emitted. `apps/web` never
noticed because Vite transpiles core; `firebase/functions` runs real Node and died with
`ERR_MODULE_NOT_FOUND`.

Core now builds via `packages/core/tsconfig.build.json`, emitting `dist/`. **It compiles under
`NodeNext`, not the base config's `bundler`** — the output has to be loadable by the Node
resolver, so the compiler producing it uses the Node resolver. `tsconfig.json` stays on
`bundler`, so core is checked under **both** resolvers on every verify. `firebase/tsconfig.json`
(the seed) is NodeNext for the same reason: `tsx` is real Node.

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

`pnpm`, `npm` and `firebase` all fail in the owner's **PowerShell**, for two _different_
reasons — but all three work fine from the **Git Bash** shell, which is what this session used:

- **`pnpm` / `firebase` — not on the PowerShell PATH.** Both live in
  `C:\Users\neeth\AppData\Roaming\npm\`. Error is `ObjectNotFound`.
- **`npm` — blocked by execution policy.** It _is_ on PATH, but PowerShell resolves it to
  `npm.ps1` and the policy is Restricted. Error is `SecurityError` — a different failure
  wearing similar clothes.

Workaround needing no setting changed: call the `.cmd` shim by full path, e.g.
`C:\Users\neeth\AppData\Roaming\npm\firebase.cmd login`. Batch files are not subject to the
PowerShell script policy.

Permanent fixes, both the owner's call and neither yet applied: add that directory to the user
PATH, and/or `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Still missing

1. **The web app is not wired to `initFirebase`.** `apps/web/src/auth/firebaseAuth.ts` still
   calls `initializeApp` + `getAuth` itself, so there are two initialisation paths and only one
   of them is the portable one. They cannot coexist: `initializeAuth()` throws
   `auth/already-initialized` against an app `getAuth()` has already touched. **This is the
   next thing to build**, together with the route guards, since it is one change.
2. **Route guards.** `<RequireAuth>` → `/login`, `<RedirectIfAuthed>` on `/login` → `/groups`,
   and a real loading state — `useAuth().loading` is exactly the flag for it. Deep links must
   survive login (AC-B3.3).
3. **Screens.** Every route still renders `PendingScreen`. Delete that file when the last one
   lands. No longer blocked on core — the hooks are on `main` now.
4. **Rules tests exist but are not merged; integration tests do not exist at all.**
   The **harness is already on `main`** — `vitest.config.ts` defines both the `rules` and
   `integration` projects, and `pnpm test:rules` / `pnpm test:integration` each start their own
   emulator (`demo-rules`, `demo-integration`). What is missing is the files.
   `firebase/tests/rules/` is written and waiting in **#24** — merge it and that half is closed.
   🔴 **`firebase/tests/integration/` still does not exist**, so `pnpm test:integration` matches
   zero files and nothing exercises a callable against the emulator: `redeemInvite`, accepting a
   friend request, and `leaveGroup` are all unverified. The emulator-backed suites are also still
   commented out in `.github/workflows/ci.yml` — merging #24 does not by itself make CI run them.
5. **`e2e/specs/` does not exist**, so `pnpm test:e2e` finds nothing. Playwright and its
   Chromium are installed and ready.
6. **Hosting serves nothing** until a build output reaches CI; `apps/web/dist` is local-only.

## Environment — ready, nothing to redo

Node 24.19.0 · pnpm 9.15.9 · Firebase CLI 15.28.1 · JDK 21 (Adoptium, at
`C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot`) · gh authenticated · Playwright
Chromium + ffmpeg installed · emulator JARs cached.

Gotcha: `emulators:exec` does **not** start the UI unless you pass `--ui`. It is a standalone
flag, not an `--only` value.

The seed run that works, verbatim:

```sh
firebase emulators:exec --only firestore,auth --project demo-splitsutra "pnpm seed"
```

🔴 `--only firestore,auth`, never with `functions`. The seed writes its own derived state
(balances, activity feed, comment counters, the usernames index); running the triggers as well
appends a second, non-reproducible copy of the activity feed under `evt_*` ids the script
cannot overwrite on a re-run, which breaks idempotency.

## Dependency policy — latest, with two forced exceptions

- **Node stays 24** though 26 exists: Firebase caps Cloud Functions Gen 2 at `nodejs24`.
- **TypeScript is 6.0.3, not 7.0.2**: `typescript-eslint@8` declares `typescript <6.1.0`, so TS
  7 would silently stop linting the whole repo.

Everything else current: vite 8, vitest 4, eslint 10, zod 4, firebase 12, firebase-admin 14,
firebase-functions 7, dependency-cruiser 18, react-router 8.

## 🔑 Auth is wired (merged as #21; `/login` then rewritten by #22)

The app now initialises Firebase at startup and guards its routes. What is on that branch:

- **`platform/startup.ts`** — tokens → platform adapter → `initFirebase`, in that order,
  returning a result instead of throwing so a missing `.env.local` renders
  `SetupRequiredScreen` naming the variables rather than a blank white page.
- **🔴 A real collision, fixed.** `apps/web/src/auth/firebaseAuth.ts` called `getAuth()` while
  core's `initFirebase()` calls `initializeAuth()` on the same app. The second throws
  `auth/already-initialized`, so whichever ran first won and the loser failed at runtime —
  order-dependent on imports and on which screen you landed on, invisible to typecheck and to
  every test. Resolved by deleting the web app's half; that file now holds only the DOM-bound
  credential flows.
- **⚠️ `popupRedirectResolver: browserPopupRedirectResolver`** must be passed to
  `initFirebase`. `initializeAuth` is the only entry point that takes a persistence strategy,
  but unlike `getAuth` it installs no popup resolver — without it Google sign-in fails with
  `auth/operation-not-supported-in-this-environment` and nothing earlier complains.
- **`auth/AuthGuards.tsx`** — `<RequireAuth>` / `<RedirectIfAuthed>` as layout routes.
- ⚠️ **`SignInScreen`'s hand-built forms are gone** — #22 replaced them with the FirebaseUI
  widget, which owns login and signup for all three providers. The compat bridge is the trick:
  `firebase.initializeApp(config)` resolves to the same `[DEFAULT]` app core already created,
  so the widget and the app share one session and `authStore` still runs `upsertUserProfile`.
  This reversed `checklists/phase-03-auth.md` §2, which had said "DROPPED — do not build this";
  the original reasoning is kept in a `<details>` block there because it was outweighed, not
  wrong. Also on the branch:
  **`AccountScreen`** (summary + sign out), **`EditProfileScreen`** (name + searchable
  currency picker over all 157).
- `useEmulators()` in `firebaseEnv.ts` renamed to **`emulatorsEnabled()`** —
  `react-hooks/rules-of-hooks` matches on the `use` prefix alone and called it a hook.

🔴 **The flash of the login screen comes from collapsing three states into two.** `useAuth`
reports `loading: true / user: null` — "nobody knows yet" — for the first tick of every hard
refresh, while Firebase rehydrates from persistence. A guard that redirects then has already
destroyed the destination by the time the answer arrives.

The destination rides in `location.state`, not `?next=`, and is `safeDestination()`-checked:
`//evil.example` and `/\evil.example` both start with `/` and both resolve to another origin.

⚠️ **Partly driven by hand.** Confirmed: boots against the emulator suite with no
`auth/already-initialized`, `/groups` redirects to `/login` signed out, and per phase-03's exit
criteria **email/password sign-up and sign-in were driven end to end** against the emulator —
one `users/{uid}` written, not duplicated on a second sign-in, session survives a hard refresh.

Still unticked in phase-03 §8: **Google on a real device** (needs a real consent screen) and
**phone OTP with a real number** (the emulator sends no SMS), the `onUserProfileWritten`
integration test, and E2E **E1**. The two rules-test boxes in that section are now ticked
against #24.

📄 `apps/web/.env.local` exists locally (gitignored) pointing at the emulators with project id
`demo-splitsutra` — the `demo-` prefix forces the SDK offline, so this build cannot reach a
real project even if `VITE_USE_EMULATORS` were wrong.

## Next session, in order

1. **Merge [#24](https://github.com/allcottcourt1808/splitsutra/pull/24)** — the rules tests.
   It is the oldest outstanding debt in the repo and it blocks nothing, so it should go first.
   Then decide on [#23](https://github.com/allcottcourt1808/splitsutra/pull/23) (shadcn theme
   docs), which is unrelated to everything else here.

### What #20 changed, and why it is a spec revision rather than a feature

_(#20 is merged. Kept because the reasoning below is the current spec, not a changelog entry.)_

Adding a friend was **unilateral**: `addFriend` resolved a contact and immediately created the
implicit group and both friend docs. `AC-B1.4` said so in as many words. But a friendship IS a
group (D2), so anyone who knew your email could put themselves in a shared group with you and
you had no way to refuse.

Now: `sendFriendRequest` (lookup, writes one `pending` doc) → `respondToFriendRequest`
(accept creates the friendship in one transaction, decline does not) → `cancelFriendRequest`
(sender withdraws). `friendRequests/{fromUid}__{toUid}`, a derived id, so a duplicate request is
impossible by construction and the reciprocal check is a `get` rather than a query.

🔴 **A decline is terminal, not rate-limited.** Consent creates an unsolicited-message surface
the old flow did not have. The escape hatch that makes that safe: the recipient can add the
sender themselves, which auto-accepts — a mis-tap is one tap to undo, a real refusal is
permanent. `cancelled` (sender withdrew) is not a refusal and can be re-sent.

🔴 **The notification is the request.** docs/03 defers a `notifications` collection with push
and this needed none — `useFriendRequests().incoming` is a live subscription, so it appears
without a refresh and clears on every device the moment it is answered. `incomingCount` badges
the Friends tab, folded into the accessible name ("Friends, 2 pending requests").

`addFriend` was **removed, not renamed** — a teardown, correctly: its contract changed. Nothing
referenced it and nothing is deployed, so nothing broke.

⚠️ **Still owed for #20:** the three callables have **no tests**. #24 covers the
`friendRequests` _rules_ (`friendRequests.test.ts` — get, list, write), but rules tests cannot
reach a callable, so **decline-is-terminal, the mutual auto-accept, and the accept transaction
remain unverified against an emulator**. Those need `firebase/tests/integration/`, which does
not exist. `docs/09` lists them; they are now the highest-value tests outstanding in the repo.

2. **Wire the web app to core** — this is what makes #20 actually run. The Friends screens
   render today but no call reaches a backend.
3. ~~**Details for that wiring**~~ — merged as #21/#22; see the auth section above. What is
   left of it: Google on a real device and phone OTP with a real number, both manual.
4. **Screens**, replacing `PendingScreen` one route at a time. `/friends/:uid` and `useFriend`
   are the ones currently being worked — see the `feat/friend-detail` section above; they are
   in the working tree, uncommitted and unverified.
5. 🔴 **`firebase/tests/integration/`** — the real gap now that #24 exists. `redeemInvite`
   (expired/used/double-redeem), accepting a friend request (idempotent, writes both sides),
   `leaveGroup` at a non-zero balance. These are the items left unticked in phase-05 §9 and
   phase-03 §8 precisely because no rules test can reach a callable.
6. **`e2e/specs/`**, which still does not exist. Independent of 2–4 — a good parallel track.
7. **Uncomment the emulator-backed suites in `.github/workflows/ci.yml`** once 5 exists,
   otherwise none of this runs in CI.

</details>
