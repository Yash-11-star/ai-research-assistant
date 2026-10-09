import { getDocumentProxy, extractText } from 'unpdf';

// `status` is the HTTP status our API should return for this failure.
export class PdfError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

// Real PDFs start with "%PDF-" (a few writers put junk before it, so allow
// it anywhere in the first 1 KB, as PDF readers do).
export function looksLikePdf(buffer) {
  return buffer.subarray(0, 1024).includes('%PDF-');
}

// Returns the text of each page. Throws PdfError if the file can't be parsed
// or contains no extractable text (e.g. a scanned image-only PDF).
export async function extractPdfText(buffer) {
  let pdf;
  try {
    // pdf.js takes ownership of the array it is given, so pass a copy.
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch (err) {
    if (err?.name === 'PasswordException') throw new PdfError('PDF is password-protected');
    throw new PdfError('File could not be read as a PDF (it may be corrupted)');
  }

  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = text.map((t) => t.trim());
    const letters = pages.join('').replace(/\s/g, '').length;
    if (letters < 200) {
      throw new PdfError('No readable text found in the PDF (is it a scanned image?)');
    }
    return { totalPages, pages };
  } catch (err) {
    if (err instanceof PdfError) throw err;
    throw new PdfError('Failed to extract text from the PDF');
  } finally {
    // Free pdf.js resources; cleanup must never mask the real result.
    await pdf.loadingTask?.destroy().catch(() => {});
  }
}
