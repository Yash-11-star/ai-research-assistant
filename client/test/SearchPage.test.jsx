import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchPage from '../src/pages/SearchPage.jsx';
import { mockApi, json, deferred, makePaper } from './helpers.js';

const initialSearch = { query: '', status: 'idle', submitted: '', total: 0, results: [], error: null };

// SearchPage keeps its state in App; this wrapper plays App's role.
function Harness() {
  const [search, setSearch] = useState(initialSearch);
  return <SearchPage search={search} setSearch={setSearch} />;
}

const result = (n, extra = {}) => ({ ...makePaper({ external_id: `arxiv:${n}`, title: `Paper ${n}` }), id: undefined, source: undefined, provider: 'arxiv', ...extra });

async function searchFor(text) {
  await userEvent.type(screen.getByLabelText('Research topic or keywords'), text);
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
}

describe('SearchPage', () => {
  it('asks for keywords instead of searching when the box is blank', async () => {
    const fetchMock = mockApi({ 'GET /api/papers': [] });
    render(<Harness />);
    await searchFor('   ');
    expect(screen.getByText('Enter a research topic or keywords to search.')).toBeInTheDocument();
    expect(screen.getByLabelText('Research topic or keywords')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock.mock.calls.some(([u]) => u.startsWith('/api/search'))).toBe(false);
  });

  it('shows a loading message, then the results with a count', async () => {
    const pending = deferred();
    mockApi({ 'GET /api/papers': [], 'GET /api/search': () => pending.promise });
    render(<Harness />);
    await searchFor('  transformer attention ');

    expect(screen.getByText('Searching arXiv for “transformer attention”…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Searching…' })).toBeDisabled();

    pending.resolve(json({ query: 'transformer attention', total: 1234, results: [result(1), result(2)] }));
    expect(await screen.findByText('Showing 2 of 1,234 results for “transformer attention”.')).toBeInTheDocument();
    expect(screen.getAllByRole('article').map((a) => within(a).getByRole('heading').textContent)).toEqual(['Paper 1', 'Paper 2']);
  });

  it('tells the user when nothing was found', async () => {
    mockApi({ 'GET /api/papers': [], 'GET /api/search': { query: 'zzz', total: 0, results: [] } });
    render(<Harness />);
    await searchFor('zzz');
    expect(await screen.findByText('No papers found for “zzz”. Try different or fewer keywords.')).toBeInTheDocument();
  });

  it('shows the server error when the search fails', async () => {
    mockApi({
      'GET /api/papers': [],
      'GET /api/search': json({ error: 'arXiv is temporarily rate-limiting requests. Please wait a few minutes and try again.' }, 503),
    });
    render(<Harness />);
    await searchFor('graphs');
    expect(await screen.findByRole('alert')).toHaveTextContent('Search failed: arXiv is temporarily rate-limiting requests.');
  });

  it('saves a result to the library and marks it saved', async () => {
    const saved = deferred();
    const fetchMock = mockApi({
      'GET /api/papers': [],
      'GET /api/search': { query: 'x', total: 1, results: [result(1)] },
      'POST /api/papers': () => saved.promise,
    });
    render(<Harness />);
    await searchFor('x');
    await userEvent.click(await screen.findByRole('button', { name: 'Save to Library' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

    saved.resolve(json({ ...result(1), id: 5, source: 'search' }, 201));
    expect(await screen.findByRole('button', { name: '✓ Saved' })).toBeDisabled();
    expect(screen.getByText('In your library')).toBeInTheDocument();

    const body = JSON.parse(fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')[1].body);
    expect(body).toMatchObject({ external_id: 'arxiv:1', title: 'Paper 1' });
  });

  it('treats "already in your library" (409) as saved', async () => {
    mockApi({
      'GET /api/papers': [],
      'GET /api/search': { query: 'x', total: 1, results: [result(1)] },
      'POST /api/papers': json({ error: 'Paper is already in your library' }, 409),
    });
    render(<Harness />);
    await searchFor('x');
    await userEvent.click(await screen.findByRole('button', { name: 'Save to Library' }));
    expect(await screen.findByRole('button', { name: '✓ Saved' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a save error on the card and lets the user retry', async () => {
    mockApi({
      'GET /api/papers': [],
      'GET /api/search': { query: 'x', total: 1, results: [result(1)] },
      'POST /api/papers': json({ error: 'title is required' }, 400),
    });
    render(<Harness />);
    await searchFor('x');
    await userEvent.click(await screen.findByRole('button', { name: 'Save to Library' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save: title is required');
    expect(screen.getByRole('button', { name: 'Save to Library' })).toBeEnabled();
  });

  it('marks results that are already in the library', async () => {
    mockApi({
      'GET /api/papers': [makePaper({ external_id: 'arxiv:2' })],
      'GET /api/search': { query: 'x', total: 2, results: [result(1), result(2)] },
    });
    render(<Harness />);
    await searchFor('x');
    const cards = await screen.findAllByRole('article');
    expect(within(cards[0]).getByRole('button', { name: 'Save to Library' })).toBeEnabled();
    expect(within(cards[1]).getByRole('button', { name: '✓ Saved' })).toBeDisabled();
  });

  it('still works when the library cannot be loaded', async () => {
    mockApi({
      'GET /api/papers': json({ error: 'down' }, 500),
      'GET /api/search': { query: 'x', total: 1, results: [result(1)] },
    });
    render(<Harness />);
    await searchFor('x');
    expect(await screen.findByRole('button', { name: 'Save to Library' })).toBeEnabled();
  });

  it('ignores the response of an older search that arrives late', async () => {
    const first = deferred();
    const second = deferred();
    const queue = [first, second];
    mockApi({ 'GET /api/papers': [], 'GET /api/search': () => queue.shift().promise });
    render(<Harness />);
    await searchFor('old');
    const input = screen.getByLabelText('Research topic or keywords');
    // (Round 2 fix: the first version pressed Enter, but implicit submission is
    // blocked while the Search button is disabled, so a user cannot actually
    // start a second search mid-flight. The guard is defensive; submit the
    // form directly to exercise it.)
    await userEvent.clear(input);
    await userEvent.type(input, 'new');
    fireEvent.submit(screen.getByRole('search'));

    second.resolve(json({ query: 'new', total: 1, results: [result(2)] }));
    expect(await screen.findByText('Paper 2')).toBeInTheDocument();
    first.resolve(json({ query: 'old', total: 1, results: [result(1)] }));
    await waitFor(() => expect(screen.queryByText('Paper 1')).not.toBeInTheDocument());
    expect(screen.getByText(/results for “new”/)).toBeInTheDocument();
  });
});
