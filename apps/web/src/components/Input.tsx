/**
 * <Input> — label, error, helper text.
 *
 * Errors are INLINE AND LIVE, never an alert on save (docs/15 rule 6, docs/07
 * §Interaction rules 3). The error is wired to the field with `aria-describedby` and
 * `aria-invalid` so a screen reader announces it at the field, not at the top of a form.
 */

import type { ReactNode, RefObject } from 'react';
import { useId } from 'react';
import styles from './controls.module.css';
import { cx } from './tokenProps';
import { Stack } from './Layout';
import { Text } from './Text';

export interface InputProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string | undefined;
  /** Inline validation message. Presence also switches the field to the error style. */
  error?: string | undefined;
  /** Persistent hint shown when there is no error. */
  helper?: string | undefined;
  /** `decimal` and `numeric` bring up the right keypad on a phone. */
  inputMode?: 'text' | 'decimal' | 'numeric' | 'email' | 'tel' | 'search' | undefined;
  /**
   * `date` renders the platform date control: a calendar on desktop, the OS date wheel on a
   * phone. Its value is `YYYY-MM-DD` in every locale while the DISPLAY follows the viewer's —
   * so the field shows `29/08/2026` to someone in India and stores the same string either way.
   * Phase 12 maps it onto the native picker rather than a `TextInput`.
   */
  type?: 'text' | 'email' | 'tel' | 'search' | 'password' | 'date' | undefined;
  /**
   * Upper bound for `type="date"`, as `YYYY-MM-DD`.
   *
   * The calendar greys out everything past it, which is the difference between a rule the user
   * discovers by being told off after choosing and one they cannot break in the first place.
   */
  max?: string | undefined;
  /**
   * Handle on the field itself, for a control that has to ACT on it — the "Pick a date" chip
   * calling `showPicker()`.
   *
   * Deliberately not a general escape hatch: reach for a prop first. RN's `TextInput` takes a
   * ref too, so the seam survives Phase 12 even though what you can call through it changes.
   */
  inputRef?: RefObject<HTMLInputElement | null> | undefined;
  /**
   * Autofill hint — `current-password`, `new-password`, `one-time-code`, `tel`.
   *
   * Load-bearing on the sign-in screens, not decoration: without it a password manager
   * cannot offer to fill or save, and `one-time-code` is what lets iOS and Android drop the
   * SMS code straight into the field instead of making the user memorise six digits and
   * switch apps. Maps to RN's `textContentType` / `autoComplete`.
   */
  autoComplete?: string | undefined;
  autoFocus?: boolean | undefined;
  disabled?: boolean | undefined;
  maxLength?: number | undefined;
  /** Rendered inside the field, before the input — a currency symbol, a search icon. */
  leading?: ReactNode | undefined;
  /** Rendered inside the field, after the input — a clear button, a unit. */
  trailing?: ReactNode | undefined;
}

export function Input({
  label,
  value,
  onValueChange,
  placeholder,
  error,
  helper,
  inputMode = 'text',
  type = 'text',
  max,
  inputRef,
  autoComplete,
  autoFocus = false,
  disabled = false,
  maxLength,
  leading,
  trailing,
}: InputProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? helper;
  const hasError = error !== undefined && error.length > 0;

  return (
    <Stack gap="xs" className={styles.field}>
      <Text as="label" htmlFor={id} variant="caption" tone="secondary" weight="medium">
        {label}
      </Text>

      <div className={cx(styles.inputShell, hasError && styles.inputShellError)}>
        {leading}
        <input
          id={id}
          ref={inputRef}
          className={styles.input}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          /* A date control has its own keypad and its own segmented editing; an `inputMode`
             on top of it is at best ignored and at worst overrides the picker's keyboard. */
          inputMode={type === 'date' ? undefined : inputMode}
          type={type}
          max={max}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          maxLength={maxLength}
          aria-invalid={hasError}
          aria-describedby={message === undefined ? undefined : messageId}
        />
        {trailing}
      </div>

      {message !== undefined && (
        <Text
          id={messageId}
          variant="caption"
          tone={hasError ? 'danger' : 'secondary'}
          /* `polite` so a live validation message is announced without stealing focus
             mid-typing. */
          as="span"
        >
          {message}
        </Text>
      )}
    </Stack>
  );
}
