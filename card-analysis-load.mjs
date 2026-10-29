// 카드 분석 전용 GET의 계산. 카드·추세·업무 흐름의 기존 읽기 함수를 다시 쓴다.
import { dashboardKpiCards, DASHBOARD_KPI_ORDER } from './v2-dashboard-flow.mjs';
import { teacherWorkWeekly, TEACHER_WORK_METRICS } from './v2-teacher-work.mjs';
import { buildCardAnalysis } from './card-analysis.mjs';

const ROSTER_METRICS = new Set(['exits', 'intake', 'level-tests', 'new-enrollments', 'recent-absent', 'makeups', 'report-written']);
const PORT = Number(process.env.OWNER_CONCEPT_PORT || 4310);
const CARDS = new WeakMap();
async function cardOf(sql, group, params) {
  let found = CARDS.get(sql);
  if (!found) { found = new Map(); CARDS.set(sql, found); }
  if (!found.has(group)) found.set(group, (group === 'dashboard' ? dashboardKpiCards(params) : teacherWorkWeekly(params).then(x => x.kpis))
    .catch(error => { found.delete(group); throw error; }));
  return found.get(group);
}

export async function flowCasesFromLocal() {
  if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) return null;
  const cases = [];
  try {
    for (let page = 1; page <= 50; page++) {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/flow?casePage=${page}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) return null;
      const body = await response.json();
      if (!Array.isArray(body.cases)) return null;
      cases.push(...body.cases);
      if (page >= body.casePageCount) return cases;
    }
  } catch { return null; }
  return null;
}

export async function loadCardAnalysis({ sql, tenantId, importV2, metricId, loadTrend, flowCases = flowCasesFromLocal }) {
  const initial = await loadTrend({ metric: metricId });
  const asOf = initial.asOf;
  const card = DASHBOARD_KPI_ORDER.includes(metricId)
    ? (await cardOf(sql, 'dashboard', { sql, asOf, tenantId, importV2 })).find(c => c.id === metricId)
    : TEACHER_WORK_METRICS.some(m => m.id === metricId)
      ? (await cardOf(sql, 'teacher', { sql, asOf, tenantId, importV2 })).find(c => c.id === metricId)
      : null;
  if (!card) return null;
  const grain = card.period === 'month' ? 'month' : 'week';
  const trend = initial.grain === grain ? initial : await loadTrend({ metric: metricId, grain });
  const byDimension = {};
  for (const dim of trend.metric.dims.filter(d => !d.needsFilter)) byDimension[dim.id] = dim.id === trend.by ? trend : await loadTrend({ metric: metricId, grain, by: dim.id });
  let records = null;
  if (ROSTER_METRICS.has(metricId)) {
    const dimension = Object.values(byDimension).filter(d => d?.rows?.length).sort((a, b) => a.rows.length - b.rows.length)[0];
    if (dimension) {
      const gathered = new Map();
      for (const row of dimension.rows) {
        const filtered = await loadTrend({ metric: metricId, grain, f: `${dimension.by}:${row.key}` });
        for (const r of filtered.records?.at(-1) || []) gathered.set(String(r.key ?? [r.date, r.classId, r.studentId, r.id].join('|')), r);
      }
      records = [...gathered.values()];
    } else records = [];
  }
  return buildCardAnalysis({ trend, byDimension, card, flowCases: await flowCases(), records });
}
