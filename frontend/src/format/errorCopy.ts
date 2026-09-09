import { ERROR_CODES, type ErrorCode } from '../api/types';

/**
 * The one place an error code becomes words on screen.
 *
 * The contract's own messages are precise but written for an API consumer
 * ("Zero cannot have a negative exponent, and negative bases require an integer
 * exponent."). A single-line display needs one short sentence, so this map
 * re-voices each code: sentence case, one line, no jargon.
 *
 * `Record<ErrorCode, string>` makes the compiler reject a new code that arrives
 * without copy. Anything outside the union — a code from a newer server — falls
 * back to that server's own `message`, so the service is never contradicted,
 * only rephrased where we know the phrasing.
 */
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

/** Display copy for an error envelope, falling back to the server's message. */
export function errorCopyFor(code: string, message: string): string {
  return isKnownCode(code) ? ERROR_COPY[code] : message;
}
