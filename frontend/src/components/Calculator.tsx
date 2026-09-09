import { useCallback, type KeyboardEvent } from 'react';
import type { CalculateClient } from '../api/client';
import { exactValue, formatResult, isRounded } from '../format/display';
import { useCalculator } from '../hooks/useCalculator';
import {
  equalsRequest,
  hasSecondOperand,
  immediateRequest,
  operandFromDisplay,
  useKeypad,
  type KeypadState,
  type Operand,
} from '../hooks/useKeypad';
import { keyForKeyboardEvent, type CalculatorKey } from '../keypad/keys';
import { Display } from './Display';
import { Keypad } from './Keypad';

/**
 * The one stateful container, composing two hooks: `useKeypad` owns what has
 * been typed, `useCalculator` owns the request lifecycle and the sequence guard
 * that makes a Clear mid-flight safe. It performs no arithmetic.
 *
 * A result is not terminal — `5 × 4 =` then `+ 3 =` reads 23 — and what carries
 * forward is `state.result`, the raw binary64, never the rounded string beside
 * it. Still only ever one operation: with an operation armed and its second
 * operand typed every operation key is `disabled`, so `2 + 3 × 4` cannot be
 * entered rather than being resolved by a precedence rule nobody asked for.
 */

interface CalculatorProps {
  readonly client: CalculateClient;
}

function isPristine(keypad: KeypadState): boolean {
  return keypad.display === '0' && keypad.prevValue === null && keypad.pendingOp === null;
}

export function Calculator({ client }: CalculatorProps): React.JSX.Element {
  const { state: keypad, dispatch } = useKeypad();
  const { state, calculate, reset } = useCalculator(client);

  const isLoading = state.status === 'loading';
  const showsResult = state.status === 'success';
  const hasError = state.status === 'error';

  /** The operand the next operation acts on: the raw result, or what was typed. */
  const currentOperand: Operand | null =
    state.status === 'success'
      ? { value: state.result, text: formatResult(state.result) }
      : operandFromDisplay(keypad.display);

  /**
   * Whether a key refuses to act. One predicate drives both the `disabled`
   * attribute and the guard in `press`, so a physical keypress — which never
   * sees the attribute — is refused on the same terms as a click.
   */
  const isDisabled = useCallback(
    (key: CalculatorKey): boolean => {
      // Clear stays live mid-flight: abandoning a slow request is what the
      // sequence guard in `useCalculator` exists to make safe.
      if (key.kind === 'clear') return false;
      if (isLoading) return true;
      return key.kind === 'operation' && hasSecondOperand(keypad);
    },
    [isLoading, keypad],
  );

  const press = useCallback(
    (key: CalculatorKey): void => {
      if (isDisabled(key)) return;

      // Any keypress dismisses an error. A digit or the decimal point then
      // starts a fresh number; everything else just clears it without acting.
      if (hasError) {
        reset();
        dispatch({ type: 'clear' });
        if (key.kind === 'digit') dispatch({ type: 'digit', digit: key.digit });
        if (key.kind === 'decimal') dispatch({ type: 'decimal' });
        return;
      }

      switch (key.kind) {
        case 'digit':
          // On a result the keypad is already in overwrite mode, so this starts
          // a fresh entry rather than extending the answer.
          if (showsResult) reset();
          dispatch({ type: 'digit', digit: key.digit });
          return;

        case 'decimal':
          if (showsResult) reset();
          dispatch({ type: 'decimal' });
          return;

        case 'sign':
          // No result special case: the reducer refuses in overwrite mode.
          dispatch({ type: 'sign' });
          return;

        case 'clear':
          dispatch({ type: 'clear' });
          reset();
          return;

        case 'equals': {
          const request = equalsRequest(keypad);
          if (request === null) return;
          dispatch({ type: 'evaluate', display: keypad.display });
          calculate(request);
          return;
        }

        case 'operation': {
          if (currentOperand === null) return;

          // Fire now or wait for a second operand is the contract's arity
          // talking; a null means the key arms instead.
          const request = immediateRequest(currentOperand, key);
          if (request === null) {
            dispatch({ type: 'arm', key, left: currentOperand });
            // The keypad owns the value line now, so the finished calculation
            // must stop rendering over the operand it just became.
            if (showsResult) reset();
            return;
          }

          dispatch({ type: 'evaluate', display: currentOperand.text });
          calculate(request);
          return;
        }
      }
    },
    [calculate, currentOperand, dispatch, hasError, isDisabled, keypad, reset, showsResult],
  );

  const pressBackspace = useCallback((): void => {
    if (isLoading) return;
    if (hasError || showsResult) {
      reset();
      dispatch({ type: 'clear' });
      return;
    }
    dispatch({ type: 'backspace' });
  }, [dispatch, hasError, isLoading, reset, showsResult]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'Backspace') {
        event.preventDefault();
        pressBackspace();
        return;
      }

      // Enter and Space on a focused key are that key's own activation; letting
      // them through here as well would fire two keys from one press.
      const target = event.target;
      const onButton = target instanceof HTMLElement && target.tagName === 'BUTTON';
      if (onButton && (event.key === 'Enter' || event.key === ' ')) return;

      const key = keyForKeyboardEvent(event.key);
      if (key === undefined) return;
      event.preventDefault();
      press(key);
    },
    [press, pressBackspace],
  );

  const value = showsResult ? formatResult(state.result) : keypad.display;
  const exactNote =
    showsResult && isRounded(state.result)
      ? 'Rounded · exact ' + exactValue(state.result)
      : null;

  return (
    <div className="calculator">
      <Display
        expression={keypad.expression}
        exactNote={exactNote}
        value={value}
        failure={state.status === 'error' ? state.failure : null}
        busy={isLoading}
      />
      <Keypad
        isDisabled={isDisabled}
        armedKeyId={keypad.pendingOp?.id ?? null}
        clearGlyph={isPristine(keypad) && state.status === 'idle' ? 'AC' : 'C'}
        onPress={press}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
