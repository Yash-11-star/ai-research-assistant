import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import PaperCard from '../components/PaperCard.jsx';

// `search` / `setSearch` live in App so results survive switching tabs:
// { query, status: 'idle'|'loading'|'done'|'error', submitted, total, results, error }
export default function SearchPage({ search, setSearch }) {
  const [inputError, setInputError] = useState('');
  // external_id -> 'saving' | 'saved' | { error }
  const [saveState, setSaveState] = useState({});
  const latestRequest = useRef(0);
  const inputRef = useRef(null);

  // Mark results that are already in the library (re-checked each time the
  // page is shown, so deletions made on the Library page are reflected).
  useEffect(() => {
    let cancelled = false;
    api
      .listPapers()
      .then((papers) => {
        if (cancelled) return;
        const saved = Object.fromEntries(papers.filter((p) => p.external_id).map((p) => [p.external_id, 'saved']));
        setSaveState(saved);
      })
      .catch(() => {}); // Not critical: saving still detects duplicates (409).
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    const query = search.query.trim();
    if (!query) {
      setInputError('Enter a research topic or keywords to search.');
      inputRef.current?.focus();
      return;
    }
    setInputError('');

    // Ignore responses from older searches if the user searches again quickly.
    const requestId = ++latestRequest.current;
    setSearch((s) => ({ ...s, status: 'loading', submitted: query, error: null }));
    try {
      const data = await api.search(query);
      if (requestId !== latestRequest.current) return;
      setSearch((s) => ({ ...s, status: 'done', total: data.total, results: data.results }));
    } catch (err) {
      if (requestId !== latestRequest.current) return;
      setSearch((s) => ({ ...s, status: 'error', error: err.message, results: [] }));
    }
  }

  async function handleSave(paper) {
    const key = paper.external_id;
    setSaveState((s) => ({ ...s, [key]: 'saving' }));
    try {
      await api.savePaper(paper);
      setSaveState((s) => ({ ...s, [key]: 'saved' }));
    } catch (err) {
      // 409 = already in the library: that's the outcome the user wanted.
      setSaveState((s) => ({ ...s, [key]: err.status === 409 ? 'saved' : { error: err.message } }));
    }
  }

  const { status, results, submitted, total, error } = search;

  return (
    <section aria-labelledby="search-heading">
      <h2 id="search-heading">Search papers</h2>
      <p className="page-intro">Find research papers on arXiv and save the ones you want to read to your library.</p>

      <form className="search-form" onSubmit={handleSubmit} role="search" noValidate>
        <label htmlFor="search-input">Research topic or keywords</label>
        <div className="search-row">
          <input
            ref={inputRef}
            id="search-input"
            type="search"
            value={search.query}
            onChange={(e) => setSearch((s) => ({ ...s, query: e.target.value }))}
            placeholder="e.g. transformer attention"
            aria-invalid={inputError ? 'true' : undefined}
            aria-describedby={inputError ? 'search-input-error' : undefined}
            maxLength={300}
          />
          <button type="submit" className="button primary" disabled={status === 'loading'}>
            {status === 'loading' ? 'Searching…' : 'Search'}
          </button>
        </div>
        {inputError && (
          <p id="search-input-error" className="field-error">
            {inputError}
          </p>
        )}
      </form>

      <div aria-live="polite">
        {status === 'loading' && <p className="status">Searching arXiv for “{submitted}”…</p>}
        {status === 'done' && results.length === 0 && (
          <p className="status empty">No papers found for “{submitted}”. Try different or fewer keywords.</p>
        )}
        {status === 'done' && results.length > 0 && (
          <p className="status">
            Showing {results.length} of {total.toLocaleString()} results for “{submitted}”.
          </p>
        )}
      </div>
      {status === 'error' && (
        <p className="alert" role="alert">
          Search failed: {error}
        </p>
      )}

      {status === 'done' && results.length > 0 && (
        <ol className="paper-list">
          {results.map((paper) => {
            const state = saveState[paper.external_id];
            const saved = state === 'saved';
            return (
              <li key={paper.external_id}>
                <PaperCard
                  paper={paper}
                  badges={saved ? ['In your library'] : []}
                  actions={
                    <button
                      type="button"
                      className={`button ${saved ? 'saved' : 'primary'}`}
                      onClick={() => handleSave(paper)}
                      disabled={saved || state === 'saving'}
                    >
                      {saved ? '✓ Saved' : state === 'saving' ? 'Saving…' : 'Save to Library'}
                    </button>
                  }
                >
                  {state?.error && (
                    <p className="alert small" role="alert">
                      Could not save: {state.error}
                    </p>
                  )}
                </PaperCard>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
