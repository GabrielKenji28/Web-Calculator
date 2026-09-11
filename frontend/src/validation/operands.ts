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
  readonly errors: readonly (string | null)[];
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
