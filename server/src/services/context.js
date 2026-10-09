// Decides how much of a paper is sent to Gemini.
//
// Typical papers are 30-80K characters (~8-20K tokens), far below the model's
// context window, and sending the whole paper is the most reliable way to keep
// answers grounded. So papers up to MAX_CONTEXT_CHARS are sent whole. Longer
// documents (theses, long surveys) are cut into chunks and we keep:
//   - the first chunks (title, abstract, introduction),
//   - the last chunks (conclusion; usually references too, which is harmless),
//   - for a question: the chunks sharing the most words with the question,
//     for a summary: chunks spread evenly through the middle.
// Omitted parts are marked with "[...]" so the model knows text is missing.

export const MAX_CONTEXT_CHARS = 120000;
const CHUNK_CHARS = 3000;
const HEAD_CHUNKS = 5;
const TAIL_CHUNKS = 3;

const STOPWORDS = new Set(
  'the a an and or of to in on for with by as at from is are was were be been this that these those what which who whom how why when where does do did paper authors author it its their they them there than then such into about'.split(' ')
);

function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_CHARS, text.length);
    // End on a line break when there is one nearby, so chunks don't cut lines.
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end);
      if (nl > start + CHUNK_CHARS / 2) end = nl + 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

const keywords = (s) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.filter((w) => !STOPWORDS.has(w)) ?? []);

export function buildContext(text, question) {
  if (text.length <= MAX_CONTEXT_CHARS) {
    return { context: text, truncated: false, charsUsed: text.length, charsTotal: text.length };
  }

  const chunks = chunkText(text);
  const budget = Math.floor(MAX_CONTEXT_CHARS / CHUNK_CHARS);
  const chosen = new Set();
  for (let i = 0; i < HEAD_CHUNKS; i++) chosen.add(i);
  for (let i = chunks.length - TAIL_CHUNKS; i < chunks.length; i++) chosen.add(i);

  const middle = chunks.map((_, i) => i).filter((i) => !chosen.has(i));
  const slots = budget - chosen.size;
  let picks;
  if (question) {
    const q = keywords(question);
    const score = (i) => [...keywords(chunks[i])].filter((w) => q.has(w)).length;
    picks = middle.map((i) => [i, score(i)]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, slots).map(([i]) => i);
  } else {
    const step = middle.length / slots;
    picks = Array.from({ length: Math.min(slots, middle.length) }, (_, k) => middle[Math.floor(k * step)]);
  }
  picks.forEach((i) => chosen.add(i));

  const ordered = [...chosen].sort((a, b) => a - b);
  let context = '';
  ordered.forEach((i, k) => {
    if (k > 0 && i !== ordered[k - 1] + 1) context += '\n\n[...]\n\n';
    context += chunks[i];
  });
  return { context, truncated: true, charsUsed: context.length, charsTotal: text.length };
}
