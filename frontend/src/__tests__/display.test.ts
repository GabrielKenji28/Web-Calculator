import { describe, expect, it } from 'vitest';
import {
  displayPinnedCases,
  numberPolicy,
  previewCases,
  successResultOf,
} from '../contract/fixtures';
import { exactValue, formatResult, isRounded } from '../format/display';

describe('formatResult', () => {
  it('reproduces every expectedDisplay fixture', () => {
    const pinned = displayPinnedCases();
    expect(pinned).toHaveLength(5);

    for (const entry of pinned) {
      const result = successResultOf(entry);
      expect(result, entry.id).toBeDefined();
      if (result === undefined) continue;
      expect(formatResult(result), entry.id).toBe(entry.expectedDisplay);
    }
  });

  it.each(displayPinnedCases().map((entry) => [entry.id, entry] as const))(
    'formats %s as its pinned display string',
    (_id, entry) => {
      const result = successResultOf(entry);
      expect(result).toBeDefined();
      if (result === undefined) return;
      expect(formatResult(result)).toBe(entry.expectedDisplay);
    },
  );

  it('collapses negative zero, per numberPolicy.normalizeNegativeZero', () => {
    expect(numberPolicy.normalizeNegativeZero).toBe(true);
    expect(formatResult(-0)).toBe('0');
    expect(formatResult(0)).toBe('0');
    expect(Object.is(Number(formatResult(-0)), 0)).toBe(true);
  });

  it('rounds to numberPolicy.displaySignificantDigits and drops padding zeros', () => {
    expect(numberPolicy.displaySignificantDigits).toBe(12);
    expect(formatResult(0.30000000000000004)).toBe('0.3');
    expect(formatResult(0.3333333333333333)).toBe('0.333333333333');
  });

  it('leaves exactly representable values untouched', () => {
    expect(formatResult(12)).toBe('12');
    expect(formatResult(-8)).toBe('-8');
    expect(formatResult(3.75)).toBe('3.75');
    expect(formatResult(5e307)).toBe('5e+307');
  });

  it('produces a display string for every preview success case', () => {
    for (const entry of previewCases()) {
      const result = successResultOf(entry);
      if (result === undefined) continue;
      const display = formatResult(result);
      expect(display, entry.id).not.toBe('');
      expect(Number.isNaN(Number(display)), entry.id).toBe(false);
    }
  });

  it('never mutates the value it was given', () => {
    const source = 0.30000000000000004;
    formatResult(source);
    expect(source).toBe(0.30000000000000004);
  });
});

describe('isRounded / exactValue', () => {
  it('flags values the display rounds, so the exact figure can be shown', () => {
    expect(isRounded(0.30000000000000004)).toBe(true);
    expect(exactValue(0.30000000000000004)).toBe('0.30000000000000004');
  });

  it('does not flag values that display exactly', () => {
    expect(isRounded(12)).toBe(false);
    expect(isRounded(3.75)).toBe(false);
    expect(isRounded(0)).toBe(false);
  });

  it('reports negative zero as plain zero', () => {
    expect(exactValue(-0)).toBe('0');
    expect(isRounded(-0)).toBe(false);
  });
});

describe('finite display boundaries', () => {
  it.each([Number.MAX_VALUE, -Number.MAX_VALUE])(
    'keeps the display finite and the exact value available for %s',
    (value) => {
      expect(Number.isFinite(Number(formatResult(value)))).toBe(true);
      expect(exactValue(value)).toBe(String(value));
      expect(isRounded(value)).toBe(true);
    },
  );
});
