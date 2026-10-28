// 2.0 화면 (V2-SCREENS.md, 원장 지시 2026-10-28): 2.0에서만 할 수 있던 화면(시간표·원스크린·출석부 …)을 3.0 안에 2.0 형태
// 그대로 새 페이지로 그린다. 데이터는 로컬 Docker 복사본 — 운영 2.0 사이트에는 접속하지 않는다.
// Each screen is one server module `v2-screen-<id>.mjs` beside this file, found at start (no shared file to edit):
//   export const screen = { id, label, order, params: { name: /regex/ }, load: async ({ sql, params, tenantId, importV2 }) => data,
//     actions: { name: { validate: raw => body, run: async ({ sql, body, tenantId, importV2 }) => result } } }
// GET /api/v2 lists the screens; GET /api/v2/<id>?… answers one read-only, repeatable-read transaction on the copy.
// POST /api/v2/<id>/<action> (원장 2026-10-28 "일단은 docker. 연습용이므로 모두 docker") writes to the Docker copy only, one
// write at a time, and rolls back any write that queued an outbound HTTP request — nothing leaves this PC.
import { readdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { fullDbRoot } from './full-db-paths.mjs';
import { importV2 } from './v2-bridge.mjs';

export const V2_API = '/api/v2';
const SCREEN_FILE = /^v2-screen-([a-z][a-z0-9-]{0,30})\.mjs$/, ACTION = /^[a-z][a-zA-Z0-9]{0,40}$/, here = new URL('./', import.meta.url);
const BODY_LIMIT = 256 * 1024, JSON_TYPE = /^application\/json\s*(?:;\s*charset\s*=\s*"?utf-8"?\s*)?$/i;
/** Every write, kept beside the copy it changed (local only, never committed): what to undo when practice goes wrong. */
export const JOURNAL = new URL('v2-writes.jsonl', fullDbRoot);

/** A refusal written for people (Korean). A screen throws it from validate/run; any other error answers a fixed message. */
export class V2Error extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const DB_REFUSAL = {
  23505: '이미 같은 기록이 있어 저장하지 않았습니다.', 23503: '이어진 기록이 없어 저장하지 않았습니다.', 23502: '빠진 값이 있어 저장하지 않았습니다.',
  23514: '값이 규칙에 맞지 않아 저장하지 않았습니다.', '23P01': '같은 기간의 기록과 겹쳐 저장하지 않았습니다.', 42501: '수정이 막힌 기록이라 저장하지 않았습니다.',
};
const refusal = e => e instanceof V2Error ? e
  : DB_REFUSAL[e?.code] ? new V2Error(409, 'db_refused', DB_REFUSAL[e.code])
  : e?.code === 'P0001' && /[가-힣]/.test(e.message || '') ? new V2Error(409, 'db_refused', e.message) : null; // 2.0 trigger messages are Korean

/** Server modules found beside this file. A module that fails to load is skipped and logged, never breaks the server. */
export async function loadScreens(log = console.error) {
  const out = new Map();
  for (const name of (await readdir(here)).filter(n => SCREEN_FILE.test(n)).sort()) {
    try {
      const { screen } = await import(new URL(name, here).href);
      if (!screen?.id || typeof screen.load !== 'function' || `v2-screen-${screen.id}.mjs` !== name) throw new Error('screen export must match its file name');
      for (const [k, a] of Object.entries(screen.actions || {})) if (!ACTION.test(k) || typeof a?.validate !== 'function' || typeof a?.run !== 'function') throw new Error(`action ${k} needs validate and run`);
      out.set(screen.id, screen);
    } catch (error) { log(`2.0 screen ${name} skipped: ${error.message}`); }
  }
  return out;
}

/** Static files of the screens (client script and style), served only when the file exists. */
export const screenAsset = path => {
  const m = /^\/(v2-screen-[a-z][a-z0-9-]{0,30})\.(js|css)$/.exec(path); if (!m) return null;
  const file = `${m[1]}.${m[2]}`;
  return existsSync(new URL(file, here)) ? [file, m[2] === 'js' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8'] : null;
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    const end = (error, value) => { if (done) return; done = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
    const timer = setTimeout(() => end(new V2Error(408, 'request_timeout', '요청을 받는 시간이 초과되었습니다.')), 10_000);
    req.on('data', chunk => { size += chunk.length; if (size > BODY_LIMIT) { end(new V2Error(413, 'body_too_large', '요청이 너무 큽니다.')); req.resume(); } else chunks.push(chunk); });
    req.once('end', () => end(null, Buffer.concat(chunks)));
    req.once('error', () => end(new V2Error(400, 'invalid_request', '요청을 읽지 못했습니다.')));
  });
}

// pg_net queues an HTTP request as a row inside the transaction and sends it only after commit. The copy still carries 2.0's
// triggers (오늘 수학 wake on classes·students·lesson_reports …), so a write that queued any request is rolled back.
async function queuedRequests(sql) {
  const [{ present }] = await sql`select to_regclass('net.http_request_queue') is not null as present`;
  if (!present) return 0;
  const [{ n }] = await sql`select count(*)::int as n from net.http_request_queue`;
  return n;
}
const clip = (v, n) => { const t = JSON.stringify(v ?? null) ?? 'null'; return t.length > n ? `${t.slice(0, n)}…` : t; };

export function createV2ScreenRoute({ screens, headers = {}, open = openFullDatabase, journal = JOURNAL }) {
  const send = (req, res, status, body) => { const data = Buffer.from(JSON.stringify(body)); res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : data); };
  const fail = (req, res, e) => send(req, res, e.status, { error: e.code, message: e.message });
  let chain = Promise.resolve(); // writes run one at a time, so the outbound-queue count belongs to this write
  const serial = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  const record = entry => appendFile(journal, `${JSON.stringify(entry)}\n`).catch(error => console.error(`2.0 write journal failed: ${error.code || 'error'}`));

  async function write(req, res, s, [id, name]) {
    if (req.headers['sec-fetch-site'] !== 'same-origin') return fail(req, res, new V2Error(403, 'forbidden_origin', '이 화면에서만 저장할 수 있습니다.'));
    if (!JSON_TYPE.test(req.headers['content-type'] || '')) return fail(req, res, new V2Error(415, 'unsupported_media_type', 'JSON 요청만 받을 수 있습니다.'));
    const screen = s.get(id), action = screen?.actions && Object.hasOwn(screen.actions, name) ? screen.actions[name] : null;
    if (!action) return fail(req, res, new V2Error(404, 'action_not_found', '없는 저장 동작입니다.'));
    let body;
    try { body = action.validate(JSON.parse((await readBody(req)).toString('utf8') || '{}')); }
    catch (e) { return fail(req, res, e instanceof V2Error ? e : new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.')); }
    const started = Date.now(), entry = { at: new Date().toISOString(), screen: id, action: name, body: clip(body, 4000) };
    const db = await open();
    try {
      const result = await serial(() => db.begin(async sql => {
        await sql`set local statement_timeout = '20s'`;
        const before = await queuedRequests(sql), out = await action.run({ sql, body, tenantId, importV2 });
        if (await queuedRequests(sql) > before) throw new V2Error(409, 'outbound_blocked', '이 저장이 바깥으로 요청을 보내려 해서 되돌렸습니다. 바뀐 것은 없습니다.');
        return out;
      }));
      await record({ ...entry, ok: true, ms: Date.now() - started, result: clip(result, 1000) });
      return send(req, res, 200, { ok: true, result: result ?? null });
    } catch (error) {
      const r = refusal(error);
      await record({ ...entry, ok: false, ms: Date.now() - started, error: r?.code || error?.code || 'error' });
      if (!r) console.error(`2.0 screen ${id}.${name} failed: ${error?.code || ''} ${error?.message || ''}`);
      return fail(req, res, r || new V2Error(500, 'write_failed', '저장하지 못했습니다. 바뀐 것은 없습니다.'));
    } finally { await db.end(); }
  }

  return {
    handles: path => path === V2_API || path.startsWith(`${V2_API}/`),
    async handle(req, res, path) {
      const site = req.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return send(req, res, 403, { error: 'forbidden_origin', message: '이 화면에서만 요청할 수 있습니다.' });
      const s = await screens, parts = path === V2_API ? [] : path.slice(V2_API.length + 1).split('/');
      if (req.method === 'POST' && parts.length === 2) return write(req, res, s, parts);
      if (!['GET', 'HEAD'].includes(req.method)) return send(req, res, 405, { error: 'method_not_allowed', message: '저장은 화면의 저장 동작으로만 할 수 있습니다.' });
      if (!parts.length) return send(req, res, 200, { screens: [...s.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map(x => ({ id: x.id, label: x.label, order: x.order ?? 99, writable: Object.keys(x.actions || {}).length > 0, script: `/v2-screen-${x.id}.js`, style: screenAsset(`/v2-screen-${x.id}.css`) ? `/v2-screen-${x.id}.css` : null })) });
      const screen = parts.length === 1 ? s.get(parts[0]) : null;
      if (!screen) return send(req, res, 404, { error: 'screen_not_found', message: '없는 화면입니다.' });
      const q = new URL(req.url, 'http://127.0.0.1').searchParams, rules = screen.params || {}, params = {};
      for (const key of new Set(q.keys())) {
        const v = q.getAll(key);
        if (!rules[key] || v.length > 1 || v[0].length > 200 || !rules[key].test(v[0])) return send(req, res, 400, { error: 'invalid_request', message: '허용하지 않는 조회 조건입니다.' });
        params[key] = v[0];
      }
      const db = await open();
      try { return send(req, res, 200, await db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId, importV2 }))); }
      catch (error) { console.error(`2.0 screen ${screen.id} failed: ${error.message}`); return send(req, res, 500, { error: 'screen_failed', message: '이 화면을 불러오지 못했습니다.' }); }
      finally { await db.end(); }
    },
  };
}
