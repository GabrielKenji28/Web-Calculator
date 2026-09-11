import {
  caseById,
  errorEnvelopeOf,
  previewCases,
  successResultOf,
  type FixtureCase,
  type Milestone,
} from '../contract/fixtures';
import type { CalculateClient } from '../api/client';
import {
  serializeCalculateRequest,
  type CalculateOutcome,
  type CalculateRequest,
} from '../api/types';

// Fixture-backed CalculateClient, for tests only — nothing under src/api,
// src/components, src/hooks or src/App.tsx imports it.
//
// Both sides of a match are canonicalised through serializeCalculateRequest,
// because the fixtures store hand-written JSON literals that JSON.stringify
// does not reproduce byte-for-byte (-0 serialises as 0, 1e308 as 1e+308);
// comparing raw strings would strand every overflow case.

export const PREVIEW_UNAVAILABLE_MESSAGE =
  'That calculation is not available in the fixture preview. This build answers only from the ' +
  'frozen contract fixtures and never computes results itself, so try one of the fixture inputs ' +
  'or wait for the live service.';

export interface PreviewScenario {
  readonly id: string;
  readonly label: string;
  readonly fault: string;
}

interface ParsedRequestBody {
  readonly request: CalculateRequest;
  readonly canonical: string;
}

export function parseFixtureRequestBody(body: string): ParsedRequestBody | undefined {
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

  const request: CalculateRequest = { operation, operands: numbers };
  return { request, canonical: serializeCalculateRequest(request) };
}

export function outcomeForCase(entry: FixtureCase): CalculateOutcome {
  const envelope = errorEnvelopeOf(entry);
  if (envelope !== undefined) {
    return { kind: 'apiError', status: entry.expected.status, error: envelope };
  }
  const result = successResultOf(entry);
  if (result !== undefined && entry.expected.status === 200) {
    return { kind: 'success', result };
  }
  throw new Error(
    'contract/fixtures.json: case "' + entry.id + '" is neither a result nor an error envelope',
  );
}

function outcomeSignature(entry: FixtureCase): string {
  return entry.expected.status + '|' + JSON.stringify(entry.expected.body);
}

export function buildPreviewIndex(): ReadonlyMap<string, FixtureCase> {
  const index = new Map<string, FixtureCase>();

  for (const entry of previewCases()) {
    if (entry.request.method !== 'POST') continue;
    if (entry.testFault !== undefined) continue;

    const parsed = parseFixtureRequestBody(entry.request.body);
    if (parsed === undefined) {
      throw new Error(
        'contract/fixtures.json: case "' +
          entry.id +
          '" is marked preview:true but its request body is not a finite numeric calculate request',
      );
    }

    const existing = index.get(parsed.canonical);
    if (existing === undefined) {
      index.set(parsed.canonical, entry);
      continue;
    }
    if (outcomeSignature(existing) !== outcomeSignature(entry)) {
      throw new Error(
        'contract/fixtures.json: cases "' +
          existing.id +
          '" and "' +
          entry.id +
          '" send identical request bodies but expect different responses',
      );
    }
  }

  return index;
}

const previewIndex = buildPreviewIndex();

export function faultScenarios(milestone?: Milestone): readonly PreviewScenario[] {
  return previewCases(milestone)
    .filter((entry) => entry.testFault !== undefined)
    .map((entry) => {
      const envelope = errorEnvelopeOf(entry);
      const code = envelope === undefined ? 'response' : envelope.code;
      return {
        id: entry.id,
        label: entry.expected.status + ' ' + code,
        fault: entry.testFault ?? '',
      };
    });
}

export interface PreviewClientOptions {
  readonly scenarioId?: string | null;
}

export function createPreviewClient(options: PreviewClientOptions = {}): CalculateClient {
  const { scenarioId = null } = options;

  return {
    calculate(request: CalculateRequest): Promise<CalculateOutcome> {
      if (scenarioId !== null && scenarioId !== '') {
        const named = caseById(scenarioId);
        if (!named.preview) {
          throw new Error(
            'contract/fixtures.json: case "' + scenarioId + '" is not a preview scenario',
          );
        }
        return Promise.resolve(outcomeForCase(named));
      }

      const matched = previewIndex.get(serializeCalculateRequest(request));
      if (matched === undefined) {
        return Promise.resolve({ kind: 'previewGap', message: PREVIEW_UNAVAILABLE_MESSAGE });
      }
      return Promise.resolve(outcomeForCase(matched));
    },
  };
}
