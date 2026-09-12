import { numberPolicy } from '../contract/fixtures';

// Presentation only — the raw number is never mutated or round-tripped into a
// request. Both rules read from numberPolicy in the contract: negative zero
// collapses to "0", and displaySignificantDigits (12) rounds away binary64
// noise so 0.1 + 0.2 displays "0.3".
export function formatResult(value: number): string {
  const normalized = numberPolicy.normalizeNegativeZero && Object.is(value, -0) ? 0 : value;
  return Number(normalized.toPrecision(numberPolicy.displaySignificantDigits)).toString();
}

export function isRounded(value: number): boolean {
  return formatResult(value) !== String(value);
}

export function exactValue(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}
