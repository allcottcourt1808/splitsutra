# Resume here

**Stopped:** 2026-08-24, mid Phase 01. **Nothing is committed** — `git log` is empty; all work
below sits uncommitted in the working tree.

## Environment — done, nothing to redo

Node 24.19.0 · pnpm 9.15.9 · Firebase CLI 15.28.1 · Temurin JDK 21.0.12.1 · gh 2.98.0 ·
VS Code 1.134.0 + 6 extensions · `.vscode/` workspace config checked in.
`pnpm install` **has been run** — 1086 packages, exit 0, no unmet peer warnings.
Only `firebase login` remains, and that belongs to Phase 02.

⚠️ `gh` needed a manual PATH fix (its installer skipped it) — added to the **user** PATH.

## Decisions settled this session

| #            | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q15 / R5** | **Node 20 → 24.** Node 20 EOL'd 2026-04-30; Node 22 is Maintenance-only. Node 24 is Active LTS and a supported Functions Gen 2 runtime. Propagated everywhere.                                                                                                                                                                                                                                                                                 |
| **Q17 / R7** | **FirebaseUI dropped.** `firebaseui@6.1.0` supports SDK 9–10 only and pnpm flagged it as an unmet peer against SDK 11. Decisive argument: doc 02 already said it is web-only and does not port, so Phase 12 needed custom screens regardless. Auth now uses the modular `firebase/auth` SDK. Fully propagated — dependency removed, `vite.config` pre-bundling removed, and the depcruise rule turned from a **carve-out into a blanket ban**. |

## The one open decision — the name 🔴

**"SplitSutra" failed clearance** (three live expense-splitting apps use it: SplitSutra Financial
Corporation on iOS, `settl.fyi`, `settlapp.in`). Recorded as **Q16 / R6**.

- An English round completed and recommended **Fairden**; runners-up Dutch, Reckon and
  Parity were all confirmed dead. Written up in [docs/21-name-clearance.md](docs/21-name-clearance.md).
- The owner then asked for an **Indian name — Malayalam explicitly welcome.** That research
  was **stopped before delivering**; it had screened part of a candidate list and found
  several already dead. **Re-run it.**
- Worth carrying into that round: the primary market is the US (Q4/Q11), so pronounceability
  and spell-after-hearing carry real weight; and the Indian-language namespace in this
  category may be _more_ crowded than the English one, not less.

⚠️ **Do not reserve a Firebase project ID until this is settled** — IDs are globally unique
and permanent.

### The rename is already tooled

```bash
./scripts/rename-brand.sh <newname>        # dry run
./scripts/rename-brand.sh <newname> --go   # apply
```

⚠️ **Why it is safe:** `settle`, `settled`, `settlement`, `settlementId`, `settleUp` are
_domain vocabulary_, not the brand — splitsutraing up is the product's core concept. A naive
`s/splitsutra/newname/` would rewrite `Settlement` and break Firestore field names silently.
Every pattern in the script matches `splitsutra` only when **not** followed by `e`, and the
competitor references in the clearance docs are protected. Three manual steps remain
afterwards; the script prints them.

## Code state

| Area                                  | State                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| Root config, CI, depcruise rules      | ✅ complete                                                                              |
| `packages/core/src/types`             | ✅ complete — 11 schemas, converters, barrels, `callables.ts`                            |
| `packages/core/src/theme`, `platform` | ✅ complete                                                                              |
| `packages/core/src/domain`            | ⚠️ algorithms written, barrel written, **zero tests**                                    |
| `apps/web`                            | ⚠️ config + design-system components; **no `main.tsx`, no routes, no screens**           |
| `firebase/`                           | ⚠️ rules + `common/` helpers; **no `src/index.ts`, so no function is exported**; no seed |

## Known issues waiting to be fixed

1. **`pnpm format` has never run.** The eleven pre-existing `types/*.ts` files omit
   semicolons while `.prettierrc.json` sets `"semi": true`, so `format:check` currently
   fails on all of them. Five lines also exceed `printWidth: 100`. One `pnpm format` fixes it.
2. **`MAX_AMOUNT_MINOR` is duplicated** in `firebase/functions/src/common/config.ts`, and the
   group cap is spelled `GROUP_MAX_MEMBERS` there vs `MAX_GROUP_MEMBERS` in core. Values agree
   today — but this is an **Article VI violation** (one implementation of the money math) and
   the differing names make future drift hard to spot. Import from core instead.
3. **`SplitMethod` is declared twice** — `types/expense.ts` (Zod-backed) and `domain/splits.ts`
   (bare union, keeping domain Zod-free). `src/index.ts` disambiguates with an explicit
   re-export; if the domain barrel changes, that line may become removable.
4. **`pnpm verify` has never passed** — it has not been run end-to-end yet.

## Dependency staleness — a deliberate hold, not an oversight

firebase ^11 (latest 12.18) · firebase-functions ^6.5 (7.3.2) · zod ^3.25 (4.4.3) ·
vitest ^3.2 (4.1.11) · typescript ^5.9 (**7.0.2**) · dependency-cruiser ^16 (18.2.0).

Left alone on purpose: schemas are written against zod 3, the test config uses the vitest 3
projects API, and TS 7 is the new Go-based compiler. Upgrading is a deliberate task for after
`verify` is green, not a drive-by. Only `firebase-tools` was corrected (`^14.9.0` → `^15.28.1`)
because it contradicted the installed CLI.

## Next session, in order

1. Re-run the Indian/Malayalam name research → pick → run the rename script.
2. Finish the three partial areas: domain **tests**, web `main.tsx`/routes/screens/auth,
   `firebase/functions/src/index.ts` + seed.
3. `pnpm format`, then `pnpm verify` — first real end-to-end run.
4. First commit.
