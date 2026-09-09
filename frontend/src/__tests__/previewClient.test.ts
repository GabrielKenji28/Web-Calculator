import { describe, expect, it } from 'vitest';
import {
  buildPreviewIndex,
  createPreviewClient,
  faultScenarios,
  outcomeForCase,
  parseFixtureRequestBody,
  PREVIEW_UNAVAILABLE_MESSAGE,
} from '../test/previewClient';
import { serializeCalculateRequest } from '../api/types';
import {
  caseById,
  errorEnvelopeOf,
  fixtures,
  previewCases,
  successResultOf,
} from '../contract/fixtures';

const allPreviewCases = previewCases().filter((entry) => entry.testFault === undefined);

describe('preview request matching', () => {
  it('resolves every preview case, both milestones, from the exact request it would send', async () => {
    const client = createPreviewClient();
    expect(allPreviewCases.length).toBe(43);

    for (const entry of allPreviewCases) {
      const parsed = parseFixtureRequestBody(entry.request.body);
      expect(parsed, entry.id).toBeDefined();
      if (parsed === undefined) continue;

      const outcome = await client.calculate(parsed.request);
      const expectedResult = successResultOf(entry);
      const expectedError = errorEnvelopeOf(entry);

      if (expectedResult !== undefined) {
        expect(outcome, entry.id).toEqual({ kind: 'success', result: expectedResult });
      } else {
        expect(expectedError, entry.id).toBeDefined();
        expect(outcome, entry.id).toEqual({
          kind: 'apiError',
          status: entry.expected.status,
          error: expectedError,
        });
      }
    }
  });

  it('counts exactly the bodies that need canonicalising', () => {
    // 13 stored literals do not survive a JS round-trip byte-for-byte: -0
    // serialises as 0, 1e308 as 1e+308, and 1e309 as null. Matching on the raw
    // string would strand every one of them.
    const differing = previewCases()
      .concat(
        fixtures.cases.filter((entry) => !entry.preview && entry.request.method === 'POST'),
      )
      .filter((entry) => {
        try {
          return JSON.stringify(JSON.parse(entry.request.body)) !== entry.request.body;
        } catch {
          return false;
        }
      });

    expect(differing).toHaveLength(13);
    expect(differing.filter((entry) => entry.preview)).toHaveLength(11);

    // The two that are not preview:true are the 1e309 input-overflow cases.
    // They canonicalise to a null operand, which is below the typed UI's
    // boundary, so parseFixtureRequestBody rejects them and they can never
    // enter the index.
    const nonPreview = differing.filter((entry) => !entry.preview);
    expect(nonPreview.map((entry) => entry.id)).toEqual([
      'positive-input-overflow',
      'negative-input-overflow',
    ]);
    for (const entry of nonPreview) {
      expect(parseFixtureRequestBody(entry.request.body), entry.id).toBeUndefined();
    }
  });

  it('canonicalises -0 and 1e308 literals so those fixtures stay reachable', () => {
    const negativeZero = caseById('normalize-negative-zero');
    expect(negativeZero.request.body).toContain('-0');
    expect(parseFixtureRequestBody(negativeZero.request.body)?.canonical).toBe(
      '{"operation":"multiply","operands":[0,2]}',
    );

    const overflow = caseById('addition-overflow');
    expect(overflow.request.body).toContain('1e308');
    expect(parseFixtureRequestBody(overflow.request.body)?.canonical).toBe(
      '{"operation":"add","operands":[1e+308,1e+308]}',
    );
  });

  it('matches on the same bytes the HTTP client would send', () => {
    const index = buildPreviewIndex();
    for (const key of index.keys()) {
      const parsed = parseFixtureRequestBody(key);
      expect(parsed).toBeDefined();
      if (parsed === undefined) continue;
      expect(serializeCalculateRequest(parsed.request)).toBe(key);
    }
  });

  it('rejects bodies below the typed UI boundary', () => {
    expect(parseFixtureRequestBody('{"operation":"add","operands":[1,2]')).toBeUndefined();
    expect(parseFixtureRequestBody('null')).toBeUndefined();
    expect(parseFixtureRequestBody('[]')).toBeUndefined();
    expect(parseFixtureRequestBody('{"operands":[1,2]}')).toBeUndefined();
    expect(parseFixtureRequestBody('{"operation":"add","operands":["1",2]}')).toBeUndefined();
    expect(parseFixtureRequestBody('{"operation":"add","operands":[1e309,2]}')).toBeUndefined();
  });
});

describe('testFault exclusion', () => {
  it('never resolves ordinary input to the injected fault', async () => {
    const fault = caseById('unexpected-server-error');
    const success = caseById('add-positive');
    expect(fault.request.body).toBe(success.request.body);

    const parsed = parseFixtureRequestBody(success.request.body);
    expect(parsed).toBeDefined();
    if (parsed === undefined) return;

    // Repeated to show the choice is deterministic, not incidental ordering.
    const client = createPreviewClient();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await client.calculate(parsed.request)).toEqual({ kind: 'success', result: 12 });
    }
  });

  it('keeps every testFault case out of the request index entirely', () => {
    const index = buildPreviewIndex();
    const indexedIds = [...index.values()].map((entry) => entry.id);
    expect(indexedIds).not.toContain('unexpected-server-error');
    for (const entry of index.values()) {
      expect(entry.testFault, entry.id).toBeUndefined();
    }
  });

  it('builds the index without a colliding-outcome contract violation', () => {
    // Passes only because every colliding group shares one expected response.
    expect(() => buildPreviewIndex()).not.toThrow();
  });

  it('collides exactly where predicted, and only on identical outcomes', () => {
    // Canonicalisation merges -0 with 0, so these pairs share request bytes.
    // The index tolerates that only because each pair agrees on the response;
    // a pair that disagreed would be a contract defect and would throw above.
    const groups = new Map<string, string[]>();
    for (const entry of previewCases()) {
      if (entry.testFault !== undefined) continue;
      const parsed = parseFixtureRequestBody(entry.request.body);
      expect(parsed, entry.id).toBeDefined();
      if (parsed === undefined) continue;
      const ids = groups.get(parsed.canonical) ?? [];
      ids.push(entry.id);
      groups.set(parsed.canonical, ids);
    }

    const collisions = [...groups.values()].filter((ids) => ids.length > 1);
    expect(collisions).toEqual([
      ['divide-by-zero', 'divide-by-negative-zero'],
      ['power-zero-negative-exponent', 'power-negative-zero-negative-exponent'],
      ['sqrt-zero', 'sqrt-negative-zero'],
    ]);

    for (const ids of collisions) {
      const outcomes = new Set(
        ids.map((id) => {
          const entry = caseById(id);
          return entry.expected.status + '|' + JSON.stringify(entry.expected.body);
        }),
      );
      expect(outcomes.size, ids.join(' / ')).toBe(1);
    }
  });

  it('indexes every non-fault preview case across both milestones', () => {
    const index = buildPreviewIndex();
    const nonFault = previewCases().filter((entry) => entry.testFault === undefined);
    expect(nonFault).toHaveLength(43);
    // 43 cases minus one absorbed member per collision group.
    expect(index.size).toBe(nonFault.length - 3);
  });

  it('offers the fault only by name, labelled from the contract', () => {
    expect(faultScenarios('core')).toEqual([
      { id: 'unexpected-server-error', label: '500 INTERNAL_ERROR', fault: 'unexpected_error' },
    ]);
  });
});

describe('named scenario selection', () => {
  it('replays the injected 500 regardless of the operands typed', async () => {
    const client = createPreviewClient({ scenarioId: 'unexpected-server-error' });
    const envelope = errorEnvelopeOf(caseById('unexpected-server-error'));

    expect(await client.calculate({ operation: 'divide', operands: [7, 3] })).toEqual({
      kind: 'apiError',
      status: 500,
      error: envelope,
    });
  });

  it('treats an empty selection as no selection', async () => {
    const client = createPreviewClient({ scenarioId: '' });
    expect(await client.calculate({ operation: 'add', operands: [10, 2] })).toEqual({
      kind: 'success',
      result: 12,
    });
  });

  it('refuses a case that is not a preview scenario', () => {
    const client = createPreviewClient({ scenarioId: 'malformed-json' });
    expect(() => client.calculate({ operation: 'add', operands: [1, 2] })).toThrow(
      /not a preview scenario/,
    );
  });
});

describe('unmatched input', () => {
  it('says so plainly instead of computing or substituting a result', async () => {
    const client = createPreviewClient();
    const outcome = await client.calculate({ operation: 'add', operands: [41, 1] });
    expect(outcome).toEqual({ kind: 'previewGap', message: PREVIEW_UNAVAILABLE_MESSAGE });
    expect(PREVIEW_UNAVAILABLE_MESSAGE).toMatch(/not available in the fixture preview/i);
    expect(JSON.stringify(outcome)).not.toContain('42');
  });

  it('does not fall back to a near-miss fixture', async () => {
    const client = createPreviewClient();
    // add [10,2] is a fixture; add [10,3] is not, and must not borrow its answer.
    expect(await client.calculate({ operation: 'add', operands: [10, 3] })).toEqual({
      kind: 'previewGap',
      message: PREVIEW_UNAVAILABLE_MESSAGE,
    });
  });

  it('reports an unknown operation as a gap rather than guessing', async () => {
    const client = createPreviewClient();
    const outcome = await client.calculate({ operation: 'modulo', operands: [10, 2] });
    expect(outcome.kind).toBe('previewGap');
  });
});

describe('outcomeForCase', () => {
  it('throws on a case that is neither a result nor an error envelope', () => {
    expect(() => outcomeForCase(caseById('health'))).toThrow(
      /neither a result nor an error envelope/,
    );
  });
});
