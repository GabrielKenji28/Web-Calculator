import { findOperation, operationsFor } from '../contract/fixtures';

/**
 * The keypad's key table, and the one place a key is tied to a contract
 * operation.
 *
 * Nothing here hard-codes an arity. A key names the operation it sends and the
 * operands it supplies itself; how many the *user* still types is derived from
 * the contract:
 *
 *     operandsNeeded = arity - fixedOperands.length - 1
 *
 * The trailing `- 1` is the value already on the display, so `sqrt` and `x²`
 * (`power` with a fixed `2`) come out at 0 and fire immediately, while every
 * binary key comes out at 1 and arms. `assertContractCoverage` fails at module
 * load if the contract defines an operation no key can reach.
 *
 * Glyphs are the typographic characters, not ASCII stand-ins, and each symbol
 * key carries an `ariaLabel` so it is announced as a word.
 */

/** U+2212. The sign the display carries; `-` only ever exists on the wire. */
export const MINUS = '−';

/** Digits accepted in one entry, matching the design's mantissa cap. */
export const MAX_MANTISSA_DIGITS = 9;

export type KeyVariant = 'digit' | 'function' | 'sci' | 'operator';

interface KeyBase {
  readonly id: string;
  /** The character(s) painted on the key. */
  readonly glyph: string;
  /** Spoken name, or null when the glyph already reads as one (the digits). */
  readonly ariaLabel: string | null;
  readonly variant: KeyVariant;
  readonly span: 1 | 2;
  readonly align: 'center' | 'start';
  /** `KeyboardEvent.key` values that activate this key. */
  readonly keyboard: readonly string[];
}

interface OperationFields {
  readonly kind: 'operation';
  /** Contract operation name. */
  readonly operation: string;
  /** Operands the key supplies itself, appended after the typed ones. */
  readonly fixedOperands: readonly number[];
  /** How the armed operation reads on the expression line. */
  readonly expressionGlyph: string;
}

export type OperationKey = KeyBase & OperationFields;

export type CalculatorKey =
  | (KeyBase & { readonly kind: 'digit'; readonly digit: string })
  | (KeyBase & { readonly kind: 'decimal' })
  | (KeyBase & { readonly kind: 'sign' })
  | (KeyBase & { readonly kind: 'clear' })
  | (KeyBase & { readonly kind: 'equals' })
  | OperationKey;

function digit(value: string): CalculatorKey {
  return {
    id: 'digit-' + value,
    kind: 'digit',
    digit: value,
    glyph: value,
    ariaLabel: null,
    variant: 'digit',
    span: 1,
    align: 'center',
    keyboard: [value],
  };
}

interface OperationInput {
  readonly operation: string;
  readonly glyph: string;
  readonly ariaLabel: string;
  readonly expressionGlyph: string;
  readonly variant: KeyVariant;
  readonly keyboard: readonly string[];
  readonly fixedOperands?: readonly number[];
  readonly span?: 1 | 2;
}

function operationKey(id: string, input: OperationInput): OperationKey {
  return {
    id,
    kind: 'operation',
    operation: input.operation,
    fixedOperands: input.fixedOperands ?? [],
    glyph: input.glyph,
    ariaLabel: input.ariaLabel,
    expressionGlyph: input.expressionGlyph,
    variant: input.variant,
    span: input.span ?? 1,
    align: 'center',
    keyboard: input.keyboard,
  };
}

/**
 * Grid order, four columns wide.
 *
 * `%` gets the operator treatment because in this build it is a binary contract
 * operation that arms like the others, and purple is what says a key can arm.
 */
export const KEYPAD_KEYS: readonly CalculatorKey[] = [
  operationKey('sqrt', {
    operation: 'sqrt',
    glyph: '√x',
    ariaLabel: 'Square root',
    expressionGlyph: '√',
    variant: 'sci',
    keyboard: [],
    span: 2,
  }),
  operationKey('square', {
    operation: 'power',
    fixedOperands: [2],
    glyph: 'x²',
    ariaLabel: 'Squared',
    expressionGlyph: '²',
    variant: 'sci',
    keyboard: [],
  }),
  operationKey('power', {
    operation: 'power',
    glyph: 'xʸ',
    ariaLabel: 'Power',
    expressionGlyph: '^',
    variant: 'sci',
    keyboard: ['^'],
  }),

  {
    id: 'clear',
    kind: 'clear',
    glyph: 'C',
    ariaLabel: 'Clear',
    variant: 'function',
    span: 1,
    align: 'center',
    keyboard: ['Escape'],
  },
  {
    id: 'sign',
    kind: 'sign',
    glyph: '+/' + MINUS,
    ariaLabel: 'Toggle sign',
    variant: 'function',
    span: 1,
    align: 'center',
    keyboard: [],
  },
  operationKey('percentage', {
    operation: 'percentage',
    glyph: '%',
    ariaLabel: 'Percent of',
    expressionGlyph: '% of',
    variant: 'operator',
    keyboard: ['%'],
  }),
  operationKey('divide', {
    operation: 'divide',
    glyph: '÷',
    ariaLabel: 'Divide',
    expressionGlyph: '÷',
    variant: 'operator',
    keyboard: ['/'],
  }),

  digit('7'),
  digit('8'),
  digit('9'),
  operationKey('multiply', {
    operation: 'multiply',
    glyph: '×',
    ariaLabel: 'Multiply',
    expressionGlyph: '×',
    variant: 'operator',
    keyboard: ['*'],
  }),

  digit('4'),
  digit('5'),
  digit('6'),
  operationKey('subtract', {
    operation: 'subtract',
    glyph: MINUS,
    ariaLabel: 'Subtract',
    expressionGlyph: MINUS,
    variant: 'operator',
    keyboard: ['-'],
  }),

  digit('1'),
  digit('2'),
  digit('3'),
  operationKey('add', {
    operation: 'add',
    glyph: '+',
    ariaLabel: 'Add',
    expressionGlyph: '+',
    variant: 'operator',
    keyboard: ['+'],
  }),

  { ...digit('0'), span: 2, align: 'start' },
  {
    id: 'decimal',
    kind: 'decimal',
    glyph: '.',
    ariaLabel: 'Decimal point',
    variant: 'digit',
    span: 1,
    align: 'center',
    keyboard: ['.'],
  },
  {
    id: 'equals',
    kind: 'equals',
    glyph: '=',
    ariaLabel: 'Equals',
    variant: 'operator',
    span: 1,
    align: 'center',
    keyboard: ['Enter', '='],
  },
];

export function operationKeys(): readonly OperationKey[] {
  return KEYPAD_KEYS.filter((key): key is OperationKey => key.kind === 'operation');
}

/** The contract's arity for an operation. Throws if the contract has no such operation. */
export function arityOf(operationName: string): number {
  const spec = findOperation(operationName);
  if (spec === undefined) {
    throw new Error('contract/fixtures.json defines no operation named "' + operationName + '"');
  }
  return spec.arity;
}

/**
 * How many operands the user still types after the one already on the display.
 * 0 fires the request on the keypress; 1 arms the operator and waits for `=`.
 */
export function operandsNeeded(key: OperationKey): number {
  return arityOf(key.operation) - key.fixedOperands.length - 1;
}

/** True for the keys that arm and therefore carry `aria-pressed`. */
export function isArmable(key: OperationKey): boolean {
  return operandsNeeded(key) === 1;
}

export function keyForKeyboardEvent(eventKey: string): CalculatorKey | undefined {
  return KEYPAD_KEYS.find((key) => key.keyboard.includes(eventKey));
}

/**
 * Fails loudly when the key table and the contract have drifted apart: an
 * operation with no key would be silently unreachable, and a key needing two
 * typed operands would be silently unusable.
 */
export function assertContractCoverage(): void {
  const covered = new Set(operationKeys().map((key) => key.operation));
  for (const spec of operationsFor()) {
    if (!covered.has(spec.name)) {
      throw new Error('keypad has no key for contract operation "' + spec.name + '"');
    }
  }
  for (const key of operationKeys()) {
    const needed = operandsNeeded(key);
    if (needed !== 0 && needed !== 1) {
      throw new Error(
        'keypad key "' + key.id + '" needs ' + String(needed) + ' typed operands; only 0 or 1 work',
      );
    }
  }
}

assertContractCoverage();
