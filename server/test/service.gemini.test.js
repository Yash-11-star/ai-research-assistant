import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateJson, GeminiError } from '../src/services/gemini.js';
import { geminiResponse, geminiError } from './helpers/fixtures.js';

// Calls the Gemini client directly (no HTTP server), so fake timers can skip
// the retry delays without interfering with sockets.
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ toFake: ['setTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  process.env.GEMINI_API_KEY = 'test-key';
});

const dailyQuota = () =>
  geminiError(429, 'Quota exceeded', [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }]);

async function run(promise) {
  const settled = promise.then((v) => ({ v }), (e) => ({ e }));
  await vi.runAllTimersAsync();
  return settled;
}

const modelOf = (call) => String(call[0]).match(/models\/(.+):generateContent/)[1];

describe('generateJson', () => {
  it('sends the prompt, schema and key header, and parses the JSON reply', async () => {
    fetchMock.mockResolvedValueOnce(geminiResponse({ a: 1 }));
    const { v } = await run(generateJson('PROMPT', { type: 'object' }));
    expect(v).toEqual({ data: { a: 1 }, model: 'model-a' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/model-a:generateContent');
    expect(url).not.toContain('test-key');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts[0].text).toBe('PROMPT');
    expect(body.generationConfig).toEqual({ temperature: 0, responseMimeType: 'application/json', responseSchema: { type: 'object' } });
  });

  it('retries a temporary 503 on the same model, then succeeds', async () => {
    fetchMock.mockResolvedValueOnce(geminiError(503, 'overloaded')).mockResolvedValueOnce(geminiResponse({ ok: true }));
    const { v } = await run(generateJson('p'));
    expect(v.model).toBe('model-a');
    expect(fetchMock.mock.calls.map(modelOf)).toEqual(['model-a', 'model-a']);
  });

  it('falls back to the next model after the retries are used up', async () => {
    fetchMock
      .mockResolvedValueOnce(geminiError(503))
      .mockResolvedValueOnce(geminiError(503))
      .mockResolvedValueOnce(geminiError(500))
      .mockResolvedValueOnce(geminiResponse({ ok: true }));
    const { v } = await run(generateJson('p'));
    expect(v.model).toBe('model-b');
    expect(fetchMock.mock.calls.map(modelOf)).toEqual(['model-a', 'model-a', 'model-a', 'model-b']);
  });

  it('skips retries when the daily quota is used up', async () => {
    fetchMock.mockResolvedValueOnce(dailyQuota()).mockResolvedValueOnce(geminiResponse({ ok: true }));
    const { v } = await run(generateJson('p'));
    expect(v.model).toBe('model-b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a daily-quota error (503) when every model is out of quota', async () => {
    fetchMock.mockResolvedValueOnce(dailyQuota()).mockResolvedValueOnce(dailyQuota());
    const { e } = await run(generateJson('p'));
    expect(e).toBeInstanceOf(GeminiError);
    expect(e.status).toBe(503);
    expect(e.message).toBe('Gemini free-tier daily quota used up for all configured models (Quota exceeded)');
  });

  it('reports "temporarily unavailable" (503) when every model stays overloaded', async () => {
    fetchMock.mockImplementation(async () => geminiError(503, 'The model is overloaded.\nMore detail'));
    const { e } = await run(generateJson('p'));
    expect(e.status).toBe(503);
    expect(e.message).toBe('Gemini is temporarily unavailable, try again shortly (The model is overloaded.)');
    expect(fetchMock).toHaveBeenCalledTimes(6); // 3 attempts x 2 models
  });

  it('does not retry or fall back on a non-temporary error', async () => {
    fetchMock.mockResolvedValueOnce(geminiError(400, 'API key not valid'));
    const { e } = await run(generateJson('p'));
    expect(e.status).toBe(502);
    expect(e.message).toBe('Gemini request failed: API key not valid');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the HTTP status when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 403 }));
    const { e } = await run(generateJson('p'));
    expect(e.message).toBe('Gemini request failed: HTTP 403');
  });

  it.each([
    [Object.assign(new Error('t'), { name: 'TimeoutError' }), 504, 'Gemini did not respond in time'],
    [new TypeError('fetch failed'), 502, 'Could not reach Gemini'],
  ])('maps network failures (%#)', async (error, status, message) => {
    fetchMock.mockRejectedValueOnce(error);
    const { e } = await run(generateJson('p'));
    expect(e).toMatchObject({ status, message });
  });

  it('fails with 500 when no API key is configured, without calling Gemini', async () => {
    delete process.env.GEMINI_API_KEY;
    const { e } = await run(generateJson('p'));
    expect(e).toMatchObject({ status: 500, message: 'GEMINI_API_KEY is not set on the server' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports why Gemini returned no text', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] })));
    expect((await run(generateJson('p'))).e.message).toBe('Gemini returned no text (SAFETY)');

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ promptFeedback: { blockReason: 'OTHER' } })));
    expect((await run(generateJson('p'))).e.message).toBe('Gemini returned no text (OTHER)');
  });

  it('rejects malformed JSON output', async () => {
    fetchMock.mockResolvedValueOnce(geminiResponse('{"unterminated": '));
    const { e } = await run(generateJson('p'));
    expect(e.message).toBe('Gemini returned malformed JSON');
  });
});
