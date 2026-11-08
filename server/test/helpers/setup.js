import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, vi } from 'vitest';

// Runs before every test file, before any app module is imported: point the
// app at a throwaway data directory and database so tests never touch the
// real library in server/data.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-test-'));
process.env.DATA_DIR = dir;
process.env.DB_PATH = path.join(dir, 'papers.db');
process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MODEL = 'model-a';
process.env.GEMINI_FALLBACK_MODEL = 'model-b';

// Keep test output readable; the app logs every handled error.
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'log').mockImplementation(() => {});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});
