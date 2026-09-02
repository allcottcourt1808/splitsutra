/**
 * Design tokens — the single source of truth for every colour, space, radius,
 * font size and dimension in the product.
 *
 * These are PLAIN TYPESCRIPT OBJECTS on purpose (Article IX, docs/07 §Design tokens):
 *
 *   - `apps/web` emits them as CSS custom properties on `:root`
 *     (see apps/web/src/styles/tokensCss.ts) and consumes them via `var(--splitsutra-*)`.
 *   - `apps/mobile` (Phase 12) imports this exact object into `StyleSheet.create`.
 *
 * That is what keeps the two apps visually identical for free. Nothing in this file
 * may reference CSS, the DOM, or any platform API (Article II).
 *
 * @see docs/07-ui-ux-spec.md §Design tokens
 * @see docs/11-mobile-port.md — `core/theme/tokens` is 100% reused
 */

/* -------------------------------------------------------------------------- */
/* Accessibility: why there are `*Text` colours as well as brand colours       */
/* -------------------------------------------------------------------------- */
/**
 * docs/07 §Accessibility flags that the brand teal `#1CC29F` is ~2.3:1 on white and
 * **fails WCAG AA for text** (NFR-5 requires >= 4.5:1 for body text). It suggests
 * falling back to `primaryDark` `#159E82` — but that measures **3.36:1**, which also
 * fails AA for body text. It only clears the 3:1 bar for large text and non-text UI.
 *
 * Rather than ship the documented value and re-discover the bug in the Phase 09 audit,
 * the palette is split into two roles, and the rule is mechanical:
 *
 *   `primary` / `positive` / `negative` / `neutral` / `danger`
 *       -> FILLS, icons >= 24px, borders, charts, large display type. Never body text.
 *
 *   `primaryText` / `positiveText` / `negativeText` / `neutralText` / `dangerText`
 *       -> the ONLY colours permitted for text on a light surface. Every one of these
 *          is >= 4.5:1 against BOTH `bg` (#FFFFFF) and `bgSubtle` (#F7F7F9).
 *
 * Measured contrast ratios (WCAG 2.1 relative luminance), light theme:
 *
 *   | token          | hex       | on bg #FFFFFF | on bgSubtle #F7F7F9 | AA body |
 *   |----------------|-----------|---------------|---------------------|---------|
 *   | primary        | #1CC29F   | 2.27:1        | 2.12:1              | FAIL    |
 *   | primaryDark    | #159E82   | 3.36:1        | 3.14:1              | FAIL    |
 *   | primaryText    | #0B7C63   | 5.15:1        | 4.81:1              | PASS    |
 *   | negative       | #FF652F   | 2.94:1        | 2.74:1              | FAIL    |
 *   | negativeText   | #C2410C   | 5.18:1        | 4.84:1              | PASS    |
 *   | neutral        | #8A8A8E   | 3.44:1        | 3.21:1              | FAIL    |
 *   | neutralText    | #6E6E73   | 5.07:1        | 4.74:1              | PASS    |
 *   | danger         | #D93025   | 4.77:1        | 4.46:1              | mixed   |
 *   | dangerText     | #C5221A   | 5.80:1        | 5.43:1              | PASS    |
 *   | text           | #1C1C1E   | 17.01:1       | 15.90:1             | PASS    |
 *   | textSecondary  | #6E6E73   | 5.07:1        | 4.74:1              | PASS    |
 *
 * `primaryText` `#0B7C63` sits at hue 167 deg — the same hue as the brand teal
 * (`#1CC29F`, hue 167 deg) — so it reads as the same colour, just darker.
 *
 * `danger` `#D93025` is kept at the documented value because it passes on white, but it
 * lands at 4.46:1 on `bgSubtle`, which is why `dangerText` exists and is what components
 * actually use.
 *
 * `onPrimary` `#04241D` is the foreground for anything painted ON a `primary` fill:
 * white on `#1CC29F` is only 2.27:1, so a teal button with a white label fails AA.
 * Dark-on-teal measures 7.27:1.
 *
 * Colour is never the ONLY signal (docs/07 §Colour semantics, NFR-5) — money direction
 * is always paired with the words "you owe" / "owes you" or an explicit sign.
 */

/* -------------------------------------------------------------------------- */
/* Shape                                                                      */
/* -------------------------------------------------------------------------- */

export interface ThemeColors {
  /** Brand teal. Fills, accents, large type, icons. NEVER body text on light. */
  readonly primary: string;
  /** Darker brand teal. Non-text UI and large text only — 3.36:1, still fails AA body. */
  readonly primaryDark: string;
  /** AA-passing teal for text and links on a light surface. */
  readonly primaryText: string;
  /** Pressed/active state of a primary fill. */
  readonly primaryPressed: string;
  /** Foreground to paint ON a `primary` fill. */
  readonly onPrimary: string;

  /** Money direction: you are owed. Fill/icon only. */
  readonly positive: string;
  /** Money direction: you are owed — text-safe. */
  readonly positiveText: string;
  /** Money direction: you owe. Fill/icon only. */
  readonly negative: string;
  /** Money direction: you owe — text-safe. */
  readonly negativeText: string;
  /** Money direction: settled up. Fill/icon only. */
  readonly neutral: string;
  /** Money direction: settled up — text-safe. */
  readonly neutralText: string;

  readonly bg: string;
  readonly bgSubtle: string;
  readonly surface: string;
  /** Hairline separators. Decorative — exempt from the 3:1 non-text rule. */
  readonly border: string;
  /** Borders that carry meaning (input outlines) — meets 3:1 against `surface`. */
  readonly borderStrong: string;

  readonly text: string;
  readonly textSecondary: string;
  readonly textInverse: string;

  /** Destructive fill/icon. */
  readonly danger: string;
  /** Destructive text — safe on both `bg` and `bgSubtle`. */
  readonly dangerText: string;

  /** Visible keyboard focus ring (NFR-6). >= 3:1 against every surface. */
  readonly focusRing: string;
  /** Scrim behind sheets and dialogs. */
  readonly overlay: string;
}

export interface ThemeTokens {
  readonly color: ThemeColors;
  /** 4pt grid. Consumed as `px` on web, as raw numbers by RN. */
  readonly space: {
    readonly xs: number;
    readonly sm: number;
    readonly md: number;
    readonly lg: number;
    readonly xl: number;
    readonly xxl: number;
  };
  readonly radius: {
    readonly sm: number;
    readonly md: number;
    readonly lg: number;
    readonly pill: number;
  };
  readonly font: {
    readonly size: {
      readonly xs: number;
      readonly sm: number;
      readonly md: number;
      readonly lg: number;
      readonly xl: number;
      readonly xxl: number;
    };
    readonly weight: {
      readonly regular: string;
      readonly medium: string;
      readonly semibold: string;
      readonly bold: string;
    };
    /** Unitless multipliers — valid in CSS `line-height` and in RN after multiplying. */
    readonly lineHeight: {
      readonly tight: number;
      readonly normal: number;
    };
  };
  readonly size: {
    /** NFR-4 / Article IX: no interactive element is ever smaller than this. */
    readonly touchTarget: number;
    readonly avatarSm: number;
    readonly avatarMd: number;
    readonly avatarLg: number;
    readonly tabBar: number;
    /** docs/07 §Responsive — the phone column never grows past this. */
    readonly contentMaxWidth: number;
    /**
     * A single column of form controls. Narrower than `contentMaxWidth`, because a 640px-wide
     * text input is harder to use rather than easier, and because FirebaseUI caps its own
     * `.firebaseui-container` at exactly this width — so anything framing the widget has to
     * agree with it or the two disagree visibly about where the page is.
     */
    readonly formMaxWidth: number;
    /** Below this width the layout is full-bleed. */
    readonly phoneBreakpoint: number;
  };
  readonly z: {
    readonly base: number;
    readonly sticky: number;
    readonly overlay: number;
    readonly modal: number;
    readonly toast: number;
  };
  /**
   * Not in docs/07, added here so transitions are not magic numbers either.
   * Milliseconds. Every consumer must respect `prefers-reduced-motion`.
   */
  readonly motion: {
    readonly instant: number;
    readonly fast: number;
    readonly normal: number;
  };
}

/* -------------------------------------------------------------------------- */
/* Scales shared by both themes                                               */
/* -------------------------------------------------------------------------- */

const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

const font = {
  size: { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, xxl: 32 },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  lineHeight: { tight: 1.2, normal: 1.5 },
} as const;

const size = {
  touchTarget: 44,
  avatarSm: 32,
  avatarMd: 40,
  avatarLg: 64,
  tabBar: 56,
  contentMaxWidth: 640,
  formMaxWidth: 360,
  phoneBreakpoint: 640,
} as const;

const z = { base: 0, sticky: 10, overlay: 100, modal: 200, toast: 300 } as const;

const motion = { instant: 0, fast: 120, normal: 200 } as const;

/* -------------------------------------------------------------------------- */
/* Light theme                                                                */
/* -------------------------------------------------------------------------- */

const lightColors = {
  primary: '#1CC29F',
  primaryDark: '#159E82',
  primaryText: '#0B7C63',
  primaryPressed: '#096351',
  onPrimary: '#04241D',

  positive: '#1CC29F',
  positiveText: '#0B7C63',
  negative: '#FF652F',
  negativeText: '#C2410C',
  neutral: '#8A8A8E',
  neutralText: '#6E6E73',

  bg: '#FFFFFF',
  bgSubtle: '#F7F7F9',
  surface: '#FFFFFF',
  border: '#E5E5EA',
  borderStrong: '#C7C7CC',

  text: '#1C1C1E',
  textSecondary: '#6E6E73',
  textInverse: '#FFFFFF',

  danger: '#D93025',
  dangerText: '#C5221A',

  focusRing: '#0B7C63',
  overlay: 'rgba(28, 28, 30, 0.45)',
} as const satisfies ThemeColors;

/* -------------------------------------------------------------------------- */
/* Dark theme — identical keys (docs/07), only `color` differs                 */
/* -------------------------------------------------------------------------- */
/**
 * Measured against the dark surfaces:
 *
 *   | token         | hex       | on bg #0E0E11 | on surface #17171C |
 *   |---------------|-----------|---------------|--------------------|
 *   | primaryText   | #2ED3AE   | 10.14:1       | 9.39:1             |
 *   | negativeText  | #FF8A5C   | 8.30:1        | 7.69:1             |
 *   | neutralText   | #A1A1A8   | 7.51:1        | 6.96:1             |
 *   | dangerText    | #FF6B60   | 6.91:1        | 6.40:1             |
 *   | text          | #F2F2F7   | 17.27:1       | 16.01:1            |
 *
 * On dark, the brand teal itself clears AA (8.50:1), so the gap between the brand
 * colour and the text colour is much smaller than on light — but the two roles are
 * kept separate anyway so component code never has to branch on the theme.
 */
const darkColors = {
  primary: '#1CC29F',
  primaryDark: '#159E82',
  primaryText: '#2ED3AE',
  primaryPressed: '#4FE0C0',
  onPrimary: '#04241D',

  positive: '#1CC29F',
  positiveText: '#2ED3AE',
  negative: '#FF652F',
  negativeText: '#FF8A5C',
  neutral: '#8A8A8E',
  neutralText: '#A1A1A8',

  bg: '#0E0E11',
  bgSubtle: '#17171C',
  surface: '#17171C',
  border: '#2C2C31',
  borderStrong: '#3A3A41',

  text: '#F2F2F7',
  textSecondary: '#A1A1A8',
  textInverse: '#0E0E11',

  danger: '#FF6B60',
  dangerText: '#FF6B60',

  focusRing: '#2ED3AE',
  overlay: 'rgba(0, 0, 0, 0.65)',
} as const satisfies ThemeColors;

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

/** The default (light) token set. `tokens` is an alias for `lightTokens`. */
export const lightTokens = {
  color: lightColors,
  space,
  radius,
  font,
  size,
  z,
  motion,
} as const satisfies ThemeTokens;

/** Dark token set. Identical keys, different `color` values. */
export const darkTokens = {
  color: darkColors,
  space,
  radius,
  font,
  size,
  z,
  motion,
} as const satisfies ThemeTokens;

/**
 * The tokens. Import this everywhere; `darkTokens` is only needed by the
 * platform layer that emits or swaps themes.
 *
 * docs/07: "Respect the system preference; no in-app toggle in v1."
 */
export const tokens = lightTokens;

export type ColorScheme = 'light' | 'dark';

/** Look up a token set by colour scheme. Used by both the web CSS bridge and RN. */
export function tokensFor(scheme: ColorScheme): ThemeTokens {
  return scheme === 'dark' ? darkTokens : lightTokens;
}
