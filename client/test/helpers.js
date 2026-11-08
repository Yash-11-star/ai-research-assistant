import { vi } from 'vitest';
import { it } from 'vitest';

export const json = (body, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Replaces fetch with a tiny router: routes is { 'GET /api/papers': handler | Response-producing value }.
// Unmatched requests fail the test loudly.
export function mockApi(routes) {
  const fetchMock = vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = String(url).split('?')[0];
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ');
      return m === method && new RegExp(`^${p}$`).test(path);
    });
    if (!key) throw new Error(`Unexpected request: ${method} ${url}`);
    const handler = routes[key];
    const result = typeof handler === 'function' ? await handler(url, init) : handler;
    return result instanceof Response ? result : json(result);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// A promise you resolve later, to observe loading states.
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const makePaper = (overrides = {}) => ({
  id: 1,
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer'],
  year: 2017,
  abstract: 'The dominant sequence transduction models are based on recurrent networks.',
  url: 'https://arxiv.org/abs/1706.03762',
  pdf_url: 'https://arxiv.org/pdf/1706.03762',
  source: 'search',
  external_id: 'arxiv:1706.03762',
  has_pdf: false,
  has_full_text: false,
  created_at: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

// See server/test/helpers/knownBug.js.
export function knownBug(id, name, fn) {
  return it.fails(`[${id}] ${name}`, fn);
}
