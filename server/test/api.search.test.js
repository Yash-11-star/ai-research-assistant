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

  it('reports the total number of matches, not just the page size', async () => {
    fetchMock.mockResolvedValue(new Response(arxivFeed([{ id: '1706.03762v7', title: 'A' }], 184341)));
    const res = await request(app).get('/api/search').query({ q: 'transformer' });
    expect(res.body.total).toBe(184341);
  });

  it('handles old-style arXiv ids, missing PDF links and missing dates', async () => {
    fetchMock.mockResolvedValue(
      new Response(arxivFeed([{ id: 'hep-th/9901001v3', title: 'Old paper', pdf: false, published: '', authors: [] }]))
    );
    const [paper] = (await request(app).get('/api/search').query({ q: 'strings' })).body.results;
    expect(paper).toMatchObject({ external_id: 'arxiv:hep-th/9901001', url: 'https://arxiv.org/abs/hep-th/9901001', pdf_url: null, year: null, authors: [] });
  });

  it('skips malformed entries without failing the search', async () => {
    const feed = arxivFeed([{ id: '1706.03762', title: 'Good' }]).replace('</feed>', '<entry><id>garbage</id><title>No id</title></entry></feed>');
    fetchMock.mockResolvedValue(new Response(feed));
    const res = await request(app).get('/api/search').query({ q: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r) => r.title)).toEqual(['Good']);
  });

  it('returns no results without calling arXiv when only stopwords are given', async () => {
    const res = await request(app).get('/api/search').query({ q: 'the of and' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ query: 'the of and', total: 0, results: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a repeated q parameter', async () => {
    const res = await request(app).get('/api/search?q=a&q=b');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Query parameter "q" must be a single string');
  });

  it('reports a query arXiv rejects', async () => {
    const errorFeed = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/api/errors#incorrect_id</id><summary>incorrect id format</summary></entry></feed>`;
    fetchMock.mockResolvedValue(new Response(errorFeed, { status: 400 }));
    const res = await request(app).get('/api/search').query({ q: 'x' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Paper search failed: arXiv rejected the query: incorrect id format');
  });

  it.each([
    [() => new Response('oops', { status: 500 }), 'Paper search failed: arXiv returned HTTP 500'],
    [() => new Response('not xml at all'), 'Paper search failed: arXiv returned an unexpected response'],
  ])('maps bad upstream responses to 502 (%#)', async (make, message) => {
    fetchMock.mockResolvedValue(make());
    const res = await request(app).get('/api/search').query({ q: 'x' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe(message);
  });

  it('maps an arXiv timeout to 504', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }));
    const res = await request(app).get('/api/search').query({ q: 'x' });
    expect(res.status).toBe(504);
    expect(res.body.error).toBe('Paper search failed: arXiv did not respond in time');
  });

  it('maps a network failure to 502', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const res = await request(app).get('/api/search').query({ q: 'graphs' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Paper search failed: Could not reach arXiv');
  });
});
