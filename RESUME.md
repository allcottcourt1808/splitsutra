# Resume here

**Last updated:** 2026-08-28. Project: **SplitSutra**.
Repo: <https://github.com/allcottcourt1808/splitsutra> (public).
Checkout: `C:\Users\neeth\coding\splitsutra`.

## State: PRs #1–#19 merged. One PR open (#20). `main` is green.

`main` carries the workspace, the core domain, the design system, the navigation shell, the
Firestore rules and triggers, all twelve Cloud Functions, and — new since the last
checkpoint — **the auth data layer, the hooks that unblock screens, a seed script that
actually runs, and a design system whose styles actually reach the page**.

Verified on the #19 branch, and in a real browser against both `pnpm dev` and a production
`vite build` + `vite preview`:
`typecheck` (both resolvers) · `lint` · `depcruise` (188 modules, 519 deps) · `format:check` ·
**287 tests** (194 unit + 93 component).

### The one open PR

| PR                                                            | What                                      | Ready?          |
| ------------------------------------------------------------- | ----------------------------------------- | --------------- |
| [#19](https://github.com/allcottcourt1808/splitsutra/pull/19) | CSS cascade layers — 41 dead declarations | ✅ **merge it** |

Based on `main` directly, like every other branch here.

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
4. **No rules tests or integration tests.** `firebase/tests/rules/` does not exist and the
   emulator-backed suites are still commented out in `.github/workflows/ci.yml`. Independent of
   everything above, so it can be done in parallel.
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

## 🔑 Auth is wired (branch `feat/auth-wiring`)

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
- **`SignInScreen`** (email + password with a sign-up switch, Google popup, phone OTP),
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

⚠️ **Not yet driven by hand.** Confirmed: boots against the emulator suite with no
`auth/already-initialized`, and `/groups` redirects to `/login` signed out. Actually signing in
through each of the three forms is still an unticked box in phase-03 §8, along with the rules
tests and E2E **E1**.

📄 `apps/web/.env.local` exists locally (gitignored) pointing at the emulators with project id
`demo-splitsutra` — the `demo-` prefix forces the SDK offline, so this build cannot reach a
real project even if `VITE_USE_EMULATORS` were wrong.

## Next session, in order

1. **Merge [#20](https://github.com/allcottcourt1808/splitsutra/pull/20)** — friend requests.

### What #20 changed, and why it is a spec revision rather than a feature

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

⚠️ **Still owed for #20:** the three callables have **no tests**, and `firebase/tests/rules/` is
still empty — so decline-is-terminal, the mutual auto-accept, and the accept transaction are
unverified against an emulator. `docs/09` lists them; they are the highest-value tests
outstanding in the repo.

2. **Wire the web app to core** — this is what makes #20 actually run. The Friends screens
   render today but no call reaches a backend.
3. ~~**Details for that wiring**~~ — done on `feat/auth-wiring`; see the section above.
   What is left of it: sign in through each of the three forms against the emulator by hand,
   and the phase-03 §8 tests.
4. **Screens**, replacing `PendingScreen` one route at a time.
5. **Rules tests** (`firebase/tests/rules/`), then `e2e/specs/`. Independent of 2 and 3 — a
   good parallel track.
