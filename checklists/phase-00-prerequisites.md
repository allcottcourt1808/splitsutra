# Phase 00 — Prerequisites & Tooling

**Est. 1–2 hours.** Nothing here is optional; every later phase assumes it.
Verified on this machine: only **Git 2.55.0** is installed. Everything else is missing.

---

## Install

- [x] ✅ **Node.js 24 (Active LTS)** — installed 24.19.0 via winget. ⚠️ Changed from Node 20: Node 20 hit EOL 2026-04-30 and Node 22 is Maintenance-only. See [../docs/19-qa-log.md](../docs/19-qa-log.md) R5.
  - [x] ✅ Verify: `node --version` → `v24.19.0`
  - [ ] Verify it's on the PATH in **both** PowerShell and Git Bash
- [x] ✅ **pnpm 9.15.9** — matches the `packageManager` pin in the root `package.json`
  ```bash
  npm install -g pnpm@9.15.9
  ```
  - [x] ✅ Verify: `pnpm --version` → `9.15.9`
  - ⚠️ **`corepack enable` fails on Windows** with `EPERM: operation not permitted` —
    corepack writes its shims into the Node install directory under `C:\Program Files`,
    which needs an elevated shell. `npm install -g pnpm` writes to the user-writable npm
    prefix instead and needs no elevation. Same result, no UAC prompt.
- [x] ✅ **Java JDK 21** (Temurin 21.0.12) — installed via winget
  - **Required by the Firestore and Auth emulators.** Without it, `firebase emulators:start`
    fails with a confusing error.
  - [x] ✅ Verify: `java -version` → Temurin 21.0.12.1 LTS
- [x] ✅ **Firebase CLI 15.28.1**
  ```bash
  npm install -g firebase-tools
  ```
  - [x] ✅ Verify: `firebase --version` → `15.28.1`
  - [ ] `firebase login` — completes in the browser
- [x] ✅ **VS Code 1.134.0** + extensions installed: ESLint, Prettier, Vitest Explorer, Playwright, Firebase (`toba.vsfire`), EditorConfig. Workspace config committed in `.vscode/` — see below.
- [x] ✅ **gh CLI 2.98.0** — installed via winget.
  - ⚠️ The installer did **not** add `C:Program FilesGitHub CLI` to PATH. Appended to the
    **user** PATH (machine PATH left alone). Open a new terminal for `gh` to resolve.

## Accounts

- [ ] 🔴 Google account for the Firebase console
- [ ] 🔴 GitHub — [@allcottcourt1808](https://github.com/allcottcourt1808) ✅ have it
- [ ] 🔴 **A billing account linked and ready for Blaze** (see Phase 02)

## Windows-specific

- [x] ✅ Decide on **one** shell and stay in it. PowerShell and Git Bash have different
      quoting rules; mixing them mid-project causes avoidable script breakage.
      Recommendation: PowerShell for tooling, Git Bash for anything POSIX.
- [x] ✅ Configure git line endings so CI (Linux) and local (Windows) agree — set **repo-local**, not global, so nothing else on this machine changes:
  ```bash
  git config core.autocrlf input
  ```
- [ ] 🟢 If `pnpm` scripts fail with an execution-policy error in PowerShell:
  ```
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```
- [ ] 🟢 Consider enabling Windows **long path support** — deep `node_modules` trees in a
      monorepo occasionally exceed the 260-char limit.

## Decisions — resolved

- [x] ✅ **Q1–Q8, Q11, Q13 answered.** Register: [../docs/19-qa-log.md](../docs/19-qa-log.md)
- [x] ✅ **Name: SplitSutra** · **Currency: USD** · **Region: `us-central1`** (⚠️ permanent)
- [x] ✅ **Billing: stay on free Spark until Phase 11** — Phases 00–10 cost $0
- [ ] 🟢 Q9, Q10, Q12 are Phase 13 (ads) — **not blocking**

## Name clearance 🟡 _Ten minutes now beats renaming after publish_

> 🔴 **RESULT for the original codename: clearance FAILED.** Searched 2026-08-24. **Settl**
> was already in live use by at least three expense-splitting apps: _Settl: Split_ (Settl
> Financial Corporation, iOS), _Settl_ (AI splitter, `settl.fyi`, iOS + Android), and _Settl_
> (UPI splitter, `settlapp.in`) — a direct collision in the identical product category.
>
> ✅ **Resolved 2026-08-27: the project was renamed to `SplitSutra`.** Recorded as **Q16 / R6**
> in [../docs/19-qa-log.md](../docs/19-qa-log.md).
>
> ⚠️ `SplitSutra` has **not** been clearance-checked itself. Run the sweep in
> [../docs/21-name-clearance.md](../docs/21-name-clearance.md) before Phase 02 reserves a
> Firebase project ID — that is the permanent, globally-unique step, and the point after
> which a rename stops being cheap.

`SplitSutra` is chosen. Still to verify before Phase 02:

- [ ] 🟡 **USPTO search** — [tmsearch.uspto.gov](https://tmsearch.uspto.gov), classes 9
      (software) and 36 (financial services). Search "splitsutra", "settle", "settled".
- [ ] 🟡 **App Store + Google Play** search for "SplitSutra" and "Settle"
- [ ] 🟡 **Domain** — `splitsutra.app` and `splitsutra.com`. `.app` is likely gettable and a fine
      primary for this product.
- [ ] 🔴 ⚠️ **Reserve the Firebase project IDs early** — globally unique, first-come. If
      `splitsutra-dev` is taken, fall back to `splitsutra-app-dev` and update
      [phase-02-firebase-setup.md](phase-02-firebase-setup.md).
- [ ] 🟢 If clearance fails, the runners-up were **Dutch**, **Reckon**, **Parity** —
      recorded in [../docs/12-decisions.md](../docs/12-decisions.md) Q3

> The dropped `e` moves out of the crowded "debt settlement" trademark space, which
> improves the position but does not guarantee it.

---

## VS Code workspace — checked in at `.vscode/`

Committed deliberately: these are project settings, not personal preferences, and every
one of them exists to stop the editor and CI disagreeing.

| File              | What it does                                                           |
| ----------------- | ---------------------------------------------------------------------- |
| `extensions.json` | Prompts for the six extensions on first open                           |
| `settings.json`   | Format-on-save, ESLint autofix, workspace TypeScript, noise exclusions |
| `tasks.json`      | `verify`, `dev — web`, `emulators`, unit-test watch, `depcruise`       |
| `launch.json`     | Debug the web app in Chrome; debug the current Vitest file             |

Three settings are load-bearing rather than cosmetic:

- **`"files.eol": "\n"`** — git is set to `autocrlf input` and CI is Linux. Without this,
  files authored on Windows land as CRLF and every save becomes a whole-file diff.
- **`"eslint.useFlatConfig": true`** — the repo uses `eslint.config.js`, not `.eslintrc`.
  Without it the extension silently lints nothing and the editor looks clean while CI fails.
- **`"typescript.tsdk": "node_modules/typescript/lib"`** — pins the editor to the workspace
  TypeScript. Otherwise VS Code's bundled version can disagree with `pnpm typecheck` about
  the same file, which is a genuinely confusing hour to lose.

⚠️ The Vitest and Playwright extensions need `pnpm install` to have run before they can
discover tests. They will show an empty tree until then — that is expected, not a fault.

## Exit criteria

All five commands succeed in a fresh terminal:

```bash
node --version && pnpm --version && java -version && firebase --version && git --version && gh --version
```

- [x] ✅ All six print a version (node 24.19.0, pnpm 9.15.9, java 21.0.12.1, firebase 15.28.1, git 2.55.0, gh 2.98.0)
- [ ] `firebase login` shows your account
- [ ] Project name and region are decided and written into
      [../docs/12-decisions.md](../docs/12-decisions.md)
