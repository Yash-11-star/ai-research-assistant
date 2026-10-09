// Thin wrapper around fetch for our backend. Every failure becomes an ApiError
// with a message that is safe to show to the user.
export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      // JSON bodies are sent as strings; FormData sets its own multipart header.
      headers: typeof options.body === 'string' ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is the backend running?', 0);
  }

  if (response.status === 204) return null;

  // The backend always answers JSON; anything else (e.g. the dev proxy's error
  // page when the backend is down) is reported as a server problem.
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error ?? (response.status >= 500 ? 'Cannot reach the server. Is the backend running?' : `Request failed (HTTP ${response.status})`);
    throw new ApiError(message, response.status, body);
  }
  if (body === null) throw new ApiError('The server sent an unexpected response.', response.status);
  return body;
}

export const api = {
  search: (query) => request(`/search?q=${encodeURIComponent(query)}`),
  listPapers: () => request('/papers'),
  getPaper: (id) => request(`/papers/${id}`),
  uploadPaper: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/papers/upload', { method: 'POST', body: form });
  },
  summarize: (id) => request(`/papers/${id}/summary`, { method: 'POST' }),
  ask: (id, question) => request(`/papers/${id}/questions`, { method: 'POST', body: JSON.stringify({ question }) }),
  savePaper: (paper) => request('/papers', { method: 'POST', body: JSON.stringify(paper) }),
  deletePaper: (id) => request(`/papers/${id}`, { method: 'DELETE' }),
};
