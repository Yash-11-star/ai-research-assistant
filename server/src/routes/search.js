import { Router } from 'express';
import { searchArxiv, ArxivError } from '../services/arxiv.js';

const router = Router();

const MAX_RESULTS = 10;
const MAX_QUERY_LENGTH = 300;

// GET /api/search?q=machine+learning
router.get('/', async (req, res, next) => {
  const { q } = req.query;

  if (q === undefined) return res.status(400).json({ error: 'Missing query parameter "q"' });
  if (typeof q !== 'string') return res.status(400).json({ error: 'Query parameter "q" must be a single string' });

  const query = q.trim();
  if (!query) return res.status(400).json({ error: 'Search query cannot be blank' });
  if (query.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({ error: `Search query must be at most ${MAX_QUERY_LENGTH} characters` });
  }

  try {
    const { total, results } = await searchArxiv(query, MAX_RESULTS);
    res.json({ query, total, results });
  } catch (err) {
    if (err instanceof ArxivError) {
      console.error(`Search failed for "${query}": ${err.message}`);
      return res.status(err.status).json({ error: err.userFacing ? err.message : `Paper search failed: ${err.message}` });
    }
    next(err);
  }
});

export default router;
