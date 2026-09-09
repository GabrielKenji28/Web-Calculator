import { useCallback, useRef, useState } from 'react';
import type { CalculateClient } from '../api/client';
import type { CalculateRequest } from '../api/types';

/**
 * Request state for one calculation, as an explicit four-state machine.
 *
 * Why a plain `useState` union rather than `useActionState`: that hook has no
 * error slot — a failing action throws to the nearest error boundary and cancels
 * the rest of its queue. This app has to *render* 400 and 500 envelopes inline
 * beside the result, so replacing the UI with a boundary is the wrong shape. A
 * discriminated union also forces the renderer to handle all four states.
 */

export interface ApiFailure {
  readonly kind: 'api';
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

export interface TransportFailure {
  readonly kind: 'transport';
  readonly message: string;
}

export interface PreviewGapFailure {
  readonly kind: 'previewGap';
  readonly message: string;
}

export type CalculationFailure = ApiFailure | TransportFailure | PreviewGapFailure;

export type CalculatorState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'success'; readonly result: number }
  | { readonly status: 'error'; readonly failure: CalculationFailure };

const IDLE: CalculatorState = { status: 'idle' };
const LOADING: CalculatorState = { status: 'loading' };

const UNEXPECTED_CLIENT_FAILURE = 'The calculator client failed unexpectedly.';

export interface UseCalculatorResult {
  readonly state: CalculatorState;
  readonly calculate: (request: CalculateRequest) => void;
  readonly reset: () => void;
}

export function useCalculator(client: CalculateClient): UseCalculatorResult {
  const [state, setState] = useState<CalculatorState>(IDLE);

  /**
   * Monotonic request counter: only the newest request may write state. The
   * generalised form of React's `let ignore = false` cleanup flag, covering both
   * out-of-order responses and a Clear issued mid-flight. Timeouts belong to the
   * HTTP client; this only ignores stale responses.
   */
  const sequenceRef = useRef(0);

  const calculate = useCallback(
    (request: CalculateRequest): void => {
      sequenceRef.current += 1;
      const sequence = sequenceRef.current;
      const isCurrent = (): boolean => sequence === sequenceRef.current;

      setState(LOADING);

      void client.calculate(request).then(
        (outcome) => {
          if (!isCurrent()) return;
          switch (outcome.kind) {
            case 'success':
              setState({ status: 'success', result: outcome.result });
              return;
            case 'apiError':
              setState({
                status: 'error',
                failure: {
                  kind: 'api',
                  status: outcome.status,
                  code: outcome.error.code,
                  message: outcome.error.message,
                },
              });
              return;
            case 'transportError':
              setState({
                status: 'error',
                failure: { kind: 'transport', message: outcome.message },
              });
              return;
            case 'previewGap':
              setState({
                status: 'error',
                failure: { kind: 'previewGap', message: outcome.message },
              });
              return;
          }
        },
        (cause: unknown) => {
          // The clients resolve rather than reject, but a client that throws
          // must surface as a rendered error, never as a blank screen.
          if (!isCurrent()) return;
          const detail = cause instanceof Error ? ' ' + cause.message : '';
          setState({
            status: 'error',
            failure: { kind: 'transport', message: UNEXPECTED_CLIENT_FAILURE + detail },
          });
        },
      );
    },
    [client],
  );

  const reset = useCallback((): void => {
    sequenceRef.current += 1;
    setState(IDLE);
  }, []);

  return { state, calculate, reset };
}

export const CALCULATOR_MESSAGES = {
  unexpectedClientFailure: UNEXPECTED_CLIENT_FAILURE,
} as const;
