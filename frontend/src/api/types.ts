// Wire types for POST /api/v1/calculate, mirrored against the Go structs.

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

// previewGap is emitted only by the test fixture adapter; the HTTP client never produces one.
export type CalculateOutcome =
  | { readonly kind: 'success'; readonly result: number }
  | { readonly kind: 'apiError'; readonly status: number; readonly error: ApiError }
  | { readonly kind: 'transportError'; readonly message: string }
  | { readonly kind: 'previewGap'; readonly message: string };

// Rebuilds the literal to pin key order, so the HTTP client and the preview
// index (which both call this) can never serialise the same request differently.
export function serializeCalculateRequest(request: CalculateRequest): string {
  return JSON.stringify({
    operation: request.operation,
    operands: [...request.operands],
  });
}

export function asSuccessBody(body: unknown): CalculateSuccessBody | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const result = (body as Record<string, unknown>)['result'];
  if (typeof result !== 'number') return undefined;
  return { result };
}

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
