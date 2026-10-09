// Lowercase letters and digits only, so "representa-\ntion" matches
// "representation" and ligatures like "ﬁ" match "fi". Used to check whether a
// string from the LLM really appears in the paper text.
export const norm = (s) => (s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Collapse whitespace and trim; non-strings become ''.
export const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
