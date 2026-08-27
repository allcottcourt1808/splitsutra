/**
 * <EmptyState> — glyph + title + body + action.
 *
 * docs/15 §Eight rules: "Empty states always offer the next action. No dead ends."
 * docs/07 §GroupList: the empty group list "is a first-run moment, not an error".
 *
 * `action` is not optional by accident — it is required, because an empty state without a
 * next action is the exact failure this component exists to prevent. Where the next action
 * genuinely belongs elsewhere on the screen, pass the sentence that points at it.
 */

import type { ReactNode } from 'react';
import styles from './list.module.css';
import { Stack } from './Layout';
import { Text } from './Text';

export interface EmptyStateProps {
  /**
   * A single decorative character. Not an illustration: docs/07 asks for one, but a real
   * asset is a Phase 09 job and a placeholder image would be worse than a glyph.
   * TODO(phase-09): swap for the first-run illustration (checklists/phase-09 §1).
   */
  glyph?: string | undefined;
  title: string;
  /** One or two sentences, in the user's words (docs/15 rule 4). */
  body: string;
  /** The next action. One or two `<Button>`s — never zero. */
  action: ReactNode;
}

export function EmptyState({ glyph, title, body, action }: EmptyStateProps) {
  return (
    <Stack className={styles.empty}>
      {glyph !== undefined && (
        <Text aria-hidden className={styles.emptyGlyph}>
          {glyph}
        </Text>
      )}
      <Text variant="title" align="center">
        {title}
      </Text>
      <Text tone="secondary" align="center">
        {body}
      </Text>
      <Stack className={styles.emptyActions}>{action}</Stack>
    </Stack>
  );
}
