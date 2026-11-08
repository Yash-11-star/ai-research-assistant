import { describe, it, expect } from 'vitest';
import { buildSearchQuery } from '../src/services/arxiv.js';
import { norm, clean } from '../src/services/text.js';
import { looksLikePdf } from '../src/services/pdf.js';

// (Round 3: the buildContext tests that were here were replaced by the more
// precise ones in unit.context.test.js.)

describe('buildSearchQuery', () => {
  it('ANDs words and drops stopwords', () => {
    expect(buildSearchQuery('Graph Neural Networks for molecules')).toBe('all:graph AND all:neural AND all:networks AND all:molecules');
  });

  it('strips arXiv query syntax characters', () => {
    expect(buildSearchQuery('"deep (learning)": ti:x')).toBe('all:deep AND all:learning AND all:ti AND all:x');
  });

  it('lower-cases so "AND"/"OR" typed by the user are searched as words, not operators... then dropped as stopwords', () => {
    expect(buildSearchQuery('Vision AND Language OR Speech')).toBe('all:vision AND all:language AND all:speech');
  });

  it('keeps letters from any script, digits, dots and hyphens', () => {
    expect(buildSearchQuery('BERT-base 2.0 Schrödinger 注意力')).toBe('all:bert-base AND all:2.0 AND all:schrödinger AND all:注意力');
  });

  it('returns an empty string when only stopwords remain', () => {
    expect(buildSearchQuery('the and of')).toBe('');
  });

  it('keeps at most the first 12 terms', () => {
    const q = buildSearchQuery(Array.from({ length: 20 }, (_, i) => `w${i}`).join(' '));
    expect(q.split(' AND ')).toEqual(Array.from({ length: 12 }, (_, i) => `all:w${i}`));
  });
});

describe('text helpers', () => {
  // Round 3 fix: the original test used a meaningless word ("representafion").
  // The requirement is that PDF artifacts don't stop a real quote from matching.
  it('norm makes PDF line-break hyphenation and ligatures match the plain word', () => {
    expect(norm('representa-\ntion')).toBe(norm('representation'));
    expect(norm('eﬃcient ﬁne-tuning')).toBe(norm('efficient fine-tuning'));
    expect(norm('Ünïcödé, OK!')).toBe('ünïcödéok');
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
    expect(looksLikePdf(Buffer.concat([Buffer.alloc(1019), Buffer.from('%PDF-')]))).toBe(true);
    expect(looksLikePdf(Buffer.concat([Buffer.alloc(1020), Buffer.from('%PDF-')]))).toBe(false);
    expect(looksLikePdf(Buffer.from('hello'))).toBe(false);
  });
});
