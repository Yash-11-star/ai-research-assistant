import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve relative to this file so the DB location doesn't depend on the cwd.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, '../data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'papers.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// One table serves both kinds of papers:
//  - source = 'search': saved from search results (external_id/url/pdf_url set)
//  - source = 'upload': uploaded PDF (pdf_path set, full_text extracted)
// full_text holds the paper body used later for summaries and Q&A.
db.exec(`
  CREATE TABLE IF NOT EXISTS papers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    authors     TEXT    NOT NULL DEFAULT '[]',  -- JSON array of names
    year        INTEGER,
    abstract    TEXT,
    url         TEXT,                           -- landing page link
    pdf_url     TEXT,                           -- remote PDF link, if known
    source      TEXT    NOT NULL CHECK (source IN ('search', 'upload')),
    external_id TEXT UNIQUE,                    -- e.g. arXiv id; prevents duplicate saves
    pdf_path    TEXT,                           -- local file for uploaded PDFs
    full_text   TEXT,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )
`);

// Columns returned by the API. full_text can be very large, so it is not sent
// to the client; has_full_text tells the UI whether it exists.
const PUBLIC_COLUMNS = `
  id, title, authors, year, abstract, url, pdf_url, source, external_id,
  pdf_path IS NOT NULL AS has_pdf,
  full_text IS NOT NULL AND length(full_text) > 0 AS has_full_text,
  created_at
`;

function toPaper(row) {
  if (!row) return null;
  return {
    ...row,
    authors: JSON.parse(row.authors),
    has_pdf: Boolean(row.has_pdf),
    has_full_text: Boolean(row.has_full_text),
  };
}

const stmts = {
  list: db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM papers ORDER BY created_at DESC, id DESC`),
  get: db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM papers WHERE id = ?`),
  getByExternalId: db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM papers WHERE external_id = ?`),
  getInternal: db.prepare('SELECT pdf_path, full_text FROM papers WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO papers (title, authors, year, abstract, url, pdf_url, source, external_id, pdf_path, full_text)
    VALUES (:title, :authors, :year, :abstract, :url, :pdf_url, :source, :external_id, :pdf_path, :full_text)
  `),
  remove: db.prepare('DELETE FROM papers WHERE id = ?'),
  setFullText: db.prepare('UPDATE papers SET full_text = ? WHERE id = ?'),
};

export function listPapers() {
  return stmts.list.all().map(toPaper);
}

export function getPaper(id) {
  return toPaper(stmts.get.get(id));
}

export function getPaperByExternalId(externalId) {
  return toPaper(stmts.getByExternalId.get(externalId));
}

// Server-side only fields (local PDF path, extracted text).
export function getPaperInternals(id) {
  return stmts.getInternal.get(id) ?? null;
}

export function insertPaper(paper) {
  const { lastInsertRowid } = stmts.insert.run({
    title: paper.title,
    authors: JSON.stringify(paper.authors ?? []),
    year: paper.year ?? null,
    abstract: paper.abstract ?? null,
    url: paper.url ?? null,
    pdf_url: paper.pdf_url ?? null,
    source: paper.source,
    external_id: paper.external_id ?? null,
    pdf_path: paper.pdf_path ?? null,
    full_text: paper.full_text ?? null,
  });
  return getPaper(Number(lastInsertRowid));
}

// Caches text extracted later (e.g. from a saved search result's PDF).
export function setFullText(id, fullText) {
  return stmts.setFullText.run(fullText, id).changes > 0;
}

export function deletePaper(id) {
  return stmts.remove.run(id).changes > 0;
}
