import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { insertPaper, getPaperInternals } from '../src/db.js';
import { getPaperWithText, ContentError } from '../src/services/content.js';
import { samplePdf, geminiResponse } from './helpers/fixtures.js';

// Covers saved search results, whose full text is downloaded from arXiv the
// first time it is needed, and the arXiv-only download restriction.
const fetchMock = vi.fn();
let n = 0;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function savedResult(pdf_url = 'https://arxiv.org/pdf/1706.03762') {
  n += 1;
  return insertPaper({ title: `Saved ${n}`, source: 'search', external_id: `arxiv:test.${n}`, pdf_url });
}

function pdfResponse(buffer, { url = 'https://arxiv.org/pdf/1706.03762', status = 200, headers = {} } = {}) {
  const res = new Response(buffer, { status, headers });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

async function expectContentError(promise, status, message) {
  const err = await promise.catch((e) => e);
  expect(err).toBeInstanceOf(ContentError);
  expect(err.status).toBe(status);
  expect(err.message).toMatch(message);
}

describe('getPaperWithText: downloading a saved result', () => {
  it('downloads the PDF once, stores the text, then reuses it', async () => {
    const paper = savedResult();
    fetchMock.mockResolvedValueOnce(pdfResponse(await samplePdf()));

    const first = await getPaperWithText(paper.id);
    expect(first.contentSource).toBe('downloaded');
    expect(first.text).toContain('Attention Is All You Need');
    expect(first.paper.has_full_text).toBe(true);
    expect(getPaperInternals(paper.id).full_text).toBe(first.text);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://arxiv.org/pdf/1706.03762');

    const second = await getPaperWithText(paper.id);
    expect(second.contentSource).toBe('stored');
    expect(second.text).toBe(first.text);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['http://arxiv.org/pdf/1706.03762', /arxiv\.org is not supported/],
    ['https://evil.example.com/paper.pdf', /evil\.example\.com is not supported \(arXiv only\)/],
    ['https://169.254.169.254/latest/meta-data', /169\.254\.169\.254 is not supported/],
    ['https://arxiv.org.evil.com/pdf/1', /arxiv\.org\.evil\.com is not supported/],
  ])('refuses to fetch %s (SSRF protection)', async (url, message) => {
    const paper = savedResult(url);
    await expectContentError(getPaperWithText(paper.id), 422, message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unparsable stored PDF link', async () => {
    const paper = savedResult('not a url');
    await expectContentError(getPaperWithText(paper.id), 422, 'Paper has an invalid PDF link');
  });

  it('rejects a download redirected to a non-arXiv host', async () => {
    const paper = savedResult();
    fetchMock.mockResolvedValueOnce(pdfResponse(await samplePdf(), { url: 'https://evil.example.com/x.pdf' }));
    await expectContentError(getPaperWithText(paper.id), 502, 'PDF download was redirected to an unsupported host');
  });

  it('accepts a redirect between arXiv hosts', async () => {
    const paper = savedResult();
    fetchMock.mockResolvedValueOnce(pdfResponse(await samplePdf(), { url: 'https://export.arxiv.org/pdf/1706.03762v7' }));
    expect((await getPaperWithText(paper.id)).contentSource).toBe('downloaded');
  });

  it.each([
    [() => pdfResponse('missing', { status: 404 }), 502, 'arXiv returned HTTP 404 for the paper PDF'],
    [() => pdfResponse('x', { headers: { 'content-length': String(21 * 1024 * 1024) } }), 422, 'Paper PDF is too large to process'],
    [() => pdfResponse(Buffer.alloc(21 * 1024 * 1024)), 422, 'Paper PDF is too large to process'],
    [() => pdfResponse('<html>captcha</html>'), 502, 'The downloaded file is not a PDF'],
  ])('rejects bad downloads (%#)', async (makeResponse, status, message) => {
    const paper = savedResult();
    fetchMock.mockResolvedValueOnce(makeResponse());
    await expectContentError(getPaperWithText(paper.id), status, message);
    expect(getPaperInternals(paper.id).full_text).toBeNull();
  });

  it.each([
    [Object.assign(new Error('timeout'), { name: 'TimeoutError' }), 504, 'Timed out downloading the paper PDF from arXiv'],
    [new TypeError('fetch failed'), 502, 'Could not download the paper PDF from arXiv'],
  ])('maps network failures (%#)', async (error, status, message) => {
    const paper = savedResult();
    fetchMock.mockRejectedValueOnce(error);
    await expectContentError(getPaperWithText(paper.id), status, message);
  });
});

describe('AI routes on a saved result', () => {
  it('summary reports content_source "downloaded" on first use', async () => {
    const paper = savedResult();
    fetchMock
      .mockResolvedValueOnce(pdfResponse(await samplePdf()))
      .mockResolvedValueOnce(geminiResponse({ tldr: 'T' }));
    const res = await request(app).post(`/api/papers/${paper.id}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.content_source).toBe('downloaded');
  });

  it('maps an unreadable downloaded PDF to 422 with a clear message', async () => {
    const paper = savedResult();
    fetchMock.mockResolvedValueOnce(pdfResponse('%PDF-1.4 this is not really a pdf'));
    const res = await request(app).post(`/api/papers/${paper.id}/questions`).send({ question: 'What?' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Paper PDF could not be processed: File could not be read as a PDF (it may be corrupted)');
  });

  it('maps a blocked host to 422 through the API', async () => {
    const paper = savedResult('https://example.com/a.pdf');
    const res = await request(app).post(`/api/papers/${paper.id}/summary`);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/arXiv only/);
  });
});
