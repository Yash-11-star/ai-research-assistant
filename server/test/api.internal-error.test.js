import { it, expect, vi } from 'vitest';
import request from 'supertest';

// Simulate an unexpected failure (e.g. the database file became unreadable).
vi.mock('../src/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  listPapers: () => {
    throw new Error('SQLITE_CORRUPT: database disk image is malformed at /secret/path');
  },
}));

const { default: app } = await import('../src/app.js');

it('unexpected errors return a generic 500 that does not leak internals', async () => {
  const res = await request(app).get('/api/papers');
  expect(res.status).toBe(500);
  expect(res.body).toEqual({ error: 'Internal server error' });
  expect(JSON.stringify(res.body)).not.toContain('SQLITE');
});
