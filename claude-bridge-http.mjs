// POST /api/assistant for the local dev server. Only a same-origin JSON POST
// from the loopback page can start a (subscription-billed) Claude call; one call
// runs at a time, calls per window are capped, and a closed request kills it.
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BridgeError, FAILURES, claudeArgs, cliAvailable, createClaudeRunner, defaultCliPath, prepareRuntimeDir } from './claude-bridge.mjs';
import { areaDestinations, buildAssistantContext } from './claude-bridge-context.mjs';
import { LIMITS, buildInput, normalizeAnswer, requestFacts, validateRequest } from './claude-bridge-prompt.mjs';

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

// destinations.list = 답 아래 바로 가기·요청 영역으로 고를 수 있는 곳(서버가 아는 목록), records() = 작업 영역 기록 저장소(요청안의 기록 확인).
export function createAssistantRoute({ context, runner, readiness, origins, headers = {}, enabled = true, maxConcurrent = 1, rate = { max: 10, windowMs: 5 * 60_000 }, readTimeoutMs = 10_000, now = Date.now, log = () => {}, destinations = { list: [] }, records = null }) {
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
      const facts = requestFacts(context, request), list = destinations.list;
      const { output, meta } = await runner.ask({ input: buildInput(context, request, undefined, { facts, destinations: list }), signal });
      const reply = normalizeAnswer(output, { facts, destinations: list, records });
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
  // 바로 가기 목록 — 작업 영역(스냅샷)은 바로, 연습 화면·확장 추세 지표는 서버가 이미 불러 둔 모듈에서 이어 붙인다.
  const destinations = { list: areaDestinations(snapshot) };
  let store = null;
  if (enabled) {
    extraDestinations().then(extra => { destinations.list = [...destinations.list, ...extra]; }).catch(e => log(`assistant destinations: ${e?.message || e}`));
    import('./domain-snapshot.mjs').then(m => { store = m.workspaceRecords; }).catch(() => {});
  }
  const route = createAssistantRoute({ context: buildAssistantContext(snapshot), runner, readiness, origins, headers, enabled, log, destinations, records: () => store?.() ?? null });
  if (enabled) readiness.refresh().then(() => {
    const s = readiness.state;
    log(s.ok ? `Assistant: claude -p via ${s.info.authMethod} subscription (${s.info.subscriptionType}, ${s.info.apiProvider}) · ${ASSISTANT_PATH}` : `Assistant unavailable: ${s.error.code}`);
  });
  return route;
}

/** 연습 화면(v2-screen-<id>.mjs의 id·이름)과 확장 추세 지표 — 이동 단추가 고를 수 있는 곳. 확장 추세 화면 자체는 지표로만 들어간다. */
export async function extraDestinations(dir = new URL('./', import.meta.url)) {
  const out = [];
  for (const name of (await readdir(dir)).filter(n => /^v2-screen-[a-z-]+\.mjs$/.test(n)).sort()) {
    try {
      const { screen } = await import(new URL(name, dir).href);
      if (screen?.id && screen.id !== 'trend' && typeof screen.label === 'string') out.push(Object.freeze({ id: `v2:${screen.id}`, label: screen.label }));
    } catch { /* 불러오지 못한 화면은 목록에서 뺀다 */ }
  }
  try {
    const { TREND_METRICS } = await import(new URL('trend-metrics.mjs', dir).href);
    for (const m of TREND_METRICS || []) if (/^[a-z0-9-]{1,40}$/.test(m.id)) out.push(Object.freeze({ id: `trend:${m.id}`, label: `${m.label} 추세` }));
  } catch { /* 추세 지표 없음 */ }
  return out;
}
