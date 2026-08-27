/**
 * `@splitsutra/core` repositories barrel — **every** Firestore read and write in the product.
 *
 * Skeleton only. Article VIII: screens never touch Firestore. A repository is the only place a
 * `collection()`, `doc()`, `onSnapshot()` or `setDoc()` call may appear, which is what keeps the
 * data layer portable to React Native — and it is enforced mechanically by the
 * `screens-never-touch-firestore` rule in `.dependency-cruiser.cjs`.
 *
 * Every read goes through the converters in `src/types/converters.ts`, so a malformed document
 * fails here rather than in a component.
 *
 * What lands here:
 * - **Phase 03** — `authRepo.ts` (`onAuthStateChanged` wrapper, `signOut`) and `userRepo.ts`
 *   (`upsertUserProfile`) — checklists/phase-03-auth.md.
 * - **Phase 05** — `groupRepo.ts`, `friendRepo.ts` — checklists/phase-05-friends-groups.md.
 * - **Phases 06–08** — `expenseRepo.ts`, `settlementRepo.ts`, `commentRepo.ts`,
 *   `activityRepo.ts`.
 */

// populated in Phase 03
export {};
