import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.js';
import PaperCard from '../components/PaperCard.jsx';
import { contentLabel } from '../paperLabels.js';

// Results are kept for the browser session so going back to Library and
// reopening a paper doesn't spend another Gemini request.
const summaryCache = new Map(); // paper id -> summary response
const answerCache = new Map(); // paper id -> last Q&A response

const SUMMARY_SECTIONS = [
  ['tldr', 'TL;DR'],
  ['problem', 'Problem / Motivation'],
  ['approach', 'Approach'],
  ['methods', 'Methods / Architecture'],
  ['datasets_and_experiments', 'Datasets & Experiments'],
  ['results', 'Main Results'],
  ['limitations', 'Limitations / Caveats'],
];

const EXAMPLE_QUESTIONS = [
  'What problem does this paper address?',
  'What is the main idea of the proposed approach?',
  'What datasets are used?',
  'What are the major limitations?',
  'How does this method compare with the baselines?',
];

function TruncationNote({ context }) {
  if (!context?.truncated) return null;
  return (
    <p className="hint">
      This paper is long, so only the most relevant parts ({Math.round((context.chars_used / context.chars_total) * 100)}% of the text) were used.
    </p>
  );
}

function SummarySection({ paper, onContentFetched }) {
  const [state, setState] = useState(() => (summaryCache.has(paper.id) ? { status: 'done', data: summaryCache.get(paper.id) } : { status: 'idle' }));
  const busy = state.status === 'loading';

  async function generate() {
    setState({ status: 'loading' });
    try {
      const data = await api.summarize(paper.id);
      summaryCache.set(paper.id, data);
      setState({ status: 'done', data });
      if (data.content_source === 'downloaded') onContentFetched();
    } catch (err) {
      setState({ status: 'error', error: err.message });
    }
  }

  return (
    <section className="panel" aria-labelledby="summary-heading">
      <div className="panel-header">
        <h3 id="summary-heading">AI summary</h3>
        <button type="button" className="button primary" onClick={generate} disabled={busy}>
          {busy ? 'Generating…' : state.status === 'done' ? 'Regenerate summary' : 'Generate Summary'}
        </button>
      </div>
      <p className="hint">Generated from the paper’s full text. The assistant is instructed to say when something is not stated in the paper.</p>

      <div aria-live="polite">
        {busy && (
          <p className="status working">
            <span className="spinner" aria-hidden="true" />{' '}
            {paper.has_full_text ? 'Generating summary… this usually takes 10–30 seconds.' : 'Downloading the paper PDF and generating a summary… this can take up to a minute.'}
          </p>
        )}
      </div>
      {state.status === 'error' && (
        <p className="alert" role="alert">
          Could not generate a summary: {state.error}
        </p>
      )}
      {state.status === 'done' && (
        <>
          <dl className="summary">
            {SUMMARY_SECTIONS.map(([key, label]) => (
              <div key={key} className={`summary-item${key === 'tldr' ? ' tldr' : ''}`}>
                <dt>{label}</dt>
                <dd>{state.data.summary[key]}</dd>
              </div>
            ))}
          </dl>
          <TruncationNote context={state.data.context} />
        </>
      )}
    </section>
  );
}

function QuestionSection({ paper, onContentFetched }) {
  const [question, setQuestion] = useState('');
  const [inputError, setInputError] = useState('');
  const [state, setState] = useState(() => (answerCache.has(paper.id) ? { status: 'done', data: answerCache.get(paper.id) } : { status: 'idle' }));
  const inputRef = useRef(null);
  const hintId = useId();
  const busy = state.status === 'loading';

  async function ask(event) {
    event?.preventDefault();
    if (busy) return;
    const q = question.trim();
    if (!q) {
      setInputError('Type a question about this paper first.');
      inputRef.current?.focus();
      return;
    }
    setInputError('');
    setState({ status: 'loading', question: q });
    try {
      const data = await api.ask(paper.id, q);
      answerCache.set(paper.id, data);
      setState({ status: 'done', data });
      if (data.content_source === 'downloaded') onContentFetched();
    } catch (err) {
      setState({ status: 'error', error: err.message, question: q });
    }
  }

  // Enter submits; Shift+Enter adds a new line.
  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) ask(event);
  }

  const answer = state.status === 'done' ? state.data : null;

  return (
    <section className="panel" aria-labelledby="qa-heading">
      <h3 id="qa-heading">Ask a question</h3>
      <form onSubmit={ask} noValidate>
        <label htmlFor="question-input">Your question about this paper</label>
        <p id={hintId} className="hint">
          Answers come only from this paper. Press Enter to ask, Shift+Enter for a new line.
        </p>
        <textarea
          ref={inputRef}
          id="question-input"
          rows={3}
          maxLength={1000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={busy}
          aria-invalid={inputError ? 'true' : undefined}
          aria-describedby={`${hintId}${inputError ? ' question-error' : ''}`}
          placeholder="e.g. What datasets are used?"
        />
        {inputError && (
          <p id="question-error" className="field-error">
            {inputError}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? 'Asking…' : 'Ask'}
          </button>
        </div>
        <div className="examples">
          <span className="hint" id="examples-label">
            Try:
          </span>
          <ul aria-labelledby="examples-label">
            {EXAMPLE_QUESTIONS.map((q) => (
              <li key={q}>
                {/* Fills the box only; the user still presses Ask (saves quota). */}
                <button
                  type="button"
                  className="chip"
                  disabled={busy}
                  onClick={() => {
                    setQuestion(q);
                    setInputError('');
                    inputRef.current?.focus();
                  }}
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </form>

      <div aria-live="polite">
        {busy && (
          <p className="status working">
            <span className="spinner" aria-hidden="true" /> Reading the paper to answer “{state.question}”…
          </p>
        )}
      </div>
      {state.status === 'error' && (
        <p className="alert" role="alert">
          Could not answer “{state.question}”: {state.error}
        </p>
      )}

      {answer && (
        <article className="answer" aria-labelledby="answer-heading">
          <h4 id="answer-heading" className="answer-question">
            Q: {answer.question}
          </h4>
          {!answer.found_in_paper && (
            <p className="notice info">
              <strong>Not covered by this paper.</strong> The assistant could not find this information in the paper’s text, so it did not guess.
            </p>
          )}
          <p className="answer-text">{answer.answer}</p>
          {answer.warning && <p className="notice warning">{answer.warning}</p>}
          {answer.evidence?.length > 0 && (
            <div className="evidence">
              <h5>Evidence from paper</h5>
              <ul>
                {answer.evidence.map((quote) => (
                  <li key={quote}>
                    <blockquote>“{quote}”</blockquote>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <TruncationNote context={answer.context} />
        </article>
      )}
    </section>
  );
}

export default function PaperPage({ id }) {
  const [paper, setPaper] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    api
      .getPaper(id)
      .then((p) => {
        if (cancelled) return;
        setPaper(p);
        setStatus('done');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.status === 404 || err.status === 400 ? 'This paper is not in your library (it may have been deleted).' : err.message);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // The first summary/question on a saved search result downloads its full text.
  const markContentFetched = () => setPaper((p) => ({ ...p, has_full_text: true }));

  return (
    <section aria-labelledby="paper-heading" className="paper-page">
      <p className="back-link">
        <a href="#/library">← Back to My Library</a>
      </p>
      <h2 id="paper-heading">{status === 'done' ? 'Paper assistant' : 'Paper'}</h2>

      {status === 'loading' && <p className="status">Loading paper…</p>}
      {status === 'error' && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {status === 'done' && (
        <>
          <PaperCard paper={paper} badges={[contentLabel(paper)]} expandAbstract />
          <SummarySection key={`s${paper.id}`} paper={paper} onContentFetched={markContentFetched} />
          <QuestionSection key={`q${paper.id}`} paper={paper} onContentFetched={markContentFetched} />
        </>
      )}
    </section>
  );
}
