import { generateJson } from './gemini.js';
import { norm, clean } from './text.js';

// Title, authors and abstract are on the first page(s); no need to send the whole paper.
const MAX_PROMPT_CHARS = 15000;

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', nullable: true },
    authors: { type: 'array', items: { type: 'string' } },
    year: { type: 'integer', nullable: true },
    year_evidence: { type: 'string', nullable: true },
    abstract: { type: 'string', nullable: true },
  },
  required: ['title', 'authors', 'year', 'year_evidence', 'abstract'],
};

const PROMPT = `You extract bibliographic metadata from the text of the first pages of a research paper.
The text was extracted from a PDF, so it may contain broken lines, hyphenated words, footnote markers and page furniture.

Return:
- title: the paper's title exactly as written (fix only line breaks). Not a header, notice or venue name.
- authors: the author names in order, as written. Names only: no affiliations, emails, footnote symbols or markers like * or †.
- year: the year the paper was published, from the paper itself: a venue line (e.g. "NeurIPS 2017"), a copyright line, a date, or an arXiv stamp such as "arXiv:1706.03762v7 [cs.CL] 2 Aug 2023". Prefer the venue/copyright year over an arXiv stamp. Never use years that only appear in citations or references.
- year_evidence: the short exact snippet from the text that the year was taken from.
- abstract: the full abstract, copied word for word. Only re-join words hyphenated across line breaks and remove line breaks. Do not summarize, shorten or rephrase.

Use null (or an empty author list) for anything that is not clearly stated in the text. Never guess or use outside knowledge.

PAPER TEXT:
"""
`;

// Asks Gemini for metadata, then keeps only what can be found in the paper's
// own text. Anything that can't be verified is dropped (null) with a warning,
// so a hallucinated title/author/year/abstract never reaches the database.
export async function extractMetadata(pages) {
  const sourceText = pages.slice(0, 2).join('\n\n').slice(0, MAX_PROMPT_CHARS);
  const { data: raw } = await generateJson(`${PROMPT}${sourceText}\n"""`, SCHEMA);

  const source = norm(sourceText);
  const found = (s) => norm(s).length > 0 && source.includes(norm(s));
  const warnings = [];

  let title = clean(raw.title) || null;
  if (title && !found(title)) {
    warnings.push(`Discarded title not found in PDF text: "${title}"`);
    title = null;
  }

  const authors = [];
  for (const name of Array.isArray(raw.authors) ? raw.authors : []) {
    const a = clean(name);
    if (!a) continue;
    if (found(a)) authors.push(a);
    else warnings.push(`Discarded author not found in PDF text: "${a}"`);
  }

  let year = Number.isInteger(raw.year) ? raw.year : null;
  const evidence = clean(raw.year_evidence);
  if (year !== null && !(evidence.includes(String(year)) && found(evidence))) {
    warnings.push(`Discarded year ${year}: supporting text "${evidence}" not found in PDF`);
    year = null;
  }

  // The abstract must be (nearly) verbatim: either fully contained in the text,
  // or its beginning and end both present (tolerates tiny cleanup differences).
  let abstract = clean(raw.abstract) || null;
  if (abstract) {
    const a = norm(abstract);
    const verbatim = source.includes(a) || (a.length > 200 && source.includes(a.slice(0, 80)) && source.includes(a.slice(-80)));
    if (!verbatim) {
      warnings.push('Discarded abstract: it does not match the PDF text');
      abstract = null;
    }
  }

  if (!title) warnings.push('Title could not be determined from the PDF');
  if (authors.length === 0) warnings.push('Authors could not be determined from the PDF');
  if (year === null) warnings.push('Publication year could not be determined from the PDF');
  if (!abstract) warnings.push('Abstract could not be determined from the PDF');

  return { title, authors, year, abstract, warnings };
}
