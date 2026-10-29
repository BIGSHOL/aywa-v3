// GET /api/flow and POST /api/flow/actions for the local dev server. Same guards as the
// assistant: exact same-origin, JSON only, bounded body. The store directory is never served.
import { CommandError } from './flow-commands.mjs';
import { StoreError } from './flow-store.mjs';
import { HierarchyError } from './flow-hierarchy.mjs';

export const FLOW_PATH = '/api/flow', ACTIONS_PATH = '/api/flow/actions', HIERARCHY_PATH = '/api/flow/hierarchy', RECORDS_PATH = '/api/flow/records';
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
    if (error instanceof HierarchyError) return send(res, error.status, { error: error.code, message: error.message });
    return send(res, 500, { error: 'flow_failed', message: '업무 흐름을 처리하지 못했습니다.' });
  };
  const unavailable = res => { const f = flow.failure; send(res, 503, f ? { error: f.code, message: f.message } : { error: 'flow_starting', message: '업무 흐름을 준비하는 중입니다.' }, { 'Retry-After': '2' }); };
  return {
    handles: path => path === FLOW_PATH || path === ACTIONS_PATH || path === HIERARCHY_PATH || path === RECORDS_PATH,
    async handle(req, res, path) {
      if (!enabled) return send(res, 404, { error: 'not_found', message: '사용할 수 없는 주소입니다.' });
      const site = req.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return send(res, 403, { error: 'forbidden_origin', message: '이 화면에서만 요청할 수 있습니다.' });
      if (path === RECORDS_PATH) {
        if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'method_not_allowed', message: '조회만 할 수 있습니다.' }, { Allow: 'GET, HEAD' });
        const q = new URL(req.url, 'http://127.0.0.1').searchParams;
        if ([...q.keys()].some(k => !['caseId', 'page'].includes(k)) || q.getAll('caseId').length !== 1 || !/^[A-Za-z0-9_-]{1,120}$/.test(q.get('caseId')) || q.getAll('page').length !== 1 || !/^[1-9]\d{0,5}$/.test(q.get('page'))) return send(res, 400, { error: 'invalid_request', message: '업무 번호와 쪽 번호를 확인해 주세요.' });
        if (!flow.service) return unavailable(res);
        const data = flow.service.recordPage(q.get('caseId'), Number(q.get('page')));
        if (!data) return send(res, 404, { error: 'not_found', message: '기록 쪽을 찾지 못했습니다.' });
        const body = Buffer.from(JSON.stringify(data));
        res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
        return res.end(req.method === 'HEAD' ? undefined : body);
      }
      // Issue hierarchy: stored tree + AI results only. GET never starts a provider call (FLOW-HIERARCHY.md).
      if (path === HIERARCHY_PATH) {
        if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'method_not_allowed', message: '조회만 할 수 있습니다.' }, { Allow: 'GET, HEAD' });
        const q = new URL(req.url, 'http://127.0.0.1').searchParams;
        if ([...q.keys()].some(k => k !== 'caseId') || q.getAll('caseId').length !== 1 || !/^[A-Za-z0-9_-]{1,120}$/.test(q.get('caseId'))) return send(res, 400, { error: 'invalid_request', message: '업무 번호를 하나만 보낼 수 있습니다.' });
        if (!flow.service) return unavailable(res);
        try {
          const tag = flow.service.hierarchyTag(q.get('caseId'));
          if (req.headers['if-none-match'] === tag) { res.writeHead(304, { ...headers, ETag: tag }); return res.end(); }
          const body = Buffer.from(JSON.stringify(flow.service.hierarchy(q.get('caseId'))));
          res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, ETag: tag });
          return res.end(req.method === 'HEAD' ? undefined : body);
        } catch (error) { return fail(res, error); }
      }
      if (path === FLOW_PATH) {
        if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'method_not_allowed', message: '조회만 할 수 있습니다.' }, { Allow: 'GET, HEAD' });
        if (!flow.service) return unavailable(res);
        const q = new URL(req.url, 'http://127.0.0.1').searchParams, int = v => /^[1-9]\d{0,6}$/.test(v || '') ? Number(v) : null;
        for (const k of q.keys()) if (!['casePage', 'eventsBefore', 'summary'].includes(k)) return send(res, 400, { error: 'invalid_request', message: '허용하지 않는 조회 조건입니다.' });
        if ((q.has('casePage') && !int(q.get('casePage'))) || (q.has('eventsBefore') && !int(q.get('eventsBefore')))
          || (q.has('summary') && (q.getAll('summary').length !== 1 || q.get('summary') !== '1' || q.has('casePage') || q.has('eventsBefore')))) return send(res, 400, { error: 'invalid_request', message: '조회 조건이 올바르지 않습니다.' });
        const body = Buffer.from(JSON.stringify(q.has('summary') ? flow.service.summary() : flow.service.view({ casePage: int(q.get('casePage')) || 1, eventsBefore: int(q.get('eventsBefore')) })));
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
