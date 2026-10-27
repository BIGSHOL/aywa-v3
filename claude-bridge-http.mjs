// POST /api/assistant for the local dev server. Only a same-origin JSON POST
// from the loopback page can start a (subscription-billed) Claude call; one call
// runs at a time, calls per window are capped, and a closed request kills it.
import { fileURLToPath } from 'node:url';
import { BridgeError, FAILURES, claudeArgs, cliAvailable, createClaudeRunner, defaultCliPath, prepareRuntimeDir } from './claude-bridge.mjs';
import { buildAssistantContext } from './claude-bridge-context.mjs';
import { LIMITS, buildInput, normalizeAnswer, validateRequest } from './claude-bridge-prompt.mjs';

export const ASSISTANT_PATH = '/api/assistant';
const JSON_TYPE = /^application\/json\s*(?:;\s*charset\s*=\s*"?utf-8"?\s*)?$/i;
const err = (code, status, message) => new BridgeError(code, status, message);

export function createReadiness(check, { okTtlMs = 15 * 60_000, failTtlMs = 30_000, now = Date.now } = {}) {
  let state = null, at = 0, pending = null;
  const refresh = () => pending ??= check()
    .then(info => { state = { ok: true, info }; }, error => { state = { ok: false, error: error instanceof BridgeError ? error : FAILURES.failed() }; })
    .finally(() => { at = now(); pending = null; });
  return {
    refresh,
    invalidate() { at = 0; },
    get state() { return state; },
    async require() {
      if (!state || now() - at > (state.ok ? okTtlMs : failTtlMs)) await refresh();
      if (!state.ok) throw state.error;
      return state.info;
    },
  };
}

function readBody(req, max, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    const end = (error, value) => { if (done) return; done = true; clearTimeout(timer); req.off('data', onData); if (error) reject(error); else resolve(value); };
    const onData = chunk => { size += chunk.length; if (size > max) { end(err('body_too_large', 413, '요청이 너무 큽니다.')); req.resume(); return; } chunks.push(chunk); };
    const timer = setTimeout(() => end(err('request_timeout', 408, '요청을 받는 시간이 초과되었습니다.')), timeoutMs);
    req.on('data', onData);
    req.once('end', () => end(null, Buffer.concat(chunks)));
    req.once('error', () => end(err('invalid_request', 400, '요청을 읽지 못했습니다.')));
  });
}

export function createAssistantRoute({ context, runner, readiness, origins, headers = {}, enabled = true, maxConcurrent = 1, rate = { max: 10, windowMs: 5 * 60_000 }, readTimeoutMs = 10_000, now = Date.now, log = () => {} }) {
  let active = 0;
  const stamps = [];
  const send = (res, status, body, extra = {}) => {
    if (res.headersSent || res.destroyed) return;
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, ...extra });
    res.end(data);
  };
  const fail = (res, error, extra = {}) => send(res, error.status, { error: error.code, message: error.message }, extra);
  async function answer(req, res, signal) {
    let request;
    try {
      const body = await readBody(req, LIMITS.body, readTimeoutMs);
      let parsed; try { parsed = JSON.parse(body.toString('utf8')); } catch { throw err('invalid_request', 400, '요청 형식이 올바르지 않습니다.'); }
      request = validateRequest(parsed);
      await readiness.require();
    } catch (error) { fail(res, error instanceof BridgeError ? error : FAILURES.failed(), error?.status === 413 ? { Connection: 'close' } : {}); return; }
    if (signal.aborted) { log('assistant cancelled before start'); return; }
    if (active >= maxConcurrent) { fail(res, err('busy', 429, '이전 질문의 답변을 만드는 중입니다. 잠시 후 다시 시도해 주세요.'), { 'Retry-After': '5' }); return; }
    const t = now();
    while (stamps.length && t - stamps[0] >= rate.windowMs) stamps.shift();
    if (stamps.length >= rate.max) { fail(res, err('rate_limited', 429, '짧은 시간에 질문이 많았습니다. 잠시 후 다시 시도해 주세요.'), { 'Retry-After': String(Math.max(1, Math.ceil((rate.windowMs - (t - stamps[0])) / 1000))) }); return; }
    active += 1; stamps.push(t);
    try {
      const { output, meta } = await runner.ask({ input: buildInput(context, request), signal });
      const reply = normalizeAnswer(output);
      log(`assistant ok ${(meta.ms / 1000).toFixed(1)}s ${meta.models.join(',') || 'model?'}`);
      send(res, 200, reply);
    } catch (error) {
      const failure = error instanceof BridgeError ? error : FAILURES.failed();
      if (failure.code === 'auth_required' || failure.code === 'subscription_required' || failure.code === 'cli_missing') readiness.invalidate();
      log(`assistant ${failure.code}`);
      if (!signal.aborted) fail(res, failure, failure.status === 429 ? { 'Retry-After': '30' } : {});
    } finally { active -= 1; }
  }
  return {
    path: ASSISTANT_PATH,
    async handle(req, res) {
      if (!enabled) { send(res, 404, { error: 'not_found', message: '사용할 수 없는 주소입니다.' }); return; }
      if (req.method !== 'POST') { fail(res, err('method_not_allowed', 405, 'POST로만 요청할 수 있습니다.'), { Allow: 'POST' }); return; }
      const site = req.headers['sec-fetch-site'];
      if (!origins.has(req.headers.origin) || (site && site !== 'same-origin')) { fail(res, err('forbidden_origin', 403, '이 화면에서만 요청할 수 있습니다.')); return; }
      if (!JSON_TYPE.test(req.headers['content-type'] || '') || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) { fail(res, err('unsupported_media_type', 415, 'JSON 요청만 받을 수 있습니다.')); return; }
      if (Number(req.headers['content-length'] || 0) > LIMITS.body) { fail(res, err('body_too_large', 413, '요청이 너무 큽니다.'), { Connection: 'close' }); return; }
      // Watch for the browser leaving from here on, so a request that is gone
      // before the CLI starts never starts it.
      const controller = new AbortController();
      const onClose = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', onClose);
      try { await answer(req, res, controller.signal); } finally { res.off('close', onClose); }
    },
  };
}

// Wiring for serve-live.mjs. Local dev only: production-like environments get 404.
export function createAssistantFromEnv({ snapshot, origins, headers, runtimeDefault, env = process.env, log = console.log }) {
  const enabled = env.NODE_ENV !== 'production' && !env.VERCEL && !env.VERCEL_ENV && env.OWNER_CONCEPT_ASSISTANT !== 'off';
  const command = env.OWNER_CONCEPT_CLAUDE_BIN || defaultCliPath(env);
  const runtime = env.OWNER_CONCEPT_CLAUDE_RUNTIME || (runtimeDefault ? fileURLToPath(runtimeDefault) : '');
  const runner = createClaudeRunner({ command, cwd: runtime, args: claudeArgs({ model: env.OWNER_CONCEPT_CLAUDE_MODEL || 'sonnet', effort: env.OWNER_CONCEPT_CLAUDE_EFFORT || 'low' }) });
  const readiness = createReadiness(async () => {
    if (!command || !(await cliAvailable(command))) throw FAILURES.missing();
    await prepareRuntimeDir(runtime);
    return runner.checkAuth();
  });
  const route = createAssistantRoute({ context: buildAssistantContext(snapshot), runner, readiness, origins, headers, enabled, log });
  if (enabled) readiness.refresh().then(() => {
    const s = readiness.state;
    log(s.ok ? `Assistant: claude -p via ${s.info.authMethod} subscription (${s.info.subscriptionType}, ${s.info.apiProvider}) · ${ASSISTANT_PATH}` : `Assistant unavailable: ${s.error.code}`);
  });
  return route;
}
