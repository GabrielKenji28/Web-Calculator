import { describe, expect, it } from 'vitest';
import { operationsFor } from '../contract/fixtures';
import {
  equalsRequest,
  hasSecondOperand,
  immediateRequest,
  INITIAL_KEYPAD_STATE,
  keypadReducer,
  operandFromDisplay,
  parseDisplay,
  type KeypadAction,
  type KeypadState,
  type Operand,
} from '../hooks/useKeypad';
import {
  arityOf,
  assertContractCoverage,
  KEYPAD_KEYS,
  keyForKeyboardEvent,
  MAX_MANTISSA_DIGITS,
  MINUS,
  operandsNeeded,
  operationKeys,
  type OperationKey,
} from '../keypad/keys';

/**
 * The keypad's pure half: the entry reducer and the two request builders.
 *
 * Nothing here renders. `App.test.tsx` covers the same rules through the DOM;
 * this file covers the states a user cannot reach by pressing keys, which is the
 * only way to prove the guards are real.
 */

function keyById(id: string): OperationKey {
  const key = operationKeys().find((entry) => entry.id === id);
  if (key === undefined) throw new Error('no operation key with id "' + id + '"');
  return key;
}

function apply(actions: readonly KeypadAction[], from = INITIAL_KEYPAD_STATE): KeypadState {
  return actions.reduce(keypadReducer, from);
}

function digits(text: string): readonly KeypadAction[] {
  return [...text].map((character) =>
    character === '.'
      ? ({ type: 'decimal' } as const)
      : ({ type: 'digit', digit: character } as const),
  );
}

/** A typed display as an operand, failing the test rather than the assertion. */
function operand(text: string): Operand {
  const parsed = operandFromDisplay(text);
  if (parsed === null) throw new Error('display "' + text + '" is not an operand');
  return parsed;
}

/** Arms an operator on whatever the display holds, which is what the UI does. */
function armOn(state: KeypadState, id: string): KeypadState {
  return keypadReducer(state, { type: 'arm', key: keyById(id), left: operand(state.display) });
}

/** Evaluates with the display the request was built from, as the UI does. */
function evaluate(state: KeypadState): KeypadState {
  return keypadReducer(state, { type: 'evaluate', display: state.display });
}

describe('the key table is driven by the contract', () => {
  it('reaches every operation the contract defines', () => {
    expect(() => {
      assertContractCoverage();
    }).not.toThrow();

    const covered = new Set(operationKeys().map((key) => key.operation));
    expect([...covered].sort()).toEqual(operationsFor().map((spec) => spec.name).sort());
    expect(operationsFor()).toHaveLength(7);
  });

  it('derives how many operands a key still needs from the contracts arity', () => {
    // Not a hard-coded flag anywhere: arity - fixedOperands - the displayed value.
    for (const key of operationKeys()) {
      expect(operandsNeeded(key), key.id).toBe(
        arityOf(key.operation) - key.fixedOperands.length - 1,
      );
    }
    expect(operandsNeeded(keyById('sqrt'))).toBe(0);
    expect(operandsNeeded(keyById('square'))).toBe(0);
    expect(operandsNeeded(keyById('percentage'))).toBe(1);
  });

  it('fails loudly for an operation the contract does not define', () => {
    expect(() => arityOf('cube-root')).toThrow(/defines no operation named/);
  });

  it('keeps the typographic glyphs rather than ASCII stand-ins', () => {
    const glyphs = new Map(KEYPAD_KEYS.map((key) => [key.id, key.glyph]));
    expect(glyphs.get('subtract')).toBe('−');
    expect(glyphs.get('multiply')).toBe('×');
    expect(glyphs.get('divide')).toBe('÷');
    expect(glyphs.get('sqrt')).toBe('√x');
    expect(glyphs.get('square')).toBe('x²');
    expect(glyphs.get('power')).toBe('xʸ');
    expect(glyphs.get('sign')).toBe('+/−');
  });

  it('binds every keyboard key the calculator claims to support', () => {
    for (const character of '0123456789') {
      expect(keyForKeyboardEvent(character)?.id, character).toBe('digit-' + character);
    }
    expect(keyForKeyboardEvent('.')?.id).toBe('decimal');
    expect(keyForKeyboardEvent('+')?.id).toBe('add');
    expect(keyForKeyboardEvent('-')?.id).toBe('subtract');
    expect(keyForKeyboardEvent('*')?.id).toBe('multiply');
    expect(keyForKeyboardEvent('/')?.id).toBe('divide');
    expect(keyForKeyboardEvent('^')?.id).toBe('power');
    expect(keyForKeyboardEvent('%')?.id).toBe('percentage');
    expect(keyForKeyboardEvent('Enter')?.id).toBe('equals');
    expect(keyForKeyboardEvent('=')?.id).toBe('equals');
    expect(keyForKeyboardEvent('Escape')?.id).toBe('clear');
    expect(keyForKeyboardEvent('q')).toBeUndefined();
  });
});

describe('entry', () => {
  it('replaces a lone leading zero instead of appending to it', () => {
    expect(apply(digits('0')).display).toBe('0');
    expect(apply(digits('05')).display).toBe('5');
    expect(apply(digits('00')).display).toBe('0');
  });

  it('caps the mantissa and ignores further digits', () => {
    const capped = apply(digits('1234567890'));
    expect(capped.display).toBe('123456789');
    expect(capped.display).toHaveLength(MAX_MANTISSA_DIGITS);
  });

  it('counts the digits, not the characters, when capping', () => {
    expect(apply(digits('1.23456789')).display).toBe('1.23456789');
    expect(apply(digits('1.234567890')).display).toBe('1.23456789');
  });

  it('allows one decimal point per number', () => {
    expect(apply([...digits('1.5'), { type: 'decimal' }, { type: 'digit', digit: '5' }]).display)
      .toBe('1.55');
  });

  it('starts a decimal with a leading zero in overwrite mode', () => {
    const armed = armOn(apply(digits('9')), 'add');
    expect(keypadReducer(armed, { type: 'decimal' }).display).toBe('0.');
  });

  it('toggles the sign by editing the string, never by multiplying', () => {
    const negative = apply([...digits('42'), { type: 'sign' }]);
    expect(negative.display).toBe(MINUS + '42');
    expect(keypadReducer(negative, { type: 'sign' }).display).toBe('42');
    // The minus is a prefix, so digits still append behind it.
    expect(keypadReducer(negative, { type: 'digit', digit: '7' }).display).toBe(MINUS + '427');
  });

  it('edits only a number being typed, not one waiting to be replaced', () => {
    // After arming, the value line still shows the left operand and the next
    // digit will replace it. Negating there would show a change that the next
    // keypress silently undoes.
    const armed = armOn(apply(digits('5')), 'add');
    expect(keypadReducer(armed, { type: 'sign' })).toBe(armed);
    // Typing first is all it takes.
    const typed = apply(digits('3'), armed);
    expect(keypadReducer(typed, { type: 'sign' }).display).toBe(MINUS + '3');
  });

  it('leaves zero unsigned, so -0 can never be typed', () => {
    expect(apply([{ type: 'sign' }]).display).toBe('0');
    expect(apply([...digits('0.00'), { type: 'sign' }]).display).toBe('0.00');
  });

  it('deletes the last character, bottoming out at zero', () => {
    expect(apply([...digits('12'), { type: 'backspace' }]).display).toBe('1');
    const twice = apply([...digits('12'), { type: 'backspace' }, { type: 'backspace' }]);
    expect(twice.display).toBe('0');
    expect(apply([...digits('5'), { type: 'sign' }, { type: 'backspace' }]).display).toBe('0');
  });

  it('clears everything, including the armed operator', () => {
    const armed = armOn(apply(digits('12')), 'multiply');
    expect(keypadReducer(armed, { type: 'clear' })).toEqual(INITIAL_KEYPAD_STATE);
  });
});

describe('the expression line', () => {
  it('reads the left operand and the operator', () => {
    const armed = armOn(apply(digits('12')), 'multiply');
    expect(armed.expression).toBe('12 ×');
    expect(armed.prevValue).toEqual({ value: 12, text: '12' });
  });

  it('reads "15 % of" for the percentage operator', () => {
    const armed = armOn(apply(digits('15')), 'percentage');
    expect(armed.expression).toBe('15 % of');
  });

  it('empties on evaluation', () => {
    const armed = armOn(apply(digits('12')), 'add');
    const evaluated = evaluate(armed);
    expect(evaluated.expression).toBe('');
    expect(evaluated.pendingOp).toBeNull();
    expect(evaluated.prevValue).toBeNull();
    expect(evaluated.overwrite).toBe(true);
  });
});

describe('request building', () => {
  it('sends the display as the only operand of an arity-1 operation', () => {
    expect(immediateRequest(operand('9'), keyById('sqrt'))).toEqual({
      operation: 'sqrt',
      operands: [9],
    });
  });

  it('appends the keys own fixed operands', () => {
    expect(immediateRequest(operand('7'), keyById('square'))).toEqual({
      operation: 'power',
      operands: [7, 2],
    });
  });

  it('has no immediate request for a key that arms', () => {
    expect(immediateRequest(operand('9'), keyById('add'))).toBeNull();
  });

  it('sends both operands, left to right, on equals', () => {
    const state = apply(digits('200'), armOn(apply(digits('15')), 'percentage'));
    expect(equalsRequest(state)).toEqual({ operation: 'percentage', operands: [15, 200] });
  });

  it('converts the display minus to an ASCII minus on the wire', () => {
    const state = apply(
      digits('2'),
      armOn(apply([...digits('6'), { type: 'sign' }]), 'multiply'),
    );
    expect(equalsRequest(state)).toEqual({ operation: 'multiply', operands: [-6, 2] });
  });

  it('has nothing to send when no operator is armed', () => {
    expect(equalsRequest(apply(digits('9')))).toBeNull();
  });

  it('sends the captured left operand, not a re-reading of its display text', () => {
    // The whole of Checkpoint B in one assertion. A result arrives as a raw
    // binary64 and is displayed rounded to twelve significant digits; the
    // request has to carry the number, not the rendering.
    const carried = keypadReducer(INITIAL_KEYPAD_STATE, {
      type: 'arm',
      key: keyById('multiply'),
      left: { value: 0.3333333333333333, text: '0.333333333333' },
    });
    expect(carried.display).toBe('0.333333333333');
    expect(equalsRequest(apply(digits('3'), carried))).toEqual({
      operation: 'multiply',
      operands: [0.3333333333333333, 3],
    });
    // What re-reading the display would have sent instead.
    expect(parseDisplay('0.333333333333')).toBe(0.333333333333);
  });

  it('refuses to send an operand that is not a finite number', () => {
    // Unreachable by typing while the mantissa cap holds; the guard is what
    // keeps it unreachable, so it is asserted directly.
    expect(parseDisplay('1e309')).toBeNull();
    expect(parseDisplay('')).toBeNull();
    // A left operand that will not parse never becomes an `Operand` at all, so
    // an operator cannot arm on it in the first place.
    expect(operandFromDisplay('1e309')).toBeNull();
    expect(operandFromDisplay('')).toBeNull();
    // A right operand that will not parse stops `=` instead.
    expect(
      equalsRequest({
        ...INITIAL_KEYPAD_STATE,
        display: '1e309',
        prevValue: { value: 2, text: '2' },
        pendingOp: keyById('add'),
      }),
    ).toBeNull();
  });
});

describe('one operation at a time', () => {
  const armedThenTyped = apply(digits('3'), armOn(apply(digits('2')), 'add'));

  it('stays open while nothing is armed, including on a fresh entry', () => {
    expect(hasSecondOperand(INITIAL_KEYPAD_STATE)).toBe(false);
    expect(hasSecondOperand(apply(digits('5')))).toBe(false);
  });

  it('stays open while an operator is armed, so the operation can be changed', () => {
    const armed = armOn(apply(digits('5')), 'add');
    expect(hasSecondOperand(armed)).toBe(false);

    // A binary key swaps and keeps waiting.
    const swapped = armOn(armed, 'multiply');
    expect(swapped.expression).toBe('5 ×');
    expect(swapped.prevValue).toEqual({ value: 5, text: '5' });
  });

  it('lets a unary key replace the armed operation and act on the left operand', () => {
    // `5 ^` then `√x` is one operation, not two: the pending power is dropped
    // and the square root runs on the 5 still showing.
    const armed = armOn(apply(digits('5')), 'power');
    expect(hasSecondOperand(armed)).toBe(false);
    expect(immediateRequest(operand(armed.display), keyById('sqrt'))).toEqual({
      operation: 'sqrt',
      operands: [5],
    });
    expect(immediateRequest(operand(armed.display), keyById('square'))).toEqual({
      operation: 'power',
      operands: [5, 2],
    });
    // Evaluating leaves nothing of the abandoned operation behind.
    const fired = evaluate(armed);
    expect(fired.pendingOp).toBeNull();
    expect(fired.expression).toBe('');
  });

  it('closes once the second operand exists', () => {
    expect(hasSecondOperand(armedThenTyped)).toBe(true);
  });

  it('counts a backspaced second operand as typed, so the lock does not lift', () => {
    // Backspacing back to zero still leaves a right-hand operand on the value
    // line — the operation is `2 + 0`, not `2 +` waiting again.
    const rubbedOut = keypadReducer(armedThenTyped, { type: 'backspace' });
    expect(rubbedOut.display).toBe('0');
    expect(hasSecondOperand(rubbedOut)).toBe(true);
  });

  it('lifts the lock on evaluation, so the answer can start the next operation', () => {
    expect(hasSecondOperand(evaluate(armedThenTyped))).toBe(false);
  });
});
