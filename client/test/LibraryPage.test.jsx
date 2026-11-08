import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LibraryPage from '../src/pages/LibraryPage.jsx';
import { mockApi, json, deferred, makePaper } from './helpers.js';

const papers = [
  makePaper({ id: 1, title: 'Saved paper', has_full_text: false }),
  makePaper({ id: 2, title: 'Uploaded paper', source: 'upload', external_id: null, pdf_url: null, url: null, has_full_text: true, has_pdf: true }),
];

describe('LibraryPage', () => {
  it('shows a loading state, then every paper with its content label and actions', async () => {
    const list = deferred();
    mockApi({ 'GET /api/papers': () => list.promise });
    render(<LibraryPage />);
    expect(screen.getByText('Loading your library…')).toBeInTheDocument();

    list.resolve(json(papers));
    expect(await screen.findByText('2 papers in your library.')).toBeInTheDocument();
    const [saved, uploaded] = screen.getAllByRole('article');
    expect(within(saved).getByText('Full text fetched on first use')).toBeInTheDocument();
    expect(within(uploaded).getByText('Full text available')).toBeInTheDocument();
    expect(within(uploaded).getByText('Uploaded PDF')).toBeInTheDocument();
    expect(within(saved).getByRole('link', { name: 'Open "Saved paper" to summarize and ask questions' })).toHaveAttribute('href', '#/paper/1');
  });

  it('uses the singular for one paper', async () => {
    mockApi({ 'GET /api/papers': [papers[0]] });
    render(<LibraryPage />);
    expect(await screen.findByText('1 paper in your library.')).toBeInTheDocument();
  });

  it('explains an empty library', async () => {
    mockApi({ 'GET /api/papers': [] });
    render(<LibraryPage />);
    expect(await screen.findByText(/Your library is empty/)).toBeInTheDocument();
  });

  it('shows an error when the library cannot be loaded', async () => {
    mockApi({ 'GET /api/papers': () => Promise.reject(new TypeError('Failed to fetch')) });
    render(<LibraryPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your library: Cannot reach the server. Is the backend running?');
  });

  it('deletes a paper after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const del = deferred();
    const fetchMock = mockApi({ 'GET /api/papers': papers, 'DELETE /api/papers/1': () => del.promise });
    render(<LibraryPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete "Saved paper"' }));
    expect(confirm).toHaveBeenCalledWith('Delete "Saved paper" from your library?');
    expect(screen.getByRole('button', { name: 'Delete "Saved paper"' })).toHaveTextContent('Deleting…');
    expect(screen.getByRole('button', { name: 'Delete "Saved paper"' })).toBeDisabled();

    del.resolve(new Response(null, { status: 204 }));
    expect(await screen.findByText('1 paper in your library.')).toBeInTheDocument();
    expect(screen.queryByText('Saved paper')).not.toBeInTheDocument();
    expect(screen.getByText('Deleted "Saved paper".')).toBeInTheDocument(); // screen-reader notice
    expect(fetchMock).toHaveBeenCalledWith('/api/papers/1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('does nothing when the user cancels the confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = mockApi({ 'GET /api/papers': papers });
    render(<LibraryPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete "Saved paper"' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('2 papers in your library.')).toBeInTheDocument();
  });

  it('removes the paper when the server says it is already gone (404)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApi({ 'GET /api/papers': papers, 'DELETE /api/papers/1': json({ error: 'Paper not found' }, 404) });
    render(<LibraryPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete "Saved paper"' }));
    expect(await screen.findByText('1 paper in your library.')).toBeInTheDocument();
  });

  it('keeps the paper and shows an error when deletion fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApi({ 'GET /api/papers': papers, 'DELETE /api/papers/1': json({ error: 'Internal server error' }, 500) });
    render(<LibraryPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete "Saved paper"' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete: Internal server error');
    expect(screen.getByText('2 papers in your library.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete "Saved paper"' })).toBeEnabled();
  });
});
