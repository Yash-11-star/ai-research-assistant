import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import app from '../src/app.js';
import { getPaperInternals } from '../src/db.js';
import { samplePdf, makePdf, geminiResponse } from './helpers/fixtures.js';
import { knownBug } from './helpers/knownBug.js';

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

    // Stored under a random name, never the user's file name.
    const { pdf_path } = getPaperInternals(res.body.id);
    expect(pdf_path).toMatch(/^uploads\/[0-9a-f-]{36}\.pdf$/);
    expect(fs.readFileSync(path.join(process.env.DATA_DIR, pdf_path)).subarray(0, 5).toString()).toBe('%PDF-');
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

  it('rejects files over 20 MB with 413', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(20 * 1024 * 1024)]);
    const res = await request(app).post('/api/papers/upload').attach('file', big, 'big.pdf');
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('PDF must be at most 20 MB');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a file sent in the wrong form field', async () => {
    const res = await request(app).post('/api/papers/upload').attach('document', await samplePdf(), 'paper.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Upload exactly one PDF in the form field "file"');
  });

  it('rejects more than one file', async () => {
    const pdf = await samplePdf();
    const res = await request(app).post('/api/papers/upload').attach('file', pdf, 'a.pdf').attach('file', pdf, 'b.pdf');
    expect(res.status).toBe(400);
  });

  it('rejects extra form fields', async () => {
    const res = await request(app).post('/api/papers/upload').field('title', 'x').attach('file', await samplePdf(), 'a.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Only a "file" field is accepted');
  });

  it('rejects a multipart body without a boundary', async () => {
    const res = await request(app).post('/api/papers/upload').set('Content-Type', 'multipart/form-data').send('x');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Malformed multipart/form-data request');
  });

  // BUG-1: busboy reports a truncated body as "Unexpected end of form", which
  // upload.js does not recognise, so the client error becomes a 500.
  knownBug('BUG-1', 'rejects a truncated multipart body with 400, not 500', async () => {
    const res = await request(app)
      .post('/api/papers/upload')
      .set('Content-Type', 'multipart/form-data; boundary=XYZ')
      .send('--XYZ\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\n\r\n%PDF-1.4 truncated');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Malformed multipart/form-data request');
  });

  it('rejects a corrupted PDF with 422', async () => {
    const res = await request(app).post('/api/papers/upload').attach('file', Buffer.from('%PDF-1.7\ngarbage garbage'), 'broken.pdf');
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('File could not be read as a PDF (it may be corrupted)');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a PDF with no text layer (e.g. a scan) with 422', async () => {
    const res = await request(app).post('/api/papers/upload').attach('file', await makePdf([['Fig. 1']]), 'scan.pdf');
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('No readable text found in the PDF (is it a scanned image?)');
  });

  it('accepts a PDF declared by MIME type even without a .pdf extension', async () => {
    fetchMock.mockResolvedValue(geminiResponse(goodMetadata));
    const res = await request(app)
      .post('/api/papers/upload')
      .attach('file', await samplePdf(), { filename: 'download', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
  });

  it('stores the full text of every page for later Q&A', async () => {
    fetchMock.mockResolvedValue(geminiResponse(goodMetadata));
    const res = await request(app).post('/api/papers/upload').attach('file', await samplePdf(), 'paper.pdf');
    const row = getPaperInternals(res.body.id);
    expect(row.full_text).toContain('Attention Is All You Need');
    expect(row.full_text).toContain('Recurrent neural networks have been firmly established');
    expect(row.pdf_path).toMatch(/^uploads\/[0-9a-f-]{36}\.pdf$/);
    expect(fs.existsSync(path.join(process.env.DATA_DIR, row.pdf_path))).toBe(true);
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
