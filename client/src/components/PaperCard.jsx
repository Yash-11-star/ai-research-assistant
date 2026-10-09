import { useId, useState } from 'react';

const MAX_AUTHORS = 6;
const ABSTRACT_PREVIEW_CHARS = 360;

const SOURCE_LABELS = {
  search: 'Saved from arXiv',
  upload: 'Uploaded PDF',
  arxiv: 'arXiv',
};

function Authors({ authors }) {
  const [expanded, setExpanded] = useState(false);
  if (!authors?.length) return <span className="muted">Unknown authors</span>;
  if (authors.length <= MAX_AUTHORS || expanded) return <span>{authors.join(', ')}</span>;
  return (
    <span>
      {authors.slice(0, MAX_AUTHORS).join(', ')}{' '}
      <button type="button" className="link-button" onClick={() => setExpanded(true)}>
        +{authors.length - MAX_AUTHORS} more
      </button>
    </span>
  );
}

function Abstract({ text, initiallyExpanded }) {
  const [expanded, setExpanded] = useState(Boolean(initiallyExpanded));
  const id = useId();
  if (!text) return <p className="abstract muted">No abstract available.</p>;

  const long = text.length > ABSTRACT_PREVIEW_CHARS;
  // Cut the preview at a word boundary.
  const preview = long ? `${text.slice(0, text.lastIndexOf(' ', ABSTRACT_PREVIEW_CHARS))}…` : text;
  return (
    <div className="abstract">
      <p id={id}>{expanded || !long ? text : preview}</p>
      {long && (
        <button type="button" className="link-button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : 'Show full abstract'}
        </button>
      )}
    </div>
  );
}

// Shared card for search results and library papers. `badges` and `actions`
// let each page add its own labels and buttons.
export default function PaperCard({ paper, badges = [], actions, expandAbstract = false, children }) {
  const headingId = useId();
  return (
    <article className="paper-card" aria-labelledby={headingId}>
      <header>
        <h3 id={headingId} className="paper-title">{paper.title}</h3>
        <p className="paper-meta">
          <Authors authors={paper.authors} />
          <span aria-hidden="true"> · </span>
          <span>{paper.year ?? 'Year unknown'}</span>
        </p>
        <ul className="badges" aria-label="Paper details">
          {[SOURCE_LABELS[paper.source ?? paper.provider], ...badges].filter(Boolean).map((b) => (
            <li key={b} className="badge">{b}</li>
          ))}
        </ul>
      </header>

      <Abstract text={paper.abstract} initiallyExpanded={expandAbstract} />

      {(paper.url || paper.pdf_url || actions) && (
        <footer className="paper-footer">
          <div className="paper-links">
            {paper.url && (
              <a href={paper.url} target="_blank" rel="noopener noreferrer">
                Paper page<span className="sr-only"> (opens in a new tab)</span> ↗
              </a>
            )}
            {paper.pdf_url && (
              <a href={paper.pdf_url} target="_blank" rel="noopener noreferrer">
                PDF<span className="sr-only"> (opens in a new tab)</span> ↗
              </a>
            )}
          </div>
          {actions && <div className="paper-actions">{actions}</div>}
        </footer>
      )}
      {children}
    </article>
  );
}
