import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

const paper = {
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer'],
  year: 2017,
  abstract: 'The dominant sequence transduction models...',
  url: 'https://arxiv.org/abs/1706.03762',
  pdf_url: 'https://arxiv.org/pdf/1706.03762',
  external_id: 'arxiv:1706.03762',
};

describe('health and routing', () => {
  it('GET /api/health reports ok and whether the Gemini key is loaded', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, geminiKeyLoaded: true });
  });

  it('unknown API routes return a JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No route for GET \/api\/nope/);
  });

  it('malformed JSON bodies return 400', async () => {
    const res = await request(app).post('/api/papers').set('Content-Type', 'application/json').send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Request body is not valid JSON');
  });
});

describe('paper library CRUD', () => {
  it('starts empty', async () => {
    const res = await request(app).get('/api/papers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('saves a paper and returns it with server-managed fields', async () => {
    const res = await request(app).post('/api/papers').send(paper);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ...paper, source: 'search', has_pdf: false, has_full_text: false });
    expect(res.body.id).toBeTypeOf('number');
    expect(res.body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.body).not.toHaveProperty('full_text');
  });

  it('lists and fetches the saved paper', async () => {
    const list = await request(app).get('/api/papers');
    expect(list.body).toHaveLength(1);
    const one = await request(app).get(`/api/papers/${list.body[0].id}`);
    expect(one.status).toBe(200);
    expect(one.body.title).toBe(paper.title);
  });

  it('rejects a duplicate save with 409 and returns the existing paper', async () => {
    const res = await request(app).post('/api/papers').send(paper);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Paper is already in your library');
    expect(res.body.paper.external_id).toBe(paper.external_id);
  });

  it('deletes a paper (204) and then reports 404', async () => {
    const [saved] = (await request(app).get('/api/papers')).body;
    const del = await request(app).delete(`/api/papers/${saved.id}`);
    expect(del.status).toBe(204);
    expect((await request(app).get(`/api/papers/${saved.id}`)).status).toBe(404);
    expect((await request(app).delete(`/api/papers/${saved.id}`)).status).toBe(404);
  });
});

describe('paper validation', () => {
  it.each([
    [{}, 'title is required'],
    [{ title: '   ' }, 'title is required'],
    [{ title: 'x', authors: 'Bob' }, 'authors must be an array of strings'],
    [{ title: 'x', year: 'nineteen' }, 'year must be an integer'],
    [{ title: 'x', year: 999 }, 'year must be an integer'],
    [{ title: 'x', url: 'not a url' }, 'url must be a valid URL'],
    [{ title: 'x', pdf_url: 'ftp://example.com/a.pdf' }, 'pdf_url must be an http(s) URL'],
  ])('rejects %j with 400', async (body, message) => {
    const res = await request(app).post('/api/papers').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
  });

  it.each(['abc', '0', '-1', '1.5'])('rejects id %s with 400', async (id) => {
    const res = await request(app).get(`/api/papers/${id}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('id must be a positive integer');
  });

  it('returns 404 for a missing paper', async () => {
    const res = await request(app).get('/api/papers/99999');
    expect(res.status).toBe(404);
  });
});
