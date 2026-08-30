/**
 * The text-field ↔ minor-units boundary Article I talks about.
 *
 * These are pure-function tests with no DOM in them, but they are named `.tsx` because the
 * root `vitest.config.ts` gives the `component` project `src/**\/__tests__/**\/*.test.tsx` and
 * gives `*.test.ts` to the `unit` project, which is rooted at `packages/core`. A `.ts` file
 * here would be collected by neither.
 *
 * What is worth protecting: no float ever appears, an ambiguous separator resolves the one
 * documented way, and an amount with too many decimal places for its currency is a rejection
 * rather than a silent round.
 */

import { describe, expect, it } from 'vitest';

import {
  AmountInputError,
  amountInputError,
  formatAmountInput,
  formatPercentInput,
  parseAmountInput,
  parsePercentInput,
  tryParseAmountInput,
} from '../amount';

describe('parseAmountInput', () => {
  it('reads a plain decimal as exact minor units', () => {
    expect(parseAmountInput('3000.00', 'INR')).toBe(300_000);
    expect(parseAmountInput('12.5', 'USD')).toBe(1250);
    expect(parseAmountInput('7', 'USD')).toBe(700);
  });

  it('never goes through a float — 0.1 + 0.2 is 0.3 exactly', () => {
    // 🔴 Article I. `0.1 * 100 + 0.2 * 100 === 30.000000000000004`; this path is digit strings.
    const tenth = parseAmountInput('0.1', 'USD');
    const fifth = parseAmountInput('0.2', 'USD');

    expect(tenth + fifth).toBe(parseAmountInput('0.3', 'USD'));
    expect(Number.isInteger(tenth)).toBe(true);
  });

  it('ignores currency symbols, spaces and a leading plus', () => {
    expect(parseAmountInput(' $ 25.00 ', 'USD')).toBe(2500);
    expect(parseAmountInput('₹3000', 'INR')).toBe(300_000);
    expect(parseAmountInput('+5.50', 'USD')).toBe(550);
  });

  it('reads a comma before exactly three digits as grouping', () => {
    expect(parseAmountInput('1,234', 'USD')).toBe(123_400);
    expect(parseAmountInput('1,234.50', 'USD')).toBe(123_450);
  });

  it('reads a lone comma that is not grouping as the decimal separator', () => {
    // "1234,50" is how most of Europe writes 1234.50, and guessing wrong is a 100× error.
    expect(parseAmountInput('1234,50', 'USD')).toBe(123_450);
  });

  it('takes the later separator as the decimal point when both appear', () => {
    expect(parseAmountInput('1.234,50', 'USD')).toBe(123_450);
    expect(parseAmountInput('1,234.50', 'USD')).toBe(123_450);
  });

  it('throws rather than rounds when there are too many decimal places', () => {
    expect(() => parseAmountInput('1.234', 'USD')).toThrow(AmountInputError);
    expect(() => parseAmountInput('100.5', 'JPY')).toThrow(/no decimal places/u);
  });

  it('follows the currency exponent, not a hardcoded two', () => {
    expect(parseAmountInput('1250', 'JPY')).toBe(1250);
    expect(parseAmountInput('1.234', 'KWD')).toBe(1234);
  });

  it('rejects an empty field and one with no digits in it', () => {
    expect(() => parseAmountInput('', 'USD')).toThrow(/Enter an amount/u);
    expect(() => parseAmountInput('  ', 'USD')).toThrow(/Enter an amount/u);
    expect(() => parseAmountInput('.', 'USD')).toThrow(/Enter an amount/u);
  });

  it('rejects anything that is not a number', () => {
    expect(() => parseAmountInput('twenty', 'USD')).toThrow(AmountInputError);
    expect(() => parseAmountInput('12e3', 'USD')).toThrow(AmountInputError);
  });

  it('rejects an amount past the ceiling instead of overflowing', () => {
    expect(() => parseAmountInput('10000000.01', 'USD')).toThrow(/too large/u);
  });
});

describe('tryParseAmountInput / amountInputError', () => {
  it('answers null rather than throwing, for a live preview', () => {
    expect(tryParseAmountInput('nope', 'USD')).toBeNull();
    expect(tryParseAmountInput('12.34', 'USD')).toBe(1234);
  });

  it('treats a blank field as not-yet-typed rather than an error', () => {
    expect(amountInputError('', 'USD')).toBeNull();
    expect(amountInputError('   ', 'USD')).toBeNull();
  });

  it('returns the message a user can act on', () => {
    expect(amountInputError('1.234', 'USD')).toMatch(/2 decimal places/u);
    expect(amountInputError('12.00', 'USD')).toBeNull();
  });
});

describe('formatAmountInput', () => {
  it('round-trips through the parser for every exponent', () => {
    for (const [minor, currency] of [
      [300_000, 'INR'],
      [1250, 'JPY'],
      [1234, 'KWD'],
      [5, 'USD'],
    ] as const) {
      expect(parseAmountInput(formatAmountInput(minor, currency), currency)).toBe(minor);
    }
  });

  it('is ungrouped and dot-separated, because it goes back into the field', () => {
    expect(formatAmountInput(123_450, 'USD')).toBe('1234.50');
    expect(formatAmountInput(5, 'USD')).toBe('0.05');
    expect(formatAmountInput(1250, 'JPY')).toBe('1250');
  });
});

describe('percentages', () => {
  it('parses into integer basis points so thirds can total exactly 100%', () => {
    expect(parsePercentInput('33.33')).toBe(3333);
    expect(parsePercentInput('33.34')).toBe(3334);
    expect(
      parsePercentInput('33.33') + parsePercentInput('33.33') + parsePercentInput('33.34'),
    ).toBe(10_000);
  });

  it('accepts a trailing sign and an empty field', () => {
    expect(parsePercentInput('25%')).toBe(2500);
    expect(parsePercentInput('')).toBe(0);
  });

  it('rejects more than two decimal places and anything outside 0–100', () => {
    expect(() => parsePercentInput('33.333')).toThrow(/2 decimal places/u);
    expect(() => parsePercentInput('101')).toThrow(/between 0 and 100/u);
    expect(() => parsePercentInput('half')).toThrow(AmountInputError);
  });

  it('formats basis points back the way they were typed', () => {
    expect(formatPercentInput(3333)).toBe('33.33');
    expect(formatPercentInput(2500)).toBe('25');
    expect(formatPercentInput(10_000)).toBe('100');
  });
});
