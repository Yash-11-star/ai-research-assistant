import { describe, it, expect, vi } from 'vitest';
import { api, ApiError } from '../src/api.js';
import { json } from './helpers.js';

const stub = (impl) => {
  const f = vi.fn(impl);
  vi.stubGlobal('fetch', f);
  return f;
};

describe('api client', () => {
  it('returns the parsed JSON body on success', async () => {
    stub(async () => json([{ id: 1 }]));
    await expect(api.listPapers()).resolves.toEqual([{ id: 1 }]);
  });

  it('URL-encodes search queries', async () => {
    const f = stub(async () => json({ results: [] }));
    await api.search('graph & "nets"/?');
    expect(f.mock.calls[0][0]).toBe('/api/search?q=graph%20%26%20%22nets%22%2F%3F');
  });

  it('sends JSON bodies with a JSON content type', async () => {
    const f = stub(async () => json({ id: 1 }, 201));
    await api.savePaper({ title: 'T' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/papers');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ title: 'T' });
  });

  it('sends uploads as multipart FormData without forcing a content type', async () => {
    const f = stub(async () => json({ id: 1 }, 201));
    const file = new File(['%PDF-'], 'a.pdf', { type: 'application/pdf' });
    await api.uploadPaper(file);
    const init = f.mock.calls[0][1];
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('file')).toBeInstanceOf(File);
    expect(init.body.get('file').name).toBe('a.pdf');
    expect(init.headers).toBeUndefined();
  });

  it('builds the right endpoints for each call', async () => {
    const f = stub(async () => json({}));
    await api.getPaper(7);
    await api.summarize(7);
    await api.ask(7, 'Why?');
    expect(f.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${u}`)).toEqual([
      'GET /api/papers/7',
      'POST /api/papers/7/summary',
      'POST /api/papers/7/questions',
    ]);
    expect(JSON.parse(f.mock.calls[2][1].body)).toEqual({ question: 'Why?' });
  });

  it('returns null for 204 No Content', async () => {
    stub(async () => new Response(null, { status: 204 }));
    await expect(api.deletePaper(3)).resolves.toBeNull();
  });

  it("uses the server's error message and status", async () => {
    stub(async () => json({ error: 'Paper is already in your library', paper: { id: 2 } }, 409));
    const err = await api.savePaper({}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('Paper is already in your library');
    expect(err.status).toBe(409);
    expect(err.body.paper).toEqual({ id: 2 });
  });

  it('reports an unreachable backend (network error)', async () => {
    stub(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = await api.listPapers().catch((e) => e);
    expect(err.message).toBe('Cannot reach the server. Is the backend running?');
    expect(err.status).toBe(0);
  });

  it('reports a non-JSON 5xx (dev proxy error page) as an unreachable backend', async () => {
    stub(async () => new Response('<html>Bad Gateway</html>', { status: 502 }));
    await expect(api.listPapers()).rejects.toThrow('Cannot reach the server. Is the backend running?');
  });

  it('reports a non-JSON 4xx with its status', async () => {
    stub(async () => new Response('nope', { status: 404 }));
    await expect(api.listPapers()).rejects.toThrow('Request failed (HTTP 404)');
  });

  it('rejects a successful response that is not JSON', async () => {
    stub(async () => new Response('<html>', { status: 200 }));
    await expect(api.listPapers()).rejects.toThrow('The server sent an unexpected response.');
  });
});
