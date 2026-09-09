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

/**
 * Fixture-backed `CalculateClient`, for tests only.
 *
 * Living under `src/test/` makes its test-only status structural rather than a
 * convention: nothing under `src/api`, `src/components`, `src/hooks` or
 * `src/App.tsx` imports it. Driving the UI from the same golden cases the Go
 * handler asserts on is what keeps both halves honest without hand-written
 * payloads.
 *
 * It resolves a request two ways and no others — by named fixture id, or by
 * exact request-body match. If neither matches it says so; it never computes
 * arithmetic and never returns an unrelated fixture's result.
 *
 * Both sides of that match are canonicalised through `serializeCalculateRequest`
 * because the fixtures store hand-written JSON literals that `JSON.stringify`
 * does not reproduce byte-for-byte: `-0` serialises as `0` and `1e308` as
 * `1e+308`. Comparing raw strings would strand thirteen preview cases, including
 * every overflow case.
 *
 * Cases carrying `testFault` are excluded from the index outright, so ordinary
 * input can never resolve to an injected fault. The benign collisions that
 * remain carry identical expected responses, which `buildPreviewIndex` asserts
 * at load; a collision with differing outcomes would be a contract defect and
 * throws.
 */

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

/**
 * Parses a fixture's stored request body into the request the UI would send.
 * Returns undefined for bodies outside the typed UI's reach (malformed JSON,
 * wrong types, non-finite operands) — those are all `preview: false` cases.
 */
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

/** Translates a fixture case into the outcome the client would report. */
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

/**
 * Indexes every preview case that ordinary input can reach, keyed by the exact
 * request bytes. Cases carrying `testFault` are excluded by construction.
 */
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
    // Same bytes must mean the same answer, or matching could not be deterministic.
    if (outcomeSignature(existing) !== outcomeSignature(entry)) {
      throw new Error(
        'contract/fixtures.json: cases "' +
          existing.id +
          '" and "' +
          entry.id +
          '" send identical request bodies but expect different responses',
      );
    }
    // Keep the first in contract order; the outcome is provably identical.
  }

  return index;
}

const previewIndex = buildPreviewIndex();

/** Preview cases reachable only by name, i.e. the injectable fault scenarios. */
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
  /**
   * Replays this named fixture case instead of matching on the request body.
   * Selection happens here, entirely outside the request: no header, query
   * parameter or body field ever carries it.
   */
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
