/**
 * `@splitsutra/core` repositories barrel — **every** Firestore read and write in the product.
 *
 * Article VIII: screens never touch Firestore. A repository is the only place a `collection()`,
 * `doc()`, `onSnapshot()` or `setDoc()` call may appear, which is what keeps the data layer
 * portable to React Native — and it is enforced mechanically by the
 * `screens-never-touch-firestore` rule in `.dependency-cruiser.cjs`.
 *
 * Every read goes through the converters in `src/types/converters.ts`, so a malformed document
 * fails here rather than in a component.
 *
 * 🔴 **Not re-exported from the package root barrel**, and it must stay that way: everything
 * below carries a runtime `firebase/*` import, and the root barrel reaches every consumer —
 * `firebase/functions` included, which uses the admin SDK instead. Consumers reach this through
 * the `@splitsutra/core/repositories` subpath declared in `package.json`.
 *
 * What lands here next:
 * - **Phase 05** — `groupRepo.ts` — checklists/phase-05-friends-groups.md.
 * - **Phases 06–08** — `expenseRepo.ts`, `settlementRepo.ts`, `commentRepo.ts`,
 *   `activityRepo.ts`.
 */

/* ── The `onSnapshot` seam. Every realtime subscription funnels through these two. ─────────── */
export * from './subscribe.js';

/* ── Firebase Auth, wrapped: who is signed in, the ID token, and signing out. ──────────────── */
export * from './authRepo.js';

/* ── `users/{uid}` — the self-healing profile upsert, and the profile subscription. ────────── */
export * from './userRepo.js';

/* ── The callable Cloud Functions seam: everything Rules deny the client directly. ─────────── */
export * from './callables.js';

/* ── `users/{uid}/friends` — the established friendships. Function-written, owner-readable. ── */
export * from './friendRepo.js';

/* ── `friendRequests/{id}` — the consent step, and the in-app notification it doubles as. ──── */
export * from './friendRequestRepo.js';

/* ── `groups` + `groups/{gid}/members` — the group list, detail, and the callable seams. ─── */
export * from './groupRepo.js';

/* ── `groups/{gid}/expenses` — drafts, the checksum invariants, and soft delete. ──────────── */
export * from './expenseRepo.js';

/* ── `groups/{gid}/settlements` — recording a payment between two members. ────────────────── */
export * from './settlementRepo.js';

/* ── `groups/{gid}/activity` — read-only (T8). One query per group; see activityRepo. ───── */
export * from './activityRepo.js';

/* ── `…/expenses/{eid}/comments` — the ADR-11 correction channel. Never updatable (T12). ── */
export * from './commentRepo.js';

/**
 * 🔴 `./refs.js` is deliberately **not** re-exported.
 *
 * Handing a screen a `DocumentReference` is Article VIII with extra steps — it can `getDoc()`
 * that reference without ever importing Firestore itself, which is exactly the coupling the
 * article exists to prevent. The references stay internal to this folder; what leaves it is
 * functions that have already done the read or the write.
 */
