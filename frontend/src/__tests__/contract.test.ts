import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../api/types';
import {
  displayPinnedCases,
  errorEnvelopeOf,
  findOperation,
  fixtures,
  operationsFor,
  previewCases,
  successResultOf,
  caseById,
} from '../contract/fixtures';

describe('contract/fixtures.json', () => {
  it('is the schema version this app was written for', () => {
    expect(fixtures.schemaVersion).toBe(1);
  });

  it('parses every case in the file', () => {
    expect(fixtures.cases.length).toBe(80);
    expect(previewCases().length).toBe(44);
  });

  it('defines exactly the four core operations, in contract order', () => {
    expect(operationsFor('core').map((operation) => operation.name)).toEqual([
      'add',
      'subtract',
      'multiply',
      'divide',
    ]);
  });

  it('gives every core operation arity 2 and a label per operand', () => {
    for (const operation of operationsFor('core')) {
      expect(operation.arity).toBe(2);
      expect(operation.operandLabels).toHaveLength(operation.arity);
    }
  });

  it('keeps divide labelled Dividend/Divisor, not generic operand names', () => {
    expect(findOperation('divide')?.operandLabels).toEqual(['Dividend', 'Divisor']);
    expect(findOperation('add')?.operandLabels).toEqual(['First number', 'Second number']);
  });

  it('defines the advanced operations, sqrt being the only unary one', () => {
    expect(operationsFor('advanced').map((operation) => operation.name)).toEqual([
      'power',
      'sqrt',
      'percentage',
    ]);
    expect(findOperation('sqrt')?.arity).toBe(1);
    expect(findOperation('sqrt')?.operandLabels).toEqual(['Number']);
    expect(findOperation('percentage')?.operandLabels).toEqual(['Percentage', 'Of value']);
    expect(findOperation('power')?.operandLabels).toEqual(['Base', 'Exponent']);
  });

  it('offers all seven operations, with sqrt the only arity-1 case', () => {
    expect(operationsFor()).toHaveLength(7);
    expect(
      operationsFor()
        .filter((operation) => operation.arity === 1)
        .map((operation) => operation.name),
    ).toEqual(['sqrt']);
    for (const operation of operationsFor()) {
      expect(operation.operandLabels, operation.name).toHaveLength(operation.arity);
    }
  });

  it('pins display formatting with exactly five cases', () => {
    expect(displayPinnedCases().map((entry) => entry.id)).toEqual([
      'normalize-negative-zero',
      'floating-point-addition',
      'repeating-decimal',
      'sqrt-negative-zero',
      'sqrt-irrational',
    ]);
  });

  it('agrees with the ErrorCode union mirrored from the Go structs', () => {
    expect([...ERROR_CODES].sort()).toEqual(Object.keys(fixtures.errors).sort());
  });

  it('uses one error envelope for 400 and 500 alike', () => {
    const failures = fixtures.cases.filter((entry) => entry.expected.status >= 400);
    expect(failures.length).toBeGreaterThan(0);
    for (const failure of failures) {
      const envelope = errorEnvelopeOf(failure);
      expect(envelope, failure.id).toBeDefined();
      expect(envelope?.message).toBe(fixtures.errors[envelope?.code ?? '']);
    }
  });

  it('exposes exactly one injected server fault, unreachable by ordinary input', () => {
    const faults = fixtures.cases.filter((entry) => entry.testFault !== undefined);
    expect(faults.map((entry) => entry.id)).toEqual(['unexpected-server-error']);

    const fault = caseById('unexpected-server-error');
    const success = caseById('add-positive');
    expect(fault.request.body).toBe(success.request.body);
    expect(fault.expected.status).toBe(500);
    expect(successResultOf(success)).toBe(12);
  });

  it('reports a helpful path when a case id does not exist', () => {
    expect(() => caseById('no-such-case')).toThrow(/no case with id "no-such-case"/);
  });
});
