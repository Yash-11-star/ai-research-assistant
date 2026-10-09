import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PaperCard from '../components/PaperCard.jsx';
import { contentLabel } from '../paperLabels.js';

export default function LibraryPage() {
  const [papers, setPapers] = useState([]);
  const [status, setStatus] = useState('loading'); // 'loading' | 'done' | 'error'
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(null); // id being deleted
  const [deleteError, setDeleteError] = useState({}); // id -> message
  const [notice, setNotice] = useState('');

  // Always load from the backend so the page reflects the database.
  useEffect(() => {
    let cancelled = false;
    api
      .listPapers()
      .then((data) => {
        if (cancelled) return;
        setPapers(data);
        setStatus('done');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDelete(paper) {
    if (!window.confirm(`Delete "${paper.title}" from your library?`)) return;
    setDeleting(paper.id);
    setDeleteError((e) => ({ ...e, [paper.id]: undefined }));
    try {
      await api.deletePaper(paper.id);
    } catch (err) {
      // 404 means it is already gone, which is what the user wanted.
      if (err.status !== 404) {
        setDeleteError((e) => ({ ...e, [paper.id]: err.message }));
        setDeleting(null);
        return;
      }
    }
    setPapers((list) => list.filter((p) => p.id !== paper.id));
    setNotice(`Deleted "${paper.title}".`);
    setDeleting(null);
  }

  return (
    <section aria-labelledby="library-heading">
      <h2 id="library-heading">My library</h2>
      <p className="page-intro">Papers you saved from search or uploaded as PDFs. Saved papers are stored locally and kept between sessions.</p>

      <p className="sr-only" aria-live="polite">
        {notice}
      </p>

      {status === 'loading' && <p className="status">Loading your library…</p>}
      {status === 'error' && (
        <p className="alert" role="alert">
          Could not load your library: {error}
        </p>
      )}
      {status === 'done' && papers.length === 0 && (
        <p className="status empty">Your library is empty. Search for papers and click “Save to Library” to add them.</p>
      )}
      {status === 'done' && papers.length > 0 && (
        <>
          <p className="status">
            {papers.length} {papers.length === 1 ? 'paper' : 'papers'} in your library.
          </p>
          <ol className="paper-list">
            {papers.map((paper) => (
              <li key={paper.id}>
                <PaperCard
                  paper={paper}
                  badges={[contentLabel(paper)]}
                  actions={
                    <>
                      <button
                        type="button"
                        className="button danger"
                        onClick={() => handleDelete(paper)}
                        disabled={deleting === paper.id}
                        aria-label={`Delete "${paper.title}"`}
                      >
                        {deleting === paper.id ? 'Deleting…' : 'Delete'}
                      </button>
                      {/* A link, not a button: it navigates to the paper's page. */}
                      <a className="button primary" href={`#/paper/${paper.id}`} aria-label={`Open "${paper.title}" to summarize and ask questions`}>
                        Open paper
                      </a>
                    </>
                  }
                >
                  {deleteError[paper.id] && (
                    <p className="alert small" role="alert">
                      Could not delete: {deleteError[paper.id]}
                    </p>
                  )}
                </PaperCard>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
