/**
 * `@splitsutra/core` theme barrel.
 *
 * Platform-agnostic by construction (Article II): plain objects and types only.
 * The web app turns these into CSS custom properties; Phase 12 feeds the same
 * objects straight into `StyleSheet.create`.
 *
 * Re-exported from the package root barrel (`packages/core/src/index.ts`).
 */

export {
  tokens,
  lightTokens,
  darkTokens,
  tokensFor,
  type ThemeTokens,
  type ThemeColors,
  type ColorScheme,
} from './tokens.js';

/**
 * Which of the three money-direction colour roles an amount should use.
 *
 * docs/07 §Colour semantics — a hard rule: these communicate money direction and
 * nothing else. Never use the money green for a generic success state or the money
 * orange for a warning; that trains the user to misread balances at a glance.
 *
 * Per NFR-5, tone is never the only signal — the UI always pairs it with a sign or
 * the words "you owe" / "owes you".
 */
export type MoneyTone = 'positive' | 'negative' | 'neutral';
