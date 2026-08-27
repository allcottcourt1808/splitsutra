# Phase 13 — Ads & Monetization

**Est. 1 week.** Depends on Phase 12 (mobile launch).
Reference: [../docs/14-monetization-ads.md](../docs/14-monetization-ads.md)

> **Why after mobile:** AdMob is a mobile SDK, and web ads on a login-gated SPA are a poor
> fit with uncertain AdSense approval. The revenue lives in the mobile app. The _slots_,
> however, get built during Phase 09 so nothing has to be re-laid-out here.

---

## 0. Decisions first 🔴

- [x] ✅ **Q8 — targeting approach.** Resolved: **aggregate spending category**, derived
      on-device, one enum on the wire. See §4.
- [ ] 🔴 **Confirm the enum** — six values, with medical/health/education excluded
- [ ] 🔴 **Answer Q9** — also build a paid "remove ads" tier?
- [ ] 🔴 **Answer Q10** — web ads at all in v1? _Recommendation: no._
- [ ] 🔴 **Answer Q11** — primary market? Drives realistic eCPM expectations.
- [ ] 🔴 **Answer Q12** — category toggle default. _Recommendation: off._

## 1. Ad slots in the UI (do this in Phase 09, verify here)

- [ ] 🔴 `<AdSlot>` component that **reserves its height whether or not an ad loads** —
      no layout shift, ever
- [ ] 🔴 Renders a house promo ("Invite friends", "Get the app") when no ad is available
- [ ] 🔴 Visibly labelled "Ad", visually distinct from app content (**an AdMob requirement**)
- [ ] 🔴 **48dp minimum clearance** from every interactive control
- [ ] 🔴 ⚠️ **Zero ad slots** in Add Expense, the split sheet, or Settle Up
- [ ] 🟡 Slot positions: group list every ~8 rows; activity feed every ~10 entries; anchored
      banner above the tab bar on list screens only

## 2. AdMob account

- [ ] 🔴 Create the AdMob account and **link it to the existing Firebase project**
- [ ] 🔴 Register both apps (iOS + Android); record the App IDs
- [ ] 🔴 Create ad units: native (list), adaptive banner, app-open, interstitial
- [ ] 🔴 Payment details + tax info (payout threshold is $100)
- [ ] 🟡 Set frequency caps in the console **and** in code — console caps alone are not enough
- [ ] 🟡 Block sensitive ad categories: gambling, loans/payday lending, crypto, dating.
      **A debt-adjacent app showing loan ads is a bad look and a trust problem.**

## 3. Consent (UMP SDK) 🔴 _Before the first ad request_

- [ ] 🔴 Integrate Google's **User Messaging Platform** SDK
- [ ] 🔴 Configure the GDPR message for EEA/UK, and a CCPA opt-out where applicable
- [ ] 🔴 ⚠️ **Request consent, and gate all ad initialisation on the result.** No ad may
      load before a decision exists.
- [ ] 🔴 **Serve non-personalised ads when consent is declined** — declining must never
      degrade or block the app
- [ ] 🔴 iOS: **ATT prompt sequenced by UMP**, after the consent message
- [ ] 🟡 A "Privacy settings" entry in `/account` that reopens the consent form (**required**
      — consent must be revocable)
- [ ] 🟡 Test all paths: consent given, declined, revoked, and outside the EEA

## 4. Aggregate category targeting 🔴

Design and reference implementation: [../docs/14-monetization-ads.md](../docs/14-monetization-ads.md) §4.
Governed by **Article XIII** of the [constitution](../CONSTITUTION.md).

### The pure function

- [ ] 🔴 `packages/core/src/domain/adCategory.ts` → `deriveAdCategory(expenses, now, optedIn)`
- [ ] 🔴 Returns **one value from a six-member enum**:
      `food | travel | home | transport | entertainment | general`
- [ ] 🔴 Pure, no I/O — same property-test treatment as the split engine (Article VII)
- [ ] 🔴 ⚠️ **Exclude sensitive categories from the mapping.** Medical, health, insurance,
      and education map to `general`. Inferring health status is GDPR Article 9
      special-category data and turns a reasonable feature into a headline.
- [ ] 🔴 ⚠️ **Minimum evidence:** fewer than 10 expenses in 30 days → `general`.
      Top category must also be ≥30% of spend, or → `general`.
- [ ] 🔴 Rolling 90-day window; older expenses ignored
- [ ] 🔴 Deterministic tie-break on category name

### The transmission boundary

- [ ] 🔴 ⚠️ **Computed on-device from already-loaded data. Never write an `adProfile`
      field to Firestore.** A stored profile is a breach liability, an SAR obligation, and
      a deletion obligation — all three vanish if it stays ephemeral.
- [ ] 🔴 ⚠️ **Compliance test:** assert the ad request payload has exactly one key and that
      its value is a member of the enum. This test is the enforcement mechanism for
      Article XIII — it must fail loudly if anyone widens the payload.
- [ ] 🔴 Map the enum → AdMob content mapping / keyword targeting

### Screen context (second signal)

- [ ] 🟡 `trip` group → `travel`; Food filter active → `food`; `home` group → `home`
- [ ] 🟡 **Screen context wins when available** — someone looking at a trip group right now
      is a better travel prospect than a 90-day history saying "food"
- [ ] 🟡 Precedence: screen context → derived category → `general`

### The opt-in

- [ ] 🔴 Toggle in `/account`: _"Use my spending categories to show more relevant ads"_
- [ ] 🔴 ⚠️ **Defaults to OFF** (Q12). One-line plain explanation beneath it.
- [ ] 🔴 Off → `deriveAdCategory` returns `general`; ads still show, just untargeted
- [ ] 🔴 Never gate any app functionality on the toggle
- [ ] 🟡 Revocable at any time, taking effect on the next ad request
- [ ] 🟢 Measure whether targeting actually lifts eCPM over untargeted. **If it doesn't,
      turn it off and delete the code** — it's pure liability with no upside.

## 5. Ad rendering

- [ ] 🔴 `react-native-google-mobile-ads` integrated in `apps/mobile`
- [ ] 🔴 Ad code lives **only** in `apps/mobile` — `packages/core` stays ad-free (Article II)
- [ ] 🔴 Native ads styled to match `<ListRow>`, labelled
- [ ] 🔴 Adaptive banner sized to the device
- [ ] 🟡 App-open ad: cold start only, max once per 4 hours
- [ ] 🟡 Interstitial: **only after a completed settle-up**, hard cap 1/session
- [ ] 🔴 ⚠️ **No action ever blocks on an ad load.** Failed load = empty reserved space,
      never a stalled UI.
- [ ] 🟡 Graceful handling of no-fill and offline

## 6. Compliance 🔴

- [ ] 🔴 Privacy policy naming AdMob, the data collected, and how to opt out
- [ ] 🔴 Terms of service
- [ ] 🔴 **Play Data Safety form** completed accurately
- [ ] 🔴 **Apple privacy nutrition labels** completed accurately
- [ ] 🔴 Tag for child-directed treatment / under-13 handling
- [ ] 🟡 In-app links to the privacy policy from `/account`
- [ ] 🔴 Privacy policy states plainly: _spending categories are used to choose ad topics;
      your transactions never leave your device_
- [ ] 🟡 Store forms: declare "app activity" used for advertising. **Financial data is not
      declared for ads** — and that's accurate only because §4's boundary holds
- [ ] 🟢 If you ever move to full behavioural profiling: **stop and do §6 of the doc
      properly** — TCF v2.2, granular per-purpose consent, DPIA, legal review, and a
      user-facing profile view/delete control

## 7. Usability regression check 🔴 _The item most likely to be skipped_

- [ ] 🔴 Re-run the 5-user usability protocol from
      [../docs/15-usability.md](../docs/15-usability.md) **with ads enabled**
- [ ] 🔴 ⚠️ If "add an expense" task time regresses **> 20%**, the placement is wrong.
      **Move the ad. Do not accept the regression.**
- [ ] 🔴 Verify zero layout shift when ads load
- [ ] 🔴 Verify no accidental ad clicks are possible near any button
- [ ] 🟡 Compare 7-day retention against the pre-ads baseline

## 8. Measurement

- [ ] 🟡 Firebase Analytics: impressions, eCPM, fill rate per placement
- [ ] 🟡 Revenue per DAU
- [ ] 🟡 **Retention: ads on vs. ads off.** If retention drops meaningfully, the ads are
      costing more than they earn
- [ ] 🟡 Watch AdMob policy centre for invalid-traffic warnings
- [ ] 🟢 A/B test placements once volume supports it

## 9. Paid tier (if Q9 = yes)

- [ ] 🟢 Define the Pro feature set: no ads, receipts, export, charts, unlimited groups
- [ ] 🟢 RevenueCat or native IAP
- [ ] 🟢 Entitlement check in `core`; ad slots render nothing for Pro users
- [ ] 🟢 Upgrade prompt — **placed after value is delivered**, never on first launch

---

## Exit criteria

- [ ] Ads render on both platforms with correct consent handling
- [ ] Declining consent yields non-personalised ads and a fully working app
- [ ] **Zero ads** in any money-entry flow
- [ ] Zero layout shift; no accidental-click geometry
- [ ] Usability re-test shows < 20% regression on the core task
- [ ] Store compliance forms submitted accurately
- [ ] **A unit test proves the ad payload is exactly one enum value** (Article XIII)
- [ ] `deriveAdCategory` returns `general` below the evidence threshold and for every
      sensitive category
- [ ] No `adProfile` field exists anywhere in Firestore
- [ ] Toggle defaults off; turning it off still shows (untargeted) ads
