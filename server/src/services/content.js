import { getPaper, getPaperInternals, setFullText } from '../db.js';
import { looksLikePdf, extractPdfText } from './pdf.js';

// `status` is the HTTP status our API should return for this failure.
export class ContentError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30000;
// Only download from arXiv. pdf_url comes from the client when a paper is
// saved, so without this the server could be made to fetch arbitrary
// (including internal) URLs.
const ALLOWED_PDF_HOSTS = new Set(['arxiv.org', 'www.arxiv.org', 'export.arxiv.org']);

async function downloadPdf(pdfUrl) {
  let url;
  try {
    url = new URL(pdfUrl);
  } catch {
    throw new ContentError('Paper has an invalid PDF link', 422);
  }
  if (url.protocol !== 'https:' || !ALLOWED_PDF_HOSTS.has(url.hostname)) {
    throw new ContentError(`Downloading PDFs from ${url.hostname} is not supported (arXiv only)`, 422);
  }

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new ContentError('Timed out downloading the paper PDF from arXiv', 504);
    throw new ContentError('Could not download the paper PDF from arXiv', 502);
  }
  // fetch follows redirects; make sure we did not end up somewhere else.
  const finalHost = response.url ? new URL(response.url).hostname : url.hostname;
  if (!ALLOWED_PDF_HOSTS.has(finalHost)) {
    throw new ContentError('PDF download was redirected to an unsupported host', 502);
  }
  if (!response.ok) {
    throw new ContentError(`arXiv returned HTTP ${response.status} for the paper PDF`, 502);
  }
  if (Number(response.headers.get('content-length')) > MAX_PDF_BYTES) {
    throw new ContentError('Paper PDF is too large to process', 422);
  }

  // Read the body with a size cap (Content-Length may be missing or wrong).
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_PDF_BYTES) throw new ContentError('Paper PDF is too large to process', 422);
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (!looksLikePdf(buffer)) {
    throw new ContentError('The downloaded file is not a PDF', 502);
  }
  return buffer;
}

// Returns the paper and its full text. Uploaded papers already have text;
// saved search results get their PDF downloaded once and the extracted text
// stored, so later calls reuse it. Throws ContentError, or PdfError if the
// downloaded PDF can't be read.
export async function getPaperWithText(id) {
  const paper = getPaper(id);
  if (!paper) throw new ContentError('Paper not found', 404);

  const { full_text: stored } = getPaperInternals(id);
  if (stored && stored.trim()) return { paper, text: stored, contentSource: 'stored' };

  if (!paper.pdf_url) {
    throw new ContentError('This paper has no full text or PDF link, so it cannot be summarized or queried', 422);
  }

  const buffer = await downloadPdf(paper.pdf_url);
  const { pages } = await extractPdfText(buffer);
  const text = pages.join('\n\n');
  setFullText(id, text);
  console.log(`Paper #${id}: downloaded ${paper.pdf_url} (${buffer.length} bytes), stored ${text.length} chars of text`);
  return { paper: getPaper(id), text, contentSource: 'downloaded' };
}
