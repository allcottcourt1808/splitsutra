# 11 — React Native Port (Phase 12)

> Not built in v1. This document exists so that every decision made **now** keeps this path
> cheap. If you read one section, read "What must be true before you start".

---

## What must be true before you start

Phase 12 is easy only if these hold. Each is enforced during earlier phases:

- [ ] `packages/core` imports nothing from `react-dom`, `window`, `document`, or
      `localStorage` — verified by dependency-cruiser in CI (NFR-10).
- [ ] All Firestore access lives in `core/src/repositories`. No screen imports
      `firebase/firestore` directly.
- [ ] All money and balance logic lives in `core/src/domain` and is pure.
- [ ] Design tokens live in `core/src/theme/tokens.ts` as plain TS — no CSS-only values.
- [ ] Every layout uses flexbox only. No CSS Grid, no `float`.
- [ ] Routes are declared in one typed route table.
- [ ] `firebaseui` is imported in exactly one file (`apps/web/src/auth/FirebaseUIMount.tsx`).

If all seven hold, the port is "write views against hooks that already work". If any is
violated, fix it _before_ starting the port — retrofitting mid-port is far worse.

---

## What ports and what doesn't

| Layer                                         | Reuse    | Notes                                         |
| --------------------------------------------- | -------- | --------------------------------------------- |
| `core/domain` (money, splits, simplification) | **100%** | Pure TS                                       |
| `core/types` (Zod schemas)                    | **100%** |                                               |
| `core/repositories` (Firestore)               | **~95%** | Only the auth-persistence adapter changes     |
| `core/hooks` + `core/stores`                  | **~95%** | React and Zustand both run on RN              |
| `core/theme/tokens`                           | **100%** | Consumed by `StyleSheet` instead of CSS vars  |
| Navigation structure                          | **~80%** | Same route table, different navigator API     |
| Screen logic / composition                    | **~60%** | Same data flow, different primitives          |
| Components (`<div>`→`<View>`)                 | **0%**   | Rewritten — but they are thin by design       |
| `FirebaseUIMount`                             | **0%**   | No FirebaseUI for RN. Custom screens required |

Realistic overall reuse: **~70% of lines, ~100% of the hard parts.**

---

## The two real decisions

### 1. Expo vs bare React Native

**Recommend Expo with a development build** (not Expo Go — you need native Firebase
modules). Expo handles the build toolchain, OTA updates, and app-store submission, which
is otherwise a substantial time sink for a solo developer.

### 2. `firebase` JS SDK vs `@react-native-firebase`

This is the decision that actually costs money if you get it wrong.

|                          | `firebase` JS SDK                                                               | `@react-native-firebase`                           |
| ------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------- |
| Code shared with web     | **Identical imports**                                                           | Different API surface — needs a repo adapter layer |
| Auth persistence         | Manual `initializeAuth` + AsyncStorage                                          | Automatic                                          |
| **Phone auth (SMS OTP)** | **Painful.** Needs a reCAPTCHA webview; `expo-firebase-recaptcha` is deprecated | **Native, works properly**                         |
| Google sign-in           | Needs `expo-auth-session` wiring                                                | Native, straightforward                            |
| Push notifications (FCM) | Not supported on RN                                                             | Supported                                          |
| Offline persistence      | Limited on RN                                                                   | Full native persistence                            |
| Works in Expo Go         | Yes                                                                             | No — dev build required                            |

**Recommendation: `@react-native-firebase`, with `core/repositories` behind an interface.**

Since you chose phone-number sign-in as part of the drop-in auth widget, phone OTP has to
work well on mobile — and that is exactly where the JS SDK is weakest. Paying a small
abstraction cost in `repositories` now is much cheaper than fighting reCAPTCHA webviews later.

**Concrete implication for the earlier phases:** keep the Firestore surface used by
repositories boring — `collection`, `doc`, `query`, `where`, `orderBy`, `limit`,
`onSnapshot`, `runTransaction`. Avoid exotic SDK features, because each one has to be
re-expressed in the RN SDK. This costs nothing now and is the main design constraint the
mobile port imposes on v1.

---

## Mapping web to native

| Web                   | React Native                                                      |
| --------------------- | ----------------------------------------------------------------- |
| `<div>`               | `<View>`                                                          |
| `<span>` / `<p>`      | `<Text>` (**all** text must be inside `<Text>` — no bare strings) |
| `<button>`            | `<Pressable>`                                                     |
| `<input>`             | `<TextInput>`                                                     |
| CSS Modules           | `StyleSheet.create(tokens)`                                       |
| `overflow: scroll`    | `<ScrollView>` / `<FlatList>`                                     |
| React Router          | React Navigation (native stack + bottom tabs)                     |
| CSS custom properties | The tokens object, directly                                       |
| Web Share API         | `Share` from `react-native`                                       |
| `<img>`               | `<Image>` / `expo-image`                                          |

Because the web components were named `<Screen>`, `<Row>`, `<Stack>`, `<Text>`,
`<Pressable>` ([07-ui-ux-spec.md](07-ui-ux-spec.md)), most screen bodies need only their
component _implementations_ swapped, not their JSX structure. That is the whole point of
that naming rule.

---

## Native-only work that has no web equivalent

Budget for these — they are not "porting", they are new:

- App icons, splash screens, adaptive icons
- iOS: bundle ID, provisioning profiles, App Store Connect, `GoogleService-Info.plist`
- Android: package name, keystore, Play Console, `google-services.json`
- SHA-1/SHA-256 fingerprints registered in Firebase (**required for Google sign-in and
  phone auth on Android** — a very common first-time blocker)
- Deep linking for invite URLs (universal links / app links)
- Push notification permissions and FCM token registration
- Hardware back button handling (Android)
- Keyboard avoidance (`KeyboardAvoidingView`) — behaves differently per platform
- App store review, privacy nutrition labels, data-safety forms

**Realistic estimate:** 3–4 weeks for the port itself, plus 1–2 weeks of store submission
and review friction. The store paperwork consistently takes longer than people expect.

---

## Suggested port sequence

1. Scaffold `apps/mobile` with Expo + dev build; wire `@splitsutra/core` through the workspace.
2. Metro config for the monorepo (`watchFolders` + `nodeModulesPaths`) — **do this first;
   monorepo module resolution is the classic Metro pain point.**
3. Repository adapter for `@react-native-firebase`; run the core test suite against it.
4. Token → `StyleSheet` bridge; port the component library (`<Screen>`, `<Text>`, …).
5. React Navigation shell: bottom tabs + native stack from the same route table.
6. Screens in dependency order: Auth → Groups → GroupDetail → AddExpense → Balances →
   SettleUp → Friends → Activity → Account.
7. Native login screens (email, phone OTP, Google) replacing FirebaseUI.
8. Deep links, push notifications, store assets, submission.
