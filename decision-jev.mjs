// TypeSafe System One transport for the owner-concept decision adapter (server only).
// One bounded attempt per call: no retries, no generative fallback, no error-body
// reads (provider bodies can echo input). Answers are validated against the exact
// questions sent; anything missing or inconsistent is an error, never a default.
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const MODELS_ENDPOINT = 'https://api.typesafe.ai/v1/models';
// Versioned IDs only: an alias (jev-latest) can move and silently change answers.
export const JEV_MODELS = Object.freeze(['jev-1.14.0', 'jev-1.13.0']);
export const DEFAULT_JEV_MODEL = 'jev-1.14.0';
// List price from https://docs.typesafe.ai/models (read 2026-10-27): input only, output free.
export const JEV_PRICE_USD_PER_MTOK = Object.freeze({ 'jev-1.14.0': 0.042, 'jev-1.13.0': 0.042 });
export const PRICE_SOURCE = 'docs.typesafe.ai/models list price, read 2026-10-27';
const MAX_BODY_BYTES = 120_000;

export class JevCallError extends Error {
  constructor(code, message, { status = null, usage = null, retryAfterMs = null } = {}) {
    super(message); this.code = code; this.status = status; this.usage = usage; this.retryAfterMs = retryAfterMs;
  }
}
const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const isProbability = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const tokenCount = v => (Number.isSafeInteger(v) && v >= 0 ? v : null);

export function estimateJevCostUsd(model, inputTokens) {
  const price = JEV_PRICE_USD_PER_MTOK[model];
  return price != null && Number.isSafeInteger(inputTokens) ? (inputTokens * price) / 1_000_000 : null;
}

export function validateQuestions(questions) {
  const entries = isObject(questions) ? Object.entries(questions) : [];
  if (!entries.length || entries.length > 16) return false;
  return entries.every(([id, q]) => /^[a-z][a-z0-9_]{0,63}$/.test(id) && isObject(q) && (
    (q.type === 'noul' && typeof q.instructions === 'string' && q.instructions.trim())
    || (q.type === 'choice' && typeof q.instructions === 'string' && q.instructions.trim()
      && isObject(q.criteria) && Object.keys(q.criteria).length >= 2 && Object.keys(q.criteria).length <= 255)));
}

/** Validates a 200 body against the questions that were sent. Throws JevCallError('invalid_response'). */
export function parseSystemOneResponse(raw, questions, expectedModel) {
  const usage = isObject(raw) && isObject(raw.usage)
    ? { inputTokens: tokenCount(raw.usage.input_tokens), outputTokens: tokenCount(raw.usage.output_tokens) }
    : { inputTokens: null, outputTokens: null };
  const invalid = detail => new JevCallError('invalid_response', `Jev 응답 형식 오류(${detail})`, { usage });
  if (!isObject(raw) || !isObject(raw.answers)) throw invalid('body');
  if (raw.model !== expectedModel) throw invalid('model');
  const answers = {};
  for (const [id, question] of Object.entries(questions)) {
    const a = raw.answers[id];
    if (!isObject(a) || a.type !== question.type) throw invalid(id);
    if (question.type === 'noul') {
      if (!isProbability(a.noul)) throw invalid(id);
      answers[id] = { type: 'noul', probability: a.noul };
      continue;
    }
    const labels = Object.keys(question.criteria);
    if (typeof a.choice !== 'string' || !labels.includes(a.choice) || !isProbability(a.confidence) || !isObject(a.probabilities)) throw invalid(id);
    if (Object.keys(a.probabilities).length !== labels.length || !labels.every(l => isProbability(a.probabilities[l]))) throw invalid(id);
    const probabilities = Object.fromEntries(labels.map(l => [l, a.probabilities[l]]));
    const values = Object.values(probabilities);
    // Provider rounds distributions; tolerate rounding, not missing mass or a non-argmax pick.
    if (Math.abs(values.reduce((s, p) => s + p, 0) - 1) > 0.02 || probabilities[a.choice] < Math.max(...values)) throw invalid(id);
    answers[id] = { type: 'choice', choice: a.choice, confidence: a.confidence, probabilities };
  }
  return { answers, model: raw.model, usage };
}

function retryAfter(response) {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 300) * 1000 : null;
}
/** Ref'd timer (AbortSignal.timeout is unref'd and cannot fire if nothing else holds the loop); always cleared. */
function deadline(ms, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { timedOut: () => controller.signal.aborted, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, clear: () => clearTimeout(timer) };
}
function httpError(response) {
  const s = response.status;
  const code = s === 401 || s === 403 ? 'auth' : s === 429 ? 'rate_limited' : s === 529 ? 'overloaded'
    : s === 400 || s === 413 || s === 422 ? 'request_rejected' : 'http_error';
  return new JevCallError(code, `Jev HTTP ${s}`, { status: s, retryAfterMs: retryAfter(response) });
}

/** POST /v1/systemone once. `signal` cancels; `timeoutMs` bounds the whole exchange including the body read. */
export async function callSystemOne({ state, questions, apiKey, model = DEFAULT_JEV_MODEL, timeoutMs = 8_000, signal, fetchImpl = globalThis.fetch }) {
  if (typeof window !== 'undefined') throw new JevCallError('server_only', 'Jev는 서버에서만 호출할 수 있습니다');
  if (!JEV_MODELS.includes(model)) throw new JevCallError('config', '허용되지 않은 Jev 모델입니다');
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new JevCallError('no_key', 'TypeSafe API 키가 없습니다');
  if (!validateQuestions(questions)) throw new JevCallError('config', 'Jev 질문 구성이 올바르지 않습니다');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new JevCallError('config', 'Jev 제한 시간이 올바르지 않습니다');
  const body = JSON.stringify({ model, state, questions });
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw new JevCallError('too_large', 'Jev 입력이 너무 큽니다');
  if (signal?.aborted) throw new JevCallError('cancelled', '요청이 취소되었습니다');
  const limit = deadline(timeoutMs, signal);
  const started = performance.now();
  try {
    const response = await fetchImpl(JEV_ENDPOINT, {
      method: 'POST', cache: 'no-store', redirect: 'error', signal: limit.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body,
    });
    if (!response.ok) { response.body?.cancel?.().catch(() => {}); throw httpError(response); }
    const parsed = parseSystemOneResponse(await response.json(), questions, model);
    return { ...parsed, elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    if (error instanceof JevCallError) throw error;
    if (signal?.aborted) throw new JevCallError('cancelled', '요청이 취소되었습니다');
    if (limit.timedOut()) throw new JevCallError('timeout', 'Jev 응답 시간 초과');
    throw new JevCallError('network', 'Jev 연결 또는 응답 해석 실패');
  } finally { limit.clear(); }
}

/** GET /v1/models: authenticates the key and lists names the account can send. Not billed per token. */
export async function listJevModels({ apiKey, timeoutMs = 8_000, signal, fetchImpl = globalThis.fetch }) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new JevCallError('no_key', 'TypeSafe API 키가 없습니다');
  const limit = deadline(timeoutMs, signal);
  const started = performance.now();
  try {
    const response = await fetchImpl(MODELS_ENDPOINT, { method: 'GET', cache: 'no-store', redirect: 'error',
      signal: limit.signal, headers: { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) { response.body?.cancel?.().catch(() => {}); throw httpError(response); }
    const raw = await response.json();
    if (!isObject(raw) || !Array.isArray(raw.models)) throw new JevCallError('invalid_response', 'Jev 모델 목록 형식 오류');
    const models = raw.models.filter(m => isObject(m) && typeof m.name === 'string')
      .map(m => ({ name: m.name, releaseDate: typeof m.release_date === 'string' ? m.release_date : null }));
    return { models, elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    if (error instanceof JevCallError) throw error;
    throw new JevCallError(signal?.aborted ? 'cancelled' : limit.timedOut() ? 'timeout' : 'network', 'Jev 모델 목록 조회 실패');
  } finally { limit.clear(); }
}
