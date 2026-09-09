import { useReducer, type Dispatch } from 'react';
import type { CalculateRequest } from '../api/types';
import { MAX_MANTISSA_DIGITS, MINUS, operandsNeeded, type OperationKey } from '../keypad/keys';
import { validateOperand } from '../validation/operands';

/**
 * Entry state for the keypad: what is on the display, what operation is armed,
 * and what the expression line reads.
 *
 * It performs no arithmetic. Every answer comes from the service; the request
 * builders below only assemble operands. `+/−` is string editing, not `n * -1`.
 */

/**
 * An operand the keypad holds: the exact number that goes on the wire, plus the
 * text standing for it on screen.
 *
 * They differ because `formatResult` rounds to twelve significant digits. `1 ÷ 3`
 * displays `0.333333333333` but returned `0.3333333333333333`; continuing from
 * the text would answer `× 3` with `0.999999999999`, the raw value answers `1`.
 */
export interface Operand {
  readonly value: number;
  readonly text: string;
}

export interface KeypadState {
  /** The value line, as typed. Never empty; a cleared keypad reads "0". */
  readonly display: string;
  /** The left operand, captured when an operator was armed. */
  readonly prevValue: Operand | null;
  /** The armed operator, waiting for `=`. */
  readonly pendingOp: OperationKey | null;
  /** True when the next digit replaces the display instead of appending. */
  readonly overwrite: boolean;
  /** The muted line above the value, e.g. `12 ×` or `15 % of`. */
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

/** Splits the display into its sign and the rest, so edits ignore the sign. */
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
      // The key edits the number being typed; in overwrite mode none is, so the
      // value line still holds the left operand or a result. Negating either
      // would show a change the next digit silently discards.
      if (state.overwrite) return state;
      const { negative, body } = parts(state.display);
      // Zero has no sign to show, so -0 can never be typed into a request.
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
      // Writing the display from the operand is what puts a result on the value
      // line when arming on one; from the display it writes back what was there.
      return {
        ...state,
        display: action.left.text,
        prevValue: action.left,
        pendingOp: action.key,
        overwrite: true,
        expression: action.left.text + ' ' + action.key.expressionGlyph,
      };

    case 'evaluate':
      // The value line keeps the operand the request was built from, so there is
      // something to dim while the answer is in flight.
      return {
        display: action.display,
        prevValue: null,
        pendingOp: null,
        overwrite: true,
        expression: '',
      };
  }
}

/**
 * The display as a finite number, or null. The display carries U+2212, so the
 * ASCII hyphen only ever exists on the wire. Routed through `validateOperand` so
 * the blank and non-finite guards stand between the keypad and the network.
 */
export function parseDisplay(display: string): number | null {
  const validation = validateOperand(display.split(MINUS).join('-'));
  return validation.ok ? validation.value : null;
}

/** The only way a typed value becomes an operand, so that guard covers every request. */
export function operandFromDisplay(display: string): Operand | null {
  const value = parseDisplay(display);
  return value === null ? null : { value, text: display };
}

/**
 * The request an operation key fires the moment it is pressed, or null when the
 * key arms and waits for a second operand instead.
 */
export function immediateRequest(left: Operand, key: OperationKey): CalculateRequest | null {
  if (operandsNeeded(key) !== 0) return null;
  return { operation: key.operation, operands: [left.value, ...key.fixedOperands] };
}

/** The request `=` fires, or null when no operator is armed. */
export function equalsRequest(state: KeypadState): CalculateRequest | null {
  const { pendingOp, prevValue } = state;
  if (pendingOp === null || prevValue === null) return null;
  const right = parseDisplay(state.display);
  if (right === null) return null;
  return {
    operation: pendingOp.operation,
    // Sent as captured, never re-read from the display it is rendered as.
    operands: [prevValue.value, right, ...pendingOp.fixedOperands],
  };
}

/**
 * True once the second operand of an armed operation has been typed — the one
 * thing that closes the operation keys.
 *
 * `overwrite` is the signal: arming sets it, the first key that changes the value
 * line clears it. Until then any operation key may replace the pending one; after
 * it every one is disabled, so `2 + 3 × 4` cannot be entered at all.
 */
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
