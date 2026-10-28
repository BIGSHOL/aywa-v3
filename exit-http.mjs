// GET /api/insight/exits (index) and GET /api/insight/exits?from=YYYY-MM&to=YYYY-MM (one comparison) for the local dev
// server (INSIGHT-EXITS.md). Read-only: no POST, no AI call on a request. The service loads in the background at start.
import { loadExitSource } from './exit-source.mjs';
import { loadV2 } from './v2-bridge.mjs';
import { tenantId } from './full-db.mjs';
import { createExitInsight, openInsightStore } from './exit-runtime.mjs';
import { createHierarchyProviders } from './flow-hierarchy-providers.mjs';

export const INSIGHT_PATH = '/api/insight/exits';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** AI on when OWNER_CONCEPT_EXIT_AI (default: OWNER_CONCEPT_HIERARCHY_AI) is 'on'; never in production. */
export function exitProviders(env = process.env) {
  if ((env.OWNER_CONCEPT_EXIT_AI ?? env.OWNER_CONCEPT_HIERARCHY_AI) !== 'on' || env.NODE_ENV === 'production' || env.VERCEL) return { providers: null, reason: '자동 분석이 꺼져 있음' };
  try { return { providers: createHierarchyProviders({ env }), reason: null }; } catch (error) { console.error(`Exit insight AI unavailable: ${error.code || 'error'}`); return { providers: null, reason: '자동 분석 전송 설정 오류' }; }
}

export function startExitInsight({ snapshot, dir, env = process.env, load = loadExitSource }) {
  let service = null, failure = null;
  const ready = (async () => {
    const [source, v2] = await Promise.all([load(), loadV2()]);
    source.identity = { tenantId, tenantSlug: 'cs', capturedAt: snapshot.meta.importedAt };
    const overlay = await openInsightStore({ dir, identity: source.identity });
    const { providers, reason } = exitProviders(env);
    service = createExitInsight({ source, v2, asOf: snapshot.meta.asOf, months: snapshot.months, overlay, providers, disabledReason: reason, log: m => console.log(m) });
    service.index(); // computes the scheduled pairs once so the first screen request does not wait
    service.start();
    return service;
  })().catch(error => { failure = error; console.error(`Exit insight unavailable: ${error.code || error.message}`); });
  return { ready, get service() { return service; }, get failure() { return failure; } };
}

export function createExitRoute({ insight, headers = {}, enabled = true }) {
  const send = (req, res, status, body, extra = {}) => {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, ...extra });
    res.end(req.method === 'HEAD' ? undefined : data);
  };
  return {
    handles: path => path === INSIGHT_PATH,
    handle(req, res) {
      if (!enabled) return send(req, res, 404, { error: 'not_found', message: '사용할 수 없는 주소입니다.' });
      const site = req.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return send(req, res, 403, { error: 'forbidden_origin', message: '이 화면에서만 요청할 수 있습니다.' });
      if (!['GET', 'HEAD'].includes(req.method)) return send(req, res, 405, { error: 'method_not_allowed', message: '조회만 할 수 있습니다.' }, { Allow: 'GET, HEAD' });
      const q = new URL(req.url, 'http://127.0.0.1').searchParams, keys = [...q.keys()];
      if (keys.some(k => !['from', 'to'].includes(k)) || keys.length !== new Set(keys).size || (keys.length && keys.length !== 2)) return send(req, res, 400, { error: 'invalid_request', message: '비교할 두 달(from·to)을 함께 보내거나 아무것도 보내지 않습니다.' });
      const s = insight.service;
      if (!s) return send(req, res, 503, insight.failure ? { error: 'insight_unavailable', message: '이탈 분석을 준비하지 못했습니다. 서버 기록을 확인해 주세요.' } : { error: 'insight_starting', message: '이탈 분석을 준비하는 중입니다.' }, { 'Retry-After': '3' });
      if (!keys.length) return send(req, res, 200, s.index());
      const from = q.get('from'), to = q.get('to');
      if (!MONTH.test(from) || !MONTH.test(to) || from >= to) return send(req, res, 400, { error: 'invalid_request', message: '앞 달이 뒤 달보다 이른 YYYY-MM 두 달이어야 합니다.' });
      if (!s.has(from) || !s.has(to)) return send(req, res, 404, { error: 'period_not_found', message: '이 달의 청구 기록이 복사본에 없습니다.' });
      try { return send(req, res, 200, s.view(from, to)); } catch { return send(req, res, 500, { error: 'insight_failed', message: '이 비교를 계산하지 못했습니다.' }); }
    },
  };
}
