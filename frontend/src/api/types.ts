/**
 * Wire types for `POST /api/v1/calculate`, mirrored against the Go structs.
 *
 * The handler rejects unknown fields, so `CalculateRequest` has no optional
 * members by design — there is deliberately nowhere to put a preview scenario id
 * or a `testFault` marker, which is what makes test-only metadata impossible to
 * serialise into a request.
 *
 * `code` is typed `string` rather than the `ErrorCode` union so an unrecognised
 * code from a newer server still renders its message instead of crashing;
 * `ERROR_CODES` is the known set, asserted against the contract in the tests.
 */

/** Error codes defined by the contract. */
export const ERROR_CODES = [
  'INVALID_REQUEST',
  'UNKNOWN_OPERATION',
  'DIVISION_BY_ZERO',
  'NEGATIVE_SQRT',
  'INVALID_POWER',
  'NON_FINITE_RESULT',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface CalculateRequest {
  readonly operation: string;
  readonly operands: readonly number[];
}

export interface ApiError {
  readonly code: string;
  readonly message: string;
}

export interface CalculateSuccessBody {
  readonly result: number;
}

export interface CalculateErrorBody {
  readonly error: ApiError;
}

/**
 * Everything a caller can learn from one calculation attempt.
 *
 * `previewGap` is emitted only by the test fixture adapter for unmatched input.
 * The production HTTP client never produces one.
 */
export type CalculateOutcome =
  | { readonly kind: 'success'; readonly result: number }
  | { readonly kind: 'apiError'; readonly status: number; readonly error: ApiError }
  | { readonly kind: 'transportError'; readonly message: string }
  | { readonly kind: 'previewGap'; readonly message: string };

/**
 * The single serialiser for outgoing request bodies.
 *
 * Both the HTTP client and the preview index route through this, so the bytes
 * the app would send and the bytes the preview matches on cannot drift. The
 * object literal is rebuilt explicitly to pin key order regardless of how the
 * caller's object was constructed.
 */
export function serializeCalculateRequest(request: CalculateRequest): string {
  return JSON.stringify({
    operation: request.operation,
    operands: [...request.operands],
  });
}

/** Narrows a parsed JSON body to the success shape. */
export function asSuccessBody(body: unknown): CalculateSuccessBody | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const result = (body as Record<string, unknown>)['result'];
  if (typeof result !== 'number') return undefined;
  return { result };
}

/** Narrows a parsed JSON body to the error envelope shape. */
export function asErrorBody(body: unknown): CalculateErrorBody | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const error = (body as Record<string, unknown>)['error'];
  if (typeof error !== 'object' || error === null) return undefined;
  const record = error as Record<string, unknown>;
  const code = record['code'];
  const message = record['message'];
  if (typeof code !== 'string' || typeof message !== 'string') return undefined;
  return { error: { code, message } };
}
