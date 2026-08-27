/**
 * The token -> CSS custom property bridge.
 *
 * The token VALUES are single-sourced from `@splitsutra/core` and never re-typed in CSS.
 * This module is the only place that knows how a TS token becomes a CSS value
 * (which groups get `px`, which get `ms`, which are unitless).
 *
 * Why the generator lives in `apps/web` and not in core: CSS is a pixel concern, and
 * core must stay free of anything a React Native build would have to ignore
 * (Article II). Phase 12 writes the equivalent `StyleSheet` bridge in `apps/mobile`
 * against the same objects.
 *
 * `buildTokensCss()` is pure and has no DOM dependency, so it is unit-testable and
 * could be lifted into a Vite plugin later (checklists/phase-04-design-system.md §1
 * calls for "a build step emitting tokens as CSS custom properties"). Injecting at
 * startup instead keeps `pnpm dev` working with zero build coupling; the generator
 * would not change.
 */

import { darkTokens, lightTokens, type ThemeTokens } from '@splitsutra/core';

/** CSS custom property namespace. Every token variable starts with this. */
const PREFIX = '--splitsutra';

/** The `<style>` element id, so re-running the installer replaces rather than stacks. */
const STYLE_ELEMENT_ID = 'splitsutra-tokens';

type TokenGroup = keyof ThemeTokens;

/**
 * How each top-level token group is serialised.
 *
 * `px`       numeric design-system lengths
 * `ms`       durations
 * `raw`      already a complete CSS value (colours, font weights, unitless numbers)
 */
const UNIT_BY_GROUP: Readonly<Record<TokenGroup, 'px' | 'ms' | 'raw'>> = {
  color: 'raw',
  space: 'px',
  radius: 'px',
  font: 'px', // overridden per-leaf below: weight and lineHeight are unitless
  size: 'px',
  z: 'raw',
  motion: 'ms',
};

/**
 * Leaves that must stay unitless even though their group is `px`.
 * `line-height: 1.5` is a multiplier; `1.5px` would be a silent disaster.
 */
const UNITLESS_PATHS: ReadonlySet<string> = new Set(['font.weight', 'font.lineHeight']);

function toKebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serialise(value: string | number, unit: 'px' | 'ms' | 'raw'): string {
  if (typeof value === 'string') return value;
  if (unit === 'px') return `${value}px`;
  if (unit === 'ms') return `${value}ms`;
  return String(value);
}

/**
 * Flatten a token object into `[--splitsutra-a-b-c, value]` pairs.
 * Exported for tests and for the component gallery (phase-04 §2).
 */
export function flattenTokens(theme: ThemeTokens): ReadonlyArray<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [];

  const walk = (node: Record<string, unknown>, path: readonly string[]): void => {
    for (const [key, value] of Object.entries(node)) {
      const nextPath = [...path, key];
      const dotted = nextPath.join('.');

      if (isPlainObject(value)) {
        walk(value, nextPath);
        continue;
      }

      if (typeof value !== 'string' && typeof value !== 'number') continue;

      const group = nextPath[0] as TokenGroup;
      const unit = UNITLESS_PATHS.has(nextPath.slice(0, 2).join('.'))
        ? 'raw'
        : (UNIT_BY_GROUP[group] ?? 'raw');

      const name = `${PREFIX}-${nextPath.map(toKebab).join('-')}`;
      out.push([name, serialise(value, unit)] as const);

      void dotted;
    }
  };

  walk(theme as unknown as Record<string, unknown>, []);
  return out;
}

function declarations(theme: ThemeTokens, indent: string): string {
  return flattenTokens(theme)
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join('\n');
}

/**
 * Only the colour tokens differ between themes, so the dark blocks re-declare colours
 * only. Emitting the whole set twice would work but makes the diff between themes
 * impossible to read in devtools.
 */
function colorDeclarations(theme: ThemeTokens, indent: string): string {
  return flattenTokens(theme)
    .filter(([name]) => name.startsWith(`${PREFIX}-color-`))
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join('\n');
}

/**
 * The full token stylesheet.
 *
 * Structure matters:
 *   1. the complete LIGHT set on bare `:root` — every variable has a definition here,
 *      so nothing can be left undefined by a media query that does not match;
 *   2. dark overrides under `prefers-color-scheme: dark` — the v1 behaviour
 *      (docs/07: "Respect the system preference; no in-app toggle in v1");
 *   3. the same overrides behind `[data-color-scheme]`, which is inert today. It is
 *      the single hook the backlogged appearance toggle needs, and it costs one
 *      selector rather than a refactor.
 */
export function buildTokensCss(): string {
  return [
    '/* GENERATED at runtime from @splitsutra/core tokens — do not hand-edit. */',
    ':root {',
    '  color-scheme: light dark;',
    declarations(lightTokens, '  '),
    '',
    '  /* Platform-resolved, not a design-system constant: only the UA knows these.',
    '     Namespaced as tokens so components never write a raw env() or a magic number',
    '     (docs/02 §mobile-portability contract, rule 10). RN reads the equivalent',
    '     values from useSafeAreaInsets(). */',
    `  ${PREFIX}-safe-area-top: env(safe-area-inset-top, 0px);`,
    `  ${PREFIX}-safe-area-right: env(safe-area-inset-right, 0px);`,
    `  ${PREFIX}-safe-area-bottom: env(safe-area-inset-bottom, 0px);`,
    `  ${PREFIX}-safe-area-left: env(safe-area-inset-left, 0px);`,
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    '  :root:not([data-color-scheme="light"]) {',
    colorDeclarations(darkTokens, '    '),
    '  }',
    '}',
    '',
    ':root[data-color-scheme="dark"] {',
    colorDeclarations(darkTokens, '  '),
    '}',
    '',
    ':root[data-color-scheme="light"] {',
    colorDeclarations(lightTokens, '  '),
    '}',
    '',
  ].join('\n');
}

/**
 * Inject the token variables into the document.
 *
 * Called from `main.tsx` at module scope, BEFORE `createRoot().render()`, so the
 * variables exist on the first paint of any React content.
 *
 * This is the only DOM-touching function in the styles layer, and it lives in
 * `apps/web` where `document` is legal (Article II / contract rule 7).
 */
export function installTokenCssVars(): void {
  const existing = document.getElementById(STYLE_ELEMENT_ID);
  const style = existing instanceof HTMLStyleElement ? existing : document.createElement('style');

  style.id = STYLE_ELEMENT_ID;
  style.textContent = buildTokensCss();

  if (existing === null) {
    // First in <head> so every stylesheet that follows can rely on the variables.
    document.head.prepend(style);
  }
}

/**
 * Reference a token from TypeScript — for the rare inline style that genuinely cannot
 * be expressed in a CSS module (a computed avatar colour, a measured sheet height).
 *
 * Prefer a class in a `.module.css` file. If you find yourself reaching for this a lot,
 * the component is missing a variant prop.
 *
 * @example cssVar('color-primary-text')  // 'var(--splitsutra-color-primary-text)'
 */
export function cssVar(token: string): string {
  return `var(${PREFIX}-${token})`;
}
