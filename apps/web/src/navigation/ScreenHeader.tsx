/**
 * The two contextual headers from docs/07, plus the dismiss hook modals share.
 *
 * `<Screen header={…}>` takes either of these. Keeping them here rather than in
 * `components/` is deliberate: both know about navigation (back, dismiss), and the design
 * system must stay ignorant of the router so `components/` ports to React Native untouched.
 *
 * Phase 12 maps `<ScreenHeader>` onto the stack navigator's `headerLeft`/`headerTitle`/
 * `headerRight` options and `<ModalHeader>` onto the modal stack's equivalents.
 */

import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Row, Spacer } from '../components/Layout';
import { Pressable } from '../components/Pressable';
import { Text } from '../components/Text';
import styles from './navigation.module.css';
import { HOME_PATH } from './paths';

/* -------------------------------------------------------------------------- */
/* useDismiss                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Close a modal, or go back from a pushed screen.
 *
 * Prefers real history so the browser's own back button and this control do the same
 * thing. On a deep link there IS no history — React Router marks the first entry of a
 * session with `key === 'default'` — so it falls back to an explicit destination instead
 * of leaving the user on a modal with no way out (docs/15 rule 6: no dead ends).
 */
export function useDismiss(fallback: string = HOME_PATH): () => void {
  const navigate = useNavigate();
  const location = useLocation();

  return () => {
    if (location.key !== 'default') {
      void navigate(-1);
      return;
    }
    void navigate(fallback, { replace: true });
  };
}

/* -------------------------------------------------------------------------- */
/* ScreenHeader                                                               */
/* -------------------------------------------------------------------------- */

export interface ScreenHeaderProps {
  title: string;
  /** Shows a back control that pops history, falling back to this path on a deep link. */
  backTo?: string | undefined;
  /** Trailing control — a settings icon, an edit action. */
  trailing?: ReactNode | undefined;
}

/** Sticky contextual header for a tabbed screen. */
export function ScreenHeader({ title, backTo, trailing }: ScreenHeaderProps) {
  const dismiss = useDismiss(backTo ?? HOME_PATH);

  return (
    <Row as="header" className={styles.screenHeader}>
      {backTo !== undefined && (
        <Pressable onPress={dismiss} label="Go back">
          {/* Decorative: the accessible name is on the Pressable. */}
          <Text aria-hidden>‹</Text>
        </Pressable>
      )}
      <Text as="h1" variant="title" truncate>
        {title}
      </Text>
      <Spacer />
      {trailing}
    </Row>
  );
}

/* -------------------------------------------------------------------------- */
/* ModalHeader                                                                */
/* -------------------------------------------------------------------------- */

export interface ModalHeaderProps {
  title: string;
  /** The primary action, e.g. the Save button. Rendered on the trailing edge. */
  action?: ReactNode | undefined;
  /** Where dismissing lands when the modal was opened by a deep link with no history. */
  dismissTo?: string | undefined;
}

/**
 * The `✕  Add expense  Save` bar from the Add Expense wireframe (docs/07).
 *
 * The dismiss control is on the LEADING edge and the primary action on the trailing edge,
 * every time. docs/15 rule 8: nothing critical in the top corners and destructive actions
 * never adjacent to common ones — ✕ discards, Save commits, and they are as far apart as
 * the bar allows.
 */
export function ModalHeader({ title, action, dismissTo }: ModalHeaderProps) {
  const dismiss = useDismiss(dismissTo ?? HOME_PATH);

  return (
    <Row as="header" className={styles.modalHeader}>
      <Pressable onPress={dismiss} label={`Close ${title}`}>
        <Text aria-hidden>✕</Text>
      </Pressable>
      <Text as="h1" variant="title" truncate>
        {title}
      </Text>
      <Spacer />
      {action}
    </Row>
  );
}
