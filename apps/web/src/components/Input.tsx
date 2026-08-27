/**
 * <Input> — label, error, helper text.
 *
 * Errors are INLINE AND LIVE, never an alert on save (docs/15 rule 6, docs/07
 * §Interaction rules 3). The error is wired to the field with `aria-describedby` and
 * `aria-invalid` so a screen reader announces it at the field, not at the top of a form.
 */

import type { ReactNode } from 'react';
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
  type?: 'text' | 'email' | 'tel' | 'search' | 'password' | undefined;
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
          className={styles.input}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          type={type}
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
