/**
 * `detectExpenseCategory` — the description-to-category guess.
 *
 * The cases that matter here are the ones where a naive implementation gets it wrong: substring
 * collisions, keywords that are prefixes of longer keywords, and the deliberate refusals. The
 * happy path is a lookup table and is spot-checked rather than enumerated.
 */

import { describe, expect, it } from 'vitest';

import { EXPENSE_CATEGORIES } from '../../types/expense.js';
import { detectExpenseCategory } from '../category.js';

describe('detectExpenseCategory', () => {
  it('finds a category anywhere in the description, not only at the start', () => {
    expect(detectExpenseCategory('Dinner at Olive')).toBe('food');
    expect(detectExpenseCategory('Saturday movie')).toBe('entertainment');
    expect(detectExpenseCategory('paid the electricity for March')).toBe('utilities');
  });

  it('ignores case and punctuation', () => {
    expect(detectExpenseCategory('DINNER!!')).toBe('food');
    expect(detectExpenseCategory('  Uber,  airport  ')).toBe('travel');
    expect(detectExpenseCategory("Doctor's visit")).toBe('medical');
  });

  it('returns null when nothing matches, so the caller keeps its own default', () => {
    expect(detectExpenseCategory('misc')).toBeNull();
    expect(detectExpenseCategory('')).toBeNull();
    expect(detectExpenseCategory('    ')).toBeNull();
    expect(detectExpenseCategory('!!!')).toBeNull();
    expect(detectExpenseCategory('123')).toBeNull();
  });

  /* ──────────────────────────────────────────────────────────────────────────────────────── *
   * Word boundaries — the substring bugs this would otherwise have
   * ──────────────────────────────────────────────────────────────────────────────────────── */

  it('matches whole words only', () => {
    // 'gas' is not a keyword at all, but 'ola' and 'pub' are — and both hide inside real words.
    expect(detectExpenseCategory('granola')).toBeNull();
    expect(detectExpenseCategory('republic day decorations')).toBeNull();
    expect(detectExpenseCategory('published the report')).toBeNull();
    // 'rent' inside 'different', 'parent', 'currently'.
    expect(detectExpenseCategory('a different thing')).toBeNull();
    expect(detectExpenseCategory('parent gift')).toBeNull();
  });

  it('still matches a keyword that is hyphenated or apostrophised', () => {
    expect(detectExpenseCategory('e-mail? no — pizza-night')).toBe('food');
    expect(detectExpenseCategory('gas-station top up')).toBe('fuel');
  });

  /* ──────────────────────────────────────────────────────────────────────────────────────── *
   * Longest match wins
   * ──────────────────────────────────────────────────────────────────────────────────────── */

  it('prefers the more specific keyword when two categories both match', () => {
    // 'uber' (transport, 4) vs 'uber eats' (food, 9).
    expect(detectExpenseCategory('Uber')).toBe('transport');
    expect(detectExpenseCategory('Uber Eats')).toBe('food');

    // 'trip' (travel, 4) vs 'travel insurance' (travel) vs 'insurance' (insurance, 9).
    expect(detectExpenseCategory('trip insurance')).toBe('insurance');
    expect(detectExpenseCategory('travel insurance for the trip')).toBe('travel');
  });

  it('is deterministic — the same input always gives the same answer', () => {
    const runs = Array.from({ length: 5 }, () => detectExpenseCategory('hotel and dinner'));

    expect(new Set(runs).size).toBe(1);
  });

  /* ──────────────────────────────────────────────────────────────────────────────────────── *
   * The deliberate refusals (see the header)
   * ──────────────────────────────────────────────────────────────────────────────────────── */

  it('refuses the terms that are genuinely ambiguous', () => {
    // 'gas' is LPG in India and gasoline in the US — only the qualified forms are keywords.
    expect(detectExpenseCategory('gas')).toBeNull();
    expect(detectExpenseCategory('gas station')).toBe('fuel');
    expect(detectExpenseCategory('gas cylinder')).toBe('utilities');

    expect(detectExpenseCategory('bar')).toBeNull();
    expect(detectExpenseCategory('market')).toBeNull();
    expect(detectExpenseCategory('auto')).toBeNull();
    expect(detectExpenseCategory('ticket')).toBeNull();
    expect(detectExpenseCategory('books')).toBeNull();
  });

  /* ──────────────────────────────────────────────────────────────────────────────────────── *
   * Article XIII — the sensitive three
   * ──────────────────────────────────────────────────────────────────────────────────────── */

  it('detects the sensitive categories only from literal terms', () => {
    expect(detectExpenseCategory('dentist')).toBe('medical');
    expect(detectExpenseCategory('health insurance')).toBe('insurance');
    expect(detectExpenseCategory('school fees')).toBe('education');

    // Suggestive but not stated — these must NOT be read as medical.
    expect(detectExpenseCategory('feeling rough, took the day off')).toBeNull();
    expect(detectExpenseCategory('emergency')).toBeNull();
    expect(detectExpenseCategory('appointment')).toBeNull();
  });

  /* ──────────────────────────────────────────────────────────────────────────────────────── *
   * Contract
   * ──────────────────────────────────────────────────────────────────────────────────────── */

  it('never returns general — that is the caller’s fallback, not a detection', () => {
    const descriptions = [
      'dinner',
      'groceries',
      'uber',
      'petrol',
      'flight',
      'hotel',
      'rent',
      'wifi',
      'laundry',
      'netflix',
      'pharmacy',
      'insurance',
      'tuition',
      'nothing here',
    ];

    for (const description of descriptions) {
      expect(detectExpenseCategory(description)).not.toBe('general');
    }
  });

  it('only ever returns a member of EXPENSE_CATEGORIES', () => {
    const descriptions = ['dinner', 'uber eats', 'gas station', 'dentist', 'zzzz'];

    for (const description of descriptions) {
      const result = detectExpenseCategory(description);
      if (result !== null) expect(EXPENSE_CATEGORIES).toContain(result);
    }
  });

  it('reaches every non-general category from at least one description', () => {
    const samples: Record<string, string> = {
      food: 'dinner',
      groceries: 'groceries',
      transport: 'taxi',
      fuel: 'petrol',
      travel: 'flight',
      accommodation: 'hotel',
      rent: 'rent',
      utilities: 'broadband',
      household: 'plumber',
      entertainment: 'cinema',
      medical: 'pharmacy',
      insurance: 'insurance',
      education: 'tuition',
    };

    for (const category of EXPENSE_CATEGORIES) {
      if (category === 'general') continue;
      expect(detectExpenseCategory(samples[category] ?? '')).toBe(category);
    }
  });
});
