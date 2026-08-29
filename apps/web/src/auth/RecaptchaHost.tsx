/**
 * The two raw DOM elements the sign-in screen needs, kept out of the screen file.
 *
 * `components/Layout.tsx` states the rule this file exists to respect: **there is no `<div>` in
 * a screen file anywhere in this codebase**, because that is what makes the React Native port
 * mechanical. Neither element below can be expressed as a layout primitive —
 * `RecaptchaVerifier` attaches to a specific `HTMLElement`, and a one-pixel hairline is not a
 * `<Stack>` — so they live here, in the one directory that is already web-only by charter
 * (docs/02 §Authentication architecture). Phase 12 deletes this file rather than porting it:
 * the native flow uses SafetyNet / DeviceCheck and needs no reCAPTCHA at all.
 */

import { useEffect, useRef, type RefObject } from 'react';
import type { RecaptchaVerifier } from 'firebase/auth';

import { Row } from '../components/Layout';
import { Text } from '../components/Text';
import styles from './auth.module.css';
import { createPhoneVerifier } from './firebaseAuth';

/* -------------------------------------------------------------------------- */
/* reCAPTCHA                                                                  */
/* -------------------------------------------------------------------------- */

export interface RecaptchaHostProps {
  /**
   * A ref the caller owns and reads when it is ready to send an SMS. This component writes the
   * live verifier into it and writes `null` back on teardown.
   *
   * A ref rather than an `onReady` callback because the value is read at the moment of a
   * button press, never rendered — putting it in state would re-render the form to store
   * something nothing displays.
   */
  verifierRef: RefObject<RecaptchaVerifier | null>;
  /** Called if the widget cannot be constructed at all — a bad key, a blocked domain. */
  onError: (cause: unknown) => void;
}

/**
 * Mount the invisible reCAPTCHA that phone sign-in requires.
 *
 * 🔴 The verifier is `clear()`ed on teardown, and that is not tidiness. A second verifier on
 * the same element throws, and React 19 StrictMode double-invokes every effect in development
 * — so without the cleanup, phone sign-in fails in dev and works in production, which is the
 * worst possible way round for a flow that costs money to test.
 *
 * The host stays **in the flow with zero size**, never `display: none`: the widget refuses to
 * execute if its container is not rendered, and an invisible challenge only paints anything
 * when it actually decides to challenge.
 */
export function RecaptchaHost({ verifierRef, onError }: RecaptchaHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    try {
      verifierRef.current = createPhoneVerifier(host);
    } catch (cause: unknown) {
      onError(cause);
      return;
    }

    return () => {
      verifierRef.current?.clear();
      verifierRef.current = null;
    };
  }, [verifierRef, onError]);

  return <div ref={hostRef} className={styles.recaptcha} />;
}

/* -------------------------------------------------------------------------- */
/* "or"                                                                       */
/* -------------------------------------------------------------------------- */

/** The rule between the primary sign-in method and the alternatives. Decorative throughout. */
export function OrDivider() {
  return (
    <Row className={styles.divider} align="center">
      <span className={styles.dividerLine} aria-hidden="true" />
      <Text variant="caption" tone="secondary">
        or
      </Text>
      <span className={styles.dividerLine} aria-hidden="true" />
    </Row>
  );
}
