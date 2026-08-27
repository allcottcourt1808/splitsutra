# 14 — Monetization & Advertising

**Goal:** the app stays free for users, funded by advertising.

---

## The one thing to decide first

Three quite different products hide inside "use their data to show ads":

|                     | **Screen context**              | **Aggregate category** ⭐                    | **Full behavioural**                      |
| ------------------- | ------------------------------- | -------------------------------------------- | ----------------------------------------- |
| Ad is based on      | The screen they're on right now | **Their top spending category over 90 days** | A rich profile from their expense history |
| Leaves the device   | One enum                        | **One enum**                                 | Identifiers + inferred interests          |
| Stored server-side  | Nothing                         | **Nothing**                                  | An ad profile                             |
| Consent needed      | SDK consent only                | **Opt-in toggle**                            | Explicit, granular, per-purpose           |
| Google policy risk  | Low                             | **Low**                                      | **High — §3**                             |
| eCPM                | Baseline                        | **Better**                                   | Best                                      |
| Compliance workload | Minimal                         | **Small**                                    | DPIA + TCF v2.2 + legal review            |

**⭐ Recommendation: aggregate category (§4), with screen context layered on top.**

This is what you asked for — _the category they spend most in, not the specifics_ — and
it's a genuinely good middle path. The user's spending is reduced **on-device** to one
string from a six-value enum (`food`, `travel`, `home`, `transport`, `entertainment`,
`general`). That string is the only thing an advertiser ever sees. Amounts, merchants,
counterparties, and balances never leave the phone, and no profile is ever written to your
database.

That single design choice is what keeps this inside AdMob's policies and outside GDPR's
profiling regime — §3 explains what you'd be walking into otherwise, and §4 is the
implementation.

---

## 1. Ad network comparison for _this_ app

The decisive fact: **this is a login-gated single-page app now, and a native mobile app
later.** That rules out more networks than you'd expect.

| Network                | Web          | Mobile               | Typical eCPM | Verdict for us                             |
| ---------------------- | ------------ | -------------------- | ------------ | ------------------------------------------ |
| **Google AdMob**       | ❌ apps only | ✅ **best-in-class** | $$–$$$       | ✅ **Choose this for mobile**              |
| Google AdSense         | ✅           | ❌                   | $            | ⚠️ Poor fit — see below                    |
| Google Ad Manager      | ✅           | ✅                   | $$$          | ❌ Overkill; needs real scale              |
| AppLovin MAX           | ❌           | ✅                   | $$$          | 🔵 Later, as a mediation layer             |
| Unity Ads / ironSource | ❌           | ✅                   | $$           | ❌ Gaming-oriented                         |
| Meta Audience Network  | ❌           | ✅ via mediation     | $$           | ❌ Needs a mediation partner anyway        |
| EthicalAds / Carbon    | ✅           | ❌                   | $            | 🔵 Privacy-first, but a dev-tools audience |

### Why AdMob is the right answer for mobile

- **Free, no traffic minimum** — you can integrate on day one of Phase 12.
- **Already in your stack.** AdMob is part of the Google/Firebase family; it links directly
  to your Firebase project and reports into Firebase Analytics.
- **Best fill rate and demand** of any mobile network, globally and in India.
- **Formats that suit a utility app:** native, banner, app-open, interstitial.
- **AdMob Mediation** lets you add AppLovin/Unity/Meta later _without code changes_, so
  choosing AdMob now doesn't lock out higher eCPM later.
- **Ships with a certified CMP** — Google's User Messaging Platform (UMP) SDK handles
  GDPR/TCF consent and coordinates Apple's App Tracking Transparency prompt. This is a
  large amount of compliance work you'd otherwise build yourself.

### ⚠️ Why web ads are a weak fit (be realistic about this)

AdSense is designed for content sites with crawlable pages. This app is a **login-gated
SPA with essentially no public content**. Expect:

- **Approval difficulty.** AdSense reviewers need to see the content that will carry ads;
  a login wall makes that hard. Approval is genuinely uncertain.
- **Low eCPM even if approved** — utility screens have poor ad engagement.
- **SPA friction** — route changes aren't page loads, so refreshes need manual handling.

**Recommendation for web v1:** don't ship third-party ads. Either leave the ad slots
empty, or fill them with **house promos** (invite friends, install the mobile app) so the
layout is built and tested. Turn on real ads when the mobile app lands and AdMob is doing
the earning.

This is the honest version: **the mobile app is the revenue product; the web app is
acquisition.** Building the ad _slots_ on web now (§5) means nothing has to be re-laid-out
later.

---

## 2. Recommended stack

| Layer            | Choice                                                         |
| ---------------- | -------------------------------------------------------------- |
| Mobile ads       | **Google AdMob**                                               |
| Consent          | **Google UMP SDK** (certified CMP, TCF v2.2, ATT coordination) |
| Mediation        | AdMob Mediation — enable later, once DAU justifies it          |
| Web ads          | **Deferred.** House promos in the slots for v1                 |
| Analytics        | Firebase Analytics (already in the stack)                      |
| Fallback revenue | Freemium tier — see §7                                         |

---

## 3. Why not to feed expense data into ad targeting

Four separate reasons, any one of which is sufficient:

**1. Google's policies restrict it.** AdMob and AdSense both prohibit sending
**personally identifiable information** to Google, and restrict building targeting around
sensitive categories — financial status among them. Passing expense records, amounts, or
inferred financial circumstances into ad requests risks account termination, which means
losing the revenue entirely, retroactively.

**2. Consent law treats it as high-risk.** Under **GDPR**, profiling for advertising
cannot rest on legitimate interest — regulators have specifically rejected that for
ad personalisation, so you need **freely-given, granular opt-in**. Financial data raises
the bar further. **India's DPDP Act 2023** requires clear notice and consent for the same
processing, and prohibits behavioural advertising to children outright. **CCPA/CPRA**
classifies it as "sharing" and requires a visible opt-out.

**3. Store review.** Apple's privacy nutrition labels and Google Play's Data Safety form
both require you to declare that financial data feeds advertising. Reviewers scrutinise
that combination, and it will be visible on your store listing to every prospective user.

**4. It's the wrong trade commercially.** People are markedly less tolerant of a
_money_ app mining their spending than of a game showing them a banner. The incremental
eCPM from behavioural targeting is real but modest; the churn and review damage in this
category is not.

---

## 4. The approach: aggregate category targeting

> **Clarified requirement:** use the category a user _spends most in_ to choose which ads
> to show — not their specific transactions. This section is the design for exactly that.

This is a much better proposal than shipping transaction detail, and it's workable. The
whole mechanism reduces to:

```
  [on device]  all their expenses  →  top category over 90 days  →  "food"
                                                                     │
  [network]  ────────────────────────────────────────────────────────┘
             ad request: { contentCategory: "food" }        ← the ONLY thing sent
```

One string. Six possible values. Everything that makes the data sensitive — amounts,
merchants, who they split with, how much they owe — stays on the device.

### Why this clears the bars in §3

- **AdMob policy:** you're sending a content/keyword targeting hint, which is a supported
  feature. No PII is transmitted, so the termination risk in §3.1 largely goes away.
- **GDPR:** a single coarse category, derived locally, is far from the behavioural
  profiling regulators have acted against. Still gate it behind consent — using
  service data for a _new purpose_ (ads) needs a lawful basis, and consent is the
  realistic one.
- **Store review:** you can honestly declare "app activity used for advertising" without
  declaring financial data, because financial data never leaves the device.

### The enum

```ts
type AdCategory = 'food' | 'travel' | 'home' | 'transport' | 'entertainment' | 'general';
```

Six values, one of which is the null case. That's the complete surface area of what an
advertiser learns about a user.

### Four hard limits on the derivation

**1. 🔴 Sensitive categories are excluded from the enum.**
Your expense categories will include things like Medical/Health. **Never map those to an ad
category.** Inferring health status is special-category data under GDPR Article 9, needs
separate explicit consent, and is exactly the inference that turns a reasonable feature
into a headline. Anything health-, medical-, or hardship-adjacent maps to `general`.

**2. 🔴 Minimum evidence before inferring.**
No category is inferred from fewer than **10 expenses over 30 days**, and the top category
must be a clear plurality (say, ≥30% of spend). Below either threshold the value is
`general`. Inferring "this person is a big traveller" from two taxi rides is both bad
targeting and creepy.

**3. 🔴 Computed on-device, never persisted server-side.**
Derive it from data the client already has loaded. **Do not write an `adProfile` field to
Firestore.** The moment a category profile exists on your server it becomes a data-breach
liability, a subject-access-request obligation, and a thing you must delete on request.
Keeping it ephemeral removes all three.

**4. 🔴 Opt-in, revocable, and free of consequences.**
A toggle in Account settings — _"Use my spending categories to show more relevant ads"_ —
defaulting **off**. Declining still shows ads, just untargeted ones. Never gate app
functionality on it.

### Reference implementation

```ts
// packages/core/src/domain/adCategory.ts — pure, testable, no I/O
const SENSITIVE = new Set(['medical', 'health', 'insurance', 'education']);

const CATEGORY_MAP: Record<string, AdCategory> = {
  food: 'food',
  groceries: 'food',
  travel: 'travel',
  accommodation: 'travel',
  rent: 'home',
  utilities: 'home',
  household: 'home',
  transport: 'transport',
  fuel: 'transport',
  entertainment: 'entertainment',
};

export function deriveAdCategory(
  expenses: ReadonlyArray<Pick<Expense, 'category' | 'amountMinor' | 'date'>>,
  now: Date,
  optedIn: boolean,
): AdCategory {
  if (!optedIn) return 'general';

  const recent = expenses.filter((e) => daysBetween(e.date, now) <= 90);
  if (recent.length < 10) return 'general'; // limit 2

  const totals = new Map<AdCategory, number>();
  let grand = 0;
  for (const e of recent) {
    if (SENSITIVE.has(e.category)) continue; // limit 1
    const mapped = CATEGORY_MAP[e.category];
    if (!mapped) continue;
    totals.set(mapped, (totals.get(mapped) ?? 0) + e.amountMinor);
    grand += e.amountMinor;
  }

  const [top, amount] = [...totals.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
  )[0] ?? ['general', 0];

  return amount / grand >= 0.3 ? top : 'general'; // needs a clear plurality
}
```

Pure function, so it gets the same property-test treatment as the split engine. The
compliance test that matters:

```ts
test('Article XIII: ad payload contains exactly one enum value', () => {
  const payload = buildAdRequest(deriveAdCategory(anyExpenses(), now, true));
  expect(Object.keys(payload)).toEqual(['contentCategory']);
  expect(AD_CATEGORIES).toContain(payload.contentCategory);
});
```

### Screen context as a second signal

Independently of spending history, the _current screen_ is a free and entirely
uncontroversial signal — no profile, no consent question:

| Screen state                   | Category |
| ------------------------------ | -------- |
| Viewing a `type: 'trip'` group | `travel` |
| Category filter set to Food    | `food`   |
| Viewing a `type: 'home'` group | `home`   |

**Screen context wins when it's available** — someone actively looking at a trip group is a
better travel prospect right now than someone whose 90-day history says "food". Fall back
to the derived category, then to `general`.

---

## 5. Ad placement — without wrecking the app

The user asked for an intuitive UI. Ads are where that promise usually dies. Rules:

### 🔴 Never place an ad in these flows

- **Add Expense** — any screen where an amount is being typed
- **The split sheet**
- **Settle Up** — a screen about money moving between friends
- **Any confirmation or error state**

Interrupting a user mid-money-entry is the fastest way to lose them, and accidental clicks
near a Save button are also an **AdMob invalid-traffic violation**.

### ✅ Acceptable placements

| Placement                                     | Format                | Rules                                      |
| --------------------------------------------- | --------------------- | ------------------------------------------ |
| Group list, after every ~8 rows               | **Native**            | Styled to match `<ListRow>`, labelled "Ad" |
| Activity feed, after every ~10 entries        | **Native**            | Same                                       |
| Anchored above the tab bar, list screens only | **Banner** (adaptive) | Never overlaps content; reserve the height |
| App open, cold start only                     | **App Open**          | Max once per 4 hours                       |
| After _completing_ a settle-up                | **Interstitial**      | Frequency-capped, hard max 1 per session   |

### Non-negotiable placement rules

- 🔴 **Reserve the ad slot's height in layout** so nothing shifts when the ad loads.
  Layout shift is the most-hated ad behaviour there is.
- 🔴 **Minimum 48dp between an ad and any interactive control** — prevents accidental
  clicks and the invalid-traffic strikes that follow.
- 🔴 Every ad is **visibly labelled** and visually distinguishable from app content
  (an AdMob requirement, not a nicety).
- 🔴 **Never block a user action on an ad loading.** Failed load = empty reserved space.
- 🟡 Frequency-cap interstitials in code, not just in the AdMob console.
- 🟡 Ads render **only after** a consent decision exists.

---

## 6. Compliance requirements

Required regardless of contextual vs. personalised:

- [ ] **Privacy policy** naming the ad network, what's collected, and how to opt out
- [ ] **Consent flow via the UMP SDK** before the first ad request
- [ ] **Non-personalised ads** served when consent is declined — never "no ads or no app"
- [ ] **Apple ATT prompt** (iOS), sequenced by UMP
- [ ] **Play Data Safety** and **Apple privacy labels** completed accurately
- [ ] **CCPA opt-out** link where applicable
- [ ] **No ads to under-13s**; tag for child-directed treatment if age is unknown

Additionally required **only** if you pursue personalised ads (§3):

- [ ] IAB TCF v2.2 integration
- [ ] Granular, separately-revocable purpose consent — not one blanket toggle
- [ ] A DPIA (Data Protection Impact Assessment) — financial data + profiling triggers this
- [ ] Legal review. **Genuinely: get a lawyer for this specific combination.**
- [ ] An in-app control to view, export, and delete the ad profile

---

## 7. Revenue reality check

Be clear-eyed so you can decide whether this is worth the UX cost.

Rough AdMob figures — **illustrative, not a forecast**; real eCPM swings widely by
geography, format, and fill:

```
1,000 DAU × ~4 ad impressions/day ≈ 120,000 impressions/month
Contextual eCPM in the $0.50–$2.00 range  →  roughly $60–$240/month
```

That covers your Firebase bill and not much else. To make ads a _business_ you need tens of
thousands of DAU.

### The alternative worth considering

**Splitwise itself is freemium**, not ad-funded — that's a strong signal about what
actually monetises in this category. A "Pro" tier could offer: unlimited groups, receipt
scanning, expense export, charts, currency conversion, no ads.

**Suggested plan: build ads (they keep the app free and cost you nothing to run), and keep
a paid tier as the realistic revenue path once you have users.** The two coexist well —
"remove ads" is one of the most reliable reasons people upgrade.

---

## 8. Decision summary

| Question                         | Answer                                                            |
| -------------------------------- | ----------------------------------------------------------------- |
| Which ad network?                | **Google AdMob** (mobile), with UMP for consent                   |
| Web ads in v1?                   | **No** — build the slots, fill with house promos                  |
| Use spending data for targeting? | **Yes — top category only**, one enum, derived on-device (§4)     |
| What reaches the advertiser?     | One of six strings. Nothing else, ever                            |
| Sensitive categories?            | Excluded from the enum entirely — medical/health map to `general` |
| Stored server-side?              | **No ad profile is ever written to Firestore**                    |
| Full behavioural profiling?      | Not planned. Would need §6's full compliance workstream           |
| Mediation?                       | Later, via AdMob Mediation, once DAU justifies it                 |
| When to build?                   | Slots in Phase 09; real ads in **Phase 13**, after mobile launch  |

---

## 9. Open questions for you

- **Q8 — Targeting approach.** ✅ **Resolved:** aggregate spending category, per §4.
  Remaining sub-decision: confirm the six-value enum and the exclusion of
  medical/health/education from it.
- **Q9 — Also build a paid tier?** Recommendation: yes, plan for it; ads alone are
  unlikely to be meaningful revenue at realistic scale.
- **Q10 — Web ads at all?** Recommendation: no for v1. Revisit if the web app gets
  significant traffic.
- **Q11 — Primary market?** Affects eCPM expectations substantially. Docs currently assume
  the **US** (USD, `us-central1`) per Q4.
- **Q12 — Should the category toggle default on or off?** Recommendation: **off**, with a
  clear one-line explanation of what it does. Defaulting on is legally defensible in some
  markets and a trust problem in all of them.
