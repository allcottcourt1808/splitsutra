/**
 * <Button> — primary / secondary / ghost / danger, with loading and disabled states.
 *
 * Built on <Pressable>, so it inherits the 44x44 minimum for free.
 *
 * On the loading state: the button shows progress but the app NEVER blocks on a
 * network write (docs/07 §Interaction rules 5 — Firestore queues offline writes and we
 * trust it). Loading here is for the rare genuinely-synchronous action, such as a
 * callable Function.
 */

import type { ReactNode } from 'react';
import styles from './controls.module.css';
import { cx } from './tokenProps';
import { Pressable } from './Pressable';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * `compact` narrows the button for a shared bar — a modal header's Save beside a ✕.
 *
 * It changes the padding and the type size and NOTHING else: the 44x44 minimum from
 * <Pressable> applies to both sizes (Article IX / NFR-4).
 */
export type ButtonSize = 'default' | 'compact';

const VARIANT: Readonly<Record<ButtonVariant, string | undefined>> = {
  primary: styles.buttonPrimary,
  secondary: styles.buttonSecondary,
  ghost: styles.buttonGhost,
  danger: styles.buttonDanger,
};

export interface ButtonProps {
  children: ReactNode;
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  onPress?: (() => void) | undefined;
  to?: string | undefined;
  disabled?: boolean | undefined;
  loading?: boolean | undefined;
  fullWidth?: boolean | undefined;
  type?: 'button' | 'submit' | undefined;
  /** Overrides the accessible name when the visible label is not enough on its own. */
  label?: string | undefined;
}

export function Button({
  children,
  variant = 'primary',
  size = 'default',
  onPress,
  to,
  disabled = false,
  loading = false,
  fullWidth = false,
  type = 'button',
  label,
}: ButtonProps) {
  return (
    <Pressable
      to={to}
      onPress={onPress}
      disabled={disabled || loading}
      type={type}
      label={label}
      className={cx(
        styles.button,
        VARIANT[variant],
        size === 'compact' && styles.buttonCompact,
        fullWidth && styles.buttonFullWidth,
        loading && styles.buttonLoading,
      )}
    >
      {/* A live region rather than a spinner swap, so screen readers are told the state
          changed instead of just losing the label. */}
      <span aria-live="polite">{loading ? 'Working…' : children}</span>
    </Pressable>
  );
}
