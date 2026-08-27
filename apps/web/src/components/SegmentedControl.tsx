/**
 * <SegmentedControl> — the split-method picker, the balances tabs, the sign-in method switch.
 *
 * docs/07 §Split sheet: "Segmented control: **Equally | Exactly | Percentages | Shares**".
 *
 * Accessibility: rendered as a labelled group of toggle buttons with `aria-pressed`, not as
 * a `radiogroup`. A radiogroup implies arrow-key roving focus, which neither `<Pressable>`
 * nor React Native's `<Pressable>` implements — promising the interaction in the ARIA and
 * not delivering it is worse than a plainer, honest control (NFR-6).
 *
 * Styles come from the segmented block already in `controls.module.css`.
 */

import { Row } from './Layout';
import { Pressable } from './Pressable';
import { Text } from './Text';
import styles from './controls.module.css';
import { cx } from './tokenProps';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SegmentedControlProps<T extends string> {
  /** Accessible name for the group — "Split method", "Sign-in method". */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onValueChange,
}: SegmentedControlProps<T>) {
  return (
    <Row role="group" aria-label={label} className={styles.segmented}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              onValueChange(option.value);
            }}
            aria-pressed={selected}
            className={cx(styles.segment, selected && styles.segmentActive)}
          >
            <Text as="span" truncate>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </Row>
  );
}
