/**
 * The token bridge, and its agreement with the token accessors in `components/tokenProps.ts`.
 *
 * These two files are joined by a string. `tokensCss.ts` emits
 * `--splitsutra-size-touch-target`; `tokenProps.ts` builds the same name independently from
 * a token key and its own `kebab()`. Nothing checks that the two spellings match — a
 * `var()` naming a property no one declared is not a CSS error, it is simply ignored, so the
 * component renders unstyled and the type checker is perfectly happy.
 *
 * The unit rules are the other silent one. `tokensCss.ts` says it out loud: "`line-height:
 * 1.5` is a multiplier; `1.5px` would be a silent disaster."
 */

import { describe, expect, it } from 'vitest';
import { lightTokens } from '@splitsutra/core';
import {
  colorVar,
  fontSizeVar,
  fontWeightVar,
  motionVar,
  radiusVar,
  safeAreaVar,
  sizeVar,
  spaceVar,
  zVar,
  type ColorToken,
  type FontSizeToken,
  type FontWeightToken,
  type MotionToken,
  type RadiusToken,
  type SafeAreaEdge,
  type SizeToken,
  type SpaceToken,
  type ZToken,
} from '../../components/tokenProps';
import { buildTokensCss, flattenTokens } from '../tokensCss';

const css = buildTokensCss();

/** `'var(--x)'` -> `'--x'`. */
function nameOf(reference: string): string {
  expect(reference.startsWith('var(') && reference.endsWith(')')).toBe(true);
  return reference.slice(4, -1);
}

function expectDeclared(reference: string, key: string): void {
  expect(css.includes(`${nameOf(reference)}:`), `${key} -> ${reference} is never declared`).toBe(
    true,
  );
}

function keysOf<T extends string>(group: Readonly<Record<string, unknown>>): readonly T[] {
  return Object.keys(group) as T[];
}

describe('token accessors and the emitted stylesheet', () => {
  it('declares a custom property for every accessor a component can call', () => {
    for (const key of keysOf<SpaceToken>(lightTokens.space)) expectDeclared(spaceVar(key), key);
    for (const key of keysOf<RadiusToken>(lightTokens.radius)) expectDeclared(radiusVar(key), key);
    for (const key of keysOf<SizeToken>(lightTokens.size)) expectDeclared(sizeVar(key), key);
    for (const key of keysOf<ZToken>(lightTokens.z)) expectDeclared(zVar(key), key);
    for (const key of keysOf<MotionToken>(lightTokens.motion)) expectDeclared(motionVar(key), key);
    for (const key of keysOf<ColorToken>(lightTokens.color)) expectDeclared(colorVar(key), key);
    for (const key of keysOf<FontSizeToken>(lightTokens.font.size)) {
      expectDeclared(fontSizeVar(key), key);
    }
    for (const key of keysOf<FontWeightToken>(lightTokens.font.weight)) {
      expectDeclared(fontWeightVar(key), key);
    }
  });

  it('declares the safe-area insets the layout tokens reference', () => {
    const edges: readonly SafeAreaEdge[] = ['top', 'right', 'bottom', 'left'];
    for (const edge of edges) expectDeclared(safeAreaVar(edge), edge);
  });

  it('gives the touch-target token a value no smaller than 44px', () => {
    // Article IX. The CSS side of this is asserted in Pressable's test.
    expect(lightTokens.size.touchTarget).toBeGreaterThanOrEqual(44);
    expect(css).toContain('--splitsutra-size-touch-target: 44px');
  });
});

describe('token units', () => {
  const values = new Map(flattenTokens(lightTokens));

  it('keeps line height unitless, because it is a multiplier and not a length', () => {
    for (const [name, value] of values) {
      if (!name.startsWith('--splitsutra-font-line-height-')) continue;
      expect(value, name).not.toContain('px');
      expect(Number(value), name).toBeGreaterThan(0);
    }
  });

  it('emits lengths in px and durations in ms', () => {
    expect(values.get('--splitsutra-space-md')).toMatch(/^\d+px$/);
    expect(values.get('--splitsutra-radius-md')).toMatch(/^\d+px$/);
    expect(values.get('--splitsutra-font-size-md')).toMatch(/^\d+px$/);

    for (const key of keysOf<MotionToken>(lightTokens.motion)) {
      expect(values.get(nameOf(motionVar(key))), key).toMatch(/^\d+ms$/);
    }
  });

  it('leaves colours and font weights as the literal CSS values they already are', () => {
    for (const key of keysOf<ColorToken>(lightTokens.color)) {
      expect(values.get(nameOf(colorVar(key))), key).toBe(lightTokens.color[key]);
    }
    expect(values.get('--splitsutra-font-weight-bold')).toBe(lightTokens.font.weight.bold);
  });
});

describe('the stylesheet structure', () => {
  it('defines the complete light set on bare :root, before any media query', () => {
    // A variable defined only inside `prefers-color-scheme` is undefined for everyone the
    // query does not match.
    const rootBlock = css.slice(0, css.indexOf('@media'));

    for (const [name] of flattenTokens(lightTokens)) {
      expect(rootBlock.includes(`${name}:`), `${name} is not declared on bare :root`).toBe(true);
    }
  });

  it('overrides only colours in the dark theme', () => {
    // docs/07: dark mode is a palette swap, not a different layout.
    const dark = css.slice(css.indexOf(':root[data-color-scheme="dark"]'));
    const declared = dark.match(/--splitsutra-[a-z0-9-]+(?=:)/g) ?? [];

    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      expect(name.startsWith('--splitsutra-color-'), name).toBe(true);
    }
  });
});
