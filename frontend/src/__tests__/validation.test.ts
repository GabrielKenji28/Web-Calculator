import { describe, expect, it } from 'vitest';
import {
  BLANK_OPERAND_MESSAGE,
  NON_FINITE_OPERAND_MESSAGE,
  NON_NUMERIC_OPERAND_MESSAGE,
  validateOperand,
  validateOperands,
} from '../validation/operands';

describe('validateOperand', () => {
  it.each(['', '   ', '\t'])('rejects blank input %j', (raw) => {
    expect(validateOperand(raw)).toEqual({ ok: false, message: BLANK_OPERAND_MESSAGE });
  });

  it.each(['abc', '12abc', '1,5', '--3', 'one', '1 2', '1_000'])(
    'rejects non-numeric input %j',
    (raw) => {
      expect(validateOperand(raw)).toEqual({ ok: false, message: NON_NUMERIC_OPERAND_MESSAGE });
    },
  );

  it.each(['Infinity', '-Infinity', '1e309', '-1e309'])(
    'rejects non-finite input %j',
    (raw) => {
      expect(validateOperand(raw)).toEqual({ ok: false, message: NON_FINITE_OPERAND_MESSAGE });
    },
  );

  it.each([
    ['10', 10],
    ['-6', -6],
    ['0', 0],
    ['1.25', 1.25],
    ['  2.5  ', 2.5],
    ['1e308', 1e308],
    ['1e-308', 1e-308],
    ['0.1', 0.1],
  ])('accepts %j as %d', (raw, value) => {
    expect(validateOperand(raw)).toEqual({ ok: true, value });
  });

  it('accepts negative zero and keeps its sign until serialisation', () => {
    const result = validateOperand('-0');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.is(result.value, -0)).toBe(true);
  });

  it('gives each failure mode its own message', () => {
    const messages = new Set([
      BLANK_OPERAND_MESSAGE,
      NON_NUMERIC_OPERAND_MESSAGE,
      NON_FINITE_OPERAND_MESSAGE,
    ]);
    expect(messages.size).toBe(3);
  });
});

describe('validateOperands', () => {
  it('returns parsed values when every field is valid', () => {
    expect(validateOperands(['10', '2'])).toEqual({ errors: [null, null], values: [10, 2] });
  });

  it('withholds values and reports per-field messages when any field fails', () => {
    expect(validateOperands(['10', ''])).toEqual({
      errors: [null, BLANK_OPERAND_MESSAGE],
      values: null,
    });
    expect(validateOperands(['abc', '1e309'])).toEqual({
      errors: [NON_NUMERIC_OPERAND_MESSAGE, NON_FINITE_OPERAND_MESSAGE],
      values: null,
    });
  });

  it('handles a single-operand form, ready for sqrt', () => {
    expect(validateOperands(['9'])).toEqual({ errors: [null], values: [9] });
  });
});
