import { useRef, useState } from 'react';
import { api } from '../api.js';
import PaperCard from '../components/PaperCard.jsx';

const MAX_MB = 20; // matches the backend limit

function formatSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Quick checks before uploading; the backend validates again (including the file's bytes).
function checkFile(file) {
  if (!file) return 'Choose a PDF file to upload.';
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return `"${file.name}" is not a PDF. Only PDF files can be uploaded.`;
  if (file.size > MAX_MB * 1024 * 1024) return `"${file.name}" is ${formatSize(file.size)}; the limit is ${MAX_MB} MB.`;
  return '';
}

export default function UploadPage() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // 'idle' | 'uploading' | 'done' | 'error'
  const [error, setError] = useState('');
  const [uploaded, setUploaded] = useState(null);
  const inputRef = useRef(null);

  function handleFileChange(event) {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setError(chosen ? checkFile(chosen) : '');
    if (status !== 'uploading') setStatus('idle');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (status === 'uploading') return;
    const problem = checkFile(file);
    if (problem) {
      setError(problem);
      setStatus('error');
      inputRef.current?.focus();
      return;
    }
    setError('');
    setUploaded(null);
    setStatus('uploading');
    try {
      const paper = await api.uploadPaper(file);
      setUploaded(paper);
      setStatus('done');
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      setError(`Upload failed: ${err.message}`);
      setStatus('error');
    }
  }

  const uploading = status === 'uploading';

  return (
    <section aria-labelledby="upload-heading">
      <h2 id="upload-heading">Upload a PDF</h2>
      <p className="page-intro">
        Add a research paper from your computer. The title, authors, year and abstract are extracted from the PDF automatically, and its full text is
        used for summaries and questions.
      </p>

      <form className="upload-form panel" onSubmit={handleSubmit} noValidate>
        <label htmlFor="pdf-input">PDF file</label>
        <p id="pdf-hint" className="hint">
          One PDF, up to {MAX_MB} MB.
        </p>
        <input
          ref={inputRef}
          id="pdf-input"
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleFileChange}
          disabled={uploading}
          aria-describedby={`pdf-hint${error ? ' upload-error' : ''}`}
          aria-invalid={error ? 'true' : undefined}
        />
        {file && (
          <p className="selected-file">
            Selected: <strong>{file.name}</strong> ({formatSize(file.size)})
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="button primary" disabled={uploading || !file}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </form>

      <div aria-live="polite">
        {uploading && (
          <p className="status working">
            <span className="spinner" aria-hidden="true" /> Uploading and reading “{file?.name}”. Extracting the title, authors, year and abstract can take up
            to a minute…
          </p>
        )}
        {status === 'done' && uploaded && <p className="notice success">“{uploaded.title}” was added to your library.</p>}
      </div>
      {error && (
        <p id="upload-error" className="alert" role="alert">
          {error}
        </p>
      )}

      {status === 'done' && uploaded && (
        <div className="upload-result">
          {uploaded.warnings?.length > 0 && (
            <div className="notice warning">
              <p>
                <strong>Some details could not be read from the PDF.</strong> The paper was still added; missing fields are left blank rather than guessed.
              </p>
              <details>
                <summary>Show details ({uploaded.warnings.length})</summary>
                <ul>
                  {uploaded.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            </div>
          )}
          <PaperCard
            paper={uploaded}
            badges={['Full text available']}
            actions={
              <a className="button primary" href={`#/paper/${uploaded.id}`}>
                Open paper
              </a>
            }
          />
          <p className="after-upload-links">
            <a href="#/library">Go to My Library</a>
          </p>
        </div>
      )}
    </section>
  );
}
