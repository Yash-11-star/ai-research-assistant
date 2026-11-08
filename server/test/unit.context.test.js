import { describe, it, expect } from 'vitest';
import { buildContext, MAX_CONTEXT_CHARS } from '../src/services/context.js';

// Round 3 (mutation feedback): deterministic tests for long-paper chunk
// selection. Lines are exactly 100 characters (99 + "\n"), so every 3000-char
// chunk is exactly 30 lines, and chunk c holds lines 30c..30c+29.
const LINE = 100;
const LINES_PER_CHUNK = 30;
const line = (i, body = '') => `L${String(i).padStart(5, '0')} ${body}`.padEnd(LINE - 1, '.').slice(0, LINE - 1);
const doc = (chunks, bodyFor = () => '') =>
  Array.from({ length: chunks * LINES_PER_CHUNK }, (_, i) => line(i, bodyFor(Math.floor(i / LINES_PER_CHUNK), i))).join('\n') + '\n';

// Which chunks made it into the context (by their first line's number).
const chunksIn = (context) => [...new Set([...context.matchAll(/L(\d{5}) /g)].map((m) => Math.floor(Number(m[1]) / LINES_PER_CHUNK)))];

describe('buildContext: size threshold', () => {
  it('sends a paper of exactly MAX_CONTEXT_CHARS in full', () => {
    const text = 'a'.repeat(MAX_CONTEXT_CHARS);
    expect(buildContext(text)).toEqual({ context: text, truncated: false, charsUsed: MAX_CONTEXT_CHARS, charsTotal: MAX_CONTEXT_CHARS });
  });

  it('truncates a paper one character over the limit', () => {
    expect(buildContext(`${'a\n'.repeat(MAX_CONTEXT_CHARS / 2)}b`).truncated).toBe(true);
  });
});

describe('buildContext: summary (no question)', () => {
  const text = doc(50); // 150,000 chars, chunks 0..49
  const { context, charsUsed, charsTotal } = buildContext(text);
  const used = chunksIn(context);

  it('keeps whole chunks: 40 x 3000 chars = the 120,000-char budget', () => {
    expect(used).toHaveLength(40);
    expect(charsTotal).toBe(150000);
    const markers = (context.match(/\n\n\[\.\.\.\]\n\n/g) ?? []).length;
    expect(charsUsed).toBe(40 * 3000 + markers * '\n\n[...]\n\n'.length);
  });

  it('always includes the first 5 and last 3 chunks', () => {
    expect(used.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(used.slice(-3)).toEqual([47, 48, 49]);
    expect(context.startsWith(line(0))).toBe(true);
    expect(context.endsWith(`${line(1499)}\n`)).toBe(true);
  });

  it('spreads the remaining picks evenly: 10 of the 42 middle chunks are skipped, never two in a row', () => {
    const skipped = Array.from({ length: 42 }, (_, i) => i + 5).filter((c) => !used.includes(c));
    expect(skipped).toHaveLength(10);
    skipped.slice(1).forEach((c, k) => expect(c - skipped[k]).toBeGreaterThan(1));
    expect(used).toContain(5); // first middle chunk
  });

  it('keeps chunks in document order and marks every gap (and only gaps) with [...]', () => {
    expect([...used].sort((a, b) => a - b)).toEqual(used);
    const gaps = used.slice(1).filter((c, k) => c !== used[k] + 1).length;
    expect((context.match(/\[\.\.\.\]/g) ?? []).length).toBe(gaps);
    expect(context).not.toMatch(/^\n*\[\.\.\.\]/);
  });
});

describe('buildContext: question', () => {
  it('picks the chunks that share the most keywords with the question, ignoring case', () => {
    // Chunk 20 mentions both keywords, chunks 30-31 one keyword each.
    const text = doc(80, (c) => (c === 20 ? 'DROPOUT rate' : c === 30 || c === 31 ? 'dropout' : ''));
    const used = chunksIn(buildContext(text, 'What dropout rate was used?').context);
    expect(used).toEqual(expect.arrayContaining([20, 30, 31]));
  });

  it('ranks by score, then by position: with more matches than slots, earlier equal-score chunks win', () => {
    // 60 middle chunks mention "dropout" (score 1); only 32 slots are available.
    const text = doc(80, (c) => (c >= 10 && c < 70 ? 'dropout' : ''));
    const used = chunksIn(buildContext(text, 'dropout?').context);
    const middle = used.filter((c) => c >= 5 && c < 77);
    expect(middle).toEqual(Array.from({ length: 32 }, (_, i) => 10 + i));
  });

  it('ignores stopwords and words shorter than 3 letters when scoring', () => {
    // Chunk 50 matches only stopwords/short words; chunk 60 matches a real keyword.
    const text = doc(80, (c) => (c === 50 ? 'the of is an a' : c === 60 ? 'tokenizer' : ''));
    const used = chunksIn(buildContext(text, 'Is the tokenizer of a an?').context);
    expect(used).toContain(60);
    // With no other matches, ties are broken by position, so 50 is only kept if it is among the earliest.
    expect(used.filter((c) => c >= 5 && c < 77)).toEqual([...Array.from({ length: 31 }, (_, i) => 5 + i), 60]);
  });
});

describe('buildContext: chunk boundaries', () => {
  it('ends chunks on a line break when one is in the second half of the chunk', () => {
    // 2,999-char lines: each chunk should be one whole line plus its newline.
    const text = Array.from({ length: 60 }, (_, i) => `${String(i).padStart(4, '0')}${'x'.repeat(2995)}`).join('\n');
    const { context } = buildContext(text);
    for (const part of context.split('\n\n[...]\n\n')) {
      for (const ln of part.split('\n').filter(Boolean)) expect(ln).toHaveLength(2999);
    }
  });

  it('cuts at exactly 3000 characters when there is no usable line break', () => {
    const text = 'y'.repeat(MAX_CONTEXT_CHARS + 30000); // no newlines: 50 chunks of 3000
    const { context, charsUsed } = buildContext(text);
    const parts = context.split('\n\n[...]\n\n');
    expect(parts.join('').length).toBe(40 * 3000);
    expect(charsUsed).toBe(context.length);
  });
});
