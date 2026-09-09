import { afterEach, describe, expect, it, vi } from 'vitest';
import { CALCULATE_ENDPOINT, createHttpClient, HTTP_CLIENT_MESSAGES, REQUEST_TIMEOUT_MS } from '../api/client';
import { parseFixtureRequestBody } from '../test/previewClient';
import { serializeCalculateRequest } from '../api/types';
import { caseById, errorEnvelopeOf, successResultOf } from '../contract/fixtures';

/**
 * The production HTTP client is tested against the same golden cases as the Go
 * handler. Malformed transport responses and stalled connections are injected
 * separately to exercise failures outside the service's contract.
 */

function respondWith(status: number, body: unknown): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  ) as unknown as typeof fetch;
}

function requestFor(id: string) {
  const parsed = parseFixtureRequestBody(caseById(id).request.body);
  if (parsed === undefined) throw new Error('fixture ' + id + ' is not a typed UI request');
  return parsed.request;
}

describe('createHttpClient', () => {
  it('POSTs the exact canonical body to the contract endpoint', async () => {
    const fetchImpl = respondWith(200, caseById('add-positive').expected.body);
    const client = createHttpClient({ fetchImpl });
    const request = requestFor('add-positive');

    await client.calculate(request);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(url).toBe(CALCULATE_ENDPOINT);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init?.body).toBe(serializeCalculateRequest(request));
    expect(init?.body).toBe('{"operation":"add","operands":[10,2]}');
  });

  it('never serialises testFault metadata into the request', async () => {
    const fault = caseById('unexpected-server-error');
    expect(fault.testFault).toBeDefined();

    const fetchImpl = respondWith(500, fault.expected.body);
    const client = createHttpClient({ fetchImpl });
    await client.calculate(requestFor('unexpected-server-error'));

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    const serialised = JSON.stringify({ url, init });
    expect(serialised).not.toContain('testFault');
    expect(serialised).not.toContain('unexpected_error');
    expect(serialised).not.toContain('unexpected-server-error');
  });

  it('reports a 200 result as success', async () => {
    const entry = caseById('divide-positive');
    const client = createHttpClient({ fetchImpl: respondWith(200, entry.expected.body) });

    expect(await client.calculate(requestFor('divide-positive'))).toEqual({
      kind: 'success',
      result: successResultOf(entry),
    });
  });

  it('reports a 400 envelope as a user-caused API error', async () => {
    const entry = caseById('divide-by-zero');
    const client = createHttpClient({ fetchImpl: respondWith(400, entry.expected.body) });

    expect(await client.calculate(requestFor('divide-by-zero'))).toEqual({
      kind: 'apiError',
      status: 400,
      error: errorEnvelopeOf(entry),
    });
  });

  it('reports a 500 envelope as an API error carrying the server status', async () => {
    const entry = caseById('unexpected-server-error');
    const client = createHttpClient({ fetchImpl: respondWith(500, entry.expected.body) });

    expect(await client.calculate(requestFor('unexpected-server-error'))).toEqual({
      kind: 'apiError',
      status: 500,
      error: errorEnvelopeOf(entry),
    });
  });

  it('reports a network failure as a transport error', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new Error('connect ECONNREFUSED')),
    ) as unknown as typeof fetch;
    const client = createHttpClient({ fetchImpl });

    const outcome = await client.calculate(requestFor('add-positive'));
    expect(outcome.kind).toBe('transportError');
    expect(outcome).toMatchObject({ message: expect.stringContaining('ECONNREFUSED') });
  });

  it('reports an unparseable response as a transport error', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('not json', { status: 200 })),
    ) as unknown as typeof fetch;
    const client = createHttpClient({ fetchImpl });

    expect(await client.calculate(requestFor('add-positive'))).toEqual({
      kind: 'transportError',
      message: HTTP_CLIENT_MESSAGES.unreadableResponse,
    });
  });

  it('blames the connection, not the payload, for an unreadable 5xx', async () => {
    // What a dev proxy returns when the Go service is not listening: 500 with
    // an empty body. The service itself always writes the error envelope, so
    // this response cannot have come from it.
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('', { status: 500 })),
    ) as unknown as typeof fetch;
    const client = createHttpClient({ fetchImpl });

    expect(await client.calculate(requestFor('add-positive'))).toEqual({
      kind: 'transportError',
      message: HTTP_CLIENT_MESSAGES.unreachableService,
    });
  });

  it('rejects a non-finite result rather than displaying NaN as an answer', async () => {
    // The contract forbids serialising NaN or Infinity; if one arrives anyway it
    // is a server fault, not a number to show the user.
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('{"result": 1e999}', { status: 200 })),
    ) as unknown as typeof fetch;
    const client = createHttpClient({ fetchImpl });

    expect(await client.calculate(requestFor('add-positive'))).toEqual({
      kind: 'transportError',
      message: HTTP_CLIENT_MESSAGES.nonFiniteResult,
    });
  });

  it('rejects a 200 body with no recognisable shape', async () => {
    const client = createHttpClient({ fetchImpl: respondWith(200, { unexpected: true }) });
    expect(await client.calculate(requestFor('add-positive'))).toEqual({
      kind: 'transportError',
      message: HTTP_CLIENT_MESSAGES.unreadableResponse,
    });
  });

  it('honours an overridden endpoint', async () => {
    const fetchImpl = respondWith(200, caseById('add-positive').expected.body);
    const client = createHttpClient({ fetchImpl, endpoint: '/proxy/calculate' });
    await client.calculate(requestFor('add-positive'));
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[0]).toBe('/proxy/calculate');
  });
});

describe('request deadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function pendingUntilAbort(signal: AbortSignal | null | undefined): Promise<never> {
    if (signal == null) throw new Error('fetch must receive an abort signal');
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }

  it('aborts a stalled request and permits a fresh successful retry', async () => {
    vi.useFakeTimers();
    const entry = caseById('add-positive');
    const fetchImpl = vi.fn<typeof fetch>()
      .mockImplementationOnce((_input, init) => pendingUntilAbort(init?.signal))
      .mockImplementationOnce(respondWith(entry.expected.status, entry.expected.body));
    const client = createHttpClient({ fetchImpl });

    const pending = client.calculate(requestFor(entry.id));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toEqual({
      kind: 'transportError',
      message: HTTP_CLIENT_MESSAGES.requestTimedOut,
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(await client.calculate(requestFor(entry.id))).toEqual({
      kind: 'success',
      result: successResultOf(entry),
    });
    expect(fetchImpl.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the deadline active while reading a stalled response body', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      const response = new Response();
      vi.spyOn(response, 'json').mockImplementation(() => pendingUntilAbort(init?.signal));
      return Promise.resolve(response);
    });
    const client = createHttpClient({ fetchImpl });

    const pending = client.calculate(requestFor('add-positive'));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

    expect(await pending).toEqual({
      kind: 'transportError',
      message: HTTP_CLIENT_MESSAGES.requestTimedOut,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes the deadline after a completed response or network failure', async () => {
    vi.useFakeTimers();
    const entry = caseById('add-positive');
    const fetchImpl = vi.fn<typeof fetch>()
      .mockImplementationOnce(respondWith(entry.expected.status, entry.expected.body))
      .mockRejectedValueOnce(new Error('offline'));
    const client = createHttpClient({ fetchImpl });

    await client.calculate(requestFor(entry.id));
    expect(vi.getTimerCount()).toBe(0);
    await client.calculate(requestFor(entry.id));
    expect(vi.getTimerCount()).toBe(0);
  });
});
