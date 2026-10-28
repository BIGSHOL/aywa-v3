// GET /api/workspaces/:familyId/records?q=&facet=&page=&pageSize= — read-only evidence pages
// from the server-side store built with the verified startup snapshot (domain-snapshot.mjs).
// GET …/records?id=<recordId> — one record of that family by its exact id (alone, never with search or paging; no
// matching by name or date), so a link to a record outside the loaded page can open it.
// Same-origin page only (serve-live.mjs host/origin/sec-fetch guards apply before this).
import { FAMILY_IDS, workspaceRecords } from './domain-snapshot.mjs';

export const RECORDS_PATH = /^\/api\/workspaces\/([a-z][a-z-]{0,40})\/records$/;
const KEYS = new Set(['q', 'facet', 'page', 'pageSize', 'id']);
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,99}$/;
const LIMITS = Object.freeze({ q: 100, facet: 100, page: 100000, pageSize: 100 });

const text = r => [r.label, r.detail, r.status, r.date, ...r.fields.map(f => f.value)].join(' ').toLowerCase();

export function queryRecords(store, familyId, params) {
  if (!FAMILY_IDS.includes(familyId)) return { status: 404, body: { error: 'unknown_family', message: '알 수 없는 업무 영역입니다.' } };
  for (const key of params.keys()) if (!KEYS.has(key) || params.getAll(key).length > 1) return { status: 400, body: { error: 'invalid_request', message: '허용하지 않는 조회 조건입니다.' } };
  if (params.has('id')) {
    const id = params.get('id');
    if ([...params.keys()].length !== 1 || !RECORD_ID.test(id)) return { status: 400, body: { error: 'invalid_request', message: '기록을 찾는 조건이 올바르지 않습니다.' } };
    if (!store) return { status: 503, body: { error: 'records_unavailable', message: '근거 목록을 아직 준비하지 못했습니다.' } };
    const item = store.families.get(familyId).records.find(r => String(r.id) === id);
    return item ? { status: 200, body: { familyId, item } } : { status: 404, body: { error: 'record_not_found', message: '이 업무 영역에서 그 기록을 찾지 못했습니다.' } };
  }
  const q = (params.get('q') || '').trim(), facet = params.get('facet') || '';
  const int = (v, d) => v === null || v === '' ? d : /^\d{1,6}$/.test(v) ? Number(v) : NaN;
  const page = int(params.get('page'), 1), pageSize = int(params.get('pageSize'), 20);
  if (q.length > LIMITS.q || facet.length > LIMITS.facet || !(page >= 1 && page <= LIMITS.page) || !(pageSize >= 1 && pageSize <= LIMITS.pageSize)) return { status: 400, body: { error: 'invalid_request', message: '조회 조건이 범위를 벗어났습니다.' } };
  if (!store) return { status: 503, body: { error: 'records_unavailable', message: '근거 목록을 아직 준비하지 못했습니다.' } };
  const family = store.families.get(familyId), all = family.records;
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matched = terms.length ? all.filter(r => { const s = text(r); return terms.every(term => s.includes(term)); }) : all;
  if (facet && !family.facets.some(f => f.id === facet)) return { status: 400, body: { error: 'invalid_request', message: '이 영역에 없는 분류입니다.' } };
  const counts = new Map();
  for (const r of matched) for (const f of new Set(r.facetIds)) counts.set(f, (counts.get(f) || 0) + 1);
  const filtered = facet ? matched.filter(r => r.facetIds.includes(facet)) : matched;
  return {
    status: 200,
    body: {
      familyId, total: all.length, filteredTotal: filtered.length, page, pageSize, pageCount: Math.max(1, Math.ceil(filtered.length / pageSize)),
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      facets: family.facets.filter(f => counts.get(f.id)).map(f => ({ id: f.id, label: f.label, count: counts.get(f.id) })),
    },
  };
}

export function handleWorkspaceRecords(req, res, headers) {
  let url; try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return false; }
  const match = url.pathname.match(RECORDS_PATH);
  if (!match) return false;
  const send = (status, body) => {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) });
    res.end(req.method === 'HEAD' ? undefined : data);
  };
  if (!['GET', 'HEAD'].includes(req.method)) { send(405, { error: 'method_not_allowed', message: '조회만 할 수 있습니다.' }); return true; }
  const { status, body } = queryRecords(workspaceRecords(), match[1], url.searchParams);
  send(status, body);
  return true;
}
