import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import {
  createHttpClient,
  HTTP_CLIENT_MESSAGES,
  REQUEST_TIMEOUT_MS,
  type CalculateClient,
} from '../api/client';
import {
  createPreviewClient,
  outcomeForCase,
  parseFixtureRequestBody,
  PREVIEW_UNAVAILABLE_MESSAGE,
} from '../test/previewClient';
import type { CalculateOutcome, CalculateRequest } from '../api/types';
import {
  caseById,
  errorEnvelopeOf,
  operationsFor,
  previewCases,
  successResultOf,
  type FixtureCase,
} from '../contract/fixtures';
import { formatResult } from '../format/display';
import { ERROR_COPY, errorCopyFor } from '../format/errorCopy';
import {
  KEYPAD_KEYS,
  MAX_MANTISSA_DIGITS,
  MINUS,
  operandsNeeded,
  operationKeys,
  type CalculatorKey,
} from '../keypad/keys';

const liveRegion = (): HTMLElement => screen.getByRole('status');

function operandsOf(entry: FixtureCase): readonly number[] {
  const parsed = parseFixtureRequestBody(entry.request.body);
  if (parsed === undefined) throw new Error('fixture ' + entry.id + ' is not a typed UI request');
  return parsed.request.operands;
}

function operationOf(entry: FixtureCase): string {
  const parsed = parseFixtureRequestBody(entry.request.body);
  if (parsed === undefined) throw new Error('fixture ' + entry.id + ' is not a typed UI request');
  return parsed.request.operation;
}

function keyById(id: string): CalculatorKey {
  const key = KEYPAD_KEYS.find((entry) => entry.id === id);
  if (key === undefined) throw new Error('no keypad key with id "' + id + '"');
  return key;
}

function keyName(id: string): string {
  const key = keyById(id);
  return key.ariaLabel ?? key.glyph;
}

async function pressKeys(user: UserEvent, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await user.click(screen.getByRole('button', { name: keyName(id) }));
  }
}

// Returns null for operands beyond a keypad: exponent notation (1e308) or more
// than nine mantissa digits. Those cases are swept separately.
function keysForNumber(value: number): readonly string[] | null {
  const text = String(Object.is(value, -0) ? 0 : value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;

  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  if (body.replace(/\D/g, '').length > MAX_MANTISSA_DIGITS) return null;

  const ids = [...body].map((character) =>
    character === '.' ? 'decimal' : 'digit-' + character,
  );
  return negative ? [...ids, 'sign'] : ids;
}

function keypadPlan(entry: FixtureCase): readonly string[] | null {
  const key = keyById(operationOf(entry));
  if (key.kind !== 'operation') return null;

  const values = operandsOf(entry);
  const first = values[0];
  if (first === undefined) return null;
  const firstKeys = keysForNumber(first);
  if (firstKeys === null) return null;

  if (operandsNeeded(key) === 0) return [...firstKeys, key.id];

  const second = values[1];
  if (second === undefined) return null;
  const secondKeys = keysForNumber(second);
  if (secondKeys === null) return null;
  return [...firstKeys, key.id, ...secondKeys, 'equals'];
}

async function runFixture(user: UserEvent, entry: FixtureCase): Promise<void> {
  const plan = keypadPlan(entry);
  if (plan === null) throw new Error('fixture ' + entry.id + ' cannot be entered on the keypad');
  await pressKeys(user, plan);
}

function spyClient(outcome: CalculateOutcome = { kind: 'success', result: 0 }): {
  readonly client: CalculateClient;
  readonly calls: CalculateRequest[];
} {
  const calls: CalculateRequest[] = [];
  return {
    calls,
    client: {
      calculate(request: CalculateRequest): Promise<CalculateOutcome> {
        calls.push(request);
        return Promise.resolve(outcome);
      },
    },
  };
}

function scriptedClient(results: readonly number[]): {
  readonly client: CalculateClient;
  readonly calls: CalculateRequest[];
} {
  const calls: CalculateRequest[] = [];
  return {
    calls,
    client: {
      calculate(request: CalculateRequest): Promise<CalculateOutcome> {
        const result = results[calls.length];
        calls.push(request);
        if (result === undefined) {
          throw new Error('unscripted request #' + String(calls.length));
        }
        return Promise.resolve({ kind: 'success', result });
      },
    },
  };
}

const allPreview = previewCases().filter((entry) => entry.testFault === undefined);
const previewSuccesses = allPreview.filter((entry) => successResultOf(entry) !== undefined);
const previewFailures = allPreview.filter((entry) => errorEnvelopeOf(entry) !== undefined);

const onKeypad = allPreview.filter((entry) => keypadPlan(entry) !== null);
const beyondKeypad = allPreview.filter((entry) => keypadPlan(entry) === null);
const keypadSuccesses = onKeypad.filter((entry) => successResultOf(entry) !== undefined);
const keypadFailures = onKeypad.filter((entry) => errorEnvelopeOf(entry) !== undefined);

describe('the keypad is driven by the contract', () => {
  it('offers a key for every operation the contract defines', () => {
    render(<App client={createPreviewClient()} />);
    for (const spec of operationsFor()) {
      const key = KEYPAD_KEYS.find(
        (entry) => entry.kind === 'operation' && entry.operation === spec.name,
      );
      expect(key, spec.name).toBeDefined();
      expect(
        screen.getByRole('button', { name: key?.ariaLabel ?? '' }),
        spec.name,
      ).toBeInTheDocument();
    }
    expect(operationsFor()).toHaveLength(7);
  });

  it('puts core and advanced operations on the same keypad', () => {
    render(<App client={createPreviewClient()} />);
    for (const spec of operationsFor('advanced')) {
      const key = KEYPAD_KEYS.find(
        (entry) => entry.kind === 'operation' && entry.operation === spec.name,
      );
      expect(screen.getByRole('button', { name: key?.ariaLabel ?? '' }), spec.name).toBeEnabled();
    }
  });

  it.each(operationsFor().map((spec) => [spec.name, spec.arity] as const))(
    'lets %s (arity %d) either fire at once or arm, as its arity dictates',
    async (name, arity) => {
      const user = userEvent.setup();
      const { client, calls } = spyClient();
      render(<App client={client} />);

      await pressKeys(user, ['digit-9']);
      const key = keyById(name);
      if (key.kind !== 'operation') throw new Error(name + ' is not an operation key');
      await pressKeys(user, [name]);

      if (operandsNeeded(key) === 0) {
        await waitFor(() => {
          expect(calls).toHaveLength(1);
        });
        expect(calls[0]?.operation).toBe(name);
        expect(calls[0]?.operands).toHaveLength(arity);
      } else {
        expect(calls).toHaveLength(0);
        expect(screen.getByRole('button', { name: keyName(name) })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      }
    },
  );

  it.each([
    ['add', 'Add', [15, 200]],
    ['subtract', 'Subtract', [15, 200]],
    ['multiply', 'Multiply', [15, 200]],
    ['divide', 'Divide', [15, 200]],
    ['power', 'Power', [15, 200]],
    ['percentage', 'Percent of', [15, 200]],
  ] as const)('sends %s when the %s key completes an entry', async (
    operation,
    _label,
    operands,
  ) => {
    const user = userEvent.setup();
    const { client, calls } = spyClient();
    render(<App client={client} />);

    await pressKeys(user, [
      'digit-1',
      'digit-5',
      operation,
      'digit-2',
      'digit-0',
      'digit-0',
      'equals',
    ]);

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toEqual({ operation, operands: [...operands] });
  });

  it('marks the armed operator with aria-pressed, and only that one', async () => {
    const user = userEvent.setup();
    render(<App client={createPreviewClient()} />);

    expect(screen.getByRole('button', { name: 'Multiply' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await pressKeys(user, ['digit-1', 'digit-2', 'multiply']);
    expect(screen.getByRole('button', { name: 'Multiply' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Add' })).toHaveAttribute('aria-pressed', 'false');
    expect(liveRegion()).toHaveTextContent('12 ×');
  });

  it('does not put aria-pressed on the keys that fire immediately', () => {
    render(<App client={createPreviewClient()} />);
    expect(screen.getByRole('button', { name: 'Square root' })).not.toHaveAttribute('aria-pressed');
    expect(screen.getByRole('button', { name: 'Squared' })).not.toHaveAttribute('aria-pressed');
  });
});

describe('percentage is a binary contract operation, not a local division', () => {
  it('sends percentage [15, 200] for 15 % 200 =', async () => {
    const user = userEvent.setup();
    const { client, calls } = spyClient();
    render(<App client={client} />);

    await pressKeys(user, [
      'digit-1',
      'digit-5',
      'percentage',
      'digit-2',
      'digit-0',
      'digit-0',
      'equals',
    ]);

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toEqual({ operation: 'percentage', operands: [15, 200] });
  });

  it('reads "15 % of" on the expression line and answers with the services 30', async () => {
    const user = userEvent.setup();
    render(<App client={createPreviewClient()} />);

    await pressKeys(user, ['digit-1', 'digit-5', 'percentage']);
    expect(liveRegion()).toHaveTextContent('15 % of');

    await pressKeys(user, ['digit-2', 'digit-0', 'digit-0', 'equals']);
    const expected = successResultOf(caseById('percentage-of-value'));
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(formatResult(expected ?? Number.NaN));
    });
    expect(expected).toBe(30);
  });
});

describe('the keys that would otherwise compute in the browser', () => {
  it('sends x squared as power [n, 2] rather than multiplying', async () => {
    const user = userEvent.setup();
    const { client, calls } = spyClient();
    render(<App client={client} />);

    await pressKeys(user, ['digit-7', 'square']);

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toEqual({ operation: 'power', operands: [7, 2] });
  });

  it('sends sqrt with exactly one operand and nothing stale beside it', async () => {
    const user = userEvent.setup();
    const { client, calls } = spyClient({ kind: 'success', result: 3 });
    render(<App client={client} />);

    await pressKeys(user, ['digit-4', 'clear', 'digit-9', 'sqrt']);

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toEqual({ operation: 'sqrt', operands: [9] });
    expect(calls[0]?.operands).toHaveLength(1);
  });

  it('toggles the sign by editing the display and issues no request', async () => {
    const user = userEvent.setup();
    const { client, calls } = spyClient();
    render(<App client={client} />);

    await pressKeys(user, ['digit-5']);
    await pressKeys(user, ['sign']);
    expect(liveRegion()).toHaveTextContent(MINUS + '5');
    expect(calls).toHaveLength(0);

    await pressKeys(user, ['sign']);
    expect(liveRegion()).toHaveTextContent('5');
    expect(calls).toHaveLength(0);

    await pressKeys(user, ['sign', 'multiply', 'digit-2', 'equals']);
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toEqual({ operation: 'multiply', operands: [-5, 2] });
  });

  it('caps entry at nine digits', async () => {
    const user = userEvent.setup();
    render(<App client={createPreviewClient()} />);

    await pressKeys(user, [
      'digit-1',
      'digit-2',
      'digit-3',
      'digit-4',
      'digit-5',
      'digit-6',
      'digit-7',
      'digit-8',
      'digit-9',
      'digit-0',
    ]);

    expect(liveRegion()).toHaveTextContent('123456789');
    expect(liveRegion()).not.toHaveTextContent('1234567890');
  });
});

describe('every preview operation produces the fixtures expected result', () => {
  it.each(
    keypadSuccesses.map((entry) => [entry.id, entry] as const),
  )('renders %s', async (_id, entry) => {
    const user = userEvent.setup();
    render(<App client={createPreviewClient()} />);
    await runFixture(user, entry);

    const result = successResultOf(entry);
    expect(result).toBeDefined();
    if (result === undefined) return;

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(formatResult(result));
    });
  });

  it('covers all seven operations across those cases', () => {
    expect(new Set(previewSuccesses.map(operationOf))).toEqual(
      new Set(operationsFor().map((operation) => operation.name)),
    );
    expect(new Set(keypadSuccesses.map(operationOf))).toEqual(
      new Set(operationsFor().map((operation) => operation.name)),
    );
  });

  it('asserts the expected number of advanced successes', () => {
    const advanced = previewSuccesses.filter((entry) => entry.milestone === 'advanced');
    const byOperation = (name: string): number =>
      advanced.filter((entry) => operationOf(entry) === name).length;

    expect(byOperation('power')).toBe(8);
    expect(byOperation('sqrt')).toBe(4);
    expect(byOperation('percentage')).toBe(6);
    expect(advanced).toHaveLength(18);
  });
});

describe('fixtures beyond what a keypad can type', () => {
  it('names them, so the gap cannot widen unnoticed', () => {
    expect(beyondKeypad.map((entry) => entry.id)).toEqual([
      'addition-overflow',
      'subtraction-overflow',
      'multiplication-overflow',
      'division-overflow',
      'power-negative-base-fractional-exponent',
      'power-overflow',
      'percentage-large-finite',
      'percentage-overflow',
    ]);
    expect(onKeypad.length + beyondKeypad.length).toBe(allPreview.length);
  });

  it.each(beyondKeypad.map((entry) => [entry.id, entry] as const))(
    'still renders %s when the service returns it',
    async (_id, entry) => {
      const user = userEvent.setup();
      const client: CalculateClient = {
        calculate: () => Promise.resolve(outcomeForCase(entry)),
      };
      render(<App client={client} />);
      await pressKeys(user, ['digit-1', 'add', 'digit-2', 'equals']);

      const envelope = errorEnvelopeOf(entry);
      const result = successResultOf(entry);
      await waitFor(() => {
        expect(liveRegion()).toHaveTextContent(
          envelope === undefined
            ? formatResult(result ?? Number.NaN)
            : errorCopyFor(envelope.code, envelope.message),
        );
      });
    },
  );
});

describe('display formatting through the DOM', () => {
  it('shows 0.1 + 0.2 as its pinned display string, not the raw float', async () => {
    const user = userEvent.setup();
    const entry = caseById('floating-point-addition');
    render(<App client={createPreviewClient()} />);
    await runFixture(user, entry);

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(entry.expectedDisplay ?? '');
    });
    expect(entry.expectedDisplay).toBe('0.3');
  });

  it('offers the exact value alongside a rounded display', async () => {
    const user = userEvent.setup();
    render(<App client={createPreviewClient()} />);
    await runFixture(user, caseById('floating-point-addition'));

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('0.30000000000000004');
    });
    expect(liveRegion()).toHaveTextContent(/Rounded/);
  });

  it('truncates a repeating decimal to twelve significant digits', async () => {
    const user = userEvent.setup();
    const entry = caseById('repeating-decimal');
    render(<App client={createPreviewClient()} />);
    await runFixture(user, entry);

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(entry.expectedDisplay ?? '');
    });
    expect(entry.expectedDisplay).toBe('0.333333333333');
  });

  it('shows sqrt(2) rounded to twelve significant digits', async () => {
    const user = userEvent.setup();
    const entry = caseById('sqrt-irrational');
    render(<App client={createPreviewClient()} />);
    await runFixture(user, entry);

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(entry.expectedDisplay ?? '');
    });
    expect(entry.expectedDisplay).toBe('1.41421356237');
    expect(liveRegion()).toHaveTextContent('1.4142135623730951');
  });

  it('normalises sqrt of negative zero', async () => {
    const user = userEvent.setup();
    const entry = caseById('sqrt-negative-zero');
    render(<App client={createPreviewClient()} />);
    await runFixture(user, entry);

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(entry.expectedDisplay ?? '');
    });
    expect(entry.expectedDisplay).toBe('0');
    expect(liveRegion()).not.toHaveTextContent('-0');
    expect(liveRegion()).not.toHaveTextContent(MINUS + '0');
  });

  it('asserts every expectedDisplay fixture through the DOM, not just as a unit', () => {
    const pinned = previewCases().filter((entry) => entry.expectedDisplay !== undefined);
    expect(pinned.map((entry) => entry.id)).toEqual([
      'normalize-negative-zero',
      'floating-point-addition',
      'repeating-decimal',
      'sqrt-negative-zero',
      'sqrt-irrational',
    ]);
    for (const entry of pinned) {
      expect(keypadPlan(entry), entry.id).not.toBeNull();
    }
  });

  it('normalises negative zero in a product', async () => {
    const user = userEvent.setup();
    const entry = caseById('normalize-negative-zero');
    render(<App client={createPreviewClient()} />);
    await runFixture(user, entry);

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(entry.expectedDisplay ?? '');
    });
    expect(liveRegion()).not.toHaveTextContent('-0');
  });

  it('steps the value down a size as the number grows', async () => {
    const user = userEvent.setup();
    render(<App client={createPreviewClient()} />);

    const value = (): Element => {
      const element = liveRegion().querySelector('.display__value');
      if (element === null) throw new Error('the display has no value line');
      return element;
    };

    await pressKeys(user, ['digit-1', 'digit-2', 'digit-3']);
    expect(value().className).toBe('display__value');

    await pressKeys(user, ['digit-4', 'digit-5', 'digit-6', 'digit-7']);
    expect(value().className).toContain('display__value--md');

    await pressKeys(user, ['decimal', 'digit-8', 'digit-9']);
    expect(value().className).toContain('display__value--sm');
  });
});

describe('error rendering', () => {
  it.each(keypadFailures.map((entry) => [entry.id, entry] as const))(
    'renders %s with the copy its contract code maps to',
    async (_id, entry) => {
      const user = userEvent.setup();
      render(<App client={createPreviewClient()} />);
      await runFixture(user, entry);

      const envelope = errorEnvelopeOf(entry);
      expect(envelope).toBeDefined();
      if (envelope === undefined) return;

      await waitFor(() => {
        expect(liveRegion()).toHaveTextContent(errorCopyFor(envelope.code, envelope.message));
      });
      expect(liveRegion().querySelector('.display__expression')).toHaveTextContent('');
    },
  );

  it('covers division by zero and every overflow case', () => {
    const ids = previewFailures.map((entry) => entry.id);
    expect(ids).toContain('divide-by-zero');
    expect(ids).toContain('divide-by-negative-zero');
    expect(ids).toContain('zero-divided-by-zero');
    expect(ids).toContain('addition-overflow');
    expect(ids).toContain('subtraction-overflow');
    expect(ids).toContain('multiplication-overflow');
    expect(ids).toContain('division-overflow');
  });

  it('covers every advanced arithmetic failure', () => {
    const ids = previewFailures
      .filter((entry) => entry.milestone === 'advanced')
      .map((entry) => entry.id);

    expect(ids).toEqual([
      'power-zero-negative-exponent',
      'power-negative-zero-negative-exponent',
      'power-negative-base-fractional-exponent',
      'power-overflow',
      'sqrt-negative',
      'percentage-overflow',
    ]);
  });

  it('renders each advanced error code the contract defines', () => {
    const codes = new Set(
      previewFailures
        .filter((entry) => entry.milestone === 'advanced')
        .map((entry) => errorEnvelopeOf(entry)?.code),
    );
    expect(codes).toEqual(new Set(['INVALID_POWER', 'NEGATIVE_SQRT', 'NON_FINITE_RESULT']));
  });

  it('frames a 400 as the users problem, not the servers', async () => {
    const user = userEvent.setup();
    render(<App client={createPreviewClient()} />);
    await runFixture(user, caseById('divide-by-zero'));

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(ERROR_COPY.DIVISION_BY_ZERO);
    });
    expect(liveRegion().querySelector('.display__error--user')).not.toBeNull();
    expect(liveRegion().querySelector('.display__error--server')).toBeNull();
    expect(liveRegion()).not.toHaveTextContent(ERROR_COPY.INTERNAL_ERROR);
  });

  it('lets the next keypress dismiss the error', async () => {
    const user = userEvent.setup();
    render(<App client={createPreviewClient()} />);
    await runFixture(user, caseById('divide-by-zero'));
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(ERROR_COPY.DIVISION_BY_ZERO);
    });

    await pressKeys(user, ['digit-7']);
    expect(liveRegion()).not.toHaveTextContent(ERROR_COPY.DIVISION_BY_ZERO);
    expect(liveRegion()).toHaveTextContent('7');
  });

  it('lets the decimal point dismiss the error and start a decimal', async () => {
    const user = userEvent.setup();
    render(<App client={createPreviewClient()} />);
    await runFixture(user, caseById('divide-by-zero'));
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(ERROR_COPY.DIVISION_BY_ZERO);
    });

    await pressKeys(user, ['decimal', 'digit-5']);
    expect(liveRegion()).not.toHaveTextContent(ERROR_COPY.DIVISION_BY_ZERO);
    expect(liveRegion()).toHaveTextContent('0.5');
  });

  it('lets an operator press dismiss the error without acting on it', async () => {
    const user = userEvent.setup();
    const { client, calls } = spyClient({
      kind: 'apiError',
      status: 400,
      error: { code: 'DIVISION_BY_ZERO', message: 'Cannot divide by zero.' },
    });
    render(<App client={client} />);

    await pressKeys(user, ['digit-1', 'divide', 'digit-0', 'equals']);
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(ERROR_COPY.DIVISION_BY_ZERO);
    });

    await pressKeys(user, ['add']);
    expect(liveRegion()).not.toHaveTextContent(ERROR_COPY.DIVISION_BY_ZERO);
    expect(liveRegion()).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: 'Add' })).toHaveAttribute('aria-pressed', 'false');
    expect(calls).toHaveLength(1);
  });
});

describe('injected server fault', () => {
  const faultClient = (): CalculateClient =>
    createPreviewClient({ scenarioId: 'unexpected-server-error' });

  it('renders the 500 in wording distinct from a 400', async () => {
    const user = userEvent.setup();
    render(<App client={faultClient()} />);

    await runFixture(user, caseById('add-positive'));

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(ERROR_COPY.INTERNAL_ERROR);
    });
    expect(liveRegion().querySelector('.display__error--server')).not.toBeNull();
    expect(liveRegion().querySelector('.display__error--user')).toBeNull();
    expect(liveRegion()).not.toHaveTextContent(ERROR_COPY.DIVISION_BY_ZERO);
  });

  it('returns the ordinary 200 for byte-identical input from a healthy client', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<App client={faultClient()} />);

    await runFixture(user, caseById('add-positive'));
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(ERROR_COPY.INTERNAL_ERROR);
    });

    rerender(<App client={createPreviewClient()} />);
    await runFixture(user, caseById('add-positive'));

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(formatResult(12));
    });
    expect(liveRegion()).not.toHaveTextContent(ERROR_COPY.INTERNAL_ERROR);
  });
});

describe('a request is only issued when there is one to issue', () => {
  it('does nothing on equals with no operator armed', async () => {
    const user = userEvent.setup();
    const { client, calls } = spyClient();
    render(<App client={client} />);

    await pressKeys(user, ['digit-9', 'equals']);
    expect(calls).toHaveLength(0);
    expect(liveRegion()).toHaveTextContent('9');
  });

  it('swaps the armed operator when another is pressed before the second operand', async () => {
    const user = userEvent.setup();
    const { client, calls } = spyClient();
    render(<App client={client} />);

    await pressKeys(user, ['digit-5', 'add', 'multiply']);
    expect(liveRegion()).toHaveTextContent('5 ×');
    expect(screen.getByRole('button', { name: 'Multiply' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Add' })).toHaveAttribute('aria-pressed', 'false');
    expect(calls).toHaveLength(0);

    await pressKeys(user, ['digit-4', 'equals']);
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toEqual({ operation: 'multiply', operands: [5, 4] });
  });

  it('starts a fresh entry when a digit follows a result', async () => {
    const user = userEvent.setup();
    const { client } = spyClient({ kind: 'success', result: 20 });
    render(<App client={client} />);

    await pressKeys(user, ['digit-5', 'multiply', 'digit-4', 'equals']);
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('20');
    });

    await pressKeys(user, ['digit-7']);
    expect(liveRegion()).toHaveTextContent('7');
    expect(liveRegion()).not.toHaveTextContent('20');
  });

  it.each([
    ['the decimal point starts a fresh decimal', ['decimal'], '0.'],
    ['Clear returns to zero', ['clear'], '0'],
  ] as const)('after a result, %s', async (_label, keys, expected) => {
    const user = userEvent.setup();
    const { client } = spyClient({ kind: 'success', result: 20 });
    render(<App client={client} />);

    await pressKeys(user, ['digit-5', 'multiply', 'digit-4', 'equals']);
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('20');
    });

    await pressKeys(user, [...keys]);
    expect(liveRegion()).toHaveTextContent(expected);
    expect(liveRegion()).not.toHaveTextContent('20');
  });

  it('clears a result on Backspace rather than editing it', async () => {
    const user = userEvent.setup();
    const { client } = spyClient({ kind: 'success', result: 20 });
    render(<App client={client} />);

    await pressKeys(user, ['digit-5', 'multiply', 'digit-4', 'equals']);
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('20');
    });

    await user.keyboard('{Backspace}');
    expect(liveRegion()).toHaveTextContent('0');
    expect(liveRegion()).not.toHaveTextContent('20');
  });

  it('leaves a result alone when the sign key is pressed', async () => {
    const user = userEvent.setup();
    const { client, calls } = spyClient({ kind: 'success', result: 20 });
    render(<App client={client} />);

    await pressKeys(user, ['digit-5', 'multiply', 'digit-4', 'equals']);
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('20');
    });

    await pressKeys(user, ['sign']);
    expect(liveRegion()).toHaveTextContent('20');
    expect(liveRegion()).not.toHaveTextContent(MINUS + '20');
    expect(calls).toHaveLength(1);
  });
});

describe('a result starts the next operation', () => {
  it('makes the answer the left operand, one operation at a time', async () => {
    const user = userEvent.setup();
    const { client, calls } = scriptedClient([20, 23, 11.5]);
    render(<App client={client} />);

    await pressKeys(user, ['digit-5', 'multiply', 'digit-4', 'equals']);
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('20');
    });

    await pressKeys(user, ['add']);
    expect(liveRegion()).toHaveTextContent('20 +');

    await pressKeys(user, ['digit-3', 'equals']);
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('23');
    });

    await pressKeys(user, ['divide', 'digit-2', 'equals']);
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('11.5');
    });

    expect(calls).toEqual([
      { operation: 'multiply', operands: [5, 4] },
      { operation: 'add', operands: [20, 3] },
      { operation: 'divide', operands: [23, 2] },
    ]);
  });

  it('sends the raw result, not the rounded text standing in for it', async () => {
    const user = userEvent.setup();
    const { client, calls } = scriptedClient([1 / 3, 1]);
    render(<App client={client} />);

    await pressKeys(user, ['digit-1', 'divide', 'digit-3', 'equals']);
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('0.333333333333');
    });

    await pressKeys(user, ['multiply', 'digit-3', 'equals']);
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });

    expect(calls[1]).toEqual({ operation: 'multiply', operands: [1 / 3, 3] });
    expect(calls[1]?.operands[0]).not.toBe(0.333333333333);
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('1');
    });
  });

  it('continues from a result with a key that fires immediately', async () => {
    const user = userEvent.setup();
    const { client, calls } = scriptedClient([2, 4]);
    render(<App client={client} />);

    await pressKeys(user, ['digit-1', 'add', 'digit-1', 'equals']);
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('2');
    });

    await pressKeys(user, ['square']);
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls[1]).toEqual({ operation: 'power', operands: [2, 2] });
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('4');
    });
  });

  it('disables every operation key once the second operand is typed', async () => {
    const user = userEvent.setup();
    const { client, calls } = spyClient();
    render(<App client={client} />);

    await pressKeys(user, ['digit-2', 'add']);
    for (const key of operationKeys()) {
      expect(screen.getByRole('button', { name: keyName(key.id) }), key.id).toBeEnabled();
    }

    await pressKeys(user, ['digit-3']);
    for (const key of operationKeys()) {
      expect(screen.getByRole('button', { name: keyName(key.id) }), key.id).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Equals' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
    expect(calls).toHaveLength(0);
  });

  it('lets a unary key replace an armed operation and fire on the left operand', async () => {
    const user = userEvent.setup();
    const { client, calls } = scriptedClient([25]);
    render(<App client={client} />);

    await pressKeys(user, ['digit-5', 'power']);
    expect(liveRegion()).toHaveTextContent('5 ^');
    expect(screen.getByRole('button', { name: 'Squared' })).toBeEnabled();

    await pressKeys(user, ['square']);
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toEqual({ operation: 'power', operands: [5, 2] });
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('25');
    });
    expect(liveRegion()).not.toHaveTextContent('5 ^');
  });

  it('refuses a second operation from the physical keyboard as well', async () => {
    const user = userEvent.setup();
    const { client, calls } = spyClient();
    render(<App client={client} />);

    await pressKeys(user, ['digit-2', 'add', 'digit-3']);
    await user.keyboard('*');

    expect(liveRegion()).toHaveTextContent('2 +');
    expect(screen.getByRole('button', { name: 'Multiply' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(calls).toHaveLength(0);
  });

  it('reopens the operation keys once the answer is on screen', async () => {
    const user = userEvent.setup();
    const { client } = scriptedClient([5]);
    render(<App client={client} />);

    await pressKeys(user, ['digit-2', 'add', 'digit-3']);
    expect(screen.getByRole('button', { name: 'Multiply' })).toBeDisabled();

    await pressKeys(user, ['equals']);
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('5');
    });
    for (const key of operationKeys()) {
      expect(screen.getByRole('button', { name: keyName(key.id) }), key.id).toBeEnabled();
    }
  });
});

describe('loading state', () => {
  function deferredClient(): {
    client: CalculateClient;
    resolve: (outcome: CalculateOutcome) => void;
    calls: number;
  } {
    let release: ((outcome: CalculateOutcome) => void) | null = null;
    const state = { calls: 0 };
    const client: CalculateClient = {
      calculate(): Promise<CalculateOutcome> {
        state.calls += 1;
        return new Promise<CalculateOutcome>((resolveOutcome) => {
          release = resolveOutcome;
        });
      },
    };
    return {
      client,
      get calls() {
        return state.calls;
      },
      resolve: (outcome) => {
        if (release === null) throw new Error('no request in flight');
        release(outcome);
      },
    };
  }

  it('disables the keypad while a request is in flight and prevents a second one', async () => {
    const user = userEvent.setup();
    const deferred = deferredClient();
    render(<App client={deferred.client} />);

    await pressKeys(user, ['digit-1', 'digit-0', 'add', 'digit-2', 'equals']);

    const equals = screen.getByRole('button', { name: 'Equals' });
    await waitFor(() => {
      expect(equals).toBeDisabled();
    });
    expect(screen.getByRole('button', { name: '7' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
    expect(liveRegion()).toHaveAttribute('aria-busy', 'true');

    await user.click(equals);
    expect(deferred.calls).toBe(1);

    await user.keyboard('{Backspace}');
    expect(liveRegion()).toHaveTextContent('2');

    deferred.resolve({ kind: 'success', result: 12 });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Equals' })).toBeEnabled();
    });
    expect(liveRegion()).toHaveTextContent('12');
    expect(liveRegion()).toHaveAttribute('aria-busy', 'false');
  });

  it('ignores a response that arrives after Clear', async () => {
    const user = userEvent.setup();
    const deferred = deferredClient();
    render(<App client={deferred.client} />);

    await pressKeys(user, ['digit-1', 'digit-0', 'add', 'digit-2', 'equals']);
    await waitFor(() => {
      expect(liveRegion()).toHaveAttribute('aria-busy', 'true');
    });

    await user.keyboard('5{Backspace}{Enter}');
    expect(deferred.calls).toBe(1);
    expect(liveRegion()).not.toHaveTextContent('5');

    await pressKeys(user, ['clear']);
    deferred.resolve({ kind: 'success', result: 12 });

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('0');
    });
    expect(liveRegion()).not.toHaveTextContent('12');
  });
});

describe('the live region', () => {
  it('is a polite, atomic status region that survives state changes', async () => {
    const user = userEvent.setup();
    render(<App client={createPreviewClient()} />);

    const region = liveRegion();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).toHaveAccessibleName('Calculator display');

    await runFixture(user, caseById('add-positive'));
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('12');
    });

    expect(liveRegion()).toBe(region);
  });

  it('announces both a result and, afterwards, an error', async () => {
    const user = userEvent.setup();
    render(<App client={createPreviewClient()} />);

    await runFixture(user, caseById('divide-positive'));
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(formatResult(5));
    });

    await runFixture(user, caseById('divide-by-zero'));
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(ERROR_COPY.DIVISION_BY_ZERO);
    });
    expect(liveRegion()).not.toHaveTextContent(/^5$/);
  });
});

describe('keyboard and focus', () => {
  it('accepts digits, operators and Enter from the physical keyboard', async () => {
    const user = userEvent.setup();
    const { client, calls } = spyClient({ kind: 'success', result: 12 });
    render(<App client={client} />);

    await user.keyboard('10+2{Enter}');

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toEqual({ operation: 'add', operands: [10, 2] });
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('12');
    });
  });

  it.each([
    ['*', 'multiply', [6, 2]],
    ['/', 'divide', [6, 2]],
    ['-', 'subtract', [6, 2]],
    ['^', 'power', [6, 2]],
    ['%', 'percentage', [6, 2]],
  ] as const)('maps "%s" to the %s operation', async (character, operation, operands) => {
    const user = userEvent.setup();
    const { client, calls } = spyClient();
    render(<App client={client} />);

    await user.keyboard('6' + character + '2=');

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toEqual({ operation, operands: [...operands] });
  });

  it('types a decimal point, clears on Escape and deletes on Backspace', async () => {
    const user = userEvent.setup();
    const { client, calls } = spyClient();
    render(<App client={client} />);

    await user.keyboard('1.25');
    expect(liveRegion()).toHaveTextContent('1.25');

    await user.keyboard('{Backspace}');
    expect(liveRegion()).toHaveTextContent('1.2');

    await user.keyboard('{Escape}');
    expect(liveRegion()).toHaveTextContent('0');
    expect(calls).toHaveLength(0);
  });

  it('leaves browser shortcuts alone', async () => {
    const user = userEvent.setup();
    const { client, calls } = spyClient();
    render(<App client={client} />);

    await user.keyboard('{Control>}/{/Control}');
    await user.keyboard('{Alt>}5{/Alt}');
    expect(liveRegion()).toHaveTextContent('0');
    expect(calls).toHaveLength(0);
  });

  it('reaches every key by keyboard alone', async () => {
    const user = userEvent.setup();
    const { client, calls } = spyClient();
    render(<App client={client} />);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Square root' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Squared' })).toHaveFocus();

    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toEqual({ operation: 'power', operands: [0, 2] });
  });

  it('uses real buttons and real labels throughout', () => {
    render(<App client={createPreviewClient()} />);

    const names = [
      'Add',
      'Subtract',
      'Multiply',
      'Divide',
      'Equals',
      'Square root',
      'Squared',
      'Power',
      'Percent of',
      'Toggle sign',
      'Clear',
      'Decimal point',
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ];
    for (const name of names) {
      expect(screen.getByRole('button', { name }).tagName, name).toBe('BUTTON');
    }
    expect(screen.getAllByRole('button')).toHaveLength(KEYPAD_KEYS.length);
    expect(screen.getAllByRole('button')).toHaveLength(names.length);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAccessibleName();
    }
    expect(screen.getByRole('group', { name: 'Calculator keypad' })).toBeInTheDocument();
  });
});

describe('Clear', () => {
  it('is AC when pristine and C once there is something to clear', async () => {
    const user = userEvent.setup();
    render(<App client={createPreviewClient()} />);

    const clear = (): HTMLElement => screen.getByRole('button', { name: 'Clear' });
    expect(clear()).toHaveTextContent('AC');

    await pressKeys(user, ['digit-9']);
    expect(clear()).toHaveTextContent('C');

    await pressKeys(user, ['clear']);
    expect(clear()).toHaveTextContent('AC');
  });

  it('returns the display to zero and drops the armed operator', async () => {
    const user = userEvent.setup();
    render(<App client={createPreviewClient()} />);

    await runFixture(user, caseById('add-positive'));
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('12');
    });

    await pressKeys(user, ['digit-1', 'add', 'clear']);

    expect(liveRegion()).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: 'Add' })).toHaveAttribute('aria-pressed', 'false');
    expect(liveRegion()).not.toHaveTextContent('12');
  });
});

describe('failure states are rendered honestly', () => {
  it('says an unmatched calculation is unavailable rather than computing it', async () => {
    const user = userEvent.setup();
    render(<App client={createPreviewClient()} />);

    await pressKeys(user, ['digit-4', 'digit-1', 'add', 'digit-1', 'equals']);

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(PREVIEW_UNAVAILABLE_MESSAGE);
    });
    expect(liveRegion().querySelector('.display__error--preview')).not.toBeNull();
    expect(liveRegion()).not.toHaveTextContent('42');
  });

  it('renders a transport failure reported by the client', async () => {
    const user = userEvent.setup();
    const client: CalculateClient = {
      calculate: () =>
        Promise.resolve({ kind: 'transportError', message: 'Could not reach the service.' }),
    };
    render(<App client={client} />);

    await pressKeys(user, ['digit-1', 'add', 'digit-2', 'equals']);

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('Could not reach the service.');
    });
    expect(liveRegion().querySelector('.display__error--server')).not.toBeNull();
    expect(liveRegion().querySelector('.display__error--user')).toBeNull();
  });

  it('tells the user the service is unreachable when fetch rejects', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    ) as unknown as typeof fetch;
    render(<App client={createHttpClient({ fetchImpl })} />);

    await pressKeys(user, ['digit-1', 'digit-0', 'add', 'digit-2', 'equals']);

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('Could not reach the calculator service.');
    });
    expect(liveRegion()).toHaveTextContent('Failed to fetch');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('button', { name: 'Equals' })).toBeEnabled();
  });

  it('recovers once the service comes back', async () => {
    const user = userEvent.setup();
    const entry = caseById('add-positive');
    let healthy = false;
    const fetchImpl = vi.fn(() =>
      healthy
        ? Promise.resolve(new Response(JSON.stringify(entry.expected.body), { status: 200 }))
        : Promise.reject(new TypeError('Failed to fetch')),
    ) as unknown as typeof fetch;
    render(<App client={createHttpClient({ fetchImpl })} />);

    await runFixture(user, entry);
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('Could not reach the calculator service.');
    });

    healthy = true;
    await runFixture(user, entry);
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(formatResult(successResultOf(entry) ?? Number.NaN));
    });
    expect(liveRegion()).not.toHaveTextContent('Could not reach the calculator service.');
  });

  it('surfaces a client that throws as a rendered error, not a blank screen', async () => {
    const user = userEvent.setup();
    const client: CalculateClient = {
      calculate: vi.fn(() => Promise.reject(new Error('boom'))),
    };
    render(<App client={client} />);

    await pressKeys(user, ['digit-1', 'add', 'digit-2', 'equals']);

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('boom');
    });
  });
});

describe('timeout recovery through the real HTTP client', () => {
  it('announces a timeout, reenables the keypad, and allows retrying the same input', async () => {
    const user = userEvent.setup();
    const entry = caseById('add-positive');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce((_input, init) => {
        const signal = init?.signal;
        if (signal == null) throw new Error('fetch must receive an abort signal');
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      })
      .mockResolvedValueOnce(
        new Response(JSON.stringify(entry.expected.body), { status: entry.expected.status }),
      );
    render(<App client={createHttpClient({ fetchImpl })} />);

    const plan = keypadPlan(entry);
    if (plan === null) throw new Error('add-positive must be enterable on the keypad');
    await pressKeys(user, plan.slice(0, -1));

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Equals' }));
      expect(screen.getByRole('button', { name: 'Equals' })).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      });
      expect(liveRegion()).toHaveTextContent(HTTP_CLIENT_MESSAGES.requestTimedOut);
      expect(screen.getByRole('button', { name: 'Equals' })).toBeEnabled();
      expect(screen.getByRole('button', { name: '7' })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }

    await runFixture(user, entry);
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(String(successResultOf(entry)));
    });
    expect(liveRegion()).not.toHaveTextContent(HTTP_CLIENT_MESSAGES.requestTimedOut);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
