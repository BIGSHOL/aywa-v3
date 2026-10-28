// Contract helpers for model.workspaces (DOMAIN-DATA.md). Pure functions only:
// the domain loaders run read-only SQL and hand plain values here.
export const DATA_STATES = Object.freeze(['available', 'empty', 'not-applicable', 'unavailable']);
export const PRIORITY = Object.freeze({ check: '확인 필요', decide: '결정 필요', progress: '진행 확인' });
export const RECORD_LIMIT = 12;
// The full evidence list rides on a symbol key: JSON.stringify (snapshot.js) never
// sees it; loadWorkspaces moves it into the server-side record store.
export const EVIDENCE = Symbol('evidence');

const finite = v => v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
// Free-text business fields (일정 제목, 상담 과목 칸, 학부모 글 …) sometimes carry typed contacts.
// Value-only masking: e-mail addresses, narrowly shaped Korean phone numbers, and any digit run whose
// digits equal a known contact/account value of this branch (setKnownContacts). Amounts, dates, ids and
// ordinary reference numbers are left alone (verify-domain-core.mjs locks this).
export const MASK = '연락처 가림';
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Landlines only with separators (053-123-4567); mobiles (01X) with or without them.
const PHONE = /(?<!\d)(?:\+82[-. ]?)?0\d{1,2}[-. )]\d{3,4}[-. ]\d{4}(?!\d)|(?<!\d)(?:\+82[-. ]?|0)1[016789][-. ]?\d{3,4}[-. ]?\d{4}(?!\d)/g;
const RUN = /\d[\d\-. ]*\d/g;
let knownDigits = new Set();
export function setKnownContacts(values) {
  knownDigits = new Set(values.filter(v => typeof v === 'string').map(v => v.replace(/\D/g, '')).filter(d => d.length >= 8));
  return knownDigits.size;
}
// A digit run is split at its separators; any consecutive groups whose digits equal a known value are
// masked, so "10-27-010-1234-5678" keeps the date part and hides only the contact.
function maskKnown(run) {
  if (run.replace(/\D/g, '').length < 8) return run;
  const groups = run.split(/[-. ]+/), seps = run.match(/[-. ]+/g) || [];
  let out = '', i = 0;
  while (i < groups.length) {
    // A contact may be glued to a preceding number ("중3" + "010-…"), so the first group may start mid-way.
    let hit = 0, cut = 0;
    for (let k = 0; k < groups[i].length && !hit; k += 1) for (let j = Math.min(groups.length, i + 5); j > i && !hit; j -= 1) {
      const d = groups[i].slice(k) + groups.slice(i + 1, j).join('');
      if (d.length >= 8 && knownDigits.has(d)) { hit = j; cut = k; }
    }
    out += hit ? groups[i].slice(0, cut) + MASK : groups[i]; i = hit || i + 1;
    if (i < groups.length) out += seps[i - 1];
  }
  return out;
}
export function scrub(text) {
  if (text === null || text === undefined) return text;
  const s = String(text).replace(EMAIL, MASK).replace(PHONE, MASK);
  return knownDigits.size ? s.replace(RUN, maskKnown) : s;
}
export const metric = (label, value, unit, detail = '') => ({ label, value: finite(value), unit, detail });
export const field = (label, value) => ({ label, value: value === null || value === undefined || value === '' ? '—' : scrub(value) });
export const record = ({ id, label, detail = '', date = '', status = '', fields = [], facets = [] }) => ({ id: String(id), label: scrub(label) || '—', detail: scrub(detail) || '', date: date || '', status: scrub(status) || '', fields: fields.map(f => ({ label: f.label, value: scrub(f.value) })), facetIds: facets.filter(Boolean).map(String) });
// facet = 이 신호를 처리하는 목록의 걸러 보기(일 카드의 '○○ 열기'가 그 걸러 보기로 연다 — 원장 10-28 "어디로 가야하는지 배선 같은게 없음").
// 걸러 보기의 기록 = 신호의 recordIds와 같은 집합(verify-domain-snapshot.mjs가 잠근다).
// at = 신호가 묶은 기록 중 가장 늦게 생긴 것의 날짜('YYYY-MM-DD') 또는 시각(UTC ISO) — 업무 흐름 '발생 시간'(점검 시각이 아니다).
export const signal = ({ id, title, summary, priority, source, recordIds = [], draft, facet = '', at = '' }) => ({ id, title, summary, priority, source, recordIds: recordIds.map(String), draft, ...(facet ? { facet } : {}), ...(at ? { at } : {}) });
// 값 목록 중 가장 늦은 것(빈 값 제외). 한 신호 안에서는 같은 모양(날짜끼리 · ISO끼리)만 넘긴다.
export const latest = values => values.filter(Boolean).map(String).sort().at(-1) || '';
// SQL에서 시각을 신호 at 모양(UTC ISO)으로 — flow-source.mjs와 같은 형식.
export const ISO_AT = 'YYYY-MM-DD"T"HH24:MI:SS"Z"';
export const sumOf = rows => rows.reduce((n, r) => n + (Number(r.count) || 0), 0);
export const countOf = (rows, key) => rows.find(r => r.key === key)?.count || 0;

export function monthsBack(asOf, n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(`${asOf.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - (n - 1) + i); return d.toISOString().slice(0, 7);
  });
}
// 연월 yy.mm · 날짜 M/D — 목록 줄 이름이 서로 구분되게 붙이는 짧은 표기(원장 10-28 "항상 yy.mm" · "전부 이름이 일치하는데 뭘 말하고 싶은건지 알 수가 없음").
export const yymm = m => (/^\d{4}-\d{2}/.test(String(m ?? '')) ? `${String(m).slice(2, 4)}.${String(m).slice(5, 7)}` : String(m ?? ''));
export const md = d => (/^\d{4}-\d{2}-\d{2}/.test(String(d ?? '')) ? `${Number(String(d).slice(5, 7))}/${Number(String(d).slice(8, 10))}` : String(d ?? ''));
export const addDays = (date, days) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

// KPI = 최근 변화 (원장 2026-10-28 *"전체 몇건인가 같은건 아무 도움이 안됨. 원하는건 추세. kpi로 표현하고 싶은건 최근 kpi 변화"*):
// 지금 값 + 직전 기간 대비 + 추세선. 누적·전체 기간 건수는 KPI로 쓰지 않는다. 같은 지표가 2.0에 있으면 2.0 판정 그대로.
// points = 오래된 → 최근 [{ label, value }]; 마지막 = 지금, 그 앞 = 비교 기간. better = 'up' | 'down' | null(오르면 좋은가).
// span = 값이 덮는 기간(카드 제목 오른쪽, 원장 10-28 "제목 우측에 기한 적어놓을것") · basis = 무엇을 무엇으로 나눴는지(카드 아래).
// id = 확장 추세(#v2-trend?metric=<id>)에 등록된 지표면 그 id — 카드를 누르면 그 지표의 확장 추세로 간다.
export function kpi(label, unit, points, { id = '', better = null, period = 'week', span = '', basis = '' } = {}) {
  const series = points.map(p => ({ label: p.label, value: finite(p.value) }));
  const value = series.at(-1)?.value ?? null, previous = series.at(-2)?.value ?? null;
  return { kind: 'kpi', ...(id ? { id } : {}), label, unit, period, span, basis, better, points: series, value, previous, delta: value === null || previous === null ? null : value - previous };
}
// Rolling 7-day windows ending at asOf, oldest first: full weeks compare with full weeks (the current calendar week is partial).
export function weekWindows(asOf, n = 8) {
  const md = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return Array.from({ length: n }, (_, i) => { const to = addDays(asOf, -7 * (n - 1 - i)), from = addDays(to, -6); return { from, to, label: `${md(from)}~${md(to)}` }; });
}
export const rate = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

// Real months only: starts at the first month (within the window) that has rows;
// months after that with no rows are genuine zeros; nothing past asOf.
export function monthlyTrend(label, unit, rows, asOf, maxMonths = 12) {
  const values = new Map(rows.map(r => [r.month, Number(r.value) || 0]));
  const window = monthsBack(asOf, maxMonths);
  const first = window.findIndex(m => values.get(m) > 0);
  if (first < 0) return null;
  return { label, unit, granularity: 'month', points: window.slice(first).map(m => ({ date: m, value: values.get(m) || 0 })) };
}
export function dailyTrend(label, unit, rows, asOf) {
  const points = rows.filter(r => r.date <= asOf).map(r => ({ date: r.date, value: Number(r.value) || 0 })).sort((a, b) => a.date.localeCompare(b.date));
  return points.length ? { label, unit, granularity: 'day', points } : null;
}

// evidence = every applicable record (server store); records = the first 12 or a
// curated summary; facets are counted from evidence so chips match the endpoint.
// detailLabel · dateLabel = 이 영역 기록의 '내용'(detail)·'날짜'(date)가 무엇인지(반 · 수업일 …) — 표 머리가 화면마다 따로 짐작하지 않게.
export function family(id, title, part) {
  const evidence = part.evidence || [];
  const counts = new Map();
  for (const r of evidence) for (const f of new Set(r.facetIds)) counts.set(f, (counts.get(f) || 0) + 1);
  const order = part.facetOrder || [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
  const out = {
    id, title, summary: part.summary || '', metrics: part.metrics || [], trend: part.trend || null, signals: part.signals || [],
    facets: order.filter(k => counts.get(k)).map(k => ({ id: k, label: scrub(part.facetLabels?.[k] || k), count: counts.get(k) })),
    records: (part.summaryRecords || evidence).slice(0, RECORD_LIMIT), totalRecords: evidence.length, sourceLabel: part.sourceLabel || '',
    dataState: part.dataState || (evidence.length ? 'available' : 'empty'), coverageNote: part.coverageNote || '', sources: part.sources || [], recordSource: evidence.length ? part.recordSource || null : null,
    ...(part.detailLabel ? { detailLabel: part.detailLabel } : {}), ...(part.dateLabel ? { dateLabel: part.dateLabel } : {}),
  };
  Object.defineProperty(out, EVIDENCE, { value: Object.freeze(evidence), enumerable: false });
  return out;
}
export const notApplicable = (id, title, coverageNote, summary = '지점 원장 업무 공간 밖의 영역입니다.') => family(id, title, { summary, dataState: 'not-applicable', sourceLabel: '해당 없음', coverageNote });

const DATE = /^\d{4}-\d{2}(-\d{2})?$/;
const SIGNAL_AT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/;
const latestDay = asOf => { const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); return asOf > today ? asOf : today; };
// Throws on the first contract violation so a bad loader cannot ship silently.
export function assertWorkspaces(ws, ids) {
  const fail = (id, why) => { throw new Error(`workspaces.${id}: ${why}`); };
  if (!ws || !DATE.test(ws.asOf || '')) fail('asOf', 'missing');
  for (const id of ids) if (!ws.families[id]) fail(id, 'family missing');
  for (const id of Object.keys(ws.families)) if (!ids.includes(id)) fail(id, 'unmapped family id');
  for (const [id, f] of Object.entries(ws.families)) {
    if (f.id !== id || !f.title || !DATA_STATES.includes(f.dataState) || !f.summary || !f.coverageNote) fail(id, 'id/title/summary/dataState/coverageNote');
    for (const m of f.metrics) if (typeof m.label !== 'string' || !(m.value === null || Number.isFinite(m.value)) || typeof m.unit !== 'string') fail(id, `metric ${m.label}`);
    if (f.trend) {
      if (!['month', 'day'].includes(f.trend.granularity) || !f.trend.points.length) fail(id, 'trend shape');
      for (const p of f.trend.points) if (!DATE.test(p.date) || p.date > ws.asOf.slice(0, p.date.length) || !Number.isFinite(p.value)) fail(id, `trend point ${p.date}`);
    }
    for (const s of f.signals) if (!s.id || !s.title || !Object.values(PRIORITY).includes(s.priority) || !s.draft?.title || !s.draft?.body) fail(id, `signal ${s.id}`);
    for (const s of f.signals) if (s.facet && !f.facets.some(x => x.id === s.facet)) fail(id, `signal ${s.id} facet ${s.facet} missing`);
    // 신호 시각은 기준일까지 — 단 복사본 연습 저장(2.0 화면)은 오늘 시각을 남기므로 기준일과 오늘(KST) 중 늦은 날까지 받는다
    // (10-28 시험장: 퇴원 관리자 승인 뒤 신호 시각이 오늘이라 저장 뒤 자료 갱신이 네 번 연달아 거절됐다).
    for (const s of f.signals) if (s.at !== undefined && (!SIGNAL_AT.test(s.at) || s.at.slice(0, 10) > latestDay(ws.asOf))) fail(id, `signal ${s.id} at ${s.at}`);
    const ids = new Set(f.records.map(r => r.id));
    for (const s of f.signals) for (const r of s.recordIds) if (!ids.has(r) && !(f[EVIDENCE] || []).some(e => e.id === r)) fail(id, `signal ${s.id} points outside evidence`);
    for (const x of f.facets) if (!x.id || !x.label || !Number.isInteger(x.count) || x.count < 1) fail(id, 'facet');
    if (f.records.length > RECORD_LIMIT || f.records.length > f.totalRecords) fail(id, 'records exceed window/total');
    for (const r of f.records) if (!r.id || !Array.isArray(r.fields) || !Array.isArray(r.facetIds) || (r.date && !DATE.test(r.date))) fail(id, `record ${r.id}`);
    if (f.totalRecords && !f.recordSource) fail(id, 'recordSource required with records');
    if (f.dataState !== 'available' && (f.totalRecords || f.signals.length)) fail(id, 'records/signals on a non-available family');
    if (f.dataState === 'available' && !f.totalRecords) fail(id, 'available without evidence');
  }
  return true;
}
