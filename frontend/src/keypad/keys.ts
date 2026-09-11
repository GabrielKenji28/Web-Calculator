import { findOperation, operationsFor } from '../contract/fixtures';

// Arity is never hard-coded: how many operands the user still types is derived
// from the contract as arity - fixedOperands.length - 1 (the -1 being the value
// already on the display). sqrt and x² (power with a fixed 2) come out at 0 and
// fire immediately; every binary key comes out at 1 and arms.

export const MINUS = '−';

export const MAX_MANTISSA_DIGITS = 9;

export type KeyVariant = 'digit' | 'function' | 'sci' | 'operator';

interface KeyBase {
  readonly id: string;
  readonly glyph: string;
  readonly ariaLabel: string | null;
  readonly variant: KeyVariant;
  readonly span: 1 | 2;
  readonly align: 'center' | 'start';
  readonly keyboard: readonly string[];
}

interface OperationFields {
  readonly kind: 'operation';
  readonly operation: string;
  readonly fixedOperands: readonly number[];
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

// % gets the operator treatment: it is a binary contract operation that arms
// like the others.
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

export function arityOf(operationName: string): number {
  const spec = findOperation(operationName);
  if (spec === undefined) {
    throw new Error('contract/fixtures.json defines no operation named "' + operationName + '"');
  }
  return spec.arity;
}

export function operandsNeeded(key: OperationKey): number {
  return arityOf(key.operation) - key.fixedOperands.length - 1;
}

export function isArmable(key: OperationKey): boolean {
  return operandsNeeded(key) === 1;
}

export function keyForKeyboardEvent(eventKey: string): CalculatorKey | undefined {
  return KEYPAD_KEYS.find((key) => key.keyboard.includes(eventKey));
}

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
