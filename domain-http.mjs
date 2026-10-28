// GET /api/workspaces/:familyId/records?q=&facet=&page=&pageSize= — read-only evidence pages
// from the server-side store of the data the server serves now (workspace-store.mjs — startup snapshot, then each refresh after a save).
// GET …/records?id=<recordId> — one record of that family by its exact id (alone, never with search or paging; no
// matching by name or date), so a link to a record outside the loaded page can open it.
// GET …/records?ids=<id1,id2,…> — 같은 영역의 기록 여러 건을 한 번에(최대 100개 · 쉼표, 원장 10-28 '기록 보기'가 기록마다 요청 하나씩 보내던 것).
// 단독으로만 · 요청 순서대로 · 없는 id는 빼고 · 같은 id는 한 번만. 응답 = { familyId, items }.
// GET /api/workspaces/records/search?q=&limit=&first= — 업무 요청·보고의 기록 첨부(원장 10-28 "업무요청시에 기록 첨부도 알아볼 수 있게"):
// 영역을 고르지 않고 낱말로 모든 영역의 기록을 찾는다. 영역별로 묶어 영역마다 맞은 수와 앞쪽 limit건(기본 5 · 최대 20)만 준다.
// first = 먼저 보일 영역(그 영역 화면에서 연 요청). 같은 낱말 규칙(모두 들어 있어야 맞음 · 영역 이름 낱말은 아래)·같은 기록 저장소 · 조회만.
// Same-origin page only (serve-live.mjs host/origin/sec-fetch guards apply before this).
import { FAMILY_IDS } from './domain-snapshot.mjs';
import { currentWorkspaceStore } from './workspace-store.mjs';

export const RECORDS_PATH = /^\/api\/workspaces\/([a-z][a-z-]{0,40})\/records$/;
export const SEARCH_PATH = /^\/api\/workspaces\/records\/search$/;
const KEYS = new Set(['q', 'facet', 'page', 'pageSize', 'id', 'ids']);
const SEARCH_KEYS = new Set(['q', 'limit', 'first']);
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,99}$/;
const LIMITS = Object.freeze({ q: 100, facet: 100, page: 100000, pageSize: 100, limit: 20, ids: 100 });
// 첨부에서 자주 찾는 영역을 앞에 — 나머지는 맞은 수가 많은 순.
const SEARCH_ORDER = ['students', 'enrollment', 'consultations', 'attendance', 'approvals', 'billing', 'withdrawal-reports', 'lesson-reports', 'video-homework', 'textbook-requests', 'classes', 'staff'];

// 날짜는 저장 모양(2026-10-27 · 2026-10)과 화면 모양(10/27 · 26.10) 둘 다로 찾는다 — 이름 칸에서 날짜를 뺀 뒤에도 '10/27'로 찾히게.
const shownDate = d => { const s = String(d || ''); return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : /^\d{4}-\d{2}$/.test(s) ? `${s.slice(2, 4)}.${s.slice(5, 7)}` : ''; };
const text = r => [r.label, r.detail, r.status, r.date, shownDate(r.date), ...r.fields.map(f => f.value)].join(' ').toLowerCase();
const textCache = new WeakMap();
// 통합 검색은 칸 이름도 낱말로 찾는다("김성현 수납" — 수납 칸이 있는 기록). 영역별 목록 검색(queryRecords)은 그대로 값만.
const searchText = r => [r.label, r.detail, r.status, r.date, shownDate(r.date), ...r.fields.flatMap(f => [f.label, f.value])].join(' ').toLowerCase();
// 영역 기록의 id 찾기표(기록 저장소는 불변이라 한 번 만들어 둔다).
const indexCache = new WeakMap();
// 같은 id가 둘이면 앞엣것(예전 find와 같은 결과).
const indexOf = records => { let m = indexCache.get(records); if (!m) { m = new Map(); for (const r of records) if (!m.has(String(r.id))) m.set(String(r.id), r); indexCache.set(records, m); } return m; };
const cachedText = r => { let s = textCache.get(r); if (s === undefined) { s = searchText(r); textCache.set(r, s); } return s; };

export function searchRecords(store, params) {
  for (const key of params.keys()) if (!SEARCH_KEYS.has(key) || params.getAll(key).length > 1) return { status: 400, body: { error: 'invalid_request', message: '허용하지 않는 조회 조건입니다.' } };
  const q = (params.get('q') || '').trim(), asked = params.get('first') || '', raw = params.get('limit');
  const first = FAMILY_IDS.includes(asked) ? asked : ''; // 저장소에 없는 영역에서 연 요청이면 순서만 기본으로
  const limit = raw === null || raw === '' ? 5 : /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
  if (!q || q.length > LIMITS.q || !(limit >= 1 && limit <= LIMITS.limit) || (asked && !/^[a-z][a-z-]{0,40}$/.test(asked))) return { status: 400, body: { error: 'invalid_request', message: '조회 조건이 범위를 벗어났습니다.' } };
  if (!store) return { status: 503, body: { error: 'records_unavailable', message: '근거 목록을 아직 준비하지 못했습니다.' } };
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean), groups = [];
  for (const familyId of FAMILY_IDS) {
    // 영역 이름 낱말("김소은 퇴원보고서" · "김근우 청구")은 기록이 다른 낱말을 하나 이상 맞혔을 때만 채워 준다 — 이름 칸에서 '청구'·'수업보고서' 같은
    // 종류 말을 뺀 뒤에도 찾히게. 영역 이름만으로는 맞지 않는다(낱말 하나로 영역 전체가 쏟아지지 않게).
    const fam = store.families.get(familyId), all = fam?.records || [], title = String(fam?.title || '').toLowerCase();let total = 0;const items = [];
    for (const r of all) { const s = cachedText(r); if (!terms.some(t => s.includes(t)) || !terms.every(t => s.includes(t) || title.includes(t))) continue; total += 1; if (items.length < limit) items.push(r); }
    if (total) groups.push({ familyId, total, items });
  }
  const rank = id => id === first ? -1 : SEARCH_ORDER.includes(id) ? SEARCH_ORDER.indexOf(id) : SEARCH_ORDER.length;
  groups.sort((a, b) => rank(a.familyId) - rank(b.familyId) || b.total - a.total);
  return { status: 200, body: { q, groups } };
}

export function queryRecords(store, familyId, params) {
  if (!FAMILY_IDS.includes(familyId)) return { status: 404, body: { error: 'unknown_family', message: '알 수 없는 업무 영역입니다.' } };
  for (const key of params.keys()) if (!KEYS.has(key) || params.getAll(key).length > 1) return { status: 400, body: { error: 'invalid_request', message: '허용하지 않는 조회 조건입니다.' } };
  if (params.has('id')) {
    const id = params.get('id');
    if ([...params.keys()].length !== 1 || !RECORD_ID.test(id)) return { status: 400, body: { error: 'invalid_request', message: '기록을 찾는 조건이 올바르지 않습니다.' } };
    if (!store) return { status: 503, body: { error: 'records_unavailable', message: '근거 목록을 아직 준비하지 못했습니다.' } };
    const item = indexOf(store.families.get(familyId).records).get(id);
    return item ? { status: 200, body: { familyId, item } } : { status: 404, body: { error: 'record_not_found', message: '이 업무 영역에서 그 기록을 찾지 못했습니다.' } };
  }
  if (params.has('ids')) {
    const ids = params.get('ids').split(',');
    if ([...params.keys()].length !== 1 || ids.length > LIMITS.ids || !ids.every(id => RECORD_ID.test(id))) return { status: 400, body: { error: 'invalid_request', message: '기록을 찾는 조건이 올바르지 않습니다.' } };
    if (!store) return { status: 503, body: { error: 'records_unavailable', message: '근거 목록을 아직 준비하지 못했습니다.' } };
    const index = indexOf(store.families.get(familyId).records), items = [];
    for (const id of new Set(ids)) { const r = index.get(id); if (r) items.push(r); }
    return { status: 200, body: { familyId, items } };
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
  const search = SEARCH_PATH.test(url.pathname), match = search ? null : url.pathname.match(RECORDS_PATH);
  if (!search && !match) return false;
  const send = (status, body) => {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) });
    res.end(req.method === 'HEAD' ? undefined : data);
  };
  if (!['GET', 'HEAD'].includes(req.method)) { send(405, { error: 'method_not_allowed', message: '조회만 할 수 있습니다.' }); return true; }
  const store = currentWorkspaceStore();
  const { status, body } = search ? searchRecords(store, url.searchParams) : queryRecords(store, match[1], url.searchParams);
  send(status, body);
  return true;
}
