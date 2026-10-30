import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-trend.mjs';
import { CARD_INSIGHT_PATH, validCardMetric } from './card-insight.mjs';

export function createCardInsightRoute({ store, headers = {}, open = openFullDatabase, getAnalysis = null, providerForOrigin = null }) {
  const send = (req, res, status, body) => { const data = Buffer.from(JSON.stringify(body)); res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length }); res.end(req.method === 'HEAD' ? undefined : data); };
  const load = getAnalysis || (async params => { const db = await open(); try { return await db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params: { ...params, analysis: '1' }, tenantId, importV2 })); } finally { await db.end(); } });
  return { handles: path => path === CARD_INSIGHT_PATH,
    async handle(req, res) {
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return send(req, res, 403, { error: 'forbidden_origin', message: '이 화면에서만 요청할 수 있습니다.' });
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) return send(req, res, 405, { error: 'method_not_allowed', message: '지원하지 않는 요청입니다.' });
      if (req.method === 'POST' && (req.headers['sec-fetch-site'] !== 'same-origin' || !/^application\/json\b/i.test(req.headers['content-type'] || ''))) return send(req, res, 403, { error: 'forbidden_origin', message: '이 화면의 버튼으로만 문장을 만들 수 있습니다.' });
      const q = new URL(req.url, 'http://127.0.0.1').searchParams;
      const metric = q.get('metric'), fingerprint = q.get('fp'), key = q.get('key');
      const selectionNames = ['grain', 'by', 'f', 'from', 'to', 'up'];
      const validSelection = [...q].every(([name, value]) => !selectionNames.includes(name) ||
        (name === 'grain' || name === 'up' ? /^(day|week|month|year)$/.test(value) : name === 'by' ? /^[a-z]{1,20}$/.test(value)
          : name === 'f' ? /^[a-z]{1,20}:[A-Za-z0-9:._|-]{1,100}$/.test(value) : /^\d{4}-\d{2}-\d{2}$/.test(value)));
      const names = [...q.keys()], allowed = req.method === 'POST' ? ['metric', ...selectionNames] : ['metric', 'fp', 'key'];
      if (!validCardMetric(metric) || !validSelection || names.length !== new Set(names).size || names.some(n => !allowed.includes(n)) ||
        (req.method !== 'POST' && (!/^[0-9a-f]{64}$/.test(fingerprint || '') || !/^[a-z0-9|:._-]{1,240}$/i.test(key || '') || !key.startsWith(`${metric}|`))))
        return send(req, res, 400, { error: 'invalid_request', message: '카드 지표를 확인해 주세요.' });
      const service = await store;
      if (!service) return send(req, res, 503, { error: 'insight_unavailable', message: '분석 문장을 준비하지 못했습니다.' });
      const selectedProvider = providerForOrigin?.(req.headers.origin || `http://${req.headers.host}`);
      if (req.method !== 'POST') {
        const view = service.viewFingerprint(metric, key, fingerprint);
        return send(req, res, 200, providerForOrigin ? { ...view, enabled: !!selectedProvider } : view);
      }
      const analysis = await load(Object.fromEntries([...q].filter(([name]) => name !== 'key' && name !== 'fp')));
      if (!analysis) return send(req, res, 404, { error: 'card_not_found', message: '분석할 카드가 없습니다.' });
      // 본문은 보내지 않는다. 서버가 현재 카드 facts를 새로 읽어 AI 입력을 만든다.
      req.resume();
      const result = await service.make(analysis, selectedProvider);
      return send(req, res, result.httpStatus || result.status, result);
    } };
}
