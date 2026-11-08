import { describe, it, expect, vi } from 'vitest';
import { makePdf } from './helpers/fixtures.js';

// Round 3 (mutation feedback): PDF extraction thresholds and error mapping.
// unpdf is wrapped so individual tests can make it fail in specific ways.
const failures = { load: null, extract: null };
vi.mock('unpdf', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    getDocumentProxy: (...args) => (failures.load ? Promise.reject(failures.load) : real.getDocumentProxy(...args)),
    extractText: (...args) => (failures.extract ? Promise.reject(failures.extract) : real.extractText(...args)),
  };
});
const { extractPdfText, PdfError } = await import('../src/services/pdf.js');

const errorOf = (p) => p.then(() => null, (e) => e);
// pdf.js ignores text drawn past the page edge, so wrap long text at 80 chars.
const wrap = (text) => text.match(/.{1,80}/g);
const pdfOf = (...pages) => makePdf(pages.map(wrap));

describe('extractPdfText', () => {
  it('returns trimmed text per page and the page count', async () => {
    const pdf = await pdfOf(`First page ${'a'.repeat(200)}`, 'Second page');
    const { totalPages, pages } = await extractPdfText(pdf);
    expect(totalPages).toBe(2);
    expect(pages).toHaveLength(2);
    expect(pages[0].startsWith('First page')).toBe(true);
    expect(pages[1]).toBe('Second page');
  });

  it('accepts exactly 200 non-space characters and rejects 199', async () => {
    await expect(extractPdfText(await pdfOf('b'.repeat(200)))).resolves.toMatchObject({ totalPages: 1 });
    const err = await errorOf(extractPdfText(await pdfOf('b'.repeat(199))));
    expect(err).toBeInstanceOf(PdfError);
    expect(err.status).toBe(422);
  });

  it('does not count whitespace as readable text', async () => {
    // 150 letters spread over many words and lines: lots of whitespace, too few letters.
    const err = await errorOf(extractPdfText(await makePdf([Array(30).fill('c c c c c')])));
    expect(err.message).toBe('No readable text found in the PDF (is it a scanned image?)');
  });

  it('reports a password-protected PDF', async () => {
    failures.load = Object.assign(new Error('No password given'), { name: 'PasswordException' });
    const err = await errorOf(extractPdfText(Buffer.from('%PDF-1.7')));
    failures.load = null;
    expect(err).toMatchObject({ message: 'PDF is password-protected', status: 422 });
  });

  it('reports an unexpected text-extraction failure', async () => {
    failures.extract = new Error('pdf.js internal error');
    const err = await errorOf(extractPdfText(await pdfOf('d'.repeat(300))));
    failures.extract = null;
    expect(err).toBeInstanceOf(PdfError);
    expect(err.message).toBe('Failed to extract text from the PDF');
  });

  it('does not modify the caller\'s buffer', async () => {
    const pdf = await pdfOf('e'.repeat(300));
    const copy = Buffer.from(pdf);
    await extractPdfText(pdf);
    expect(pdf.equals(copy)).toBe(true);
  });
});
