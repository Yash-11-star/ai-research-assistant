import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import app from '../src/app.js';
import { samplePdf, geminiResponse } from './helpers/fixtures.js';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const goodMetadata = {
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer'],
  year: 2017,
  year_evidence: 'NeurIPS 2017',
  abstract: null,
};

describe('POST /api/papers/upload', () => {
  it('stores an uploaded PDF with verified metadata and full text', async () => {
    fetchMock.mockResolvedValue(geminiResponse(goodMetadata));
    const res = await request(app).post('/api/papers/upload').attach('file', await samplePdf(), 'paper.pdf');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      year: 2017,
      source: 'upload',
      has_pdf: true,
      has_full_text: true,
      pages: 2,
    });
    expect(res.body.warnings).toContain('Abstract could not be determined from the PDF');

    const stored = fs.readdirSync(path.join(process.env.DATA_DIR, 'uploads'));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^[0-9a-f-]{36}\.pdf$/);
  });

  it('discards hallucinated metadata that is not in the PDF', async () => {
    fetchMock.mockResolvedValue(
      geminiResponse({ ...goodMetadata, title: 'A Completely Different Title', authors: ['Geoffrey Hinton'] })
    );
    const res = await request(app).post('/api/papers/upload').attach('file', await samplePdf(), 'my-paper.pdf');
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('my-paper');
    expect(res.body.authors).toEqual([]);
    expect(res.body.warnings.join('\n')).toMatch(/Discarded title/);
    expect(res.body.warnings.join('\n')).toMatch(/Discarded author.*Geoffrey Hinton/);
  });

  it('rejects requests without a file', async () => {
    const res = await request(app).post('/api/papers/upload');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No file uploaded/);
  });

  it('rejects non-PDF files with 415', async () => {
    const res = await request(app).post('/api/papers/upload').attach('file', Buffer.from('hello world'), 'notes.txt');
    expect(res.status).toBe(415);
    expect(res.body.error).toBe('Only PDF files are accepted');
  });

  it('rejects a file named .pdf whose bytes are not a PDF', async () => {
    const res = await request(app).post('/api/papers/upload').attach('file', Buffer.from('not really'), 'fake.pdf');
    expect(res.status).toBe(415);
  });

  it('reports a Gemini failure and does not leave a file behind', async () => {
    const before = fs.readdirSync(path.join(process.env.DATA_DIR, 'uploads')).length;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 400 }));
    const res = await request(app).post('/api/papers/upload').attach('file', await samplePdf(), 'paper.pdf');
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/^Metadata extraction failed: Gemini request failed: bad key/);
    expect(fs.readdirSync(path.join(process.env.DATA_DIR, 'uploads'))).toHaveLength(before);
  });
});
