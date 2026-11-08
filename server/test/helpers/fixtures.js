import { PDFDocument, StandardFonts } from 'pdf-lib';

// Builds a real, text-based PDF. `pages` is an array of arrays of lines.
export async function makePdf(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    lines.forEach((line, i) => page.drawText(line, { x: 50, y: 740 - i * 16, size: 11, font }));
  }
  return Buffer.from(await doc.save());
}

export const PAPER_LINES = [
  'Attention Is All You Need',
  'Ashish Vaswani Noam Shazeer Niki Parmar',
  'NeurIPS 2017',
  'Abstract',
  'The dominant sequence transduction models are based on complex recurrent or convolutional',
  'neural networks. We propose a new simple network architecture, the Transformer, based solely',
  'on attention mechanisms, dispensing with recurrence and convolutions entirely.',
  'Experiments on two machine translation tasks show these models to be superior in quality.',
  'We evaluate on the WMT 2014 English-to-German dataset and achieve 28.4 BLEU.',
];

export const samplePdf = () => makePdf([PAPER_LINES, ['1 Introduction', 'Recurrent neural networks have been firmly established as state of the art approaches.']]);

// A fetch Response carrying a Gemini generateContent body whose text is `obj` as JSON.
export function geminiResponse(obj, status = 200) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function geminiError(status, message = 'error', details = []) {
  return new Response(JSON.stringify({ error: { code: status, message, details } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Minimal arXiv Atom feed. Each entry: { id, title, summary, published, authors, pdf }.
export function arxivFeed(entries, total = entries.length) {
  const xml = entries
    .map(
      (e) => `<entry>
    <id>http://arxiv.org/abs/${e.id}</id>
    <published>${e.published ?? '2017-06-12T17:57:34Z'}</published>
    <title>${e.title}</title>
    <summary>${e.summary ?? 'An abstract.'}</summary>
    ${(e.authors ?? ['Ada Lovelace']).map((a) => `<author><name>${a}</name></author>`).join('\n')}
    <link href="http://arxiv.org/abs/${e.id}" rel="alternate" type="text/html"/>
    ${e.pdf === false ? '' : `<link title="pdf" href="http://arxiv.org/pdf/${e.id}" rel="related" type="application/pdf"/>`}
  </entry>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="html">ArXiv Query</title>
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">${total}</opensearch:totalResults>
  <opensearch:startIndex xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:startIndex>
  ${xml}
</feed>`;
}
