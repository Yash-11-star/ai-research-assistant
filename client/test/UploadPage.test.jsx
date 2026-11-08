import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadPage from '../src/pages/UploadPage.jsx';
import { mockApi, json, deferred, makePaper } from './helpers.js';

const pdf = (name = 'paper.pdf', size = 2048, type = 'application/pdf') => {
  const file = new File(['%PDF-1.4'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};
const input = () => screen.getByLabelText('PDF file');
const uploadButton = () => screen.getByRole('button', { name: /Upload/ });
// applyAccept: false lets a test pick a non-PDF, like a user choosing "All files".
const user = () => userEvent.setup({ applyAccept: false });

describe('UploadPage', () => {
  it('disables Upload until a file is chosen, then shows the file name and size', async () => {
    render(<UploadPage />);
    expect(uploadButton()).toBeDisabled();
    await user().upload(input(), pdf('paper.pdf', 3 * 1024 * 1024));
    expect(screen.getByText('paper.pdf').closest('p')).toHaveTextContent('Selected: paper.pdf (3.0 MB)');
    expect(uploadButton()).toBeEnabled();
  });

  it('rejects a non-PDF before uploading', async () => {
    const fetchMock = mockApi({});
    render(<UploadPage />);
    await user().upload(input(), pdf('notes.txt', 100, 'text/plain'));
    expect(screen.getByRole('alert')).toHaveTextContent('"notes.txt" is not a PDF. Only PDF files can be uploaded.');
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    await user().click(uploadButton());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a PDF over 20 MB before uploading', async () => {
    const fetchMock = mockApi({});
    render(<UploadPage />);
    await user().upload(input(), pdf('huge.pdf', 21 * 1024 * 1024));
    expect(screen.getByRole('alert')).toHaveTextContent('"huge.pdf" is 21.0 MB; the limit is 20 MB.');
    await user().click(uploadButton());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a file with a .PDF extension but no MIME type', async () => {
    render(<UploadPage />);
    await user().upload(input(), pdf('SCAN.PDF', 2048, ''));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uploads, shows progress, then the new paper with a link to open it', async () => {
    const pending = deferred();
    mockApi({ 'POST /api/papers/upload': () => pending.promise });
    render(<UploadPage />);
    await user().upload(input(), pdf());
    await user().click(uploadButton());

    expect(screen.getByRole('button', { name: 'Uploading…' })).toBeDisabled();
    expect(input()).toBeDisabled();
    expect(screen.getByText(/Uploading and reading “paper.pdf”/)).toBeInTheDocument();

    pending.resolve(json({ ...makePaper({ id: 9, source: 'upload', has_full_text: true }), pages: 12, warnings: [] }, 201));
    expect(await screen.findByText('“Attention Is All You Need” was added to your library.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open paper' })).toHaveAttribute('href', '#/paper/9');
    expect(screen.queryByText(/Some details could not be read/)).not.toBeInTheDocument();
    expect(input().value).toBe('');
    expect(uploadButton()).toBeDisabled(); // file cleared
  });

  it('lists metadata warnings returned by the server', async () => {
    mockApi({
      'POST /api/papers/upload': json(
        { ...makePaper({ id: 9, source: 'upload', year: null }), warnings: ['Publication year could not be determined from the PDF'] },
        201
      ),
    });
    render(<UploadPage />);
    await user().upload(input(), pdf());
    await user().click(uploadButton());
    expect(await screen.findByText(/Some details could not be read from the PDF/)).toBeInTheDocument();
    expect(screen.getByText('Show details (1)')).toBeInTheDocument();
    expect(screen.getByText('Publication year could not be determined from the PDF')).toBeInTheDocument();
  });

  it('shows the server error when the upload fails', async () => {
    mockApi({ 'POST /api/papers/upload': json({ error: 'No readable text found in the PDF (is it a scanned image?)' }, 422) });
    render(<UploadPage />);
    await user().upload(input(), pdf());
    await user().click(uploadButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Upload failed: No readable text found in the PDF (is it a scanned image?)');
    expect(uploadButton()).toBeEnabled(); // can retry
  });
});
