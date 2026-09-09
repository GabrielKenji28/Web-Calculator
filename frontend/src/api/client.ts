import {
  asErrorBody,
  asSuccessBody,
  serializeCalculateRequest,
  type CalculateOutcome,
  type CalculateRequest,
} from './types';

/**
 * The only module in the application that calls `fetch`.
 * Components and hooks depend on CalculateClient; tests inject a fixture adapter.
 */

export const CALCULATE_ENDPOINT = '/api/v1/calculate';
export const REQUEST_TIMEOUT_MS = 10_000;

export interface CalculateClient {
  calculate(request: CalculateRequest): Promise<CalculateOutcome>;
}

export interface HttpClientOptions {
  /** Injectable for tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly endpoint?: string;
}

const UNREADABLE_RESPONSE = 'The calculator service returned a response this app could not read.';
const UNREACHABLE_SERVICE = 'Could not reach the calculator service.';
const REQUEST_TIMED_OUT = 'The calculator service took too long to respond. Try again.';
const NON_FINITE_RESULT =
  'The calculator service returned a result outside the finite number range.';

function describeThrown(cause: unknown): string {
  return cause instanceof Error ? UNREACHABLE_SERVICE + ' ' + cause.message : UNREACHABLE_SERVICE;
}

export function createHttpClient(options: HttpClientOptions = {}): CalculateClient {
  const endpoint = options.endpoint ?? CALCULATE_ENDPOINT;

  return {
    async calculate(request: CalculateRequest): Promise<CalculateOutcome> {
      const doFetch = options.fetchImpl ?? globalThis.fetch;
      const controller = new AbortController();
      // Receiving headers does not guarantee the body will finish arriving.
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: serializeCalculateRequest(request),
          signal: controller.signal,
        });

        let body: unknown;
        try {
          body = await response.json();
        } catch (cause: unknown) {
          if (controller.signal.aborted) throw cause;
          // A development proxy returns an unreadable 5xx when Go is offline;
          // the service itself returns the contract's JSON error envelope.
          return {
            kind: 'transportError',
            message: response.status >= 500 ? UNREACHABLE_SERVICE : UNREADABLE_RESPONSE,
          };
        }

        const errorBody = asErrorBody(body);
        if (errorBody !== undefined) {
          return { kind: 'apiError', status: response.status, error: errorBody.error };
        }

        const successBody = asSuccessBody(body);
        if (successBody !== undefined && response.ok) {
          if (!Number.isFinite(successBody.result)) {
            return { kind: 'transportError', message: NON_FINITE_RESULT };
          }
          return { kind: 'success', result: successBody.result };
        }

        return { kind: 'transportError', message: UNREADABLE_RESPONSE };
      } catch (cause: unknown) {
        return {
          kind: 'transportError',
          message: controller.signal.aborted ? REQUEST_TIMED_OUT : describeThrown(cause),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export const HTTP_CLIENT_MESSAGES = {
  unreadableResponse: UNREADABLE_RESPONSE,
  unreachableService: UNREACHABLE_SERVICE,
  requestTimedOut: REQUEST_TIMED_OUT,
  nonFiniteResult: NON_FINITE_RESULT,
} as const;
