/**
 * The category field — collapsed to its current value, expanding to the full set.
 *
 * ## Why this one collapses even though the list is fixed
 *
 * `EXPENSE_CATEGORIES` is fourteen compile-time constants, so unlike the group and member
 * pickers this has no scaling problem at all and never will. It collapses for the other reason:
 * fourteen chips wrap to four or five lines, and on a 390px screen that is a third of the form
 * spent on the field least likely to need touching.
 *
 * Least likely because `AddExpenseScreen` passes `autoCategory`, so typing "dinner" already
 * moves this to Food. The collapsed row keeps that visible — the guess is still stated, which is
 * the thing that matters, since a guess the user cannot see is a guess they cannot correct.
 *
 * 🔴 No search here, and none wanted. Search earns its place over a list you must scroll; over
 *    fourteen glyphed chips it is slower than looking. The expanded state is deliberately the
 *    same chip grid as before rather than a list of rows — picking a category is recognition,
 *    not recall, and the glyphs are what make it fast.
 */

import { useState } from 'react';

import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@splitsutra/core';

import { Card, Row, Stack } from '../../components/Layout';
import { Chip } from '../../components/Chip';
import { ListRow } from '../../components/ListRow';
import { Text } from '../../components/Text';
import { CATEGORY_GLYPH } from './categoryGlyph';

/** Title case for a category key, so the list needs no second table of labels. */
export function categoryLabel(category: ExpenseCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export interface CategoryPickerProps {
  readonly value: ExpenseCategory;
  readonly onChange: (category: ExpenseCategory) => void;
}

export function CategoryPicker({ value, onChange }: CategoryPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Stack gap="sm">
      <Text variant="caption" tone="secondary" weight="semibold">
        Category
      </Text>

      {!open ? (
        <Card flush>
          <ListRow
            title={categoryLabel(value)}
            leading={<Text aria-hidden>{CATEGORY_GLYPH[value]}</Text>}
            label={`Category, ${categoryLabel(value)}. Change it`}
            onPress={() => {
              setOpen(true);
            }}
          />
        </Card>
      ) : (
        <Row gap="sm" wrap>
          {EXPENSE_CATEGORIES.map((category) => (
            <Chip
              key={category}
              label={categoryLabel(category)}
              glyph={CATEGORY_GLYPH[category]}
              selected={category === value}
              onPress={() => {
                onChange(category);
                // Collapse on choose. Leaving the grid open after a pick would undo the whole
                // point of collapsing it, and the summary row states the result anyway.
                setOpen(false);
              }}
            />
          ))}
        </Row>
      )}
    </Stack>
  );
}
