import { ERROR_CODES, type ErrorCode } from '../api/types';

// Record<ErrorCode, string> makes the compiler reject a new code that arrives
// without copy. A code outside the union falls back to the server's own message.
export const ERROR_COPY: Readonly<Record<ErrorCode, string>> = {
  INVALID_REQUEST: 'Check the numbers and try again.',
  UNKNOWN_OPERATION: 'That operation is not supported.',
  DIVISION_BY_ZERO: 'Cannot divide by zero.',
  NEGATIVE_SQRT: 'No square root of a negative number.',
  INVALID_POWER: 'That power is not defined.',
  NON_FINITE_RESULT: 'Number is too large to display.',
  INTERNAL_ERROR: 'Something went wrong on our end. Try again.',
};

function isKnownCode(code: string): code is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code);
}

export function errorCopyFor(code: string, message: string): string {
  return isKnownCode(code) ? ERROR_COPY[code] : message;
}
