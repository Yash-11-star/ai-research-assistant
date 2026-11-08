import { describe, it, expect } from 'vitest';
import { buildSearchQuery } from '../src/services/arxiv.js';
import { buildContext, MAX_CONTEXT_CHARS } from '../src/services/context.js';
import { norm, clean } from '../src/services/text.js';
import { looksLikePdf } from '../src/services/pdf.js';

describe('buildSearchQuery', () => {
  it('ANDs words and drops stopwords', () => {
    expect(buildSearchQuery('Graph Neural Networks for molecules')).toBe('all:graph AND all:neural AND all:networks AND all:molecules');
  });

  it('strips arXiv query syntax characters', () => {
    expect(buildSearchQuery('"deep (learning)": ti:x')).toBe('all:deep AND all:learning AND all:ti AND all:x');
  });

  it('returns an empty string when only stopwords remain', () => {
    expect(buildSearchQuery('the and of')).toBe('');
  });

  it('keeps at most 12 terms', () => {
    const q = buildSearchQuery(Array.from({ length: 20 }, (_, i) => `w${i}`).join(' '));
    expect(q.split(' AND ')).toHaveLength(12);
  });
});

describe('buildContext', () => {
  it('sends short papers in full', () => {
    expect(buildContext('short text')).toEqual({ context: 'short text', truncated: false, charsUsed: 10, charsTotal: 10 });
  });

  it('truncates long papers to roughly the budget and marks omissions', () => {
    const text = Array.from({ length: 400 }, (_, i) => `Line ${i} ${'x'.repeat(990)}`).join('\n');
    const ctx = buildContext(text);
    expect(ctx.truncated).toBe(true);
    expect(ctx.charsTotal).toBe(text.length);
    expect(ctx.charsUsed).toBeLessThanOrEqual(MAX_CONTEXT_CHARS + 2000);
    expect(ctx.context).toContain('[...]');
    expect(ctx.context.startsWith('Line 0 ')).toBe(true);
    expect(ctx.context).toContain('Line 399 ');
  });

  it('prefers chunks related to the question', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `Line ${i} ${'filler '.repeat(140)}`);
    lines[200] = `Line 200 the hyperparameter dropout rate was 0.1 ${'pad '.repeat(200)}`;
    const ctx = buildContext(lines.join('\n'), 'What dropout rate was used?');
    expect(ctx.context).toContain('dropout rate was 0.1');
  });
});

describe('text helpers', () => {
  it('norm ignores case, punctuation, whitespace and ligatures', () => {
    expect(norm('Repre-\nsentaﬁon, OK!')).toBe('representafionok');
    expect(norm(undefined)).toBe('');
  });

  it('clean collapses whitespace and rejects non-strings', () => {
    expect(clean('  a \n\t b  ')).toBe('a b');
    expect(clean(42)).toBe('');
  });
});

describe('looksLikePdf', () => {
  it('detects the %PDF- header within the first KB', () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.7 ...'))).toBe(true);
    expect(looksLikePdf(Buffer.concat([Buffer.alloc(100), Buffer.from('%PDF-1.4')]))).toBe(true);
    expect(looksLikePdf(Buffer.concat([Buffer.alloc(2000), Buffer.from('%PDF-1.4')]))).toBe(false);
    expect(looksLikePdf(Buffer.from('hello'))).toBe(false);
  });
});
