import { Router } from 'express';
import { parseId, ValidationError } from './papers.js';
import { getPaperWithText, ContentError } from '../services/content.js';
import { summarizePaper, answerQuestion } from '../services/llm.js';
import { GeminiError } from '../services/gemini.js';
import { PdfError } from '../services/pdf.js';

const router = Router();

const MAX_QUESTION_LENGTH = 1000;

// POST /api/papers/:id/summary
router.post('/:id/summary', async (req, res, next) => {
  try {
    const { paper, text, contentSource } = await getPaperWithText(parseId(req.params.id));
    const { summary, model, context } = await summarizePaper(paper, text);
    res.json({ paper_id: paper.id, title: paper.title, summary, model, content_source: contentSource, context });
  } catch (err) {
    next(err);
  }
});

// POST /api/papers/:id/questions  { "question": "What datasets are used?" }
router.post('/:id/questions', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const question = req.body?.question;
    if (question === undefined || question === null) throw new ValidationError('question is required');
    if (typeof question !== 'string') throw new ValidationError('question must be a string');
    const q = question.trim();
    if (!q) throw new ValidationError('question cannot be blank');
    if (q.length > MAX_QUESTION_LENGTH) throw new ValidationError(`question must be at most ${MAX_QUESTION_LENGTH} characters`);

    const { paper, text, contentSource } = await getPaperWithText(id);
    const result = await answerQuestion(paper, text, q);
    res.json({ paper_id: paper.id, ...result, content_source: contentSource });
  } catch (err) {
    next(err);
  }
});

router.use((err, req, res, next) => {
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
  if (err instanceof ContentError) return res.status(err.status).json({ error: err.message });
  if (err instanceof PdfError) return res.status(err.status).json({ error: `Paper PDF could not be processed: ${err.message}` });
  if (err instanceof GeminiError) {
    console.error(`Gemini error on ${req.method} ${req.originalUrl}: ${err.message}`);
    return res.status(err.status).json({ error: `AI request failed: ${err.message}` });
  }
  next(err);
});

export default router;
