/**
 * <ListRow> — leading / title / subtitle / trailing / chevron.
 *
 * The single row shape used by every list in the app: groups, friends, members, expenses,
 * settlements, activity, account settings. One component means one place to fix the
 * alignment of an amount column, and one place that guarantees the whole row is a 44px
 * touch target rather than just the chevron (NFR-4).
 *
 * `title` and `subtitle` are plain strings on purpose — they are wrapped in `<Text>` here
 * so no screen can forget `truncate` and let a long group name push the balance off the
 * edge of a 390px phone (NFR-3, no horizontal scroll).
 *
 * Maps to a `<Pressable>` wrapping a `<View>` in Phase 12.
 */

import type { ReactNode } from 'react';
import styles from './list.module.css';
import { Row, Stack } from './Layout';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { cx } from './tokenProps';

/** Trailing affordance. `1em` and `currentColor`, so it follows the row's own type scale. */
function Chevron() {
  return (
    <svg
      className={styles.rowChevron}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </svg>
  );
}

export interface ListRowProps {
  title: string;
  subtitle?: string | undefined;
  /** Avatar, category glyph, or checkbox. */
  leading?: ReactNode | undefined;
  /** Usually a `<Money>`. Right-aligned, tabular (docs/07 §Interaction rules 7). */
  trailing?: ReactNode | undefined;
  /** Navigate on tap. Renders a real link so cmd-click and deep links work. */
  to?: string | undefined;
  onPress?: (() => void) | undefined;
  /** Show the chevron. Defaults to `true` whenever the row is tappable. */
  chevron?: boolean | undefined;
  /**
   * Muted treatment. Reserved for rows that are muted BY MEANING — settlement rows in the
   * expense list (docs/07 §GroupDetail) — never for disabled state.
   */
  muted?: boolean | undefined;
  /** Overrides the accessible name when title + subtitle do not read well aloud. */
  label?: string | undefined;
}

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  to,
  onPress,
  chevron,
  muted = false,
  label,
}: ListRowProps) {
  const interactive = to !== undefined || onPress !== undefined;
  const showChevron = chevron ?? interactive;

  const body = (
    <Row className={cx(styles.row, muted && styles.rowMuted)}>
      {leading !== undefined && <div className={styles.rowLeading}>{leading}</div>}

      <Stack className={styles.rowBody}>
        <Text truncate>{title}</Text>
        {subtitle !== undefined && (
          <Text variant="caption" tone="secondary" truncate>
            {subtitle}
          </Text>
        )}
      </Stack>

      {trailing !== undefined && <Stack className={styles.rowTrailing}>{trailing}</Stack>}
      {showChevron && <Chevron />}
    </Row>
  );

  if (!interactive) return body;

  return (
    <Pressable to={to} onPress={onPress} block label={label}>
      {body}
    </Pressable>
  );
}
