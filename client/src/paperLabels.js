// Saved arXiv papers get their full text downloaded the first time it is needed.
export function contentLabel(paper) {
  if (paper.has_full_text) return 'Full text available';
  if (paper.pdf_url) return 'Full text fetched on first use';
  return 'Metadata only';
}
