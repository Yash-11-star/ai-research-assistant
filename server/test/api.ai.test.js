import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { insertPaper } from '../src/db.js';
import { geminiResponse } from './helpers/fixtures.js';

const fetchMock = vi.fn();
const FULL_TEXT = 'Attention Is All You Need\n\nWe propose the Transformer.\n\nWe use the WMT 2014 English-German dataset and reach 28.4 BLEU.';

let withText;
let metadataOnly;

beforeAll(() => {
  withText = insertPaper({ title: 'Attention Is All You Need', authors: ['A. Vaswani'], year: 2017, source: 'upload', pdf_path: 'uploads/x.pdf', full_text: FULL_TEXT });
  metadataOnly = insertPaper({ title: 'No Text', source: 'search', external_id: 'arxiv:0000.0000' });
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const summary = {
  tldr: 'Introduces the Transformer.',
  problem: 'Recurrent models are slow.',
  approach: 'Use only attention.',
  methods: 'Multi-head attention.',
  datasets_and_experiments: 'WMT 2014.',
  results: '28.4 BLEU.',
  limitations: 'The paper does not explicitly discuss limitations.',
};

describe('POST /api/papers/:id/summary', () => {
  it('returns a structured summary generated from stored text', async () => {
    fetchMock.mockResolvedValue(geminiResponse(summary));
    const res = await request(app).post(`/api/papers/${withText.id}/summary`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ paper_id: withText.id, title: withText.title, summary, model: 'model-a', content_source: 'stored' });
    expect(res.body.context).toEqual({ truncated: false, chars_used: FULL_TEXT.length, chars_total: FULL_TEXT.length });

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.contents[0].parts[0].text).toContain(FULL_TEXT);
  });

  it('fills missing summary fields with "Not stated in the paper."', async () => {
    fetchMock.mockResolvedValue(geminiResponse({ tldr: 'Short.' }));
    const res = await request(app).post(`/api/papers/${withText.id}/summary`);
    expect(res.body.summary.tldr).toBe('Short.');
    expect(res.body.summary.results).toBe('Not stated in the paper.');
  });

  it('returns 404 for an unknown paper', async () => {
    const res = await request(app).post('/api/papers/424242/summary');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Paper not found');
  });

  it('returns 422 for a paper with no text and no PDF link', async () => {
    const res = await request(app).post(`/api/papers/${metadataOnly.id}/summary`);
    expect(res.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/papers/:id/questions', () => {
  it('answers with evidence quotes that are verified against the paper', async () => {
    fetchMock.mockResolvedValue(
      geminiResponse({
        found_in_paper: true,
        answer: 'WMT 2014 English-German.',
        evidence: ['We use the WMT 2014 English-German dataset', 'We train on ImageNet'],
      })
    );
    const res = await request(app).post(`/api/papers/${withText.id}/questions`).send({ question: '  What datasets are used?  ' });
    expect(res.status).toBe(200);
    expect(res.body.question).toBe('What datasets are used?');
    expect(res.body.found_in_paper).toBe(true);
    expect(res.body.evidence).toEqual(['We use the WMT 2014 English-German dataset']);
    expect(res.body.warning).toBeUndefined();
  });

  it('prefixes the not-enough-information sentence when the answer is not in the paper', async () => {
    fetchMock.mockResolvedValue(geminiResponse({ found_in_paper: false, answer: 'It covers translation.', evidence: ['x'] }));
    const res = await request(app).post(`/api/papers/${withText.id}/questions`).send({ question: 'Who funded it?' });
    expect(res.body.answer).toBe('The paper does not provide enough information to answer this question. It covers translation.');
    expect(res.body.evidence).toEqual([]);
  });

  it('warns when no evidence quote can be verified', async () => {
    fetchMock.mockResolvedValue(geminiResponse({ found_in_paper: true, answer: 'Yes.', evidence: ['made up quote'] }));
    const res = await request(app).post(`/api/papers/${withText.id}/questions`).send({ question: 'Is it fast?' });
    expect(res.body.evidence).toEqual([]);
    expect(res.body.warning).toMatch(/No supporting quote/);
  });

  it.each([
    [{}, 'question is required'],
    [{ question: 42 }, 'question must be a string'],
    [{ question: '   ' }, 'question cannot be blank'],
    [{ question: 'x'.repeat(1001) }, 'question must be at most 1000 characters'],
  ])('rejects %j with 400', async (body, message) => {
    const res = await request(app).post(`/api/papers/${withText.id}/questions`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
  });

  it('maps a Gemini outage to 503', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fetchMock.mockImplementation(async () => new Response('{}', { status: 503 }));
    const pending = request(app).post(`/api/papers/${withText.id}/questions`).send({ question: 'What?' });
    const done = pending.then((r) => r);
    await vi.runAllTimersAsync();
    const res = await done;
    vi.useRealTimers();
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/AI request failed: Gemini is temporarily unavailable/);
  });
});
