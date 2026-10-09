import { XMLParser } from 'fast-xml-parser';

const ARXIV_API = 'https://export.arxiv.org/api/query';
const TIMEOUT_MS = 15000;

// Thrown for anything that goes wrong talking to arXiv. `status` is the HTTP
// status our API should return (502 bad upstream response, 503 rate limited,
// 504 timeout). `userFacing` messages are complete sentences meant to be shown
// to the user as-is.
export class ArxivError extends Error {
  constructor(message, status = 502, { userFacing = false } = {}) {
    super(message);
    this.status = status;
    this.userFacing = userFacing;
  }
}

export const RATE_LIMIT_MESSAGE = 'arXiv is temporarily rate-limiting requests. Please wait a few minutes and try again.';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true, // opensearch:totalResults -> totalResults
  parseTagValue: false, // keep everything as strings (a title like "1984" must stay a string)
  isArray: (name, jpath) =>
    ['feed.entry', 'feed.entry.author', 'feed.entry.link'].includes(jpath),
});

const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

// arXiv does not index these, so a term like all:is matches nothing and, since
// terms are ANDed, a search for "attention is all you need" would return zero
// results. They are dropped from the query.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'of', 'for', 'and', 'or',
  'in', 'on', 'to', 'with', 'by', 'as', 'at', 'that', 'this', 'it', 'not', 'no',
  'but', 'into', 'if', 'then', 'than', 'such', 'these', 'those', 'there',
]);

// Turn free text into an arXiv query: every word must appear somewhere in the
// paper (title, abstract, authors, ...). Characters with special meaning in
// arXiv's query syntax (quotes, parentheses, colons) are dropped, and the text
// is lowercased so words like "and"/"or" are not read as boolean operators.
export function buildSearchQuery(text) {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .slice(0, 12);
  return words.map((w) => `all:${w}`).join(' AND ');
}

// "http://arxiv.org/abs/2209.15001v3"  -> "2209.15001"
// "http://arxiv.org/abs/hep-th/9901001v3" -> "hep-th/9901001"
function parseArxivId(rawId) {
  const match = clean(rawId).match(/arxiv\.org\/abs\/(.+?)(?:v\d+)?$/);
  return match ? match[1] : null;
}

function normalizeEntry(entry) {
  const arxivId = parseArxivId(entry.id);
  const title = clean(entry.title);
  if (!arxivId || !title) return null;

  const year = Number.parseInt(clean(entry.published).slice(0, 4), 10);
  const hasPdf = (entry.link ?? []).some((l) => l.title === 'pdf' || l.type === 'application/pdf');

  return {
    // Version-less id, so v1 and v3 of the same paper count as one paper.
    external_id: `arxiv:${arxivId}`,
    title,
    authors: (entry.author ?? []).map((a) => clean(a?.name)).filter(Boolean),
    year: Number.isInteger(year) ? year : null,
    abstract: clean(entry.summary) || null,
    url: `https://arxiv.org/abs/${arxivId}`,
    // Version-less PDF link always serves the latest version.
    pdf_url: hasPdf ? `https://arxiv.org/pdf/${arxivId}` : null,
    provider: 'arxiv',
  };
}

export async function searchArxiv(text, maxResults = 10) {
  const searchQuery = buildSearchQuery(text);
  if (!searchQuery) return { total: 0, results: [] };

  const url = `${ARXIV_API}?${new URLSearchParams({
    search_query: searchQuery,
    start: '0',
    max_results: String(maxResults),
    sortBy: 'relevance',
  })}`;

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new ArxivError('arXiv did not respond in time', 504);
    throw new ArxivError('Could not reach arXiv');
  }

  // Rate limited: tell the user to wait (retrying here would only make it worse).
  if (response.status === 429) {
    throw new ArxivError(RATE_LIMIT_MESSAGE, 503, { userFacing: true });
  }

  const body = await response.text();

  let feed;
  try {
    feed = parser.parse(body)?.feed;
  } catch {
    feed = undefined;
  }

  // arXiv reports errors as a feed with a single entry whose id points at /api/errors.
  const errorEntry = feed?.entry?.find((e) => clean(e?.id).includes('/api/errors'));
  if (errorEntry) {
    throw new ArxivError(`arXiv rejected the query: ${clean(errorEntry.summary) || 'unknown error'}`);
  }
  if (!response.ok) {
    throw new ArxivError(`arXiv returned HTTP ${response.status}`);
  }
  if (!feed || typeof feed !== 'object') {
    throw new ArxivError('arXiv returned an unexpected response');
  }

  const entries = feed.entry ?? [];
  const results = entries.map(normalizeEntry).filter(Boolean);
  if (results.length < entries.length) {
    console.warn(`arXiv: skipped ${entries.length - results.length} malformed entries`);
  }

  const total = Number.parseInt(feed.totalResults, 10);
  return { total: Number.isInteger(total) ? total : results.length, results };
}
