import { numberPolicy } from '../contract/fixtures';

/**
 * Turns a wire `result` into the string shown to the user. Presentation only —
 * the raw number is never mutated and never round-tripped into a request.
 *
 * Both rules come from `numberPolicy` in the contract, so a policy change is a
 * fixture edit: `normalizeNegativeZero` collapses -0 to "0", and
 * `displaySignificantDigits` (12) rounds away binary64 noise so `0.1 + 0.2`
 * displays "0.3". The `Number(...).toString()` afterwards drops the zeros
 * `toPrecision` pads with, turning "0.300000000000" into "0.3".
 */
export function formatResult(value: number): string {
  const normalized = numberPolicy.normalizeNegativeZero && Object.is(value, -0) ? 0 : value;
  return Number(normalized.toPrecision(numberPolicy.displaySignificantDigits)).toString();
}

/**
 * True when the display string has rounded the underlying value, so the UI can
 * offer the exact binary64 figure alongside it instead of quietly hiding it.
 */
export function isRounded(value: number): boolean {
  return formatResult(value) !== String(value);
}

/** The exact value as JavaScript renders it, for the "exact value" annotation. */
export function exactValue(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}
