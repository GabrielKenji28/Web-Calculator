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

// The one stateful container: useKeypad owns what has been typed, useCalculator
// owns the request lifecycle. It performs no arithmetic — every value sent to
// calculate() is either typed or came back from a previous response.

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

  const currentOperand: Operand | null =
    state.status === 'success'
      ? { value: state.result, text: formatResult(state.result) }
      : operandFromDisplay(keypad.display);

  const isDisabled = useCallback(
    (key: CalculatorKey): boolean => {
      if (key.kind === 'clear') return false;
      if (isLoading) return true;
      return key.kind === 'operation' && hasSecondOperand(keypad);
    },
    [isLoading, keypad],
  );

  const press = useCallback(
    (key: CalculatorKey): void => {
      if (isDisabled(key)) return;

      if (hasError) {
        reset();
        dispatch({ type: 'clear' });
        if (key.kind === 'digit') dispatch({ type: 'digit', digit: key.digit });
        if (key.kind === 'decimal') dispatch({ type: 'decimal' });
        return;
      }

      switch (key.kind) {
        case 'digit':
          if (showsResult) reset();
          dispatch({ type: 'digit', digit: key.digit });
          return;

        case 'decimal':
          if (showsResult) reset();
          dispatch({ type: 'decimal' });
          return;

        case 'sign':
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

          const request = immediateRequest(currentOperand, key);
          if (request === null) {
            dispatch({ type: 'arm', key, left: currentOperand });
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

      // Avoid double-firing: a focused button already handles its own Enter/Space.
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
