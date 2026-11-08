import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractMetadata } from '../src/services/metadata.js';
import { geminiResponse } from './helpers/fixtures.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const ABSTRACT =
  'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. ' +
  'We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, ' +
  'dispensing with recurrence and convolutions entirely. Experiments show these models to be superior in quality.';

const PAGE1 = `Attention Is All
You Need
Ashish Vaswani∗ Noam Shazeer†
31st Conference on Neural Information Processing Systems (NIPS 2017)
Abstract
The dominant sequence transduction models are based on complex recur-
rent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms,
dispensing with recurrence and convolutions entirely. Experiments show these models to be superior in quality.`;
const PAGE2 = 'Related work cites Hochreiter 1997.';
const PAGE3 = 'Secret third page content: Jane Doe.';

function reply(fields) {
  fetchMock.mockResolvedValueOnce(
    geminiResponse({ title: null, authors: [], year: null, year_evidence: null, abstract: null, ...fields })
  );
  return extractMetadata([PAGE1, PAGE2, PAGE3]);
}

describe('extractMetadata', () => {
  it('keeps metadata that appears in the PDF, tolerating line breaks and hyphenation', async () => {
    const meta = await reply({
      title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      year: 2017,
      year_evidence: 'NIPS 2017',
      abstract: ABSTRACT,
    });
    expect(meta).toEqual({ title: 'Attention Is All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer'], year: 2017, abstract: ABSTRACT, warnings: [] });
  });

  it('only sends the first two pages to Gemini', async () => {
    await reply({});
    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).contents[0].parts[0].text;
    expect(prompt).toContain('Hochreiter 1997');
    expect(prompt).not.toContain('Secret third page');
  });

  it('drops an author that only appears on a later page', async () => {
    const meta = await reply({ authors: ['Ashish Vaswani', 'Jane Doe', '  '] });
    expect(meta.authors).toEqual(['Ashish Vaswani']);
    expect(meta.warnings).toContain('Discarded author not found in PDF text: "Jane Doe"');
  });

  it.each([
    [{ year: 2018, year_evidence: 'NIPS 2017' }, 'evidence does not contain the year'],
    [{ year: 2017, year_evidence: 'ICML 2017' }, 'evidence is not in the PDF'],
    [{ year: 2017, year_evidence: null }, 'no evidence'],
  ])('discards an unsupported year: %j (%s)', async (fields) => {
    const meta = await reply(fields);
    expect(meta.year).toBeNull();
    expect(meta.warnings.some((w) => w.startsWith(`Discarded year ${fields.year}`))).toBe(true);
    expect(meta.warnings).toContain('Publication year could not be determined from the PDF');
  });

  it('ignores a non-integer year', async () => {
    const meta = await reply({ year: '2017', year_evidence: 'NIPS 2017' });
    expect(meta.year).toBeNull();
  });

  it('discards a paraphrased abstract', async () => {
    const meta = await reply({ abstract: 'This paper introduces the Transformer, an attention-only model.' });
    expect(meta.abstract).toBeNull();
    expect(meta.warnings).toContain('Discarded abstract: it does not match the PDF text');
  });

  it('accepts a long abstract whose start and end match despite small cleanup differences', async () => {
    const tweaked = ABSTRACT.replace('a new simple network architecture', 'a new, simple network architecture (sic)');
    const meta = await reply({ abstract: tweaked });
    expect(meta.abstract).toBe(tweaked);
  });

  // Round 3 (mutation feedback) additions.
  it('sends at most 15,000 characters of the first pages', async () => {
    fetchMock.mockResolvedValueOnce(geminiResponse({ title: null, authors: [], year: null, year_evidence: null, abstract: null }));
    await extractMetadata([`${'a'.repeat(14990)}MARKER-IN${'b'.repeat(100)}MARKER-OUT`]);
    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).contents[0].parts[0].text;
    expect(prompt).toContain('MARKER-IN');
    expect(prompt).not.toContain('MARKER-OUT');
  });

  it('cleans line breaks in the title and keeps it when it matches', async () => {
    const meta = await reply({ title: 'Attention Is\n All   You Need' });
    expect(meta.title).toBe('Attention Is All You Need');
  });

  it('requires a short abstract (≤200 chars) to match exactly: no start/end tolerance', async () => {
    const short = 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer.';
    expect(short.length).toBeLessThan(200);
    const tweaked = short.replace('a new simple', 'a brand new simple');
    expect((await reply({ abstract: short })).abstract).toBe(short);
    expect((await reply({ abstract: tweaked })).abstract).toBeNull();
  });

  it('rejects a long abstract whose ending does not match', async () => {
    const meta = await reply({ abstract: `${ABSTRACT.slice(0, -20)} and it is great.` });
    expect(meta.abstract).toBeNull();
  });

  it('warns about every missing field', async () => {
    const meta = await reply({});
    expect(meta.warnings).toEqual([
      'Title could not be determined from the PDF',
      'Authors could not be determined from the PDF',
      'Publication year could not be determined from the PDF',
      'Abstract could not be determined from the PDF',
    ]);
  });
});
