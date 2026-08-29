/**
 * `<Pressable>` is the single tappable primitive, so two things ride on it everywhere.
 *
 * **The render-mode branch.** `to` set means a real `<Link>` — deep links, back/forward and
 * cmd-click all depend on it being an anchor with an `href`, none of which a `<button>` with
 * an onClick gives you. The branch also has to fold the other way: a *disabled* `to` must not
 * render an anchor at all, because `aria-disabled` on a link does not stop navigation.
 *
 * **The 44x44 minimum (Article IX / NFR-4).** Enforced "by construction rather than by
 * review", which in practice means one class on both render modes. happy-dom applies no
 * stylesheet and computes no layout, so the size itself is asserted where it is actually
 * declared: the class is on the element, the rule sets both minimums from the touch-target
 * token, and the token is >= 44.
 */

import { describe, expect, it, vi } from 'vitest';
import { lightTokens } from '@splitsutra/core';
import { render, renderAt } from '../../__tests__/helpers/render';
import { Pressable } from '../Pressable';
import { readFileSync } from 'node:fs';
import styles from '../controls.module.css';

// Read the stylesheet off disk instead of importing it with `?raw`. Vitest routes every
// `.css` specifier through its CSS-modules handling and returns the class-name proxy no
// matter what query you append, so `?raw` yielded an object that throws on Symbol access
// rather than the source text these assertions parse.
// Vitest serves modules over http, so `import.meta.url` is an http URL and `fileURLToPath`
// rejects it. The pathname is still the real path, except that on Windows it arrives with a
// leading slash in front of the drive letter, which `readFileSync` will not accept.
function moduleRelativePath(specifier: string): string {
  const raw = decodeURIComponent(new URL(specifier, import.meta.url).pathname);
  const looksWindows = raw.charAt(0) === '/' && raw.charAt(2) === ':';
  return looksWindows ? raw.slice(1) : raw;
}

const controlsCss = readFileSync(moduleRelativePath('../controls.module.css'), 'utf8');

function only(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild;
  expect(el, 'Pressable rendered nothing').not.toBeNull();
  return el as HTMLElement;
}

/** The body of the first `.pressable { … }` rule — not `.pressableBlock`, not `:active`. */
function pressableRule(): string {
  const match = /\.pressable\s*\{([^}]*)\}/.exec(controlsCss);
  expect(match, 'controls.module.css has no .pressable rule').not.toBeNull();
  return match![1] ?? '';
}

describe('<Pressable> render modes', () => {
  it('renders a real link when given a destination', () => {
    // A button with an onClick cannot be cmd-clicked, previewed, or opened in a new tab.
    const el = only(renderAt(<Pressable to="/groups">Groups</Pressable>, '/').container);

    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/groups');
  });

  it('renders a button when given a handler', () => {
    const el = only(render(<Pressable onPress={() => {}}>Save</Pressable>).container);

    expect(el.tagName).toBe('BUTTON');
    // Defaulting to `submit` would make any pressable inside a form submit it.
    expect(el.getAttribute('type')).toBe('button');
  });

  it('renders a submit button only when asked to', () => {
    const el = only(render(<Pressable type="submit">Save</Pressable>).container);

    expect(el.getAttribute('type')).toBe('submit');
  });

  it('renders a disabled destination as a disabled button, never as a link', () => {
    // `aria-disabled` on an anchor is advisory: the browser still follows the href.
    const el = only(
      renderAt(
        <Pressable to="/groups" disabled>
          Groups
        </Pressable>,
        '/',
      ).container,
    );

    expect(el.tagName).toBe('BUTTON');
    expect(el.hasAttribute('href')).toBe(false);
    expect((el as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls its handler when pressed, and not when disabled', () => {
    const onPress = vi.fn();
    const enabled = only(render(<Pressable onPress={onPress}>Go</Pressable>).container);
    enabled.click();
    expect(onPress).toHaveBeenCalledTimes(1);

    const disabled = only(
      render(
        <Pressable onPress={onPress} disabled>
          Go
        </Pressable>,
      ).container,
    );
    disabled.click();
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('<Pressable> accessible name', () => {
  it('names an icon-only target with its label', () => {
    const el = only(render(<Pressable label="Close">×</Pressable>).container);

    expect(el.getAttribute('aria-label')).toBe('Close');
  });

  it('names a link target the same way', () => {
    const el = only(
      renderAt(
        <Pressable to="/expense/new" label="Add an expense">
          +
        </Pressable>,
        '/',
      ).container,
    );

    expect(el.getAttribute('aria-label')).toBe('Add an expense');
  });

  it('leaves the accessible name to the child text when no label is given', () => {
    // An empty aria-label would wipe out the visible word instead of leaving it alone.
    const el = only(render(<Pressable>Settle up</Pressable>).container);

    expect(el.hasAttribute('aria-label')).toBe(false);
    expect(el.textContent).toBe('Settle up');
  });

  it('forwards the state a caller declares', () => {
    const el = only(
      render(
        <Pressable aria-expanded={false} aria-pressed>
          Filters
        </Pressable>,
      ).container,
    );

    expect(el.getAttribute('aria-expanded')).toBe('false');
    expect(el.getAttribute('aria-pressed')).toBe('true');
  });

  it('marks a link as the current page when told to', () => {
    const el = only(
      renderAt(
        <Pressable to="/groups" aria-current="page">
          Groups
        </Pressable>,
        '/groups',
      ).container,
    );

    expect(el.getAttribute('aria-current')).toBe('page');
  });
});

describe('<Pressable> touch target', () => {
  it('carries the sized class in both render modes', () => {
    const button = only(render(<Pressable>Tap</Pressable>).container);
    const link = only(renderAt(<Pressable to="/groups">Tap</Pressable>, '/').container);

    expect(button.classList.contains(styles.pressable!)).toBe(true);
    expect(link.classList.contains(styles.pressable!)).toBe(true);
  });

  it('sizes that class from the touch-target token, which is at least 44px', () => {
    const rule = pressableRule();

    expect(rule).toContain('min-block-size: var(--splitsutra-size-touch-target)');
    expect(rule).toContain('min-inline-size: var(--splitsutra-size-touch-target)');
    expect(lightTokens.size.touchTarget).toBeGreaterThanOrEqual(44);
  });

  it('relaxes only the width for a full-row target, never the height', () => {
    // A list row is already wider than 44px; forcing 44px of width on it would break the
    // layout. The 44px HEIGHT still has to hold, so `.pressableBlock` must not touch it.
    const el = only(render(<Pressable block>Whole row</Pressable>).container);
    expect(el.classList.contains(styles.pressableBlock!)).toBe(true);

    const blockRule = /\.pressableBlock\s*\{([^}]*)\}/.exec(controlsCss)?.[1] ?? '';
    expect(blockRule).toContain('min-inline-size: 0');
    expect(blockRule).not.toContain('min-block-size');
  });
});
