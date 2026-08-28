/**
 * `<Text>`'s two contracts.
 *
 * **Semantics.** A title has to reach the accessibility tree as a heading, or screen-reader
 * users lose the ability to jump between sections (NFR-4). `Text` picks the element from the
 * variant, so the mapping is code, not markup, and can regress.
 *
 * **Tokens.** Article IX: colour is chosen by TONE, never by a raw colour value. The failure
 * mode is not a crash — a tone whose class went missing renders in the default colour and
 * looks merely wrong — so the test is that every tone, variant and weight resolves to a
 * class of its own and that nothing ever reaches an inline style.
 *
 * The `satisfies Record<…, true>` maps below are deliberate: they make a value added to
 * `TextTone`/`TextVariant`/`TextWeight` without a test here a compile error.
 */

import { describe, expect, it } from 'vitest';
import { render } from '../../__tests__/helpers/render';
import { Text, type TextTone, type TextVariant, type TextWeight } from '../Text';

const TONES = Object.keys({
  default: true,
  secondary: true,
  primary: true,
  danger: true,
  inverse: true,
  onPrimary: true,
  positive: true,
  negative: true,
  neutral: true,
} satisfies Record<TextTone, true>) as TextTone[];

const VARIANTS = Object.keys({
  display: true,
  title: true,
  body: true,
  caption: true,
  amount: true,
} satisfies Record<TextVariant, true>) as TextVariant[];

const WEIGHTS = Object.keys({
  regular: true,
  medium: true,
  semibold: true,
  bold: true,
} satisfies Record<TextWeight, true>) as TextWeight[];

function only(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild;
  expect(el, 'Text rendered nothing').not.toBeNull();
  return el as HTMLElement;
}

function classesOf(node: HTMLElement): readonly string[] {
  return Array.from(node.classList).sort();
}

describe('<Text> semantics', () => {
  it('renders titles and displays as headings so they can be navigated to', () => {
    expect(only(render(<Text variant="title">Groceries</Text>).container).tagName).toBe('H2');
    expect(only(render(<Text variant="display">£12.00</Text>).container).tagName).toBe('H2');
  });

  it('renders ordinary copy inline, so it flows inside its parent', () => {
    expect(only(render(<Text>plain</Text>).container).tagName).toBe('SPAN');
    expect(only(render(<Text variant="caption">small</Text>).container).tagName).toBe('SPAN');
    expect(only(render(<Text variant="amount">12.00</Text>).container).tagName).toBe('SPAN');
  });

  it('lets a screen override the element when the heading level is wrong', () => {
    expect(
      only(
        render(
          <Text variant="title" as="h1">
            Groups
          </Text>,
        ).container,
      ).tagName,
    ).toBe('H1');
    expect(
      only(
        render(
          <Text variant="title" as="p">
            not a heading
          </Text>,
        ).container,
      ).tagName,
    ).toBe('P');
  });

  it('associates a label with its field, and only when it really is a label', () => {
    const label = only(
      render(
        <Text as="label" htmlFor="amount">
          Amount
        </Text>,
      ).container,
    );
    expect(label.getAttribute('for')).toBe('amount');

    // `for` on a span points at nothing and would be reported as a broken association.
    const span = only(
      render(
        <Text as="span" htmlFor="amount">
          Amount
        </Text>,
      ).container,
    );
    expect(span.hasAttribute('for')).toBe(false);
  });

  it('hides decorative text from the accessibility tree when asked', () => {
    const el = only(render(<Text aria-hidden>·</Text>).container);

    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders its children as the visible text', () => {
    expect(render(<Text>Dinner in Lisbon</Text>).container.textContent).toBe('Dinner in Lisbon');
  });
});

describe('<Text> token contract', () => {
  it('never writes an inline style, whatever the tone', () => {
    // Article IX: no hard-coded colours outside tokens. An inline style is the only way
    // one could get in, so the absence of the attribute is the whole rule.
    for (const tone of TONES) {
      const el = only(render(<Text tone={tone}>x</Text>).container);
      expect(el.hasAttribute('style'), tone).toBe(false);
    }
  });

  it('gives every tone a class of its own', () => {
    // A tone missing from the lookup table resolves to '' and silently renders in the
    // default colour — which is exactly what a positive balance shown in grey looks like.
    const seen = new Map<string, TextTone>();

    for (const tone of TONES) {
      const key = classesOf(only(render(<Text tone={tone}>x</Text>).container)).join(' ');
      expect(seen.get(key), `${tone} styles identically to ${seen.get(key) ?? ''}`).toBeUndefined();
      seen.set(key, tone);
    }

    expect(seen.size).toBe(TONES.length);
  });

  it('gives every variant a class of its own', () => {
    const seen = new Set<string>();

    for (const variant of VARIANTS) {
      const key = classesOf(only(render(<Text variant={variant}>x</Text>).container)).join(' ');
      expect(seen.has(key), `${variant} styles identically to another variant`).toBe(false);
      seen.add(key);
    }
  });

  it('adds a weight class only when a weight is asked for', () => {
    const unweighted = classesOf(only(render(<Text>x</Text>).container));
    const seen = new Set<string>();

    for (const weight of WEIGHTS) {
      const classes = classesOf(only(render(<Text weight={weight}>x</Text>).container));
      expect(classes.length, weight).toBe(unweighted.length + 1);
      const key = classes.join(' ');
      expect(seen.has(key), `${weight} styles identically to another weight`).toBe(false);
      seen.add(key);
    }
  });

  it('keeps a caller className alongside the token classes rather than replacing them', () => {
    const el = only(render(<Text className="tabLabel">Groups</Text>).container);

    expect(el.classList.contains('tabLabel')).toBe(true);
    expect(el.classList.length).toBeGreaterThan(1);
  });
});
