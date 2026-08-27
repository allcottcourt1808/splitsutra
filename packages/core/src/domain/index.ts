/**
 * `@splitsutra/core/domain` — the money math barrel.
 *
 * Everything re-exported here is a **pure function over integers** (Article VII):
 * no I/O, no Firebase, no React, no clock, no unseeded randomness. The client
 * imports these for optimistic display and the Cloud Functions import the *same*
 * symbols for the authoritative write — there is never a second implementation
 * (Article VI, and `firebase/functions/src/common/contracts.ts` is the seam that
 * pins the contract down).
 *
 * Named re-exports rather than `export *`, matching `src/theme/index.ts`: the list
 * below is the public surface of the split engine, and adding to it should be a
 * deliberate act.
 *
 * ⚠️ **`SplitMethod` is deliberately not re-exported here.** The canonical
 * declaration is `src/types/expense.ts`, where it is inferred from
 * `splitMethodSchema` so the Zod enum and the union can never drift. `domain/`
 * cannot import it — `types/expense` reaches `types/primitives`, which carries an
 * `import type { Timestamp } from 'firebase/firestore'`, and the `domain-is-pure`
 * rule in `.dependency-cruiser.cjs` runs with `tsPreCompilationDeps: true`, so even
 * an erased type-only edge to the Firebase SDK fails the build. `domain/splits.ts`
 * therefore re-declares the union locally for its own use. Re-exporting that second
 * declaration from this barrel would make `SplitMethod` an ambiguous star export in
 * the package root barrel (TS2308). Consumers take it from `@splitsutra/core/types`.
 *
 * @see docs/04-split-engine.md — the specification every function here implements.
 */

export {
  MAX_WEIGHT,
  allocate,
  allocateToUids,
  assertParticipants,
  assertValidTotal,
  compareUid,
  type ParticipantAllocation,
  type WeightedParticipant,
} from './allocate.js';

export {
  TOTAL_BASIS_POINTS,
  computeSplits,
  splitEqual,
  splitExact,
  splitPercent,
  splitShares,
  type ExactEntry,
  type PercentEntry,
  type ShareEntry,
  type SplitAllocation,
  type SplitInput,
} from './splits.js';

export {
  assertZeroSum,
  computeBalances,
  toBalanceList,
  type Balance,
  type BalanceMap,
  type Ledger,
  type LedgerExpense,
  type LedgerSettlement,
  type PaidByEntry,
  type SplitEntry,
} from './balances.js';

export { applyTransfers, simplifyDebts, type Transfer } from './simplify.js';

export { DomainError, type DomainErrorCode } from './errors.js';

export { hashToInt } from './hash.js';
