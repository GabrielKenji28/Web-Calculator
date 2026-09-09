/**
 * Client-side operand validation.
 *
 * Runs before any request is issued, so blank, non-numeric and non-finite input
 * never reaches the network. The contract's `operandType` is "finite JSON
 * number"; these three rules are exactly that boundary, and each gets its own
 * message so the field tells the user what is actually wrong.
 *
 * This is input validation, not arithmetic. Nothing here computes a result.
 */

export const BLANK_OPERAND_MESSAGE = 'Enter a number.';
export const NON_NUMERIC_OPERAND_MESSAGE = 'Enter a number, for example 12 or -3.5.';
export const NON_FINITE_OPERAND_MESSAGE = 'Enter a number within the supported range.';

export type OperandValidation =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly message: string };

export function validateOperand(raw: string): OperandValidation {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, message: BLANK_OPERAND_MESSAGE };
  }

  const value = Number(trimmed);
  if (Number.isNaN(value)) {
    return { ok: false, message: NON_NUMERIC_OPERAND_MESSAGE };
  }
  if (!Number.isFinite(value)) {
    // "Infinity", "1e309" and friends parse cleanly but are outside binary64.
    return { ok: false, message: NON_FINITE_OPERAND_MESSAGE };
  }

  return { ok: true, value };
}

export interface OperandFormValidation {
  /** One entry per field, `null` where the field is valid. */
  readonly errors: readonly (string | null)[];
  /** Parsed operands, or `null` when any field is invalid. */
  readonly values: readonly number[] | null;
}

export function validateOperands(raw: readonly string[]): OperandFormValidation {
  const errors: (string | null)[] = [];
  const values: number[] = [];
  let valid = true;

  for (const entry of raw) {
    const result = validateOperand(entry);
    if (result.ok) {
      errors.push(null);
      values.push(result.value);
    } else {
      errors.push(result.message);
      valid = false;
    }
  }

  return { errors, values: valid ? values : null };
}
