/**
 * One decorative glyph per expense category (AC-D1.6).
 *
 * 🔴 Decorative is the operative word. The label always carries the meaning — every consumer
 *    renders the glyph `aria-hidden` beside the category name or the description, never alone.
 *    Emoji render differently on every platform and are read aloud as wildly varying phrases, so
 *    a glyph that had to be understood would be an accessibility failure and a portability one.
 *
 * Lives in its own module because the composer and the group ledger both need it, and a second
 * copy is a table that drifts: add a category, update one list, and the other silently renders
 * the wrong picture next to the right word.
 */

import type { ExpenseCategory } from '@splitsutra/core';

export const CATEGORY_GLYPH: Readonly<Record<ExpenseCategory, string>> = {
  general: '🧾',
  food: '🍽',
  groceries: '🛒',
  transport: '🚕',
  fuel: '⛽',
  travel: '✈️',
  accommodation: '🏨',
  rent: '🔑',
  utilities: '💡',
  household: '🧹',
  entertainment: '🎬',
  medical: '🩺',
  insurance: '🛡',
  education: '🎓',
};

/** A recorded payment is not an expense category, so it gets its own mark. */
export const SETTLEMENT_GLYPH = '💸';
