/**
 * <Pressable> — the single tappable primitive.
 *
 * Every tappable thing in the app goes through this, which is how the 44x44 minimum
 * (Article IX / NFR-4) is enforced by construction rather than by review.
 *
 * Two render modes, one API:
 *   - `to` set   -> a real `<Link>`, so deep links, back/forward and cmd-click work
 *   - otherwise  -> a `<button>`
 *
 * React Native's `<Pressable>` gets `onPress` either way; `to` becomes
 * `navigation.navigate(...)`. Screens do not branch on which mode is in play.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router';
import styles from './controls.module.css';
import { cx } from './tokenProps';

export interface PressableProps {
  children: ReactNode;
  /** Navigate instead of firing a handler. Renders a real anchor. */
  to?: string | undefined;
  onPress?: (() => void) | undefined;
  disabled?: boolean | undefined;
  /**
   * Accessible name. REQUIRED when the child is an icon or an emoji with no text
   * (docs/07 §Accessibility — every interactive element has an accessible name).
   */
  label?: string | undefined;
  /**
   * Fill the line and left-align, for whole-row targets like a list row.
   * The 44px height minimum still applies.
   */
  block?: boolean | undefined;
  className?: string | undefined;
  /** `submit` inside a form; ignored in link mode. */
  type?: 'button' | 'submit' | undefined;
  'aria-current'?: 'page' | undefined;
  'aria-expanded'?: boolean | undefined;
  'aria-pressed'?: boolean | undefined;
}

export function Pressable({
  children,
  to,
  onPress,
  disabled = false,
  label,
  block = false,
  className,
  type = 'button',
  ...aria
}: PressableProps) {
  const classes = cx(styles.pressable, block && styles.pressableBlock, className);

  if (to !== undefined && !disabled) {
    return (
      <Link
        to={to}
        className={classes}
        aria-label={label}
        aria-current={aria['aria-current']}
        onClick={onPress}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      onClick={onPress}
      disabled={disabled}
      aria-label={label}
      aria-current={aria['aria-current']}
      aria-expanded={aria['aria-expanded']}
      aria-pressed={aria['aria-pressed']}
    >
      {children}
    </button>
  );
}
