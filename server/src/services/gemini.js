const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.5-flash';
const DEFAULT_FALLBACK_MODELS = 'gemini-3.8-flash,gemini-3.5-flash-lite';
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 60000;
// Gemini (especially the free tier) often returns short-lived "high demand"
// 503s or rate-limit 429s; retry those a couple of times before moving on to
// the next model.
const RETRY_STATUSES = new Set([429, 500, 503]);
const RETRY_DELAYS_MS = [1500, 4000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// `status` is the HTTP status our API should return for this failure.
export class GeminiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

// A 429 for a per-day quota won't clear by retrying in a few seconds.
function isDailyQuotaError(data) {
  return (data?.error?.details ?? []).some((d) =>
    d?.violations?.some((v) => /PerDay/i.test(v?.quotaId ?? ''))
  );
}

// For logs: which quotas a 429 says were exceeded, e.g. " [GenerateRequestsPerDay...]".
function quotaIds(data) {
  const ids = (data?.error?.details ?? []).flatMap((d) => d?.violations ?? []).map((v) => v?.quotaId).filter(Boolean);
  return ids.length ? ` [${ids.join(', ')}]` : '';
}

function modelList() {
  const primary = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const fallbacks = (process.env.GEMINI_FALLBACK_MODEL ?? DEFAULT_FALLBACK_MODELS)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

// Calls Gemini's generateContent REST endpoint. Tries the main model (with
// retries for temporary errors), then each fallback model in turn.
// Returns { text, model } where model is the one that actually answered.
async function generate(prompt, { responseSchema, temperature = 0 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY is not set on the server', 500);

  const generationConfig = { temperature };
  if (responseSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = responseSchema;
  }
  const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig });

  let response;
  let data;
  let model;
  let dailyQuota = false;
  for (model of modelList()) {
    for (let attempt = 0; ; attempt++) {
      try {
        response = await fetch(`${API_BASE}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        if (err.name === 'TimeoutError') throw new GeminiError('Gemini did not respond in time', 504);
        throw new GeminiError('Could not reach Gemini');
      }
      data = await response.json().catch(() => null);
      if (response.ok || !RETRY_STATUSES.has(response.status)) break;

      dailyQuota = response.status === 429 && isDailyQuotaError(data);
      const quotas = quotaIds(data);
      if (dailyQuota || attempt >= RETRY_DELAYS_MS.length) {
        console.warn(`Gemini ${model} HTTP ${response.status}${dailyQuota ? ' (daily quota used up)' : ''}${quotas}; trying next model`);
        break;
      }
      console.warn(`Gemini ${model} HTTP ${response.status}${quotas}; retrying`);
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
    if (response.ok || !RETRY_STATUSES.has(response.status)) break;
  }

  if (!response.ok) {
    const detail = data?.error?.message?.split('\n')[0] ?? `HTTP ${response.status}`;
    if (dailyQuota) throw new GeminiError(`Gemini free-tier daily quota used up for all configured models (${detail})`, 503);
    if (RETRY_STATUSES.has(response.status)) {
      throw new GeminiError(`Gemini is temporarily unavailable, try again shortly (${detail})`, 503);
    }
    throw new GeminiError(`Gemini request failed: ${detail}`);
  }

  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!text) {
    const reason = candidate?.finishReason ?? data?.promptFeedback?.blockReason ?? 'empty response';
    throw new GeminiError(`Gemini returned no text (${reason})`);
  }
  return { text, model };
}

// Returns { data, model }: the parsed JSON and the model that produced it.
export async function generateJson(prompt, responseSchema) {
  const { text, model } = await generate(prompt, { responseSchema });
  try {
    return { data: JSON.parse(text), model };
  } catch {
    throw new GeminiError('Gemini returned malformed JSON');
  }
}
