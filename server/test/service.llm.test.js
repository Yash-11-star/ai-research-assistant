import { describe, it, expect, vi, beforeEach } from 'vitest';
import { summarizePaper, answerQuestion, NOT_STATED, NOT_ENOUGH_INFO } from '../src/services/llm.js';
import { geminiResponse } from './helpers/fixtures.js';

// Round 3 (mutation feedback): pin down how Gemini's raw output is turned into
// the API response, including malformed and adversarial model output.
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const paper = { id: 1, title: 'Attention Is All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer'], year: 2017 };
const TEXT = 'We use the WMT 2014 English-German dataset. The model reaches 28.4 BLEU.';
const reply = (obj) => fetchMock.mockResolvedValueOnce(geminiResponse(obj));
const prompt = () => JSON.parse(fetchMock.mock.calls.at(-1)[1].body).contents[0].parts[0].text;
const schema = () => JSON.parse(fetchMock.mock.calls.at(-1)[1].body).generationConfig.responseSchema;

describe('summarizePaper', () => {
  it('requests all seven fields in order and cleans whitespace in each', async () => {
    reply({ tldr: '  Two\n  lines ', problem: 'P', approach: 'A', methods: 'M', datasets_and_experiments: 'D', results: 'R', limitations: 'L' });
    const { summary, model, context } = await summarizePaper(paper, TEXT);
    expect(Object.keys(summary)).toEqual(['tldr', 'problem', 'approach', 'methods', 'datasets_and_experiments', 'results', 'limitations']);
    expect(summary.tldr).toBe('Two lines');
    expect(model).toBe('model-a');
    expect(context).toEqual({ truncated: false, chars_used: TEXT.length, chars_total: TEXT.length });
    expect(schema().required).toEqual(Object.keys(summary));
    expect(schema().propertyOrdering).toEqual(Object.keys(summary));
  });

  it.each([[''], ['   '], [null], [42], [['list']]])('replaces an empty or non-text field (%j) with the "not stated" text', async (value) => {
    reply({ tldr: 'T', problem: value });
    const { summary } = await summarizePaper(paper, TEXT);
    expect(summary.problem).toBe(NOT_STATED);
    expect(summary.tldr).toBe('T');
  });

  it('puts the title, authors and year in a fenced <paper> block', async () => {
    reply({});
    await summarizePaper(paper, TEXT);
    expect(prompt()).toContain(`<paper>\nTitle: Attention Is All You Need\nAuthors: Ashish Vaswani, Noam Shazeer\nYear: 2017\n\n${TEXT}\n</paper>`);
  });

  it('says "unknown" for missing authors and year', async () => {
    reply({});
    await summarizePaper({ ...paper, authors: [], year: null }, TEXT);
    expect(prompt()).toContain('Authors: unknown\nYear: unknown');
  });
});

describe('answerQuestion', () => {
  it('returns the cleaned answer, the question, verified evidence and the model', async () => {
    reply({ found_in_paper: true, answer: ' WMT 2014\n English-German. ', evidence: ['  We use the WMT 2014\nEnglish-German dataset  '] });
    const result = await answerQuestion(paper, TEXT, 'Which dataset?');
    expect(result).toEqual({
      question: 'Which dataset?',
      found_in_paper: true,
      answer: 'WMT 2014 English-German.',
      evidence: ['We use the WMT 2014 English-German dataset'],
      model: 'model-a',
      context: { truncated: false, chars_used: TEXT.length, chars_total: TEXT.length },
    });
  });

  it.each([['true'], [1], [null], [undefined]])('only treats found_in_paper === true as found (got %j)', async (found) => {
    reply({ found_in_paper: found, answer: 'Some answer.', evidence: ['We use the WMT 2014'] });
    const result = await answerQuestion(paper, TEXT, 'Q');
    expect(result.found_in_paper).toBe(false);
    expect(result.answer).toBe(`${NOT_ENOUGH_INFO} Some answer.`);
    expect(result.evidence).toEqual([]);
    expect(result).not.toHaveProperty('warning');
  });

  it('does not repeat the not-enough-information sentence when the model already used it', async () => {
    reply({ found_in_paper: false, answer: `${NOT_ENOUGH_INFO} It covers translation.` });
    expect((await answerQuestion(paper, TEXT, 'Q')).answer).toBe(`${NOT_ENOUGH_INFO} It covers translation.`);
  });

  it('uses the not-enough-information sentence alone when the model gives no answer', async () => {
    reply({ found_in_paper: false, answer: '' });
    expect((await answerQuestion(paper, TEXT, 'Q')).answer).toBe(NOT_ENOUGH_INFO);
  });

  it.each([['a string'], [null], [{ 0: 'x' }]])('treats non-array evidence (%j) as no evidence, with a warning', async (evidence) => {
    reply({ found_in_paper: true, answer: 'Yes.', evidence });
    const result = await answerQuestion(paper, TEXT, 'Q');
    expect(result.evidence).toEqual([]);
    expect(result.warning).toBe('No supporting quote from the paper could be verified for this answer; double-check it against the paper.');
  });

  it('drops blank and non-string quotes but keeps valid ones in order', async () => {
    reply({ found_in_paper: true, answer: 'x', evidence: ['28.4 BLEU', '', 7, '  ', 'WMT 2014 English-German'] });
    expect((await answerQuestion(paper, TEXT, 'Q')).evidence).toEqual(['28.4 BLEU', 'WMT 2014 English-German']);
  });

  it('verifies quotes against the full paper text, not only the part sent to the model', async () => {
    const long = `${'Intro line.\n'.repeat(12000)}The secret sauce is label smoothing.\n${'Tail line.\n'.repeat(1000)}`;
    reply({ found_in_paper: true, answer: 'x', evidence: ['The secret sauce is label smoothing.'] });
    const result = await answerQuestion(paper, long, 'unrelated words only');
    expect(result.context.truncated).toBe(true);
    expect(result.evidence).toEqual(['The secret sauce is label smoothing.']);
  });

  it('asks for the structured answer schema', async () => {
    reply({ found_in_paper: true, answer: 'x', evidence: [] });
    await answerQuestion(paper, TEXT, 'Q');
    expect(schema()).toEqual({
      type: 'object',
      properties: { found_in_paper: { type: 'boolean' }, answer: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } },
      required: ['found_in_paper', 'answer', 'evidence'],
      propertyOrdering: ['found_in_paper', 'answer', 'evidence'],
    });
    expect(prompt()).toContain('1-3 short quotes (under 30 words each) copied EXACTLY from the paper text');
  });
});
