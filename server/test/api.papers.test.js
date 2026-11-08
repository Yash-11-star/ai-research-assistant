import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import app from '../src/app.js';
import { insertPaper } from '../src/db.js';

// Each test creates its own papers (unique external ids), so tests do not
// depend on running order and can be run individually.
let n = 0;
function newPaper(overrides = {}) {
  n += 1;
  return {
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    year: 2017,
    abstract: 'The dominant sequence transduction models...',
    url: 'https://arxiv.org/abs/1706.03762',
    pdf_url: 'https://arxiv.org/pdf/1706.03762',
    external_id: `arxiv:1706.${String(n).padStart(5, '0')}`,
    ...overrides,
  };
}
const save = (body) => request(app).post('/api/papers').send(body);

describe('health and routing', () => {
  it('GET /api/health reports ok and whether the Gemini key is loaded', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, geminiKeyLoaded: true });
  });

  it('unknown API routes return a JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('No route for GET /api/nope');
  });

  it('malformed JSON bodies return 400', async () => {
    const res = await request(app).post('/api/papers').set('Content-Type', 'application/json').send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Request body is not valid JSON');
  });

  it('JSON bodies over 1 MB return 413', async () => {
    const res = await save({ title: 'x', abstract: 'a'.repeat(1.1 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('Request body is too large');
  });
});

describe('paper library CRUD', () => {
  it('saves a paper and returns it with server-managed fields', async () => {
    const body = newPaper();
    const res = await save(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ...body, source: 'search', has_pdf: false, has_full_text: false });
    expect(res.body.id).toBeTypeOf('number');
    expect(res.body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(res.body).not.toHaveProperty('full_text');
    expect(res.body).not.toHaveProperty('pdf_path');
  });

  it('trims strings, drops blank authors and stores empty optional fields as null', async () => {
    const res = await save({ title: '  Spaced  ', authors: [' A ', '', '  '], abstract: '   ', year: '', external_id: ' ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Spaced', authors: ['A'], abstract: null, year: null, external_id: null, url: null, pdf_url: null });
  });

  it('never accepts server-managed fields from the client', async () => {
    const res = await save(newPaper({ source: 'upload', pdf_path: '../../etc/passwd', full_text: 'injected' }));
    expect(res.status).toBe(201);
    expect(res.body.source).toBe('search');
    expect(res.body.has_pdf).toBe(false);
    expect(res.body.has_full_text).toBe(false);
  });

  it('lists newest first and fetches one paper by id', async () => {
    const a = (await save(newPaper({ title: 'Older' }))).body;
    const b = (await save(newPaper({ title: 'Newer' }))).body;
    const list = (await request(app).get('/api/papers')).body;
    const ids = list.map((p) => p.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));

    const one = await request(app).get(`/api/papers/${a.id}`);
    expect(one.status).toBe(200);
    expect(one.body).toEqual(a);
  });

  it('rejects a duplicate save (same arXiv id) with 409 and returns the existing paper', async () => {
    const body = newPaper();
    const first = (await save(body)).body;
    const res = await save({ ...body, title: 'Different title, same id' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Paper is already in your library');
    expect(res.body.paper).toEqual(first);
  });

  it('allows several papers without an external id', async () => {
    expect((await save({ title: 'Manual 1' })).status).toBe(201);
    expect((await save({ title: 'Manual 1' })).status).toBe(201);
  });

  it('deletes a paper (204) and then reports 404', async () => {
    const saved = (await save(newPaper())).body;
    const del = await request(app).delete(`/api/papers/${saved.id}`);
    expect(del.status).toBe(204);
    expect(del.text).toBe('');
    expect((await request(app).get(`/api/papers/${saved.id}`)).status).toBe(404);
    expect((await request(app).delete(`/api/papers/${saved.id}`)).status).toBe(404);
    expect((await request(app).get('/api/papers')).body.map((p) => p.id)).not.toContain(saved.id);
  });

  it('deleting an uploaded paper also deletes its PDF file', async () => {
    const uploads = path.join(process.env.DATA_DIR, 'uploads');
    fs.mkdirSync(uploads, { recursive: true });
    const file = path.join(uploads, 'to-delete.pdf');
    fs.writeFileSync(file, '%PDF-1.4');
    const paper = insertPaper({ title: 'Uploaded', source: 'upload', pdf_path: 'uploads/to-delete.pdf', full_text: 'text' });

    expect((await request(app).delete(`/api/papers/${paper.id}`)).status).toBe(204);
    await vi.waitFor(() => expect(fs.existsSync(file)).toBe(false));
  });

  it('never deletes files outside the data directory', async () => {
    const outside = path.join(path.dirname(process.env.DATA_DIR), `outside-${Date.now()}.pdf`);
    fs.writeFileSync(outside, 'keep me');
    const paper = insertPaper({ title: 'Evil', source: 'upload', pdf_path: `../${path.basename(outside)}`, full_text: 'x' });

    expect((await request(app).delete(`/api/papers/${paper.id}`)).status).toBe(204);
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(outside)).toBe(true);
    fs.rmSync(outside);
  });
});

describe('paper validation', () => {
  it.each([
    [[], 'Request body must be a JSON object'],
    [{}, 'title is required'],
    [{ title: '   ' }, 'title is required'],
    [{ title: 42 }, 'title must be a string'],
    [{ title: 'x'.repeat(1001) }, 'title must be at most 1000 characters'],
    [{ title: 'x', authors: 'Bob' }, 'authors must be an array of strings'],
    [{ title: 'x', authors: ['Bob', 7] }, 'authors must be an array of strings'],
    [{ title: 'x', authors: Array(501).fill('A') }, 'authors must have at most 500 entries'],
    [{ title: 'x', year: 'nineteen' }, 'year must be an integer between 1000 and'],
    [{ title: 'x', year: 999 }, 'year must be an integer between 1000 and'],
    [{ title: 'x', year: 2017.5 }, 'year must be an integer between 1000 and'],
    [{ title: 'x', year: new Date().getFullYear() + 2 }, 'year must be an integer between 1000 and'],
    [{ title: 'x', url: 'not a url' }, 'url must be a valid URL'],
    [{ title: 'x', url: 'javascript:alert(1)' }, 'url must be an http(s) URL'],
    [{ title: 'x', pdf_url: 'ftp://example.com/a.pdf' }, 'pdf_url must be an http(s) URL'],
    [{ title: 'x', abstract: 'a'.repeat(20001) }, 'abstract must be at most 20000 characters'],
    [{ title: 'x', external_id: 'a'.repeat(201) }, 'external_id must be at most 200 characters'],
  ])('rejects %j with 400', async (body, message) => {
    const res = await save(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
  });

  // Round 3 (mutation feedback): the limits are inclusive.
  it('accepts values exactly at the limits', async () => {
    const res = await save({
      title: 't'.repeat(1000),
      authors: Array(500).fill('A'),
      abstract: 'a'.repeat(20000),
      external_id: `x${'e'.repeat(199)}`,
      url: 'http://example.com/plain-http-is-allowed',
    });
    expect(res.status).toBe(201);
    expect(res.body.authors).toHaveLength(500);
    expect(res.body.url).toBe('http://example.com/plain-http-is-allowed');
  });

  it('treats null authors and year as empty', async () => {
    const res = await save({ title: 'Nulls', authors: null, year: null });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ authors: [], year: null });
  });

  it.each([1000, new Date().getFullYear() + 1, '2017'])('accepts year %j', async (year) => {
    const res = await save({ title: 'Year ok', year });
    expect(res.status).toBe(201);
    expect(res.body.year).toBe(Number(year));
  });

  it.each(['abc', '0', '-1', '1.5', '1e3', '99999999999999999999'])('rejects id %s with 400', async (id) => {
    const res = await request(app).get(`/api/papers/${id}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('id must be a positive integer');
  });

  it('returns 404 for a missing paper', async () => {
    const res = await request(app).get('/api/papers/99999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Paper not found');
  });
});
