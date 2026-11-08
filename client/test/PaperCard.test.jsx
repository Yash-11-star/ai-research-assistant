import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaperCard from '../src/components/PaperCard.jsx';
import { contentLabel } from '../src/paperLabels.js';
import { makePaper, knownBug } from './helpers.js';

describe('PaperCard', () => {
  it('shows title, authors, year, source badge and external links', () => {
    render(<PaperCard paper={makePaper()} badges={['In your library']} />);
    expect(screen.getByRole('heading', { name: 'Attention Is All You Need' })).toBeInTheDocument();
    expect(screen.getByText('Ashish Vaswani, Noam Shazeer')).toBeInTheDocument();
    expect(screen.getByText('2017')).toBeInTheDocument();

    const badges = within(screen.getByRole('list', { name: 'Paper details' })).getAllByRole('listitem');
    expect(badges.map((b) => b.textContent)).toEqual(['Saved from arXiv', 'In your library']);

    const page = screen.getByRole('link', { name: /Paper page/ });
    expect(page).toHaveAttribute('href', 'https://arxiv.org/abs/1706.03762');
    expect(page).toHaveAttribute('target', '_blank');
    expect(page).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: /PDF/ })).toHaveAttribute('href', 'https://arxiv.org/pdf/1706.03762');
  });

  it('labels search results and uploads by source', () => {
    const { rerender } = render(<PaperCard paper={{ ...makePaper(), source: undefined, provider: 'arxiv' }} />);
    expect(screen.getByText('arXiv')).toBeInTheDocument();
    rerender(<PaperCard paper={makePaper({ source: 'upload' })} />);
    expect(screen.getByText('Uploaded PDF')).toBeInTheDocument();
  });

  it('shows placeholders for missing metadata and omits the footer when there is nothing to show', () => {
    const { container } = render(<PaperCard paper={makePaper({ authors: [], year: null, abstract: null, url: null, pdf_url: null })} />);
    expect(screen.getByText('Unknown authors')).toBeInTheDocument();
    expect(screen.getByText('Year unknown')).toBeInTheDocument();
    expect(screen.getByText('No abstract available.')).toBeInTheDocument();
    expect(container.querySelector('footer')).toBeNull();
  });

  it('collapses long author lists and expands them on request', async () => {
    const authors = Array.from({ length: 9 }, (_, i) => `Author ${i + 1}`);
    render(<PaperCard paper={makePaper({ authors })} />);
    expect(screen.getByText(/Author 6$/)).toBeInTheDocument();
    expect(screen.queryByText(/Author 7/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+3 more' }));
    expect(screen.getByText(authors.join(', '))).toBeInTheDocument();
  });

  it('shows exactly six authors without a "more" button', () => {
    render(<PaperCard paper={makePaper({ authors: Array.from({ length: 6 }, (_, i) => `A${i}`) })} />);
    expect(screen.queryByRole('button', { name: /more/ })).not.toBeInTheDocument();
  });

  it('previews a long abstract at a word boundary and toggles it', async () => {
    const abstract = `${'word '.repeat(100)}END`;
    render(<PaperCard paper={makePaper({ abstract })} />);
    const toggle = screen.getByRole('button', { name: 'Show full abstract' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const preview = screen.getByText(/…$/).textContent;
    expect(preview.length).toBeLessThanOrEqual(361);
    expect(preview).toMatch(/word…$/);
    expect(preview).not.toContain('END');

    await userEvent.click(toggle);
    expect(screen.getByText(abstract.trim())).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows short abstracts in full without a toggle, and can start expanded', () => {
    // (Round 2 fix: the first version used rerender(), but expandAbstract only
    // sets the initial state, so a fresh mount is needed.)
    const { unmount } = render(<PaperCard paper={makePaper({ abstract: 'Short.' })} />);
    expect(screen.getByText('Short.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /abstract|less/ })).not.toBeInTheDocument();
    unmount();
    const long = 'x '.repeat(300);
    render(<PaperCard paper={makePaper({ abstract: long })} expandAbstract />);
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    expect(screen.getByText(long.trim())).toBeInTheDocument();
  });

  // BUG-2: with no space in the first 360 characters (e.g. Chinese/Japanese
  // text, or a long URL), lastIndexOf(' ') is -1 and slice(0, -1) keeps almost
  // the whole abstract, so the "preview" is not shortened at all.
  knownBug('BUG-2', 'shortens a long abstract that has no spaces near the start', () => {
    const abstract = `${'注意力机制'.repeat(100)} and then some more words`;
    render(<PaperCard paper={makePaper({ abstract })} />);
    const preview = screen.getByText(/…$/).textContent;
    expect(preview.length).toBeLessThanOrEqual(361);
  });
});

describe('contentLabel', () => {
  it.each([
    [{ has_full_text: true, pdf_url: 'x' }, 'Full text available'],
    [{ has_full_text: false, pdf_url: 'https://arxiv.org/pdf/1' }, 'Full text fetched on first use'],
    [{ has_full_text: false, pdf_url: null }, 'Metadata only'],
  ])('%j -> %s', (paper, label) => {
    expect(contentLabel(paper)).toBe(label);
  });
});
