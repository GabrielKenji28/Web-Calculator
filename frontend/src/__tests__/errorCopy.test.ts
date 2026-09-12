import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../api/types';
import { fixtures } from '../contract/fixtures';
import { ERROR_COPY, errorCopyFor } from '../format/errorCopy';

describe('the error copy map', () => {
  it('has an entry for every code the contract defines', () => {
    expect([...ERROR_CODES].sort()).toEqual(Object.keys(fixtures.errors).sort());
    for (const code of ERROR_CODES) {
      expect(ERROR_COPY[code], code).toBeTruthy();
    }
    expect(Object.keys(ERROR_COPY).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('keeps every line in the displays register', () => {
    for (const code of ERROR_CODES) {
      const line = ERROR_COPY[code];
      expect(line.endsWith('.'), code).toBe(true);
      expect(line.includes('\n'), code).toBe(false);
      // Sentence case, so no shouted codes or Title Case Headlines.
      expect(line, code).toMatch(/^[A-Z][^A-Z]*/);
      expect(line.length, code).toBeLessThanOrEqual(60);
    }
  });

  it('says the fault is ours for a server error and what to fix for a user error', () => {
    expect(ERROR_COPY.INTERNAL_ERROR).not.toBe(ERROR_COPY.DIVISION_BY_ZERO);
    expect(ERROR_COPY.INTERNAL_ERROR).toMatch(/our end/);
    expect(ERROR_COPY.DIVISION_BY_ZERO).toBe('Cannot divide by zero.');
  });

  it('resolves a known code to its copy, not to the servers wording', () => {
    const contractMessage = fixtures.errors['NEGATIVE_SQRT'];
    expect(contractMessage).toBeDefined();
    expect(errorCopyFor('NEGATIVE_SQRT', contractMessage ?? '')).toBe(
      ERROR_COPY.NEGATIVE_SQRT,
    );
    expect(errorCopyFor('NEGATIVE_SQRT', contractMessage ?? '')).not.toBe(contractMessage);
  });

  it('falls back to the servers message for a code it does not know', () => {
    expect(errorCopyFor('SOME_FUTURE_CODE', 'The service said this.')).toBe(
      'The service said this.',
    );
  });
});
