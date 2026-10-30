// 카드 분석 전용 GET의 계산. 카드·추세·업무 흐름의 기존 읽기 함수를 다시 쓴다.
import { dashboardKpiCards, DASHBOARD_KPI_ORDER } from './v2-dashboard-flow.mjs';
import { teacherWorkWeekly, TEACHER_WORK_METRICS } from './v2-teacher-work.mjs';
import { buildCardAnalysis, CARD_FLOW_LINKS } from './card-analysis.mjs';
import { cardInput } from './card-insight.mjs';

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

export async function loadCardAnalysis({ sql, tenantId, importV2, metricId, selection = {}, loadTrend, flowCases = flowCasesFromLocal }) {
  const initial = await loadTrend({ metric: metricId, ...selection });
  const asOf = initial.asOf;
  const card = DASHBOARD_KPI_ORDER.includes(metricId)
    ? (await cardOf(sql, 'dashboard', { sql, asOf, tenantId, importV2 })).find(c => c.id === metricId)
    : TEACHER_WORK_METRICS.some(m => m.id === metricId)
      ? (await cardOf(sql, 'teacher', { sql, asOf, tenantId, importV2 })).find(c => c.id === metricId)
      : null;
  if (!card) return null;
  const trend = selection.grain || initial.grain === card.period ? initial : await loadTrend({ metric: metricId, grain: card.period });
  const byDimension = { [trend.by]: trend };
  let records = null;
  if (ROSTER_METRICS.has(metricId)) {
    if (Array.isArray(trend.records)) records = trend.records.at(-1) || [];
    else if (trend.rows.length) {
      const gathered = new Map();
      for (const row of trend.rows) {
        const filtered = await loadTrend({ metric: metricId, grain: trend.grain, f: `${trend.by}:${row.key}`,
          ...(trend.range ? { from: trend.range.from, to: trend.range.to, up: trend.range.up } : {}) });
        for (const r of filtered.records?.at(-1) || []) gathered.set(String(r.key ?? [r.date, r.classId, r.studentId, r.id].join('|')), r);
      }
      records = [...gathered.values()];
    } else records = [];
  }
  const cases = await flowCases();
  const analysis = buildCardAnalysis({ trend, byDimension, card, flowCases: cases, records });
  analysis.metricInfo = { name: card.label, unit: trend.metric.unit, better: trend.metric.better };
  const built = cardInput(analysis);
  const cardRequests = Array.isArray(cases) ? cases.filter(c => c?.kind === 'request' && c.state !== 'done' && c.requestSource?.card?.metric === metricId)
    .map(c => ({ id: c.id, factIds: c.requestSource.card.factIds })) : [];
  return { ...analysis, selectionKey: built.key, fingerprint: built.fingerprint, insightFactIds: built.facts.map(f => f.id),
    flowLink: CARD_FLOW_LINKS[metricId] || { tasks: [], signals: [] }, cardRequests };
}
