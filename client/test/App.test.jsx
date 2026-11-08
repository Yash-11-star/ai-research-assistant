import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import { mockApi, makePaper } from './helpers.js';

const navLink = (name) => screen.getByRole('link', { name });
const go = (hash) => act(() => {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
});

describe('App navigation', () => {
  it('starts on Search by default', () => {
    mockApi({ 'GET /api/papers': [] });
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Search papers' })).toBeInTheDocument();
    expect(navLink('Search Papers')).toHaveAttribute('aria-current', 'page');
    expect(document.title).toBe('Search · AI Research Assistant');
  });

  it('switches pages from the URL hash and marks the current link', async () => {
    mockApi({ 'GET /api/papers': [] });
    render(<App />);
    go('#/library');
    expect(await screen.findByRole('heading', { name: 'My library' })).toBeInTheDocument();
    expect(navLink('My Library')).toHaveAttribute('aria-current', 'page');
    expect(navLink('Search Papers')).not.toHaveAttribute('aria-current');
    expect(document.title).toBe('My Library · AI Research Assistant');
    expect(document.getElementById('main')).toHaveFocus();

    go('#/upload');
    expect(screen.getByRole('heading', { name: 'Upload a PDF' })).toBeInTheDocument();
  });

  it('opens a paper from #/paper/:id and highlights My Library', async () => {
    mockApi({ 'GET /api/papers/3': makePaper({ id: 3 }) });
    window.location.hash = '#/paper/3';
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Paper assistant' })).toBeInTheDocument();
    expect(navLink('My Library')).toHaveAttribute('aria-current', 'true');
    expect(navLink('My Library')).toHaveClass('active');
    expect(document.title).toBe('Paper · AI Research Assistant');
  });

  it.each(['#/nonsense', '#/paper/abc', '#/paper/'])('falls back to Search for %s', (hash) => {
    mockApi({ 'GET /api/papers': [] });
    window.location.hash = hash;
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Search papers' })).toBeInTheDocument();
  });

  it('keeps search results when switching tabs and back', async () => {
    mockApi({
      'GET /api/papers': [],
      'GET /api/search': { query: 'x', total: 1, results: [{ ...makePaper({ title: 'Kept result' }), provider: 'arxiv' }] },
    });
    render(<App />);
    await userEvent.type(screen.getByLabelText('Research topic or keywords'), 'x{Enter}');
    expect(await screen.findByText('Kept result')).toBeInTheDocument();
    go('#/library');
    await screen.findByRole('heading', { name: 'My library' });
    go('#/search');
    expect(screen.getByText('Kept result')).toBeInTheDocument();
    expect(screen.getByLabelText('Research topic or keywords')).toHaveValue('x');
  });

  it('skip link moves focus to the main content without changing the page', async () => {
    mockApi({ 'GET /api/papers': [] });
    render(<App />);
    await userEvent.click(screen.getByRole('link', { name: 'Skip to content' }));
    expect(document.getElementById('main')).toHaveFocus();
    expect(window.location.hash).toBe('');
  });
});
