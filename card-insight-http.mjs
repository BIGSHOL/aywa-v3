import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-trend.mjs';
import { CARD_INSIGHT_PATH, validCardMetric } from './card-insight.mjs';

export function createCardInsightRoute({ store, headers = {}, open = openFullDatabase, getAnalysis = null }) {
  const send = (req, res, status, body) => { const data = Buffer.from(JSON.stringify(body)); res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length }); res.end(req.method === 'HEAD' ? undefined : data); };
  const load = getAnalysis || (async metric => { const db = await open(); try { return await db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params: { metric, analysis: '1' }, tenantId, importV2 })); } finally { await db.end(); } });
  return { handles: path => path === CARD_INSIGHT_PATH,
    async handle(req, res) {
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return send(req, res, 403, { error: 'forbidden_origin', message: '이 화면에서만 요청할 수 있습니다.' });
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) return send(req, res, 405, { error: 'method_not_allowed', message: '지원하지 않는 요청입니다.' });
      if (req.method === 'POST' && (req.headers['sec-fetch-site'] !== 'same-origin' || !/^application\/json\b/i.test(req.headers['content-type'] || ''))) return send(req, res, 403, { error: 'forbidden_origin', message: '이 화면의 버튼으로만 문장을 만들 수 있습니다.' });
      const q = new URL(req.url, 'http://127.0.0.1').searchParams;
      const metric = q.get('metric'), fingerprint = q.get('fp');
      if (!validCardMetric(metric) || (req.method === 'POST' ? [...q.keys()].join(',') !== 'metric' :
        [...q.keys()].sort().join(',') !== 'fp,metric' || !/^[0-9a-f]{64}$/.test(fingerprint || '')))
        return send(req, res, 400, { error: 'invalid_request', message: '카드 지표를 확인해 주세요.' });
      const service = await store;
      if (!service) return send(req, res, 503, { error: 'insight_unavailable', message: '분석 문장을 준비하지 못했습니다.' });
      if (req.method !== 'POST') return send(req, res, 200, service.viewFingerprint(metric, fingerprint));
      const analysis = await load(metric);
      if (!analysis) return send(req, res, 404, { error: 'card_not_found', message: '분석할 카드가 없습니다.' });
      // 본문은 보내지 않는다. 서버가 현재 카드 facts를 새로 읽어 AI 입력을 만든다.
      req.resume();
      const result = await service.make(analysis);
      return send(req, res, result.httpStatus || result.status, result);
    } };
}
