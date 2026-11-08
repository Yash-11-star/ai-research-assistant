import express from 'express';
import cors from 'cors';
import papersRouter from './routes/papers.js';
import searchRouter from './routes/search.js';
import uploadRouter from './routes/upload.js';
import aiRouter from './routes/ai.js';

// The Express app, without starting a server, so tests can import it.
const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, geminiKeyLoaded: Boolean(process.env.GEMINI_API_KEY) });
});

app.use('/api/papers/upload', uploadRouter);
app.use('/api/papers', aiRouter);
app.use('/api/papers', papersRouter);
app.use('/api/search', searchRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
});

// Malformed JSON bodies -> 400; anything unexpected -> 500 without leaking internals.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
