# 12 — Decision Log & Open Questions

## Part 1 — Decisions already made

Recorded so that "why is it like this?" has an answer in six months.

---

### ADR-01 — pnpm monorepo, not a single app

**Decision:** `packages/core` (logic) + `apps/web` (pixels), with `apps/mobile` later.
**Why:** The stated goal is a native app later. Extracting logic from a coupled React app
after the fact is a rewrite; starting with the boundary costs about a day.
**Cost:** Workspace tooling complexity, and Metro monorepo config in Phase 12.
**Rejected:** Single Vite app (blocks the mobile goal); Expo universal (see ADR-02).

### ADR-02 — React web now, React Native later; not Expo universal

**Decision:** Separate web and mobile apps sharing `core`.
**Why:** Expo/react-native-web gives ~90% UI reuse but a heavier, slower web bundle and a
quirkier web DX; and Firebase **phone auth on RN via the JS SDK is genuinely painful**
(deprecated reCAPTCHA webview shims). This split gets a fast, conventional web app now and
a properly native mobile app later using `@react-native-firebase`.
**Cost:** UI components written twice (~30% of lines). Mitigated by the portability
contract in [02-architecture.md](02-architecture.md).

### ADR-02a — Why React and not Angular or Vue

**Decision:** React for the web app.

**First, a correction to a common assumption: Firebase is framework-agnostic.** The
`firebase` npm package is plain TypeScript with no framework dependency — the same
`getFirestore()` / `onSnapshot()` calls work from React, Vue, Svelte, Angular, Node, or
vanilla JS. Nothing in `packages/core` would change if the UI framework changed.

The impression that Firebase is Angular-flavoured usually comes from three places: the
Firebase Console is itself an Angular app (a Google dashboard detail, unrelated to what you
build); **AngularFire** is prominent in the docs but is a binding library, one of several
alongside VueFire and various React hook packages; and AngularFire was one of Firebase's
earliest official client libraries, predating Google's 2014 acquisition.

**Why React specifically:** the native-mobile goal decides it. React Native shares React's
component model, hooks, and JSX, which is what lets `packages/core` — hooks and stores
included — run **unchanged** on mobile. That is the entire premise of the monorepo split
(ADR-01) and the reason Phase 12 is a port rather than a rewrite.

Angular has no comparable native path — NativeScript-Angular has a small, largely dormant
ecosystem, and Ionic/Capacitor ships a webview rather than a native app. Choosing Angular
would mean rewriting mobile from scratch and maintaining two implementations of the split
engine, which Article VI forbids.

**In fairness:** Angular is a strong framework and AngularFire is a good library. For a
web-only build this would be a defensible choice. The mobile requirement is what settles it.

### ADR-02b — Client-side rendering, no SSR

**Decision:** `apps/web` is a client-rendered SPA. Vite build, React Router v7 in
**declarative** mode (not framework/Remix mode), Firebase Hosting with the SPA rewrite
`** → /index.html`.

**Why not SSR:**

1. **Everything is behind a login.** No public content, so the headline SEO benefit is
   worth nothing — a group's expense list is neither indexable nor something you'd want
   indexed.
2. **Firestore is already a realtime sync engine.** The client holds `onSnapshot`
   subscriptions; a server-rendered snapshot is stale the moment it's sent, and the client
   re-renders immediately anyway.
3. **Firebase Auth is client-side by design.** SSR-ing authenticated content requires
   session cookies (`__session` — the only cookie Firebase Hosting forwards to functions),
   Admin SDK verification per request, and refresh handling. Real infrastructure with
   subtle failure modes.
4. **Cost.** SSR needs a server — a Cloud Function or Cloud Run instance per page request,
   converting free static hosting into metered compute. Conflicts directly with
   [18-cost-control.md](18-cost-control.md).
5. **React Native has no SSR.** Server-rendering patterns don't port, so it would be
   complexity in `apps/web` that Phase 12 cannot reuse (Article II).

**How NFR-1 (FCP < 1.8s) is met instead:** route-level code splitting, `/login` split so
`firebase/compat` + `firebaseui` never load for signed-in users, a 350 KB gzipped budget
enforced in CI, and skeleton shells that paint immediately.

**When to revisit:** a public marketing page, or public shareable expense links. The answer
then is **static generation for those pages only** — free, no server — via a separate
Astro/Next static site on the same Hosting project, or React Router v7 framework mode for
prerendering. **The authenticated app stays a SPA regardless.**

### ADR-03 — FirebaseUI drop-in auth

**Decision:** Use FirebaseUI Web for the sign-in screen (your choice).
**Why:** Email + phone + Google + account linking + password reset + email verification,
all working, in roughly an afternoon. Auth UI is high-effort, low-differentiation work.

**Known costs — accepted, with mitigations:**

| Cost                                                                              | Mitigation                                                                       |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| FirebaseUI Web is in low-maintenance mode                                         | Pin the version; quarantined to one file                                         |
| `react-firebaseui` wrapper is abandoned (React 16 peers, breaks under StrictMode) | **Don't use it.** Mount the vanilla `firebaseui` package on a ref in `useEffect` |
| Requires the `firebase/compat` shim (~100 KB gz)                                  | Import compat **only** in that one file; code-split behind `/login`              |
| Limited visual customisation                                                      | Acceptable for v1; swapping to custom screens is a one-file change               |
| **No FirebaseUI for React Native**                                                | Phase 12 writes native login screens against the same `useAuth()` contract       |

The `useAuth()` abstraction is what makes every one of these reversible.

### ADR-04 — Blaze plan with server-authoritative balances

**Decision:** Cloud Functions own all balance computation; clients cannot write balances.
**Why:** On Spark, balance math would run client-side protected only by Security Rules —
and rules cannot express "recompute the sum of a subcollection". A client could zero out
its own debt. Blaze removes that entire class of problem.
**Cost:** No hard spending cap. Mitigated by budget alerts, `maxInstances`, and App Check
([10-deployment.md](10-deployment.md)).

### ADR-04a — Firebase over Supabase, PocketBase, and the rest

**Decision:** stay on Firebase. Revisited explicitly against the "keep costs near zero"
constraint.

**The framing that settles most of it: we are comparing $0 to $0.** Firebase's free tier
covers this app to roughly 500 DAU ([18-cost-control.md](18-cost-control.md)). Supabase's
free tier covers a similar range. There is **no cost saving available at the scale this
app will plausibly reach for a long time**, so the comparison is really about risk profile
and fit.

|                     | **Firebase**                  | **Supabase**                 | **PocketBase**                  | **Cloudflare**      |
| ------------------- | ----------------------------- | ---------------------------- | ------------------------------- | ------------------- |
| Model               | Metered per-op                | **Flat $25/mo** above free   | $5 VPS, flat                    | Metered, very cheap |
| Free tier           | 50k reads/day, 2M fn calls/mo | 500 MB db, 50k MAU           | n/a (self-host)                 | 100k req/day        |
| Cost risk           | ⚠️ **Unbounded**              | **Predictable**              | **Fixed**                       | Low                 |
| Balance recompute   | N document reads              | ✅ **one SQL aggregate**     | one SQL aggregate               | one SQL aggregate   |
| Offline persistence | ✅ **Best-in-class**          | Weak                         | None                            | None                |
| Drop-in auth UI     | ✅ FirebaseUI                 | Weaker, in maintenance       | Basic                           | Roll your own       |
| **Phone/SMS auth**  | ✅ **Bundled**                | ⚠️ **Bring your own Twilio** | ⚠️ BYO                          | ⚠️ BYO              |
| Ops burden          | None                          | None                         | ⚠️ **You own uptime + backups** | Low                 |

**The strongest argument _for_ switching — and it is genuinely strong.** Our balance
recompute (ADR-07) reads every expense in a group on every write, ~25 reads for a typical
group. That design exists _because Firestore cannot cheaply aggregate server-side_. In
Postgres it is one `SELECT SUM(...) GROUP BY`, and the zero-sum invariant could be a
database `CHECK` constraint rather than an application assertion. Supabase would make the
hardest part of this system simpler **and** cheaper.

**Why we're staying anyway — four reasons, in order of weight:**

1. **Phone auth would get _more_ expensive, not less.** Supabase does not bundle SMS; you
   wire your own Twilio account and pay per message on top of the subscription. Phone login
   was an explicit requirement, and Firebase includes it.
2. **Offline persistence matters for this app's shape.** Adding an expense at a restaurant
   table with bad signal is a core use case. Firestore's offline cache is the best in the
   category; Supabase's is markedly weaker, and this would become real work.
3. **FirebaseUI was a deliberate choice** (ADR-03). Supabase's equivalent is thinner and
   itself in maintenance mode — we'd be trading one maintenance-mode dependency for another,
   with less functionality.
4. **The cost risk is already mitigated.** The unbounded-spend concern is Firebase's real
   weakness, and the kill switch in [18-cost-control.md](18-cost-control.md) §6 converts it
   into a hard $5 ceiling.

Also considered and rejected: **PocketBase** (cheapest at $5/mo flat forever, but you own
uptime, backups, and scaling — real work for a solo developer, and the failure mode is your
app being down while you're asleep); **Cloudflare D1 + Workers** (excellent pricing, but D1
is still maturing and auth would be assembled from parts); **AWS Amplify** (comparable
metered model, worse DX, not cheaper).

**The escape hatch — this is why the decision is low-risk.** Article VIII confines _all_
database access to `packages/core/src/repositories`. Screens never touch Firestore. A
backend swap therefore rewrites one directory, not the app: the domain layer, hooks,
stores, and every screen are untouched. **If cost or the recompute amplification ever
becomes a genuine problem, migrating to Supabase is a contained project rather than a
rewrite.** Revisit if reads exceed the free tier consistently, or if the Phase 10
measurements show recompute cost scaling badly.

### ADR-05 — Integer minor units for all money

**Decision:** `amountMinor: number`, branded, integers only.
**Why:** Float arithmetic makes groups that can never settle to zero. See
[04-split-engine.md](04-split-engine.md).
**Rejected:** `bigint` (doesn't serialize to Firestore), decimal.js (extra dependency that
must also work on RN).

### ADR-06 — A 1:1 friend expense is a hidden 2-person group

**Decision:** No separate non-group expense path; implicit groups with `isImplicit: true`.
**Why:** One expense pipeline, one rules block, one balance engine. Probably the single
largest simplification in the whole design.
**Cost:** A few extra group documents, and remembering to filter `isImplicit` out of the
group list.

### ADR-07 — Full balance recompute, not incremental deltas

**Decision:** Recompute a group's balances from its full ledger on every write.
**Why:** Idempotent and self-healing. Firestore triggers fire at-least-once; incremental
deltas drift permanently the first time an event is duplicated or dropped.
**Cost:** Reads scale with group size. Bounded by `RECOMPUTE_THRESHOLD` and revisited with
real measurements in Phase 10. See open question Q2.

### ADR-08 — All currencies supported; one currency **per group**; no conversion in v1

**Decision:** The app supports the full ISO 4217 currency set. Each _group_ picks one
currency at creation, immutable thereafter. A user's overall summary lists each currency on
its own line and never sums across them. No FX conversion in v1.
**Why:** supporting every currency is cheap (a static table); _converting_ between them is
a real feature needing rate sources, historical rates, and a decision about when the rate
is fixed. Splitting those apart lets us ship the easy 90%.
**Forward compatibility:** the multi-currency design is specified in
[03-data-model.md](03-data-model.md) so v2 is an additive change, not a migration. The key
constraint recorded now: **an expense must store the FX rate that applied on its own date.**
Converting on read with today's rate would silently rewrite history.

### ADR-11 — Only the creator or a group admin can edit an expense

**Decision:** Editing and deleting an expense is restricted to `createdBy` or a group
admin. Every member can instead **open a discussion thread** on any expense.
**Why:** the permissive model (anyone edits anything) means someone can silently rewrite
your record of what you paid. Discussion is the better social primitive — you ask "wasn't
this $40?" rather than changing it behind their back, and the conversation stays attached
to the expense as context.
**Cost:** one extra round-trip when a correction is genuinely needed. Admin override
covers the case where the creator has left the group.
**Consequence:** comments stop being a nice-to-have and become the mechanism that makes
restricted editing workable. Phase 08 rises in priority accordingly.

### ADR-09 — Soft delete everywhere

**Decision:** `deletedAt` timestamps; nothing leaves the ledger.
**Why:** Money records need an audit trail, and "who deleted that expense?" is a real
question in shared-expense apps.

### ADR-10 — Design tokens as plain TS, not Tailwind

**Decision:** `core/theme/tokens.ts`, emitted as CSS variables for web.
**Why:** Tailwind class strings are meaningless to React Native. One token object serves
both platforms and keeps them visually identical for free.
**Cost:** Slower initial styling than Tailwind. Accepted for the portability guarantee.

---

## Part 2 — Questions & answers

Q1–Q7 answered 2026-08-24. Q8 answered in
[14-monetization-ads.md](14-monetization-ads.md). Q9–Q12 remain open.

---

### ✅ Q1 — How do Security Rules validate that splits sum to the total?

**Answer: Option A.**

Rules have no loops or `reduce`, so an arbitrary-length array cannot be summed in a rule.
Instead:

1. The client writes redundant `splitsTotalMinor` and `paidTotalMinor` fields.
2. **Rules** assert both equal `amountMinor` — this stops the naive attack at write time.
3. **`onExpenseWritten`** recomputes the _real_ sums with actual code and quarantines the
   document if they disagree — this stops the sophisticated attack.

Neither layer is sufficient alone; together they are. The Function-side check is
**mandatory, not optional** — without it, Option A is theatre.

Chosen over Option C (all writes through a callable) because C adds ~300 ms to every write
and forfeits Firestore's offline write queue. In a social app among people who already
trust each other, that is a bad trade. Revisit if abuse ever becomes real.

Same pattern now applies to **currency validation** — see Q4.

### ✅ Q2 — Group size and recompute limits

**Answer: 50 members per group; `RECOMPUTE_THRESHOLD = 1000` expenses.**

Above 1,000 expenses a group switches from full recompute to incremental deltas, with the
nightly `auditBalances` job as the correctness backstop. Below it, full recompute stays —
idempotent and self-healing beats fast.

⚠️ **These are provisional numbers.** Phase 10 instruments real read counts per
invocation; the threshold gets set from measurement, not from this guess (Article XII).

### ✅ Q3 — Project name

**Answer: SplitSutra.** _"SplitSutra — square up, no awkwardness."_

Now threaded through every doc: `@splitsutra/core`, `@splitsutra/web`, `@splitsutra/functions`, repo
`allcottcourt1808/splitsutra`, Firebase `splitsutra-dev` / `splitsutra-prod`, bundle `com.splitsutra.app`.

**Why this one.** It keeps the "settle up" instinct — which is the action the product is
named after — while fixing the three problems with the phrase _Settle It_:

1. "Debt settlement" is a crowded, regulated-adjacent US trademark class; the dropped `e`
   moves out of the direct collision path.
2. One word, one token — clean in a bundle ID, package scope, and repo name.
3. No pronoun to awkwardly carry through `com.settleit.app`.

**Rejected:** _Evenly, Quits, Halfsies, Chip In_ (first round); _Dutch, Reckon, Parity_
(second round). _Divvy_ and _Tabby_ were excluded upfront — both are existing fintech
companies.

⚠️ **Clearance is still outstanding** — see Phase 00. A deliberate misspelling improves the
trademark position but does not guarantee it, and Firebase project IDs are globally unique
and first-come.

### ✅ Q4 — Currency and region

**Answer: USD default, US region, all currencies supported, one currency per group.**

| Setting              | Value                                                |
| -------------------- | ---------------------------------------------------- |
| Default currency     | **USD**                                              |
| Firestore location   | **`us-central1`** (Iowa) — ⚠️ permanent once created |
| Functions region     | **`us-central1`** — colocated with Firestore         |
| Supported currencies | **Full ISO 4217** (~180)                             |
| Per group            | **One**, chosen at creation, immutable               |
| Conversion           | **None in v1** — see ADR-08 and the v2 design        |

Three consequences worth flagging:

**1. The exponent table must be hardcoded.** Not every currency has 2 decimal places — JPY
and KRW have 0, KWD and BHD have 3. The exponent decides how a stored integer is
_interpreted_, so it must come from a static ISO 4217 table, **never** from
`Intl.NumberFormat`. ICU data varies between runtimes (notably a trimmed Hermes build on
React Native), and a differing exponent would silently corrupt amounts by 100×. `Intl` is
for **display only**. See [04-split-engine.md](04-split-engine.md) §1.

**2. Rules can't enumerate 180 currencies.** Same shape as Q1: rules check
`currency is string && currency.size() == 3 && currency == groupCurrency(gid)`; the Cloud
Function validates against the real ISO table.

**3. The picker needs search.** A 180-item dropdown is unusable — see
[07-ui-ux-spec.md](07-ui-ux-spec.md).

`us-central1` single-region is chosen over `nam5` multi-region: lower cost, lower write
latency, colocated with Functions. Multi-region buys durability this app doesn't need.

### ✅ Q5 — Phone auth

**Answer: confirmed supported. Test numbers during development.**

Firebase Auth supports phone (SMS OTP) on web and mobile, and FirebaseUI includes it. The
earlier caveat was narrower than it read: **phone auth on React Native via the JS SDK**
requires a reCAPTCHA webview, which is why Phase 12 uses `@react-native-firebase` instead
— native there, and it works properly. Web is fine exactly as planned.

⚠️ **What the check did surface: SMS toll fraud.** Attackers drive phone-auth flows against
premium-rate numbers in high-fraud regions and take a cut of the carrier fee. On Blaze,
with no hard spending cap, this is one of the few realistic ways to receive a genuinely
large bill. Mitigations now in [phase-03-auth.md](../checklists/phase-03-auth.md):

- **SMS region policy: allowlist US only** to start. This is the single most effective control.
- Enable **App Check** / reCAPTCHA Enterprise on the phone provider.
- Set a phone-auth **quota limit** in the console.
- Use emulator **test numbers** for all development; real SMS only for final device testing.

### ✅ Q6 — Expense edit permissions

**Answer: restricted — creator or group admin only. Anyone can open a discussion thread.**

Recorded as ADR-11. This overrides the earlier permissive recommendation, and it's the
better model: nobody silently rewrites your record of what you paid.

Consequences:

- `AC-D3.1` changes; Security Rules gain `createdBy == auth.uid || isAdmin(gid)` on expense
  update and soft-delete.
- **Comment threads become load-bearing**, not decorative — they're the mechanism that
  makes restricted editing workable. Phase 08 rises in priority; the thread affordance is
  now a primary action on the expense detail screen, not a footer.
- Non-creators see **Discuss** where creators see **Edit**.
- Admin override handles the creator having left the group.

Thread shape: **flat and chronological**, one thread per expense. Nested replies add
structure that a 2–15 person group doesn't need.

### ✅ Q7 — Backlog

**Answer: keep the wish list.** Now maintained as a real document —
[17-backlog.md](17-backlog.md) — rather than scattered "deferred" notes.

---

## Still open

- **Q3** — project name (shortlist below; blocks Phase 01)
- **Q9** — also build a paid tier? _Recommendation: yes, plan for it_
- **Q10** — web ads in v1? _Recommendation: no_
- **Q11** — primary market? Now assumed **US** per Q4
- **Q12** — ad category toggle default? _Recommendation: off_
