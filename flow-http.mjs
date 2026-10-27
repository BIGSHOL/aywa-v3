// GET /api/flow and POST /api/flow/actions for the local dev server. Same guards as the
// assistant: exact same-origin, JSON only, bounded body. The store directory is never served.
import { CommandError } from './flow-commands.mjs';
import { StoreError } from './flow-store.mjs';

export const FLOW_PATH = '/api/flow', ACTIONS_PATH = '/api/flow/actions';
const BODY_LIMIT = 16 * 1024;
const JSON_TYPE = /^application\/json\s*(?:;\s*charset\s*=\s*"?utf-8"?\s*)?$/i;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    const end = (error, value) => { if (done) return; done = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
    const timer = setTimeout(() => end(new CommandError(408, 'request_timeout', '요청을 받는 시간이 초과되었습니다.')), 10_000);
    req.on('data', chunk => { size += chunk.length; if (size > BODY_LIMIT) { end(new CommandError(413, 'body_too_large', '요청이 너무 큽니다.')); req.resume(); } else chunks.push(chunk); });
    req.once('end', () => end(null, Buffer.concat(chunks)));
    req.once('error', () => end(new CommandError(400, 'invalid_request', '요청을 읽지 못했습니다.')));
  });
}

export function createFlowRoute({ flow, origins, headers = {}, enabled = true }) {
  const send = (res, status, body, extra = {}) => {
    if (res.headersSent || res.destroyed) return;
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, ...extra });
    res.end(data);
  };
  const fail = (res, error) => {
    if (error instanceof CommandError) return send(res, error.status, { error: error.code, message: error.message, ...error.extra }, error.status === 413 ? { Connection: 'close' } : {});
    if (error instanceof StoreError) return send(res, error.code === 'store_write_failed' ? 500 : 503, { error: error.code, message: error.message });
    return send(res, 500, { error: 'flow_failed', message: '업무 흐름을 처리하지 못했습니다.' });
  };
  const unavailable = res => { const f = flow.failure; send(res, 503, f ? { error: f.code, message: f.message } : { error: 'flow_starting', message: '업무 흐름을 준비하는 중입니다.' }, { 'Retry-After': '2' }); };
  return {
    handles: path => path === FLOW_PATH || path === ACTIONS_PATH,
    async handle(req, res, path) {
      if (!enabled) return send(res, 404, { error: 'not_found', message: '사용할 수 없는 주소입니다.' });
      const site = req.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return send(res, 403, { error: 'forbidden_origin', message: '이 화면에서만 요청할 수 있습니다.' });
      if (path === FLOW_PATH) {
        if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'method_not_allowed', message: '조회만 할 수 있습니다.' }, { Allow: 'GET, HEAD' });
        if (!flow.service) return unavailable(res);
        const q = new URL(req.url, 'http://127.0.0.1').searchParams, int = v => /^[1-9]\d{0,6}$/.test(v || '') ? Number(v) : null;
        for (const k of q.keys()) if (!['casePage', 'eventsBefore'].includes(k)) return send(res, 400, { error: 'invalid_request', message: '허용하지 않는 조회 조건입니다.' });
        if ((q.has('casePage') && !int(q.get('casePage'))) || (q.has('eventsBefore') && !int(q.get('eventsBefore')))) return send(res, 400, { error: 'invalid_request', message: '조회 조건이 올바르지 않습니다.' });
        const body = Buffer.from(JSON.stringify(flow.service.view({ casePage: int(q.get('casePage')) || 1, eventsBefore: int(q.get('eventsBefore')) })));
        res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
        return res.end(req.method === 'HEAD' ? undefined : body);
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed', message: 'POST로만 요청할 수 있습니다.' }, { Allow: 'POST' });
      if (!origins.has(req.headers.origin) || (site && site !== 'same-origin')) return send(res, 403, { error: 'forbidden_origin', message: '이 화면에서만 요청할 수 있습니다.' });
      if (!JSON_TYPE.test(req.headers['content-type'] || '') || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) return send(res, 415, { error: 'unsupported_media_type', message: 'JSON 요청만 받을 수 있습니다.' });
      if (Number(req.headers['content-length'] || 0) > BODY_LIMIT) return send(res, 413, { error: 'body_too_large', message: '요청이 너무 큽니다.' }, { Connection: 'close' });
      if (!flow.service) return unavailable(res);
      try {
        const raw = await readBody(req);
        let body; try { body = JSON.parse(raw.toString('utf8')); } catch { throw new CommandError(400, 'invalid_request', '요청 형식이 올바르지 않습니다.'); }
        const result = await flow.service.command(body);
        return send(res, 200, result);
      } catch (error) { return fail(res, error); }
    },
  };
}
