// 2.0 화면 (V2-SCREENS.md, 원장 지시 2026-10-28): 2.0에서만 할 수 있던 화면(시간표·원스크린·출석부 …)을 3.0 안에 2.0 형태
// 그대로 새 페이지로 그린다. 데이터는 로컬 Docker 복사본 — 운영 2.0 사이트에는 접속하지 않는다.
// Each screen is one server module `v2-screen-<id>.mjs` beside this file, found at start (no shared file to edit):
//   export const screen = { id, label, order, params: { name: /regex/ }, load: async ({ sql, params, tenantId, importV2 }) => data }
// GET /api/v2 lists the screens; GET /api/v2/<id>?… answers one read-only, repeatable-read transaction on the copy.
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';

export const V2_API = '/api/v2';
const SCREEN_FILE = /^v2-screen-([a-z][a-z0-9-]{0,30})\.mjs$/, here = new URL('./', import.meta.url);

/** Server modules found beside this file. A module that fails to load is skipped and logged, never breaks the server. */
export async function loadScreens(log = console.error) {
  const out = new Map();
  for (const name of (await readdir(here)).filter(n => SCREEN_FILE.test(n)).sort()) {
    try {
      const { screen } = await import(new URL(name, here).href);
      if (!screen?.id || typeof screen.load !== 'function' || `v2-screen-${screen.id}.mjs` !== name) throw new Error('screen export must match its file name');
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

export function createV2ScreenRoute({ screens, headers = {}, open = openFullDatabase }) {
  const send = (req, res, status, body) => { const data = Buffer.from(JSON.stringify(body)); res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : data); };
  return {
    handles: path => path === V2_API || path.startsWith(`${V2_API}/`),
    async handle(req, res, path) {
      const site = req.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return send(req, res, 403, { error: 'forbidden_origin', message: '이 화면에서만 요청할 수 있습니다.' });
      if (!['GET', 'HEAD'].includes(req.method)) return send(req, res, 405, { error: 'method_not_allowed', message: '조회만 할 수 있습니다.' });
      const s = await screens;
      if (path === V2_API) return send(req, res, 200, { screens: [...s.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map(x => ({ id: x.id, label: x.label, order: x.order ?? 99, script: `/v2-screen-${x.id}.js`, style: screenAsset(`/v2-screen-${x.id}.css`) ? `/v2-screen-${x.id}.css` : null })) });
      const screen = s.get(path.slice(V2_API.length + 1));
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
