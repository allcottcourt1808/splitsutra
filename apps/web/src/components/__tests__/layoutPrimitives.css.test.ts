/**
 * The flex declarations that keep `.screenBody` the app's one working scroller.
 *
 * 🔴 THIS IS A TEXT ASSERTION ON A STYLESHEET, NOT A LAYOUT ASSERTION. It cannot prove the
 * layout is right. Every other test in this suite runs under happy-dom, which applies no
 * stylesheet and computes no layout, so the suite is structurally blind to the bug below and
 * to any regression of it. All this file can do is catch someone deleting or weakening the
 * specific declarations a real-browser measurement proved were necessary — which is why a
 * test is reading CSS source text at all, an otherwise odd thing that would look like a
 * candidate for deletion.
 *
 * THE INCIDENT (PR #33). `.screenBody` is the only scroller in the app. Its descendants took
 * the flexbox default `flex: 0 1 auto` and also carry `min-height: 0`, so they collapsed
 * under their own content instead of making the scroller taller. `scrollHeight` then never
 * exceeded `clientHeight`, so the overflow was not scrollable-but-offscreen, it was
 * UNREACHABLE — and because `.cardFlush` clips to the corner radius with `overflow: hidden`,
 * a shrunk `.card` did not merely overflow, it silently ate its content. The currency picker
 * lost its last three rows with no scrollbar anywhere to hint they existed.
 *
 * Each `it` below names the one declaration it guards and the reason that declaration is not
 * a style preference. Parsing is deliberately whitespace-tolerant so reformatting cannot fail
 * the build, but never so loose that `0 1 auto` would slip through — the shrink factor is the
 * whole point.
 */

import { describe, expect, it } from 'vitest';
import { readCss } from '../../__tests__/helpers/cssSource';

const layoutCss = readCss('components/layout.module.css');

interface Rule {
  /** One selector from the rule's prelude, whitespace-collapsed. */
  readonly selector: string;
  /** The declarations between the braces, comments already stripped. */
  readonly body: string;
}

/**
 * Every innermost rule in the file. The `@layer primitives` wrapper needs no special case:
 * its body contains braces, so `[^{}]*` cannot span it and the match slides past the wrapper
 * onto the rules inside. Nothing in this stylesheet nests deeper than that.
 */
function parseRules(source: string): readonly Rule[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];

  for (const match of stripped.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const prelude = (match[1] ?? '').trim().replace(/\s+/g, ' ');
    const body = match[2] ?? '';
    for (const selector of prelude.split(',').map((s) => s.trim())) {
      if (selector.length > 0) rules.push({ selector, body });
    }
  }

  return rules;
}

const RULES = parseRules(layoutCss);

/** The declarations of the rule whose prelude is exactly `selector`. Fails if it was renamed. */
function bodyOf(selector: string): string {
  const matches = RULES.filter((rule) => rule.selector === selector);
  expect(matches, `layout.module.css has no \`${selector} { … }\` rule`).toHaveLength(1);
  return matches[0]!.body;
}

/**
 * The value of `property` in `body`, whitespace-collapsed — `null` when undeclared.
 * Anchored at a declaration boundary so `min-height` cannot answer for `height`.
 */
function valueOf(body: string, property: string): string | null {
  const pattern = new RegExp(`(?:^|[;{])\\s*${property}\\s*:\\s*([^;]+)`, 'i');
  const value = pattern.exec(body)?.[1];
  return value === undefined ? null : value.trim().replace(/\s+/g, ' ');
}

describe('layout.module.css shrink invariants', () => {
  it('defaults .stack to a non-shrinking flex, so a Stack sizes to its content', () => {
    // A shrinkable Stack paired with the `min-height: 0` below it collapses under its own
    // content and the scroller never learns there is anything to scroll to. `0 1 auto` — the
    // flexbox default, and the tidy-looking edit — is the exact value that ate the rows.
    const stack = bodyOf('.stack');
    const flex = valueOf(stack, 'flex');

    expect(flex, '.stack no longer declares `flex`').not.toBeNull();

    const fallback = /^var\(\s*--stack-flex\s*,\s*([^)]*)\)$/.exec(flex!)?.[1];
    expect(fallback, `.stack flex is \`${flex}\`, not a var with a fallback`).toBeDefined();
    expect(fallback!.trim().replace(/\s+/g, ' ')).toBe('0 0 auto');

    // The custom property is still the caller's opt-out: `<Stack flex="…">` is how a screen
    // says it genuinely wants to shrink, so the fallback has to be the safe end of that pair.
    expect(valueOf(stack, 'min-height')).toBe('0');
  });

  it('pins .card to flex 0 0 auto, because a shrunk card clips instead of overflowing', () => {
    expect(valueOf(bodyOf('.card'), 'flex')).toBe('0 0 auto');
  });

  it('keeps .cardFlush clipping, which is why .card cannot be allowed to shrink', () => {
    // Named separately because it is the premise of the test above, not a duplicate of it: if
    // this ever stops being `hidden`, a shrunk card would at least overflow visibly and the
    // rationale written on `.card` needs rereading rather than trusting.
    expect(valueOf(bodyOf('.cardFlush'), 'overflow')).toBe('hidden');
  });

  it('leaves .screenBody owning the scroll, and owning it alone', () => {
    // The whole shrink fix assumes exactly one scrolling ancestor. A second `overflow: auto`
    // anywhere in here would give content a different place to hide.
    const screenBody = bodyOf('.screenBody');

    expect(valueOf(screenBody, 'overflow-y')).toBe('auto');
    // Without this the scroller is a flex child that refuses to shrink and never scrolls.
    expect(valueOf(screenBody, 'min-height')).toBe('0');

    const scrollers = RULES.filter((rule) =>
      /(?:^|[;{])\s*overflow(?:-[xy])?\s*:\s*[^;]*\b(?:auto|scroll)\b/i.test(rule.body),
    ).map((rule) => rule.selector);

    expect(scrollers).toEqual(['.screenBody']);
  });
});
