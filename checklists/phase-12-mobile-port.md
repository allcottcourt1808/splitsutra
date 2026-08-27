# Phase 12 — React Native Mobile App

**Est. 3–4 weeks + 1–2 weeks of store friction.** Depends on 11.
Reference: [../docs/11-mobile-port.md](../docs/11-mobile-port.md)

---

## 0. Readiness gate 🔴 _Verify all seven before writing any mobile code_

If any of these fail, **fix it in `apps/web` first.** Retrofitting mid-port is far worse
than fixing it now.

- [ ] 🔴 `packages/core` imports nothing from `react-dom`, `window`, `document`,
      `localStorage` — `pnpm depcruise` green
- [ ] 🔴 All Firestore access is in `core/src/repositories`; no screen imports
      `firebase/firestore`
- [ ] 🔴 All money/balance logic is in `core/src/domain` and pure
- [ ] 🔴 Design tokens are plain TS in `core/src/theme/tokens.ts`
- [ ] 🔴 Flexbox-only layout; grep confirms no `display: grid`, `float`, `100vh`
- [ ] 🔴 One typed route table
- [ ] 🔴 `firebaseui` imported in exactly one file

## 1. Scaffold

- [ ] 🔴 `apps/mobile` with **Expo + a development build** (not Expo Go — native Firebase
      modules require a dev build)
- [ ] 🔴 Add `@splitsutra/core` as a workspace dependency
- [ ] 🔴 ⚠️ **Metro monorepo config first** — `watchFolders` + `nodeModulesPaths`.
      Monorepo module resolution is _the_ classic Metro pain point; solving it before
      writing screens saves a day of confusion.
- [ ] 🟡 TypeScript path aliases matching the web app
- [ ] 🟡 Run the core test suite from the mobile package to prove the wiring

## 2. Firebase SDK decision (ADR from the port doc)

- [ ] 🔴 **`@react-native-firebase`**, not the JS SDK — phone OTP and Google sign-in work
      natively, and the JS SDK's reCAPTCHA webview path for phone auth is the weakest part
      of that option
- [ ] 🔴 Repository adapter layer so `core` calls one interface, two implementations
- [ ] 🔴 Run all integration tests against the RN adapter
- [ ] 🔴 `google-services.json` (Android) and `GoogleService-Info.plist` (iOS)
- [ ] 🔴 ⚠️ **SHA-1 and SHA-256 fingerprints registered in Firebase** — required for
      Google sign-in and phone auth on Android, and the single most common first-time
      blocker

## 3. Theme & components

- [ ] 🔴 `tokens.ts` → `StyleSheet` bridge
- [ ] 🔴 Port the primitives: `<Screen>`, `<Stack>`, `<Row>`, `<Text>`, `<Pressable>`,
      `<Button>`, `<Input>`, `<AmountInput>`, `<Money>`, `<List>`, `<ListRow>`, `<Avatar>`,
      `<Sheet>`, `<SegmentedControl>`, `<Chip>`, `<EmptyState>`, `<Skeleton>`, `<Toast>`
- [ ] 🔴 ⚠️ **Every string must be inside `<Text>`** — bare strings crash RN
- [ ] 🟡 `<List>` → `FlatList` (this is why every list went through `<List>`)
- [ ] 🟡 Dark theme from the same token object
- [ ] 🟡 Safe-area handling via `react-native-safe-area-context`

## 4. Navigation

- [ ] 🔴 React Navigation: bottom tabs + native stack, from the same route table
- [ ] 🔴 Modal stack for Add Expense, Settle Up, sheets
- [ ] 🟡 Typed navigation params matching the web route types
- [ ] 🟡 Android hardware back button through modals
- [ ] 🟡 Deep linking for `/invite/:token` (universal links + app links)

## 5. Screens (in dependency order)

- [ ] 🔴 **Native auth screens** — email, phone OTP, Google. No FirebaseUI equivalent
      exists; build against the same `useAuth()` contract.
- [ ] 🔴 Groups list + overall balance
- [ ] 🔴 Group detail + expense list
- [ ] 🔴 **Add Expense + split sheet** — the highest-value screen to get right on mobile
- [ ] 🔴 Balances + simplification
- [ ] 🔴 Settle up
- [ ] 🟡 Friends list + detail + add
- [ ] 🟡 Activity feed
- [ ] 🟡 Account + profile
- [ ] 🟡 Invite join screen

## 6. Native-only work (this is new work, not porting)

- [ ] 🟡 App icons, splash screens, Android adaptive icons
- [ ] 🟡 `KeyboardAvoidingView` — behaves differently per platform; the Add Expense form
      is where this bites
- [ ] 🟡 Native share sheet via the `PlatformAdapter`
- [ ] 🟡 Push notifications: FCM setup, permission prompts, token registration
      (**this is also the point at which the deferred push feature becomes worth building**)
- [ ] 🟢 Biometric app lock
- [ ] 🟢 Haptics on key actions
- [ ] 🟢 Contact picker for adding friends

## 7. Store submission

- [ ] 🟡 iOS: bundle ID, provisioning, App Store Connect, TestFlight
- [ ] 🟡 Android: package name, keystore, Play Console, internal testing track
- [ ] 🟡 Screenshots for every required device size
- [ ] 🟡 Privacy nutrition labels (iOS) and the Data Safety form (Android)
- [ ] 🟡 ⚠️ If the app is still named after an existing trademark, **resolve that before
      submission** (open question Q3)
- [ ] 🟡 EAS Build + EAS Submit pipelines
- [ ] 🟢 EAS Update for OTA JS updates

## 8. Testing

- [ ] 🔴 Core test suite passes unchanged against the RN adapter
- [ ] 🟡 Manual full loop on a real iPhone and a real Android device
- [ ] 🟡 Real SMS OTP on both platforms
- [ ] 🟡 Google sign-in on both platforms
- [ ] 🟡 Offline: add an expense in airplane mode, confirm it syncs on reconnect
- [ ] 🟢 Detox or Maestro E2E, if the manual matrix becomes tedious

---

## Exit criteria

- [ ] Both apps build and run on real devices
- [ ] `packages/core` is shared with **zero** forks or copies
- [ ] Every auth method works natively
- [ ] Balances match the web app exactly for the same group
- [ ] Submitted to TestFlight and Play internal testing
