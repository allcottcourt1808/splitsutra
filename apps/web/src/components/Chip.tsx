/**
 * <Chip> — category and filter pills.
 *
 * Used for the category row on Add Expense (docs/07 §AddExpense: "📅 Today   🏷 Food") and
 * for the currency filter shortcuts.
 *
 * Selection is announced with `aria-pressed`, never by colour alone: the selected chip is
 * a filled teal, and a user who cannot see that still hears "pressed" (NFR-5).
 *
 * Styles come from the chip block already in `controls.module.css`.
 */

import type { ReactNode } from 'react';
import { Pressable } from './Pressable';
import { Text } from './Text';
import styles from './controls.module.css';
import { cx } from './tokenProps';

export interface ChipProps {
  label: string;
  /** Optional leading glyph. Decorative — the label carries the meaning. */
  glyph?: string | undefined;
  /**
   * Omit entirely for a chip that DOES something rather than answering something — "Pick a
   * date" opens the calendar; it is not a third answer to which day is chosen.
   *
   * The distinction is audible, not cosmetic. Any value here, `false` included, makes this a
   * toggle: a screen reader says "not pressed", implying a state the chip does not have and
   * an off position the user cannot return to. Undefined leaves it an ordinary button.
   */
  selected?: boolean | undefined;
  onPress?: (() => void) | undefined;
  to?: string | undefined;
  /** Trailing slot — a clear "✕" on a filter chip. */
  trailing?: ReactNode | undefined;
}

export function Chip({ label, glyph, selected, onPress, to, trailing }: ChipProps) {
  return (
    <Pressable
      to={to}
      onPress={onPress}
      aria-pressed={to === undefined ? selected : undefined}
      className={cx(styles.chip, selected && styles.chipSelected)}
    >
      {glyph !== undefined && <Text aria-hidden>{glyph}</Text>}
      <Text as="span" truncate>
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}
