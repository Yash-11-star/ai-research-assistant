import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaperPage from '../src/pages/PaperPage.jsx';
import { mockApi, json, deferred, makePaper } from './helpers.js';

// PaperPage caches results per paper id for the browser session, so every
// test uses its own id.
let nextId = 100;
const setup = (routes, paperOverrides = {}) => {
  const id = nextId++;
  const paper = makePaper({ id, has_full_text: true, ...paperOverrides });
  const fetchMock = mockApi({ [`GET /api/papers/${id}`]: paper, ...routes(id) });
  render(<PaperPage id={id} />);
  return { id, paper, fetchMock };
};

const summary = {
  tldr: 'Introduces the Transformer.',
  problem: 'Recurrent models are slow.',
  approach: 'Attention only.',
  methods: 'Multi-head attention.',
  datasets_and_experiments: 'WMT 2014.',
  results: '28.4 BLEU.',
  limitations: 'The paper does not explicitly discuss limitations.',
};

const answer = (overrides = {}) => ({
  question: 'What datasets are used?',
  found_in_paper: true,
  answer: 'WMT 2014 English-German.',
  evidence: ['We use the WMT 2014 English-German dataset'],
  context: { truncated: false, chars_used: 100, chars_total: 100 },
  content_source: 'stored',
  ...overrides,
});

const box = () => screen.getByLabelText('Your question about this paper');

describe('PaperPage: loading', () => {
  it('shows the paper with its abstract expanded', async () => {
    setup(() => ({}), { abstract: 'long '.repeat(100) });
    expect(screen.getByText('Loading paper…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Paper assistant' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Back to My Library' })).toHaveAttribute('href', '#/library');
  });

  it.each([404, 400])('explains a missing paper (%i)', async (status) => {
    mockApi({ 'GET /api/papers/5': json({ error: 'Paper not found' }, status) });
    render(<PaperPage id={5} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This paper is not in your library (it may have been deleted).');
  });

  it('shows other load errors as they are', async () => {
    mockApi({ 'GET /api/papers/6': () => Promise.reject(new TypeError('x')) });
    render(<PaperPage id={6} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server. Is the backend running?');
  });
});

describe('PaperPage: summary', () => {
  it('generates and shows every summary section', async () => {
    const pending = deferred();
    setup((id) => ({ [`POST /api/papers/${id}/summary`]: () => pending.promise }));
    await userEvent.click(await screen.findByRole('button', { name: 'Generate Summary' }));
    expect(screen.getByRole('button', { name: 'Generating…' })).toBeDisabled();
    expect(screen.getByText(/Generating summary… this usually takes 10–30 seconds/)).toBeInTheDocument();

    pending.resolve(json({ summary, context: { truncated: false }, content_source: 'stored' }));
    const terms = await screen.findAllByRole('term');
    expect(terms.map((t) => t.textContent)).toEqual([
      'TL;DR', 'Problem / Motivation', 'Approach', 'Methods / Architecture', 'Datasets & Experiments', 'Main Results', 'Limitations / Caveats',
    ]);
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual(Object.values(summary));
    expect(screen.getByRole('button', { name: 'Regenerate summary' })).toBeEnabled();
    expect(screen.queryByText(/This paper is long/)).not.toBeInTheDocument();
  });

  it('warns that downloading is slower when there is no full text yet, then updates the badge', async () => {
    const pending = deferred();
    setup((id) => ({ [`POST /api/papers/${id}/summary`]: () => pending.promise }), { has_full_text: false });
    expect(await screen.findByText('Full text fetched on first use')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generate Summary' }));
    expect(screen.getByText(/Downloading the paper PDF and generating a summary/)).toBeInTheDocument();

    pending.resolve(json({ summary, context: { truncated: false }, content_source: 'downloaded' }));
    expect(await screen.findByText('Full text available')).toBeInTheDocument();
  });

  it('notes when only part of a long paper was used', async () => {
    setup((id) => ({ [`POST /api/papers/${id}/summary`]: { summary, context: { truncated: true, chars_used: 120000, chars_total: 480000 } } }));
    await userEvent.click(await screen.findByRole('button', { name: 'Generate Summary' }));
    expect(await screen.findByText(/only the most relevant parts \(25% of the text\) were used/)).toBeInTheDocument();
  });

  it('shows an error when the summary fails', async () => {
    setup((id) => ({ [`POST /api/papers/${id}/summary`]: json({ error: 'AI request failed: Gemini is temporarily unavailable' }, 503) }));
    await userEvent.click(await screen.findByRole('button', { name: 'Generate Summary' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not generate a summary: AI request failed: Gemini is temporarily unavailable');
    expect(screen.getByRole('button', { name: 'Generate Summary' })).toBeEnabled();
  });
});

describe('PaperPage: questions', () => {
  it('asks for a question instead of sending a blank one', async () => {
    const { fetchMock } = setup(() => ({}));
    await userEvent.click(await screen.findByRole('button', { name: 'Ask' }));
    expect(screen.getByText('Type a question about this paper first.')).toBeInTheDocument();
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect(box()).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the paper load
  });

  it('answers with evidence quotes, submitting with Enter', async () => {
    const pending = deferred();
    const { fetchMock, id } = setup((pid) => ({ [`POST /api/papers/${pid}/questions`]: () => pending.promise }));
    await userEvent.type(await screen.findByLabelText('Your question about this paper'), '  What datasets are used?  {Enter}');
    expect(screen.getByText('Reading the paper to answer “What datasets are used?”…')).toBeInTheDocument();
    expect(box()).toBeDisabled();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ question: 'What datasets are used?' });
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/papers/${id}/questions`);

    pending.resolve(json(answer()));
    const article = await screen.findByRole('article', { name: 'Q: What datasets are used?' });
    expect(within(article).getByText('WMT 2014 English-German.')).toBeInTheDocument();
    expect(within(article).getByRole('heading', { name: 'Evidence from paper' })).toBeInTheDocument();
    expect(within(article).getByText('“We use the WMT 2014 English-German dataset”')).toBeInTheDocument();
    expect(within(article).queryByText(/Not covered by this paper/)).not.toBeInTheDocument();
  });

  it('Shift+Enter adds a new line instead of submitting', async () => {
    const { fetchMock } = setup(() => ({}));
    await userEvent.type(await screen.findByLabelText('Your question about this paper'), 'line one{Shift>}{Enter}{/Shift}line two');
    expect(box().value).toBe('line one\nline two');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says clearly when the paper does not cover the question', async () => {
    setup((id) => ({
      [`POST /api/papers/${id}/questions`]: answer({
        question: 'Who funded it?',
        found_in_paper: false,
        answer: 'The paper does not provide enough information to answer this question.',
        evidence: [],
      }),
    }));
    await userEvent.type(await screen.findByLabelText('Your question about this paper'), 'Who funded it?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Not covered by this paper.')).toBeInTheDocument();
    expect(screen.queryByText('Evidence from paper')).not.toBeInTheDocument();
  });

  it('shows the grounding warning when no quote could be verified', async () => {
    const warning = 'No supporting quote from the paper could be verified for this answer; double-check it against the paper.';
    setup((id) => ({ [`POST /api/papers/${id}/questions`]: answer({ evidence: [], warning }) }));
    await userEvent.type(await screen.findByLabelText('Your question about this paper'), 'Q?{Enter}');
    expect(await screen.findByText(warning)).toBeInTheDocument();
    expect(screen.queryByText('Evidence from paper')).not.toBeInTheDocument();
  });

  it('example questions fill the box without sending', async () => {
    const { fetchMock } = setup(() => ({}));
    await userEvent.click(await screen.findByRole('button', { name: 'What are the major limitations?' }));
    expect(box().value).toBe('What are the major limitations?');
    expect(box()).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows an error for a failed question and keeps the typed question', async () => {
    setup((id) => ({ [`POST /api/papers/${id}/questions`]: json({ error: 'question must be at most 1000 characters' }, 400) }));
    await userEvent.type(await screen.findByLabelText('Your question about this paper'), 'Why?{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not answer “Why?”: question must be at most 1000 characters');
    expect(box().value).toBe('Why?');
  });

  it('remembers the last summary and answer when the paper is reopened', async () => {
    const id = nextId++;
    const paper = makePaper({ id, has_full_text: true });
    const fetchMock = mockApi({
      [`GET /api/papers/${id}`]: paper,
      [`POST /api/papers/${id}/summary`]: { summary, context: { truncated: false } },
      [`POST /api/papers/${id}/questions`]: answer(),
    });
    const { unmount } = render(<PaperPage id={id} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Generate Summary' }));
    await screen.findByText(summary.tldr);
    await userEvent.type(box(), 'Q?{Enter}');
    await screen.findByText('WMT 2014 English-German.');
    unmount();

    render(<PaperPage id={id} />);
    expect(await screen.findByText(summary.tldr)).toBeInTheDocument();
    expect(screen.getByText('WMT 2014 English-German.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(2); // no new AI calls
  });
});
