import { useReducer, type Dispatch } from 'react';
import type { CalculateRequest } from '../api/types';
import { MAX_MANTISSA_DIGITS, MINUS, operandsNeeded, type OperationKey } from '../keypad/keys';
import { validateOperand } from '../validation/operands';

// The keypad performs no arithmetic; every answer comes from the service.

// value is the exact number sent on the wire; text is what formatResult rounded
// it to on screen. They differ, e.g. 0.3333333333333333 vs "0.333333333333" —
// carrying value forward instead of re-parsing text is what keeps
// 1 ÷ 3 then × 3 equal to 1 instead of 0.999999999999.
export interface Operand {
  readonly value: number;
  readonly text: string;
}

export interface KeypadState {
  readonly display: string;
  readonly prevValue: Operand | null;
  readonly pendingOp: OperationKey | null;
  readonly overwrite: boolean;
  readonly expression: string;
}

export const INITIAL_KEYPAD_STATE: KeypadState = {
  display: '0',
  prevValue: null,
  pendingOp: null,
  overwrite: false,
  expression: '',
};

export type KeypadAction =
  | { readonly type: 'digit'; readonly digit: string }
  | { readonly type: 'decimal' }
  | { readonly type: 'sign' }
  | { readonly type: 'backspace' }
  | { readonly type: 'clear' }
  | { readonly type: 'arm'; readonly key: OperationKey; readonly left: Operand }
  | { readonly type: 'evaluate'; readonly display: string };

function digitCount(text: string): number {
  let count = 0;
  for (const character of text) {
    if (character >= '0' && character <= '9') count += 1;
  }
  return count;
}

function parts(display: string): { readonly negative: boolean; readonly body: string } {
  const negative = display.startsWith(MINUS);
  return { negative, body: negative ? display.slice(1) : display };
}

function rejoin(negative: boolean, body: string): string {
  return negative ? MINUS + body : body;
}

function appendDigit(display: string, value: string, overwrite: boolean): string {
  if (overwrite) return value;
  const { negative, body } = parts(display);
  // A lone leading zero is replaced, not appended to, so "0" then "5" is "5".
  if (body === '0') return rejoin(negative, value);
  if (digitCount(body) >= MAX_MANTISSA_DIGITS) return display;
  return rejoin(negative, body + value);
}

export function keypadReducer(state: KeypadState, action: KeypadAction): KeypadState {
  switch (action.type) {
    case 'digit': {
      const display = appendDigit(state.display, action.digit, state.overwrite);
      if (display === state.display && !state.overwrite) return state;
      return { ...state, display, overwrite: false };
    }

    case 'decimal': {
      if (state.overwrite) return { ...state, display: '0.', overwrite: false };
      if (state.display.includes('.')) return state;
      return { ...state, display: state.display + '.' };
    }

    case 'sign': {
      if (state.overwrite) return state;
      const { negative, body } = parts(state.display);
      if (Number(body) === 0) return state;
      return { ...state, display: rejoin(!negative, body) };
    }

    case 'backspace': {
      if (state.overwrite) return { ...state, display: '0', overwrite: false };
      const next = state.display.slice(0, -1);
      if (next === '' || next === MINUS) return { ...state, display: '0' };
      return { ...state, display: next };
    }

    case 'clear':
      return INITIAL_KEYPAD_STATE;

    case 'arm':
      return {
        ...state,
        display: action.left.text,
        prevValue: action.left,
        pendingOp: action.key,
        overwrite: true,
        expression: action.left.text + ' ' + action.key.expressionGlyph,
      };

    case 'evaluate':
      return {
        display: action.display,
        prevValue: null,
        pendingOp: null,
        overwrite: true,
        expression: '',
      };
  }
}

// The display carries U+2212; the ASCII hyphen only ever exists on the wire.
export function parseDisplay(display: string): number | null {
  const validation = validateOperand(display.split(MINUS).join('-'));
  return validation.ok ? validation.value : null;
}

export function operandFromDisplay(display: string): Operand | null {
  const value = parseDisplay(display);
  return value === null ? null : { value, text: display };
}

export function immediateRequest(left: Operand, key: OperationKey): CalculateRequest | null {
  if (operandsNeeded(key) !== 0) return null;
  return { operation: key.operation, operands: [left.value, ...key.fixedOperands] };
}

export function equalsRequest(state: KeypadState): CalculateRequest | null {
  const { pendingOp, prevValue } = state;
  if (pendingOp === null || prevValue === null) return null;
  const right = parseDisplay(state.display);
  if (right === null) return null;
  return {
    operation: pendingOp.operation,
    operands: [prevValue.value, right, ...pendingOp.fixedOperands],
  };
}

// Any operation key may replace the pending one until the second operand is
// typed; after that every one is disabled, so 2 + 3 × 4 cannot be entered.
export function hasSecondOperand(state: KeypadState): boolean {
  return state.pendingOp !== null && !state.overwrite;
}

export interface UseKeypadResult {
  readonly state: KeypadState;
  readonly dispatch: Dispatch<KeypadAction>;
}

export function useKeypad(): UseKeypadResult {
  const [state, dispatch] = useReducer(keypadReducer, INITIAL_KEYPAD_STATE);
  return { state, dispatch };
}
