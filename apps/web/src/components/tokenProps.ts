/**
 * Token-typed props.
 *
 * Article IX says "no hard-coded colours, spacing, radii, or font sizes outside
 * tokens.ts". A lint rule can catch `#1CC29F` in a stylesheet, but it cannot catch a
 * component prop typed as `string`. So component props are typed as token KEYS, derived
 * from the core token objects — which makes a non-token value a compile error rather
 * than a review comment.
 *
 *     <Stack gap="lg" />      // ok
 *     <Stack gap="16px" />    // Type '"16px"' is not assignable to type SpaceToken
 *
 * The helpers below turn a token key into the CSS custom property the bridge emitted
 * (see ../styles/tokensCss.ts). Phase 12 replaces the bodies with direct object lookups
 * into the same tokens — the prop types do not change.
 */

import type { CSSProperties } from 'react';
import type { ThemeColors, ThemeTokens } from '@splitsutra/core';

export type SpaceToken = keyof ThemeTokens['space'];
export type RadiusToken = keyof ThemeTokens['radius'];
export type FontSizeToken = keyof ThemeTokens['font']['size'];
export type FontWeightToken = keyof ThemeTokens['font']['weight'];
export type SizeToken = keyof ThemeTokens['size'];
export type ZToken = keyof ThemeTokens['z'];
export type MotionToken = keyof ThemeTokens['motion'];
export type ColorToken = keyof ThemeColors;

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function spaceVar(token: SpaceToken): string {
  return `var(--splitsutra-space-${token})`;
}

export function radiusVar(token: RadiusToken): string {
  return `var(--splitsutra-radius-${token})`;
}

export function fontSizeVar(token: FontSizeToken): string {
  return `var(--splitsutra-font-size-${token})`;
}

export function fontWeightVar(token: FontWeightToken): string {
  return `var(--splitsutra-font-weight-${token})`;
}

export function sizeVar(token: SizeToken): string {
  return `var(--splitsutra-size-${kebab(token)})`;
}

export function zVar(token: ZToken): string {
  return `var(--splitsutra-z-${token})`;
}

export function motionVar(token: MotionToken): string {
  return `var(--splitsutra-motion-${token})`;
}

export function colorVar(token: ColorToken): string {
  return `var(--splitsutra-color-${kebab(token)})`;
}

/** Safe-area insets. Platform-resolved, so not part of the token scales. */
export type SafeAreaEdge = 'top' | 'right' | 'bottom' | 'left';

export function safeAreaVar(edge: SafeAreaEdge): string {
  return `var(--splitsutra-safe-area-${edge})`;
}

/**
 * A `style` object that may also carry CSS custom properties.
 *
 * React's `CSSProperties` does not admit `--*` keys, and components set token values
 * that way rather than generating a class per token combination. Cast at the call site
 * with `as CSSProperties`; this type keeps the object itself checked.
 */
export type StyleWithVars = CSSProperties & Record<`--${string}`, string | number>;

/** Drop `undefined` entries so `exactOptionalPropertyTypes` stays satisfied. */
export function vars(entries: Record<string, string | number | undefined>): CSSProperties {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) out[key] = value;
  }
  return out as CSSProperties;
}

/** Join class names, skipping falsy ones. */
export function cx(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}
