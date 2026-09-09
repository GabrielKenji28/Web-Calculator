import rawFixtures from '@contract/fixtures.json';

/**
 * Typed loader for the frozen `contract/fixtures.json`.
 *
 * The JSON arrives as `unknown` (see `src/vite-env.d.ts`) and is validated here
 * once, at module load. Anything malformed throws immediately with the offending
 * path, so contract drift surfaces as a loud failure rather than a subtly wrong
 * screen. Nothing below uses `any` or a non-null assertion.
 */

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
  /** True for cases the typed UI can actually produce. */
  readonly preview: boolean;
  readonly request: FixtureRequest;
  readonly expected: FixtureExpectation;
  /** Present on the five cases that pin display formatting. */
  readonly expectedDisplay: string | undefined;
  /** Test-only scenario marker. Must never reach an HTTP request. */
  readonly testFault: string | undefined;
}

export interface FixtureFile {
  readonly schemaVersion: number;
  readonly operations: readonly OperationSpec[];
  readonly numberPolicy: NumberPolicy;
  readonly errors: Readonly<Record<string, string>>;
  readonly cases: readonly FixtureCase[];
}

/* -------------------------------------------------------------------------- */
/* Structural validation                                                       */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Accessors                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Operations in the order the contract lists them; all of them when no
 * milestone is given. Mirrors `previewCases(milestone?)`.
 */
export function operationsFor(milestone?: Milestone): readonly OperationSpec[] {
  return fixtures.operations.filter(
    (operation) => milestone === undefined || operation.milestone === milestone,
  );
}

export function findOperation(name: string): OperationSpec | undefined {
  return fixtures.operations.find((operation) => operation.name === name);
}

/** Cases the typed UI can produce, optionally narrowed to one milestone. */
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

/** The cases that pin display formatting via `expectedDisplay`. */
export function displayPinnedCases(): readonly FixtureCase[] {
  return fixtures.cases.filter((entry) => entry.expectedDisplay !== undefined);
}

/** The numeric `result` of a success case, or undefined if it is not one. */
export function successResultOf(entry: FixtureCase): number | undefined {
  const body = entry.expected.body;
  if (typeof body !== 'object' || body === null) return undefined;
  const result = (body as Record<string, unknown>)['result'];
  return typeof result === 'number' ? result : undefined;
}

/** The `{code, message}` envelope of a failure case, or undefined. */
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
