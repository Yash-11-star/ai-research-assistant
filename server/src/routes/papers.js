import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  DATA_DIR,
  listPapers,
  getPaper,
  getPaperByExternalId,
  getPaperInternals,
  insertPaper,
  deletePaper,
} from '../db.js';

const router = Router();

export class ValidationError extends Error {}

export function parseId(raw) {
  const id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id < 1) {
    throw new ValidationError('id must be a positive integer');
  }
  return id;
}

function optionalString(value, field, maxLength) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new ValidationError(`${field} must be at most ${maxLength} characters`);
  return trimmed || null;
}

function optionalUrl(value, field) {
  const str = optionalString(value, field, 2000);
  if (str === null) return null;
  let parsed;
  try {
    parsed = new URL(str);
  } catch {
    throw new ValidationError(`${field} must be a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError(`${field} must be an http(s) URL`);
  }
  return str;
}

// Validates a paper coming from the client (a search result being saved).
// pdf_path and full_text are server-managed and never accepted from the client.
function validateNewPaper(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }

  const title = optionalString(body.title, 'title', 1000);
  if (!title) throw new ValidationError('title is required');

  let authors = [];
  if (body.authors !== undefined && body.authors !== null) {
    if (!Array.isArray(body.authors) || body.authors.some((a) => typeof a !== 'string')) {
      throw new ValidationError('authors must be an array of strings');
    }
    if (body.authors.length > 500) throw new ValidationError('authors must have at most 500 entries');
    authors = body.authors.map((a) => a.trim()).filter(Boolean);
  }

  let year = null;
  if (body.year !== undefined && body.year !== null && body.year !== '') {
    const maxYear = new Date().getFullYear() + 1;
    year = Number(body.year);
    if (!Number.isInteger(year) || year < 1000 || year > maxYear) {
      throw new ValidationError(`year must be an integer between 1000 and ${maxYear}`);
    }
  }

  return {
    title,
    authors,
    year,
    abstract: optionalString(body.abstract, 'abstract', 20000),
    url: optionalUrl(body.url, 'url'),
    pdf_url: optionalUrl(body.pdf_url, 'pdf_url'),
    external_id: optionalString(body.external_id, 'external_id', 200),
    source: 'search',
  };
}

router.get('/', (req, res) => {
  res.json(listPapers());
});

router.get('/:id', (req, res) => {
  const paper = getPaper(parseId(req.params.id));
  if (!paper) return res.status(404).json({ error: 'Paper not found' });
  res.json(paper);
});

router.post('/', (req, res) => {
  const paper = validateNewPaper(req.body);

  if (paper.external_id) {
    const existing = getPaperByExternalId(paper.external_id);
    if (existing) {
      return res.status(409).json({ error: 'Paper is already in your library', paper: existing });
    }
  }

  res.status(201).json(insertPaper(paper));
});

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const internals = getPaperInternals(id);
  if (!internals) return res.status(404).json({ error: 'Paper not found' });

  deletePaper(id);

  // Remove the uploaded PDF too, but only if it lives inside our data directory.
  if (internals.pdf_path) {
    const resolved = path.resolve(DATA_DIR, internals.pdf_path);
    if (resolved.startsWith(DATA_DIR + path.sep)) {
      fs.rm(resolved, { force: true }, (err) => {
        if (err) console.error(`Failed to delete PDF ${resolved}:`, err);
      });
    }
  }

  res.status(204).end();
});

// Turn validation failures into 400s; let everything else fall through.
router.use((err, req, res, next) => {
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
  next(err);
});

export default router;
