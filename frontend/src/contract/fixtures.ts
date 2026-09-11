import rawFixtures from '@contract/fixtures.json';

export type Milestone = 'core' | 'advanced';

export interface OperationSpec {
  readonly name: string;
  readonly arity: number;
  readonly milestone: Milestone;
  readonly operandLabels: readonly string[];
}

export interface NumberPolicy {
  readonly representation: string;
  readonly displaySignificantDigits: number;
  readonly normalizeNegativeZero: boolean;
}

export interface FixtureRequest {
  readonly method: string;
  readonly path: string;
  readonly body: string;
}

export interface FixtureExpectation {
  readonly status: number;
  readonly body: unknown;
}

export interface FixtureCase {
  readonly id: string;
  readonly milestone: Milestone;
  readonly preview: boolean;
  readonly request: FixtureRequest;
  readonly expected: FixtureExpectation;
  readonly expectedDisplay: string | undefined;
  // Test-only scenario marker. Must never reach an HTTP request.
  readonly testFault: string | undefined;
}

export interface FixtureFile {
  readonly schemaVersion: number;
  readonly operations: readonly OperationSpec[];
  readonly numberPolicy: NumberPolicy;
  readonly errors: Readonly<Record<string, string>>;
  readonly cases: readonly FixtureCase[];
}

function invalid(path: string, expectation: string): never {
  throw new Error('contract/fixtures.json: ' + path + ' must be ' + expectation);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(path, 'an object');
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) return invalid(path, 'an array');
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string') return invalid(path, 'a string');
  return value;
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return invalid(path, 'a finite number');
  }
  return value;
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') return invalid(path, 'a boolean');
  return value;
}

function asOptionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, path);
}

function asMilestone(value: unknown, path: string): Milestone {
  const text = asString(value, path);
  if (text !== 'core' && text !== 'advanced') {
    return invalid(path, '"core" or "advanced"');
  }
  return text;
}

function parseOperation(value: unknown, path: string): OperationSpec {
  const record = asRecord(value, path);
  const labels = asArray(record['operandLabels'], path + '.operandLabels').map((label, index) =>
    asString(label, path + '.operandLabels[' + index + ']'),
  );
  const arity = asNumber(record['arity'], path + '.arity');
  if (labels.length !== arity) {
    return invalid(path + '.operandLabels', 'exactly ' + arity + ' entries to match arity');
  }
  return {
    name: asString(record['name'], path + '.name'),
    arity,
    milestone: asMilestone(record['milestone'], path + '.milestone'),
    operandLabels: labels,
  };
}

function parseCase(value: unknown, path: string): FixtureCase {
  const record = asRecord(value, path);
  const request = asRecord(record['request'], path + '.request');
  const expected = asRecord(record['expected'], path + '.expected');
  return {
    id: asString(record['id'], path + '.id'),
    milestone: asMilestone(record['milestone'], path + '.milestone'),
    preview: asBoolean(record['preview'], path + '.preview'),
    request: {
      method: asString(request['method'], path + '.request.method'),
      path: asString(request['path'], path + '.request.path'),
      body: asString(request['body'], path + '.request.body'),
    },
    expected: {
      status: asNumber(expected['status'], path + '.expected.status'),
      body: expected['body'],
    },
    expectedDisplay: asOptionalString(record['expectedDisplay'], path + '.expectedDisplay'),
    testFault: asOptionalString(record['testFault'], path + '.testFault'),
  };
}

function parseFixtureFile(value: unknown): FixtureFile {
  const root = asRecord(value, 'root');
  const policy = asRecord(root['numberPolicy'], 'numberPolicy');
  const errorsRecord = asRecord(root['errors'], 'errors');

  const errors: Record<string, string> = {};
  for (const [code, message] of Object.entries(errorsRecord)) {
    errors[code] = asString(message, 'errors.' + code);
  }

  return {
    schemaVersion: asNumber(root['schemaVersion'], 'schemaVersion'),
    operations: asArray(root['operations'], 'operations').map((operation, index) =>
      parseOperation(operation, 'operations[' + index + ']'),
    ),
    numberPolicy: {
      representation: asString(policy['representation'], 'numberPolicy.representation'),
      displaySignificantDigits: asNumber(
        policy['displaySignificantDigits'],
        'numberPolicy.displaySignificantDigits',
      ),
      normalizeNegativeZero: asBoolean(
        policy['normalizeNegativeZero'],
        'numberPolicy.normalizeNegativeZero',
      ),
    },
    errors,
    cases: asArray(root['cases'], 'cases').map((entry, index) =>
      parseCase(entry, 'cases[' + index + ']'),
    ),
  };
}

export const fixtures: FixtureFile = parseFixtureFile(rawFixtures);

export const numberPolicy: NumberPolicy = fixtures.numberPolicy;

export function operationsFor(milestone?: Milestone): readonly OperationSpec[] {
  return fixtures.operations.filter(
    (operation) => milestone === undefined || operation.milestone === milestone,
  );
}

export function findOperation(name: string): OperationSpec | undefined {
  return fixtures.operations.find((operation) => operation.name === name);
}

export function previewCases(milestone?: Milestone): readonly FixtureCase[] {
  return fixtures.cases.filter(
    (entry) => entry.preview && (milestone === undefined || entry.milestone === milestone),
  );
}

export function caseById(id: string): FixtureCase {
  const found = fixtures.cases.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error('contract/fixtures.json: no case with id "' + id + '"');
  }
  return found;
}

export function displayPinnedCases(): readonly FixtureCase[] {
  return fixtures.cases.filter((entry) => entry.expectedDisplay !== undefined);
}

export function successResultOf(entry: FixtureCase): number | undefined {
  const body = entry.expected.body;
  if (typeof body !== 'object' || body === null) return undefined;
  const result = (body as Record<string, unknown>)['result'];
  return typeof result === 'number' ? result : undefined;
}

export function errorEnvelopeOf(
  entry: FixtureCase,
): { readonly code: string; readonly message: string } | undefined {
  const body = entry.expected.body;
  if (typeof body !== 'object' || body === null) return undefined;
  const error = (body as Record<string, unknown>)['error'];
  if (typeof error !== 'object' || error === null) return undefined;
  const record = error as Record<string, unknown>;
  const code = record['code'];
  const message = record['message'];
  if (typeof code !== 'string' || typeof message !== 'string') return undefined;
  return { code, message };
}

export interface FixtureCall {
  readonly operation: string;
  readonly operands: readonly number[];
}

export function parseCalculateBody(body: string): FixtureCall | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;

  const record = parsed as Record<string, unknown>;
  const operation = record['operation'];
  const operands = record['operands'];
  if (typeof operation !== 'string' || !Array.isArray(operands)) return undefined;

  const numbers: number[] = [];
  for (const operand of operands) {
    if (typeof operand !== 'number' || !Number.isFinite(operand)) return undefined;
    numbers.push(operand);
  }

  return { operation, operands: numbers };
}
