import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { arxivFeed } from './helpers/fixtures.js';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('GET /api/search', () => {
  it('returns normalized arXiv results', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        arxivFeed(
          [{ id: '1706.03762v7', title: 'Attention Is\n  All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer'] }],
          1
        )
      )
    );
    const res = await request(app).get('/api/search').query({ q: 'transformer attention' });
    expect(res.status).toBe(200);
    expect(res.body.query).toBe('transformer attention');
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toEqual({
      external_id: 'arxiv:1706.03762',
      title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      year: 2017,
      abstract: 'An abstract.',
      url: 'https://arxiv.org/abs/1706.03762',
      pdf_url: 'https://arxiv.org/pdf/1706.03762',
      provider: 'arxiv',
    });
  });

  it('sends an AND query without stopwords to arXiv', async () => {
    fetchMock.mockResolvedValue(new Response(arxivFeed([])));
    await request(app).get('/api/search').query({ q: 'Attention is all you need' });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('search_query')).toBe('all:attention AND all:all AND all:you AND all:need');
    expect(url.searchParams.get('max_results')).toBe('10');
  });

  it.each([
    [{}, 'Missing query parameter "q"'],
    [{ q: '   ' }, 'Search query cannot be blank'],
    [{ q: 'x'.repeat(301) }, 'Search query must be at most 300 characters'],
  ])('rejects %j with 400', async (query, message) => {
    const res = await request(app).get('/api/search').query(query);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an arXiv 429 to a 503 with a user-facing message', async () => {
    fetchMock.mockResolvedValue(new Response('slow down', { status: 429 }));
    const res = await request(app).get('/api/search').query({ q: 'graphs' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/rate-limiting/);
  });

  it('maps a network failure to 502', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const res = await request(app).get('/api/search').query({ q: 'graphs' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Paper search failed: Could not reach arXiv');
  });
});
