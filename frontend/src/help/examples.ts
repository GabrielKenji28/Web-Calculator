import {
  errorEnvelopeOf,
  findOperation,
  parseCalculateBody,
  previewCases,
  successResultOf,
  type FixtureCall,
  type FixtureCase,
} from '../contract/fixtures';
import { errorCopyFor } from '../format/errorCopy';
import { formatResult } from '../format/display';
import { MINUS, operationKeys, type OperationKey } from '../keypad/keys';

// Every string below is derived from contract/fixtures.json, so a worked example
// in the UI cannot drift from what the service actually answers. A key that
// resolves no example throws at import, the same fail-loud contract check
// assertContractCoverage() makes in keys.ts.

export interface HelpRow {
  readonly keyId: string;
  readonly glyph: string;
  readonly label: string;
  readonly operandLabels: readonly string[];
  readonly example: string;
  readonly caseId: string;
}

export interface HelpFailure {
  readonly code: string;
  readonly copy: string;
  readonly example: string;
  readonly caseId: string;
}

function numeral(value: number): string {
  const text = formatResult(value);
  return text.startsWith('-') ? MINUS + text.slice(1) : text;
}

function operandText(value: number): string {
  const text = numeral(value);
  return text.startsWith(MINUS) ? '(' + text + ')' : text;
}

function expressionFor(key: OperationKey, operands: readonly number[]): string {
  const first = operandText(operands[0] ?? 0);

  if (key.fixedOperands.length > 0) return first + key.expressionGlyph;
  if (operands.length === 1) return key.expressionGlyph + first;
  return first + ' ' + key.expressionGlyph + ' ' + operandText(operands[1] ?? 0);
}

function callOf(entry: FixtureCase): FixtureCall | undefined {
  if (entry.testFault !== undefined) return undefined;
  if (entry.request.method !== 'POST') return undefined;
  return parseCalculateBody(entry.request.body);
}

function matchesKey(call: FixtureCall, key: OperationKey, arity: number): boolean {
  if (call.operation !== key.operation) return false;
  if (call.operands.length !== arity) return false;

  const tail = call.operands.slice(arity - key.fixedOperands.length);
  return key.fixedOperands.every((fixed, index) => Object.is(tail[index], fixed));
}

function keyForOperation(operation: string): OperationKey | undefined {
  const candidates = operationKeys().filter((key) => key.operation === operation);
  return candidates.find((key) => key.fixedOperands.length === 0) ?? candidates[0];
}

export function helpRows(cases: readonly FixtureCase[] = previewCases()): readonly HelpRow[] {
  return operationKeys().map((key) => {
    const spec = findOperation(key.operation);
    if (spec === undefined) {
      throw new Error('contract/fixtures.json defines no operation named "' + key.operation + '"');
    }

    for (const entry of cases) {
      if (entry.expected.status !== 200) continue;

      const call = callOf(entry);
      if (call === undefined || !matchesKey(call, key, spec.arity)) continue;

      const result = successResultOf(entry);
      if (result === undefined) continue;

      return {
        keyId: key.id,
        glyph: key.glyph,
        label: key.ariaLabel ?? key.glyph,
        operandLabels: spec.operandLabels.slice(0, spec.arity - key.fixedOperands.length),
        example: expressionFor(key, call.operands) + ' = ' + formatResult(result),
        caseId: entry.id,
      };
    }

    throw new Error('contract/fixtures.json has no preview example for keypad key "' + key.id + '"');
  });
}

export function helpFailures(cases: readonly FixtureCase[] = previewCases()): readonly HelpFailure[] {
  const failures: HelpFailure[] = [];
  const seen = new Set<string>();

  for (const entry of cases) {
    const envelope = errorEnvelopeOf(entry);
    if (envelope === undefined || seen.has(envelope.code)) continue;

    const call = callOf(entry);
    if (call === undefined) continue;

    // Skip codes no key can reach: the keypad cannot send a malformed body or
    // an operation it has no button for.
    const key = keyForOperation(call.operation);
    if (key === undefined) continue;

    seen.add(envelope.code);
    failures.push({
      code: envelope.code,
      copy: errorCopyFor(envelope.code, envelope.message),
      example: expressionFor(key, call.operands),
      caseId: entry.id,
    });
  }

  if (failures.length === 0) {
    throw new Error('contract/fixtures.json has no reachable preview error cases');
  }
  return failures;
}
