/**
 * The cascade contract between a component primitive and the class a caller passes it.
 *
 * ## The bug this file exists to prevent
 *
 * `<Pressable>`, `<Text>`, `<Stack>`, `<Row>`, `<Card>`, `<List>` and `<Avatar>` all merge a
 * caller's `className` onto the same element that carries their own base class. Both are
 * single class selectors, so their specificity is identical and **the cascade falls back to
 * source order** — which here is CSS-module import order, something nobody chose and no
 * review would catch.
 *
 * `layout.module.css` happened to load last, so `.stack` beat every class ever passed into a
 * `<Stack>`. `controls.module.css` loaded before it but after `navigation.module.css`, so
 * `.pressable` beat `.tab`. Measured on the running app, **41 declarations across the design
 * system were silently dropped**:
 *
 *   - the tab bar laid its icons BESIDE the labels instead of above them, so every label
 *     wrapped mid-word at 375px ("Group / s", "Accou / nt")
 *   - the active tab rendered in the same colour as the inactive ones
 *   - the raised Add button lost its pill radius and its primary fill entirely
 *   - every empty state was top-aligned, gap 0, padding 0 — `.stack`'s `padding` SHORTHAND
 *     also wiped `.empty`'s `padding-block` / `padding-inline` longhands
 *
 * Not one of those is a mistake in any individual rule, and not one is visible to a
 * component test: happy-dom applies no stylesheet and computes no layout, which is why
 * `TabBar.test.tsx` passed throughout.
 *
 * ## The invariant
 *
 * An unlayered rule beats every layered one. So the fix — and what these tests hold — is
 * structural rather than per-rule:
 *
 *   - `reset` is the bottom layer and holds ALL of reset.css
 *   - `primitives` holds the base rule of every component that merges a caller `className`
 *   - **every consumer rule stays unlayered**, and therefore wins by construction
 *
 * A specificity bump on each consumer (`.tab.tab`) would have fixed the same 41 lines, but
 * left the next component to rediscover the trap. This is checked here instead.
 */

import { describe, expect, it } from 'vitest';
import { parseCss, readCss, rulesFor, type CssRule } from '../../__tests__/helpers/cssSource';

const SHEETS = {
  navigation: 'navigation/navigation.module.css',
  text: 'components/text.module.css',
  controls: 'components/controls.module.css',
  list: 'components/list.module.css',
  layout: 'components/layout.module.css',
} as const;

type SheetName = keyof typeof SHEETS;

const parsed = Object.fromEntries(
  Object.entries(SHEETS).map(([name, path]) => [name, parseCss(readCss(path))]),
) as Record<SheetName, readonly CssRule[]>;

/**
 * The base class of every component that merges a caller's `className` onto its own element.
 * Maintained by hand — grep for `className)` in `apps/web/src/components` to re-derive it.
 */
const PRIMITIVES: readonly (readonly [SheetName, string])[] = [
  ['controls', '.pressable'],
  ['controls', '.pressableBlock'],
  ['text', '.text'],
  ['layout', '.stack'],
  ['layout', '.row'],
  ['layout', '.card'],
  ['list', '.list'],
  ['list', '.avatar'],
];

/**
 * Every place a class from one module lands on a primitive owned by another. These are the
 * pairs that tied on specificity, and each one names properties that were being dropped.
 */
const COMPOSITIONS: readonly {
  readonly consumer: readonly [SheetName, string];
  readonly primitive: readonly [SheetName, string];
}[] = [
  { consumer: ['navigation', '.tab'], primitive: ['controls', '.pressable'] },
  { consumer: ['navigation', '.tabActive'], primitive: ['controls', '.pressable'] },
  { consumer: ['navigation', '.tabRaised'], primitive: ['controls', '.pressable'] },
  { consumer: ['navigation', '.tabLabel'], primitive: ['text', '.text'] },
  { consumer: ['navigation', '.screenHeader'], primitive: ['layout', '.stack'] },
  { consumer: ['navigation', '.modalHeader'], primitive: ['layout', '.stack'] },
  { consumer: ['list', '.empty'], primitive: ['layout', '.stack'] },
  { consumer: ['list', '.emptyActions'], primitive: ['layout', '.stack'] },
  { consumer: ['list', '.rowBody'], primitive: ['layout', '.stack'] },
  { consumer: ['list', '.rowTrailing'], primitive: ['layout', '.stack'] },
  { consumer: ['list', '.row'], primitive: ['layout', '.stack'] },
  { consumer: ['controls', '.field'], primitive: ['layout', '.stack'] },
  { consumer: ['controls', '.segmented'], primitive: ['layout', '.stack'] },
  { consumer: ['controls', '.segmented'], primitive: ['layout', '.row'] },
];

function ruleOf([sheet, selector]: readonly [SheetName, string]): CssRule {
  const found = rulesFor(parsed[sheet], selector);
  expect(found.length, `${SHEETS[sheet]} has no \`${selector}\` rule`).toBeGreaterThan(0);
  return found[0]!;
}

describe('layer order', () => {
  const reset = readCss('styles/reset.css');

  it('declares the order once, in the first stylesheet the app imports', () => {
    // A layer's position is fixed where its name is FIRST seen. If a module's
    // `@layer primitives { … }` were parsed before this statement, `primitives` would sit
    // BELOW `reset` and the reset would start winning.
    expect(reset).toContain('@layer reset, primitives;');

    const main = readCss('main.tsx');
    const resetImport = main.indexOf("'./styles/reset.css'");
    expect(resetImport, 'main.tsx no longer imports reset.css').toBeGreaterThan(-1);
    // Nothing may bring CSS in ahead of it.
    const earlierCss = main.slice(0, resetImport).match(/import '[^']*\.css'/g);
    expect(earlierCss).toBeNull();
  });

  it('puts every reset rule in the bottom layer', () => {
    // An unlayered reset rule would outrank the primitives it is meant to sit under —
    // `:focus-visible` sets `border-radius`, and `a` / `button` set `color`.
    const stray = parseCss(reset)
      .filter((rule) => rule.layer !== 'reset')
      .map((rule) => rule.selector);

    expect(stray, 'these reset rules are unlayered and now beat every primitive').toEqual([]);
  });
});

describe('primitives', () => {
  it.each(PRIMITIVES)('%s %s is declared inside @layer primitives', (sheet, selector) => {
    for (const rule of rulesFor(parsed[sheet], selector)) {
      expect(rule.layer, `${SHEETS[sheet]} \`${selector}\` must be layered`).toBe('primitives');
    }
  });

  it('layers the state rules too, not just the base one', () => {
    // `.pressable:active` sets `background-color`, and `.tabRaised:active` has to beat it.
    for (const selector of ['.pressable:active', '.pressable:hover']) {
      const rules = rulesFor(parsed.controls, selector);
      expect(rules.length, `controls.module.css lost \`${selector}\``).toBeGreaterThan(0);
      for (const rule of rules) expect(rule.layer).toBe('primitives');
    }
  });
});

describe('consumers', () => {
  it.each(COMPOSITIONS.map((c) => [c.consumer[0], c.consumer[1], c] as const))(
    '%s %s stays unlayered so it outranks the primitive it composes onto',
    (_sheet, _selector, composition) => {
      const consumer = ruleOf(composition.consumer);
      const primitive = ruleOf(composition.primitive);

      expect(
        consumer.layer,
        `${composition.consumer[1]} is layered, so ${composition.primitive[1]} beats it again`,
      ).toBeNull();
      expect(primitive.layer).toBe('primitives');
    },
  );

  it('still has something to protect — each pair really does collide', () => {
    // If a pair stops overlapping the entry is dead weight and should be deleted rather
    // than left asserting nothing. Shorthands are not expanded here, so this UNDERCOUNTS:
    // `.stack`'s `padding` also overrode `.empty`'s `padding-block`/`padding-inline`.
    const inert = COMPOSITIONS.filter(({ consumer, primitive }) => {
      const shared = [...ruleOf(consumer).properties].filter((property) =>
        ruleOf(primitive).properties.has(property),
      );
      return shared.length === 0;
    }).map(({ consumer, primitive }) => `${consumer[1]} vs ${primitive[1]}`);

    expect(inert).toEqual([]);
  });
});
