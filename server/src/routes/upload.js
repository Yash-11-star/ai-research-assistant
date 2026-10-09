import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, insertPaper } from '../db.js';
import { looksLikePdf, extractPdfText, PdfError } from '../services/pdf.js';
import { extractMetadata } from '../services/metadata.js';
import { GeminiError } from '../services/gemini.js';

const router = Router();

export const MAX_UPLOAD_MB = 20;
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// Keep the upload in memory until it has been validated and processed, so a
// rejected or failed upload never leaves a file on disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 0 },
});

// Runs multer and turns its errors into JSON 4xx responses.
function receiveSinglePdf(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: [413, `PDF must be at most ${MAX_UPLOAD_MB} MB`],
        LIMIT_FILE_COUNT: [400, 'Upload exactly one PDF file'],
        LIMIT_UNEXPECTED_FILE: [400, 'Upload exactly one PDF in the form field "file"'],
        LIMIT_FIELD_COUNT: [400, 'Only a "file" field is accepted'],
      };
      const [status, message] = messages[err.code] ?? [400, err.message];
      return res.status(status).json({ error: message });
    }
    if (/multipart/i.test(err.message)) return res.status(400).json({ error: 'Malformed multipart/form-data request' });
    next(err);
  });
}

// POST /api/papers/upload  (multipart/form-data, field "file")
router.post('/', receiveSinglePdf, async (req, res, next) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No file uploaded. Send a PDF in the form field "file" (multipart/form-data).' });
  }

  // Reject obviously wrong types by name/type, then check the actual bytes.
  const ext = path.extname(file.originalname).toLowerCase();
  const declaredPdf = file.mimetype === 'application/pdf' || ext === '.pdf';
  if (!declaredPdf || !looksLikePdf(file.buffer)) {
    return res.status(415).json({ error: 'Only PDF files are accepted' });
  }

  let storedPath = null;
  try {
    const { totalPages, pages } = await extractPdfText(file.buffer);
    const meta = await extractMetadata(pages);

    // The original filename is used only as a last-resort display title, never for storage.
    let title = meta.title;
    if (!title) {
      title = path.basename(file.originalname, ext).trim() || 'Untitled PDF';
      meta.warnings.push(`Using the file name "${title}" as a placeholder title`);
    }

    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    const fileName = `${randomUUID()}.pdf`;
    storedPath = path.join(UPLOADS_DIR, fileName);
    await fs.writeFile(storedPath, file.buffer, { flag: 'wx' });

    const paper = insertPaper({
      title,
      authors: meta.authors,
      year: meta.year,
      abstract: meta.abstract,
      source: 'upload',
      pdf_path: `uploads/${fileName}`, // relative to DATA_DIR
      full_text: pages.join('\n\n'),
    });

    if (meta.warnings.length) console.warn(`Upload #${paper.id}: ${meta.warnings.join('; ')}`);
    res.status(201).json({ ...paper, pages: totalPages, warnings: meta.warnings });
  } catch (err) {
    if (storedPath) await fs.rm(storedPath, { force: true }).catch(() => {});

    if (err instanceof PdfError || err instanceof GeminiError) {
      console.error(`Upload of "${file.originalname}" failed: ${err.message}`);
      const prefix = err instanceof GeminiError ? 'Metadata extraction failed: ' : '';
      return res.status(err.status).json({ error: prefix + err.message });
    }
    next(err);
  }
});

export default router;
