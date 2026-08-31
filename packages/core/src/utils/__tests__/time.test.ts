/**
 * The month helpers behind the group ledger's section headings.
 *
 * `formatRelativeTime` in the same module is exercised through the screens that render it and is
 * not retrofitted here; these two are new and carry the two decisions worth pinning down —
 * that the month is a *local* calendar month, and that the year is dropped for the current one.
 */

import { describe, expect, it } from 'vitest';

import { formatMonthLabel, monthKey } from '../time.js';

/** Local-time construction throughout: both functions read the host's calendar, deliberately. */
function local(year: number, monthIndex: number, day: number, hour = 12): Date {
  return new Date(year, monthIndex, day, hour);
}

describe('monthKey', () => {
  it('is the zero-padded year and month', () => {
    expect(monthKey(local(2026, 7, 15))).toBe('2026-08');
    expect(monthKey(local(2026, 0, 1))).toBe('2026-01');
    expect(monthKey(local(2026, 11, 31))).toBe('2026-12');
  });

  it('sorts lexically in chronological order — which is the whole reason it is padded', () => {
    const keys = [
      monthKey(local(2026, 0, 5)),
      monthKey(local(2025, 11, 5)),
      monthKey(local(2026, 9, 5)),
      monthKey(local(2026, 1, 5)),
    ];

    expect([...keys].sort()).toEqual(['2025-12', '2026-01', '2026-02', '2026-10']);
  });

  it('accepts epoch milliseconds as well as a Date', () => {
    const date = local(2026, 4, 9);

    expect(monthKey(date.getTime())).toBe(monthKey(date));
  });

  it('reads the LOCAL calendar month, so a late-night entry stays in the month it was typed in', () => {
    // 23:30 on the last day of the month. In any timezone ahead of UTC this is already the 1st
    // in UTC, and grouping by the UTC month would file it under the wrong heading.
    expect(monthKey(new Date(2026, 5, 30, 23, 30))).toBe('2026-06');
  });

  it('separates the same month in different years', () => {
    expect(monthKey(local(2025, 2, 10))).not.toBe(monthKey(local(2026, 2, 10)));
  });
});

describe('formatMonthLabel', () => {
  const now = local(2026, 7, 30);

  it('names the month in full', () => {
    expect(formatMonthLabel(local(2026, 0, 4), now)).toBe('January');
    expect(formatMonthLabel(local(2026, 8, 4), now)).toBe('September');
    expect(formatMonthLabel(local(2026, 11, 4), now)).toBe('December');
  });

  it('drops the year for the current one and prints it for any other', () => {
    expect(formatMonthLabel(local(2026, 2, 10), now)).toBe('March');
    expect(formatMonthLabel(local(2025, 2, 10), now)).toBe('March 2025');
    expect(formatMonthLabel(local(2027, 2, 10), now)).toBe('March 2027');
  });

  it('compares calendar years, not elapsed time', () => {
    // Six weeks apart, but either side of New Year — so the year has to appear.
    expect(formatMonthLabel(local(2025, 11, 20), local(2026, 0, 25))).toBe('December 2025');
  });

  it('accepts epoch milliseconds for both arguments', () => {
    expect(formatMonthLabel(local(2025, 6, 1).getTime(), now.getTime())).toBe('July 2025');
  });
});
