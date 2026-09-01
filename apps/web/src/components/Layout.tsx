/**
 * Layout primitives — the ONLY way anything is positioned in this app.
 *
 * Names are platform-neutral on purpose (docs/02 §contract rule 8): `<Screen>`,
 * `<Stack>`, `<Row>` map 1:1 onto `SafeAreaView` and `View`, so Phase 12 swaps the
 * implementations without touching a single screen's JSX structure.
 *
 * There is no `<div>` in a screen file anywhere in this codebase. That is the rule that
 * makes the port mechanical.
 */

import type { CSSProperties, ElementType, ReactNode } from 'react';
import styles from './layout.module.css';
import { cx, spaceVar, vars, type SpaceToken } from './tokenProps';

type Align = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
type Justify = 'start' | 'center' | 'end' | 'between' | 'around';

const ALIGN: Readonly<Record<Align, string>> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};

const JUSTIFY: Readonly<Record<Justify, string>> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
};

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

export interface ScreenProps {
  children: ReactNode;
  /**
   * Sticky content above the scroll region — the contextual header from docs/07.
   * Stays put while the body scrolls.
   */
  header?: ReactNode | undefined;
  /**
   * Sticky content below the scroll region — the Save bar on a form screen.
   * Primary actions live in the bottom third of the screen (docs/15 rule 8).
   */
  footer?: ReactNode | undefined;
  /** Horizontal gutter on the body. Off for full-bleed list screens. */
  padded?: boolean | undefined;
  /** Accessible label for the screen region. */
  label?: string | undefined;
}

/**
 * A screen: sticky header, scrollable body, sticky footer.
 *
 * Height comes from the flex chain that starts at `#root`, never from `100vh`
 * (contract rule 3) — mobile browser chrome makes `vh` overshoot and hides the tab bar
 * behind the address bar.
 *
 * ## Why `<main>` and not `<section>`
 *
 * It was a `<section>`, and axe's `landmark-one-main` failed on every route: a document with
 * no `<main>` gives a screen-reader user no way to skip the chrome and jump to the content
 * (NFR-5). A screen IS the route's primary content, so `<main>` is the honest element.
 *
 * 🔴 That makes "exactly one `<Screen>` renders at a time" a real invariant rather than a
 * coincidence — two `<main>` elements is its own axe failure (`landmark-no-duplicate-main`).
 * It holds today because every screen's multiple `<Screen>` returns are mutually exclusive
 * early returns (loading / error / empty / loaded), `ExpenseForm` renders the caller's only
 * one, and the `<Suspense>` fallback in `routes.tsx` unmounts before its child mounts.
 * Rendering one `<Screen>` inside another would compile, look fine, and break this.
 */
export function Screen({ children, header, footer, padded = true, label }: ScreenProps) {
  return (
    <main className={styles.screen} aria-label={label}>
      {header}
      <div className={cx(styles.screenBody, padded === true && styles.screenPadded)}>
        {children}
      </div>
      {footer}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Stack / Row                                                                */
/* -------------------------------------------------------------------------- */

export interface StackProps {
  children?: ReactNode | undefined;
  /** Gap between children. Token key only — `gap="16px"` will not compile. */
  gap?: SpaceToken | undefined;
  padding?: SpaceToken | undefined;
  align?: Align | undefined;
  justify?: Justify | undefined;
  wrap?: boolean | undefined;
  /** `flex` shorthand for this element within its parent line. */
  flex?: string | undefined;
  className?: string | undefined;
  /** Escape hatch for genuinely computed values. Prefer a prop. */
  style?: CSSProperties | undefined;
  /** Renders as a `<ul>` when the children are semantically a list. */
  as?: 'div' | 'ul' | 'li' | 'nav' | 'header' | 'footer' | undefined;
  role?: string | undefined;
  'aria-label'?: string | undefined;
  'aria-live'?: 'off' | 'polite' | 'assertive' | undefined;
}

/**
 * 🔴 EVERY var is written on EVERY Stack and Row, defaults included. Do not go back to
 *    omitting the ones the caller left unset.
 *
 * Custom properties INHERIT. When a var was omitted, the primitive's own fallback —
 * `align-items: var(--stack-align, stretch)` — was not what resolved: the value set by the
 * nearest ancestor Stack was, and the fallback only applied if no ancestor had ever set one.
 * So a plain `<Stack>` inside a `<Row align="center">` silently centred itself, having asked
 * for nothing. The group header's member strip did exactly that, and every one of its rows
 * rendered centred with no screen requesting it.
 *
 * Writing the default stops the lookup here. `alignDefault` differs per component because
 * their fallbacks do (a Row centres, a Stack stretches); the rest are the primitives' own
 * fallbacks restated, so nothing that already set a value moves.
 */
function stackStyle(props: StackProps, alignDefault: string): CSSProperties {
  return vars({
    '--stack-gap': props.gap === undefined ? '0' : spaceVar(props.gap),
    '--stack-padding': props.padding === undefined ? '0' : spaceVar(props.padding),
    '--stack-align': props.align === undefined ? alignDefault : ALIGN[props.align],
    '--stack-justify': props.justify === undefined ? 'flex-start' : JUSTIFY[props.justify],
    '--stack-flex': props.flex ?? '0 0 auto',
  });
}

/** Vertical flex container. */
export function Stack(props: StackProps) {
  const Tag: ElementType = props.as ?? 'div';
  return (
    <Tag
      className={cx(styles.stack, props.wrap === true && styles.wrap, props.className)}
      style={{ ...stackStyle(props, 'stretch'), ...props.style }}
      role={props.role}
      aria-label={props['aria-label']}
      aria-live={props['aria-live']}
    >
      {props.children}
    </Tag>
  );
}

/** Horizontal flex container. Children are vertically centred unless told otherwise. */
export function Row(props: StackProps) {
  const Tag: ElementType = props.as ?? 'div';
  return (
    <Tag
      className={cx(styles.stack, styles.row, props.wrap === true && styles.wrap, props.className)}
      style={{ ...stackStyle(props, 'center'), ...props.style }}
      role={props.role}
      aria-label={props['aria-label']}
      aria-live={props['aria-live']}
    >
      {props.children}
    </Tag>
  );
}

/* -------------------------------------------------------------------------- */
/* Card / Divider / Spacer                                                    */
/* -------------------------------------------------------------------------- */

export interface CardProps {
  children: ReactNode;
  /** Removes the inner padding — for cards that contain a full-bleed `<List>`. */
  flush?: boolean | undefined;
  /**
   * Narrows the inner padding for a card holding a single row.
   *
   * Not a general "make it smaller": the default padding is what gives a card of stacked
   * content its weight, and a screen full of tight cards is a screen with no hierarchy.
   */
  tight?: boolean | undefined;
  className?: string | undefined;
  'aria-label'?: string | undefined;
}

export function Card({ children, flush, tight, className, ...rest }: CardProps) {
  return (
    <div
      className={cx(
        styles.card,
        flush === true && styles.cardFlush,
        tight === true && styles.cardTight,
        className,
      )}
      aria-label={rest['aria-label']}
    >
      {children}
    </div>
  );
}

export function Divider({ inset = false }: { inset?: boolean | undefined }) {
  return <hr className={cx(styles.divider, inset && styles.dividerInset)} />;
}

/** Grows to fill the remaining space in a flex line. Maps to `<View style={{flex:1}}/>`. */
export function Spacer() {
  return <div className={styles.spacer} aria-hidden="true" />;
}
